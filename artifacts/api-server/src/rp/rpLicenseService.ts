/**
 * Driver License Test service — Phase 2.
 *
 * All checkpoint validation uses server-authoritative vehicle positions stored
 * in the shared `vehicles` Map.  Client-reported coordinates are NEVER trusted.
 *
 * Lifecycle:
 *   startLicenseTest()   — validate pre-conditions → charge fee → spawn test
 *                          vehicle → write TestState → emit events
 *   handleCheckpoint()   — validate proximity (server pos) → advance nextCp
 *                          → on final CP call completeTest()
 *   completeTest()       — persist driverLicenseAt → update cache → despawn vehicle
 *   failTest()           — despawn vehicle → clear state → emit failure toast
 *   cleanupOnDisconnect()— silent failTest path (no socket emits)
 */

import { db, rpPlayers } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Server, Socket } from "socket.io";
import { logger } from "../lib/logger";
import type { RpCacheEntry, TestState } from "./rpCache";
import { buildProfile } from "./rpCache";
import { walletTransfer, RpError } from "./rpWalletService";
import {
  LICENSING_OFFICE_POS,
  TEST_VEHICLE_SPAWN,
  TEST_FEE,
  LICENSE_TEST_CHECKPOINTS,
} from "../socket/cityData";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Radius (m) player must be within to interact with the Licensing Office. */
const INTERACT_RADIUS = 6;

/** Radius (m) vehicle must be within to register a checkpoint. */
const CP_RADIUS = 8;

/** Maximum time allowed to complete the full test. */
const TEST_TIMEOUT_MS = 120_000;

/** Minimum interval (ms) between consecutive checkpoints (anti-warp). */
const MIN_CP_INTERVAL_MS = 3_000;

// ── Minimal structural types (compatible with gameServer's local interfaces) ──

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

interface PlayerState {
  x: number;
  y: number;
  z: number;
  isInVehicle: boolean;
}

// ── Context ────────────────────────────────────────────────────────────────────

/**
 * Shared server state passed to every handler. All maps are the same objects
 * that gameServer.ts uses — mutations here are immediately visible to other
 * handlers (vehicleUpdate, disconnect, etc.).
 */
