/**
 * Job Service — Phase 5A: Multi-job foundation + Taxi Driver.
 *
 * Jobs:
 *   city_worker  — on-foot patrol route; 4 checkpoints; flat $120 pay.
 *                  Phase 4 behaviour preserved exactly.
 *   taxi_driver  — vehicle route; 2 checkpoints (pickup → dropoff);
 *                  distance-based pay $80–$180; driver license required.
 *
 * Server-authoritative rules:
 *   - Client sends only intent (job name) and checkpoint index.
 *   - Server assigns pickup/dropoff; client never picks or prices a fare.
 *   - City Worker: validated against player walking position (isInVehicle must be false).
 *   - Taxi Driver: validated against server-authoritative vehicle position;
 *     player must be in a vehicle (isInVehicle === true) at checkpoint time.
 *   - Cash credited only after atomic DB transaction commits.
 *   - Route cooldown (lastPaycheckAt) persisted in DB; survives reconnects.
 *
 * Fix 1 (Phase 4): handleJobCheckpoint final-CP — DB tx FIRST; state/emit after commit.
 * Fix 2 (Phase 4): toggleDuty — DB update awaited BEFORE any in-memory mutation or emit.
 * Fix 3 (Phase 4): city_worker rejects checkpoint if player.isInVehicle === true.
 * Phase 5A: taxi_driver requires player.isInVehicle === true at each checkpoint.
 * Audit fix A (5A): handleTaxiCheckpoint — hard-require server-registered drivenVehicle;
 *   no fallback to player.x/z; reject if no vehicle with driverId===socket.id exists.
 * Audit fix B (5A): toggleDuty clock-out — job slug must match active route; player must
 *   be within the correct depot radius before clock-out is accepted.
 */

import { db, rpPlayers, rpWallets, rpTransactionLog } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Socket, Server } from "socket.io";
import { logger } from "../lib/logger";
import type { RpCacheEntry, JobState } from "./rpCache";
import { rpJobState } from "./rpCache";
import {
  // City Worker
  CITY_WORKER_DEPOT,
  CITY_WORKER_DEPOT_RADIUS,
  CITY_WORKER_CHECKPOINTS,
  JOB_CITY_WORKER_PAY,
  JOB_MIN_CP_INTERVAL_MS,
  JOB_ROUTE_COOLDOWN_MS,
  JOB_CP_ACCEPT_RADIUS,
  // Taxi Driver
  TAXI_DEPOT,
  TAXI_DEPOT_RADIUS,
  TAXI_PICKUPS,
  TAXI_DROPOFFS,
  TAXI_PAY_MIN,
  TAXI_PAY_MAX,
  TAXI_PAY_PER_M,
  TAXI_CP_ACCEPT_RADIUS,
  TAXI_MIN_STAGE_INTERVAL_MS,
  TAXI_ROUTE_COOLDOWN_MS,
} from "../socket/cityData";

// ── Context ────────────────────────────────────────────────────────────────────

/** Minimal player fields the job service needs from the authoritative player map. */
interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** Used to reject/require vehicle presence depending on job mode. */
  isInVehicle: boolean;
}

/** Vehicle state — must match the VehicleState in rpLicenseService / gameServer for Map compatibility. */
interface VehicleState {
  id:       string;
  x:        number;
  y:        number;
  z:        number;
  rotY:     number;
  speed:    number;
  driverId: string | null;
  color:    string;
  variant?: string;
}

export interface JobContext {
  players:  Map<string, PlayerState>;
  vehicles: Map<string, VehicleState>;
  rpCache:  Map<string, RpCacheEntry>;
  io:       Server;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt((ax - bx) ** 2 + (az - bz) ** 2);
}

function dist3d(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
}

/** Build the activeJob payload the client expects in rp:profileUpdate. */
function buildCityWorkerJob(state: JobState) {
  return {
    job:         "city_worker",
    label:       "City Worker",
    mode:        "walk" as const,
    checkpoints: CITY_WORKER_CHECKPOINTS,
    nextCp:      state.nextCp,
    pay:         JOB_CITY_WORKER_PAY,
  };
}

/** Build the taxi activeJob payload — checkpoints are [pickup, dropoff]. */
function buildTaxiJob(state: JobState) {
  if (!state.taxiPickup || !state.taxiDropoff || state.taxiFare === undefined) {
    throw new Error("[rp] buildTaxiJob called without taxi state fields");
  }
  return {
    job:         "taxi_driver",
    label:       "Taxi Driver",
    mode:        "vehicle" as const,
    checkpoints: [state.taxiPickup, state.taxiDropoff] as [number, number, number][],
    nextCp:      state.nextCp,
    pay:         state.taxiFare,
  };
}

