import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import { configureWorldRenderer } from "./rendererConfig";
import type { VehicleState } from "../shared/types";
import type { NpcStumbleMap } from "../shared/collision";
import type { RpProfile, RpToast } from "../shared/rpTypes";
import CityMap from "./CityMap";
import LocalPlayer, { Controls } from "./LocalPlayer";
import LicenseTestHUD from "./LicenseTestHUD";
import JobHUD from "./JobHUD";
import VehicleShopHUD from "./VehicleShopHUD";
import ATMHUD from "./ATMHUD";
import RemotePlayer from "./RemotePlayer";
import VehicleObject from "./VehicleObject";
import CheckpointRace from "./CheckpointRace";
import HUD from "./HUD";
import RPMarkers from "./RPMarkers";
import RPHud from "./RPHud";
import NPCs from "./NPCs";
import AmbientTraffic from "./AmbientTraffic";
import BiomeRender from "./BiomeRender";
import DayNightController from "./DayNightController";
import { PerfMonitor, PerfOverlay } from "./PerfHUD";
import { dayNightRuntime, type DayPhase } from "../shared/timeOfDay";

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
  { name: Controls.lockVehicle,  keys: ["KeyL"] },
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
  // RP layer — provided by Game.tsx via useRpSocket, which attaches listeners
  // before the myId/ready guard so rp:profile is never missed on join.
  rpProfile:       RpProfile | null;
  rpToasts:        RpToast[];
  dismissToast:    (id: number) => void;
  /** Push a local toast without a server round-trip (e.g. blocked vehicle entry). */
  pushToast:       (msg: string, color: string, duration?: number) => void;
  canDriveVehicle: (vehicleId: string) => boolean;
  /** Emit rp:interact (e.g. start_driver_test). From useRpSocket. */
  emitRpInteract:  (building: string, action: string) => void;
  /** Emit rp:licenseTestCheckpoint. From useRpSocket. */
  emitLicenseCheckpoint: (idx: number) => void;
  /** Phase 3: Emit rp:buyVehicle. From useRpSocket. */
  emitBuyVehicle:  (model: string, variant: string, color: string) => void;
  /** Phase 3: Emit rp:toggleLock. From useRpSocket. */
  emitToggleLock:  (vehicleId: string) => void;
  /** Phase 4: Emit rp:toggleDuty. From useRpSocket. */
  emitToggleDuty:  (job: string) => void;
  /** Phase 4: Emit rp:jobCheckpoint. From useRpSocket. */
  emitJobCheckpoint: (idx: number) => void;
  /** Phase 5F: Emit rp:bankDeposit. From useRpSocket. */
  emitBankDeposit: (amount: number) => void;
  /** Phase 5F: Emit rp:bankWithdraw. From useRpSocket. */
  emitBankWithdraw: (amount: number) => void;
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
  rpProfile,
  rpToasts,
  dismissToast,
  pushToast,
  canDriveVehicle,
  emitRpInteract,
  emitLicenseCheckpoint,
  emitBuyVehicle,
  emitToggleLock,
  emitToggleDuty,
  emitJobCheckpoint,
  emitBankDeposit,
  emitBankWithdraw,
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
    nearOffice: false,
    nearDealership: false,
    nearOwnedVehicleId: null as string | null,
    nearDepot: false,
    nearTaxiDepot: false,
    nearDeliveryHub: false,
    nearMechanicGarage: false,
    nearMedicCenter: false,
    nearPoliceStation: false,
    nearATM: false,
  });

  // Phase 3: dealership shop panel visibility
  const [showShop, setShowShop] = useState(false);
  // Phase 5F: ATM panel visibility
  const [showATM, setShowATM] = useState(false);

  const playerPosRef = useRef(new THREE.Vector3(0, 1, 0));
  const wrapperRef = useRef<HTMLDivElement>(null);

  // World clock for the HUD chip. DayNightController writes to a
  // module-level runtime ref every frame; we poll it once a second
  // so the HUD only re-renders ~60 times per game-day instead of
  // 60 times per real second.
  const [clock, setClock] = useState<{ label: string; phase: DayPhase }>({
    label: "--:--",
    phase: "DAY",
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (!dayNightRuntime.ready) return;
      setClock((prev) => {
        if (
          prev.label === dayNightRuntime.label &&
          prev.phase === dayNightRuntime.phase
        ) {
          return prev;
        }
        return { label: dayNightRuntime.label, phase: dayNightRuntime.phase };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

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
          onCreated={({ gl }) => configureWorldRenderer(gl)}
        >
          {/* Global lighting + sky + fog + sun/moon — owned by the
              DayNightController, which keeps exactly one shadow-
              casting directional light (sun by day, moon by night)
              and writes a runtime snapshot the lamps + point lights
              + HUD ticker all read from. The previous static
              hemi/dir/ambient lights and CityMap's static skybox/
              fog have moved into this single component. */}
          <DayNightController />

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

          {/* RP world markers — station platform, licensing office, checkpoint rings, depot */}
          <RPMarkers
            activeTest={rpProfile?.activeTest ?? null}
            activeJob={rpProfile?.activeJob ?? null}
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
            canDriveVehicle={canDriveVehicle}
            pushToast={pushToast}
            emitRpInteract={emitRpInteract}
            emitLicenseCheckpoint={emitLicenseCheckpoint}
            activeTest={rpProfile?.activeTest}
            emitToggleLock={emitToggleLock}
            onOpenShop={() => setShowShop(true)}
            onOpenATM={() => setShowATM(true)}
            activeJob={rpProfile?.activeJob ?? null}
            emitToggleDuty={emitToggleDuty}
            emitJobCheckpoint={emitJobCheckpoint}
          />

          <PerfMonitor />
        </Canvas>
      </KeyboardControls>

      <PerfOverlay />

      {/* RP toast overlay — ephemeral rp:toast messages */}
      <RPHud toasts={rpToasts} onDismissToast={dismissToast} />

      {/* License test HUD — top-center overlay during an active driver test */}
      <LicenseTestHUD activeTest={rpProfile?.activeTest ?? null} />

      {/* Phase 4: Job HUD — top-center overlay during an active City Worker route */}
      <JobHUD activeJob={rpProfile?.activeJob ?? null} />

      {/* Phase 3: dealership shop panel */}
      <VehicleShopHUD
        open={showShop}
        rpProfile={rpProfile}
        onClose={() => setShowShop(false)}
        onBuy={(model, variant, color) => {
          emitBuyVehicle(model, variant, color);
          setShowShop(false);
        }}
      />

      {/* Phase 5F: ATM panel */}
      {showATM && (
        <ATMHUD
          cash={rpProfile?.cash ?? 0}
          bank={rpProfile?.bank ?? 0}
          onDeposit={(amount) => { emitBankDeposit(amount); }}
          onWithdraw={(amount) => { emitBankWithdraw(amount); }}
          onClose={() => setShowATM(false)}
        />
      )}

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
        clockLabel={clock.label}
        clockPhase={clock.phase}
        cash={rpProfile?.cash}
        bank={rpProfile?.bank}
        driverLicense={rpProfile?.driverLicense}
        nearOffice={uiState.nearOffice}
        nearDealership={uiState.nearDealership}
        nearOwnedVehicleId={uiState.nearOwnedVehicleId}
        nearDepot={uiState.nearDepot}
        nearTaxiDepot={uiState.nearTaxiDepot}
        nearDeliveryHub={uiState.nearDeliveryHub}
        nearMechanicGarage={uiState.nearMechanicGarage}
        nearMedicCenter={uiState.nearMedicCenter}
        nearPoliceStation={uiState.nearPoliceStation}
        nearATM={uiState.nearATM}
      />
    </div>
  );
}
