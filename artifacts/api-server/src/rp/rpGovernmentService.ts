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
  GOVERNMENT_OFFICE_POS,
  GOVERNMENT_OFFICE_RADIUS,
  CITY_TAX_MIN,
  CITY_TAX_MAX,
  CITY_TAX_DEFAULT,
  MAYOR_SET_TAX_COOLDOWN_MS,
} from "../socket/cityData";
import { isMayor } from "./rpFactionHelpers";
import { logger } from "../lib/logger";
import { db, rpCityConfig } from "@workspace/db";
import { eq } from "drizzle-orm";

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

  const [gx, , gz] = GOVERNMENT_OFFICE_POS;
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

  const [gx, , gz] = GOVERNMENT_OFFICE_POS;
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
