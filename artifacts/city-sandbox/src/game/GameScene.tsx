import { useState, useRef, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import type { VehicleState } from "../shared/types";
import CityMap from "./CityMap";
import LocalPlayer, { Controls } from "./LocalPlayer";
import RemotePlayer from "./RemotePlayer";
import VehicleObject from "./VehicleObject";
import CheckpointRace from "./CheckpointRace";
import HUD from "./HUD";

const KEY_MAP = [
  { name: Controls.forward,  keys: ["ArrowUp",    "KeyW"] },
  { name: Controls.back,     keys: ["ArrowDown",  "KeyS"] },
  { name: Controls.left,     keys: ["ArrowLeft",  "KeyA"] },
  { name: Controls.right,    keys: ["ArrowRight", "KeyD"] },
  { name: Controls.jump,     keys: ["Space"] },
  { name: Controls.run,      keys: ["ShiftLeft", "ShiftRight"] },
  { name: Controls.interact, keys: ["KeyE"] },
];

interface GameSceneProps {
  myId: string;
  username: string;
  playerCount: number;
  connected: boolean;
  gameState: { players: Record<string, import("../shared/types").PlayerState>; vehicles: Record<string, VehicleState> };
  setGameState: React.Dispatch<React.SetStateAction<{ players: Record<string, import("../shared/types").PlayerState>; vehicles: Record<string, VehicleState> }>>;
  emitPlayerUpdate: (data: object) => void;
  emitVehicleUpdate: (data: object) => void;
}

export default function GameScene({
  myId,
  username,
  playerCount,
  connected,
  gameState,
  setGameState,
  emitPlayerUpdate,
  emitVehicleUpdate,
}: GameSceneProps) {
  const [uiState, setUIState] = useState({
    health: 100,
    speed: 0,
    inVehicle: false,
    showInteract: false,
    vehicleLabel: "",
    raceActive: false,
    raceTime: 0,
    racePassed: [] as number[],
    px: 0,
    pz: 0,
  });

  const playerPosRef = useRef(new THREE.Vector3(0, 1, 0));

  const handleVehicleUpdate = useCallback((id: string, patch: Partial<VehicleState>) => {
    setGameState(prev => ({
      ...prev,
      vehicles: {
        ...prev.vehicles,
        [id]: { ...prev.vehicles[id], ...patch },
      },
    }));
  }, [setGameState]);

  const remotePlayers = Object.values(gameState.players).filter(
    (p) => p.id !== myId
  );

  const drivingVehicleId = uiState.inVehicle
    ? Object.values(gameState.vehicles).find(v => v.driverId === myId)?.id
    : undefined;

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#0a0a1a" }}>
      <KeyboardControls map={KEY_MAP}>
        <Canvas
          shadows
          camera={{ fov: 75, near: 0.1, far: 300, position: [0, 8, 15] }}
          style={{ width: "100%", height: "100%" }}
        >
          {/* Ambient + directional light */}
          <ambientLight intensity={0.3} color="#2244aa" />
          <directionalLight
            position={[30, 50, 20]}
            intensity={0.6}
            color="#ffffff"
            castShadow
            shadow-mapSize={[1024, 1024]}
          />

          <CityMap />

          {/* Remote players */}
          {remotePlayers.map((p) => (
            <RemotePlayer key={p.id} state={p} />
          ))}

          {/* Remote vehicles (not driven by local player) */}
          {Object.values(gameState.vehicles).map((v) => {
            const isLocalDriver = v.id === drivingVehicleId;
            if (isLocalDriver) return null;
            // Hide vehicle driven by a remote player (remote player component shows it)
            return (
              <VehicleObject
                key={v.id}
                state={v}
                isLocalDriverVehicle={false}
              />
            );
          })}

          {/* Checkpoint race gates */}
          <CheckpointRace
            playerPos={playerPosRef}
            onPass={() => {}}
            passedIds={uiState.racePassed}
            raceActive={uiState.raceActive}
          />

          {/* Local player (manages its own mesh + camera) */}
          <LocalPlayer
            myId={myId}
            username={username}
            vehicles={gameState.vehicles}
            onVehicleUpdate={handleVehicleUpdate}
            emitPlayerUpdate={emitPlayerUpdate}
            emitVehicleUpdate={emitVehicleUpdate}
            onUIUpdate={setUIState}
            playerPosRef={playerPosRef}
          />
        </Canvas>
      </KeyboardControls>

      <HUD
        health={uiState.health}
        speed={uiState.speed}
        inVehicle={uiState.inVehicle}
        showInteract={uiState.showInteract}
        vehicleLabel={uiState.vehicleLabel}
        playerCount={playerCount}
        myId={myId}
        username={username}
        raceActive={uiState.raceActive}
        raceTime={uiState.raceTime}
        racePassed={uiState.racePassed}
        playerPositionX={uiState.px}
        playerPositionZ={uiState.pz}
        connected={connected}
      />
    </div>
  );
}
