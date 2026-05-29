/**
 * Phase 8A: Government / Mayor service.
 * Phase 8B: City tax rate — in-memory, server-authoritative.
 * Phase 8C: City tax rate — DB-persisted via rp_city_config.
 * Phase 8D: City budget — tax revenue from job payouts accumulated in rp_city_config.
 *
 * Handles:
 *   loadCityConfigFromDb()                 — called once at server startup
 *   handleCityAnnounce(socket, ctx, data)  — rp:cityAnnounce
 *   handleGetCityConfig(socket)            — rp:getCityConfig  (in-memory, no DB query)
 *   handleSetTaxRate(socket, ctx, data)    — rp:setTaxRate     (DB-first, then broadcast)
 *
 * Authority rules (all server-side):
 *   - Requester must be in the government faction (factionType "government"
 *     OR factionSlug "government") with factionRank >= MAYOR_MIN_RANK (4).
 *   - Not jailed.  Not cuffed.
 *   - Server position must be within GOVERNMENT_OFFICE_RADIUS of GOVERNMENT_OFFICE_POS.
 *     A malicious client can emit from any location; the server enforces proximity.
 *   - Per-action cooldowns keyed by DB playerId; NOT consumed on validation failures.
 *
 * City config broadcast payload:
 *   rp:cityConfig { taxRate, updatedAt, updatedByName }
 *   — no faction slug, no socketId, no playerId, no coords, no rank.
 *
 * Tax application:
 *   applyCityTax(grossPay) → { grossPay, taxRate, taxAmount, netPay }
 *   Called by rpJobService at every payout path; server decides netPay.
 *
 * Security constraints (Phase 8C):
 *   - No mayor elections.  No business license system.
 *   - No username-based authority — isMayor() checks factionType + rank from rpCache.
 *   - updatedByName derived from ctx.players (server-authoritative); never client-provided.
 *   - mayor UUID from rpCache.entry.playerId; never client-provided.
 *   - Cooldown NOT consumed on DB failure.
 *   - cityTaxRate NOT mutated on DB failure.
 *   - rp:cityConfig NOT broadcast on DB failure.
 *   - DB write before in-memory mutation and before broadcast (DB-first order).
 *   - handleGetCityConfig: in-memory only — no DB query per request.
 *   - applyCityTax: unchanged API, returns integer taxAmount/netPay.
 */

import type { Socket } from "socket.io";
import type { LicenseContext } from "./rpLicenseService";
import {
  MAYOR_ANNOUNCE_MAX_CHARS,
  MAYOR_ANNOUNCE_COOLDOWN_MS,
  GOVERNMENT_OFFICE_DOOR,
  GOVERNMENT_OFFICE_RADIUS,
  CITY_TAX_MIN,
  CITY_TAX_MAX,
  CITY_TAX_DEFAULT,
  MAYOR_SET_TAX_COOLDOWN_MS,
  CITY_GRANT_MIN,
  CITY_GRANT_MAX,
  MAYOR_GRANT_COOLDOWN_MS,
  CITY_GRANT_NOTE_MAX_CHARS,
  CITY_PROJECT_DEFS,
  CITY_PROJECT_DURATION_MS,
  CITY_PROJECT_BONUS_RATE,
} from "../socket/cityData";
import { isMayor } from "./rpFactionHelpers";
import { logger } from "../lib/logger";
import { db, rpCityConfig, rpWallets, rpTransactionLog } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";

// ── Per-mayor announcement rate-limit ─────────────────────────────────────────
/**
 * Keyed by DB playerId (stable across reconnects).
 * Value = Unix ms when the last accepted announcement was broadcast.
 */
const announceCooldownMap = new Map<string, number>();

// ── In-memory city config (Phase 8B/8C/8D) ────────────────────────────────────
// Loaded from DB at startup by loadCityConfigFromDb(); kept in-memory at runtime.
// handleGetCityConfig reads from here — no DB query per player request.

/** Current city tax rate. Loaded from rp_city_config on startup. */
let cityTaxRate: number = CITY_TAX_DEFAULT;

/** Unix ms when the tax rate was last updated. Loaded from DB updated_at on startup. */
let taxRateUpdatedAt: number = 0;

/** Display name of the last mayor who changed the rate. Never client-provided. */
let taxRateUpdatedByName: string | null = null;

/** Per-mayor set-tax rate-limit. Keyed by DB playerId. */
const setTaxCooldownMap = new Map<string, number>();

/** Phase 8E: Per-mayor grant rate-limit. Keyed by DB playerId. */
const grantCooldownMap = new Map<string, number>();

// ── InsufficientBudgetError ───────────────────────────────────────────────────

/**
 * Phase 8E: thrown by spendCityBudgetTx when the stored budget < requested amount.
 * Caught specifically in handleCityGrant to show a user-friendly toast without
 * logging a server error.
 */
export class InsufficientBudgetError extends Error {
  constructor(
    readonly available: number,
    readonly requested: number,
  ) {
    super(`Insufficient city budget: available=${available}, requested=${requested}`);
    this.name = "InsufficientBudgetError";
  }
}

/**
 * Phase 8D: Accumulated city budget from job tax revenue.
 * Loaded from rp_city_config key "city_budget" at startup.
 * Updated in-memory ONLY after the DB commit inside a job payout transaction.
 * Never set by client input.
 */
let cityBudget: number = 0;

// ── Drizzle transaction type helper ───────────────────────────────────────────
// Extracts the tx parameter type from db.transaction's callback signature so
// addTaxRevenueTx can be called inside existing job payout transactions without
// importing Drizzle internals.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Phase 8F: Active city project state ───────────────────────────────────────
// In-memory only — projects reset on server restart.  Persisting to DB is a
// future phase concern; for now rp_city_config stores only budget.

interface ActiveProjectEntry {
  projectId: string;
  label:     string;
  expiresAt: number; // Unix ms
}

/** Map of projectId → running project. */
const activeCityProjects = new Map<string, ActiveProjectEntry>();

/**
 * Phase 8F P1: Pending reservation set — prevents duplicate funding when two
 * concurrent rp:cityProjectFund requests for the same project pass the
 * activeCityProjects.has() check before either one commits.
 *
 * Lifecycle:
 *   add(projectId)    — immediately before db.transaction()
 *   delete(projectId) — always in finally{} (success or failure)
 */
const pendingCityProjectFunds = new Set<string>();

// ── Phase 8I: in-memory project-funding ledger ────────────────────────────────

/**
 * One recorded city-project funding event. In-memory only — project funding is
 * not tied to a single player payout, so it isn't captured in rpTransactionLog.
 * We keep a small ring of the most recent events for the Mayor's ledger panel.
 * Holds no sensitive per-player data: just the project label, cost, and time.
 */
interface ProjectFundEvent {
  projectId: string;
  label:     string;
  cost:      number;
  createdAt: number; // Unix ms
}

/** Max project-funding events retained in memory for the ledger. */
const MAX_PROJECT_FUND_EVENTS = 25;

/** Most-recent-last ring of project funding events (trimmed to the max). */
const recentProjectFundEvents: ProjectFundEvent[] = [];

