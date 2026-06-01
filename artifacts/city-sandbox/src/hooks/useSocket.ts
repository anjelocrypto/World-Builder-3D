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
  authMode: import("../shared/types").AuthMode = "wallet",
  // Batch B: wallet-mode pre-join handshake inputs (verified address from the
  // AuthGate + a Phantom signer). Null for guest/legacy.
  walletAddress: string | null = null,
  signMessage: ((message: string) => Promise<string | null>) | null = null,
  // Admin-mode dev passcode — sent once to the server's env-gated handshake.
  // Held only for the lifetime of this hook; never persisted.
  adminPasscode: string | null = null,
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

    // Batch A: guests carry NO token (no DB identity, no RP). Non-guests use the
    // existing stable localStorage token so prototype accounts keep working.
    const isGuest = authMode === "guest";
    const token = isGuest ? "" : getOrCreateToken();

    const sock = io({
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    socketRef.current = sock;
    setSocket(sock);

    sock.on("connect", () => {
      setConnected(true);
      if (authMode === "admin" && adminPasscode) {
        // Admin: prove the dev passcode to the SERVER before joining. The server
        // (env-gated) decides; the client never grants itself admin. On success
        // we join with an "admin:<username>" token (full RP). On denial we join
        // as a plain GUEST — no token, no privilege.
        sock.once("auth:adminResult", (res: { ok?: boolean }) => {
          if (res?.ok) {
            sock.emit("join", { username, token: `admin:${username}`, character, authMode: "admin" });
          } else {
            sock.emit("join", { username, character, authMode: "guest" });
          }
        });
        sock.emit("auth:adminVerify", { username, passcode: adminPasscode });
        return;
      }
      if (authMode === "wallet" && walletAddress && signMessage) {
        // Batch B: prove wallet ownership BEFORE join. The server reconstructs
        // the message from its own nonce; we just sign what it sends. On success
        // we join with a "wallet:<address>" token so RP state persists per wallet.
        sock.once("auth:walletChallenge", (d: { message?: string }) => {
          const message = typeof d?.message === "string" ? d.message : "";
          if (!message) { sock.emit("join", { username, character, authMode }); return; }
          void signMessage(message).then((sig) => {
            if (sig) sock.emit("auth:walletVerify", { pubkey: walletAddress, signature: sig });
            else sock.emit("join", { username, character, authMode }); // declined → no RP
          });
        });
        sock.once("auth:walletResult", (res: { ok?: boolean; address?: string }) => {
          if (res?.ok && typeof res.address === "string") {
            sock.emit("join", { username, token: `wallet:${res.address}`, character, authMode });
          } else {
            sock.emit("join", { username, character, authMode }); // unverified → no RP
          }
        });
        sock.emit("auth:walletNonce");
        return;
      }
      // Guests / legacy: include the stable token (non-guests) so the server can
      // upsert rp_players and send rp:profile. Guests send no token.
      sock.emit("join", { username, token: token || undefined, character, authMode });
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
  }, [username, character, authMode, walletAddress, signMessage, adminPasscode]);

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
