import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import type { VehicleState } from "../shared/types";
import type { NpcStumbleMap } from "../shared/collision";
import CityMap from "./CityMap";
import LocalPlayer, { Controls } from "./LocalPlayer";
import RemotePlayer from "./RemotePlayer";
import VehicleObject from "./VehicleObject";
import CheckpointRace from "./CheckpointRace";
import HUD from "./HUD";
import NPCs from "./NPCs";
import AmbientTraffic from "./AmbientTraffic";
import BiomeRender from "./BiomeRender";
import { PerfMonitor, PerfOverlay } from "./PerfHUD";

const KEY_MAP = [
  { name: Controls.forward,      keys: ["ArrowUp",    "KeyW"] },
  { name: Controls.back,         keys: ["ArrowDown",  "KeyS"] },
  { name: Controls.left,         keys: ["ArrowLeft",  "KeyA"] },
  { name: Controls.right,        keys: ["ArrowRight", "KeyD"] },
  { name: Controls.jump,         keys: ["Space"] },
  { name: Controls.run,          keys: ["ShiftLeft", "ShiftRight"] },
  { name: Controls.interact,     keys: ["KeyE"] },
  // Combat. KeyboardControls only handles keys; mouse buttons (Mouse0
  // for light, Mouse2 for heavy) are listened to separately inside
  // LocalPlayer's pointer-lock effect.
  { name: Controls.attackLight,  keys: ["KeyF"] },
  { name: Controls.attackHeavy,  keys: ["KeyR"] },
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Shared map of NPC stumble entries. LocalPlayer writes when its
  // driven car hits a pedestrian; NPCs.tsx reads each frame to apply a
  // decaying lateral knockback + tilt. Local-only — never networked.
  const npcStumbleRef = useRef<NpcStumbleMap>(new Map());

  // Authoritative spawn position from the server's gameState. Computed once
  // on first mount of LocalPlayer (initialSpawn is only read in useRef
  // initializer), so this doesn't need to react to subsequent updates.
  const initialSpawn = useMemo<[number, number, number] | undefined>(() => {
    const me = gameState.players[myId];
    if (!me) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          `[city-sandbox] GameScene mounted with no server player record ` +
            `for myId=${myId}. Falling back to deterministic local spawn. ` +
            `This usually means the join order changed in useSocket.`
        );
      }
      return undefined;
    }
    return [me.x, me.y, me.z];
    // We intentionally only depend on myId — gameState.players changes
    // every frame and we only want the server's first authoritative spawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  // Make sure keyboard input reaches the iframe / window. Replit's preview
  // pane is an iframe, and key events only fire when that iframe's window
  // has focus. We focus the wrapper on mount and on every click so WASD
  // works after the user clicks the game once.
  useEffect(() => {
    wrapperRef.current?.focus();
    try {
      window.focus();
    } catch {
      // Some embedding contexts disallow programmatic window.focus(); ignore.
    }
  }, []);

  const handleWrapperPointerDown = useCallback((e: React.PointerEvent) => {
    // Don't steal focus from input fields, textareas, or contenteditable
    // elements — future overlays (chat, settings) need to receive typed
    // text without us yanking focus back to the wrapper.
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
    }
    wrapperRef.current?.focus();
    try {
      window.focus();
    } catch {
      // Ignore — see above.
    }
  }, []);

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
    <div
      ref={wrapperRef}
      tabIndex={0}
      onPointerDown={handleWrapperPointerDown}
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        background: "#0a0a1a",
        outline: "none",
      }}
    >
      <KeyboardControls map={KEY_MAP}>
        <Canvas
          shadows
          dpr={[1, 1.5]}
          gl={{ powerPreference: "high-performance", antialias: false, stencil: false }}
          camera={{ fov: 75, near: 0.1, far: 1500, position: [0, 8, 15] }}
          style={{ width: "100%", height: "100%" }}
        >
          {/* Global lighting — kept light to preserve the evening mood
              while making the city readable. Only ONE shadow-casting
              light to keep performance steady on Replit. Shadow camera
              expanded to ±300 so the central city + immediate biome
              ring still cast shadows; far biomes fall outside but they
              are foggy at that distance anyway. */}
          <hemisphereLight
            args={["#aabbdd", "#242838", 0.55]}
          />
          <directionalLight
            position={[40, 60, 30]}
            intensity={0.55}
            color="#ffe5c8"
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-camera-left={-300}
            shadow-camera-right={300}
            shadow-camera-top={300}
            shadow-camera-bottom={-300}
            shadow-camera-near={0.5}
            shadow-camera-far={500}
          />
          <ambientLight intensity={0.18} color="#1a2240" />

          <CityMap />
          <BiomeRender />

          {/* Ambient life — pedestrians and AI traffic. Both client-only,
              deterministic from Date.now(), so no Socket.io traffic. */}
          <NPCs stumbleRef={npcStumbleRef} />
          <AmbientTraffic />

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
            npcStumbleRef={npcStumbleRef}
            onUIUpdate={setUIState}
            playerPosRef={playerPosRef}
            initialSpawn={initialSpawn}
          />

          <PerfMonitor />
        </Canvas>
      </KeyboardControls>

      <PerfOverlay />

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
