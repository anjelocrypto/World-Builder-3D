import * as THREE from "three";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { VehicleState } from "../shared/types";

interface VehicleObjectProps {
  state: VehicleState;
  isLocalDriverVehicle: boolean;
}

export default function VehicleObject({ state, isLocalDriverVehicle }: VehicleObjectProps) {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!groupRef.current || isLocalDriverVehicle) return;
    // Interpolate to server state for remote vehicles
    const target = new THREE.Vector3(state.x, state.y, state.z);
    groupRef.current.position.lerp(target, 0.15);
    groupRef.current.rotation.y += (state.rotY - groupRef.current.rotation.y) * 0.15;
  });

  return (
    <group ref={groupRef} position={[state.x, state.y, state.z]} rotation={[0, state.rotY, 0]}>
      {/* Car body */}
      <mesh position={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[2.2, 0.8, 4.5]} />
        <meshLambertMaterial color={state.color} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 1.05, -0.2]} castShadow>
        <boxGeometry args={[1.8, 0.7, 2.4]} />
        <meshLambertMaterial color={state.color} />
      </mesh>
      {/* Windshield front */}
      <mesh position={[0, 0.95, 1.05]} rotation={[-0.4, 0, 0]}>
        <planeGeometry args={[1.7, 0.7]} />
        <meshBasicMaterial color="#aaddff" transparent opacity={0.5} />
      </mesh>
      {/* Windshield rear */}
      <mesh position={[0, 0.95, -1.45]} rotation={[0.4, 0, 0]}>
        <planeGeometry args={[1.7, 0.7]} />
        <meshBasicMaterial color="#aaddff" transparent opacity={0.5} />
      </mesh>
      {/* Wheels */}
      {[
        [-1.1, -0.1, 1.5],
        [1.1, -0.1, 1.5],
        [-1.1, -0.1, -1.5],
        [1.1, -0.1, -1.5],
      ].map(([wx, wy, wz], i) => (
        <mesh key={i} position={[wx, wy, wz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.4, 0.4, 0.3, 12]} />
          <meshLambertMaterial color="#222" />
        </mesh>
      ))}
      {/* Headlights */}
      <mesh position={[-0.6, 0.4, 2.28]}>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshBasicMaterial color="#ffffc0" />
      </mesh>
      <mesh position={[0.6, 0.4, 2.28]}>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshBasicMaterial color="#ffffc0" />
      </mesh>
      {/* Taillights */}
      <mesh position={[-0.6, 0.4, -2.28]}>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshBasicMaterial color="#e74c3c" />
      </mesh>
      <mesh position={[0.6, 0.4, -2.28]}>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshBasicMaterial color="#e74c3c" />
      </mesh>
    </group>
  );
}
