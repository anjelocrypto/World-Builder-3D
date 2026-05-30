import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import type { VehicleState } from "../shared/types";
import type { ActiveTest, ActiveJob, ActiveGangMission } from "../shared/rpTypes";
import {
  LICENSING_OFFICE_DOOR,
  DEALERSHIP_DOOR,
  CITY_WORKER_DEPOT_DOOR,
  CITY_WORKER_DEPOT_RADIUS,
  CITY_WORKER_CHECKPOINTS,
  JOB_CP_ACCEPT_RADIUS,
  TAXI_DEPOT_DOOR,
  TAXI_DEPOT_RADIUS,
  TAXI_CP_ACCEPT_RADIUS,
  DELIVERY_HUB_DOOR,
  DELIVERY_HUB_RADIUS,
  DELIVERY_CP_ACCEPT_RADIUS,
  MECHANIC_GARAGE_DOOR,
  MECHANIC_GARAGE_RADIUS,
  MECHANIC_SERVICE_RADIUS,
  MEDIC_CENTER_DOOR,
  MEDIC_CENTER_RADIUS,
  MEDIC_SERVICE_RADIUS,
  POLICE_STATION_DOOR,
  POLICE_STATION_RADIUS,
  POLICE_PATROL_ACCEPT_RADIUS,
  ATM_LOCATIONS,
  ATM_INTERACT_RADIUS,
  POLICE_BOOKING_DESK_POS,
  POLICE_BOOKING_RADIUS,
  GROVE_TAG_RADIUS,
} from "../shared/rpTypes";
import {
  SPAWN_POINTS,
  NPC_ROUTES,
  TRAFFIC_ROUTES,
  VARIANT_DIMENSIONS,
  WORLD_HALF,
} from "../shared/cityData";
import { EVENT_HALL, EVENT_HALL_SIT, EVENT_HALL_STAGE, isInsideEventHallStage, nearestEventHallChair } from "../shared/eventHall";
import { getVehicleGroundY, getVehicleGroundFrame } from "../shared/elevation";
import { terrainHeightAt } from "../shared/terrain";
import {
  PLAYER_BODY_RADIUS,
  NPC_BODY_RADIUS,
  VEHICLE_PLAYER_MARGIN,
  VEHICLE_BUILDING_MARGIN,
  VEHICLE_VEHICLE_MARGIN,
  VEHICLE_HIT_PLAYER_MIN_SPEED,
  VEHICLE_HIT_NPC_MIN_SPEED,
  NPC_STUMBLE_DURATION_MS,
  vehicleObb,
  circleVsObb,
  obbVsObb,
  playerHitsAnyBuilding,
  playerHitsAnyObstacle,
  playerHitsAnyRpWall,
  playerHitsAnyHouse,
  playerHitsAnyHallWall,
  playerHitsAnyHallChair,
  playerHitsEventHallStageSide,
  vehicleHitsAnyBuilding,
  vehicleHitsAnyObstacle,
  npcPositionAt,
  ambientCarStateAt,
  type OBB,
  type NpcStumbleMap,
} from "../shared/collision";
import { CarVisual } from "./VehicleObject";
import CharacterAvatar, {
  type CharacterRuntime,
} from "./character/CharacterAvatar";
import {
  CHARACTERS,
  DEFAULT_CHARACTER,
  attackDurationMs,
  type CharacterId,
} from "./character/characterCatalog";
import {
  resolveAnimState,
} from "./character/characterState";

export enum Controls {
  forward = "forward",
  back = "back",
  left = "left",
  right = "right",
  jump = "jump",
  run = "run",
  interact = "interact",
  attackLight = "attackLight",
  attackHeavy = "attackHeavy",
  lockVehicle = "lockVehicle",
}

// Module-level scratch reused by updateCamera every frame. Avoids a
// fresh Vector3 allocation 60 times per second.
const _camTarget = new THREE.Vector3();
const _camLookDesired = new THREE.Vector3();

// Camera smoothing constants. Stiffness values are used with
// `alpha = 1 - exp(-dt * stiffness)` so smoothing is frame-rate
// independent (60fps and 30fps converge to the same look).
//   POS  — chase camera body follow speed
//   LOOK — aim point follow speed (higher = snappier)
// At high vehicle speed we keep POS stiff (the camera body should
// still keep up) but loosen LOOK to filter out jitter from the
// per-tick terrain-sampled vehicle y on steep mountain switchbacks.
const CAM_POS_STIFFNESS = 8.0;
const CAM_LOOK_STIFFNESS_BASE = 14.0;
const CAM_LOOK_STIFFNESS_FAST = 5.0;
// Minimum gap between the camera and the rendered terrain. Prevents
// the chase camera clipping through a hillside on steep descents
// (which is what was causing the white/black flashing).
const CAM_TERRAIN_CLEARANCE = 1.0;
// Extra chase distance scaled by speed factor so the car stays in
// frame and the camera body has more time to settle.
const CAM_SPEED_DIST_BONUS = 2.0;
// Vehicle look point is offset above the body root so the camera
// doesn't aim into the roof at speed.
const CAM_VEHICLE_LOOK_HEIGHT = 1.4;
const CAM_PLAYER_LOOK_HEIGHT = 1.0;

const WALK_SPEED = 5;
const RUN_SPEED = 10;
const GRAVITY = -18;
const JUMP_FORCE = 7;
const VEHICLE_MAX_SPEED = 22;
const VEHICLE_ACCEL = 0.5;
const VEHICLE_BRAKE = 0.8;
const VEHICLE_FRICTION = 0.03;
const VEHICLE_TURN_BASE = 1.6;
const PLAYER_HEIGHT = 1.2;
const CAM_DIST = 7;
const INTERACT_DIST = 4;
const EMIT_RATE = 50; // ms between socket emits
const KNOCKBACK_DECAY = 0.85; // per-frame multiplier
const DAMAGE_COOLDOWN_MS = 1000;

interface LocalPlayerProps {
  myId: string;
  username: string;
  vehicles: Record<string, VehicleState>;
  onVehicleUpdate: (id: string, patch: Partial<VehicleState>) => void;
  emitPlayerUpdate: (data: object) => void;
  emitVehicleUpdate: (data: object) => void;
  npcStumbleRef: React.MutableRefObject<NpcStumbleMap>;
  onUIUpdate: (ui: {
    health: number;
    speed: number;
    inVehicle: boolean;
    showInteract: boolean;
    vehicleLabel: string;
    px: number;
    pz: number;
    nearOffice: boolean;
    nearDealership: boolean;
    nearOwnedVehicleId: string | null;
    /** Phase 4: true when walking player is within CITY_WORKER_DEPOT_RADIUS of the depot. */
    nearDepot: boolean;
    /** Phase 5A: true when walking player is within TAXI_DEPOT_RADIUS of the Taxi Depot. */
    nearTaxiDepot: boolean;
    /** Phase 5B: true when walking player is within DELIVERY_HUB_RADIUS of the Delivery Hub. */
    nearDeliveryHub: boolean;
    /** Phase 5C: true when walking player is within MECHANIC_GARAGE_RADIUS of the Mechanic Garage. */
    nearMechanicGarage: boolean;
    /** Phase 5D: true when walking player is within MEDIC_CENTER_RADIUS of the Medical Center. */
    nearMedicCenter: boolean;
    /** Phase 5E: true when walking player is within POLICE_STATION_RADIUS of the Police Station. */
    nearPoliceStation: boolean;
    /** Phase 5F: true when walking player is within ATM_INTERACT_RADIUS of any ATM. */
    nearATM: boolean;
    /** Phase 6D: true when walking player is within POLICE_BOOKING_RADIUS of the Booking Desk. */
    nearBookingDesk: boolean;
    /** Phase 14A: true when player is within EVENT_HALL.interactRadius of the hall screen. */
    nearEventHall: boolean;
    /** Phase 14C: true when near a sittable chair (Simple, standing) or currently seated. */
    nearSitChair: boolean;
    /** Phase 14C: true while the player is seated on a chair. */
    isSitting: boolean;
  }) => void;
  playerPosRef: React.MutableRefObject<THREE.Vector3>;
  // Authoritative spawn from the server's gameState. Falls back to a
  // deterministic local pick when not provided (e.g. server-disconnected).
  initialSpawn?: [number, number, number];
  /**
   * Optimistic client-side license check. Returns true when the player is
   * allowed to drive `vehicleId` (licensed, or in an active test with that
   * specific vehicle). The server enforces this independently — this prop
   * only prevents the optimistic `enterVehicle()` call to avoid a brief
   * visual glitch. Omit to disable the gate (e.g. when rp:profile hasn't
   * arrived yet — default behaviour is to allow entry until told otherwise).
   */
  canDriveVehicle?: (vehicleId: string, vehicle?: Partial<VehicleState>) => boolean;
  /**
   * Show an ephemeral toast without a server round-trip. Used to give
   * immediate feedback when the local license gate blocks vehicle entry
   * (the client intentionally does NOT emit vehicleUpdate in that case,
   * so the server never sends its own rp:toast).
   */
  pushToast?: (msg: string, color: string, duration?: number) => void;
  /**
   * Emit rp:interact to the server (e.g. start_driver_test at the Licensing Office).
   * Called when the player presses E near the office entrance.
   */
  emitRpInteract?: (building: string, action: string) => void;
  /**
   * Emit rp:licenseTestCheckpoint when the client detects proximity to the
   * next expected checkpoint. Server validates independently.
   */
  emitLicenseCheckpoint?: (idx: number) => void;
  /**
   * Active driver-license test state from the server profile. Non-null only
   * while a test is in progress. Used to drive checkpoint proximity detection.
   */
  activeTest?: ActiveTest | null;
  /**
   * Phase 3: Emit rp:toggleLock when player presses E near their owned vehicle.
   */
  emitToggleLock?: (vehicleId: string) => void;
  /**
   * Phase 3: Called when player presses E near the dealership entrance.
   * GameScene uses this to toggle the VehicleShopHUD open.
   */
  onOpenShop?: () => void;
  /**
   * Phase 4: Active City Worker job state from the server profile.
   * Non-null while a route is in progress. Drives job checkpoint proximity detection.
   */
  activeJob?: ActiveJob | null;
  /**
   * Phase 4: Emit rp:toggleDuty to clock in/out at the City Worker depot.
   */
  emitToggleDuty?: (job: string) => void;
  /**
   * Phase 4: Emit rp:jobCheckpoint when within range of the next job checkpoint.
   */
  emitJobCheckpoint?: (idx: number) => void;
  /**
   * Phase 5F: Called when player presses E near an ATM.
   * GameScene uses this to open the ATMHUD panel.
   */
  onOpenATM?: () => void;
  /**
   * Phase 7G: Active gang Tag Turf mission state from the server.
   * Non-null while a mission is in progress. Drives tag-point proximity detection.
   */
  activeGangMission?: ActiveGangMission | null;
  /**
   * Phase 7G: Emit rp:gangMissionCheckpoint when within GROVE_TAG_RADIUS of the
   * current tag point. Server validates independently.
   */
  emitGangMissionCheckpoint?: (idx: number) => void;
  /**
   * Phase 8I: When true, suppress the KeyL vehicle lock/unlock toggle so the
   * Mayor's City Ledger panel (also bound to L near City Hall) doesn't also
   * toggle a nearby owned vehicle's lock on the same keypress. UI-only — server
   * vehicle lock authority is unchanged.
   */
  suppressVehicleLockKey?: boolean;
  /**
   * Phase 12A: pending server-authorised teleport target [x,y,z] (house enter/
   * exit). When set, the player snaps there on the next frame and the ref is
   * cleared. GameScene fills this on rp:houseTeleport. Reusing the same
   * pos.current.set primitive as the vehicle-exit reposition.
   */
  houseTeleportRef?: React.MutableRefObject<[number, number, number] | null>;
  /** Which selectable character the local player chose in the lobby. */
  characterId?: CharacterId;
  /** Phase 14A: open the Grand Plaza Hall event-screen HUD (E near the screen). */
  onOpenEventHall?: () => void;
  /**
   * Phase comms: true while the local mic is carrying speech. For the Simple
   * character this surfaces as the "talk" animation when the player is grounded
   * and basically idle (movement/combat/driving all override it). No-op for
   * Classic (no talk clip → falls back to idle).
   */
  voiceSpeaking?: boolean;
}

