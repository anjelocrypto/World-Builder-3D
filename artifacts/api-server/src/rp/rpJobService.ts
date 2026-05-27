/**
 * Job Service — Phase 4: City Worker starter job.
 *
 * Handles:
 *   toggleDuty()          — clock in/out at the depot; validates proximity,
 *                           route cooldown, and updates DB + in-memory cache.
 *   handleJobCheckpoint() — validates idx order, 3 s anti-farm interval,
 *                           server-authoritative proximity; pays on completion
 *                           via an atomic DB transaction.
 *
 * Server-authoritative rules:
 *   - Client sends only intent (job name) and checkpoint index.
 *   - Server validates ALL distances using authoritative player positions.
 *   - Cash is credited only after a full DB transaction commits.
 *   - 60-second cooldown (lastPaycheckAt) survives reconnects (persisted in DB).
 *   - 3-second minimum between consecutive checkpoint hits (anti-farm).
 *
 * Fix 1 (audit): handleJobCheckpoint final-CP path — DB transaction runs FIRST;
 *   rpJobState/entry/emit are only mutated after a successful commit.
 *   On failure the route stays alive and the client retries the last checkpoint.
 *
 * Fix 2 (audit): toggleDuty — DB update is awaited BEFORE any in-memory
 *   mutation or socket emit so a DB failure cannot leave cache/DB out of sync.
 *
 * Fix 3 (audit): handleJobCheckpoint rejects checkpoint hits from players who
 *   are currently in a vehicle (isInVehicle === true on their server state).
 */

import { db, rpPlayers, rpWallets, rpTransactionLog } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Socket, Server } from "socket.io";
import { logger } from "../lib/logger";
import type { RpCacheEntry, JobState } from "./rpCache";
import { rpJobState } from "./rpCache";
import {
  CITY_WORKER_DEPOT,
  CITY_WORKER_DEPOT_RADIUS,
  CITY_WORKER_CHECKPOINTS,
  JOB_CITY_WORKER_PAY,
  JOB_MIN_CP_INTERVAL_MS,
  JOB_ROUTE_COOLDOWN_MS,
  JOB_CP_ACCEPT_RADIUS,
} from "../socket/cityData";

// ── Context ────────────────────────────────────────────────────────────────────

/** Minimal player fields the job service needs from the authoritative player map. */
interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** Fix 3: used to reject checkpoint hits from players currently in a vehicle. */
  isInVehicle: boolean;
}

export interface JobContext {
  players: Map<string, PlayerState>;
  rpCache: Map<string, RpCacheEntry>;
  io:      Server;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt((ax - bx) ** 2 + (az - bz) ** 2);
}

