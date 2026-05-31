import * as THREE from "three";
import { useMemo } from "react";
import {
  NEMO_HOOD_BOUNDS,
  NEMO_HOOD_CENTER,
  NEMO_HOOD_HOUSES,
  NEMO_HOOD_HANGOUT_POS,
  NEMO_HOOD_LOOP,
  NEMO_HOOD_LAMPS,
} from "../shared/nemoHood";

// =============================================================
// Nemo Gang hood — static low-poly neighborhood visual (Batch A).
// -------------------------------------------------------------
// Client-only, render-only. Geometry comes entirely from nemoHood.ts (single
// source of truth); collision is handled separately by playerHitsAnyHoodWall.
// No gang logic and no wallet gating here — just houses, a central green, a
// cosmetic loop street, lamps, and the hangout beacon.
// =============================================================

const HOUSE_HEIGHT = 4;

function House({ x, z, w, d, rotY, color }: (typeof NEMO_HOOD_HOUSES)[number]) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      {/* Body */}
      <mesh position={[0, HOUSE_HEIGHT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, HOUSE_HEIGHT, d]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {/* Low hip roof (a flattened pyramid) */}
      <mesh position={[0, HOUSE_HEIGHT + 0.9, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[Math.max(w, d) * 0.72, 1.8, 4]} />
        <meshLambertMaterial color="#33272a" />
      </mesh>
      {/* Door hint on the inward (+local Z) face */}
      <mesh position={[0, 1.1, d / 2 + 0.02]}>
        <planeGeometry args={[1.2, 2.2]} />
        <meshBasicMaterial color="#1b1410" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export default function NemoHood() {
  const cx = NEMO_HOOD_CENTER[0];
  const cz = NEMO_HOOD_CENTER[1];
  const padW = NEMO_HOOD_BOUNDS.x1 - NEMO_HOOD_BOUNDS.x0;
  const padD = NEMO_HOOD_BOUNDS.z1 - NEMO_HOOD_BOUNDS.z0;

  // Cosmetic loop-street geometry: thin dark quads along the loop polyline.
  const loopSegments = useMemo(() => {
    const segs: { x: number; z: number; len: number; rot: number }[] = [];
    for (let i = 0; i < NEMO_HOOD_LOOP.length - 1; i++) {
      const [x0, z0] = NEMO_HOOD_LOOP[i];
      const [x1, z1] = NEMO_HOOD_LOOP[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      segs.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, len, rot: Math.atan2(x1 - x0, z1 - z0) });
    }
    return segs;
  }, []);

  return (
    <group>
      {/* Ground pad — packed-dirt lot the hood sits on (slightly above grass). */}
      <mesh position={[cx, 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[padW, padD]} />
        <meshLambertMaterial color="#5b5043" />
      </mesh>

      {/* Cosmetic loop street (not collidable, not part of the road graph). */}
      {loopSegments.map((s, i) => (
        <mesh key={`loop-${i}`} position={[s.x, 0.05, s.z]} rotation={[-Math.PI / 2, 0, s.rot]} receiveShadow>
          <planeGeometry args={[3, s.len]} />
          <meshLambertMaterial color="#2c2622" />
        </mesh>
      ))}

      {/* Houses */}
      {NEMO_HOOD_HOUSES.map((h) => (
        <House key={h.id} {...h} />
      ))}

      {/* Lamps — simple posts + an emissive head (no extra real lights to keep
          the dynamic-light budget unchanged). */}
      {NEMO_HOOD_LAMPS.map(([lx, lz], i) => (
        <group key={`lamp-${i}`} position={[lx, 0, lz]}>
          <mesh position={[0, 2, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 4, 6]} />
            <meshLambertMaterial color="#222" />
          </mesh>
          <mesh position={[0, 4.05, 0]}>
            <sphereGeometry args={[0.22, 8, 8]} />
            <meshBasicMaterial color="#ffd99a" />
          </mesh>
        </group>
      ))}

      {/* Hangout beacon — a purple ring + pillar marking the gang meet spot. */}
      <group position={[NEMO_HOOD_HANGOUT_POS[0], 0, NEMO_HOOD_HANGOUT_POS[2]]}>
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.2, 3, 32]} />
          <meshBasicMaterial color="#b06fff" transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 1.6, 0]}>
          <cylinderGeometry args={[0.35, 0.5, 3.2, 12]} />
          <meshLambertMaterial color="#3a2a52" emissive="#5a2fa0" emissiveIntensity={0.4} />
        </mesh>
      </group>
    </group>
  );
}