/** Append a project-funding event, trimming to MAX_PROJECT_FUND_EVENTS. */
function recordProjectFundEvent(ev: ProjectFundEvent): void {
  recentProjectFundEvents.push(ev);
  if (recentProjectFundEvents.length > MAX_PROJECT_FUND_EVENTS) {
    recentProjectFundEvents.splice(0, recentProjectFundEvents.length - MAX_PROJECT_FUND_EVENTS);
  }
}

/** Remove expired projects. Call before any read or payout bonus check. */
function pruneExpiredProjects(): void {
  const nowMs = Date.now();
  for (const [id, proj] of activeCityProjects.entries()) {
    if (proj.expiresAt <= nowMs) activeCityProjects.delete(id);
  }
}

/** Build the rp:cityProjects broadcast payload from current in-memory state. */
function buildProjectsPayload(): { projects: ActiveProjectEntry[] } {
  pruneExpiredProjects();
  return { projects: Array.from(activeCityProjects.values()) };
}

// ── applyCityProjectBonus (Phase 8F) ──────────────────────────────────────────

/**
 * Apply any active city project bonus to a gross pay amount.
 * Must be called BEFORE applyCityTax so tax is computed on the boosted gross.
 *
 * Returns the boosted gross, the bonus amount (0 if no project applies), and
 * the label of the active project (for transaction log notes).
 */
export function applyCityProjectBonus(
  jobSlug:  string,
  grossPay: number,
): {
  grossPay:           number;
  bonusAmount:        number;
  boostedGrossPay:    number;
  activeProjectLabel: string | null;
} {
  pruneExpiredProjects();

  for (const proj of activeCityProjects.values()) {
    const def = CITY_PROJECT_DEFS.find((d) => d.id === proj.projectId);
    if (def && (def.jobSlugs as readonly string[]).includes(jobSlug)) {
      const bonusAmount     = Math.floor(grossPay * CITY_PROJECT_BONUS_RATE);
      const boostedGrossPay = grossPay + bonusAmount;
      return { grossPay, bonusAmount, boostedGrossPay, activeProjectLabel: proj.label };
    }
  }

  return { grossPay, bonusAmount: 0, boostedGrossPay: grossPay, activeProjectLabel: null };
}

// ── getCityProjectCooldownMultiplier (Phase 8G) ───────────────────────────────

/**
 * Server-authoritative cooldown multiplier for a job's clock-in cooldown.
 *
 * If an active (non-expired) city project covers this job slug, the job's
 * route/clock-in cooldown is halved (multiplier 0.5); otherwise 1.
 *
 * This mirrors the payout-bonus coverage in applyCityProjectBonus: a project
 * applies to exactly the job slugs listed in its CITY_PROJECT_DEFS entry, so:
 *   - public_works      → city_worker, delivery
 *   - transit_subsidy   → taxi
 *   - emergency_funding → medic, mechanic, police_patrol
 *
 * Authority notes:
 *   - Reads ONLY server-side in-memory project state; never client input.
 *   - Prunes expired projects first so a lapsed project grants no reduction.
 *   - Returns a multiplier, never an absolute duration, so callers keep their
 *     own positive base-cooldown constants and the result stays > 0.
 */
export function getCityProjectCooldownMultiplier(jobSlug: string): number {
  pruneExpiredProjects();

  for (const proj of activeCityProjects.values()) {
    const def = CITY_PROJECT_DEFS.find((d) => d.id === proj.projectId);
    if (def && (def.jobSlugs as readonly string[]).includes(jobSlug)) {
      return 0.5;
    }
  }

  return 1;
}

// ── parseStrictNonNegInt ──────────────────────────────────────────────────────

/**
 * Parses a string as a non-negative safe integer.
 * Accepts ONLY strings that match /^[0-9]+$/ AND whose numeric value is a
 * safe integer, so "100abc", "1.5", "-1", "", and values > MAX_SAFE_INTEGER
 * all return null instead of silently coercing to a wrong number.
 */
