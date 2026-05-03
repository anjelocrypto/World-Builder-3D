import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import type { VehicleState } from "../shared/types";
import {
  SPAWN_POINTS,
  CHECKPOINTS,
  NPC_ROUTES,
  TRAFFIC_ROUTES,
  WORLD_HALF,
} from "../shared/cityData";
import { getVehicleGroundY } from "../shared/elevation";
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
  vehicleHitsAnyBuilding,
  vehicleHitsAnyObstacle,
  npcPositionAt,
  ambientCarStateAt,
  type OBB,
  type NpcStumbleMap,
} from "../shared/collision";
import { CarVisual } from "./VehicleObject";

export enum Controls {
  forward = "forward",
  back = "back",
  left = "left",
  right = "right",
  jump = "jump",
  run = "run",
  interact = "interact",
}

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
    raceActive: boolean;
    raceTime: number;
    racePassed: number[];
    px: number;
    pz: number;
  }) => void;
  playerPosRef: React.MutableRefObject<THREE.Vector3>;
  // Authoritative spawn from the server's gameState. Falls back to a
  // deterministic local pick when not provided (e.g. server-disconnected).
  initialSpawn?: [number, number, number];
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
}: LocalPlayerProps) {
  const { camera, gl } = useThree();
  const [, getKeys] = useKeyboardControls<Controls>();

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
  const meshRef = useRef<THREE.Mesh>(null!);
  const headRef = useRef<THREE.Mesh>(null!);

  // Vehicle state
  const inVehicle = useRef(false);
  const drivingVehicleId = useRef<string | null>(null);
  const vehicleSpeed = useRef(0);
  const vehicleRotY = useRef(0);
  const vehiclePos = useRef(new THREE.Vector3());
  const vehicleMeshRef = useRef<THREE.Group>(null!);

  // Health & knockback
  const health = useRef(100);
  const knockback = useRef(new THREE.Vector3());
  const damageCooldown = useRef(0);

  // Race state
  const raceActive = useRef(false);
  const raceStart = useRef(0);
  const racePassed = useRef<number[]>([]);
  const interactCooldown = useRef(0);

  // Emit timing
  const lastEmit = useRef(0);

  // UI state cache (avoid re-render spam)
  const uiCache = useRef({
    health: 100,
    speed: 0,
    inVehicle: false,
    showInteract: false,
    vehicleLabel: "",
    raceActive: false,
    raceTime: 0,
    racePassed: [] as number[],
    px: pos.current.x,
    pz: pos.current.z,
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

    return () => {
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const keys = getKeys();
    const now = Date.now();

    // Cooldowns
    if (interactCooldown.current > 0) interactCooldown.current -= dt;
    if (damageCooldown.current > 0) damageCooldown.current -= dt;

    if (inVehicle.current && drivingVehicleId.current) {
      updateVehicle(dt, keys, now);
    } else {
      updatePlayer(dt, keys, now);
    }

    // Race checkpoint detection
    if (racePassed.current.length < CHECKPOINTS.length) {
      const nextCp = CHECKPOINTS.find(
        (cp) => !racePassed.current.includes(cp.id),
      );
      if (nextCp) {
        const curPos = inVehicle.current ? vehiclePos.current : pos.current;
        const dx = curPos.x - nextCp.x;
        const dz = curPos.z - nextCp.z;
        if (Math.sqrt(dx * dx + dz * dz) < 8) {
          if (
            nextCp.id === 0 &&
            !raceActive.current &&
            racePassed.current.length === 0
          ) {
            raceActive.current = true;
            raceStart.current = Date.now();
          }
          if (!racePassed.current.includes(nextCp.id)) {
            racePassed.current = [...racePassed.current, nextCp.id];
            if (racePassed.current.length === CHECKPOINTS.length) {
              raceActive.current = false;
            }
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
    const raceTime = raceActive.current ? Date.now() - raceStart.current : 0;

    const newUI = {
      health: health.current,
      speed,
      inVehicle: inVehicle.current,
      showInteract,
      vehicleLabel: nearVehicle ? nearVehicle.id : "",
      raceActive: raceActive.current,
      raceTime,
      racePassed: racePassed.current,
      px: curPos.x,
      pz: curPos.z,
    };

    if (JSON.stringify(newUI) !== JSON.stringify(uiCache.current)) {
      uiCache.current = newUI;
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

    // Try X first
    if (
      playerHitsAnyBuilding(nx, pos.current.z) ||
      playerHitsAnyObstacle(nx, pos.current.z) ||
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

    // Ground
    if (pos.current.y <= PLAYER_HEIGHT / 2) {
      pos.current.y = PLAYER_HEIGHT / 2;
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

    // Update meshes (visible only when not driving)
    if (meshRef.current) {
      meshRef.current.position.copy(pos.current);
      meshRef.current.position.y = pos.current.y - PLAYER_HEIGHT / 2 + 0.6;
      meshRef.current.rotation.y = playerRotY.current;
      meshRef.current.visible = true;
    }
    if (headRef.current) {
      headRef.current.position.set(
        pos.current.x,
        pos.current.y + 0.45,
        pos.current.z,
      );
      headRef.current.visible = true;
    }

    // Camera
    updateCamera(pos.current);

    // Enter vehicle
    if (keys.interact && interactCooldown.current <= 0) {
      const near = findNearestVehicle(pos.current);
      if (near && !near.driverId) {
        enterVehicle(near);
        interactCooldown.current = 0.5;
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
    // Sample the mountain road elevation system (returns 0 outside the
    // mountain country) so the player car climbs ridges/switchbacks
    // instead of clipping through the slope at y=0.6.
    vehiclePos.current.y = 0.6 + getVehicleGroundY(nx, nz);

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

    // Sync vehicle mesh
    if (vehicleMeshRef.current) {
      vehicleMeshRef.current.position.copy(vehiclePos.current);
      vehicleMeshRef.current.rotation.y = vehicleRotY.current;
    }

    // Player position = inside vehicle (kept for HUD / minimap consistency)
    pos.current.copy(vehiclePos.current);
    pos.current.y += 0.5;

    // Hide local body & head while driving (remote players already hide
    // when isInVehicle on their snapshot).
    if (meshRef.current) meshRef.current.visible = false;
    if (headRef.current) headRef.current.visible = false;

    // Camera follows vehicle
    updateCamera(vehiclePos.current);

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
    pos.current.set(safe.x, 1, safe.z);
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

  function updateCamera(target: THREE.Vector3) {
    const yaw = cameraYaw.current;
    const pitch = cameraPitch.current;
    const camX = target.x + Math.sin(yaw) * CAM_DIST * Math.cos(pitch);
    const camY = target.y + Math.sin(pitch) * CAM_DIST + 1.8;
    const camZ = target.z + Math.cos(yaw) * CAM_DIST * Math.cos(pitch);

    camera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.12);
    camera.lookAt(target.x, target.y + 1, target.z);
  }

  // Look up the live VehicleState for the car we're driving so the
  // local CarVisual gets the right variant/color.
  const drivingVehicleState =
    inVehicle.current && drivingVehicleId.current
      ? vehicles[drivingVehicleId.current]
      : null;

  return (
    <group>
      {/* Player body */}
      <mesh
        ref={meshRef}
        position={[pos.current.x, pos.current.y, pos.current.z]}
        castShadow
      >
        <boxGeometry args={[0.6, PLAYER_HEIGHT, 0.4]} />
        <meshLambertMaterial color="#3498db" />
      </mesh>
      {/* Player head */}
      <mesh
        ref={headRef}
        position={[pos.current.x, pos.current.y + 0.45, pos.current.z]}
        castShadow
      >
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshLambertMaterial color="#f5cba7" />
      </mesh>
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
          rotation={[0, vehicleRotY.current, 0]}
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