export interface LicenseContext {
  players:     Map<string, PlayerState>;
  vehicles:    Map<string, VehicleState>;
  rpCache:     Map<string, RpCacheEntry>;
  rpTestState: Map<string, TestState>;
  testTimers:  Map<string, ReturnType<typeof setTimeout>>;
  io:          Server;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Unique test-vehicle id for a given socket. */
function testVehicleId(socketId: string): string {
  return `tv-${socketId}`;
}

/** Emit vehicleAdded to all clients and add to server map. */
function spawnTestVehicle(
  socketId: string,
  ctx: LicenseContext,
): VehicleState {
  const v: VehicleState = {
    id:       testVehicleId(socketId),
    x:        TEST_VEHICLE_SPAWN[0],
    y:        TEST_VEHICLE_SPAWN[1],
    z:        TEST_VEHICLE_SPAWN[2],
    rotY:     0,
    speed:    0,
    driverId: null,
    color:    "#00e676",   // bright green — visually distinct from parked cars
    variant:  "compact",
  };
  ctx.vehicles.set(v.id, v);
  ctx.io.emit("vehicleAdded", v);
  return v;
}

/** Remove test vehicle from server map and emit vehicleRemoved to all clients. */
function despawnTestVehicle(vehicleId: string, ctx: LicenseContext): void {
  ctx.vehicles.delete(vehicleId);
  ctx.io.emit("vehicleRemoved", { id: vehicleId });
}

/** Clear the timeout and test state for a socket, return the vehicleId if any. */
function clearTestState(socketId: string, ctx: LicenseContext): string | null {
  const testState = ctx.rpTestState.get(socketId);
  const timer = ctx.testTimers.get(socketId);
  if (timer) {
    clearTimeout(timer);
    ctx.testTimers.delete(socketId);
  }
  ctx.rpTestState.delete(socketId);
  return testState?.vehicleId ?? null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Handle `rp:interact { building: "licensing_office", action: "start_driver_test" }`.
 *
 * Server validates all pre-conditions.  On success: deducts $200, spawns the
 * test vehicle, writes TestState, and notifies the client.
 */
export async function startLicenseTest(
  socket: Socket,
  ctx:    LicenseContext,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) {
    socket.emit("rp:toast", {
      msg:      "Profile not loaded yet — wait a moment and try again.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Already licensed
  if (entry.driverLicense) {
    socket.emit("rp:toast", {
      msg:      "You already have a Driver License.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Already in a test
  if (ctx.rpTestState.has(socket.id)) {
    socket.emit("rp:toast", {
      msg:      "You are already in a license test. Complete or abandon it first.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Player proximity check (server-authoritative position)
  const player = ctx.players.get(socket.id);
  if (!player) {
    logger.warn({ socketId: socket.id }, "[rp] startLicenseTest: player not in map");
    return;
  }
  const distToOffice = dist2d(
    player.x, player.z,
    LICENSING_OFFICE_POS[0], LICENSING_OFFICE_POS[2],
  );
  if (distToOffice > INTERACT_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You need to be closer to the Licensing Office entrance.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Sufficient cash
  if (entry.cash < TEST_FEE) {
    socket.emit("rp:toast", {
      msg:      `Need $${TEST_FEE} to start the test. You have $${entry.cash}.`,
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // Charge fee
  let newCash: number;
  try {
    const result = await walletTransfer({
      playerId:  entry.playerId,
      cashDelta: -TEST_FEE,
      kind:      "license_fee",
      note:      "Driver license test fee",
    });
    newCash = result.cash;
    entry.cash = newCash;
  } catch (err) {
    if (err instanceof RpError && err.code === "insufficient_cash") {
      socket.emit("rp:toast", {
        msg:      `Insufficient cash: need $${TEST_FEE}.`,
        color:    "red",
        duration: 4000,
      });
    } else {
      logger.error({ err, socketId: socket.id }, "[rp] walletTransfer failed in startLicenseTest");
      socket.emit("rp:toast", {
        msg:      "Server error — could not process payment. Try again.",
        color:    "red",
        duration: 4000,
      });
    }
    return;
  }

  // Spawn test vehicle
  const vehicle = spawnTestVehicle(socket.id, ctx);

  // Write test state
  const now = Date.now();
  const testState: TestState = {
    vehicleId: vehicle.id,
    nextCp:    0,
    startedAt: now,
    lastCpAt:  now,
  };
  ctx.rpTestState.set(socket.id, testState);

  // Timeout: auto-fail if test not completed in time
  const timer = setTimeout(() => {
    logger.info({ socketId: socket.id }, "[rp] license test TIMEOUT");
    failTest(socket.id, ctx);
  }, TEST_TIMEOUT_MS);
  ctx.testTimers.set(socket.id, timer);

  // Emit profile update (cash deducted + activeTest populated)
  const activeTest = {
    vehicleId:   vehicle.id,
    checkpoints: LICENSE_TEST_CHECKPOINTS,
    nextCp:      0,
  };
  socket.emit("rp:profileUpdate", { cash: newCash, activeTest });
  socket.emit("rp:licenseTestActive");
  socket.emit("rp:toast", {
    msg:      `$${TEST_FEE} deducted. Test vehicle spawned — enter it and follow the checkpoints!`,
    color:    "green",
    duration: 5000,
  });

  logger.info(
    { socketId: socket.id, vehicleId: vehicle.id },
    "[rp] license test STARTED",
  );
}

/**
 * Handle `rp:licenseTestCheckpoint { idx }`.
 *
 * Validates against the server-authoritative vehicle position stored in the
 * vehicles Map.  Does NOT trust any coordinates the client sends.
 *
 * Async because the final checkpoint awaits completeTest() which writes to
 * the DB before committing any state changes.
 */
export async function handleCheckpoint(
  socket: Socket,
  ctx:    LicenseContext,
  idx:    number,
): Promise<void> {
  const testState = ctx.rpTestState.get(socket.id);
  if (!testState) {
    logger.debug({ socketId: socket.id, idx }, "[rp] checkpoint: no active test");
    return;
  }

  // Must be the expected checkpoint
  if (idx !== testState.nextCp) {
    logger.debug(
      { socketId: socket.id, got: idx, expected: testState.nextCp },
      "[rp] checkpoint: out of order",
    );
    return;
  }

  // Test vehicle must still exist on server
  const vehicle = ctx.vehicles.get(testState.vehicleId);
  if (!vehicle) {
    logger.warn({ socketId: socket.id }, "[rp] checkpoint: test vehicle missing");
    failTest(socket.id, ctx);
    return;
  }

  // Player must be driving the test vehicle
  if (vehicle.driverId !== socket.id) {
    logger.debug(
      { socketId: socket.id, driverId: vehicle.driverId },
      "[rp] checkpoint: player not driving test vehicle",
    );
    return;
  }

  // Timing checks
  const now = Date.now();
  if (now - testState.startedAt > TEST_TIMEOUT_MS) {
    logger.info({ socketId: socket.id }, "[rp] checkpoint: test timed out");
    failTest(socket.id, ctx);
    return;
  }
  if (now - testState.lastCpAt < MIN_CP_INTERVAL_MS) {
    logger.debug({ socketId: socket.id, idx }, "[rp] checkpoint: too soon (warp?)");
    return;
  }

  // Server-authoritative proximity check (vehicle position, not client)
  const cp = LICENSE_TEST_CHECKPOINTS[idx];
  const distToCp = dist2d(vehicle.x, vehicle.z, cp[0], cp[2]);
  if (distToCp > CP_RADIUS) {
    logger.debug(
      { socketId: socket.id, idx, dist: distToCp.toFixed(1) },
      "[rp] checkpoint: vehicle too far",
    );
    return;
  }

  // ✓ Valid checkpoint
  const isFinal = idx === LICENSE_TEST_CHECKPOINTS.length - 1;

  if (isFinal) {
    await completeTest(socket, ctx);
  } else {
    testState.nextCp = idx + 1;
    testState.lastCpAt = now;

    const activeTest = {
      vehicleId:   testState.vehicleId,
      checkpoints: LICENSE_TEST_CHECKPOINTS,
      nextCp:      testState.nextCp,
    };
    socket.emit("rp:profileUpdate", { activeTest });
    socket.emit("rp:toast", {
      msg:      `Checkpoint ${idx + 1} / ${LICENSE_TEST_CHECKPOINTS.length} ✓  Head to the next!`,
      color:    "green",
      duration: 2500,
    });
    logger.info({ socketId: socket.id, idx }, "[rp] checkpoint PASSED");
  }
}

/**
 * Final checkpoint validated — persist driverLicenseAt to DB FIRST, then
 * commit all in-memory state changes and notify the client.
 *
 * On DB failure: log, emit a red toast, and RETURN without touching any
 * state so the client can retry the final checkpoint on the next tick.
 */
async function completeTest(socket: Socket, ctx: LicenseContext): Promise<void> {
  const testState = ctx.rpTestState.get(socket.id);
  if (!testState) return;

  const entry = ctx.rpCache.get(socket.id);
  if (!entry) {
    logger.error({ socketId: socket.id }, "[rp] completeTest: no cache entry — cannot grant license");
    socket.emit("rp:toast", {
      msg:      "Server error — profile not loaded. Try again.",
      color:    "red",
      duration: 5000,
    });
    return; // test remains active; client will retry
  }

  const vehicleId = testState.vehicleId;

  // ── Persist FIRST — do NOT commit any state until the DB write succeeds ──
  try {
    await db.update(rpPlayers)
      .set({ driverLicenseAt: new Date() })
      .where(eq(rpPlayers.id, entry.playerId));
    logger.info({ playerId: entry.playerId }, "[rp] driverLicenseAt persisted");
  } catch (err) {
    logger.error(
      { err, playerId: entry.playerId },
      "[rp] failed to persist driverLicenseAt — keeping test active for retry",
    );
    socket.emit("rp:toast", {
      msg:      "Server error saving license — drive through the final checkpoint again.",
      color:    "red",
      duration: 5000,
    });
    return; // test remains active; client retries via the 1 s throttle
  }

  // ── DB committed — now atomically clear test state + grant license ────────
  clearTestState(socket.id, ctx);
  despawnTestVehicle(vehicleId, ctx);
  entry.driverLicense = true;

  socket.emit("rp:profileUpdate", { driverLicense: true, activeTest: null });
  socket.emit("rp:toast", {
    msg:      "🏆 Driver License obtained! You can now drive any vehicle.",
    color:    "green",
    duration: 6000,
  });

  logger.info({ socketId: socket.id }, "[rp] license test COMPLETED — license granted");
}

/**
 * Fail the test (timeout, vehicle exit, or other server-side trigger).
 * Emits failure toast if the socket is still connected.
 */
export function failTest(socketId: string, ctx: LicenseContext): void {
  const vehicleId = clearTestState(socketId, ctx);
  if (vehicleId) despawnTestVehicle(vehicleId, ctx);

  // Emit only if socket is still present
  const socket = ctx.io.sockets.sockets.get(socketId);
  if (socket) {
    socket.emit("rp:profileUpdate", { activeTest: null });
    socket.emit("rp:toast", {
      msg:      "Test failed. No refund. Visit the Licensing Office to try again.",
      color:    "red",
      duration: 5000,
    });
  }

  logger.info({ socketId }, "[rp] license test FAILED");
}

/**
 * Silent cleanup path for disconnect (no socket emits possible).
 */
export function cleanupOnDisconnect(socketId: string, ctx: LicenseContext): void {
  const vehicleId = clearTestState(socketId, ctx);
  if (vehicleId) despawnTestVehicle(vehicleId, ctx);
  logger.info({ socketId }, "[rp] license test cleaned up (disconnect)");
}
