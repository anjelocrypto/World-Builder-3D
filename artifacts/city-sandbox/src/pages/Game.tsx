import { useEffect, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import GameScene from "../game/GameScene";

interface GameProps {
  username: string;
}

export default function Game({ username }: GameProps) {
  const {
    myId,
    connected,
    playerCount,
    gameState,
    setGameState,
    emitPlayerUpdate,
    emitVehicleUpdate,
  } = useSocket(username);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (myId) setReady(true);
  }, [myId]);

  if (!ready) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#0a0a1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Courier New', monospace",
          color: "#00e5ff",
          fontSize: 20,
          letterSpacing: 4,
        }}
      >
        CONNECTING...
      </div>
    );
  }

  return (
    <GameScene
      myId={myId}
      username={username}
      playerCount={playerCount}
      connected={connected}
      gameState={gameState}
      setGameState={setGameState}
      emitPlayerUpdate={emitPlayerUpdate}
      emitVehicleUpdate={emitVehicleUpdate}
    />
  );
}
