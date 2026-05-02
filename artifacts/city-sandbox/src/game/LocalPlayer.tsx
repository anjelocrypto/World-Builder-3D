import { useRef, useEffect, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import type { VehicleState } from "../shared/types";
import { BUILDINGS, SPAWN_POINTS, CHECKPOINTS } from "../shared/cityData";

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
const PLAYER_RADIUS = 0.45;
const PLAYER_HEIGHT = 1.2;
const CAM_DIST = 7;
const INTERACT_DIST = 4;
const EMIT_RATE = 50; // ms between socket emits

interface LocalPlayerProps {
  myId: string;
  username: string;
  vehicles: Record<string, VehicleState>;
  onVehicleUpdate: (id: string, patch: Partial<VehicleState>) => void;
  emitPlayerUpdate: (data: object) => void;
  emitVehicleUpdate: (data: object) => void;
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

function checkBuildingAABB(px: number, pz: number): boolean {
  for (const b of BUILDINGS) {
    const hw = b.w / 2 + PLAYER_RADIUS;
    const hd = b.d / 2 + PLAYER_RADIUS;
    if (Math.abs(px - b.x) < hw && Math.abs(pz - b.z) < hd) return true;
  }
  return false;
}

export default function LocalPlayer({
  myId,
  username,
  vehicles,
  onVehicleUpdate,
  emitPlayerUpdate,
  emitVehicleUpdate,
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

  // Race state
  const raceActive = useRef(false);
  const raceStart = useRef(0);
  const racePassed = useRef<number[]>([]);
  const interactCooldown = useRef(0);

  // Emit timing
  const lastEmit = useRef(0);

  // UI state cache (avoid re-render spam)
  const uiCache = useRef({ health: 100, speed: 0, inVehicle: false, showInteract: false, vehicleLabel: "", raceActive: false, raceTime: 0, racePassed: [] as number[], px: pos.current.x, pz: pos.current.z });

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
        cameraPitch.current = Math.max(-0.15, Math.min(0.8, cameraPitch.current));
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

    // Interact cooldown
    if (interactCooldown.current > 0) interactCooldown.current -= dt;

    if (inVehicle.current && drivingVehicleId.current) {
      updateVehicle(dt, keys, now);
    } else {
      updatePlayer(dt, keys, now);
    }

    // Race checkpoint detection
    if (racePassed.current.length < CHECKPOINTS.length) {
      const nextCp = CHECKPOINTS.find((cp) => !racePassed.current.includes(cp.id));
      if (nextCp) {
        const curPos = inVehicle.current ? vehiclePos.current : pos.current;
        const dx = curPos.x - nextCp.x;
        const dz = curPos.z - nextCp.z;
        if (Math.sqrt(dx * dx + dz * dz) < 8) {
          if (nextCp.id === 0 && !raceActive.current && racePassed.current.length === 0) {
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
    const speed = inVehicle.current ? vehicleSpeed.current : vel.current.length();
    const raceTime = raceActive.current ? Date.now() - raceStart.current : 0;

    const newUI = {
      health: 100,
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

  function updatePlayer(dt: number, keys: ReturnType<typeof getKeys>, now: number) {
    // Camera-relative movement
    const yaw = cameraYaw.current;
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let mx = 0, mz = 0;
    if (keys.forward)  { mx += fwdX;   mz += fwdZ; }
    if (keys.back)     { mx -= fwdX;   mz -= fwdZ; }
    if (keys.left)     { mx -= rightX; mz -= rightZ; }
    if (keys.right)    { mx += rightX; mz += rightZ; }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) {
      mx /= len; mz /= len;
      const speed = keys.run ? RUN_SPEED : WALK_SPEED;
      vel.current.x = mx * speed;
      vel.current.z = mz * speed;
      playerRotY.current = Math.atan2(mx, mz);
    } else {
      vel.current.x *= 0.8;
      vel.current.z *= 0.8;
    }

    // Gravity
    vel.current.y += GRAVITY * dt;
    if (isGrounded.current && keys.jump) {
      vel.current.y = JUMP_FORCE;
      isGrounded.current = false;
    }

    // Move
    let nx = pos.current.x + vel.current.x * dt;
    let nz = pos.current.z + vel.current.z * dt;

    // Building collision with sliding
    if (checkBuildingAABB(nx, pos.current.z)) {
      nx = pos.current.x;
      vel.current.x = 0;
    }
    if (checkBuildingAABB(pos.current.x, nz)) {
      nz = pos.current.z;
      vel.current.z = 0;
    }

    // Clamp to map
    nx = Math.max(-95, Math.min(95, nx));
    nz = Math.max(-95, Math.min(95, nz));

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

    // Update mesh
    if (meshRef.current) {
      meshRef.current.position.copy(pos.current);
      meshRef.current.position.y = pos.current.y - PLAYER_HEIGHT / 2 + 0.6;
      meshRef.current.rotation.y = playerRotY.current;
    }
    if (headRef.current) {
      headRef.current.position.set(pos.current.x, pos.current.y + 0.45, pos.current.z);
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
        id: myId, username,
        x: pos.current.x, y: pos.current.y, z: pos.current.z,
        rotY: playerRotY.current,
        isInVehicle: false, vehicleId: null,
        health: 100, isRunning: keys.run,
      });
    }
  }

  function updateVehicle(dt: number, keys: ReturnType<typeof getKeys>, now: number) {
    const vId = drivingVehicleId.current!;
    const vData = vehicles[vId];
    if (!vData) { exitVehicle(); return; }

    // Acceleration / braking
    if (keys.forward) {
      vehicleSpeed.current = Math.min(VEHICLE_MAX_SPEED, vehicleSpeed.current + VEHICLE_ACCEL);
    } else if (keys.back) {
      vehicleSpeed.current = Math.max(-VEHICLE_MAX_SPEED * 0.4, vehicleSpeed.current - VEHICLE_BRAKE);
    } else {
      vehicleSpeed.current *= 1 - VEHICLE_FRICTION;
      if (Math.abs(vehicleSpeed.current) < 0.05) vehicleSpeed.current = 0;
    }

    // Steering (scales with speed)
    const speedFactor = Math.min(1, Math.abs(vehicleSpeed.current) / 6);
    const turnRate = VEHICLE_TURN_BASE * speedFactor * dt;
    if (keys.left)  vehicleRotY.current += turnRate * Math.sign(vehicleSpeed.current);
    if (keys.right) vehicleRotY.current -= turnRate * Math.sign(vehicleSpeed.current);

    // Move
    const vfx = -Math.sin(vehicleRotY.current);
    const vfz = -Math.cos(vehicleRotY.current);
    let nx = vehiclePos.current.x + vfx * vehicleSpeed.current * dt;
    let nz = vehiclePos.current.z + vfz * vehicleSpeed.current * dt;

    // Clamp to map
    nx = Math.max(-93, Math.min(93, nx));
    nz = Math.max(-93, Math.min(93, nz));

    vehiclePos.current.x = nx;
    vehiclePos.current.z = nz;
    vehiclePos.current.y = 0.6; // keep on ground

    // Sync vehicle mesh
    if (vehicleMeshRef.current) {
      vehicleMeshRef.current.position.copy(vehiclePos.current);
      vehicleMeshRef.current.rotation.y = vehicleRotY.current;
    }

    // Player position = inside vehicle
    pos.current.copy(vehiclePos.current);
    pos.current.y += 0.5;

    // Camera follows vehicle
    updateCamera(vehiclePos.current);

    // Exit vehicle
    if (keys.interact && interactCooldown.current <= 0) {
      exitVehicle();
      interactCooldown.current = 0.5;
      return;
    }

    // Emit
    if (now - lastEmit.current > EMIT_RATE) {
      lastEmit.current = now;
      emitPlayerUpdate({
        id: myId, username,
        x: pos.current.x, y: pos.current.y, z: pos.current.z,
        rotY: vehicleRotY.current,
        isInVehicle: true, vehicleId: vId,
        health: 100, isRunning: false,
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
    emitVehicleUpdate({ id: v.id, driverId: myId, x: v.x, y: v.y, z: v.z, rotY: v.rotY, speed: 0 });
  }

  function exitVehicle() {
    const vId = drivingVehicleId.current!;
    // Drop player next to vehicle
    pos.current.set(vehiclePos.current.x + 2.5, 1, vehiclePos.current.z);
    vel.current.set(0, 0, 0);
    inVehicle.current = false;
    drivingVehicleId.current = null;
    vehicleSpeed.current = 0;
    onVehicleUpdate(vId, { driverId: null, speed: 0 });
    emitVehicleUpdate({ id: vId, driverId: null, speed: 0, x: vehiclePos.current.x, y: vehiclePos.current.y, z: vehiclePos.current.z, rotY: vehicleRotY.current });
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

  return (
    <group>
      {/* Player body */}
      <mesh ref={meshRef} position={[pos.current.x, pos.current.y, pos.current.z]} castShadow>
        <boxGeometry args={[0.6, PLAYER_HEIGHT, 0.4]} />
        <meshLambertMaterial color="#3498db" />
      </mesh>
      {/* Player head */}
      <mesh ref={headRef} position={[pos.current.x, pos.current.y + 0.45, pos.current.z]} castShadow>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshLambertMaterial color="#f5cba7" />
      </mesh>
      {/* Driving vehicle visual */}
      {inVehicle.current && drivingVehicleId.current && (() => {
        const vd = vehicles[drivingVehicleId.current];
        if (!vd) return null;
        return (
          <group ref={vehicleMeshRef} position={[vehiclePos.current.x, vehiclePos.current.y, vehiclePos.current.z]} rotation={[0, vehicleRotY.current, 0]}>
            <mesh position={[0, 0.4, 0]} castShadow>
              <boxGeometry args={[2.2, 0.8, 4.5]} />
              <meshLambertMaterial color={vd.color} />
            </mesh>
            <mesh position={[0, 1.05, -0.2]} castShadow>
              <boxGeometry args={[1.8, 0.7, 2.4]} />
              <meshLambertMaterial color={vd.color} />
            </mesh>
            {[[-1.1, -0.1, 1.5], [1.1, -0.1, 1.5], [-1.1, -0.1, -1.5], [1.1, -0.1, -1.5]].map(([wx, wy, wz], i) => (
              <mesh key={i} position={[wx, wy, wz]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.4, 0.4, 0.3, 12]} />
                <meshLambertMaterial color="#222" />
              </mesh>
            ))}
            <pointLight position={[0, 1.5, 2.5]} color="#ffffc0" intensity={6} distance={12} decay={2} />
          </group>
        );
      })()}
    </group>
  );
}
