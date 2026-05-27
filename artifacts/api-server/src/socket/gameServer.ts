import { Server, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "../lib/logger";
import { INITIAL_VEHICLES, WORLD_HALF } from "./cityData";
import {
  validateRpMarkers,
  validateRpMarkerVehicleClearance,
  validateVehicleSpawnOBB,
  canDriveVehicle,
  safeStationSpawn,
} from "../rp/rpValidators";
import { rpCache, rpTestState, buildProfile } from "../rp/rpCache";
import { upsertPlayer } from "../rp/rpPlayerService";
import { setupRpHandlers, type LicenseContext } from "../rp/setupRpHandlers";
import { failTest, cleanupOnDisconnect } from "../rp/rpLicenseService";

// Clamp a horizontal world coordinate so a hacked client cannot push a
// player or vehicle outside the playable map. The margin keeps the
// clamp tight enough that even a large vehicle body stays in-bounds.
const clampWorld = (v: number, margin = 0): number =>
  Math.min(WORLD_HALF - margin, Math.max(-WORLD_HALF + margin, v));

// Authoritative whitelist of animation states. Mirrors the
// `PlayerAnimState` union in the city-sandbox shared types. If a new
// state is added there, it must also be added here or the server
// will scrub it from incoming playerUpdate packets.
const VALID_ANIM_STATES = new Set<string>([
  "idle",
  "walk",
  "run",
  "jump",
  "fall",
  "attack_light",
  "attack_heavy",
  "driving",
]);
type PlayerAnimState =
  | "idle"
  | "walk"
  | "run"
  | "jump"
  | "fall"
  | "attack_light"
  | "attack_heavy"
  | "driving";

// Hard cap on how much attackSeq may advance in a single packet.
// A fair client increments by exactly 1 per attack trigger; this
// bound keeps a hacked client from inflating the counter wildly
// (which would force every other client to re-trigger their attack
// replay logic on every tick).
const ATTACK_SEQ_MAX_STEP = 5;

interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  isInVehicle: boolean;
  vehicleId: string | null;
  health: number;
  isRunning: boolean;
  animState: PlayerAnimState;
  attackSeq: number;
  attackKind: "light" | "heavy" | null;
  attackStartedAt: number | null;
  isGrounded: boolean;
  moveSpeed: number;
}

interface VehicleState {
  id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  speed: number;
  driverId: string | null;
  color: string;
  // Visual-only field that flows through from INITIAL_VEHICLES so the
  // client can render different car body shapes. The server itself does
  // not act on this value.
  variant?: string;
}

const players = new Map<string, PlayerState>();
const vehicles = new Map<string, VehicleState>(
  INITIAL_VEHICLES.map((v) => [v.id, { ...v }])
);

// Per-socket test timers (Phase 2). Cleared in cleanupOnDisconnect / failTest.
const testTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Phase 1B: all players spawn at Central Station with per-connection jitter.
 * safeStationSpawn() tries 10 random positions within ±JITTER bounds and
 * returns the first that clears roads + obstacles; falls back to exact centre.
 * Pass [] for obstacles — positions were pre-validated; Phase 2 will wire in
 * the full static obstacle list.
 */
function getSpawn(): [number, number, number] {
  return safeStationSpawn([]);
}

function getGameStateSnapshot() {
  const playerMap: Record<string, PlayerState> = {};
  players.forEach((p, id) => { playerMap[id] = p; });
  const vehicleMap: Record<string, VehicleState> = {};
  vehicles.forEach((v, id) => { vehicleMap[id] = v; });
  return { players: playerMap, vehicles: vehicleMap };
}

