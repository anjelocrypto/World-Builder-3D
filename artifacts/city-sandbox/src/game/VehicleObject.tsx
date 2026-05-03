import * as THREE from "three";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { VehicleState, VehicleVariant } from "../shared/types";
import { VARIANT_DIMENSIONS } from "../shared/cityData";

interface VehicleObjectProps {
  state: VehicleState;
  isLocalDriverVehicle: boolean;
}

// Module-level scratch — one Vector3 reused across every remote
// vehicle's per-frame lerp instead of allocating a new instance every
// frame for every car (was ~20 allocs/frame with 20 remotes).
const _lerpTarget = new THREE.Vector3();

export default function VehicleObject({ state, isLocalDriverVehicle }: VehicleObjectProps) {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!groupRef.current || isLocalDriverVehicle) return;
    // Interpolate to server state for remote vehicles
    _lerpTarget.set(state.x, state.y, state.z);
    groupRef.current.position.lerp(_lerpTarget, 0.15);
    groupRef.current.rotation.y += (state.rotY - groupRef.current.rotation.y) * 0.15;
  });

  return (
    <group ref={groupRef} position={[state.x, state.y, state.z]} rotation={[0, state.rotY, 0]}>
      <CarVisual variant={state.variant} color={state.color} />
    </group>
  );
}

interface CarVisualProps {
  // Accept any string (or undefined) so an unexpected value coming from
  // the network can't crash rendering. We narrow defensively below.
  variant: string | undefined;
  color: string;
  // Whether this car body / cabin should cast shadows. Drivable + remote
  // player cars stay true; cosmetic ambient traffic passes false to drop
  // ~22 shadow casters from the scene without changing what the player sees.
  castShadow?: boolean;
}

/**
 * Shared car geometry used by both the drivable VehicleObject and the
 * cosmetic AmbientTraffic AI cars. Geometry is parameterised by
 * VARIANT_DIMENSIONS so sedan / van / taxi / compact look distinct.
 *
 * IMPORTANT — vehicle facing convention:
 *   The gameplay convention (LocalPlayer.updateVehicle, traffic-route
 *   atan2(-dx,-dz), collision.ts) is that a vehicle's FORWARD direction
 *   is local -Z. Therefore in this visual:
 *     • headlights / front windshield  → local -Z side
 *     • taillights / rear windshield   → local +Z side
 *     • cabin sits slightly toward the REAR (+Z), so cabinOffsetZ > 0
 *   Do NOT reintroduce +Z-as-front assumptions here.
 *
 * `variant` may be an arbitrary string from the network; we fall back to
 * "sedan" if it's unknown rather than crashing on
 * `VARIANT_DIMENSIONS[undefined]`.
 */
export function CarVisual({ variant, color, castShadow = true }: CarVisualProps) {
  const safeVariant: VehicleVariant =
    variant && Object.hasOwn(VARIANT_DIMENSIONS, variant)
      ? (variant as VehicleVariant)
      : "sedan";
  const dim = VARIANT_DIMENSIONS[safeVariant];
  const wheelOffsetZ = dim.bodyD / 2 - 1.0;
  const wheelOffsetX = dim.bodyW / 2 - 0.05;

  return (
    <group>
      {/* Body */}
      <mesh position={[0, dim.bodyH / 2, 0]} castShadow={castShadow}>
        <boxGeometry args={[dim.bodyW, dim.bodyH, dim.bodyD]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {/* Cabin (sits slightly toward rear / +Z) */}
      <mesh
        position={[0, dim.bodyH + dim.cabinH / 2, dim.cabinOffsetZ]}
        castShadow={castShadow}
      >
        <boxGeometry args={[dim.cabinW, dim.cabinH, dim.cabinD]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {/* Windshield (FRONT — local -Z side of the cabin) */}
      <mesh
        position={[0, dim.bodyH + dim.cabinH * 0.5, dim.cabinOffsetZ - dim.cabinD / 2 - 0.02]}
        rotation={[0.4, 0, 0]}
      >
        <planeGeometry args={[dim.cabinW * 0.95, dim.cabinH * 0.9]} />
        <meshBasicMaterial color="#aaddff" transparent opacity={0.55} />
      </mesh>
      {/* Rear glass (REAR — local +Z side of the cabin) */}
      <mesh
        position={[0, dim.bodyH + dim.cabinH * 0.5, dim.cabinOffsetZ + dim.cabinD / 2 + 0.02]}
        rotation={[-0.4, 0, 0]}
      >
        <planeGeometry args={[dim.cabinW * 0.95, dim.cabinH * 0.9]} />
        <meshBasicMaterial color="#88aacc" transparent opacity={0.55} />
      </mesh>
      {/* Wheels */}
      {[
        [-wheelOffsetX, 0.05,  wheelOffsetZ],
        [ wheelOffsetX, 0.05,  wheelOffsetZ],
        [-wheelOffsetX, 0.05, -wheelOffsetZ],
        [ wheelOffsetX, 0.05, -wheelOffsetZ],
      ].map(([wx, wy, wz], i) => (
        <mesh key={i} position={[wx, wy, wz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.4, 0.4, 0.3, 12]} />
          <meshLambertMaterial color="#1a1a1a" />
        </mesh>
      ))}
      {/* Headlights (emissive, FRONT = local -Z) */}
      <mesh position={[-0.6, dim.bodyH / 2, -dim.bodyD / 2 - 0.03]}>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshBasicMaterial color="#fff5d0" />
      </mesh>
      <mesh position={[ 0.6, dim.bodyH / 2, -dim.bodyD / 2 - 0.03]}>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshBasicMaterial color="#fff5d0" />
      </mesh>
      {/* Taillights (REAR = local +Z) */}
      <mesh position={[-0.6, dim.bodyH / 2, dim.bodyD / 2 + 0.03]}>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshBasicMaterial color="#e74c3c" />
      </mesh>
      <mesh position={[ 0.6, dim.bodyH / 2, dim.bodyD / 2 + 0.03]}>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshBasicMaterial color="#e74c3c" />
      </mesh>
      {/* Taxi rooftop sign — sits over the cabin */}
      {variant === "taxi" && (
        <group position={[0, dim.bodyH + dim.cabinH + 0.18, dim.cabinOffsetZ]}>
          <mesh>
            <boxGeometry args={[0.9, 0.25, 0.4]} />
            <meshBasicMaterial color="#fff5d0" />
          </mesh>
        </group>
      )}
      {/* Van rear cargo box bump — REAR = +Z side of the cabin */}
      {variant === "van" && (
        <mesh position={[0, dim.bodyH + dim.cabinH * 0.4, dim.cabinOffsetZ + dim.cabinD / 2 - 0.02]}>
          <boxGeometry args={[dim.cabinW * 0.98, dim.cabinH * 0.85, 0.15]} />
          <meshLambertMaterial color={color} />
        </mesh>
      )}
    </group>
  );
}
