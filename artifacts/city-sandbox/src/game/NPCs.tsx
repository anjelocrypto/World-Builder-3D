import * as THREE from "three";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { NPC_ROUTES } from "../shared/cityData";
import {
  npcPositionAt,
  NPC_STUMBLE_DURATION_MS,
  type NpcStumbleMap,
} from "../shared/collision";
import type { NpcRoute } from "../shared/types";

interface NPCProps {
  route: NpcRoute;
  stumbleRef: React.MutableRefObject<NpcStumbleMap>;
}

/**
 * One ambient pedestrian that walks a deterministic loop around its
 * sidewalk route. Position is derived from `Date.now()` and the route's
 * cycleSeconds so all clients see the same approximate motion without
 * any networking. Non-colliding by design — purely visual life.
 *
 * The NPC also reads the shared stumble map: when the local player's
 * driven car hits a pedestrian, LocalPlayer writes a decaying
 * lateral-knockback entry here and the NPC flies sideways briefly with
 * a tilt. Stumble is local-only — never sent over Socket.io.
 */
function NPC({ route, stumbleRef }: NPCProps) {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!groupRef.current) return;
    const tMs = Date.now();
    const { x, z, rotY: heading } = npcPositionAt(route, tMs);

    // Subtle walking bob (head bobs ~5cm at ~2Hz).
    const bob = Math.sin(tMs / 220 + route.id) * 0.05;

    // Read stumble state. Decays linearly over NPC_STUMBLE_DURATION_MS.
    let offX = 0;
    let offZ = 0;
    let tiltZ = 0;
    let yLift = 0;
    const s = stumbleRef.current.get(route.id);
    if (s && s.until > tMs) {
      const remaining = (s.until - tMs) / NPC_STUMBLE_DURATION_MS;
      offX = s.vx * remaining;
      offZ = s.vz * remaining;
      // Sin curve for the tilt — peaks mid-stumble.
      const t = 1 - remaining;
      tiltZ = Math.sin(t * Math.PI) * 0.6;
      yLift = Math.sin(t * Math.PI) * 0.25;
    } else if (s && s.until <= tMs) {
      stumbleRef.current.delete(route.id);
    }

    groupRef.current.position.set(x + offX, bob + yLift, z + offZ);
    groupRef.current.rotation.set(0, heading, tiltZ);
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

interface NPCsProps {
  stumbleRef: React.MutableRefObject<NpcStumbleMap>;
}

/**
 * Renders all ambient NPC pedestrians defined in cityData.NPC_ROUTES.
 * Client-only — no Socket.io traffic, no impact on multiplayer. The
 * `stumbleRef` is allocated by GameScene and shared with LocalPlayer
 * so a driven car can knock NPCs aside.
 */
export default function NPCs({ stumbleRef }: NPCsProps) {
  return (
    <group>
      {NPC_ROUTES.map((r) => (
        <NPC key={r.id} route={r} stumbleRef={stumbleRef} />
      ))}
    </group>
  );
}