function parseStrictNonNegInt(s: string): number | null {
  if (!/^[0-9]+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

// ── loadCityConfigFromDb ───────────────────────────────────────────────────────

/**
 * Phase 8C: Load city config from rp_city_config at server startup.
 * Reads "tax_rate", validates, and sets in-memory state.
 *
 * On missing/invalid value: keeps CITY_TAX_DEFAULT and logs a warning.
 * On DB error: logs and falls back to default — does NOT throw.
 *
 * Must be awaited before any socket connections are accepted so that
 * handleGetCityConfig and applyCityTax always return the persisted rate.
 */
export async function loadCityConfigFromDb(): Promise<void> {
  try {
    // Load all city config rows in one query.
    const rows = await db.select().from(rpCityConfig);
    const byKey = new Map(rows.map((r) => [r.key, r]));

    // ── tax_rate ──────────────────────────────────────────────────────────────
    const taxRateRow = byKey.get("tax_rate");
    if (!taxRateRow) {
      logger.warn("[rpGov] rp_city_config has no 'tax_rate' row — using default. Run seed:rp.");
    } else {
      const parsed = Number(taxRateRow.value);
      if (!Number.isFinite(parsed) || parsed < CITY_TAX_MIN || parsed > CITY_TAX_MAX) {
        logger.warn({ storedValue: taxRateRow.value }, "[rpGov] 'tax_rate' value is invalid — using default.");
      } else {
        cityTaxRate      = parsed;
        taxRateUpdatedAt = taxRateRow.updatedAt instanceof Date
          ? taxRateRow.updatedAt.getTime()
          : Date.now();
        taxRateUpdatedByName = null; // not stored in config table
      }
    }

    // ── city_budget (Phase 8D) ────────────────────────────────────────────────
    const budgetRow = byKey.get("city_budget");
    if (!budgetRow) {
      logger.warn("[rpGov] rp_city_config has no 'city_budget' row — using 0. Run seed:rp.");
    } else {
      const parsed = parseStrictNonNegInt(budgetRow.value);
      if (parsed === null) {
        logger.warn({ storedValue: budgetRow.value }, "[rpGov] 'city_budget' value is invalid — using 0.");
      } else {
        cityBudget = parsed;
      }
    }

    logger.info({ taxRate: cityTaxRate, cityBudget }, "[rpGov] city config loaded from DB");
  } catch (err) {
    logger.error({ err }, "[rpGov] failed to load city config from DB — using defaults");
    // Fallback: keep CITY_TAX_DEFAULT and cityBudget 0; server continues normally.
  }
}

// ── addTaxRevenueTx (Phase 8D) ────────────────────────────────────────────────

/**
 * Increments the city budget by taxAmount inside an existing DB transaction.
 * Must be called inside a db.transaction() callback so it commits atomically
 * with the job payout wallet update, transaction log, and player update.
 *
 * Seven-step procedure (P1 fix):
 *   1. SELECT city_budget FOR UPDATE.
 *   2. If missing: INSERT city_budget value "0" ON CONFLICT DO NOTHING.
 *   3. SELECT city_budget FOR UPDATE again (row guaranteed to exist).
 *   4. Strict-parse stored value — THROWS on invalid so the enclosing job
 *      payout transaction rolls back and the checkpoint remains retryable.
 *   5. Compute newBudget; verify Number.isSafeInteger and >= 0.
 *   6. UPDATE city_budget to newBudget.
 *   7. Return newBudget.
 *
 * Step 2 uses ON CONFLICT DO NOTHING (not DoUpdate) so concurrent first-time
 * inserts each write "0" but only one wins — the winner then does the additive
 * locked update in steps 1–7, so no revenue is lost.
 *
 * Security:
 *   - taxAmount is always server-computed (from applyCityTax); never client-provided.
 *   - updated_by is set to null (automatic revenue, not a player action).
 */
export async function addTaxRevenueTx(
  tx:        DbTransaction,
  taxAmount: number,
): Promise<number> {
  // Guard: taxAmount must be a positive safe integer.
  if (!Number.isSafeInteger(taxAmount) || taxAmount <= 0) {
    return cityBudget;
  }

  // ── Step 1: SELECT FOR UPDATE ─────────────────────────────────────────────
  let rows = await tx
    .select()
    .from(rpCityConfig)
    .where(eq(rpCityConfig.key, "city_budget"))
    .for("update");

  // ── Step 2: If missing, INSERT "0" ON CONFLICT DO NOTHING ─────────────────
  if (!rows[0]) {
    await tx
      .insert(rpCityConfig)
      .values({ key: "city_budget", value: "0", updatedBy: null })
      .onConflictDoNothing();

    // ── Step 3: SELECT FOR UPDATE again — row now exists ────────────────────
    rows = await tx
      .select()
      .from(rpCityConfig)
      .where(eq(rpCityConfig.key, "city_budget"))
      .for("update");
  }

  const row = rows[0];
  if (!row) {
    // Unreachable in practice, but throws so the enclosing tx rolls back.
    throw new Error("[rpGov] addTaxRevenueTx: city_budget row missing after insert");
  }

  // ── Step 4: Strict-parse — THROW on invalid to roll back payout tx ────────
  const currentStored = parseStrictNonNegInt(row.value);
  if (currentStored === null) {
    throw new Error(
      `[rpGov] addTaxRevenueTx: stored city_budget '${row.value}' is not a valid non-negative integer — rolling back job payout`,
    );
  }

  // ── Step 5: Compute and verify new budget ─────────────────────────────────
  const newBudget = currentStored + taxAmount;
  if (!Number.isSafeInteger(newBudget) || newBudget < 0) {
    throw new Error(
      `[rpGov] addTaxRevenueTx: newBudget=${newBudget} is not a safe non-negative integer`,
    );
  }

  // ── Step 6: UPDATE city_budget ────────────────────────────────────────────
  await tx
    .update(rpCityConfig)
    .set({ value: newBudget.toString(), updatedAt: new Date(), updatedBy: null })
    .where(eq(rpCityConfig.key, "city_budget"));

  // ── Step 7: Return newBudget ──────────────────────────────────────────────
  return newBudget;
}

// ── spendCityBudgetTx (Phase 8E) ──────────────────────────────────────────────

/**
 * Decrements the city budget by amount inside an existing DB transaction.
 * Exact inverse of addTaxRevenueTx; same 7-step SELECT-FOR-UPDATE pattern.
 *
 * Throws InsufficientBudgetError when stored budget < amount.
 * Throws on invalid stored value (rolls back the enclosing transaction).
 *
 * Returns the new budget integer; caller syncs in-memory after tx commit.
 */
export async function spendCityBudgetTx(
  tx:     DbTransaction,
  amount: number,
): Promise<number> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`[rpGov] spendCityBudgetTx: invalid amount=${amount}`);
  }

  // Step 1: SELECT FOR UPDATE
  let rows = await tx
    .select()
    .from(rpCityConfig)
    .where(eq(rpCityConfig.key, "city_budget"))
    .for("update");

  // Step 2: If missing, INSERT "0" ON CONFLICT DO NOTHING
  if (!rows[0]) {
    await tx
      .insert(rpCityConfig)
      .values({ key: "city_budget", value: "0", updatedBy: null })
      .onConflictDoNothing();

    // Step 3: SELECT FOR UPDATE again
    rows = await tx
      .select()
      .from(rpCityConfig)
      .where(eq(rpCityConfig.key, "city_budget"))
      .for("update");
  }

  const row = rows[0];
  if (!row) {
    throw new Error("[rpGov] spendCityBudgetTx: city_budget row missing after insert");
  }

  // Step 4: Strict-parse — THROW on invalid
  const currentStored = parseStrictNonNegInt(row.value);
  if (currentStored === null) {
    throw new Error(
      `[rpGov] spendCityBudgetTx: stored city_budget '${row.value}' is invalid`,
    );
  }

  // Step 5: Insufficient funds
  if (currentStored < amount) {
    throw new InsufficientBudgetError(currentStored, amount);
  }

  // Step 6: Compute and verify
  const newBudget = currentStored - amount;
  if (!Number.isSafeInteger(newBudget) || newBudget < 0) {
    throw new Error(
      `[rpGov] spendCityBudgetTx: newBudget=${newBudget} is invalid`,
    );
  }

  // Step 7: UPDATE
  await tx
    .update(rpCityConfig)
    .set({ value: newBudget.toString(), updatedAt: new Date(), updatedBy: null })
    .where(eq(rpCityConfig.key, "city_budget"));

  return newBudget;
}

// ── handleCityGrant (Phase 8E) ────────────────────────────────────────────────

/**
 * rp:cityGrant — Mayor sends a dollar grant to an online player.
 *
 * Authority checks (all server-side):
 *   1. Mayor (government faction + rank >= MAYOR_MIN_RANK).
 *   2. Not jailed.  Not cuffed.
 *   3. Within GOVERNMENT_OFFICE_RADIUS of GOVERNMENT_OFFICE_POS (server position).
 *   4. Payload: targetSocketId (string), amount (integer CITY_GRANT_MIN–MAX), note (optional ≤120 chars).
 *   5. Target exists in rpCache + players map; target not jailed.
 *   6. No self-grants.
 *   7. Per-mayor 30 s cooldown, keyed by DB playerId.
 *
 * DB-first order:
 *   - spendCityBudgetTx + target wallet credit + rpTransactionLog all commit
 *     in one transaction.
 *   - Only on commit: consume cooldown, update in-memory cityBudget and
 *     target entry.cash, emit rp:profileUpdate + toasts, broadcast rp:cityConfig.
 *   - On DB failure / insufficient funds: do NOT update memory, do NOT consume
 *     cooldown, emit error toast to mayor.
 */