export function setupGameServer(httpServer: HttpServer) {
  // ── Startup validation ─────────────────────────────────────────────────
  try {
    validateRpMarkers([]);
    validateRpMarkerVehicleClearance(Array.from(vehicles.values()));

    // OBB check: all four corners of the test-vehicle body must clear every
    // road carriageway. Static building obstacles are not available server-side
    // in Phase 1B/2 — pre-validated in NEMOVERSE_RP_PLAN.md §5.3.
    const TEST_VEH_X = 13;
    const TEST_VEH_Z = -30;
    if (!validateVehicleSpawnOBB(TEST_VEH_X, TEST_VEH_Z)) {
      throw new Error(
        `[rp] TEST_VEHICLE_SPAWN OBB (x=${TEST_VEH_X}, z=${TEST_VEH_Z}) ` +
        `clips a road carriageway — update TEST_VEHICLE_SPAWN`,
      );
    }
    logger.info(
      `[rp] TEST_VEHICLE_SPAWN OBB OK — all 4 body corners clear all carriageways`,
    );
  } catch (err) {
    logger.error({ err }, "[rp] startup validation FAILED — fix RP marker positions");
    throw err;
  }

  const io = new Server(httpServer, {
    path: "/api/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  // Shared context for all RP handlers — single reference, mutations visible everywhere.
  const ctx: LicenseContext = { players, vehicles, rpCache, rpTestState, testTimers, io };

  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Player connected");

    socket.on("join", async (data: { username: string; token?: string }) => {
      const username = (data?.username ?? "Player").slice(0, 20);
      const token = typeof data?.token === "string" ? data.token.slice(0, 36) : "";
      const [sx, sy, sz] = getSpawn();
      const player: PlayerState = {
        id: socket.id,
        username,
        x: sx, y: sy, z: sz,
        rotY: 0,
        isInVehicle: false,
        vehicleId: null,
        health: 100,
        isRunning: false,
        animState: "idle",
        attackSeq: 0,
        attackKind: null,
        attackStartedAt: null,
        isGrounded: true,
        moveSpeed: 0,
      };
      players.set(socket.id, player);

      // Send full game state to joining player. `serverNow` lets the
      // client compute its clock offset so every player sees the same
      // synchronized day/night cycle (see shared/timeOfDay.ts).
      const snapshot = getGameStateSnapshot();
      socket.emit("gameState", {
        myId: socket.id,
        serverNow: Date.now(),
        ...snapshot,
      });

      socket.broadcast.emit("playerJoined", player);
      io.emit("playerCount", players.size);

      logger.info({ socketId: socket.id, username }, "Player joined");

      // ── RP layer — DB upsert + profile emit ─────────────────────────────
      if (token) {
        upsertPlayer(token, username)
          .then((rpEntry) => {
            rpCache.set(socket.id, rpEntry);
            socket.emit("rp:profile", buildProfile(rpEntry));
            logger.info(
              { socketId: socket.id, playerId: rpEntry.playerId },
              "[rp] profile loaded",
            );
          })
          .catch((err) => {
            logger.error({ err, socketId: socket.id }, "[rp] upsertPlayer failed");
          });
      }

      // Register per-socket RP event listeners (rp:interact, rp:licenseTestCheckpoint)
      setupRpHandlers(socket, ctx);
    });

    socket.on("playerUpdate", (data: Partial<PlayerState>) => {
      const player = players.get(socket.id);
      if (!player) return;

      const dx = (data.x ?? player.x) - player.x;
      const dy = (data.y ?? player.y) - player.y;
      const dz = (data.z ?? player.z) - player.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > 100) {
        data.x = player.x; data.y = player.y; data.z = player.z;
      }

      if (typeof data.x === "number") data.x = clampWorld(data.x, 1);
      if (typeof data.z === "number") data.z = clampWorld(data.z, 1);

      if (data.animState !== undefined) {
        if (
          typeof data.animState !== "string" ||
          !VALID_ANIM_STATES.has(data.animState)
        ) {
          delete data.animState;
        }
      }
      if (
        data.attackKind !== undefined &&
        data.attackKind !== null &&
        data.attackKind !== "light" &&
        data.attackKind !== "heavy"
      ) {
        delete data.attackKind;
      }
      if (typeof data.attackSeq === "number" && Number.isFinite(data.attackSeq)) {
        const next = Math.floor(data.attackSeq);
        const floor = player.attackSeq;
        const ceil = player.attackSeq + ATTACK_SEQ_MAX_STEP;
        data.attackSeq = Math.max(floor, Math.min(ceil, next));
      } else if (data.attackSeq !== undefined) {
        delete data.attackSeq;
      }
      if (
        data.attackStartedAt !== undefined &&
        data.attackStartedAt !== null &&
        (typeof data.attackStartedAt !== "number" ||
          !Number.isFinite(data.attackStartedAt))
      ) {
        delete data.attackStartedAt;
      }
      if (data.isGrounded !== undefined && typeof data.isGrounded !== "boolean") {
        delete data.isGrounded;
      }
      if (typeof data.moveSpeed === "number" && Number.isFinite(data.moveSpeed)) {
        data.moveSpeed = Math.max(0, Math.min(50, data.moveSpeed));
      } else if (data.moveSpeed !== undefined) {
        delete data.moveSpeed;
      }

      const updated: PlayerState = { ...player, ...data, id: socket.id };
      players.set(socket.id, updated);
      socket.broadcast.emit("playerMoved", updated);
    });

    socket.on("vehicleUpdate", (data: Partial<VehicleState> & { id: string }) => {
      if (!data.id) return;
      const vehicle = vehicles.get(data.id);
      if (!vehicle) return;

      // Strict ownership check: reject if another player is driving.
      if (vehicle.driverId !== null && vehicle.driverId !== socket.id) {
        return;
      }

      // Spoof check: driverId can only be socket.id or null.
      if (
        data.driverId !== undefined &&
        data.driverId !== null &&
        data.driverId !== socket.id
      ) {
        return;
      }

      // ── Unoccupied-car gate + license check ──────────────────────────────
      // An unoccupied vehicle may ONLY be updated by a packet that simultaneously
      // claims it (driverId === socket.id) AND passes the license check.
      // Motion-only packets on an unoccupied car are rejected.
      if (vehicle.driverId === null) {
        if (data.driverId !== socket.id) {
          return;
        }
        if (!canDriveVehicle(socket.id, data.id, rpCache, rpTestState)) {
          socket.emit("rp:toast", {
            msg:      "You need a Driver License to drive. Visit the Licensing Office.",
            color:    "red",
            duration: 4000,
          });
          return;
        }
      }

      // ── Test-vehicle exit detection (Phase 2) ────────────────────────────
      // If the current driver releases the test vehicle (driverId → null),
      // and there is an active test for this socket using that vehicle, fail.
      const wasDriver  = vehicle.driverId === socket.id;
      const isRelease  = data.driverId === null;
      if (wasDriver && isRelease) {
        const testState = rpTestState.get(socket.id);
        if (testState && testState.vehicleId === data.id) {
          // Merge state first so other clients see the released vehicle, then fail.
          const released: VehicleState = { ...vehicle, driverId: null, speed: 0 };
          vehicles.set(data.id, released);
          socket.broadcast.emit("vehicleMoved", released);
          failTest(socket.id, ctx);
          return;
        }
      }

      // Strip visual-only fields (variant, color) — must not be mutated by client.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { variant: _v, color: _c, ...safe } = data;

      if (typeof safe.x === "number") safe.x = clampWorld(safe.x, 7);
      if (typeof safe.z === "number") safe.z = clampWorld(safe.z, 7);

      const updated: VehicleState = { ...vehicle, ...safe };
      vehicles.set(data.id, updated);
      socket.broadcast.emit("vehicleMoved", updated);
    });

    socket.on("disconnect", () => {
      // Phase 2: clean up active license test BEFORE clearing rpCache so
      // cleanupOnDisconnect can still read the entry for DB logging.
      if (rpTestState.has(socket.id)) {
        cleanupOnDisconnect(socket.id, ctx);
      }

      // Clear RP cache (after test cleanup).
      rpCache.delete(socket.id);

      const player = players.get(socket.id);
      if (player) {
        // Release any (non-test) vehicle the player was driving.
        vehicles.forEach((v, vid) => {
          if (v.driverId === socket.id) {
            const released = { ...v, driverId: null, speed: 0 };
            vehicles.set(vid, released);
            io.emit("vehicleMoved", released);
          }
        });
        players.delete(socket.id);
        io.emit("playerLeft", socket.id);
        io.emit("playerCount", players.size);
        logger.info({ socketId: socket.id, username: player.username }, "Player left");
      }
    });
  });

  logger.info("Game server (Socket.io) initialized");
}
