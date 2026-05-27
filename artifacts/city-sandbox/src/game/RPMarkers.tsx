/**
 * RPMarkers — Phase 1B: Central Loop Station spawn marker.
 *
 * Geometry is placed at STATION_MARKER_POS [132, 0, −65]. The platform is
 * 8 m × 8 m centred there; its west edge is at x=128, giving 6 m clearance
 * from the station staircase foot at x=122 (see NEMOVERSE_RP_PLAN.md §5.5).
 *
 * Phase 2 will add the Licensing Office marker.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { STATION_MARKER_POS } from "../shared/rpTypes";

export default function RPMarkers() {
  const platMatRef  = useRef<THREE.MeshStandardMaterial>(null!);
  const ringMatRef  = useRef<THREE.MeshStandardMaterial>(null!);
  const signMatRef  = useRef<THREE.MeshStandardMaterial>(null!);

  // Slow pulse on emissive intensity to make the marker visible from a distance.
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pulse = 0.5 + 0.25 * Math.sin(t * 1.8);
    if (platMatRef.current)  platMatRef.current.emissiveIntensity  = pulse * 0.6;
    if (ringMatRef.current)  ringMatRef.current.emissiveIntensity  = pulse;
    if (signMatRef.current)  signMatRef.current.emissiveIntensity  = 0.8 + 0.2 * Math.sin(t * 2.5);
  });

  const [mx, , mz] = STATION_MARKER_POS;

  return (
    <group position={[mx, 0, mz]}>
      {/* ── Platform slab — 8 m × 8 m × 5 cm ── */}
      <mesh position={[0, 0.025, 0]}>
        <boxGeometry args={[8, 0.05, 8]} />
        <meshStandardMaterial
          ref={platMatRef}
          color="#0d1f3c"
          emissive="#1a44aa"
          emissiveIntensity={0.4}
          roughness={0.5}
          metalness={0.3}
        />
      </mesh>

      {/* ── Platform edge trim (north + south sides) ── */}
      {([-3.97, 3.97] as const).map((zOff, i) => (
        <mesh key={i} position={[0, 0.06, zOff]}>
          <boxGeometry args={[8, 0.05, 0.06]} />
          <meshStandardMaterial color="#3366dd" emissive="#4488ff" emissiveIntensity={1} />
        </mesh>
      ))}

      {/* ── Sign post — vertical pole at north edge ── */}
      <mesh position={[0, 2, -3.6]}>
        <boxGeometry args={[0.14, 4, 0.14]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.7} metalness={0.5} />
      </mesh>

      {/* ── Sign board ── */}
      <mesh position={[0, 3.8, -3.6]}>
        <boxGeometry args={[5.2, 0.9, 0.12]} />
        <meshStandardMaterial
          ref={signMatRef}
          color="#0a1628"
          emissive="#2255cc"
          emissiveIntensity={0.8}
          roughness={0.3}
          metalness={0.2}
        />
      </mesh>

      {/* ── Sign text band (bright strip across top of board) ── */}
      <mesh position={[0, 4.15, -3.54]}>
        <boxGeometry args={[4.8, 0.12, 0.01]} />
        <meshStandardMaterial color="#ffffff" emissive="#aaccff" emissiveIntensity={2} />
      </mesh>

      {/* ── Ground ring indicator — radius 9–10 m ── */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[9, 10, 48]} />
        <meshStandardMaterial
          ref={ringMatRef}
          color="#1a3a8a"
          emissive="#2255cc"
          emissiveIntensity={0.7}
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* ── Point light to illuminate the spawn area at night ── */}
      <pointLight
        position={[0, 5, -3]}
        color="#5577ff"
        intensity={3}
        distance={18}
        decay={2}
      />
    </group>
  );
}