/** Pick a random element from an array. */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Calculate a distance-based fare, rounded to nearest $10.
 * Clamped to [TAXI_PAY_MIN, TAXI_PAY_MAX].
 */
function calcFare(
  pickup:  [number, number, number],
  dropoff: [number, number, number],
): number {
  const d = dist3d(pickup[0], pickup[1], pickup[2], dropoff[0], dropoff[1], dropoff[2]);
  const raw = Math.max(TAXI_PAY_MIN, Math.min(TAXI_PAY_MAX, d * TAXI_PAY_PER_M));
  return Math.round(raw / 10) * 10;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Handle `rp:toggleDuty { job }`.
 *
 * Dispatches to job-specific clock-in logic. Clock-out requires:
 *   1. The requested job slug matches the active JobState slug (prevents
 *      rp:toggleDuty { job:"taxi_driver" } from abandoning a city_worker route).
 *   2. Player is within the correct depot radius for that job (server-authoritative
 *      position; a hacked client cannot clock out from anywhere on the map).
 *
 * Fix 2: DB update awaited BEFORE any in-memory state mutation or emit.
 * Audit fix: clock-out now validates job-slug match + depot proximity.
 */
export async function toggleDuty(
  socket: Socket,
  ctx:    JobContext,
  job:    string,
): Promise<void> {
  if (job !== "city_worker" && job !== "taxi_driver") {
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

  // ── Clock-out (job-matched + depot-proximity validated) ───────────────────
  const activeState = rpJobState.get(socket.id);
  if (activeState) {
    // Audit fix 1: job slug must match the currently active route.
    // Prevents rp:toggleDuty { job:"taxi_driver" } from abandoning a city_worker route.
    if (activeState.job !== job) {
      socket.emit("rp:toast", {
        msg:      `You are on duty as ${activeState.job.replace("_", " ")} — go to that depot to clock out.`,
        color:    "yellow",
        duration: 3000,
      });
      return;
    }

    // Audit fix 2: player must be at the correct depot to clock out.
    let atDepot = false;
    if (activeState.job === "city_worker") {
      const dx = player.x - CITY_WORKER_DEPOT[0];
      const dz = player.z - CITY_WORKER_DEPOT[2];
      atDepot = dx * dx + dz * dz <= CITY_WORKER_DEPOT_RADIUS * CITY_WORKER_DEPOT_RADIUS;
    } else if (activeState.job === "taxi_driver") {
      const dx = player.x - TAXI_DEPOT[0];
      const dz = player.z - TAXI_DEPOT[2];
      atDepot = dx * dx + dz * dz <= TAXI_DEPOT_RADIUS * TAXI_DEPOT_RADIUS;
    }

    if (!atDepot) {
      socket.emit("rp:toast", {
        msg:      "You must return to your depot to clock out.",
        color:    "yellow",
        duration: 3000,
      });
      return;
    }

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

    rpJobState.delete(socket.id);
    entry.onDuty     = false;
    entry.currentJob = null;

    socket.emit("rp:profileUpdate", { onDuty: false, currentJob: null, activeJob: null });
    socket.emit("rp:toast", {
      msg:      "Clocked out. Route abandoned — no pay.",
      color:    "yellow",
      duration: 3000,
    });
    logger.info({ socketId: socket.id, job }, "[rp] clocked out");
    return;
  }

  // ── Job-specific clock-in ─────────────────────────────────────────────────
  if (job === "city_worker") {
    await clockInCityWorker(socket, ctx, entry, player);
  } else {
    await clockInTaxi(socket, ctx, entry, player);
  }
}

// ── City Worker clock-in ───────────────────────────────────────────────────────

async function clockInCityWorker(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  player: PlayerState,
): Promise<void> {
  // Depot proximity check
  const distToDepot = dist2d(player.x, player.z, CITY_WORKER_DEPOT[0], CITY_WORKER_DEPOT[2]);
  if (distToDepot > CITY_WORKER_DEPOT_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You must be at the City Worker Depot to clock in.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Cooldown check
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

  // Fix 2: persist first
  try {
    await db
      .update(rpPlayers)
      .set({ onDuty: true, currentJob: "city_worker" })
      .where(eq(rpPlayers.id, entry.playerId));
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rp] clockInCityWorker: DB update failed");
    socket.emit("rp:toast", {
      msg:      "Clock-in failed — try again.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

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
    activeJob:  buildCityWorkerJob(state),
  });
  socket.emit("rp:toast", {
    msg:      `Clocked in as City Worker! Follow the route markers on foot. Pay: $${JOB_CITY_WORKER_PAY}.`,
    color:    "green",
    duration: 5000,
  });
  logger.info({ socketId: socket.id }, "[rp] city_worker clocked in");
}

// ── Taxi Driver clock-in ───────────────────────────────────────────────────────

async function clockInTaxi(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  player: PlayerState,
): Promise<void> {
  // Driver license required
  if (!entry.driverLicense) {
    socket.emit("rp:toast", {
      msg:      "You need a Driver License to work as a Taxi Driver.",
      color:    "yellow",
      duration: 4000,
    });
    return;
  }

  // Must be at Taxi Depot
  const distToDepot = dist2d(player.x, player.z, TAXI_DEPOT[0], TAXI_DEPOT[2]);
  if (distToDepot > TAXI_DEPOT_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You must be at the Taxi Depot to clock in as Taxi Driver.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Cooldown check
  const now = Date.now();
  if (entry.lastPaycheckAt !== null) {
    const elapsed = now - entry.lastPaycheckAt;
    if (elapsed < TAXI_ROUTE_COOLDOWN_MS) {
      const waitSecs = Math.ceil((TAXI_ROUTE_COOLDOWN_MS - elapsed) / 1000);
      socket.emit("rp:toast", {
        msg:      `Route cooldown — wait ${waitSecs}s before starting another route.`,
        color:    "yellow",
        duration: 4000,
      });
      return;
    }
  }

  // Assign pickup + dropoff (server-authoritative; never from client)
  const pickup  = pickRandom(TAXI_PICKUPS);
  const dropoff = pickRandom(TAXI_DROPOFFS);
  const fare    = calcFare(pickup, dropoff);

  // Fix 2: persist first
  try {
    await db
      .update(rpPlayers)
      .set({ onDuty: true, currentJob: "taxi_driver" })
      .where(eq(rpPlayers.id, entry.playerId));
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rp] clockInTaxi: DB update failed");
    socket.emit("rp:toast", {
      msg:      "Clock-in failed — try again.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  const state: JobState = {
    job:         "taxi_driver",
    nextCp:      0,
    startedAt:   now,
    lastCpAt:    0,
    taxiPickup:  pickup,
    taxiDropoff: dropoff,
    taxiFare:    fare,
  };
  rpJobState.set(socket.id, state);
  entry.onDuty     = true;
  entry.currentJob = "taxi_driver";

  socket.emit("rp:profileUpdate", {
    onDuty:     true,
    currentJob: "taxi_driver",
    activeJob:  buildTaxiJob(state),
  });
  socket.emit("rp:toast", {
    msg:      `Taxi shift started! Drive to the pickup marker, then the dropoff. Estimated fare: $${fare}.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, pickup, dropoff, fare }, "[rp] taxi_driver clocked in");
}

// ── Checkpoint handler ─────────────────────────────────────────────────────────

/**
 * Handle `rp:jobCheckpoint { idx }`.
 *
 * Dispatches to city_worker or taxi_driver validation based on the active job.
 */
export async function handleJobCheckpoint(
  socket: Socket,
  ctx:    JobContext,
  idx:    number,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  const state = rpJobState.get(socket.id);
  if (!state) return;

  if (idx !== state.nextCp) return; // wrong order — silently ignore

  const now = Date.now();

  if (state.job === "city_worker") {
    await handleCityWorkerCheckpoint(socket, ctx, entry, state, idx, now);
  } else if (state.job === "taxi_driver") {
    await handleTaxiCheckpoint(socket, ctx, entry, state, idx, now);
  }
}

// ── City Worker checkpoint ─────────────────────────────────────────────────────

async function handleCityWorkerCheckpoint(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  state:  JobState,
  idx:    number,
  now:    number,
): Promise<void> {
  // Anti-farm
  if (state.lastCpAt > 0 && now - state.lastCpAt < JOB_MIN_CP_INTERVAL_MS) {
    socket.emit("rp:toast", {
      msg:      "Too fast — slow down between checkpoints.",
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  const player = ctx.players.get(socket.id);
  if (!player) return;

  // Fix 3: must be on foot
  if (player.isInVehicle) {
    socket.emit("rp:toast", {
      msg:      "City Worker route must be completed on foot.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const [cpx, , cpz] = CITY_WORKER_CHECKPOINTS[idx];
  if (dist2d(player.x, player.z, cpx, cpz) > JOB_CP_ACCEPT_RADIUS) return;

  // ── Checkpoint accepted ──────────────────────────────────────────────────
  state.nextCp  += 1;
  state.lastCpAt = now;

  if (state.nextCp < CITY_WORKER_CHECKPOINTS.length) {
    socket.emit("rp:profileUpdate", { activeJob: buildCityWorkerJob(state) });
    socket.emit("rp:toast", {
      msg:      `Checkpoint ${idx + 1} / ${CITY_WORKER_CHECKPOINTS.length} — keep going!`,
      color:    "blue",
      duration: 2000,
    });
    logger.debug({ socketId: socket.id, nextCp: state.nextCp }, "[rp] city_worker checkpoint hit");
    return;
  }

  // ── Route complete — pay the player ─────────────────────────────────────
  // Fix 1: DB transaction FIRST; mutate state/entry/emit only after commit.
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
        note:      "City Worker route complete",
      });

      await tx
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null, lastPaycheckAt: new Date(now) })
        .where(eq(rpPlayers.id, entry.playerId));
    });
  } catch (err) {
    // Fix 1: roll back nextCp so the final CP is retryable
    state.nextCp  -= 1;
    state.lastCpAt = 0;
    logger.error({ err, socketId: socket.id }, "[rp] handleCityWorkerCheckpoint: payment tx failed");
    socket.emit("rp:toast", {
      msg:      "Payment failed — walk through the final checkpoint again.",
      color:    "red",
      duration: 5000,
    });
    return;
  }

  // DB committed — finalise state
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

// ── Taxi Driver checkpoint ─────────────────────────────────────────────────────

/**
 * idx === 0: player must drive to the pickup location.
 * idx === 1: player must drive to the dropoff location (route complete).
 *
 * Both checkpoints are validated against the SERVER-AUTHORITATIVE vehicle position —
 * never the coordinates the client sends.
 */
async function handleTaxiCheckpoint(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  state:  JobState,
  idx:    number,
  now:    number,
): Promise<void> {
  if (!state.taxiPickup || !state.taxiDropoff || state.taxiFare === undefined) {
    logger.warn({ socketId: socket.id }, "[rp] handleTaxiCheckpoint: missing taxi state — failing route");
    socket.emit("rp:toast", {
      msg:      "Route data lost — clocking you out. Sorry!",
      color:    "red",
      duration: 4000,
    });
    rpJobState.delete(socket.id);
    return;
  }

  // Anti-farm: minimum interval between stages
  if (state.lastCpAt > 0 && now - state.lastCpAt < TAXI_MIN_STAGE_INTERVAL_MS) {
    socket.emit("rp:toast", {
      msg:      "Drive a little longer between stops.",
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  const player = ctx.players.get(socket.id);
  if (!player) return;

  // Fix (5A audit): require a real server-registered driven vehicle.
  // player.isInVehicle alone is client-reported; we must find the actual
  // vehicle record with driverId === socket.id in the server map.
  // If no such vehicle exists, reject hard — do NOT fall back to player position.
  let drivenVehicle: VehicleState | undefined;
  for (const v of ctx.vehicles.values()) {
    if (v.driverId === socket.id) {
      drivenVehicle = v;
      break;
    }
  }
  if (!drivenVehicle) {
    socket.emit("rp:toast", {
      msg:      "You must be driving a vehicle to complete a Taxi route.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Target is pickup (idx=0) or dropoff (idx=1). Use server vehicle position only.
  const target = idx === 0 ? state.taxiPickup : state.taxiDropoff;
  if (dist2d(drivenVehicle.x, drivenVehicle.z, target[0], target[2]) > TAXI_CP_ACCEPT_RADIUS) return;

  // ── Stage accepted ────────────────────────────────────────────────────────
  state.nextCp  += 1;
  state.lastCpAt = now;

  if (idx === 0) {
    // Pickup reached — head to dropoff
    socket.emit("rp:profileUpdate", { activeJob: buildTaxiJob(state) });
    socket.emit("rp:toast", {
      msg:      "Passenger picked up! Drive to the dropoff.",
      color:    "green",
      duration: 3000,
    });
    logger.debug({ socketId: socket.id }, "[rp] taxi pickup reached");
    return;
  }

  // ── Dropoff reached — pay the driver ──────────────────────────────────────
  const fare = state.taxiFare;
  let newCash = entry.cash;
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");
      if (!wallet) throw new Error("no wallet row");

      newCash = wallet.cash + fare;

      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "job_pay",
        cashDelta: fare,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      "Taxi Driver fare",
      });

      await tx
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null, lastPaycheckAt: new Date(now) })
        .where(eq(rpPlayers.id, entry.playerId));
    });
  } catch (err) {
    // Roll back so dropoff is retryable
    state.nextCp  -= 1;
    state.lastCpAt = 0;
    logger.error({ err, socketId: socket.id }, "[rp] handleTaxiCheckpoint: payment tx failed");
    socket.emit("rp:toast", {
      msg:      "Payment failed — drive through the dropoff again.",
      color:    "red",
      duration: 5000,
    });
    return;
  }

  // DB committed — finalise state
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
    msg:      `Fare complete! +$${fare} earned. You can start another route in 60 seconds.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, fare, newCash }, "[rp] taxi_driver fare complete, paid");
}
