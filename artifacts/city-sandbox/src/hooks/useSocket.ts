import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { GameState, PlayerState, VehicleState } from "../shared/types";
import { INITIAL_VEHICLES } from "../shared/cityData";
import { setServerTimeOffset } from "../shared/timeOfDay";

// ── Stable player token ────────────────────────────────────────────────────

const TOKEN_KEY = "nemoverse_player_token";

/**
 * Returns the player's stable identity token from localStorage, generating
 * and persisting a new UUID if one doesn't exist yet.
 *
 * This token is sent with every `join` event so the server can upsert
 * `rp_players` and maintain persistent wallet / license state across sessions.
 * The token is never broadcast to other players.
 */
function getOrCreateToken(): string {
  try {
    const existing = localStorage.getItem(TOKEN_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (e.g. sandboxed iframe) — use an in-memory UUID.
    // This means RP state won't persist across page reloads in that context.
    return crypto.randomUUID();
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useSocket(
  username: string,
  character: import("../game/character/characterCatalog").CharacterId = "classic",
) {
  const socketRef = useRef<Socket | null>(null);
  // Reactive copy of the socket instance so hooks that need to attach their
  // own listeners (e.g. useRpSocket) can use it as a useEffect dependency.
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [playerCount, setPlayerCount] = useState(1);
  const [gameState, setGameState] = useState<GameState>({
    players: {},
    vehicles: INITIAL_VEHICLES.reduce<Record<string, VehicleState>>((acc, v) => {
      acc[v.id] = { ...v };
      return acc;
    }, {}),
  });

  useEffect(() => {
    if (!username) return;

    const token = getOrCreateToken();

    const sock = io({
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    socketRef.current = sock;
    setSocket(sock);

    sock.on("connect", () => {
      setConnected(true);
      // Include the stable token so the server can upsert rp_players and
      // send back rp:profile (cash, bank, driverLicense, etc.).
      sock.emit("join", { username, token, character });
    });

    sock.on("disconnect", () => {
      setConnected(false);
    });

    sock.on("gameState", (data: { myId: string; serverNow?: number; players: Record<string, PlayerState>; vehicles: Record<string, VehicleState> }) => {
      // Capture clock offset BEFORE setting state so the very first
      // useFrame in DayNightController reads a correct world time.
      // serverNow is optional in case an older server is talking to a
      // newer client; offset just stays at 0 (local time).
      if (typeof data.serverNow === "number") {
        setServerTimeOffset(data.serverNow - Date.now());
      }
      setMyId(data.myId);
      setGameState({ players: data.players, vehicles: data.vehicles });
      setPlayerCount(Object.keys(data.players).length);
    });

    sock.on("playerJoined", (player: PlayerState) => {
      setGameState(prev => ({
        ...prev,
        players: { ...prev.players, [player.id]: player },
      }));
      setPlayerCount(c => c + 1);
    });

    sock.on("playerMoved", (data: { id: string } & Partial<PlayerState>) => {
      setGameState(prev => {
        if (!prev.players[data.id]) return prev;
        return {
          ...prev,
          players: {
            ...prev.players,
            [data.id]: { ...prev.players[data.id], ...data },
          },
        };
      });
    });

    sock.on("playerLeft", (id: string) => {
      setGameState(prev => {
        const players = { ...prev.players };
        delete players[id];
        return { ...prev, players };
      });
      setPlayerCount(c => Math.max(1, c - 1));
    });

    sock.on("vehicleMoved", (data: { id: string } & Partial<VehicleState>) => {
      setGameState(prev => {
        if (!prev.vehicles[data.id]) return prev;
        return {
          ...prev,
          vehicles: {
            ...prev.vehicles,
            [data.id]: { ...prev.vehicles[data.id], ...data },
          },
        };
      });
    });

    // Phase 2: dynamic vehicles (test cars) spawned/despawned by the server.
    // INITIAL_VEHICLES covers permanent cars; vehicleAdded/vehicleRemoved handle
    // ephemeral ones that don't exist at game-state initialisation time.
    sock.on("vehicleAdded", (v: VehicleState) => {
      setGameState(prev => ({
        ...prev,
        vehicles: { ...prev.vehicles, [v.id]: v },
      }));
    });

    sock.on("vehicleRemoved", (data: { id: string }) => {
      setGameState(prev => {
        const vehicles = { ...prev.vehicles };
        delete vehicles[data.id];
        return { ...prev, vehicles };
      });
    });

    sock.on("playerCount", (count: number) => {
      setPlayerCount(count);
    });

    return () => {
      sock.disconnect();
      setSocket(null);
    };
  }, [username, character]);

  const emitPlayerUpdate = useCallback((data: Partial<PlayerState>) => {
    socketRef.current?.emit("playerUpdate", data);
  }, []);

  const emitVehicleUpdate = useCallback((data: Partial<VehicleState> & { id: string }) => {
    socketRef.current?.emit("vehicleUpdate", data);
  }, []);

  return {
    // Reactive socket instance — use as dependency in useRpSocket / other hooks.
    socket,
    myId,
    connected,
    playerCount,
    gameState,
    setGameState,
    emitPlayerUpdate,
    emitVehicleUpdate,
  };
}
