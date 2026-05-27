import { Server, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "../lib/logger";
import { INITIAL_VEHICLES, WORLD_HALF } from "./cityData";
import {
  validateRpMarkers,
  validateRpMarkerVehicleClearance,
  canDriveVehicle,
  safeStationSpawn,
} from "../rp/rpValidators";
import { rpCache, rpTestState, buildProfile } from "../rp/rpCache";
import { upsertPlayer } from "../rp/rpPlayerService";
import { setupRpHandlers } from "../rp/setupRpHandlers";

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
  // Throw early if any RP marker coordinate is invalid. This prevents a bad
  // position from slipping into production unnoticed. Pass [] for obstacles
  // in Phase 1B — pre-validated manually. Wire in STATIC_OBSTACLES in Phase 2.
  try {
    validateRpMarkers([]);
    validateRpMarkerVehicleClearance(Array.from(vehicles.values()));
  } catch (err) {
    logger.error({ err }, "[rp] startup validation FAILED — fix RP marker positions");
    throw err;
  }

  const io = new Server(httpServer, {
    path: "/api/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Player connected");

    socket.on("join", async (data: { username: string; token?: string }) => {
      const username = (data?.username ?? "Player").slice(0, 20);
      // token is a client-generated UUID stored in localStorage. Slice to 36
      // chars (UUID length) so an oversized value is safely ignored.
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

      // Broadcast new player to others
      socket.broadcast.emit("playerJoined", player);

      // Broadcast player count to all
      io.emit("playerCount", players.size);

      logger.info({ socketId: socket.id, username }, "Player joined");

      // ── RP layer — DB upsert + profile emit ─────────────────────────────
      // Only run when the client sent a token (new clients always do; old or
      // test clients may not). Failures are non-fatal — the player joins with
      // a null RP profile and the HUD simply hides the wallet display.
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

      // Register per-socket RP event listeners (rp:interact stub, etc.)
      setupRpHandlers(socket, io);
    });

    socket.on("playerUpdate", (data: Partial<PlayerState>) => {
      const player = players.get(socket.id);
      if (!player) return;

      // Basic sanity check — reject teleportation
      const dx = (data.x ?? player.x) - player.x;
      const dy = (data.y ?? player.y) - player.y;
      const dz = (data.z ?? player.z) - player.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > 100) {
        // Clamp to last known position (anti-cheat lite)
        data.x = player.x; data.y = player.y; data.z = player.z;
      }

      // World-bounds clamp. Even if the per-tick delta passes the
      // anti-teleport check above, any absolute coordinate is hard-
      // clamped so a hacked client can never report being outside
      // the 1000x1000 map.
      if (typeof data.x === "number") data.x = clampWorld(data.x, 1);
      if (typeof data.z === "number") data.z = clampWorld(data.z, 1);

      // ---------- Animation / attack field validation ----------
      // animState: must be a string from the whitelist. Anything else
      // (number, null, object, unknown string) is scrubbed so the
      // spread below leaves the previous server-stored value intact.
      if (data.animState !== undefined) {
        if (
          typeof data.animState !== "string" ||
          !VALID_ANIM_STATES.has(data.animState)
        ) {
          delete data.animState;
        }
      }
      // attackKind: must be "light" | "heavy" | null. Anything else
      // is scrubbed (previous value retained).
      if (
        data.attackKind !== undefined &&
        data.attackKind !== null &&
        data.attackKind !== "light" &&
        data.attackKind !== "heavy"
      ) {
        delete data.attackKind;
      }
      // attackSeq: monotonic, bounded growth per packet, integer-only.
      if (typeof data.attackSeq === "number" && Number.isFinite(data.attackSeq)) {
        const next = Math.floor(data.attackSeq);
        const floor = player.attackSeq;
        const ceil = player.attackSeq + ATTACK_SEQ_MAX_STEP;
        data.attackSeq = Math.max(floor, Math.min(ceil, next));
      } else if (data.attackSeq !== undefined) {
        delete data.attackSeq;
      }
      // attackStartedAt: number | null only.
      if (
        data.attackStartedAt !== undefined &&
        data.attackStartedAt !== null &&
        (typeof data.attackStartedAt !== "number" ||
          !Number.isFinite(data.attackStartedAt))
      ) {
        delete data.attackStartedAt;
      }
      // isGrounded: boolean.
      if (
        data.isGrounded !== undefined &&
        typeof data.isGrounded !== "boolean"
      ) {
        delete data.isGrounded;
      }
      // moveSpeed: non-negative bounded number.
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

      // Strict ownership check: if this vehicle is occupied by someone
      // else, reject ALL updates unconditionally. The previous gate let
      // a non-driver send `driverId: null` to forcibly eject the real
      // driver and teleport the car (griefing / IDOR). An unoccupied
      // vehicle (driverId === null) may still be claimed by anyone,
      // which is how `enter vehicle` works.
      if (vehicle.driverId !== null && vehicle.driverId !== socket.id) {
        return;
      }

      // Authoritative driverId: a client may only ever assign its own
      // socket id (claim the car) or null (release the car). Without
      // this, a malicious client could spoof `driverId: "<victim-id>"`
      // and frame another player as the driver of a vehicle they never
      // entered.
      if (
        data.driverId !== undefined &&
        data.driverId !== null &&
        data.driverId !== socket.id
      ) {
        return;
      }

      // ── License gate (Phase 1B) ──────────────────────────────────────────
      // Block vehicle entry for players without a driver license. Only applies
      // when the client is claiming the car (driverId = socket.id). Releasing
      // (driverId = null) and pure position updates are always allowed.
      // canDriveVehicle() also passes for players in an active license test
      // driving their assigned test vehicle (Phase 2 — testState always empty
      // in Phase 1B).
      if (data.driverId === socket.id) {
        if (!canDriveVehicle(socket.id, data.id, rpCache, rpTestState)) {
          socket.emit("rp:toast", {
            msg:      "You need a Driver License to drive. Visit the Licensing Office.",
            color:    "red",
            duration: 4000,
          });
          return;
        }
      }

      // `variant` and `color` are visual-only fields established by the
      // server's INITIAL_VEHICLES on boot and must NEVER be mutated from
      // the client. Stripping them here prevents a malicious client from
      // injecting an invalid variant string that could crash other
      // clients when they look it up in VARIANT_DIMENSIONS.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { variant: _v, color: _c, ...safe } = data;

      // World-bounds clamp on incoming vehicle position. Driver-side
      // clamps already enforce this on a fair client, but the server
      // must not relay an out-of-map vehicle to other players.
      if (typeof safe.x === "number") safe.x = clampWorld(safe.x, 7);
      if (typeof safe.z === "number") safe.z = clampWorld(safe.z, 7);

      const updated: VehicleState = { ...vehicle, ...safe };
      vehicles.set(data.id, updated);
      socket.broadcast.emit("vehicleMoved", updated);
    });

    socket.on("disconnect", () => {
      // Clean up RP cache entries first (before player record is deleted).
      rpCache.delete(socket.id);
      rpTestState.delete(socket.id);

      const player = players.get(socket.id);
      if (player) {
        // Release any vehicle the player was driving
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