/** Build the activeJob payload the client expects in rp:profileUpdate. */
function buildActiveJob(state: JobState) {
  return {
    job:         state.job,
    checkpoints: CITY_WORKER_CHECKPOINTS,
    nextCp:      state.nextCp,
    pay:         JOB_CITY_WORKER_PAY,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Handle `rp:toggleDuty { job }`.
 *
 * If the player is off-duty: clock them in (start route) after checking:
 *   1. job name is a known slug ("city_worker")
 *   2. player is within CITY_WORKER_DEPOT_RADIUS of the depot
 *   3. 60-second cooldown since last paycheck has elapsed
 *
 * If the player is already on duty with the same job: clock them out.
 * Clocking out mid-route discards progress (no pay).
 *
 * Fix 2: DB update is awaited BEFORE any in-memory state mutation or emit.
 */
export async function toggleDuty(
  socket: Socket,
  ctx:    JobContext,
  job:    string,
): Promise<void> {
  if (job !== "city_worker") {
    socket.emit("rp:toast", {
      msg:      "Unknown job.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  const player = ctx.players.get(socket.id);
  if (!player) return;

  // Depot proximity check (server-authoritative player position)
  const distToDepot = dist2d(player.x, player.z, CITY_WORKER_DEPOT[0], CITY_WORKER_DEPOT[2]);
  if (distToDepot > CITY_WORKER_DEPOT_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You must be at the City Worker Depot to clock in/out.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const alreadyOnDuty = rpJobState.has(socket.id);

  if (alreadyOnDuty) {
    // ── Clock out (route abandoned) ───────────────────────────────────────
    // Fix 2: persist to DB first; only mutate cache + emit on success.
    try {
      await db
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null })
        .where(eq(rpPlayers.id, entry.playerId));
    } catch (err) {
      logger.error({ err, socketId: socket.id }, "[rp] toggleDuty: DB update failed on clock-out");
      socket.emit("rp:toast", {
        msg:      "Clock-out failed — try again.",
        color:    "red",
        duration: 3000,
      });
      return;
    }

    // DB committed — now mutate in-memory state and notify client.
    rpJobState.delete(socket.id);
    entry.onDuty     = false;
    entry.currentJob = null;

    socket.emit("rp:profileUpdate", { onDuty: false, currentJob: null, activeJob: null });
    socket.emit("rp:toast", {
      msg:      "Clocked out. Route abandoned — no pay.",
      color:    "yellow",
      duration: 3000,
    });
    logger.info({ socketId: socket.id }, "[rp] city_worker clocked out");
    return;
  }

  // ── Cooldown check ────────────────────────────────────────────────────────
  const now = Date.now();
  if (entry.lastPaycheckAt !== null) {
    const elapsed = now - entry.lastPaycheckAt;
    if (elapsed < JOB_ROUTE_COOLDOWN_MS) {
      const waitSecs = Math.ceil((JOB_ROUTE_COOLDOWN_MS - elapsed) / 1000);
      socket.emit("rp:toast", {
        msg:      `Route cooldown — wait ${waitSecs}s before starting another route.`,
        color:    "yellow",
        duration: 4000,
      });
      return;
    }
  }

  // ── Clock in (start route) ────────────────────────────────────────────────
  // Fix 2: persist to DB first; only set rpJobState + emit on success.
  try {
    await db
      .update(rpPlayers)
      .set({ onDuty: true, currentJob: "city_worker" })
      .where(eq(rpPlayers.id, entry.playerId));
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rp] toggleDuty: DB update failed on clock-in");
    socket.emit("rp:toast", {
      msg:      "Clock-in failed — try again.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // DB committed — now create in-memory route state and notify client.
  const state: JobState = {
    job:       "city_worker",
    nextCp:    0,
    startedAt: now,
    lastCpAt:  0,
  };
  rpJobState.set(socket.id, state);
  entry.onDuty     = true;
  entry.currentJob = "city_worker";

  socket.emit("rp:profileUpdate", {
    onDuty:     true,
    currentJob: "city_worker",
    activeJob:  buildActiveJob(state),
  });
  socket.emit("rp:toast", {
    msg:      `Clocked in as City Worker! Follow the route markers. Pay: $${JOB_CITY_WORKER_PAY}.`,
    color:    "green",
    duration: 5000,
  });
  logger.info({ socketId: socket.id }, "[rp] city_worker clocked in");
}

/**
 * Handle `rp:jobCheckpoint { idx }`.
 *
 * Validates (in order):
 *   1. Player is on duty (rpJobState has an entry)
 *   2. idx matches the expected next checkpoint (nextCp)
 *   3. Anti-farm: at least JOB_MIN_CP_INTERVAL_MS since the previous hit
 *   4. Server-authoritative proximity
 *   5. Fix 3: player must not be in a vehicle
 *
 * On route completion (Fix 1):
 *   - Run the DB transaction first (wallet + log + rpPlayers).
 *   - Only after commit: delete rpJobState, update entry, emit success.
 *   - On DB failure: leave route active; emit a retry toast (client retries ~1 s).
 */
export async function handleJobCheckpoint(
  socket: Socket,
  ctx:    JobContext,
  idx:    number,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  const state = rpJobState.get(socket.id);
  if (!state) {
    // Not on duty — silently ignore (client may have stale state after reconnect)
    return;
  }

  // Wrong order — silently ignore (client retries when in range)
  if (idx !== state.nextCp) return;

  const now = Date.now();

  // Anti-farm: minimum interval between checkpoints
  if (state.lastCpAt > 0 && now - state.lastCpAt < JOB_MIN_CP_INTERVAL_MS) {
    socket.emit("rp:toast", {
      msg:      "Too fast — slow down between checkpoints.",
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  // Server-authoritative proximity check — never trust client coordinates
  const player = ctx.players.get(socket.id);
  if (!player) return;

  // Fix 3: City Worker route must be completed on foot.
  if (player.isInVehicle) {
    socket.emit("rp:toast", {
      msg:      "City Worker route must be completed on foot.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const [cpx, , cpz] = CITY_WORKER_CHECKPOINTS[idx];
  if (dist2d(player.x, player.z, cpx, cpz) > JOB_CP_ACCEPT_RADIUS) {
    // Out of range — silently ignore; client will retry on next proximity tick
    return;
  }

  // ── Checkpoint accepted ───────────────────────────────────────────────────
  state.nextCp  += 1;
  state.lastCpAt = now;

  if (state.nextCp < CITY_WORKER_CHECKPOINTS.length) {
    // Route still in progress — update client HUD and continue.
    socket.emit("rp:profileUpdate", { activeJob: buildActiveJob(state) });
    socket.emit("rp:toast", {
      msg:      `Checkpoint ${idx + 1} / ${CITY_WORKER_CHECKPOINTS.length} — keep going!`,
      color:    "blue",
      duration: 2000,
    });
    logger.debug({ socketId: socket.id, nextCp: state.nextCp }, "[rp] city_worker checkpoint hit");
    return;
  }

  // ── Route complete — pay the player ───────────────────────────────────────
  // Fix 1: run the DB transaction FIRST. Do not mutate rpJobState or entry
  // until the commit succeeds. On failure the route stays alive; the client
  // retries the final checkpoint every ~1 s.
  let newCash = entry.cash;
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");

      if (!wallet) throw new Error("no wallet row");

      newCash = wallet.cash + JOB_CITY_WORKER_PAY;

      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "job_pay",
        cashDelta: JOB_CITY_WORKER_PAY,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      `City Worker route complete`,
      });

      await tx
        .update(rpPlayers)
        .set({
          onDuty:         false,
          currentJob:     null,
          lastPaycheckAt: new Date(now),
        })
        .where(eq(rpPlayers.id, entry.playerId));
    });
  } catch (err) {
    // Fix 1: DB failed — roll back state.nextCp so the final CP is retryable.
    state.nextCp  -= 1;
    state.lastCpAt = 0; // reset anti-farm timer so retry isn't blocked
    logger.error({ err, socketId: socket.id }, "[rp] handleJobCheckpoint: payment transaction failed");
    socket.emit("rp:toast", {
      msg:      "Payment failed — walk through the final checkpoint again.",
      color:    "red",
      duration: 5000,
    });
    return;
  }

  // DB committed — now finalize in-memory state and notify client.
  rpJobState.delete(socket.id);
  entry.cash           = newCash;
  entry.onDuty         = false;
  entry.currentJob     = null;
  entry.lastPaycheckAt = now;

  socket.emit("rp:profileUpdate", {
    cash:       newCash,
    onDuty:     false,
    currentJob: null,
    activeJob:  null,
  });
  socket.emit("rp:toast", {
    msg:      `Route complete! +$${JOB_CITY_WORKER_PAY} earned. You can start another route in 60 seconds.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, pay: JOB_CITY_WORKER_PAY, newCash }, "[rp] city_worker route complete, paid");
}
