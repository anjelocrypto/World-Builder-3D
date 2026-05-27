import { useEffect, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import { useRpSocket } from "../hooks/useRpSocket";
import GameScene from "../game/GameScene";

interface GameProps {
  username: string;
}

export default function Game({ username }: GameProps) {
  const {
    socket,
    myId,
    connected,
    playerCount,
    gameState,
    setGameState,
    emitPlayerUpdate,
    emitVehicleUpdate,
  } = useSocket(username);

  // Attach rp:profile / rp:profileUpdate / rp:toast listeners as soon as
  // the socket instance exists — BEFORE the myId/ready guard below. This
  // prevents the race where the server emits rp:profile during the join
  // handshake but GameScene hasn't mounted yet (it waits for myId).
  const {
    rpProfile,
    rpToasts,
    dismissToast,
    pushToast,
    canDriveVehicle,
    emitInteract,
    emitLicenseCheckpoint,
    emitBuyVehicle,
    emitToggleLock,
    emitToggleDuty,
    emitJobCheckpoint,
    emitBankDeposit,
    emitBankWithdraw,
    emitIssueWarrant,
    emitArrest,
  } = useRpSocket(socket);

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
      rpProfile={rpProfile}
      rpToasts={rpToasts}
      dismissToast={dismissToast}
      pushToast={pushToast}
      canDriveVehicle={canDriveVehicle}
      emitRpInteract={emitInteract}
      emitLicenseCheckpoint={emitLicenseCheckpoint}
      emitBuyVehicle={emitBuyVehicle}
      emitToggleLock={emitToggleLock}
      emitToggleDuty={emitToggleDuty}
      emitJobCheckpoint={emitJobCheckpoint}
      emitBankDeposit={emitBankDeposit}
      emitBankWithdraw={emitBankWithdraw}
      emitIssueWarrant={emitIssueWarrant}
      emitArrest={emitArrest}
    />
  );
}
