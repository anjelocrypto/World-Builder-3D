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
 * Phase 5B: delivery_driver — 3-stage vehicle route (pickup + 2-3 ordered dropoffs);
 *   driver license required; same server-authority rules as taxi; DB-first payment.
 * Phase 5C: mechanic — 2-stage vehicle route (drive to broken car → repair 8 s);
 *   driver license required; server-timed repair; DB-first payment; retryable on failure.
 * Phase 5D: medic — 3-stage vehicle route (respond → treat 6 s → transport to ER);
 *   driver license required; server-timed treatment; distance-based pay $220–$360;
 *   DB-first payment at ER bay; retryable on failure.
 * Phase 5E: police_patrol — 4-point perimeter patrol; vehicle required; driver license
 *   required; server samples 4 checkpoints without replacement from 6 fixed patrol
 *   points; distance-based pay $180–$300; DB-first payment at final patrol point;
 *   retryable on failure.
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
  // Delivery Driver
  DELIVERY_HUB,
  DELIVERY_HUB_RADIUS,
  DELIVERY_PICKUPS,
  DELIVERY_DROPOFFS,
  DELIVERY_PAY_MIN,
  DELIVERY_PAY_MAX,
  DELIVERY_PAY_PER_M,
  DELIVERY_CP_ACCEPT_RADIUS,
  DELIVERY_MIN_STAGE_INTERVAL_MS,
  DELIVERY_ROUTE_COOLDOWN_MS,
  // Mechanic
  MECHANIC_GARAGE,
  MECHANIC_GARAGE_RADIUS,
  MECHANIC_TARGETS,
  MECHANIC_SERVICE_RADIUS,
  MECHANIC_REPAIR_DURATION_MS,
  MECHANIC_PAY,
  MECHANIC_ROUTE_COOLDOWN_MS,
  // Medic
  MEDIC_CENTER,
  MEDIC_CENTER_RADIUS,
  MEDIC_PATIENT_CALLS,
  MEDIC_ER_BAY,
  MEDIC_SERVICE_RADIUS,
  MEDIC_TREATMENT_DURATION_MS,
  MEDIC_PAY_MIN,
  MEDIC_PAY_MAX,
  MEDIC_PAY_PER_M,
  MEDIC_ROUTE_COOLDOWN_MS,
  // Police Patrol
  POLICE_STATION,
  POLICE_STATION_RADIUS,
  POLICE_PATROL_POINTS,
  POLICE_PATROL_ACCEPT_RADIUS,
  POLICE_PATROL_PAY_MIN,
  POLICE_PATROL_PAY_MAX,
  POLICE_PATROL_PAY_PER_M,
  POLICE_PATROL_MIN_STAGE_INTERVAL_MS,
  POLICE_PATROL_ROUTE_COOLDOWN_MS,
} from "../socket/cityData";
import { isPolice, isMedic } from "./rpFactionHelpers";
import { applyCityTax, addTaxRevenueTx, setCityBudgetInMemory } from "./rpGovernmentService";

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

/** Build the delivery activeJob payload. checkpoints = [pickup, ...dropoffs]. */
function buildDeliveryJob(state: JobState) {
  if (!state.deliveryPickup || !state.deliveryDropoffs || state.deliveryPay === undefined) {
    throw new Error("[rp] buildDeliveryJob called without delivery state fields");
  }
  return {
    job:         "delivery_driver",
    label:       "Delivery Driver",
    mode:        "vehicle" as const,
    checkpoints: [state.deliveryPickup, ...state.deliveryDropoffs] as [number, number, number][],
    nextCp:      state.nextCp,
    pay:         state.deliveryPay,
  };
}

/**
 * Sample `count` unique items from `arr` without replacement.
 * If count >= arr.length, returns a shuffled copy of the whole array.
 */
function sampleWithoutReplacement<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < Math.min(count, copy.length); i++) {
    const idx = Math.floor(Math.random() * (copy.length - i));
    out.push(copy[idx]);
    copy[idx] = copy[copy.length - 1 - i];
  }
  return out;
}

/**
 * Calculate delivery pay: sum of consecutive segment distances across the full
 * route (hub → pickup → drop1 → … → dropN), clamped and rounded to nearest $10.
 */
