import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { PlayerState } from "../shared/types";

interface RemotePlayerProps {
  state: PlayerState;
}

export default function RemotePlayer({ state }: RemotePlayerProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const targetPos = useRef(new THREE.Vector3(state.x, state.y, state.z));
  const targetRotY = useRef(state.rotY);

  useFrame(() => {
    if (!groupRef.current) return;

    targetPos.current.set(state.x, state.y, state.z);
    targetRotY.current = state.rotY;

    groupRef.current.position.lerp(targetPos.current, 0.15);
    groupRef.current.rotation.y +=
      (targetRotY.current - groupRef.current.rotation.y) * 0.15;
  });

  if (state.isInVehicle) return null;

  return (
    <group ref={groupRef} position={[state.x, state.y, state.z]}>
      {/* Body */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <boxGeometry args={[0.6, 1.2, 0.4]} />
        <meshLambertMaterial color="#e74c3c" />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.45, 0]} castShadow>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshLambertMaterial color="#f5cba7" />
      </mesh>
      {/* Name label */}
      <Html position={[0, 2.2, 0]} center distanceFactor={10}>
        <div
          style={{
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            padding: "2px 6px",
            borderRadius: "4px",
            fontSize: "12px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            fontFamily: "monospace",
          }}
        >
          {state.username}
        </div>
      </Html>
    </group>
  );
}
