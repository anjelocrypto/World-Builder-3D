import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { NPC_ROUTES } from "../shared/cityData";
import {
  npcPositionAt,
  NPC_STUMBLE_DURATION_MS,
  type NpcStumbleMap,
} from "../shared/collision";
import type { NpcRoute } from "../shared/types";

interface NPCsProps {
  stumbleRef: React.MutableRefObject<NpcStumbleMap>;
}

interface NpcEntry {
  route: NpcRoute;
  group: THREE.Group | null;
}

/**
 * Renders all ambient NPC pedestrians defined in cityData.NPC_ROUTES
 * with a SINGLE useFrame walking the array, instead of one-per-NPC
 * (was N R3F frame subscriptions). Stumble logic is preserved exactly.
 *
 * Visual children only retain castShadow on the body (the legs/head
 * shadow contribution was negligible relative to the body + cost a
 * shadow-pass draw call per NPC).
 */
export default function NPCs({ stumbleRef }: NPCsProps) {
  const data = useMemo(() => NPC_ROUTES.map((r) => r), []);
  const refs = useRef<NpcEntry[]>(data.map((r) => ({ route: r, group: null })));

  useFrame(() => {
    const tMs = Date.now();
    const arr = refs.current;
    const stumbles = stumbleRef.current;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      const g = e.group;
      if (!g) continue;
      const route = e.route;
      const { x, z, rotY: heading } = npcPositionAt(route, tMs);
      const bob = Math.sin(tMs / 220 + route.id) * 0.05;

      let offX = 0;
      let offZ = 0;
      let tiltZ = 0;
      let yLift = 0;
      const s = stumbles.get(route.id);
      if (s && s.until > tMs) {
        const remaining = (s.until - tMs) / NPC_STUMBLE_DURATION_MS;
        offX = s.vx * remaining;
        offZ = s.vz * remaining;
        const t = 1 - remaining;
        tiltZ = Math.sin(t * Math.PI) * 0.6;
        yLift = Math.sin(t * Math.PI) * 0.25;
      } else if (s && s.until <= tMs) {
        stumbles.delete(route.id);
      }

      g.position.set(x + offX, bob + yLift, z + offZ);
      g.rotation.set(0, heading, tiltZ);
    }
  });

  return (
    <group>
      {data.map((route, i) => (
        <group
          key={route.id}
          ref={(g) => {
            const e = refs.current[i];
            if (e) e.group = g;
          }}
        >
          {/* Body (capsule) — kept shadow-casting; tallest piece. */}
          <mesh position={[0, 0.65, 0]} castShadow>
            <capsuleGeometry args={[0.22, 0.7, 4, 8]} />
            <meshLambertMaterial color={route.shirtColor} />
          </mesh>
          {/* Legs (no shadow — saves N draw calls in the shadow pass). */}
          <mesh position={[-0.12, 0.18, 0]}>
            <boxGeometry args={[0.16, 0.36, 0.16]} />
            <meshLambertMaterial color="#2c3e50" />
          </mesh>
          <mesh position={[0.12, 0.18, 0]}>
            <boxGeometry args={[0.16, 0.36, 0.16]} />
            <meshLambertMaterial color="#2c3e50" />
          </mesh>
          {/* Head (no shadow). */}
          <mesh position={[0, 1.42, 0]}>
            <sphereGeometry args={[0.2, 10, 10]} />
            <meshLambertMaterial color={route.skinColor} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
