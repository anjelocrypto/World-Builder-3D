import { Server, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "../lib/logger";
import { INITIAL_VEHICLES, SPAWN_POINTS } from "./cityData";

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

      const updated: PlayerState = { ...player, ...data, id: socket.id };
      players.set(socket.id, updated);
      socket.broadcast.emit("playerMoved", updated);
    });

    socket.on("vehicleUpdate", (data: Partial<VehicleState> & { id: string }) => {
      if (!data.id) return;
      const vehicle = vehicles.get(data.id);
      if (!vehicle) return;

      // Only driver can update vehicle
      if (vehicle.driverId && vehicle.driverId !== socket.id && data.driverId !== null) {
        return;
      }

      const updated: VehicleState = { ...vehicle, ...data };
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
