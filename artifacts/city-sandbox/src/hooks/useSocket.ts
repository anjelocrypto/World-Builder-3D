import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { GameState, PlayerState, VehicleState } from "../shared/types";
import { INITIAL_VEHICLES } from "../shared/cityData";

export function useSocket(username: string) {
  const socketRef = useRef<Socket | null>(null);
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

    const socket = io({
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", { username });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("gameState", (data: { myId: string; players: Record<string, PlayerState>; vehicles: Record<string, VehicleState> }) => {
      setMyId(data.myId);
      setGameState({ players: data.players, vehicles: data.vehicles });
      setPlayerCount(Object.keys(data.players).length);
    });

    socket.on("playerJoined", (player: PlayerState) => {
      setGameState(prev => ({
        ...prev,
        players: { ...prev.players, [player.id]: player },
      }));
      setPlayerCount(c => c + 1);
    });

    socket.on("playerMoved", (data: { id: string } & Partial<PlayerState>) => {
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

    socket.on("playerLeft", (id: string) => {
      setGameState(prev => {
        const players = { ...prev.players };
        delete players[id];
        return { ...prev, players };
      });
      setPlayerCount(c => Math.max(1, c - 1));
    });

    socket.on("vehicleMoved", (data: { id: string } & Partial<VehicleState>) => {
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

    socket.on("playerCount", (count: number) => {
      setPlayerCount(count);
    });

    return () => {
      socket.disconnect();
    };
  }, [username]);

  const emitPlayerUpdate = useCallback((data: Partial<PlayerState>) => {
    socketRef.current?.emit("playerUpdate", data);
  }, []);

  const emitVehicleUpdate = useCallback((data: Partial<VehicleState> & { id: string }) => {
    socketRef.current?.emit("vehicleUpdate", data);
  }, []);

  return {
    socket: socketRef.current,
    myId,
    connected,
    playerCount,
    gameState,
    setGameState,
    emitPlayerUpdate,
    emitVehicleUpdate,
  };
}