export default function LocalPlayer({
  myId,
  username,
  vehicles,
  onVehicleUpdate,
  emitPlayerUpdate,
  emitVehicleUpdate,
  npcStumbleRef,
  onUIUpdate,
  playerPosRef,
  initialSpawn,
  canDriveVehicle,
  pushToast,
  emitRpInteract,
  emitLicenseCheckpoint,
  activeTest,
  emitToggleLock,
  onOpenShop,
  activeJob,
  emitToggleDuty,
  emitJobCheckpoint,
  onOpenATM,
  activeGangMission,
  emitGangMissionCheckpoint,
  suppressVehicleLockKey,
  houseTeleportRef,
  characterId,
  onOpenEventHall,
  voiceSpeaking,
}: LocalPlayerProps) {
  const { camera, gl } = useThree();
  const [, getKeys] = useKeyboardControls<Controls>();

  // Phase: per-character animation timing. Attack clip durations differ per
  // character (Classic fight1/fight2 vs Simple punch/kick), so cooldowns,
  // combo windows, and the queued-heavy release all read from the selected
  // character's def instead of the old Classic-only globals.
  const charDef = CHARACTERS[characterId ?? DEFAULT_CHARACTER] ?? CHARACTERS[DEFAULT_CHARACTER];
  const attackLightDurMs = attackDurationMs(charDef, "light");
  const attackHeavyDurMs = attackDurationMs(charDef, "heavy");

  // Prefer the authoritative server spawn (from gameState.players[myId]).
  // Fall back to a deterministic offline pick if the server didn't send one.
  const fallbackSpawn =
    SPAWN_POINTS[myId.charCodeAt(0) % SPAWN_POINTS.length] ?? SPAWN_POINTS[0];
  const spawn = initialSpawn ?? fallbackSpawn;

  const pos = useRef(new THREE.Vector3(spawn[0], spawn[1], spawn[2]));
  const vel = useRef(new THREE.Vector3());
  const isGrounded = useRef(false);
  const playerRotY = useRef(0);
  const cameraYaw = useRef(0);
  const cameraPitch = useRef(0.35);
  // Smoothed aim target. Initialised lazily on the first updateCamera
  // call so it doesn't snap from world-origin on mount. Smoothing this
  // separately from camera.position is the core of the high-speed
  // shake fix — the previous code lerped the body but snapped the
  // lookAt, so any per-tick jitter in vehiclePos.y showed as visible
  // shake/flash on downhill segments.
  const cameraLookAtRef = useRef<THREE.Vector3 | null>(null);
  // Character avatar — root group sits at feet level (pos.y - half
  // height) and is transformed every frame in updatePlayer /
  // updateVehicle. PlaceholderCharacter reads its dynamic state via
  // avatarRuntimeRef so animState changes don't force React re-renders.
  const avatarGroupRef = useRef<THREE.Group>(null!);
  const avatarRuntimeRef = useRef<CharacterRuntime>({
    animState: "idle",
    speed: 0,
    attackSeq: 0,
    attackKind: null,
    attackStartedAt: null,
  });

  // Combat. attackSeq is a monotonic counter that the server clamps
  // upward; bumping it = "play one attack swing". attackKind +
  // attackStartedAt feed resolveAnimState. Cooldowns are tracked
  // per-kind so a heavy swing doesn't lock out a follow-up light jab.
  // prev*Key refs are for rising-edge keyboard detection.
  const attackSeqRef = useRef(0);
  const attackStartedAtRef = useRef<number | null>(null);
  const attackKindRef = useRef<"light" | "heavy" | null>(null);
  const lastLightAtRef = useRef(0);
  const lastHeavyAtRef = useRef(0);
  const prevAttackLightKey = useRef(false);
  const prevAttackHeavyKey = useRef(false);
  const prevLockVehicleKey = useRef(false);
  // Fight combo: clicking "fight" while fight1 (light) is in progress
  // queues fight2 (heavy) to fire the moment fight1's window closes.
  // A second queued click during fight1 is a no-op (only one chained
  // follow-up; matches the spec — "click again fast → second fight
  // animation after he finishes first one").
  const fightQueuedRef = useRef(false);

  // Vehicle state
  const inVehicle = useRef(false);
  const drivingVehicleId = useRef<string | null>(null);
  const vehicleSpeed = useRef(0);
  const vehicleRotY = useRef(0);
  const vehiclePos = useRef(new THREE.Vector3());
  // Smoothed mountain-slope pitch/roll for the driven vehicle. Sampled
  // each tick from getVehicleGroundFrame and lerped so coarse switchback
  // segments don't pop.
  const vehiclePitch = useRef(0);
  const vehicleRoll = useRef(0);
  const vehicleMeshRef = useRef<THREE.Group>(null!);

  // Health & knockback
  const health = useRef(100);
  const knockback = useRef(new THREE.Vector3());
  const damageCooldown = useRef(0);

  const interactCooldown = useRef(0);
  // License-test checkpoint retry state.
  // Tracks { vehicleId, nextCp, lastAttemptAt } so we can:
  //   • keep retrying the same nextCp every ~1000 ms while inside radius
  //   • emit immediately when vehicleId or nextCp changes (server advanced)
  //   • never permanently mark a CP as done before server acceptance
  const cpRetryRef = useRef<{
    vehicleId:     string;
    nextCp:        number;
    lastAttemptAt: number;
  } | null>(null);

  // Emit timing
  const lastEmit = useRef(0);
  // Last time we pushed a HUD/UI update upstream — throttled to ~10Hz
  // for non-state-change fields (px/pz/speed).
  const lastUIEmit = useRef(0);

  // UI state cache (avoid re-render spam)
  // Phase 3: proximity state refs — updated each frame, read by E key handler
  const nearDealershipRef     = useRef(false);
  const nearOwnedVehicleIdRef = useRef<string | null>(null);
  // Phase 4: City Worker depot proximity ref — read by E key handler
  const nearDepotRef          = useRef(false);
  // Phase 5A: Taxi Depot proximity ref — read by E key handler
  const nearTaxiDepotRef      = useRef(false);
  // Phase 5B: Delivery Hub proximity ref — read by E key handler
  const nearDeliveryHubRef    = useRef(false);
  // Phase 5C: Mechanic Garage proximity ref — read by E key handler
  const nearMechanicGarageRef = useRef(false);
  // Phase 5D: Medical Center proximity ref — read by E key handler
  const nearMedicCenterRef    = useRef(false);
  // Phase 5E: Police Station proximity ref — read by E key handler
  const nearPoliceStationRef  = useRef(false);
  // Phase 5F: ATM proximity ref (walk-up; never true while in a vehicle)
  const nearATMRef            = useRef(false);
  // Phase 6D: Booking Desk proximity ref (walk-up; for officer prompt)
  const nearBookingDeskRef    = useRef(false);
  // Phase 14A: Grand Plaza Hall screen proximity ref — read by E key handler
  const nearEventHallRef      = useRef(false);
  // Phase 14C: nearest sittable chair (Simple only), and the chair we're seated
  // on (null = standing). Both read by the frame loop / E handler.
  const nearSitChairRef       = useRef<{ x: number; z: number } | null>(null);
  const sittingChairRef       = useRef<{ x: number; z: number } | null>(null);
  // Mirror onOpenEventHall into a ref so the useFrame closure sees the latest.
  const onOpenEventHallRef    = useRef(onOpenEventHall);
  onOpenEventHallRef.current  = onOpenEventHall;
  // Phase 4: job checkpoint retry state (same pattern as license-test cpRetryRef)
  const jobCpRetryRef = useRef<{ nextCp: number; lastAttemptAt: number } | null>(null);
  // Phase 7G: gang mission tag-point checkpoint retry (walking only, 1s throttle)
  const gangMissionCpRetryRef = useRef<{ nextCp: number; lastAttemptAt: number } | null>(null);

  // Phase 8I: mirror suppressVehicleLockKey into a ref so the useFrame loop
  // reads the latest value (the loop closes over props captured at mount).
  const suppressVehicleLockKeyRef = useRef(!!suppressVehicleLockKey);
  suppressVehicleLockKeyRef.current = !!suppressVehicleLockKey;

  // Phase comms: mirror voiceSpeaking into a ref so the useFrame loop (which
  // closes over props captured at mount) reads the latest value, same pattern
  // as suppressVehicleLockKey above.
  const voiceSpeakingRef = useRef(!!voiceSpeaking);
  voiceSpeakingRef.current = !!voiceSpeaking;

  const uiCache = useRef({
    health: 100,
    speed: 0,
    inVehicle: false,
    showInteract: false,
    vehicleLabel: "",
    px: pos.current.x,
    pz: pos.current.z,
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
    nearBookingDesk: false,
    nearEventHall: false,
    nearSitChair: false,
    isSitting: false,
  });

  // Pointer lock
  useEffect(() => {
    const canvas = gl.domElement;
    const onClick = () => {
      canvas.requestPointerLock();
    };
    canvas.addEventListener("click", onClick);

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        cameraYaw.current -= e.movementX * 0.002;
        cameraPitch.current -= e.movementY * 0.002;
        cameraPitch.current = Math.max(
          -0.15,
          Math.min(0.8, cameraPitch.current),
        );
      }
    };
    document.addEventListener("mousemove", onMouseMove);

    // Combat: Mouse0 = light attack, Mouse2 = heavy. We listen on the
    // canvas (not document) so clicks on HUD overlays don't punch. The
    // contextmenu suppression keeps the browser right-click menu from
    // popping up over the game when binding heavy to Mouse2. tryAttack
    // closes over refs only, so the listener captured at mount stays
    // valid for the life of the component.
    const onMouseDown = (e: MouseEvent) => {
      // Left click = fight (combo): first click plays fight1, second
      // click during fight1 queues fight2 to play right after.
      // Right click = direct fight2 (advanced / no combo).
      if (e.button === 0) tryFightCombo();
      else if (e.button === 2) tryAttack("heavy");
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onContextMenu);

    return () => {
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const keys = getKeys();
    const now = Date.now();

    // Phase 12A: apply a pending server-authorised house teleport (enter/exit).
    // Snap the local avatar (client-authoritative position) to the target the
    // server validated, mirroring the vehicle-exit reposition. Detach from any
    // vehicle first so the player always teleports on foot. Cleared after use.
    const tp = houseTeleportRef?.current;
    if (tp) {
      if (inVehicle.current && drivingVehicleId.current) {
        const vId = drivingVehicleId.current;
        onVehicleUpdate(vId, { driverId: null, speed: 0 });
        emitVehicleUpdate({
          id: vId, driverId: null, speed: 0,
          x: vehiclePos.current.x, y: vehiclePos.current.y, z: vehiclePos.current.z,
        });
        inVehicle.current = false;
        drivingVehicleId.current = null;
        vehicleSpeed.current = 0;
      }
      pos.current.set(tp[0], tp[1], tp[2]);
      vel.current.set(0, 0, 0);
      playerPosRef.current.copy(pos.current);
      if (houseTeleportRef) houseTeleportRef.current = null;
    }

    // Cooldowns
    if (interactCooldown.current > 0) interactCooldown.current -= dt;
    if (damageCooldown.current > 0) damageCooldown.current -= dt;

    // Attack key edge detection (rising-edge so holding F doesn't
    // spam attacks; mouse buttons are handled in the pointer-lock
    // useEffect via onMouseDown). tryAttack itself re-checks inVehicle
    // and the per-kind cooldown.
    const wantLight = keys.attackLight;
    const wantHeavy = keys.attackHeavy;
    if (wantLight && !prevAttackLightKey.current) tryFightCombo();
    if (wantHeavy && !prevAttackHeavyKey.current) tryAttack("heavy");
    prevAttackLightKey.current = wantLight;
    prevAttackHeavyKey.current = wantHeavy;

    // KeyL — lock / unlock nearest owned vehicle (rising-edge, outside vehicle only).
    // Phase 8I: when suppressVehicleLockKey is set (Mayor at City Hall, where L
    // opens the City Ledger), skip the lock toggle so a single L press doesn't
    // also flip a nearby owned vehicle's lock. Lock/unlock works normally
    // everywhere else. Server lock authority is unchanged either way.
    const wantLock = keys.lockVehicle;
    if (
      wantLock &&
      !prevLockVehicleKey.current &&
      !inVehicle.current &&
      interactCooldown.current <= 0 &&
      !suppressVehicleLockKeyRef.current
    ) {
      const ownedVId = nearOwnedVehicleIdRef.current;
      if (ownedVId) {
        emitToggleLock?.(ownedVId);
        interactCooldown.current = 1.0;
      }
    }
    prevLockVehicleKey.current = wantLock;

    // Release the queued fight2 the moment fight1's window closes.
    if (
      fightQueuedRef.current &&
      attackStartedAtRef.current !== null &&
      attackKindRef.current === "light"
    ) {
      const elapsed = now - attackStartedAtRef.current;
      if (elapsed >= attackLightDurMs) {
        fightQueuedRef.current = false;
        // Bypass the heavy cooldown — this is the queued combo follow-up
        // the player explicitly asked for, not a fresh standalone heavy.
        attackSeqRef.current += 1;
        attackStartedAtRef.current = now;
        attackKindRef.current = "heavy";
        lastHeavyAtRef.current = now;
      }
    }

    if (sittingChairRef.current) {
      updateSitting(dt, keys, now);
    } else if (inVehicle.current && drivingVehicleId.current) {
      updateVehicle(dt, keys, now);
    } else {
      updatePlayer(dt, keys, now);
    }

    // (Old road-race checkpoint detection removed — RP job/license checkpoints
    //  are handled by their own systems below.)

    // ── License-test checkpoint proximity — retry throttle ───────────────────
    // Retries the same nextCp every ~1000 ms while inside the 8 m radius until
    // the server accepts it and advances activeTest.nextCp via rp:profileUpdate.
    // State is reset when activeTest becomes null, vehicleId changes, or nextCp
    // advances — allowing an immediate emit on the next in-range tick.
    if (!activeTest) {
      cpRetryRef.current = null;
    } else if (
      inVehicle.current &&
      drivingVehicleId.current === activeTest.vehicleId
    ) {
      const nextCpIdx = activeTest.nextCp;
      if (nextCpIdx < activeTest.checkpoints.length) {
        const [cpx, , cpz] = activeTest.checkpoints[nextCpIdx];
        const dvx = vehiclePos.current.x - cpx;
        const dvz = vehiclePos.current.z - cpz;
        const inRange = dvx * dvx + dvz * dvz < 8 * 8;

        const retry = cpRetryRef.current;
        const keyChanged =
          !retry ||
          retry.vehicleId !== activeTest.vehicleId ||
          retry.nextCp    !== nextCpIdx;

        if (keyChanged) {
          // nextCp advanced (server accepted) or test vehicle changed —
          // clear so next in-range tick emits immediately.
          cpRetryRef.current = null;
        }

        if (inRange) {
          const r = cpRetryRef.current;
          if (!r || now - r.lastAttemptAt >= 1000) {
            cpRetryRef.current = {
              vehicleId:     activeTest.vehicleId,
              nextCp:        nextCpIdx,
              lastAttemptAt: now,
            };
            emitLicenseCheckpoint?.(nextCpIdx);
          }
        }
      }
    }

    // ── Phase 4/5A: job checkpoint proximity — retry throttle ───────────────────
    // City Worker: walking only (inVehicle must be false).
    // Taxi Driver: driving only (inVehicle must be true); uses vehiclePos.
    // Retries the same nextCp every ~1000 ms while within range until the server
    // accepts and advances activeJob.nextCp via rp:profileUpdate.
    if (!activeJob) {
      jobCpRetryRef.current = null;
    } else if (activeJob.job === "city_worker" && !inVehicle.current) {
      const nextCpIdx = activeJob.nextCp;
      if (nextCpIdx < CITY_WORKER_CHECKPOINTS.length) {
        const [cpx, , cpz] = CITY_WORKER_CHECKPOINTS[nextCpIdx];
        const jdx = pos.current.x - cpx;
        const jdz = pos.current.z - cpz;
        const inRange = jdx * jdx + jdz * jdz < JOB_CP_ACCEPT_RADIUS * JOB_CP_ACCEPT_RADIUS;

        const jRetry = jobCpRetryRef.current;
        if (!jRetry || jRetry.nextCp !== nextCpIdx) {
          // nextCp advanced — clear so next in-range tick emits immediately
          jobCpRetryRef.current = null;
        }

        if (inRange) {
          const r = jobCpRetryRef.current;
          if (!r || now - r.lastAttemptAt >= 1000) {
            jobCpRetryRef.current = { nextCp: nextCpIdx, lastAttemptAt: now };
            emitJobCheckpoint?.(nextCpIdx);
          }
        }
      }
    } else if (activeJob.job === "taxi_driver" && inVehicle.current) {
      // Phase 5A: taxi uses vehicle position (server uses the same vehiclePos)
      const nextCpIdx = activeJob.nextCp;
      if (nextCpIdx < activeJob.checkpoints.length) {
        const [cpx, , cpz] = activeJob.checkpoints[nextCpIdx];
        const tdx = vehiclePos.current.x - cpx;
        const tdz = vehiclePos.current.z - cpz;
        const inRange = tdx * tdx + tdz * tdz < TAXI_CP_ACCEPT_RADIUS * TAXI_CP_ACCEPT_RADIUS;

        const tRetry = jobCpRetryRef.current;
        if (!tRetry || tRetry.nextCp !== nextCpIdx) {
          jobCpRetryRef.current = null;
        }

        if (inRange) {
          const r = jobCpRetryRef.current;
          if (!r || now - r.lastAttemptAt >= 1000) {
            jobCpRetryRef.current = { nextCp: nextCpIdx, lastAttemptAt: now };
            emitJobCheckpoint?.(nextCpIdx);
          }
        }
      }
    } else if (activeJob.job === "delivery_driver" && inVehicle.current) {
      // Phase 5B: delivery uses vehicle position — pickup(idx=0) + dropoffs(idx=1..N)
      const nextCpIdx = activeJob.nextCp;
      if (nextCpIdx < activeJob.checkpoints.length) {
        const [cpx, , cpz] = activeJob.checkpoints[nextCpIdx];
        const ddx = vehiclePos.current.x - cpx;
        const ddz = vehiclePos.current.z - cpz;
        const inRange = ddx * ddx + ddz * ddz < DELIVERY_CP_ACCEPT_RADIUS * DELIVERY_CP_ACCEPT_RADIUS;

        const dRetry = jobCpRetryRef.current;
        if (!dRetry || dRetry.nextCp !== nextCpIdx) {
          jobCpRetryRef.current = null;
        }

        if (inRange) {
          const r = jobCpRetryRef.current;
          if (!r || now - r.lastAttemptAt >= 1000) {
            jobCpRetryRef.current = { nextCp: nextCpIdx, lastAttemptAt: now };
            emitJobCheckpoint?.(nextCpIdx);
          }
        }
      }
    } else if (activeJob.job === "mechanic" && inVehicle.current) {
      // Phase 5C: mechanic uses vehicle position.
      // checkpoints[0] and checkpoints[1] are identical (same target); the
      // server uses nextCp to distinguish travel (0) from repair (1).
      const nextCpIdx = activeJob.nextCp;
      if (nextCpIdx < activeJob.checkpoints.length) {
        const [cpx, , cpz] = activeJob.checkpoints[nextCpIdx];
        const mdx = vehiclePos.current.x - cpx;
        const mdz = vehiclePos.current.z - cpz;
        const inRange = mdx * mdx + mdz * mdz < MECHANIC_SERVICE_RADIUS * MECHANIC_SERVICE_RADIUS;

        const mRetry = jobCpRetryRef.current;
        // Idx 1 retries every 1 s (repair timer server-side); idx 0 once on arrival.
        const retryInterval = nextCpIdx === 1 ? 1000 : 1000;

        if (inRange) {
          const r = jobCpRetryRef.current;
          if (!r || r.nextCp !== nextCpIdx || now - r.lastAttemptAt >= retryInterval) {
            jobCpRetryRef.current = { nextCp: nextCpIdx, lastAttemptAt: now };
            emitJobCheckpoint?.(nextCpIdx);
          }
        } else if (mRetry?.nextCp === nextCpIdx) {
          // Left the radius — allow re-entry to fire again
          jobCpRetryRef.current = null;
        }
      }
    } else if (activeJob.job === "medic" && inVehicle.current) {
      // Phase 5D: medic uses vehicle position.
      // checkpoints[0] and [1] share the same patient position (respond + treat);
      // checkpoints[2] is the ER bay (transport). All stages retry every 1s.
      const nextCpIdx = activeJob.nextCp;
      if (nextCpIdx < activeJob.checkpoints.length) {
        const [cpx, , cpz] = activeJob.checkpoints[nextCpIdx];
        const meddx = vehiclePos.current.x - cpx;
        const meddz = vehiclePos.current.z - cpz;
        const inRange = meddx * meddx + meddz * meddz < MEDIC_SERVICE_RADIUS * MEDIC_SERVICE_RADIUS;

        const medRetry = jobCpRetryRef.current;

        if (inRange) {
          const r = jobCpRetryRef.current;
          if (!r || r.nextCp !== nextCpIdx || now - r.lastAttemptAt >= 1000) {
            jobCpRetryRef.current = { nextCp: nextCpIdx, lastAttemptAt: now };
            emitJobCheckpoint?.(nextCpIdx);
          }
        } else if (medRetry?.nextCp === nextCpIdx) {
          // Left the radius — allow re-entry to fire again
          jobCpRetryRef.current = null;
        }
      }
    } else if (activeJob.job === "police_patrol" && inVehicle.current) {
      // Phase 5E: police patrol uses vehicle position.
      // 4 sampled patrol points; standard retry-every-1s pattern.
      const nextCpIdx = activeJob.nextCp;
      if (nextCpIdx < activeJob.checkpoints.length) {
        const [cpx, , cpz] = activeJob.checkpoints[nextCpIdx];
        const ppoldx = vehiclePos.current.x - cpx;
        const ppoldz = vehiclePos.current.z - cpz;
        const inRange = ppoldx * ppoldx + ppoldz * ppoldz < POLICE_PATROL_ACCEPT_RADIUS * POLICE_PATROL_ACCEPT_RADIUS;
        const ppRetry = jobCpRetryRef.current;
        if (inRange) {
          const r = jobCpRetryRef.current;
          if (!r || r.nextCp !== nextCpIdx || now - r.lastAttemptAt >= 1000) {
            jobCpRetryRef.current = { nextCp: nextCpIdx, lastAttemptAt: now };
            emitJobCheckpoint?.(nextCpIdx);
          }
        } else if (ppRetry?.nextCp === nextCpIdx) {
          jobCpRetryRef.current = null;
        }
      }
    } else {
      // Mismatched mode — reset retry
      jobCpRetryRef.current = null;
    }

    // ── Phase 7G: gang mission tag-point proximity — retry throttle ──────────────
    // Walking only (not in vehicle) — per spec "player walks to each tag point".
    // Driving to a tag point will never emit a checkpoint; the mission stays open
    // until the player exits the vehicle and walks into range.
    // Uses player pos; server re-validates with its own authoritative position.
    // 1s retry throttle while within GROVE_TAG_RADIUS.
    if (!activeGangMission || inVehicle.current) {
      gangMissionCpRetryRef.current = null;
    } else {
      const nextIdx = activeGangMission.nextIdx;
      if (nextIdx < activeGangMission.points.length) {
        const [tpx, , tpz] = activeGangMission.points[nextIdx]!;
        const tpdx = pos.current.x - tpx;
        const tpdz = pos.current.z - tpz;
        const inRange = tpdx * tpdx + tpdz * tpdz < GROVE_TAG_RADIUS * GROVE_TAG_RADIUS;

        const gmRetry = gangMissionCpRetryRef.current;
        if (!gmRetry || gmRetry.nextCp !== nextIdx) {
          // nextIdx advanced (server accepted) — clear so next tick emits immediately
          gangMissionCpRetryRef.current = null;
        }

        if (inRange) {
          const r = gangMissionCpRetryRef.current;
          if (!r || now - r.lastAttemptAt >= 1000) {
            gangMissionCpRetryRef.current = { nextCp: nextIdx, lastAttemptAt: now };
            emitGangMissionCheckpoint?.(nextIdx);
          }
        }
      }
    }

    // Update playerPosRef for minimap / HUD
    const curPos = inVehicle.current ? vehiclePos.current : pos.current;
    playerPosRef.current.copy(curPos);

    // UI update (throttled to avoid spam)
    const nearVehicle = findNearestVehicle(curPos);
    const showInteract = !inVehicle.current && nearVehicle !== null;
    const speed = inVehicle.current
      ? vehicleSpeed.current
      : vel.current.length();

    // Proximity to Licensing Office entrance (walking player only, 6m radius)
    // Phase 9B-3: measured to the DMV door (matches server start-test gate).
    const [offX, , offZ] = LICENSING_OFFICE_DOOR;
    const odx = curPos.x - offX;
    const odz = curPos.z - offZ;
    const nearOffice =
      !inVehicle.current && odx * odx + odz * odz < 6 * 6;

    // Phase 3: dealership proximity (also writes to ref for E key handler)
    // Phase 9A Batch E: measured to the dealership door (matches server gate).
    const [dlrX, , dlrZ] = DEALERSHIP_DOOR;
    const ddx = curPos.x - dlrX;
    const ddz = curPos.z - dlrZ;
    const nearDealership =
      !inVehicle.current && ddx * ddx + ddz * ddz < 8 * 8;
    nearDealershipRef.current = nearDealership;

    // Phase 4: depot proximity (also writes to ref for E key handler)
    // Phase 9A Batch E: measured to the depot door (matches server gate).
    const [depX, , depZ] = CITY_WORKER_DEPOT_DOOR;
    const depdx = curPos.x - depX;
    const depdz = curPos.z - depZ;
    const nearDepot =
      !inVehicle.current &&
      depdx * depdx + depdz * depdz < CITY_WORKER_DEPOT_RADIUS * CITY_WORKER_DEPOT_RADIUS;
    nearDepotRef.current = nearDepot;

    // Phase 5A: Taxi Depot proximity (also writes to ref for E key handler)
    const [tdepX, , tdepZ] = TAXI_DEPOT_DOOR;
    const tdepdx = curPos.x - tdepX;
    const tdepdz = curPos.z - tdepZ;
    const nearTaxiDepot =
      !inVehicle.current &&
      tdepdx * tdepdx + tdepdz * tdepdz < TAXI_DEPOT_RADIUS * TAXI_DEPOT_RADIUS;
    nearTaxiDepotRef.current = nearTaxiDepot;

    // Phase 5B: Delivery Hub proximity (also writes to ref for E key handler)
    // Phase 9B-2: measured to the hub door (matches server gate; payout origin unchanged).
    const [dhubX, , dhubZ] = DELIVERY_HUB_DOOR;
    const dhubdx = curPos.x - dhubX;
    const dhubdz = curPos.z - dhubZ;
    const nearDeliveryHub =
      !inVehicle.current &&
      dhubdx * dhubdx + dhubdz * dhubdz < DELIVERY_HUB_RADIUS * DELIVERY_HUB_RADIUS;
    nearDeliveryHubRef.current = nearDeliveryHub;

    // Phase 5C: Mechanic Garage proximity (also writes to ref for E key handler)
    // Phase 9A Batch E: measured to the garage door (matches server gate).
    const [mgX, , mgZ] = MECHANIC_GARAGE_DOOR;
    const mgdx = curPos.x - mgX;
    const mgdz = curPos.z - mgZ;
    const nearMechanicGarage =
      !inVehicle.current &&
      mgdx * mgdx + mgdz * mgdz < MECHANIC_GARAGE_RADIUS * MECHANIC_GARAGE_RADIUS;
    nearMechanicGarageRef.current = nearMechanicGarage;

    // Phase 5D: Medical Center proximity (also writes to ref for E key handler)
    // Phase 9A Batch E: measured to the door (matches server gate; payout origin unchanged).
    const [mcX, , mcZ] = MEDIC_CENTER_DOOR;
    const mcdx = curPos.x - mcX;
    const mcdz = curPos.z - mcZ;
    const nearMedicCenter =
      !inVehicle.current &&
      mcdx * mcdx + mcdz * mcdz < MEDIC_CENTER_RADIUS * MEDIC_CENTER_RADIUS;
    nearMedicCenterRef.current = nearMedicCenter;

    // Phase 5E: Police Station proximity (also writes to ref for E key handler)
    // Phase 9B-4b: measured to the station door (matches server gate).
    const [psX, , psZ] = POLICE_STATION_DOOR;
    const psdx = curPos.x - psX;
    const psdz = curPos.z - psZ;
    const nearPoliceStation =
      !inVehicle.current &&
      psdx * psdx + psdz * psdz < POLICE_STATION_RADIUS * POLICE_STATION_RADIUS;
    nearPoliceStationRef.current = nearPoliceStation;

    // Phase 5F: ATM proximity — any ATM within ATM_INTERACT_RADIUS (walk-up only)
    let nearATM = false;
    if (!inVehicle.current) {
      const r2 = ATM_INTERACT_RADIUS * ATM_INTERACT_RADIUS;
      for (const { pos: aPos } of ATM_LOCATIONS) {
        const adx = curPos.x - aPos[0];
        const adz = curPos.z - aPos[2];
        if (adx * adx + adz * adz < r2) {
          nearATM = true;
          break;
        }
      }
    }
    nearATMRef.current = nearATM;

    // Phase 6D: Booking Desk proximity (walk-up only; officer prompt)
    const [bdX, , bdZ] = POLICE_BOOKING_DESK_POS;
    const bddx = curPos.x - bdX;
    const bddz = curPos.z - bdZ;
    const nearBookingDesk =
      !inVehicle.current &&
      bddx * bddx + bddz * bddz < POLICE_BOOKING_RADIUS * POLICE_BOOKING_RADIUS;
    nearBookingDeskRef.current = nearBookingDesk;

    // Phase 14A: Grand Plaza Hall — near the giant screen (walk-up only).
    const [ehX, ehZ] = EVENT_HALL.screen;
    const ehdx = curPos.x - ehX;
    const ehdz = curPos.z - ehZ;
    const nearEventHall =
      !inVehicle.current &&
      ehdx * ehdx + ehdz * ehdz < EVENT_HALL.interactRadius * EVENT_HALL.interactRadius;
    nearEventHallRef.current = nearEventHall;

    // Phase 14C: nearest sittable chair (Simple character, on foot, not already
    // seated). Drives the "E — Sit" prompt and the sit action.
    const isSitting = sittingChairRef.current !== null;
    if (!isSitting && !inVehicle.current && charDef.id === "simple") {
      nearSitChairRef.current = nearestEventHallChair(curPos.x, curPos.z);
    } else {
      nearSitChairRef.current = null;
    }
    const nearSitChair = isSitting || nearSitChairRef.current !== null;

    // Phase 3: nearest owned vehicle within 6 m (for lock/unlock prompt)
    let nearOwnedVehicleId: string | null = null;
    if (!inVehicle.current) {
      let bestDist2 = 6 * 6;
      for (const v of Object.values(vehicles)) {
        if (!v.owned) continue;
        const vdx = curPos.x - v.x;
        const vdz = curPos.z - v.z;
        const d2 = vdx * vdx + vdz * vdz;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          nearOwnedVehicleId = v.id;
        }
      }
    }
    nearOwnedVehicleIdRef.current = nearOwnedVehicleId;

    const newUI = {
      health: health.current,
      speed,
      inVehicle: inVehicle.current,
      showInteract,
      vehicleLabel: nearVehicle ? nearVehicle.id : "",
      px: curPos.x,
      pz: curPos.z,
      nearOffice,
      nearDealership,
      nearOwnedVehicleId,
      nearDepot,
      nearTaxiDepot,
      nearDeliveryHub,
      nearMechanicGarage,
      nearMedicCenter,
      nearPoliceStation,
      nearATM,
      nearBookingDesk,
      nearEventHall,
      nearSitChair,
      isSitting,
    };

    // Throttled per-field UI diff. JSON.stringify on a 10-key object
    // every frame at 60fps was a ~5% main-thread cost in the audit;
    // primitive comparisons + a 100ms throttle keeps the HUD responsive
    // (10Hz minimap / speedometer is more than enough for the eye)
    // without re-stringifying the world.
    const cache = uiCache.current;
    const movedEnough =
      Math.abs(newUI.px - cache.px) > 0.05 ||
      Math.abs(newUI.pz - cache.pz) > 0.05;
    const speedDelta = Math.abs(newUI.speed - cache.speed) > 0.1;
    const stateChanged =
      newUI.health !== cache.health ||
      newUI.inVehicle !== cache.inVehicle ||
      newUI.showInteract !== cache.showInteract ||
      newUI.vehicleLabel !== cache.vehicleLabel ||
      newUI.nearOffice !== cache.nearOffice ||
      newUI.nearDealership !== cache.nearDealership ||
      newUI.nearOwnedVehicleId !== cache.nearOwnedVehicleId ||
      newUI.nearDepot !== cache.nearDepot ||
      newUI.nearTaxiDepot !== cache.nearTaxiDepot ||
      newUI.nearDeliveryHub !== cache.nearDeliveryHub ||
      newUI.nearMechanicGarage !== cache.nearMechanicGarage ||
      newUI.nearMedicCenter !== cache.nearMedicCenter ||
      newUI.nearPoliceStation !== cache.nearPoliceStation ||
      newUI.nearATM !== cache.nearATM ||
      newUI.nearBookingDesk !== cache.nearBookingDesk ||
      newUI.nearEventHall !== cache.nearEventHall ||
      newUI.nearSitChair !== cache.nearSitChair ||
      newUI.isSitting !== cache.isSitting;
    const sinceLast = now - lastUIEmit.current;
    if (
      stateChanged ||
      ((movedEnough || speedDelta) && sinceLast > 100)
    ) {
      uiCache.current = newUI;
      lastUIEmit.current = now;
      onUIUpdate(newUI);
    }
  });

  function findNearestVehicle(from: THREE.Vector3): VehicleState | null {
    let nearest: VehicleState | null = null;
    let minDist = INTERACT_DIST;
    for (const v of Object.values(vehicles)) {
      if (v.driverId && v.driverId !== myId) continue;
      const dx = from.x - v.x;
      const dz = from.z - v.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minDist) {
        minDist = d;
        nearest = v;
      }
    }
    return nearest;
  }

  // Build OBB list of all vehicles the local walking player should
  // collide with. Excludes the local driving vehicle (we're inside it
  // when driving, and we never collide with our own body when walking).
  function gatherVehicleObbs(margin: number): OBB[] {
    const out: OBB[] = [];
    for (const v of Object.values(vehicles)) {
      if (v.driverId === myId) continue;
      out.push(vehicleObb(v, margin));
    }
    return out;
  }

  function applyKnockback(dx: number, dz: number, magnitude: number) {
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) return;
    const force = Math.min(15, magnitude * 0.6);
    knockback.current.x += (dx / len) * force;
    knockback.current.z += (dz / len) * force;
  }

  function takeDamage(amount: number) {
    if (damageCooldown.current > 0) return;
    health.current = Math.max(0, health.current - amount);
    damageCooldown.current = DAMAGE_COOLDOWN_MS / 1000;
  }

  // Trigger a single attack swing. Bumps attackSeq so the network
  // replicates the swing exactly once per kind, even if the previous
  // packet hasn't been ack'd yet. Gated by per-kind cooldown and by
  // not being inside a vehicle.
  function tryAttack(kind: "light" | "heavy") {
    if (inVehicle.current) return;
    const tNow = Date.now();
    // Per-kind cooldown: a recent heavy doesn't gate a fresh light,
    // and vice versa. Each kind has its own timer.
    const lastRef = kind === "heavy" ? lastHeavyAtRef : lastLightAtRef;
    const cd =
      kind === "heavy" ? attackHeavyDurMs : attackLightDurMs;
    if (tNow - lastRef.current < cd) return;
    lastRef.current = tNow;
    attackSeqRef.current += 1;
    attackStartedAtRef.current = tNow;
    attackKindRef.current = kind;
  }

  // Combo entry point. Called from left-click and the F key.
  //   - Idle / no current attack → start fight1 (light).
  //   - Currently in fight1's window → queue fight2 (heavy) for after.
  //   - Currently in fight2 → ignore (combo is two-deep by spec).
  function tryFightCombo() {
    if (inVehicle.current) return;
    const tNow = Date.now();
    const startedAt = attackStartedAtRef.current;
    if (startedAt !== null && attackKindRef.current !== null) {
      const dur =
        attackKindRef.current === "heavy"
          ? attackHeavyDurMs
          : attackLightDurMs;
      const elapsed = tNow - startedAt;
      if (elapsed < dur) {
        if (attackKindRef.current === "light") {
          fightQueuedRef.current = true;
        }
        return;
      }
    }
    tryAttack("light");
  }

  // Phase 14C: while seated on a hall chair the player is locked to the seat
  // anchor playing the "sit" loop. Pressing E (cooldown-gated) or any movement
  // key stands the player up into the clear gap in front of the chair. Position
  // + animState are emitted so other players see the seated avatar.
  function updateSitting(
    dt: number,
    keys: ReturnType<typeof getKeys>,
    now: number,
  ) {
    const chair = sittingChairRef.current;
    if (!chair) return;

    const wantsUp =
      (keys.interact && interactCooldown.current <= 0) ||
      keys.forward || keys.back || keys.left || keys.right || keys.jump;

    if (wantsUp) {
      // Stand into the clear gap north (−Z) of the chair, toward the aisle.
      const standZ = chair.z - EVENT_HALL_SIT.standBackZ;
      const groundY = getVehicleGroundY(chair.x, standZ);
      pos.current.set(chair.x, groundY + PLAYER_HEIGHT / 2, standZ);
      vel.current.set(0, 0, 0);
      isGrounded.current = true;
      sittingChairRef.current = null;
      interactCooldown.current = 0.5;
      playerPosRef.current.copy(pos.current);
      return;
    }

    // Stay seated — lock the body to the seat anchor (with lateral/forward nudge).
    const seatX = chair.x + EVENT_HALL_SIT.lateral;
    const seatZ = chair.z + EVENT_HALL_SIT.forward;
    const groundY = getVehicleGroundY(chair.x, chair.z);
    pos.current.set(seatX, groundY + PLAYER_HEIGHT / 2, seatZ);
    vel.current.set(0, 0, 0);
    isGrounded.current = true;
    playerRotY.current = EVENT_HALL_SIT.faceY;
    playerPosRef.current.copy(pos.current);

    // Avatar: seated pose. Root sits at floor + tunable yOffset so the hips rest
    // on the seat pad; rotation faces the screen (+Z).
    const runtime = avatarRuntimeRef.current;
    runtime.animState = "sit";
    runtime.speed = 0;
    runtime.attackSeq = attackSeqRef.current;
    runtime.attackKind = null;
    runtime.attackStartedAt = null;
    if (avatarGroupRef.current) {
      avatarGroupRef.current.position.set(
        chair.x,
        groundY + EVENT_HALL_SIT.yOffset,
        chair.z + EVENT_HALL_SIT.forward,
      );
      avatarGroupRef.current.rotation.y = EVENT_HALL_SIT.faceY;
      avatarGroupRef.current.visible = true;
    }

    updateCamera(pos.current, dt, "walking");

    if (now - lastEmit.current > EMIT_RATE) {
      lastEmit.current = now;
      emitPlayerUpdate({
        id: myId,
        username,
        x: pos.current.x,
        y: pos.current.y,
        z: pos.current.z,
        rotY: playerRotY.current,
        isInVehicle: false,
        vehicleId: null,
        health: health.current,
        isRunning: false,
        animState: "sit",
        attackSeq: attackSeqRef.current,
        attackKind: null,
        attackStartedAt: null,
        isGrounded: true,
        moveSpeed: 0,
      });
    }
  }

  function updatePlayer(
    dt: number,
    keys: ReturnType<typeof getKeys>,
    now: number,
  ) {
    // Camera-relative movement
    const yaw = cameraYaw.current;
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let mx = 0;
    let mz = 0;
    if (keys.forward) {
      mx += fwdX;
      mz += fwdZ;
    }
    if (keys.back) {
      mx -= fwdX;
      mz -= fwdZ;
    }
    if (keys.left) {
      mx -= rightX;
      mz -= rightZ;
    }
    if (keys.right) {
      mx += rightX;
      mz += rightZ;
    }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
      const speed = keys.run ? RUN_SPEED : WALK_SPEED;
      vel.current.x = mx * speed;
      vel.current.z = mz * speed;
      playerRotY.current = Math.atan2(mx, mz);
    } else {
      vel.current.x *= 0.8;
      vel.current.z *= 0.8;
    }

    // Apply pending knockback then decay it
    vel.current.x += knockback.current.x;
    vel.current.z += knockback.current.z;
    knockback.current.multiplyScalar(KNOCKBACK_DECAY);
    if (knockback.current.lengthSq() < 1e-4) knockback.current.set(0, 0, 0);

    // Gravity
    vel.current.y += GRAVITY * dt;
    if (isGrounded.current && keys.jump) {
      vel.current.y = JUMP_FORCE;
      isGrounded.current = false;
    }

    // Move with axis-separated collision (sliding) against buildings AND
    // any vehicle that is not the local driver's car.
    let nx = pos.current.x + vel.current.x * dt;
    let nz = pos.current.z + vel.current.z * dt;

    const obstacles = gatherVehicleObbs(VEHICLE_PLAYER_MARGIN);

    // Phase 14D: current feet height — lets the raised stage block walk-in from
    // the floor while allowing a jumping/standing player onto its top.
    const feetY = pos.current.y - PLAYER_HEIGHT / 2;

    // Try X first
    if (
      playerHitsAnyBuilding(nx, pos.current.z) ||
      playerHitsAnyObstacle(nx, pos.current.z) ||
      playerHitsAnyRpWall(nx, pos.current.z) ||
      playerHitsAnyHouse(nx, pos.current.z) ||
      playerHitsAnyHallWall(nx, pos.current.z) ||
      playerHitsAnyHallChair(nx, pos.current.z) ||
      playerHitsEventHallStageSide(nx, pos.current.z, feetY) ||
      obstacles.some((o) =>
        circleVsObb({ x: nx, z: pos.current.z, r: PLAYER_BODY_RADIUS }, o),
      )
    ) {
      nx = pos.current.x;
      vel.current.x = 0;
    }
    // Then Z
    if (
      playerHitsAnyBuilding(nx, nz) ||
      playerHitsAnyObstacle(nx, nz) ||
      playerHitsAnyRpWall(nx, nz) ||
      playerHitsAnyHouse(nx, nz) ||
      playerHitsAnyHallWall(nx, nz) ||
      playerHitsAnyHallChair(nx, nz) ||
      playerHitsEventHallStageSide(nx, nz, feetY) ||
      obstacles.some((o) =>
        circleVsObb({ x: nx, z: nz, r: PLAYER_BODY_RADIUS }, o),
      )
    ) {
      nz = pos.current.z;
      vel.current.z = 0;
    }

    // NPC body push-out (soft separation, not lethal). Cheap O(N) loop
    // — there are only ~12 NPCs.
    const minNpcDist = PLAYER_BODY_RADIUS + NPC_BODY_RADIUS;
    for (const route of NPC_ROUTES) {
      const npc = npcPositionAt(route, now);
      const dxN = nx - npc.x;
      const dzN = nz - npc.z;
      const distSq = dxN * dxN + dzN * dzN;
      if (distSq < minNpcDist * minNpcDist && distSq > 1e-4) {
        const d = Math.sqrt(distSq);
        const push = minNpcDist - d;
        nx += (dxN / d) * push;
        nz += (dzN / d) * push;
      }
    }

    // Clamp to world bounds (small buffer for player body radius)
    const WALK_LIMIT = WORLD_HALF - 1;
    nx = Math.max(-WALK_LIMIT, Math.min(WALK_LIMIT, nx));
    nz = Math.max(-WALK_LIMIT, Math.min(WALK_LIMIT, nz));

    pos.current.x = nx;
    pos.current.z = nz;
    pos.current.y += vel.current.y * dt;

    // Ground — sample the mountain road elevation system so the player
    // stands on the slope when walking onto an elevated road. Returns
    // 0 outside mountain country, falling back to flat-ground behaviour.
    let groundY = getVehicleGroundY(nx, nz);
    // Phase 14D: inside the stage footprint the standable surface is the stage
    // TOP. The side collision prevents entering at floor level, so being inside
    // the footprint means the player jumped on — snap them to the stage top, and
    // walking off the edge drops them back to floor height cleanly next frame.
    if (isInsideEventHallStage(nx, nz)) {
      groundY = Math.max(groundY, EVENT_HALL_STAGE.topY);
    }
    const standingY = groundY + PLAYER_HEIGHT / 2;
    if (pos.current.y <= standingY) {
      pos.current.y = standingY;
      vel.current.y = 0;
      isGrounded.current = true;
    } else {
      isGrounded.current = false;
    }

    // ===== Damage detection =====
    // Ambient AI cars hitting us → directional knockback + damage.
    // Threshold-gated so slow vehicles in parking lots are harmless.
    if (damageCooldown.current <= 0) {
      const playerCircle = {
        x: pos.current.x,
        z: pos.current.z,
        r: PLAYER_BODY_RADIUS,
      };
      let hitBy: { x: number; z: number; speed: number } | null = null;

      // Ambient traffic (deterministic, no Socket.io state)
      outer: for (const route of TRAFFIC_ROUTES) {
        for (const seed of route.cars) {
          const a = ambientCarStateAt(route, seed, now);
          if (a.speed < VEHICLE_HIT_PLAYER_MIN_SPEED) continue;
          const o = vehicleObb(
            { x: a.x, z: a.z, rotY: a.rotY, variant: a.variant },
            VEHICLE_PLAYER_MARGIN,
          );
          if (circleVsObb(playerCircle, o)) {
            hitBy = { x: a.x, z: a.z, speed: a.speed };
            break outer;
          }
        }
      }

      // Remote-driven cars (only count if actually moving). Local
      // driving vehicle is excluded because we're not walking then.
      if (!hitBy) {
        for (const v of Object.values(vehicles)) {
          if (!v.driverId || v.driverId === myId) continue;
          const sp = Math.abs(v.speed);
          if (sp < VEHICLE_HIT_PLAYER_MIN_SPEED) continue;
          const o = vehicleObb(v, VEHICLE_PLAYER_MARGIN);
          if (circleVsObb(playerCircle, o)) {
            hitBy = { x: v.x, z: v.z, speed: sp };
            break;
          }
        }
      }

      if (hitBy) {
        applyKnockback(
          pos.current.x - hitBy.x,
          pos.current.z - hitBy.z,
          hitBy.speed,
        );
        // Damage scales with impact speed but is bounded.
        takeDamage(Math.min(25, Math.max(5, Math.round(hitBy.speed * 1.5))));
      }
    }

    // ===== Character animation runtime + avatar transform =====
    // Compute the per-frame animation state, push it (with derived
    // speed and current attack fields) into the avatar runtime that
    // PlaceholderCharacter reads each frame, and place the avatar
    // group at the player's feet (root y = pos.y - PLAYER_HEIGHT/2).
    const horizSpeed = Math.hypot(vel.current.x, vel.current.z);
    const animState = resolveAnimState({
      inVehicle: false,
      now,
      attackStartedAt: attackStartedAtRef.current,
      attackKind: attackKindRef.current,
      grounded: isGrounded.current,
      velY: vel.current.y,
      horizSpeed,
      attackDurationMs:
        attackKindRef.current === "heavy" ? attackHeavyDurMs : attackLightDurMs,
      // Talk animation is Simple-only; Classic has no talk clip (falls back to
      // idle). Lowest priority — driving/attack/jump/fall/walk/run all win.
      speaking: charDef.id === "simple" && voiceSpeakingRef.current,
    });
    const runtime = avatarRuntimeRef.current;
    runtime.animState = animState;
    runtime.speed = horizSpeed;
    runtime.attackSeq = attackSeqRef.current;
    runtime.attackKind = attackKindRef.current;
    runtime.attackStartedAt = attackStartedAtRef.current;
    if (avatarGroupRef.current) {
      avatarGroupRef.current.position.set(
        pos.current.x,
        pos.current.y - PLAYER_HEIGHT / 2,
        pos.current.z,
      );
      avatarGroupRef.current.rotation.y = playerRotY.current;
      avatarGroupRef.current.visible = true;
    }

    // Camera
    updateCamera(pos.current, dt, "walking");

    // Enter vehicle / Licensing Office / Dealership / Lock-Unlock interact
    if (keys.interact && interactCooldown.current <= 0) {
      // Phase 14C: sit on the nearest chair (Simple only). Highest priority —
      // takes the E press before vehicle/building interactions and returns.
      if (nearSitChairRef.current && charDef.id === "simple") {
        sittingChairRef.current = { ...nearSitChairRef.current };
        nearSitChairRef.current = null;
        vel.current.set(0, 0, 0);
        interactCooldown.current = 0.6;
        return;
      }
      const near = findNearestVehicle(pos.current);
      if (near && !near.driverId) {
        // Optimistic license gate (Phase 1B). If canDriveVehicle is not yet
        // provided (rp:profile hasn't arrived) we allow entry — the server
        // will reject and send rp:toast if the player isn't licensed.
        if (canDriveVehicle && !canDriveVehicle(near.id, near)) {
          // Blocked by the optimistic gate. Show feedback locally.
          const reason = near.owned && near.locked
            ? "That vehicle is locked. Get closer and press L to unlock it first."
            : "Driver License required. Visit the Licensing Office.";
          pushToast?.(reason, "red", 4000);
          interactCooldown.current = 1.0;
        } else {
          enterVehicle(near);
          interactCooldown.current = 0.5;
        }
      } else {
        // No unoccupied vehicle nearby — check Licensing Office (Phase 2) or dealership (Phase 3).
        // Phase 9B-3: measured to the DMV door (matches server start-test gate).
        const [offX2, , offZ2] = LICENSING_OFFICE_DOOR;
        const odx2 = pos.current.x - offX2;
        const odz2 = pos.current.z - offZ2;
        if (odx2 * odx2 + odz2 * odz2 < 6 * 6) {
          emitRpInteract?.("licensing_office", "start_driver_test");
          interactCooldown.current = 1.0;
        } else if (nearDepotRef.current) {
          // Phase 4: clock in/out at City Worker depot.
          emitToggleDuty?.("city_worker");
          interactCooldown.current = 1.0;
        } else if (nearTaxiDepotRef.current) {
          // Phase 5A: clock in/out at Taxi Depot.
          emitToggleDuty?.("taxi_driver");
          interactCooldown.current = 1.0;
        } else if (nearDeliveryHubRef.current) {
          // Phase 5B: clock in/out at Delivery Hub.
          emitToggleDuty?.("delivery_driver");
          interactCooldown.current = 1.0;
        } else if (nearMechanicGarageRef.current) {
          // Phase 5C: clock in/out at Mechanic Garage.
          emitToggleDuty?.("mechanic");
          interactCooldown.current = 1.0;
        } else if (nearMedicCenterRef.current) {
          // Phase 5D: clock in/out at Medical Center.
          emitToggleDuty?.("medic");
          interactCooldown.current = 1.0;
        } else if (nearPoliceStationRef.current) {
          // Phase 5E: clock in/out at Police Station.
          emitToggleDuty?.("police_patrol");
          interactCooldown.current = 1.0;
        } else if (nearATMRef.current) {
          // Phase 5F: open ATM panel.
          onOpenATM?.();
          interactCooldown.current = 0.5;
        } else if (nearDealershipRef.current) {
          // Phase 3: open dealership shop.
          onOpenShop?.();
          interactCooldown.current = 0.5;
        } else if (nearEventHallRef.current) {
          // Phase 14A: open the Grand Plaza Hall event-screen HUD.
          onOpenEventHallRef.current?.();
          interactCooldown.current = 0.5;
        }
      }
    }

    // Emit
    if (now - lastEmit.current > EMIT_RATE) {
      lastEmit.current = now;
      emitPlayerUpdate({
        id: myId,
        username,
        x: pos.current.x,
        y: pos.current.y,
        z: pos.current.z,
        rotY: playerRotY.current,
        isInVehicle: false,
        vehicleId: null,
        health: health.current,
        isRunning: keys.run,
        animState,
        attackSeq: attackSeqRef.current,
        attackKind: attackKindRef.current,
        attackStartedAt: attackStartedAtRef.current,
        isGrounded: isGrounded.current,
        moveSpeed: horizSpeed,
      });
    }
  }

  function updateVehicle(
    dt: number,
    keys: ReturnType<typeof getKeys>,
    now: number,
  ) {
    const vId = drivingVehicleId.current!;
    const vData = vehicles[vId];
    if (!vData) {
      exitVehicle();
      return;
    }

    // Acceleration / braking
    if (keys.forward) {
      vehicleSpeed.current = Math.min(
        VEHICLE_MAX_SPEED,
        vehicleSpeed.current + VEHICLE_ACCEL,
      );
    } else if (keys.back) {
      vehicleSpeed.current = Math.max(
        -VEHICLE_MAX_SPEED * 0.4,
        vehicleSpeed.current - VEHICLE_BRAKE,
      );
    } else {
      vehicleSpeed.current *= 1 - VEHICLE_FRICTION;
      if (Math.abs(vehicleSpeed.current) < 0.05) vehicleSpeed.current = 0;
    }

    // Steering (scales with speed)
    const speedFactor = Math.min(1, Math.abs(vehicleSpeed.current) / 6);
    const turnRate = VEHICLE_TURN_BASE * speedFactor * dt;
    if (keys.left)
      vehicleRotY.current += turnRate * Math.sign(vehicleSpeed.current);
    if (keys.right)
      vehicleRotY.current -= turnRate * Math.sign(vehicleSpeed.current);

    // Forward axis (rotY=0 → -Z)
    const vfx = -Math.sin(vehicleRotY.current);
    const vfz = -Math.cos(vehicleRotY.current);
    const tryX = vehiclePos.current.x + vfx * vehicleSpeed.current * dt;
    const tryZ = vehiclePos.current.z + vfz * vehicleSpeed.current * dt;

    // Vehicle obstacle list (every other real vehicle, plus all ambient
    // AI cars). Ambient cars are visually the same scale as drivable
    // cars, so the driven vehicle treats them as solid even though they
    // never reach the local player's `vehicles` map.
    const otherVehicles: OBB[] = [];
    for (const v of Object.values(vehicles)) {
      if (v.id === vId) continue;
      otherVehicles.push(vehicleObb(v, VEHICLE_VEHICLE_MARGIN));
    }
    for (const route of TRAFFIC_ROUTES) {
      for (const seed of route.cars) {
        const a = ambientCarStateAt(route, seed, now);
        otherVehicles.push(
          vehicleObb(
            { x: a.x, z: a.z, rotY: a.rotY, variant: a.variant },
            VEHICLE_VEHICLE_MARGIN,
          ),
        );
      }
    }

    const variant = vData.variant;

    function collidesAt(px: number, pz: number): boolean {
      const o = vehicleObb(
        { x: px, z: pz, rotY: vehicleRotY.current, variant },
        VEHICLE_BUILDING_MARGIN,
      );
      if (vehicleHitsAnyBuilding(o)) return true;
      if (vehicleHitsAnyObstacle(o)) return true;
      for (const ov of otherVehicles) if (obbVsObb(o, ov)) return true;
      return false;
    }

    // Two-axis sweep — try X first, then Z. If both axes block, treat
    // as a hard hit and bounce.
    let nx = tryX;
    let nz = tryZ;
    let hardHit = false;
    if (collidesAt(tryX, tryZ)) {
      const xBlocked = collidesAt(tryX, vehiclePos.current.z);
      if (xBlocked) {
        nx = vehiclePos.current.x;
      }
      const zBlocked = collidesAt(nx, tryZ);
      if (zBlocked) {
        nz = vehiclePos.current.z;
      }
      hardHit = xBlocked && zBlocked;
    }

    if (hardHit) {
      // Bounce: invert + drop a lot of speed.
      vehicleSpeed.current = -vehicleSpeed.current * 0.2;
      if (Math.abs(vehicleSpeed.current) < 1.5) vehicleSpeed.current = 0;
    }

    // Clamp to world bounds (a bit more buffer for vehicle half-extent)
    const DRIVE_LIMIT = WORLD_HALF - 7;
    nx = Math.max(-DRIVE_LIMIT, Math.min(DRIVE_LIMIT, nx));
    nz = Math.max(-DRIVE_LIMIT, Math.min(DRIVE_LIMIT, nz));

    vehiclePos.current.x = nx;
    vehiclePos.current.z = nz;
    // 4-wheel ground frame: y from the average of all 4 tire contact
    // points (so the body rides over a switchback's outside-edge bump
    // without lifting off), pitch from front-vs-rear samples, roll
    // from left-vs-right. State.y semantics remain "body root above
    // the tire-contact plane by VEHICLE_BODY_LIFT (0.6m)" — see
    // VehicleObject.CarVisual offset wrapper.
    const dimDriven =
      (vData.variant && VARIANT_DIMENSIONS[vData.variant]) ??
      VARIANT_DIMENSIONS.sedan;
    const drivenWheelbase = dimDriven.bodyD - 2.0;
    const drivenTrack = dimDriven.bodyW + 0.04;
    const groundFrame = getVehicleGroundFrame(
      nx,
      nz,
      vehicleRotY.current,
      drivenWheelbase,
      drivenTrack,
    );
    vehiclePos.current.y = 0.6 + groundFrame.centerY;
    // Smooth pitch/roll over ~5 frames so a sharp switchback corner
    // doesn't snap the chassis.
    vehiclePitch.current += (groundFrame.pitch - vehiclePitch.current) * 0.2;
    vehicleRoll.current += (groundFrame.roll - vehicleRoll.current) * 0.2;

    // ===== Slope-aware physics =====
    // Gravity component along the vehicle's forward axis. Positive
    // pitch = nose-up = climbing → gravity pulls speed down. Negative
    // pitch = descending → gravity adds speed. Cap so coming down a
    // mountain is faster than max ground speed but not absurdly so —
    // the player still has steering authority.
    const SLOPE_GRAVITY = 14; // m/s² along forward; tuned arcade
    const DOWNHILL_SPEED_CAP = VEHICLE_MAX_SPEED * 1.5;
    vehicleSpeed.current += -SLOPE_GRAVITY * Math.sin(groundFrame.pitch) * dt;
    if (vehicleSpeed.current > DOWNHILL_SPEED_CAP) {
      vehicleSpeed.current = DOWNHILL_SPEED_CAP;
    } else if (vehicleSpeed.current < -DOWNHILL_SPEED_CAP) {
      vehicleSpeed.current = -DOWNHILL_SPEED_CAP;
    }

    // ===== NPC stumble (driven car hitting pedestrians) =====
    if (Math.abs(vehicleSpeed.current) > VEHICLE_HIT_NPC_MIN_SPEED) {
      const carObb = vehicleObb(
        {
          x: vehiclePos.current.x,
          z: vehiclePos.current.z,
          rotY: vehicleRotY.current,
          variant,
        },
        VEHICLE_PLAYER_MARGIN,
      );
      for (const route of NPC_ROUTES) {
        const npc = npcPositionAt(route, now);
        if (
          circleVsObb(
            { x: npc.x, z: npc.z, r: NPC_BODY_RADIUS },
            carObb,
          )
        ) {
          // Knock the NPC away from the car along the offset, with a
          // bit of forward push from the car's motion.
          const dxN = npc.x - vehiclePos.current.x;
          const dzN = npc.z - vehiclePos.current.z;
          const len = Math.sqrt(dxN * dxN + dzN * dzN) || 1;
          const force = 1.2 + Math.abs(vehicleSpeed.current) * 0.05;
          npcStumbleRef.current.set(route.id, {
            vx: (dxN / len) * force + vfx * 0.3,
            vz: (dzN / len) * force + vfz * 0.3,
            until: Date.now() + NPC_STUMBLE_DURATION_MS,
          });
        }
      }
    }

    // Sync vehicle mesh — yaw + slope pitch + slope roll. The group's
    // rotation order is set to YXZ in the JSX below so these compose
    // as heading → climb → bank, not the default XYZ axis salad.
    if (vehicleMeshRef.current) {
      vehicleMeshRef.current.position.copy(vehiclePos.current);
      vehicleMeshRef.current.rotation.y = vehicleRotY.current;
      vehicleMeshRef.current.rotation.x = vehiclePitch.current;
      vehicleMeshRef.current.rotation.z = vehicleRoll.current;
    }

    // Player position = inside vehicle (kept for HUD / minimap consistency)
    pos.current.copy(vehiclePos.current);
    pos.current.y += 0.5;

    // Hide local avatar while driving (remote players already hide
    // when isInVehicle on their snapshot). Push driving state to the
    // runtime so the (hidden) PlaceholderCharacter holds a neutral
    // pose if it's ever made visible mid-tick.
    if (avatarGroupRef.current) avatarGroupRef.current.visible = false;
    const drivingRuntime = avatarRuntimeRef.current;
    drivingRuntime.animState = "driving";
    drivingRuntime.speed = 0;
    drivingRuntime.attackSeq = attackSeqRef.current;
    drivingRuntime.attackKind = attackKindRef.current;
    drivingRuntime.attackStartedAt = attackStartedAtRef.current;

    // Camera follows vehicle. Pass dt so updateCamera can use
    // exponential damping; pass mode so it can apply slope-aware
    // smoothing + aim higher.
    updateCamera(vehiclePos.current, dt, "vehicle");

    // Exit vehicle
    if (keys.interact && interactCooldown.current <= 0) {
      exitVehicle();
      interactCooldown.current = 0.5;
      return;
    }

    // Emit (only for the vehicle WE drive — server also enforces this)
    if (now - lastEmit.current > EMIT_RATE) {
      lastEmit.current = now;
      emitPlayerUpdate({
        id: myId,
        username,
        x: pos.current.x,
        y: pos.current.y,
        z: pos.current.z,
        rotY: vehicleRotY.current,
        isInVehicle: true,
        vehicleId: vId,
        health: health.current,
        isRunning: false,
        animState: "driving",
        attackSeq: attackSeqRef.current,
        attackKind: attackKindRef.current,
        attackStartedAt: attackStartedAtRef.current,
        isGrounded: true,
        moveSpeed: 0,
      });
      emitVehicleUpdate({
        id: vId,
        x: vehiclePos.current.x,
        y: vehiclePos.current.y,
        z: vehiclePos.current.z,
        rotY: vehicleRotY.current,
        speed: vehicleSpeed.current,
        driverId: myId,
      });
      onVehicleUpdate(vId, {
        x: vehiclePos.current.x,
        y: vehiclePos.current.y,
        z: vehiclePos.current.z,
        rotY: vehicleRotY.current,
        speed: vehicleSpeed.current,
        driverId: myId,
      });
    }
  }

  function enterVehicle(v: VehicleState) {
    inVehicle.current = true;
    drivingVehicleId.current = v.id;
    vehiclePos.current.set(v.x, v.y, v.z);
    vehicleRotY.current = v.rotY;
    vehicleSpeed.current = v.speed;
    onVehicleUpdate(v.id, { driverId: myId });
    emitVehicleUpdate({
      id: v.id,
      driverId: myId,
      x: v.x,
      y: v.y,
      z: v.z,
      rotY: v.rotY,
      speed: 0,
    });
  }

  // Search for a safe exit position around the vehicle. We try 12
  // candidate offsets in vehicle-local space (right/left/back/front,
  // diagonals, then farther fallbacks), transform each into world
  // space, and accept the first that does NOT clip a building, any
  // other vehicle (real or ambient), or any NPC. If none is safe, we
  // abort the exit silently and the driver stays in the car.
  function findSafeExit(now: number): { x: number; z: number } | null {
    const cosR = Math.cos(vehicleRotY.current);
    const sinR = Math.sin(vehicleRotY.current);

    // Order: passenger door first, then driver, then around the car.
    const localOffsets: Array<[number, number]> = [
      [2.5, 0],
      [-2.5, 0],
      [0, 2.5],
      [0, -2.5],
      [2.0, 2.0],
      [-2.0, 2.0],
      [2.0, -2.0],
      [-2.0, -2.0],
      [3.5, 0],
      [-3.5, 0],
      [0, 3.5],
      [0, -3.5],
    ];

    // Build full obstacle set once.
    const vehicleObbs: OBB[] = [];
    for (const v of Object.values(vehicles)) {
      if (v.id === drivingVehicleId.current) continue;
      vehicleObbs.push(vehicleObb(v, VEHICLE_PLAYER_MARGIN));
    }
    for (const route of TRAFFIC_ROUTES) {
      for (const seed of route.cars) {
        const a = ambientCarStateAt(route, seed, now);
        vehicleObbs.push(
          vehicleObb(
            { x: a.x, z: a.z, rotY: a.rotY, variant: a.variant },
            VEHICLE_PLAYER_MARGIN,
          ),
        );
      }
    }
    const npcPositions: Array<{ x: number; z: number }> = [];
    for (const route of NPC_ROUTES) {
      npcPositions.push(npcPositionAt(route, now));
    }
    const minNpcDist = PLAYER_BODY_RADIUS + NPC_BODY_RADIUS;

    for (const [lx, lz] of localOffsets) {
      // Local→world: world = lx * (cosR, -sinR) + lz * (sinR, cosR)
      const wx = vehiclePos.current.x + lx * cosR + lz * sinR;
      const wz = vehiclePos.current.z + lx * -sinR + lz * cosR;

      // Stay on the playable area (full 1000-unit world)
      const EXIT_LIMIT = WORLD_HALF - 2;
      if (wx < -EXIT_LIMIT || wx > EXIT_LIMIT || wz < -EXIT_LIMIT || wz > EXIT_LIMIT) continue;

      if (playerHitsAnyBuilding(wx, wz)) continue;
      if (playerHitsAnyObstacle(wx, wz)) continue;

      const c = { x: wx, z: wz, r: PLAYER_BODY_RADIUS };
      let bad = false;
      for (const o of vehicleObbs) {
        if (circleVsObb(c, o)) {
          bad = true;
          break;
        }
      }
      if (bad) continue;

      for (const npc of npcPositions) {
        const dx = wx - npc.x;
        const dz = wz - npc.z;
        if (dx * dx + dz * dz < minNpcDist * minNpcDist) {
          bad = true;
          break;
        }
      }
      if (bad) continue;

      return { x: wx, z: wz };
    }
    return null;
  }

  function exitVehicle() {
    const vId = drivingVehicleId.current;
    if (!vId) return;
    const safe = findSafeExit(Date.now());
    if (!safe) {
      // No safe spot exists — keep the driver in the car. The
      // interact cooldown set by the caller still applies, so the
      // player can try again after they roll forward.
      return;
    }
    // Safe-exit Y must match the mountain road profile so the player
    // doesn't pop out under the elevated carriageway when leaving a car
    // on a switchback. Off-mountain returns 0 → standing y = 0.6 as
    // before.
    const exitGroundY = getVehicleGroundY(safe.x, safe.z);
    pos.current.set(safe.x, exitGroundY + PLAYER_HEIGHT / 2, safe.z);
    vel.current.set(0, 0, 0);
    inVehicle.current = false;
    drivingVehicleId.current = null;
    vehicleSpeed.current = 0;
    onVehicleUpdate(vId, { driverId: null, speed: 0 });
    emitVehicleUpdate({
      id: vId,
      driverId: null,
      speed: 0,
      x: vehiclePos.current.x,
      y: vehiclePos.current.y,
      z: vehiclePos.current.z,
      rotY: vehicleRotY.current,
    });
  }

  function updateCamera(
    target: THREE.Vector3,
    dt: number,
    mode: "walking" | "vehicle",
  ) {
    const yaw = cameraYaw.current;
    const pitch = cameraPitch.current;

    // Speed factor (0..1) — only nonzero in vehicle mode. Drives the
    // distance bonus and the look-at smoothing rate so high-speed
    // downhill stretches feel stable, not shaky.
    const speedFactor =
      mode === "vehicle"
        ? Math.min(1, Math.abs(vehicleSpeed.current) / VEHICLE_MAX_SPEED)
        : 0;
    const dist = CAM_DIST + speedFactor * CAM_SPEED_DIST_BONUS;

    // Desired camera body position (chase rig).
    const camX = target.x + Math.sin(yaw) * dist * Math.cos(pitch);
    let camY = target.y + Math.sin(pitch) * dist + 1.8;
    const camZ = target.z + Math.cos(yaw) * dist * Math.cos(pitch);

    // Terrain clearance: never let the camera body sit below
    // terrainY + clearance. This is what stops the chase camera from
    // clipping into the back of a mountain on steep descents (the
    // root cause of the white/black flashing during downhill runs).
    const groundUnderCam = terrainHeightAt(camX, camZ);
    const minCamY = groundUnderCam + CAM_TERRAIN_CLEARANCE;
    if (camY < minCamY) camY = minCamY;

    _camTarget.set(camX, camY, camZ);

    // Frame-rate independent exponential damping.
    // alpha = 1 - exp(-dt * stiffness) — at 60fps with stiffness=8
    // that's ~0.124, very close to the previous fixed 0.12 but stable
    // when delta varies (long frames during loading/HMR no longer
    // jump the camera).
    const posAlpha = 1 - Math.exp(-dt * CAM_POS_STIFFNESS);
    camera.position.lerp(_camTarget, posAlpha);

    // Post-lerp safety clamp: even when the desired position is
    // above terrain, an abrupt terrain change at the *interpolated*
    // (camera.x, camera.z) can still leave the lerp'd camera body
    // under the hill for a few frames. Re-sample at the actual
    // camera XZ and clamp upward — guarantees no clipping/flash.
    const groundUnderActual = terrainHeightAt(
      camera.position.x,
      camera.position.z,
    );
    const minActualY = groundUnderActual + CAM_TERRAIN_CLEARANCE;
    if (camera.position.y < minActualY) camera.position.y = minActualY;

    // Desired look point. In vehicle mode aim slightly higher so the
    // chase camera centres on the chassis, not the roof. We aim at
    // the smoothed visual mesh position when available so any
    // per-tick jitter in `target` (raw vehiclePos which absorbs the
    // 4-wheel ground sample every frame) is filtered out.
    const lookSrc =
      mode === "vehicle" && vehicleMeshRef.current
        ? vehicleMeshRef.current.position
        : target;
    const lookHeight =
      mode === "vehicle" ? CAM_VEHICLE_LOOK_HEIGHT : CAM_PLAYER_LOOK_HEIGHT;
    _camLookDesired.set(lookSrc.x, lookSrc.y + lookHeight, lookSrc.z);

    // Lazy-initialise the smoothed lookAt ref so the first frame
    // doesn't pull the aim from world origin.
    if (cameraLookAtRef.current === null) {
      cameraLookAtRef.current = _camLookDesired.clone();
    }
    // Loosen look smoothing as speed climbs — high-speed jitter on
    // the body's terrain-sampled y becomes invisible because the aim
    // point lags slightly behind.
    const lookStiffness =
      CAM_LOOK_STIFFNESS_BASE +
      (CAM_LOOK_STIFFNESS_FAST - CAM_LOOK_STIFFNESS_BASE) * speedFactor;
    const lookAlpha = 1 - Math.exp(-dt * lookStiffness);
    cameraLookAtRef.current.lerp(_camLookDesired, lookAlpha);
    camera.lookAt(cameraLookAtRef.current);
  }

  // Look up the live VehicleState for the car we're driving so the
  // local CarVisual gets the right variant/color.
  const drivingVehicleState =
    inVehicle.current && drivingVehicleId.current
      ? vehicles[drivingVehicleId.current]
      : null;

  return (
    <group>
      {/* Local player avatar. Root sits at feet level — PlaceholderCharacter
          is authored with feet at local-y=0 — so we initialise the group at
          (pos.x, pos.y - PLAYER_HEIGHT/2, pos.z) and let updatePlayer /
          updateVehicle move/hide it each frame. */}
      <group
        ref={avatarGroupRef}
        position={[
          pos.current.x,
          pos.current.y - PLAYER_HEIGHT / 2,
          pos.current.z,
        ]}
      >
        <CharacterAvatar runtimeRef={avatarRuntimeRef} isLocal characterId={characterId} />
      </group>
      {/* Driving vehicle visual — uses CarVisual so taxi/van/compact
          look correct while we drive them. */}
      {drivingVehicleState && (
        <group
          ref={vehicleMeshRef}
          position={[
            vehiclePos.current.x,
            vehiclePos.current.y,
            vehiclePos.current.z,
          ]}
          // YXZ so updateVehicle's rotation.x (pitch) and rotation.z
          // (roll) tilt the body around its own lateral / forward axes
          // after yaw. Default XYZ would skew the chassis on slopes.
          rotation={new THREE.Euler(0, vehicleRotY.current, 0, "YXZ")}
        >
          <CarVisual
            variant={drivingVehicleState.variant}
            color={drivingVehicleState.color}
          />
          {/* Driving headlight — vehicle forward is local -Z (see
              CarVisual + updateVehicle), so the front-mounted point
              light sits at z = -2.5, not +2.5. */}
          <pointLight
            position={[0, 1.5, -2.5]}
            color="#ffffc0"
            intensity={6}
            distance={12}
            decay={2}
          />
        </group>
      )}
    </group>
  );
}