function calcDeliveryPay(
  hub:     [number, number, number],
  pickup:  [number, number, number],
  dropoffs: [number, number, number][],
): number {
  let total = dist3d(hub[0], hub[1], hub[2], pickup[0], pickup[1], pickup[2]);
  let prev  = pickup;
  for (const d of dropoffs) {
    total += dist3d(prev[0], prev[1], prev[2], d[0], d[1], d[2]);
    prev   = d;
  }
  const raw = Math.max(DELIVERY_PAY_MIN, Math.min(DELIVERY_PAY_MAX, total * DELIVERY_PAY_PER_M));
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
  if (job !== "city_worker" && job !== "taxi_driver" && job !== "delivery_driver" && job !== "mechanic" && job !== "medic" && job !== "police_patrol") {
    socket.emit("rp:toast", {
      msg:      "Unknown job.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // Phase 6D: jailed players cannot start or switch jobs.
  if (entry.jailUntil !== null) {
    socket.emit("rp:toast", {
      msg:      "You cannot work while in jail.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

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
    } else if (activeState.job === "delivery_driver") {
      const dx = player.x - DELIVERY_HUB[0];
      const dz = player.z - DELIVERY_HUB[2];
      atDepot = dx * dx + dz * dz <= DELIVERY_HUB_RADIUS * DELIVERY_HUB_RADIUS;
    } else if (activeState.job === "mechanic") {
      const dx = player.x - MECHANIC_GARAGE[0];
      const dz = player.z - MECHANIC_GARAGE[2];
      atDepot = dx * dx + dz * dz <= MECHANIC_GARAGE_RADIUS * MECHANIC_GARAGE_RADIUS;
    } else if (activeState.job === "medic") {
      const dx = player.x - MEDIC_CENTER[0];
      const dz = player.z - MEDIC_CENTER[2];
      atDepot = dx * dx + dz * dz <= MEDIC_CENTER_RADIUS * MEDIC_CENTER_RADIUS;
    } else if (activeState.job === "police_patrol") {
      const dx = player.x - POLICE_STATION[0];
      const dz = player.z - POLICE_STATION[2];
      atDepot = dx * dx + dz * dz <= POLICE_STATION_RADIUS * POLICE_STATION_RADIUS;
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
  } else if (job === "taxi_driver") {
    await clockInTaxi(socket, ctx, entry, player);
  } else if (job === "delivery_driver") {
    await clockInDelivery(socket, ctx, entry, player);
  } else if (job === "mechanic") {
    await clockInMechanic(socket, ctx, entry, player);
  } else if (job === "medic") {
    await clockInMedic(socket, ctx, entry, player);
  } else {
    await clockInPolicePatrol(socket, ctx, entry, player);
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

  // Phase 6D: jailed players cannot complete job checkpoints.
  if (entry.jailUntil !== null) return;

  const state = rpJobState.get(socket.id);
  if (!state) return;

  if (idx !== state.nextCp) return; // wrong order — silently ignore

  const now = Date.now();

  if (state.job === "city_worker") {
    await handleCityWorkerCheckpoint(socket, ctx, entry, state, idx, now);
  } else if (state.job === "taxi_driver") {
    await handleTaxiCheckpoint(socket, ctx, entry, state, idx, now);
  } else if (state.job === "delivery_driver") {
    await handleDeliveryCheckpoint(socket, ctx, entry, state, idx, now);
  } else if (state.job === "mechanic") {
    await handleMechanicCheckpoint(socket, ctx, entry, state, idx, now);
  } else if (state.job === "medic") {
    await handleMedicCheckpoint(socket, ctx, entry, state, idx, now);
  } else if (state.job === "police_patrol") {
    await handlePolicePatrolCheckpoint(socket, ctx, entry, state, idx, now);
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
  const { grossPay: cwGross, taxRate: cwRate, taxAmount: cwTax, netPay: cwNet } =
    applyCityTax(JOB_CITY_WORKER_PAY);
  let newCash   = entry.cash;
  let newBudget = 0; // Phase 8D: updated inside tx if tax > 0
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");
      if (!wallet) throw new Error("no wallet row");

      newCash = wallet.cash + cwNet;

      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "job_pay",
        cashDelta: cwNet,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      `City Worker route complete — gross=${cwGross} tax=${cwTax} net=${cwNet} rate=${cwRate}`,
      });

      await tx
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null, lastPaycheckAt: new Date(now) })
        .where(eq(rpPlayers.id, entry.playerId));

      // Phase 8D: accumulate tax revenue into city budget atomically.
      if (cwTax > 0) newBudget = await addTaxRevenueTx(tx, cwTax);
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
  if (cwTax > 0) setCityBudgetInMemory(newBudget); // Phase 8D
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
  const cwTaxNote = cwTax > 0 ? ` (−$${cwTax} tax)` : "";
  socket.emit("rp:toast", {
    msg:      `Route complete! +$${cwNet}${cwTaxNote} earned. You can start another route in 60 seconds.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, grossPay: cwGross, taxAmount: cwTax, netPay: cwNet, newCash }, "[rp] city_worker route complete, paid");
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
  const { grossPay: taxiGross, taxRate: taxiRate, taxAmount: taxiTax, netPay: taxiNet } =
    applyCityTax(state.taxiFare);
  let newCash   = entry.cash;
  let newBudget = 0;
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");
      if (!wallet) throw new Error("no wallet row");

      newCash = wallet.cash + taxiNet;

      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "job_pay",
        cashDelta: taxiNet,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      `Taxi Driver fare — gross=${taxiGross} tax=${taxiTax} net=${taxiNet} rate=${taxiRate}`,
      });

      await tx
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null, lastPaycheckAt: new Date(now) })
        .where(eq(rpPlayers.id, entry.playerId));

      if (taxiTax > 0) newBudget = await addTaxRevenueTx(tx, taxiTax);
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
  if (taxiTax > 0) setCityBudgetInMemory(newBudget);
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
  const taxiTaxNote = taxiTax > 0 ? ` (−$${taxiTax} tax)` : "";
  socket.emit("rp:toast", {
    msg:      `Fare complete! +$${taxiNet}${taxiTaxNote} earned. You can start another route in 60 seconds.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, grossPay: taxiGross, taxAmount: taxiTax, netPay: taxiNet, newCash }, "[rp] taxi_driver fare complete, paid");
}

// ── Delivery Driver clock-in ───────────────────────────────────────────────────

async function clockInDelivery(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  player: PlayerState,
): Promise<void> {
  // Driver license required
  if (!entry.driverLicense) {
    socket.emit("rp:toast", {
      msg:      "You need a Driver License to work as a Delivery Driver.",
      color:    "yellow",
      duration: 4000,
    });
    return;
  }

  // Must be at Delivery Hub
  const dx = player.x - DELIVERY_HUB[0];
  const dz = player.z - DELIVERY_HUB[2];
  if (dx * dx + dz * dz > DELIVERY_HUB_RADIUS * DELIVERY_HUB_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You must be at the Delivery Hub to clock in.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Cooldown check
  const now = Date.now();
  if (entry.lastPaycheckAt !== null) {
    const elapsed = now - entry.lastPaycheckAt;
    if (elapsed < DELIVERY_ROUTE_COOLDOWN_MS) {
      const waitSecs = Math.ceil((DELIVERY_ROUTE_COOLDOWN_MS - elapsed) / 1000);
      socket.emit("rp:toast", {
        msg:      `Route cooldown — wait ${waitSecs}s before starting another route.`,
        color:    "yellow",
        duration: 4000,
      });
      return;
    }
  }

  // Assign route (server-authoritative — client never sees or chooses these)
  const pickup   = pickRandom(DELIVERY_PICKUPS);
  // 2 or 3 stops, sampled without replacement from DELIVERY_DROPOFFS
  const numStops = Math.random() < 0.5 ? 2 : 3;
  const dropoffs = sampleWithoutReplacement(DELIVERY_DROPOFFS, numStops);
  const pay      = calcDeliveryPay(DELIVERY_HUB, pickup, dropoffs);

  // DB-first (Fix 2 pattern)
  try {
    await db
      .update(rpPlayers)
      .set({ onDuty: true, currentJob: "delivery_driver" })
      .where(eq(rpPlayers.id, entry.playerId));
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rp] clockInDelivery: DB update failed");
    socket.emit("rp:toast", {
      msg:      "Clock-in failed — try again.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  const state: JobState = {
    job:              "delivery_driver",
    nextCp:           0,
    startedAt:        now,
    lastCpAt:         0,
    deliveryPickup:   pickup,
    deliveryDropoffs: dropoffs,
    deliveryPay:      pay,
  };
  rpJobState.set(socket.id, state);
  entry.onDuty     = true;
  entry.currentJob = "delivery_driver";

  socket.emit("rp:profileUpdate", {
    onDuty:     true,
    currentJob: "delivery_driver",
    activeJob:  buildDeliveryJob(state),
  });
  socket.emit("rp:toast", {
    msg:      `Delivery shift started! Drive to the loading bay, then make ${numStops} deliveries. Pay: $${pay}.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, pickup, numStops, pay }, "[rp] delivery_driver clocked in");
}

// ── Delivery Driver checkpoint ─────────────────────────────────────────────────

/**
 * idx === 0:          drive to pickup/loading bay.
 * idx === 1..N:       drive to deliveryDropoffs[idx-1] in order.
 * Final idx === N:    route complete — pay atomically then clear state.
 *
 * Server-authoritative: uses drivenVehicle.x/z only (no player.x/z fallback).
 */
async function handleDeliveryCheckpoint(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  state:  JobState,
  idx:    number,
  now:    number,
): Promise<void> {
  if (
    !state.deliveryPickup ||
    !state.deliveryDropoffs ||
    state.deliveryPay === undefined
  ) {
    logger.warn({ socketId: socket.id }, "[rp] handleDeliveryCheckpoint: missing delivery state");
    socket.emit("rp:toast", {
      msg:      "Route data lost — clocking you out. Sorry!",
      color:    "red",
      duration: 4000,
    });
    rpJobState.delete(socket.id);
    return;
  }

  // Anti-farm: minimum interval between stages
  if (state.lastCpAt > 0 && now - state.lastCpAt < DELIVERY_MIN_STAGE_INTERVAL_MS) {
    socket.emit("rp:toast", {
      msg:      "Drive a little further between stops.",
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  // Require a real server-registered driven vehicle (no player.x/z fallback)
  let drivenVehicle: VehicleState | undefined;
  for (const v of ctx.vehicles.values()) {
    if (v.driverId === socket.id) {
      drivenVehicle = v;
      break;
    }
  }
  if (!drivenVehicle) {
    socket.emit("rp:toast", {
      msg:      "You must be driving a vehicle to complete a Delivery route.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Determine target: idx=0 → pickup; idx>=1 → dropoffs[idx-1]
  const target: [number, number, number] =
    idx === 0 ? state.deliveryPickup : state.deliveryDropoffs[idx - 1];

  if (dist2d(drivenVehicle.x, drivenVehicle.z, target[0], target[2]) > DELIVERY_CP_ACCEPT_RADIUS) return;

  // ── Stage accepted ────────────────────────────────────────────────────────
  state.nextCp  += 1;
  state.lastCpAt = now;

  const totalStages = 1 + state.deliveryDropoffs.length; // pickup + N dropoffs
  const isFinal     = idx === totalStages - 1;

  if (!isFinal) {
    const remaining = totalStages - state.nextCp;
    const stageLabel = idx === 0
      ? "Loaded up! Drive to your first delivery stop."
      : `Delivery ${idx} done! ${remaining} stop${remaining !== 1 ? "s" : ""} remaining.`;

    socket.emit("rp:profileUpdate", { activeJob: buildDeliveryJob(state) });
    socket.emit("rp:toast", {
      msg:      stageLabel,
      color:    "green",
      duration: 3000,
    });
    logger.debug({ socketId: socket.id, idx, nextCp: state.nextCp }, "[rp] delivery stage accepted");
    return;
  }

  // ── Final stop — pay atomically ───────────────────────────────────────────
  const { grossPay: delGross, taxRate: delRate, taxAmount: delTax, netPay: delNet } =
    applyCityTax(state.deliveryPay!);
  let newCash   = entry.cash;
  let newBudget = 0;
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");
      if (!wallet) throw new Error("no wallet row");

      newCash = wallet.cash + delNet;

      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "job_pay",
        cashDelta: delNet,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      `Delivery Driver route complete (${state.deliveryDropoffs?.length ?? 0} stops) — gross=${delGross} tax=${delTax} net=${delNet} rate=${delRate}`,
      });

      await tx
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null, lastPaycheckAt: new Date(now) })
        .where(eq(rpPlayers.id, entry.playerId));

      if (delTax > 0) newBudget = await addTaxRevenueTx(tx, delTax);
    });
  } catch (err) {
    // DB failed — roll back so final stop is retryable
    state.nextCp  -= 1;
    state.lastCpAt = 0;
    logger.error({ err, socketId: socket.id }, "[rp] handleDeliveryCheckpoint: payment tx failed");
    socket.emit("rp:toast", {
      msg:      "Payment failed — drive through the final stop again.",
      color:    "red",
      duration: 5000,
    });
    return;
  }

  // DB committed — finalise state
  if (delTax > 0) setCityBudgetInMemory(newBudget);
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
  const delTaxNote = delTax > 0 ? ` (−$${delTax} tax)` : "";
  socket.emit("rp:toast", {
    msg:      `All deliveries complete! +$${delNet}${delTaxNote} earned. You can start another route in 60 seconds.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, grossPay: delGross, taxAmount: delTax, netPay: delNet, newCash }, "[rp] delivery_driver route complete, paid");
}

// ── Mechanic helpers ───────────────────────────────────────────────────────────

/**
 * Builds the activeJob payload sent to the client for the mechanic job.
 *
 * The checkpoint list is [mechanicTarget, mechanicTarget] — two identical
 * positions. This lets the standard client detection loop fire naturally for
 * both stages without any special-casing in LocalPlayer:
 *   idx 0 = "drive to the broken vehicle" (nextCp === 0)
 *   idx 1 = "repair in progress / done"   (nextCp === 1, client retries each second)
 */
function buildMechanicJob(state: JobState): Record<string, unknown> {
  return {
    job:            "mechanic",
    label:          "Mechanic",
    mode:           "vehicle" as const,
    checkpoints:    [state.mechanicTarget!, state.mechanicTarget!] as [number, number, number][],
    nextCp:         state.nextCp,
    pay:            state.mechanicPay!,
    repairStartedAt: state.mechanicRepairStartedAt ?? null,
  };
}

// ── Mechanic clock-in ──────────────────────────────────────────────────────────

async function clockInMechanic(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  player: PlayerState,
): Promise<void> {
  // Requires driver license
  if (!entry.driverLicense) {
    socket.emit("rp:toast", {
      msg:      "A driver license is required to work as a mechanic.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Must be at Mechanic Garage
  const dx = player.x - MECHANIC_GARAGE[0];
  const dz = player.z - MECHANIC_GARAGE[2];
  if (dx * dx + dz * dz > MECHANIC_GARAGE_RADIUS * MECHANIC_GARAGE_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You must be at the Mechanic Garage to clock in.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Cooldown check — uses shared lastPaycheckAt
  const now = Date.now();
  if (entry.lastPaycheckAt !== null) {
    const elapsed = now - entry.lastPaycheckAt;
    if (elapsed < MECHANIC_ROUTE_COOLDOWN_MS) {
      const waitSecs = Math.ceil((MECHANIC_ROUTE_COOLDOWN_MS - elapsed) / 1000);
      socket.emit("rp:toast", {
        msg:      `Service cooldown — wait ${waitSecs}s before taking another call.`,
        color:    "yellow",
        duration: 4000,
      });
      return;
    }
  }

  // Server assigns a random target (client never chooses)
  const target = pickRandom(MECHANIC_TARGETS);
  const pay    = MECHANIC_PAY;

  // DB-first (Fix 2 pattern)
  try {
    await db
      .update(rpPlayers)
      .set({ onDuty: true, currentJob: "mechanic" })
      .where(eq(rpPlayers.id, entry.playerId));
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rp] clockInMechanic: DB update failed");
    socket.emit("rp:toast", {
      msg:      "Clock-in failed — try again.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  const state: JobState = {
    job:           "mechanic",
    nextCp:        0,
    startedAt:     now,
    lastCpAt:      0,
    mechanicTarget: target,
    mechanicPay:    pay,
  };
  rpJobState.set(socket.id, state);
  entry.onDuty     = true;
  entry.currentJob = "mechanic";

  socket.emit("rp:profileUpdate", {
    onDuty:     true,
    currentJob: "mechanic",
    activeJob:  buildMechanicJob(state),
  });
  socket.emit("rp:toast", {
    msg:      `Service call dispatched! Drive to the broken vehicle. Pay: $${pay}.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, target, pay }, "[rp] mechanic clocked in");
}

// ── Mechanic checkpoint ────────────────────────────────────────────────────────

/**
 * idx === 0:  player arrived at the broken vehicle — starts the repair timer.
 * idx === 1:  repair timer elapsed — pay atomically, clear state.
 *             Client retries idx=1 every second until the timer passes.
 *             On DB failure for idx=1, just return without touching state so
 *             the client retries next second with the timer still elapsed.
 *
 * Server-authoritative: uses drivenVehicle.x/z only (no player.x/z fallback).
 */
async function handleMechanicCheckpoint(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  state:  JobState,
  idx:    number,
  now:    number,
): Promise<void> {
  if (!state.mechanicTarget || state.mechanicPay === undefined) {
    logger.warn({ socketId: socket.id }, "[rp] handleMechanicCheckpoint: missing mechanic state");
    socket.emit("rp:toast", {
      msg:      "Service route error — please clock out and try again.",
      color:    "red",
      duration: 5000,
    });
    return;
  }

  // Reject wrong idx
  if (idx !== state.nextCp) {
    logger.debug(
      { socketId: socket.id, idx, nextCp: state.nextCp },
      "[rp] mechanic checkpoint out of order — ignored",
    );
    return;
  }

  // Require player to be in a vehicle (drivenVehicle only — no player.x/z fallback)
  const drivenVehicle = [...ctx.vehicles.values()].find(v => v.driverId === socket.id);
  if (!drivenVehicle) {
    socket.emit("rp:toast", {
      msg:      "You must be driving to reach the service call.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const [tx, , tz] = state.mechanicTarget;
  const vx = drivenVehicle.x;
  const vz = drivenVehicle.z;
  const distSq = (vx - tx) * (vx - tx) + (vz - tz) * (vz - tz);
  const radiusSq = MECHANIC_SERVICE_RADIUS * MECHANIC_SERVICE_RADIUS;

  // ── idx === 0: arrival at broken vehicle ─────────────────────────────────────
  if (idx === 0) {
    if (distSq > radiusSq) {
      return; // not close enough yet — client retries each second
    }

    // Advance state — set repair start time
    state.nextCp               = 1;
    state.lastCpAt             = now;
    state.mechanicRepairStartedAt = now;

    socket.emit("rp:profileUpdate", { activeJob: buildMechanicJob(state) });
    socket.emit("rp:toast", {
      msg:      "Repairing vehicle… stay nearby for 8 seconds.",
      color:    "cyan",
      duration: 4000,
    });
    logger.debug({ socketId: socket.id }, "[rp] mechanic arrived at target, repair started");
    return;
  }

  // ── idx === 1: repair timer check ─────────────────────────────────────────────
  if (!state.mechanicRepairStartedAt) {
    logger.warn({ socketId: socket.id }, "[rp] handleMechanicCheckpoint: idx=1 but no repairStartedAt");
    return;
  }

  // Still within service radius?
  if (distSq > radiusSq) {
    socket.emit("rp:toast", {
      msg:      "You moved too far — stay near the broken vehicle!",
      color:    "yellow",
      duration: 3000,
    });
    // Reset repair timer — player must start repair again
    state.mechanicRepairStartedAt = undefined;
    state.nextCp                  = 0;
    state.lastCpAt                = 0;
    socket.emit("rp:profileUpdate", { activeJob: buildMechanicJob(state) });
    return;
  }

  // Timer still running?
  if (now - state.mechanicRepairStartedAt < MECHANIC_REPAIR_DURATION_MS) {
    return; // client retries next second
  }

  // ── Timer elapsed — pay atomically ───────────────────────────────────────────
  const { grossPay: mechGross, taxRate: mechRate, taxAmount: mechTax, netPay: mechNet } =
    applyCityTax(state.mechanicPay!);
  let newCash   = entry.cash;
  let newBudget = 0;
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");
      if (!wallet) throw new Error("no wallet row");

      newCash = wallet.cash + mechNet;

      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "job_pay",
        cashDelta: mechNet,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      `Mechanic service call complete — gross=${mechGross} tax=${mechTax} net=${mechNet} rate=${mechRate}`,
      });

      await tx
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null, lastPaycheckAt: new Date(now) })
        .where(eq(rpPlayers.id, entry.playerId));

      if (mechTax > 0) newBudget = await addTaxRevenueTx(tx, mechTax);
    });
  } catch (err) {
    // DB failed — leave state untouched; client retries idx=1 next second
    logger.error({ err, socketId: socket.id }, "[rp] handleMechanicCheckpoint: payment tx failed");
    socket.emit("rp:toast", {
      msg:      "Payment failed — repair accepted, retrying…",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // DB committed — finalise state
  if (mechTax > 0) setCityBudgetInMemory(newBudget);
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
  const mechTaxNote = mechTax > 0 ? ` (−$${mechTax} tax)` : "";
  socket.emit("rp:toast", {
    msg:      `Repair complete! +$${mechNet}${mechTaxNote} earned. Another call in 60 seconds.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, grossPay: mechGross, taxAmount: mechTax, netPay: mechNet, newCash }, "[rp] mechanic service call complete, paid");
}

// ── Medic helpers ──────────────────────────────────────────────────────────────

/**
 * Distance-based pay formula: clamp(dist * MEDIC_PAY_PER_M, MIN, MAX), rounded
 * to nearest $10.
 * dist = MEDIC_CENTER → patient call + patient call → MEDIC_ER_BAY.
 */
function calcMedicPay(patient: [number, number, number]): number {
  const d1 = Math.sqrt(
    (patient[0] - MEDIC_CENTER[0]) ** 2 + (patient[2] - MEDIC_CENTER[2]) ** 2,
  );
  const d2 = Math.sqrt(
    (MEDIC_ER_BAY[0] - patient[0]) ** 2 + (MEDIC_ER_BAY[2] - patient[2]) ** 2,
  );
  const raw = (d1 + d2) * MEDIC_PAY_PER_M;
  return Math.round(Math.max(MEDIC_PAY_MIN, Math.min(MEDIC_PAY_MAX, raw)) / 10) * 10;
}

/**
 * Builds the activeJob payload for the medic job.
 *
 * Checkpoint layout:
 *   [0] patient call position — RESPOND stage
 *   [1] patient call position — TREAT  stage (same location, separate CP)
 *   [2] MEDIC_ER_BAY          — TRANSPORT stage
 */
function buildMedicJob(state: JobState): Record<string, unknown> {
  return {
    job:                 "medic",
    label:               "Paramedic",
    mode:                "vehicle" as const,
    checkpoints:         [state.medicTarget!, state.medicTarget!, MEDIC_ER_BAY] as [number, number, number][],
    nextCp:              state.nextCp,
    pay:                 state.medicPay!,
    treatmentStartedAt: state.medicTreatmentStartedAt ?? null,
  };
}

// ── Medic clock-in ─────────────────────────────────────────────────────────────

async function clockInMedic(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  player: PlayerState,
): Promise<void> {
  // Phase 7B: require medic faction membership.
  if (!isMedic(entry)) {
    socket.emit("rp:toast", {
      msg:      "Medical faction required.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Requires driver license.
  if (!entry.driverLicense) {
    socket.emit("rp:toast", {
      msg:      "A driver license is required to work as a paramedic.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Must be at Medical Center
  const dx = player.x - MEDIC_CENTER[0];
  const dz = player.z - MEDIC_CENTER[2];
  if (dx * dx + dz * dz > MEDIC_CENTER_RADIUS * MEDIC_CENTER_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You must be at the Medical Center to clock in.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Cooldown check
  const now = Date.now();
  if (entry.lastPaycheckAt !== null) {
    const elapsed = now - entry.lastPaycheckAt;
    if (elapsed < MEDIC_ROUTE_COOLDOWN_MS) {
      const waitSecs = Math.ceil((MEDIC_ROUTE_COOLDOWN_MS - elapsed) / 1000);
      socket.emit("rp:toast", {
        msg:      `Dispatch cooldown — wait ${waitSecs}s before taking another call.`,
        color:    "yellow",
        duration: 4000,
      });
      return;
    }
  }

  // Server assigns a random patient call (client never chooses)
  const patient = pickRandom(MEDIC_PATIENT_CALLS);
  const pay     = calcMedicPay(patient);

  // DB-first (Fix 2 pattern)
  try {
    await db
      .update(rpPlayers)
      .set({ onDuty: true, currentJob: "medic" })
      .where(eq(rpPlayers.id, entry.playerId));
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rp] clockInMedic: DB update failed");
    socket.emit("rp:toast", {
      msg:      "Clock-in failed — try again.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  const state: JobState = {
    job:         "medic",
    nextCp:      0,
    startedAt:   now,
    lastCpAt:    0,
    medicTarget: patient,
    medicPay:    pay,
  };
  rpJobState.set(socket.id, state);
  entry.onDuty     = true;
  entry.currentJob = "medic";

  socket.emit("rp:profileUpdate", {
    onDuty:     true,
    currentJob: "medic",
    activeJob:  buildMedicJob(state),
  });
  socket.emit("rp:toast", {
    msg:      `Dispatch! Respond to patient call. Pay: $${pay}.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, patient, pay }, "[rp] medic clocked in");
}

// ── Medic checkpoint ───────────────────────────────────────────────────────────

/**
 * idx === 0:  arrived at patient — start treatment timer (nextCp → 1).
 * idx === 1:  treatment timer running — stays at patient location 6 s.
 *             If player leaves radius, reset treatmentStartedAt and send nextCp back to 0.
 *             On timer elapsed, advance nextCp → 2.
 * idx === 2:  arrived at ER bay — pay atomically and clear state.
 *
 * Server-authoritative: uses drivenVehicle.x/z only (no player.x/z fallback).
 */
async function handleMedicCheckpoint(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  state:  JobState,
  idx:    number,
  now:    number,
): Promise<void> {
  if (!state.medicTarget || state.medicPay === undefined) {
    logger.warn({ socketId: socket.id }, "[rp] handleMedicCheckpoint: missing medic state");
    socket.emit("rp:toast", {
      msg:      "Route data lost — please clock out and try again.",
      color:    "red",
      duration: 5000,
    });
    return;
  }

  // Reject wrong idx
  if (idx !== state.nextCp) {
    logger.debug(
      { socketId: socket.id, idx, nextCp: state.nextCp },
      "[rp] medic checkpoint out of order — ignored",
    );
    return;
  }

  // All stages require driven vehicle (no player.x/z fallback)
  const drivenVehicle = [...ctx.vehicles.values()].find(v => v.driverId === socket.id);
  if (!drivenVehicle) {
    socket.emit("rp:toast", {
      msg:      "You must be driving to respond to a call.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const radiusSq = MEDIC_SERVICE_RADIUS * MEDIC_SERVICE_RADIUS;

  // ── idx === 0: respond to patient ────────────────────────────────────────────
  if (idx === 0) {
    const [tx, , tz] = state.medicTarget;
    const dx = drivenVehicle.x - tx;
    const dz = drivenVehicle.z - tz;
    if (dx * dx + dz * dz > radiusSq) return; // not close enough yet

    state.nextCp                 = 1;
    state.lastCpAt               = now;
    state.medicTreatmentStartedAt = now;

    socket.emit("rp:profileUpdate", { activeJob: buildMedicJob(state) });
    socket.emit("rp:toast", {
      msg:      "On scene — treating patient for 6 seconds. Stay close!",
      color:    "cyan",
      duration: 4000,
    });
    logger.debug({ socketId: socket.id }, "[rp] medic arrived at patient, treatment started");
    return;
  }

  // ── idx === 1: treatment timer ────────────────────────────────────────────────
  if (idx === 1) {
    if (!state.medicTreatmentStartedAt) {
      logger.warn({ socketId: socket.id }, "[rp] handleMedicCheckpoint: idx=1 but no treatmentStartedAt");
      return;
    }

    const [tx, , tz] = state.medicTarget;
    const dx = drivenVehicle.x - tx;
    const dz = drivenVehicle.z - tz;

    // Left the scene — reset treatment (same pattern as mechanic)
    if (dx * dx + dz * dz > radiusSq) {
      state.medicTreatmentStartedAt = undefined;
      state.nextCp                  = 0;
      state.lastCpAt                = 0;
      socket.emit("rp:profileUpdate", { activeJob: buildMedicJob(state) });
      socket.emit("rp:toast", {
        msg:      "Left the scene! Drive back to restart treatment.",
        color:    "yellow",
        duration: 3000,
      });
      return;
    }

    // Timer still running?
    if (now - state.medicTreatmentStartedAt < MEDIC_TREATMENT_DURATION_MS) {
      return; // client retries next second
    }

    // Treatment complete — advance to transport stage
    state.nextCp   = 2;
    state.lastCpAt = now;

    socket.emit("rp:profileUpdate", { activeJob: buildMedicJob(state) });
    socket.emit("rp:toast", {
      msg:      "Patient stabilised! Transport to the ER bay.",
      color:    "cyan",
      duration: 5000,
    });
    logger.debug({ socketId: socket.id }, "[rp] medic treatment complete, advancing to transport");
    return;
  }

  // ── idx === 2: ER bay — pay atomically ────────────────────────────────────────
  const [erx, , erz] = MEDIC_ER_BAY;
  const erdx = drivenVehicle.x - erx;
  const erdz = drivenVehicle.z - erz;
  if (erdx * erdx + erdz * erdz > radiusSq) return; // not at ER yet

  const { grossPay: medicGross, taxRate: medicRate, taxAmount: medicTax, netPay: medicNet } =
    applyCityTax(state.medicPay!);
  let newCash   = entry.cash;
  let newBudget = 0;
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");
      if (!wallet) throw new Error("no wallet row");

      newCash = wallet.cash + medicNet;

      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "job_pay",
        cashDelta: medicNet,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      `Paramedic run complete (patient delivered to ER) — gross=${medicGross} tax=${medicTax} net=${medicNet} rate=${medicRate}`,
      });

      await tx
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null, lastPaycheckAt: new Date(now) })
        .where(eq(rpPlayers.id, entry.playerId));

      if (medicTax > 0) newBudget = await addTaxRevenueTx(tx, medicTax);
    });
  } catch (err) {
    // DB failed — leave state untouched; client retries idx=2 next second
    logger.error({ err, socketId: socket.id }, "[rp] handleMedicCheckpoint: payment tx failed");
    socket.emit("rp:toast", {
      msg:      "Payment failed — drive through the ER bay again.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // DB committed — finalise state
  if (medicTax > 0) setCityBudgetInMemory(newBudget);
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
  const medicTaxNote = medicTax > 0 ? ` (−$${medicTax} tax)` : "";
  socket.emit("rp:toast", {
    msg:      `Patient delivered! +$${medicNet}${medicTaxNote} earned. Next call in 60 seconds.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, grossPay: medicGross, taxAmount: medicTax, netPay: medicNet, newCash }, "[rp] medic run complete, paid");
}

// ── Police Patrol helpers ──────────────────────────────────────────────────────

/**
 * Pay = sum of consecutive segment distances through the 4 sampled patrol points,
 * multiplied by POLICE_PATROL_PAY_PER_M, clamped to [MIN, MAX], rounded to $10.
 */
function calcPolicePatrolPay(route: [number, number, number][]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += dist3d(route[i - 1][0], route[i - 1][1], route[i - 1][2], route[i][0], route[i][1], route[i][2]);
  }
  const raw = Math.max(POLICE_PATROL_PAY_MIN, Math.min(POLICE_PATROL_PAY_MAX, total * POLICE_PATROL_PAY_PER_M));
  return Math.round(raw / 10) * 10;
}

/**
 * Builds the activeJob payload for the police_patrol job.
 * checkpoints = the 4 sampled patrol points; nextCp advances 0 → 1 → 2 → 3.
 */
function buildPolicePatrolJob(state: JobState): Record<string, unknown> {
  return {
    job:         "police_patrol",
    label:       "Police Patrol",
    mode:        "vehicle" as const,
    checkpoints: state.policePatrolRoute! as [number, number, number][],
    nextCp:      state.nextCp,
    pay:         state.policePatrolPay!,
  };
}

// ── Police Patrol clock-in ─────────────────────────────────────────────────────

async function clockInPolicePatrol(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  player: PlayerState,
): Promise<void> {
  // Phase 7B: require police faction membership.
  if (!isPolice(entry)) {
    socket.emit("rp:toast", {
      msg:      "Police faction required.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Requires driver license.
  if (!entry.driverLicense) {
    socket.emit("rp:toast", {
      msg:      "A driver license is required to work as a Police Officer.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Must be at Police Station
  const dx = player.x - POLICE_STATION[0];
  const dz = player.z - POLICE_STATION[2];
  if (dx * dx + dz * dz > POLICE_STATION_RADIUS * POLICE_STATION_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You must be at the Police Station to clock in.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Cooldown check
  const now = Date.now();
  if (entry.lastPaycheckAt !== null) {
    const elapsed = now - entry.lastPaycheckAt;
    if (elapsed < POLICE_PATROL_ROUTE_COOLDOWN_MS) {
      const waitSecs = Math.ceil((POLICE_PATROL_ROUTE_COOLDOWN_MS - elapsed) / 1000);
      socket.emit("rp:toast", {
        msg:      `Patrol cooldown — wait ${waitSecs}s before starting another patrol.`,
        color:    "yellow",
        duration: 4000,
      });
      return;
    }
  }

  // Server assigns a 4-point route sampled without replacement (client never chooses)
  const route = sampleWithoutReplacement(POLICE_PATROL_POINTS, 4);
  const pay   = calcPolicePatrolPay(route);

  // DB-first (Fix 2 pattern)
  try {
    await db
      .update(rpPlayers)
      .set({ onDuty: true, currentJob: "police_patrol" })
      .where(eq(rpPlayers.id, entry.playerId));
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rp] clockInPolicePatrol: DB update failed");
    socket.emit("rp:toast", {
      msg:      "Clock-in failed — try again.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  const state: JobState = {
    job:               "police_patrol",
    nextCp:            0,
    startedAt:         now,
    lastCpAt:          0,
    policePatrolRoute: route,
    policePatrolPay:   pay,
  };
  rpJobState.set(socket.id, state);
  entry.onDuty     = true;
  entry.currentJob = "police_patrol";

  socket.emit("rp:profileUpdate", {
    onDuty:     true,
    currentJob: "police_patrol",
    activeJob:  buildPolicePatrolJob(state),
  });
  socket.emit("rp:toast", {
    msg:      `Patrol dispatched! Visit all 4 patrol points by vehicle. Pay: $${pay}.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, route, pay }, "[rp] police_patrol clocked in");
}

// ── Police Patrol checkpoint ───────────────────────────────────────────────────

/**
 * idx 0–2: advance nextCp, emit profileUpdate.
 * idx 3 (final): arrive at last patrol point — pay atomically, clear state.
 *
 * Server-authoritative: uses drivenVehicle.x/z only (no player.x/z fallback).
 * Anti-farm: POLICE_PATROL_MIN_STAGE_INTERVAL_MS between accepted checkpoints.
 * Final checkpoint is retryable: on DB failure, state is left intact so client
 * retries next second.
 */
async function handlePolicePatrolCheckpoint(
  socket: Socket,
  ctx:    JobContext,
  entry:  RpCacheEntry,
  state:  JobState,
  idx:    number,
  now:    number,
): Promise<void> {
  if (!state.policePatrolRoute || state.policePatrolPay === undefined) {
    logger.warn({ socketId: socket.id }, "[rp] handlePolicePatrolCheckpoint: missing patrol state");
    socket.emit("rp:toast", {
      msg:      "Patrol data lost — please clock out and try again.",
      color:    "red",
      duration: 5000,
    });
    return;
  }

  // Strict order + bounds guard — must match nextCp exactly (server-authoritative).
  // Rejects: out-of-order replays, invalid indexes, negative values, floats.
  if (
    !Number.isInteger(idx) ||
    idx < 0 ||
    idx >= state.policePatrolRoute.length ||
    idx !== state.nextCp
  ) {
    logger.debug(
      { socketId: socket.id, idx, nextCp: state.nextCp },
      "[rp] police_patrol checkpoint out of order — ignored",
    );
    return;
  }

  // Anti-farm: minimum interval between stages
  if (state.lastCpAt > 0 && now - state.lastCpAt < POLICE_PATROL_MIN_STAGE_INTERVAL_MS) {
    socket.emit("rp:toast", {
      msg:      "Drive further between patrol points.",
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  // Require a real server-registered driven vehicle (no player.x/z fallback)
  const drivenVehicle = [...ctx.vehicles.values()].find(v => v.driverId === socket.id);
  if (!drivenVehicle) {
    socket.emit("rp:toast", {
      msg:      "You must be driving a vehicle during Police Patrol.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Distance check — server vehicle position only
  const [cpx, , cpz] = state.policePatrolRoute[idx];
  const vdx = drivenVehicle.x - cpx;
  const vdz = drivenVehicle.z - cpz;
  if (vdx * vdx + vdz * vdz > POLICE_PATROL_ACCEPT_RADIUS * POLICE_PATROL_ACCEPT_RADIUS) return;

  // ── Checkpoint accepted ────────────────────────────────────────────────────
  state.nextCp  += 1;
  state.lastCpAt = now;

  const totalCps = state.policePatrolRoute.length; // 4

  if (idx < totalCps - 1) {
    // Intermediate checkpoint — advance and notify
    socket.emit("rp:profileUpdate", { activeJob: buildPolicePatrolJob(state) });
    socket.emit("rp:toast", {
      msg:      `Patrol point ${idx + 1} / ${totalCps} — keep going!`,
      color:    "blue",
      duration: 2500,
    });
    logger.debug({ socketId: socket.id, idx, nextCp: state.nextCp }, "[rp] police_patrol checkpoint hit");
    return;
  }

  // ── Final patrol point — pay atomically ──────────────────────────────────
  const { grossPay: patrolGross, taxRate: patrolRate, taxAmount: patrolTax, netPay: patrolNet } =
    applyCityTax(state.policePatrolPay!);
  let newCash   = entry.cash;
  let newBudget = 0;
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");
      if (!wallet) throw new Error("no wallet row");

      newCash = wallet.cash + patrolNet;

      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "job_pay",
        cashDelta: patrolNet,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      `Police Patrol route complete — gross=${patrolGross} tax=${patrolTax} net=${patrolNet} rate=${patrolRate}`,
      });

      await tx
        .update(rpPlayers)
        .set({ onDuty: false, currentJob: null, lastPaycheckAt: new Date(now) })
        .where(eq(rpPlayers.id, entry.playerId));

      if (patrolTax > 0) newBudget = await addTaxRevenueTx(tx, patrolTax);
    });
  } catch (err) {
    // DB failed — roll back so final checkpoint is retryable
    state.nextCp  -= 1;
    state.lastCpAt = 0;
    logger.error({ err, socketId: socket.id }, "[rp] handlePolicePatrolCheckpoint: payment tx failed");
    socket.emit("rp:toast", {
      msg:      "Payment failed — drive through the final patrol point again.",
      color:    "red",
      duration: 5000,
    });
    return;
  }

  // DB committed — finalise state
  if (patrolTax > 0) setCityBudgetInMemory(newBudget);
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
  const patrolTaxNote = patrolTax > 0 ? ` (−$${patrolTax} tax)` : "";
  socket.emit("rp:toast", {
    msg:      `Patrol complete! +$${patrolNet}${patrolTaxNote} earned. Next patrol in 60 seconds.`,
    color:    "green",
    duration: 6000,
  });
  logger.info({ socketId: socket.id, grossPay: patrolGross, taxAmount: patrolTax, netPay: patrolNet, newCash }, "[rp] police_patrol route complete, paid");
}