export async function handleCityGrant(
  socket: Socket,
  ctx:    LicenseContext,
  data:   unknown,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Guard 1: Mayor ─────────────────────────────────────────────────────────
  if (!isMayor(entry)) {
    socket.emit("rp:toast", { msg: "Only the Mayor can issue city grants.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 2: not jailed ───────────────────────────────────────────────────
  if (entry.jailUntil && entry.jailUntil > new Date()) {
    socket.emit("rp:toast", { msg: "You cannot do that while jailed.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 3: not cuffed ───────────────────────────────────────────────────
  if (entry.cuffedBy) {
    socket.emit("rp:toast", { msg: "You cannot do that while cuffed.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 4: City Hall proximity ──────────────────────────────────────────
  const playerState = ctx.players.get(socket.id);
  if (!playerState) return;

  const [gx, , gz] = GOVERNMENT_OFFICE_DOOR;
  const dxg = playerState.x - gx;
  const dzg = playerState.z - gz;
  if (Math.sqrt(dxg * dxg + dzg * dzg) > GOVERNMENT_OFFICE_RADIUS) {
    socket.emit("rp:toast", { msg: "Visit City Hall to issue grants.", color: "red", duration: 3000 });
    return;
  }

  // ── Parse payload ─────────────────────────────────────────────────────────
  const raw            = data as Record<string, unknown> | null | undefined;
  const targetSocketId = typeof raw?.targetSocketId === "string" ? raw.targetSocketId.trim() : "";
  const amount         = typeof raw?.amount === "number" ? raw.amount : NaN;
  const note           = typeof raw?.note === "string"
    ? raw.note.trim().slice(0, CITY_GRANT_NOTE_MAX_CHARS)
    : "";

  // ── Validate amount ───────────────────────────────────────────────────────
  if (!Number.isInteger(amount) || amount < CITY_GRANT_MIN || amount > CITY_GRANT_MAX) {
    socket.emit("rp:toast", {
      msg:      `Grant amount must be $${CITY_GRANT_MIN}–$${CITY_GRANT_MAX}.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Validate target ───────────────────────────────────────────────────────
  if (!targetSocketId) {
    socket.emit("rp:toast", { msg: "Select a player to receive the grant.", color: "yellow", duration: 3000 });
    return;
  }

  // No self-grants
  if (targetSocketId === socket.id) {
    socket.emit("rp:toast", { msg: "You cannot grant funds to yourself.", color: "yellow", duration: 3000 });
    return;
  }

  const targetEntry  = ctx.rpCache.get(targetSocketId);
  const targetPlayer = ctx.players.get(targetSocketId);
  if (!targetEntry || !targetPlayer) {
    socket.emit("rp:toast", { msg: "That player is no longer online.", color: "yellow", duration: 3000 });
    return;
  }

  if (targetEntry.jailUntil && targetEntry.jailUntil > new Date()) {
    socket.emit("rp:toast", { msg: "Cannot grant to a jailed player.", color: "yellow", duration: 3000 });
    return;
  }

  // ── Guard 5: per-mayor cooldown ───────────────────────────────────────────
  const cooldownKey = entry.playerId;
  const lastGrant   = grantCooldownMap.get(cooldownKey) ?? 0;
  const nowMs       = Date.now();
  const remainingMs = MAYOR_GRANT_COOLDOWN_MS - (nowMs - lastGrant);
  if (remainingMs > 0) {
    socket.emit("rp:toast", {
      msg:      `Grant cooldown. Wait ${Math.ceil(remainingMs / 1000)}s.`,
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  // ── DB-first transaction ──────────────────────────────────────────────────
  let newBudget      = 0;
  let newTargetCash  = 0;
  try {
    await db.transaction(async (tx) => {
      // 1. Spend from city budget (throws InsufficientBudgetError if low)
      newBudget = await spendCityBudgetTx(tx, amount);

      // 2. Lock + credit target wallet
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, targetEntry.playerId))
        .for("update");
      if (!wallet) throw new Error("no wallet row for grant target");

      newTargetCash = wallet.cash + amount;
      await tx
        .update(rpWallets)
        .set({ cash: newTargetCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, targetEntry.playerId));

      // 3. Transaction log (cashDelta = amount credited to target)
      const txNote = note
        ? `City grant from Mayor — ${note}`
        : "City grant from Mayor";
      await tx.insert(rpTransactionLog).values({
        playerId:  targetEntry.playerId,
        kind:      "government_grant",
        cashDelta: amount,
        bankDelta: 0,
        cashAfter: newTargetCash,
        bankAfter: wallet.bank,
        note:      txNote,
      });
    });
  } catch (err) {
    if (err instanceof InsufficientBudgetError) {
      socket.emit("rp:toast", {
        msg:      `Insufficient city budget ($${err.available.toLocaleString()} available).`,
        color:    "red",
        duration: 4000,
      });
      return;
    }
    logger.error({ err, socketId: socket.id }, "[rpGov] handleCityGrant: transaction failed");
    socket.emit("rp:toast", { msg: "Grant failed — try again.", color: "red", duration: 4000 });
    return;
  }

  // ── DB committed — update in-memory state ─────────────────────────────────
  // Consume cooldown only after successful commit.
  grantCooldownMap.set(cooldownKey, nowMs);
  setCityBudgetInMemory(newBudget);
  targetEntry.cash = newTargetCash;

  const mayorName  = ctx.players.get(socket.id)?.username ?? "Mayor";
  const targetName = (targetPlayer as { username?: string }).username ?? targetSocketId;

  logger.info(
    { socketId: socket.id, mayorName, targetSocketId, targetName, amount, newBudget },
    "[rpGov] city grant issued",
  );

  // Emit to target
  ctx.io.to(targetSocketId).emit("rp:profileUpdate", { cash: newTargetCash });
  ctx.io.to(targetSocketId).emit("rp:toast", {
    msg:      note
      ? `🏛️ City grant: +$${amount} from ${mayorName} — "${note}"`
      : `🏛️ City grant: +$${amount} from ${mayorName}.`,
    color:    "gold",
    duration: 8000,
  });

  // Broadcast updated city config to all clients
  ctx.io.emit("rp:cityConfig", {
    taxRate:       cityTaxRate,
    updatedAt:     taxRateUpdatedAt > 0 ? taxRateUpdatedAt : Date.now(),
    updatedByName: taxRateUpdatedByName,
    cityBudget:    newBudget,
  });

  // Confirm to mayor
  socket.emit("rp:toast", {
    msg:      `$${amount} granted to ${targetName}. Budget remaining: $${newBudget.toLocaleString()}`,
    color:    "green",
    duration: 5000,
  });
}

// ── handleGetCityProjects (Phase 8F) ─────────────────────────────────────────

/**
 * rp:getCityProjects — Any connected player may request active project list.
 * No auth check; read-only in-memory state only.
 */
export function handleGetCityProjects(socket: Socket): void {
  socket.emit("rp:cityProjects", buildProjectsPayload());
}

// ── handleGetCityDashboard (Phase 8H) ─────────────────────────────────────────

/**
 * Phase 8H: Read-only government dashboard payload.
 *
 * Built ENTIRELY from server-side in-memory state (ctx.players + ctx.rpCache +
 * in-memory city config/projects). Every figure is an aggregate count or a
 * value the server already broadcasts (taxRate, cityBudget, project labels).
 *
 * Deliberately omits all sensitive per-player fields: no socket IDs, no DB
 * player IDs, no coordinates, no wallet/cash/bank values, no tokens, and no
 * usernames (only aggregated counts).
 */
interface CityDashboardPayload {
  taxRate:    number;
  cityBudget: number;
  /** Active projects (label + expiry only — same shape as rp:cityProjects). */
  projects:   { projectId: string; label: string; expiresAt: number }[];
  onlinePlayers:  number;
  /** On-duty player counts keyed by job slug (only jobs with ≥1 on duty). */
  onDutyByJob:    Record<string, number>;
  /** Faction member counts keyed by factionType (only types with ≥1 member). */
  factionCounts:  Record<string, number>;
  wantedPlayers:  number;
  jailedPlayers:  number;
  cuffedPlayers:  number;
}

/**
 * Build the dashboard payload from current server state only.
 * Prunes expired projects first so the snapshot is accurate.
 */
function buildCityDashboardPayload(ctx: LicenseContext): CityDashboardPayload {
  pruneExpiredProjects();

  const now = new Date();
  const onDutyByJob:   Record<string, number> = {};
  const factionCounts: Record<string, number> = {};
  let wantedPlayers = 0;
  let jailedPlayers = 0;
  let cuffedPlayers = 0;

  for (const entry of ctx.rpCache.values()) {
    // On-duty job counts (server-authoritative onDuty + currentJob).
    if (entry.onDuty && entry.currentJob) {
      onDutyByJob[entry.currentJob] = (onDutyByJob[entry.currentJob] ?? 0) + 1;
    }
    // Faction membership counts, aggregated by faction type only.
    if (entry.factionType) {
      factionCounts[entry.factionType] = (factionCounts[entry.factionType] ?? 0) + 1;
    }
    // Wanted / jailed / cuffed aggregate counts.
    if (entry.wantedStars > 0) wantedPlayers++;
    if (entry.jailUntil && entry.jailUntil > now) jailedPlayers++;
    if (entry.cuffedBy) cuffedPlayers++;
  }

  return {
    taxRate:       cityTaxRate,
    cityBudget,
    projects:      buildProjectsPayload().projects.map((p) => ({
      projectId: p.projectId,
      label:     p.label,
      expiresAt: p.expiresAt,
    })),
    onlinePlayers: ctx.players.size,
    onDutyByJob,
    factionCounts,
    wantedPlayers,
    jailedPlayers,
    cuffedPlayers,
  };
}

/**
 * rp:getCityDashboard — Mayor requests the read-only government status panel.
 *
 * Authority checks (all server-side, identical to other Mayor actions):
 *   1. Mayor (government faction + rank >= MAYOR_MIN_RANK) via isMayor().
 *   2. Not jailed.
 *   3. Not cuffed.
 *   4. Within GOVERNMENT_OFFICE_RADIUS of GOVERNMENT_OFFICE_POS (server position).
 *
 * Read-only: no DB writes, no budget/cooldown/project mutation. Emits
 * rp:cityDashboard with an aggregate-only payload back to the requesting socket.
 */
export function handleGetCityDashboard(socket: Socket, ctx: LicenseContext): void {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Guard 1: Mayor ────────────────────────────────────────────────────────
  if (!isMayor(entry)) {
    socket.emit("rp:toast", { msg: "Only the Mayor can view the city dashboard.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 2: not jailed ───────────────────────────────────────────────────
  if (entry.jailUntil && entry.jailUntil > new Date()) {
    socket.emit("rp:toast", { msg: "You cannot do that while jailed.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 3: not cuffed ───────────────────────────────────────────────────
  if (entry.cuffedBy) {
    socket.emit("rp:toast", { msg: "You cannot do that while cuffed.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 4: City Hall proximity ──────────────────────────────────────────
  const playerState = ctx.players.get(socket.id);
  if (!playerState) return;

  const [gx, , gz] = GOVERNMENT_OFFICE_DOOR;
  const dxg = playerState.x - gx;
  const dzg = playerState.z - gz;
  if (Math.sqrt(dxg * dxg + dzg * dzg) > GOVERNMENT_OFFICE_RADIUS) {
    socket.emit("rp:toast", { msg: "Visit City Hall to view the city dashboard.", color: "red", duration: 3000 });
    return;
  }

  socket.emit("rp:cityDashboard", buildCityDashboardPayload(ctx));
}

// ── handleGetCityLedger (Phase 8I) ────────────────────────────────────────────

/** Max ledger entries returned to the client. */
const CITY_LEDGER_MAX_ENTRIES = 25;
/** Rows to read from rpTransactionLog before filtering/mapping down. */
const CITY_LEDGER_DB_LIMIT = 50;

/**
 * One safe, read-only ledger entry. Contains no socket IDs, DB player IDs,
 * coordinates, tokens, or wallet balances — only an amount, a generic label,
 * the event type, and a timestamp.
 */
interface CityLedgerEntry {
  id:        string;
  type:      "tax_revenue" | "government_grant" | "city_project_funded";
  amount:    number;
  label:     string;
  createdAt: number; // Unix ms
  note?:     string;
}

/**
 * Defensively extract an integer field like `tax=123` from a transaction note.
 * Returns null when the field is missing or not a clean integer — callers must
 * handle null and never assume a parse succeeded.
 */
function parseNoteInt(note: string | null | undefined, field: string): number | null {
  if (typeof note !== "string") return null;
  const m = note.match(new RegExp(`(?:^|\\s)${field}=(-?\\d+)(?:\\s|$)`));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/** Defensively extract the trailing `project=Label` token from a note. */
function parseNoteProject(note: string | null | undefined): string | null {
  if (typeof note !== "string") return null;
  const m = note.match(/(?:^|\s)project=(.+?)\s*$/);
  return m ? m[1].trim() || null : null;
}

/**
 * Build the read-only city ledger from recent transaction-log rows plus the
 * in-memory project-funding events. All figures are city-budget movements:
 *   - tax_revenue:        the `tax=` portion of a job_pay note (budget inflow)
 *   - government_grant:   cashDelta of a government_grant row (budget outflow)
 *   - city_project_funded: cost from recentProjectFundEvents (budget outflow)
 *
 * Defensive throughout: a row with an unparseable note is skipped (for tax)
 * or falls back to a safe label; nothing here can throw on bad data.
 */
async function buildCityLedgerPayload(): Promise<{ entries: CityLedgerEntry[] }> {
  const entries: CityLedgerEntry[] = [];

  // ── DB rows: job_pay (tax inflow) + government_grant (outflow) ─────────────
  try {
    // Note: we deliberately do NOT select rpTransactionLog.id — the internal DB
    // row id must never leave the server. Client entry ids are generated below
    // from timestamp + kind + index, which is sufficient for React keys.
    const rows = await db
      .select({
        kind:      rpTransactionLog.kind,
        cashDelta: rpTransactionLog.cashDelta,
        note:      rpTransactionLog.note,
        createdAt: rpTransactionLog.createdAt,
      })
      .from(rpTransactionLog)
      .where(inArray(rpTransactionLog.kind, ["job_pay", "government_grant"]))
      .orderBy(desc(rpTransactionLog.createdAt))
      .limit(CITY_LEDGER_DB_LIMIT);

    for (const row of rows) {
      const createdAt = row.createdAt instanceof Date ? row.createdAt.getTime() : Date.now();

      if (row.kind === "job_pay") {
        // Tax collected on this payout (budget inflow). Skip rows with no/zero tax.
        const tax = parseNoteInt(row.note, "tax");
        if (tax === null || tax <= 0) continue;
        const project = parseNoteProject(row.note);
        entries.push({
          id:        `tx-${createdAt}-job_pay-${entries.length}`,
          type:      "tax_revenue",
          amount:    tax,
          label:     "Tax revenue",
          createdAt,
          note:      project ? `during ${project}` : undefined,
        });
      } else {
        // government_grant — budget outflow equal to the credited cashDelta.
        const amount = Number.isSafeInteger(row.cashDelta) ? row.cashDelta : 0;
        entries.push({
          id:        `tx-${createdAt}-government_grant-${entries.length}`,
          type:      "government_grant",
          amount,
          label:     "City grant",
          createdAt,
        });
      }
    }
  } catch (err) {
    // Never surface raw DB errors to the client; log and continue with whatever
    // we have (in-memory project events below still render).
    logger.error({ err }, "[rpGov] buildCityLedgerPayload: DB query failed");
  }

  // ── In-memory project funding events (budget outflow) ─────────────────────
  for (const ev of recentProjectFundEvents) {
    entries.push({
      id:        `proj-${ev.projectId}-${ev.createdAt}`,
      type:      "city_project_funded",
      amount:    ev.cost,
      label:     ev.label,
      createdAt: ev.createdAt,
    });
  }

  // Newest first, capped.
  entries.sort((a, b) => b.createdAt - a.createdAt);
  return { entries: entries.slice(0, CITY_LEDGER_MAX_ENTRIES) };
}

/**
 * rp:getCityLedger — Mayor requests the read-only city budget ledger.
 *
 * Authority checks (identical to other Mayor actions):
 *   1. Mayor (government faction + rank >= MAYOR_MIN_RANK) via isMayor().
 *   2. Not jailed.  3. Not cuffed.
 *   4. Within GOVERNMENT_OFFICE_RADIUS of GOVERNMENT_OFFICE_POS.
 *
 * Read-only: a single SELECT (limit 50) plus in-memory events. No writes.
 * Emits rp:cityLedger with an aggregate, privacy-safe payload.
 */
export async function handleGetCityLedger(socket: Socket, ctx: LicenseContext): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Guard 1: Mayor ────────────────────────────────────────────────────────
  if (!isMayor(entry)) {
    socket.emit("rp:toast", { msg: "Only the Mayor can view the city ledger.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 2: not jailed ───────────────────────────────────────────────────
  if (entry.jailUntil && entry.jailUntil > new Date()) {
    socket.emit("rp:toast", { msg: "You cannot do that while jailed.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 3: not cuffed ───────────────────────────────────────────────────
  if (entry.cuffedBy) {
    socket.emit("rp:toast", { msg: "You cannot do that while cuffed.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 4: City Hall proximity ──────────────────────────────────────────
  const playerState = ctx.players.get(socket.id);
  if (!playerState) return;

  const [gx, , gz] = GOVERNMENT_OFFICE_DOOR;
  const dxg = playerState.x - gx;
  const dzg = playerState.z - gz;
  if (Math.sqrt(dxg * dxg + dzg * dzg) > GOVERNMENT_OFFICE_RADIUS) {
    socket.emit("rp:toast", { msg: "Visit City Hall to view the city ledger.", color: "red", duration: 3000 });
    return;
  }

  const payload = await buildCityLedgerPayload();
  socket.emit("rp:cityLedger", payload);
}

// ── handleCityProjectFund (Phase 8F) ──────────────────────────────────────────

/**
 * rp:cityProjectFund — Mayor activates a city project by spending the budget.
 *
 * Authority checks (all server-side):
 *   1. Mayor (government faction + rank >= MAYOR_MIN_RANK).
 *   2. Not jailed.  Not cuffed.
 *   3. Within GOVERNMENT_OFFICE_RADIUS of GOVERNMENT_OFFICE_POS.
 *   4. projectId must match a known CITY_PROJECT_DEFS entry.
 *   5. Project must not already be active (after pruning expired).
 *   6. Sufficient city budget (soft in-memory check + hard DB check).
 *
 * DB-first: spendCityBudgetTx inside a transaction.
 * After commit only: setCityBudgetInMemory, activate project in-memory,
 * broadcast rp:cityConfig + rp:cityProjects.
 * On failure: no memory update, no project activation.
 */
export async function handleCityProjectFund(
  socket: Socket,
  ctx:    LicenseContext,
  data:   unknown,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Guard 1: Mayor ────────────────────────────────────────────────────────
  if (!isMayor(entry)) {
    socket.emit("rp:toast", { msg: "Only the Mayor can fund city projects.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 2: not jailed ───────────────────────────────────────────────────
  if (entry.jailUntil && entry.jailUntil > new Date()) {
    socket.emit("rp:toast", { msg: "You cannot do that while jailed.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 3: not cuffed ───────────────────────────────────────────────────
  if (entry.cuffedBy) {
    socket.emit("rp:toast", { msg: "You cannot do that while cuffed.", color: "red", duration: 3000 });
    return;
  }

  // ── Guard 4: City Hall proximity ──────────────────────────────────────────
  const playerState = ctx.players.get(socket.id);
  if (!playerState) return;

  const [gx, , gz] = GOVERNMENT_OFFICE_DOOR;
  const dxg = playerState.x - gx;
  const dzg = playerState.z - gz;
  if (Math.sqrt(dxg * dxg + dzg * dzg) > GOVERNMENT_OFFICE_RADIUS) {
    socket.emit("rp:toast", { msg: "Visit City Hall to fund city projects.", color: "red", duration: 3000 });
    return;
  }

  // ── Parse payload ─────────────────────────────────────────────────────────
  const raw       = data as Record<string, unknown> | null | undefined;
  const projectId = typeof raw?.projectId === "string" ? raw.projectId.trim() : "";

  // ── Validate project id ───────────────────────────────────────────────────
  const def = CITY_PROJECT_DEFS.find((d) => d.id === projectId);
  if (!def) {
    socket.emit("rp:toast", { msg: "Unknown project.", color: "yellow", duration: 3000 });
    return;
  }

  // ── Check not already active (includes pending reservation) ─────────────
  // pruneExpiredProjects() first so a just-expired project doesn't block.
  // pendingCityProjectFunds guards the async gap between this check and the
  // DB commit: two concurrent requests for the same project both pass
  // activeCityProjects.has() if neither has committed yet, so we reject the
  // second one immediately with the reservation set.
  pruneExpiredProjects();
  if (activeCityProjects.has(projectId)) {
    socket.emit("rp:toast", {
      msg:      `${def.label} is already active.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }
  if (pendingCityProjectFunds.has(projectId)) {
    socket.emit("rp:toast", {
      msg:      `${def.label} funding is already in progress.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Soft budget check (in-memory; hard check is in DB) ────────────────────
  if (cityBudget < def.cost) {
    socket.emit("rp:toast", {
      msg:      `Insufficient city budget ($${cityBudget.toLocaleString()} available, $${def.cost} needed).`,
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // ── Reserve + DB-first: spend city budget ─────────────────────────────────
  // pendingCityProjectFunds.add BEFORE the transaction; always deleted in
  // finally{} so it is never left dangling even on DB failure.
  pendingCityProjectFunds.add(projectId);
  let newBudget = 0;
  try {
    await db.transaction(async (tx) => {
      newBudget = await spendCityBudgetTx(tx, def.cost);
    });
  } catch (err) {
    if (err instanceof InsufficientBudgetError) {
      socket.emit("rp:toast", {
        msg:      `Insufficient city budget ($${err.available.toLocaleString()} available).`,
        color:    "red",
        duration: 4000,
      });
      return;
    }
    logger.error({ err, socketId: socket.id }, "[rpGov] handleCityProjectFund: DB failed");
    socket.emit("rp:toast", { msg: "Project funding failed — try again.", color: "red", duration: 4000 });
    return;
  } finally {
    // Always release the reservation — success or failure.
    pendingCityProjectFunds.delete(projectId);
  }

  // ── DB committed — activate project in memory ─────────────────────────────
  const expiresAt = Date.now() + CITY_PROJECT_DURATION_MS;
  setCityBudgetInMemory(newBudget);
  activeCityProjects.set(projectId, { projectId, label: def.label, expiresAt });

  // Phase 8I: record the funding event for the Mayor's read-only ledger.
  // In-memory only; never blocks or affects the (already-committed) spend.
  recordProjectFundEvent({ projectId, label: def.label, cost: def.cost, createdAt: Date.now() });

  const mayorName = ctx.players.get(socket.id)?.username ?? "Mayor";
  logger.info(
    { socketId: socket.id, mayorName, projectId, cost: def.cost, newBudget, expiresAt },
    "[rpGov] city project funded",
  );

  // Broadcast updated budget + active projects to all clients.
  ctx.io.emit("rp:cityConfig", {
    taxRate:       cityTaxRate,
    updatedAt:     taxRateUpdatedAt > 0 ? taxRateUpdatedAt : Date.now(),
    updatedByName: taxRateUpdatedByName,
    cityBudget:    newBudget,
  });
  ctx.io.emit("rp:cityProjects", buildProjectsPayload());

  socket.emit("rp:toast", {
    msg:      `${def.label} is now active for 10 minutes! Cost: $${def.cost}`,
    color:    "green",
    duration: 6000,
  });
}

// ── persistCityTaxRate ────────────────────────────────────────────────────────

/**
 * Phase 8C: Upsert the "tax_rate" key in rp_city_config.
 *
 * DB write order contract:
 *   persistCityTaxRate MUST complete successfully before the caller
 *   mutates in-memory cityTaxRate, consumes cooldown, or broadcasts.
 *   If this throws, the caller must abort and NOT update memory/broadcast.
 *
 * @param rate         Validated decimal rate in [CITY_TAX_MIN, CITY_TAX_MAX].
 * @param mayorPlayerId DB UUID of the Mayor (from rpCache entry.playerId — never client-provided).
 */
export async function persistCityTaxRate(
  rate:          number,
  mayorPlayerId: string,
): Promise<void> {
  const valueStr = rate.toString();
  await db
    .insert(rpCityConfig)
    .values({
      key:       "tax_rate",
      value:     valueStr,
      updatedBy: mayorPlayerId,
    })
    .onConflictDoUpdate({
      target: rpCityConfig.key,
      set: {
        value:     valueStr,
        updatedAt: new Date(),
        updatedBy: mayorPlayerId,
      },
    });
}

// ── getCityTaxRate (exported for rpJobService) ─────────────────────────────────

/** Returns the current server-authoritative city tax rate. */
export function getCityTaxRate(): number {
  return cityTaxRate;
}

// ── getCityBudget / setCityBudgetInMemory (Phase 8D) ──────────────────────────

/** Returns the current in-memory city budget (accumulated tax revenue). */
export function getCityBudget(): number {
  return cityBudget;
}

/**
 * Updates the in-memory city budget after a DB transaction commits.
 * Called by rpJobService immediately after db.transaction() resolves
 * (i.e., after addTaxRevenueTx has committed inside the transaction).
 * Never called on transaction failure.
 */
export function setCityBudgetInMemory(newBudget: number): void {
  cityBudget = newBudget;
}

// ── applyCityTax (exported for rpJobService) ───────────────────────────────────

/**
 * Applies the current city tax rate to a gross pay amount.
 * Returns a breakdown used by rpJobService payout paths.
 *
 * grossPay must be a non-negative integer.
 * taxAmount and netPay are floored to integers so they are always safe for
 * DB wallet columns (which store whole numbers).
 */
export function applyCityTax(grossPay: number): {
  grossPay:  number;
  taxRate:   number;
  taxAmount: number;
  netPay:    number;
} {
  const rate      = cityTaxRate;
  const taxAmount = Math.floor(grossPay * rate);
  const netPay    = grossPay - taxAmount;
  return { grossPay, taxRate: rate, taxAmount, netPay };
}

// ── handleCityAnnounce ─────────────────────────────────────────────────────────

/**
 * rp:cityAnnounce — Mayor broadcasts a message to all connected clients.
 *
 * The handler performs ALL authority checks before touching any shared state.
 * The broadcast payload contains only: msg, fromName, createdAt — no faction
 * slug, no socketId, no playerId, no coordinates.
 */
export function handleCityAnnounce(
  socket: Socket,
  ctx:    LicenseContext,
  data:   unknown,
): void {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Guard 1: must be a Mayor (government faction + rank >= 4) ──────────────
  if (!isMayor(entry)) {
    socket.emit("rp:toast", {
      msg:      "Only the Mayor can broadcast city announcements.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 2: not jailed ────────────────────────────────────────────────────
  if (entry.jailUntil && entry.jailUntil > new Date()) {
    socket.emit("rp:toast", {
      msg:      "You cannot do that while jailed.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 3: not cuffed ────────────────────────────────────────────────────
  if (entry.cuffedBy) {
    socket.emit("rp:toast", {
      msg:      "You cannot do that while cuffed.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 4: server-side City Hall proximity ──────────────────────────────
  // A malicious client can emit rp:cityAnnounce from any location.
  // The server derives position from ctx.players (authoritative join state) —
  // the client cannot spoof it.
  const playerState = ctx.players.get(socket.id);
  if (!playerState) return;

  const [gx, , gz] = GOVERNMENT_OFFICE_DOOR;
  const dx4 = playerState.x - gx;
  const dz4 = playerState.z - gz;
  if (Math.sqrt(dx4 * dx4 + dz4 * dz4) > GOVERNMENT_OFFICE_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "Visit City Hall to broadcast announcements.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Parse + validate message ───────────────────────────────────────────────
  const raw = data as Record<string, unknown> | null | undefined;
  const msg = typeof raw?.msg === "string" ? raw.msg.trim() : "";
  if (msg.length < 1 || msg.length > MAYOR_ANNOUNCE_MAX_CHARS) {
    socket.emit("rp:toast", {
      msg:      `Announcement must be 1–${MAYOR_ANNOUNCE_MAX_CHARS} characters.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Guard 5: per-mayor cooldown ────────────────────────────────────────────
  const cooldownKey  = entry.playerId;
  const lastAnnounce = announceCooldownMap.get(cooldownKey) ?? 0;
  const nowMs        = Date.now();
  const remainingMs  = MAYOR_ANNOUNCE_COOLDOWN_MS - (nowMs - lastAnnounce);
  if (remainingMs > 0) {
    socket.emit("rp:toast", {
      msg:      `Announcement cooldown. Wait ${Math.ceil(remainingMs / 1000)}s.`,
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  // ── Commit cooldown before broadcast ──────────────────────────────────────
  // Set pessimistically so a partial failure can't reset the throttle.
  announceCooldownMap.set(cooldownKey, nowMs);

  // ── Derive display name from server-authoritative ctx.players ─────────────
  // Never trust client-provided name — use the username from the join event.
  const fromName = ctx.players.get(socket.id)?.username ?? "Mayor";

  const payload = {
    msg,
    fromName,
    createdAt: nowMs,
    // Anti-trust: no faction slug, no socketId, no playerId, no coordinates.
  };

  logger.info(
    { socketId: socket.id, fromName, msgLen: msg.length },
    "[rpGov] city announcement broadcast",
  );

  // Broadcast to every connected client (global announcement).
  ctx.io.emit("rp:cityAnnounce", payload);
}

// ── handleGetCityConfig ────────────────────────────────────────────────────────

/**
 * rp:getCityConfig — Any connected player may request the current city config.
 * Emits rp:cityConfig back to the requesting socket only.
 * No auth check — read-only, safe metadata only.
 */
export function handleGetCityConfig(socket: Socket): void {
  socket.emit("rp:cityConfig", {
    taxRate:       cityTaxRate,
    updatedAt:     taxRateUpdatedAt > 0 ? taxRateUpdatedAt : Date.now(),
    updatedByName: taxRateUpdatedByName,
    cityBudget,    // Phase 8D: include accumulated tax revenue
  });
}

// ── handleSetTaxRate ───────────────────────────────────────────────────────────

/**
 * rp:setTaxRate — Mayor sets the city tax rate.
 *
 * Authority checks (all server-side, in order):
 *   1. Requester in rpCache.
 *   2. isMayor(entry) — government faction + rank >= MAYOR_MIN_RANK.
 *   3. Not jailed.
 *   4. Not cuffed.
 *   5. Within GOVERNMENT_OFFICE_RADIUS of GOVERNMENT_OFFICE_POS (server position).
 *   6. Payload rate is finite number, within [CITY_TAX_MIN, CITY_TAX_MAX].
 *   7. Per-mayor cooldown (MAYOR_SET_TAX_COOLDOWN_MS), keyed by DB playerId.
 *      Cooldown is NOT consumed on validation / proximity failures.
 *
 * Phase 8C DB-first order (on success):
 *   a. persistCityTaxRate(rate, entry.playerId) — DB upsert.
 *   b. Only if DB succeeds: consume cooldown, update in-memory state, broadcast.
 *   c. If DB fails: emit error toast, do NOT consume cooldown, do NOT update memory,
 *      do NOT broadcast.
 *
 * Broadcast payload contains no socketId, playerId, coords, faction, or rank.
 * updatedByName derived from ctx.players (server-authoritative) — never client-provided.
 * Mayor UUID comes from entry.playerId (rpCache) — never client-provided.
 */
export async function handleSetTaxRate(
  socket: Socket,
  ctx:    LicenseContext,
  data:   unknown,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Guard 1: must be Mayor ─────────────────────────────────────────────────
  if (!isMayor(entry)) {
    socket.emit("rp:toast", {
      msg:      "Only the Mayor can change the city tax rate.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 2: not jailed ────────────────────────────────────────────────────
  if (entry.jailUntil && entry.jailUntil > new Date()) {
    socket.emit("rp:toast", {
      msg:      "You cannot do that while jailed.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 3: not cuffed ────────────────────────────────────────────────────
  if (entry.cuffedBy) {
    socket.emit("rp:toast", {
      msg:      "You cannot do that while cuffed.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 4: City Hall proximity ───────────────────────────────────────────
  const playerState = ctx.players.get(socket.id);
  if (!playerState) return;

  const [gx, , gz] = GOVERNMENT_OFFICE_DOOR;
  const dxg = playerState.x - gx;
  const dzg = playerState.z - gz;
  if (Math.sqrt(dxg * dxg + dzg * dzg) > GOVERNMENT_OFFICE_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "Visit City Hall to change the tax rate.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Parse + validate rate ──────────────────────────────────────────────────
  const raw  = data as Record<string, unknown> | null | undefined;
  const rate = typeof raw?.rate === "number" ? raw.rate : NaN;

  if (!Number.isFinite(rate)) {
    socket.emit("rp:toast", {
      msg:      "Invalid tax rate.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  if (rate < CITY_TAX_MIN || rate > CITY_TAX_MAX) {
    socket.emit("rp:toast", {
      msg:      `Tax rate must be between ${(CITY_TAX_MIN * 100).toFixed(0)}% and ${(CITY_TAX_MAX * 100).toFixed(0)}%.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Guard 5: per-mayor cooldown ────────────────────────────────────────────
  // Cooldown is checked BEFORE the DB write — do not consume it yet.
  const cooldownKey = entry.playerId;
  const lastSetTax  = setTaxCooldownMap.get(cooldownKey) ?? 0;
  const nowMs       = Date.now();
  const remainingMs = MAYOR_SET_TAX_COOLDOWN_MS - (nowMs - lastSetTax);
  if (remainingMs > 0) {
    socket.emit("rp:toast", {
      msg:      `Tax rate cooldown. Wait ${Math.ceil(remainingMs / 1000)}s.`,
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  // ── Phase 8C: DB-first persist ────────────────────────────────────────────
  // persistCityTaxRate must succeed before any state mutation or broadcast.
  // entry.playerId is the server-authoritative Mayor UUID from rpCache.
  // Never use a client-provided ID here.
  try {
    await persistCityTaxRate(rate, entry.playerId);
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rpGov] persistCityTaxRate failed");
    socket.emit("rp:toast", {
      msg:      "Tax rate save failed — try again.",
      color:    "red",
      duration: 4000,
    });
    // Do NOT consume cooldown, do NOT update memory, do NOT broadcast.
    return;
  }

  // ── DB succeeded: consume cooldown + update in-memory config ──────────────
  setTaxCooldownMap.set(cooldownKey, nowMs);

  // Derive display name from server-authoritative ctx.players — never client-provided.
  const updatedByName = ctx.players.get(socket.id)?.username ?? "Mayor";

  cityTaxRate          = rate;
  taxRateUpdatedAt     = nowMs;
  taxRateUpdatedByName = updatedByName;

  const pct = (rate * 100).toFixed(1).replace(/\.0$/, "");

  logger.info(
    { socketId: socket.id, updatedByName, rate },
    "[rpGov] city tax rate updated and persisted",
  );

  // Broadcast new config to every connected client (Phase 8D: include cityBudget).
  ctx.io.emit("rp:cityConfig", {
    taxRate:       rate,
    updatedAt:     nowMs,
    updatedByName,
    cityBudget,
  });

  socket.emit("rp:toast", {
    msg:      `City tax rate set to ${pct}%.`,
    color:    "green",
    duration: 4000,
  });
}
