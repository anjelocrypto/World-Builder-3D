import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CHECKPOINTS } from "../shared/cityData";

interface CheckpointRaceProps {
  playerPos: React.MutableRefObject<THREE.Vector3>;
  onPass: (id: number) => void;
  passedIds: number[];
  raceActive: boolean;
}

export default function CheckpointRace({
  playerPos,
  onPass,
  passedIds,
  raceActive,
}: CheckpointRaceProps) {
  const timersRef = useRef<Record<number, number>>({});

  useFrame(() => {
    if (!raceActive && passedIds.length === 0) return;
    const pos = playerPos.current;

    // Which checkpoint to check: first unpassed one
    const nextCp = CHECKPOINTS.find((cp) => !passedIds.includes(cp.id));
    if (!nextCp) return;

    const dx = pos.x - nextCp.x;
    const dz = pos.z - nextCp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 8) {
      // Debounce
      if (!timersRef.current[nextCp.id]) {
        timersRef.current[nextCp.id] = Date.now();
        onPass(nextCp.id);
      }
    }
  });

  return (
    <group>
      {CHECKPOINTS.map((cp, i) => {
        const passed = passedIds.includes(cp.id);
        const isNext =
          !passed &&
          (passedIds.length === 0
            ? i === 0
            : CHECKPOINTS.findIndex((c) => !passedIds.includes(c.id)) === i);
        const isFinish = i === CHECKPOINTS.length - 1;

        const color = passed
          ? "#2ecc71"
          : isNext
          ? "#f39c12"
          : isFinish
          ? "#e74c3c"
          : "#3498db";

        return (
          <group key={cp.id} position={[cp.x, 4, cp.z]}>
            {/* Gate posts */}
            <mesh position={[-6, -3.5, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 8, 8]} />
              <meshLambertMaterial color={color} />
            </mesh>
            <mesh position={[6, -3.5, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 8, 8]} />
              <meshLambertMaterial color={color} />
            </mesh>
            {/* Arch */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[12, 0.5, 0.5]} />
              <meshLambertMaterial color={color} />
            </mesh>
            {/* Trigger zone (transparent) */}
            <mesh position={[0, -3, 0]}>
              <boxGeometry args={[12, 8, 2]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={passed ? 0 : 0.08}
              />
            </mesh>
            {/* Number label using mesh */}
            <mesh position={[0, 1.2, 0]}>
              <boxGeometry args={[1.5, 1.5, 0.1]} />
              <meshBasicMaterial color={color} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
