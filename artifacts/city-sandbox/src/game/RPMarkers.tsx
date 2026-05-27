/**
 * RPMarkers — world-space 3D markers for RP buildings.
 *
 * Phase 1B: Central Loop Station spawn platform at STATION_MARKER_POS.
 * Phase 2:  Licensing Office entrance marker at LICENSING_OFFICE_POS,
 *           and license-test checkpoint rings at LICENSE_TEST_CHECKPOINTS.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  STATION_MARKER_POS,
  LICENSING_OFFICE_POS,
  LICENSE_TEST_CHECKPOINTS,
} from "../shared/rpTypes";

export default function RPMarkers() {
  const platMatRef   = useRef<THREE.MeshStandardMaterial>(null!);
  const ringMatRef   = useRef<THREE.MeshStandardMaterial>(null!);
  const signMatRef   = useRef<THREE.MeshStandardMaterial>(null!);
  const officeRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const officeSignRef = useRef<THREE.MeshStandardMaterial>(null!);
  // One ref per checkpoint ring (4 total)
  const cpRingRefs   = [
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
  ];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pulse = 0.5 + 0.25 * Math.sin(t * 1.8);
    if (platMatRef.current)    platMatRef.current.emissiveIntensity    = pulse * 0.6;
    if (ringMatRef.current)    ringMatRef.current.emissiveIntensity    = pulse;
    if (signMatRef.current)    signMatRef.current.emissiveIntensity    = 0.8 + 0.2 * Math.sin(t * 2.5);
    // Licensing Office — amber pulse
    const officePulse = 0.5 + 0.3 * Math.sin(t * 2.2);
    if (officeRingRef.current) officeRingRef.current.emissiveIntensity = officePulse;
    if (officeSignRef.current) officeSignRef.current.emissiveIntensity = 0.8 + 0.2 * Math.sin(t * 3.0);
    // Checkpoint rings — green pulse (slightly staggered per ring)
    cpRingRefs.forEach((ref, i) => {
      if (ref.current) ref.current.emissiveIntensity = 0.4 + 0.3 * Math.sin(t * 2.0 + i * 0.5);
    });
  });

  const [mx, , mz] = STATION_MARKER_POS;

  return (
    <>
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

    {/* ════ Licensing Office marker ════════════════════════════════════════ */}
    {(() => {
      const [ox, , oz] = LICENSING_OFFICE_POS;
      return (
        <group position={[ox, 0, oz]}>
          {/* Ground ring — 5–6 m radius */}
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[5, 6, 48]} />
            <meshStandardMaterial
              ref={officeRingRef}
              color="#7a4f00"
              emissive="#ffaa00"
              emissiveIntensity={0.5}
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>

          {/* Sign post */}
          <mesh position={[0, 1.8, -0.3]}>
            <boxGeometry args={[0.12, 3.6, 0.12]} />
            <meshStandardMaterial color="#2a2a2a" roughness={0.7} metalness={0.5} />
          </mesh>

          {/* Sign board */}
          <mesh position={[0, 3.3, -0.3]}>
            <boxGeometry args={[4.4, 0.8, 0.1]} />
            <meshStandardMaterial
              ref={officeSignRef}
              color="#1a0e00"
              emissive="#cc7700"
              emissiveIntensity={0.8}
              roughness={0.3}
              metalness={0.2}
            />
          </mesh>

          {/* Sign text strip */}
          <mesh position={[0, 3.6, -0.24]}>
            <boxGeometry args={[4.0, 0.1, 0.01]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffe066" emissiveIntensity={2} />
          </mesh>

          {/* Amber point light */}
          <pointLight
            position={[0, 4, 0]}
            color="#ffaa22"
            intensity={2.5}
            distance={14}
            decay={2}
          />
        </group>
      );
    })()}

    {/* ════ License-test checkpoint rings ════════════════════════════════════ */}
    {LICENSE_TEST_CHECKPOINTS.map(([cx, , cz], i) => (
      <group key={`cp-${i}`} position={[cx, 0, cz]}>
        {/* Ground ring — 7–8 m radius */}
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[7, 8, 48]} />
          <meshStandardMaterial
            ref={cpRingRefs[i]}
            color="#004d20"
            emissive="#00e676"
            emissiveIntensity={0.4}
            transparent
            opacity={0.45}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Vertical pillar (easy to spot from a car) */}
        <mesh position={[0, 1.5, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 3, 8]} />
          <meshStandardMaterial
            color="#00e676"
            emissive="#00e676"
            emissiveIntensity={0.6}
            roughness={0.4}
          />
        </mesh>
        {/* Top cap */}
        <mesh position={[0, 3.1, 0]}>
          <sphereGeometry args={[0.22, 8, 8]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#00ff99"
            emissiveIntensity={1.2}
          />
        </mesh>
        <pointLight
          position={[0, 3.2, 0]}
          color="#00e676"
          intensity={1.5}
          distance={12}
          decay={2}
        />
      </group>
    ))}
    </>
  );
}
