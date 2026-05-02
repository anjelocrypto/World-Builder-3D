import { Server, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "../lib/logger";
import { INITIAL_VEHICLES, SPAWN_POINTS, WORLD_HALF } from "./cityData";

// Clamp a horizontal world coordinate so a hacked client cannot push a
// player or vehicle outside the playable map. The margin keeps the
// clamp tight enough that even a large vehicle body stays in-bounds.
const clampWorld = (v: number, margin = 0): number =>
  Math.min(WORLD_HALF - margin, Math.max(-WORLD_HALF + margin, v));

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

let spawnIndex = 0;

function getSpawn(): [number, number, number] {
  const sp = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
  spawnIndex++;
  return sp;
}

function getGameStateSnapshot() {
  const playerMap: Record<string, PlayerState> = {};
  players.forEach((p, id) => { playerMap[id] = p; });
  const vehicleMap: Record<string, VehicleState> = {};
  vehicles.forEach((v, id) => { vehicleMap[id] = v; });
  return { players: playerMap, vehicles: vehicleMap };
}

export function setupGameServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    path: "/api/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Player connected");

    socket.on("join", (data: { username: string }) => {
      const username = (data?.username ?? "Player").slice(0, 20);
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
      };
      players.set(socket.id, player);

      // Send full game state to joining player
      const snapshot = getGameStateSnapshot();
      socket.emit("gameState", {
        myId: socket.id,
        ...snapshot,
      });

      // Broadcast new player to others
      socket.broadcast.emit("playerJoined", player);

      // Broadcast player count to all
      io.emit("playerCount", players.size);

      logger.info({ socketId: socket.id, username }, "Player joined");
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
