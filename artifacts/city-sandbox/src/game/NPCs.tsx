import * as THREE from "three";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { NPC_ROUTES } from "../shared/cityData";
import type { NpcRoute } from "../shared/types";

/**
 * One ambient pedestrian that walks a deterministic loop around its
 * sidewalk route. Position is derived from `Date.now()` and the route's
 * cycleSeconds so all clients see the same approximate motion without
 * any networking. Non-colliding by design — purely visual life.
 */
function NPC({ route }: { route: NpcRoute }) {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!groupRef.current) return;
    const tMs = Date.now();
    const progress = ((tMs / 1000) / route.cycleSeconds) % 1;
    const segCount = route.waypoints.length;
    const segProgress = progress * segCount;
    const segIdx = Math.floor(segProgress) % segCount;
    const segT = segProgress - Math.floor(segProgress);
    const a = route.waypoints[segIdx];
    const b = route.waypoints[(segIdx + 1) % segCount];
    const x = a[0] + (b[0] - a[0]) * segT;
    const z = a[1] + (b[1] - a[1]) * segT;

    // Heading: in this codebase rotY=0 means forward = -Z. So to face
    // direction (dx, dz), we need rotY = atan2(-dx, -dz).
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const heading = Math.atan2(-dx, -dz);

    // Subtle walking bob (head bobs ~5cm at ~2Hz).
    const bob = Math.sin(tMs / 220 + route.id) * 0.05;

    groupRef.current.position.set(x, bob, z);
    groupRef.current.rotation.y = heading;
  });

  return (
    <group ref={groupRef}>
      {/* Body (capsule) */}
      <mesh position={[0, 0.65, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.7, 4, 8]} />
        <meshLambertMaterial color={route.shirtColor} />
      </mesh>
      {/* Legs */}
      <mesh position={[-0.12, 0.18, 0]} castShadow>
        <boxGeometry args={[0.16, 0.36, 0.16]} />
        <meshLambertMaterial color="#2c3e50" />
      </mesh>
      <mesh position={[0.12, 0.18, 0]} castShadow>
        <boxGeometry args={[0.16, 0.36, 0.16]} />
        <meshLambertMaterial color="#2c3e50" />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.42, 0]} castShadow>
        <sphereGeometry args={[0.2, 10, 10]} />
        <meshLambertMaterial color={route.skinColor} />
      </mesh>
    </group>
  );
}

/**
 * Renders all ambient NPC pedestrians defined in cityData.NPC_ROUTES.
 * Client-only — no Socket.io traffic, no impact on multiplayer.
 */
export default function NPCs() {
  return (
    <group>
      {NPC_ROUTES.map((r) => (
        <NPC key={r.id} route={r} />
      ))}
    </group>
  );
}
