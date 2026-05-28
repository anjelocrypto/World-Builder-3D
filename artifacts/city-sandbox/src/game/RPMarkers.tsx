/**
 * RPMarkers — world-space 3D markers for RP buildings.
 *
 * Phase 1B: Central Loop Station spawn platform at STATION_MARKER_POS.
 * Phase 2:  Licensing Office entrance marker at LICENSING_OFFICE_POS,
 *           and license-test checkpoint rings at LICENSE_TEST_CHECKPOINTS.
 *
 * Checkpoint rings are only rendered while activeTest is non-null.
 * The next checkpoint ring pulses brightly; passed rings are dimmed;
 * future rings are at medium intensity. Point lights are omitted for
 * passed checkpoints to keep the light budget under control.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ActiveTest, ActiveJob, ActiveGangMission } from "../shared/rpTypes";
import {
  STATION_MARKER_POS,
  LICENSING_OFFICE_POS,
  DEALERSHIP_POS,
  LICENSE_TEST_CHECKPOINTS,
  CITY_WORKER_DEPOT,
  CITY_WORKER_CHECKPOINTS,
  TAXI_DEPOT,
  DELIVERY_HUB,
  MECHANIC_GARAGE,
  MEDIC_CENTER,
  MEDIC_ER_BAY,
  POLICE_STATION,
  ATM_LOCATIONS,
  POLICE_JAIL_CELL,
  POLICE_RELEASE_POS,
  POLICE_BOOKING_DESK_POS,
  GROVE_STREET_HANGOUT_POS,
  GROVE_STREET_TURF_CENTER,
  GROVE_STREET_TURF_RADIUS,
  GROVE_TAG_POINTS,
} from "../shared/rpTypes";

interface RPMarkersProps {
  /** Non-null only while a driver-license test is in progress. */
  activeTest: ActiveTest | null;
  /** Phase 4: Non-null while a City Worker route is active. */
  activeJob:  ActiveJob | null;
  /** Phase 7G: Non-null while a Tag Turf gang mission is active. */
  activeGangMission: ActiveGangMission | null;
}

export default function RPMarkers({ activeTest, activeJob, activeGangMission }: RPMarkersProps) {
  // Mirror props into refs so useFrame (non-reactive) always reads current value.
  const activeTestRef = useRef<ActiveTest | null>(activeTest);
  activeTestRef.current = activeTest;
  const activeJobRef = useRef<ActiveJob | null>(activeJob);
  activeJobRef.current = activeJob;

  const platMatRef      = useRef<THREE.MeshStandardMaterial>(null!);
  const ringMatRef      = useRef<THREE.MeshStandardMaterial>(null!);
  const signMatRef      = useRef<THREE.MeshStandardMaterial>(null!);
  const officeRingRef   = useRef<THREE.MeshStandardMaterial>(null!);
  const officeSignRef   = useRef<THREE.MeshStandardMaterial>(null!);
  const dealerRingRef   = useRef<THREE.MeshStandardMaterial>(null!);
  const dealerSignRef   = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 4: City Worker depot marker refs
  const depotRingRef    = useRef<THREE.MeshStandardMaterial>(null!);
  const depotSignRef    = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 5A: Taxi Depot marker refs
  const taxiDepotRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const taxiDepotSignRef = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 5B: Delivery Hub marker refs
  const deliveryHubRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const deliveryHubSignRef = useRef<THREE.MeshStandardMaterial>(null!);
  // One ref per license-test checkpoint ring (4 total). Populated only while activeTest
  // renders the checkpoint groups; null-checked before every write.
  const cpRingRefs = [
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
  ];
  // Phase 4: one ref per city worker checkpoint ring (4 total).
  const jobCpRingRefs = [
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
  ];
  // Phase 5A: one ref per taxi checkpoint ring (2 total: pickup + dropoff).
  const taxiCpRingRefs = [
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
  ];
  // Phase 5B: delivery checkpoint rings — up to 4 (1 pickup + 3 dropoffs).
  const deliveryCpRingRefs = [
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
  ];
  // Phase 5C: Mechanic Garage marker refs
  const mechanicGarageRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const mechanicGarageSignRef = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 5C: mechanic service-call target ring (1 target, same position for both stages)
  const mechanicCpRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 5D: Medical Center marker refs
  const medicCenterRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const medicCenterSignRef = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 5D: patient ring (stage 0+1) + ER bay ring (stage 2)
  const medicPatientRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const medicErRingRef      = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 5E: Police Station marker refs
  const policeStationRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const policeStationSignRef = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 5E: one ref per patrol checkpoint ring (4 total).
  const policeCpRingRefs = [
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
  ];
  // Phase 6D: Booking Desk, Jail Cell ring, Release Exit
  const bookingDeskRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const bookingDeskSignRef = useRef<THREE.MeshStandardMaterial>(null!);
  const jailCellRingRef    = useRef<THREE.MeshStandardMaterial>(null!);
  const releaseExitRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 7D: Grove Street gang hangout + turf ring
  const gangHangoutRingRef = useRef<THREE.MeshStandardMaterial>(null!);
  const gangHangoutSignRef = useRef<THREE.MeshStandardMaterial>(null!);
  const gangTurfRingRef    = useRef<THREE.MeshStandardMaterial>(null!);
  // Phase 5F: one ring ref per ATM (5 total — matches ATM_LOCATIONS.length).
  const atmRingRefs = [
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
  ];
  // Phase 7G: one ref per Tag Turf mission checkpoint ring (3 total).
  const tagCpRingRefs = [
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
    useRef<THREE.MeshStandardMaterial>(null!),
  ];
  const activeGangMissionRef = useRef<ActiveGangMission | null>(activeGangMission);
  activeGangMissionRef.current = activeGangMission;

  useFrame(({ clock }) => {
    const t  = clock.getElapsedTime();
    const at = activeTestRef.current;

    // Station platform
    const pulse = 0.5 + 0.25 * Math.sin(t * 1.8);
    if (platMatRef.current) platMatRef.current.emissiveIntensity = pulse * 0.6;
    if (ringMatRef.current) ringMatRef.current.emissiveIntensity = pulse;
    if (signMatRef.current) signMatRef.current.emissiveIntensity = 0.8 + 0.2 * Math.sin(t * 2.5);

    // Licensing Office — amber pulse
    const officePulse = 0.5 + 0.3 * Math.sin(t * 2.2);
    if (officeRingRef.current) officeRingRef.current.emissiveIntensity = officePulse;
    if (officeSignRef.current) officeSignRef.current.emissiveIntensity = 0.8 + 0.2 * Math.sin(t * 3.0);

    // Dealership — green/gold pulse
    const dealerPulse = 0.5 + 0.3 * Math.sin(t * 1.6 + 1.0);
    if (dealerRingRef.current) dealerRingRef.current.emissiveIntensity = dealerPulse;
    if (dealerSignRef.current) dealerSignRef.current.emissiveIntensity = 0.8 + 0.2 * Math.sin(t * 2.4 + 0.5);

    // City Worker Depot — orange/municipal pulse
    const depotPulse = 0.4 + 0.3 * Math.sin(t * 2.0 + 0.8);
    if (depotRingRef.current) depotRingRef.current.emissiveIntensity = depotPulse;
    if (depotSignRef.current) depotSignRef.current.emissiveIntensity = 0.7 + 0.2 * Math.sin(t * 2.8 + 0.3);

    // Taxi Depot — yellow/cab pulse
    const taxiDepotPulse = 0.4 + 0.3 * Math.sin(t * 2.2 + 1.2);
    if (taxiDepotRingRef.current) taxiDepotRingRef.current.emissiveIntensity = taxiDepotPulse;
    if (taxiDepotSignRef.current) taxiDepotSignRef.current.emissiveIntensity = 0.7 + 0.2 * Math.sin(t * 3.0 + 0.6);

    // Delivery Hub — brown/cargo pulse
    const deliveryHubPulse = 0.4 + 0.3 * Math.sin(t * 1.9 + 0.4);
    if (deliveryHubRingRef.current) deliveryHubRingRef.current.emissiveIntensity = deliveryHubPulse;
    if (deliveryHubSignRef.current) deliveryHubSignRef.current.emissiveIntensity = 0.7 + 0.2 * Math.sin(t * 2.7 + 0.9);

    // Mechanic Garage — steel/industrial pulse
    const mechanicGaragePulse = 0.4 + 0.3 * Math.sin(t * 2.1 + 0.6);
    if (mechanicGarageRingRef.current) mechanicGarageRingRef.current.emissiveIntensity = mechanicGaragePulse;
    if (mechanicGarageSignRef.current) mechanicGarageSignRef.current.emissiveIntensity = 0.7 + 0.2 * Math.sin(t * 2.9 + 0.2);

    // City Worker checkpoint rings — only animate when job is city_worker.
    const aj = activeJobRef.current;

    // Mechanic service-call ring — only animate when job is mechanic.
    if (aj?.job === "mechanic") {
      if (mechanicCpRingRef.current) {
        // When repairing (nextCp === 1), pulse fast red; when travelling (nextCp === 0), slow orange.
        const isRepairing = aj.nextCp === 1;
        mechanicCpRingRef.current.emissiveIntensity = isRepairing
          ? 0.45 + 0.35 * Math.sin(t * 5.0)
          : 0.35 + 0.25 * Math.sin(t * 2.5);
      }
    }

    // Medical Center — red/white pulse
    const medicCenterPulse = 0.4 + 0.3 * Math.sin(t * 2.3 + 0.5);
    if (medicCenterRingRef.current) medicCenterRingRef.current.emissiveIntensity = medicCenterPulse;
    if (medicCenterSignRef.current) medicCenterSignRef.current.emissiveIntensity = 0.7 + 0.2 * Math.sin(t * 3.1 + 0.1);

    // Police Station — navy/blue pulse
    const policeStationPulse = 0.4 + 0.3 * Math.sin(t * 2.0 + 0.7);
    if (policeStationRingRef.current) policeStationRingRef.current.emissiveIntensity = policeStationPulse;
    if (policeStationSignRef.current) policeStationSignRef.current.emissiveIntensity = 0.7 + 0.2 * Math.sin(t * 2.8 + 0.4);

    // ATM markers — teal/money-green slow pulse
    atmRingRefs.forEach((ref, i) => {
      if (ref.current) {
        ref.current.emissiveIntensity = 0.4 + 0.25 * Math.sin(t * 1.7 + i * 0.8);
      }
    });

    // Phase 7D: Grove Street hangout + turf ring — green gang pulse
    const gangHangoutPulse = 0.4 + 0.35 * Math.sin(t * 2.4 + 0.2);
    if (gangHangoutRingRef.current) gangHangoutRingRef.current.emissiveIntensity = gangHangoutPulse;
    if (gangHangoutSignRef.current) gangHangoutSignRef.current.emissiveIntensity = 0.7 + 0.25 * Math.sin(t * 3.2 + 0.4);
    // Turf ring breathes slowly — territorial rather than urgent
    if (gangTurfRingRef.current) gangTurfRingRef.current.emissiveIntensity = 0.15 + 0.08 * Math.sin(t * 0.9 + 1.0);

    // Phase 7G: Tag Turf mission checkpoint rings
    const agm = activeGangMissionRef.current;
    tagCpRingRefs.forEach((ref, i) => {
      if (!ref.current) return;
      if (!agm) { ref.current.opacity = 0; return; }
      const done    = i < agm.nextIdx;
      const current = i === agm.nextIdx;
      ref.current.opacity           = done ? 0.12 : current ? 0.55 : 0.25;
      ref.current.emissiveIntensity = done ? 0.05 : current ? (0.55 + 0.35 * Math.sin(t * 3.5)) : 0.2;
    });

    // Phase 6D: Booking Desk — amber/brown pulse
    const bookingDeskPulse = 0.4 + 0.3 * Math.sin(t * 2.1 + 0.9);
    if (bookingDeskRingRef.current) bookingDeskRingRef.current.emissiveIntensity = bookingDeskPulse;
    if (bookingDeskSignRef.current) bookingDeskSignRef.current.emissiveIntensity = 0.7 + 0.2 * Math.sin(t * 2.9 + 0.5);
    // Phase 6D: Jail Cell ring — slow red pulse
    if (jailCellRingRef.current) jailCellRingRef.current.emissiveIntensity = 0.3 + 0.2 * Math.sin(t * 1.4);
    // Phase 6D: Release Exit — green pulse
    if (releaseExitRingRef.current) releaseExitRingRef.current.emissiveIntensity = 0.4 + 0.3 * Math.sin(t * 2.2 + 1.5);

    // Police patrol checkpoint rings — only animate when job is police_patrol.
    if (aj?.job === "police_patrol") {
      policeCpRingRefs.forEach((ref, i) => {
        if (!ref.current) return;
        if (i >= aj.checkpoints.length) return;
        if (i < aj.nextCp) {
          ref.current.emissiveIntensity = 0.05;
        } else if (i === aj.nextCp) {
          ref.current.emissiveIntensity = 0.45 + 0.35 * Math.sin(t * 3.0 + i * 0.5);
        } else {
          ref.current.emissiveIntensity = 0.15 + 0.05 * Math.sin(t * 1.5 + i * 0.5);
        }
      });
    }

    // Medic patient + ER rings — only animate when job is medic.
    if (aj?.job === "medic") {
      // Patient ring: fast pulse during treatment (nextCp===1); slow during travel (nextCp===0)
      if (medicPatientRingRef.current && aj.nextCp <= 1) {
        const treating = aj.nextCp === 1;
        medicPatientRingRef.current.emissiveIntensity = treating
          ? 0.45 + 0.4 * Math.sin(t * 6.0)
          : 0.35 + 0.25 * Math.sin(t * 2.5);
      }
      // ER bay ring: pulses when patient is ready for transport (nextCp===2)
      if (medicErRingRef.current && aj.nextCp === 2) {
        medicErRingRef.current.emissiveIntensity = 0.45 + 0.35 * Math.sin(t * 3.5);
      }
    }
    if (aj?.job === "city_worker") {
      jobCpRingRefs.forEach((ref, i) => {
        if (!ref.current) return;
        if (i < aj.nextCp) {
          ref.current.emissiveIntensity = 0.05;
        } else if (i === aj.nextCp) {
          ref.current.emissiveIntensity = 0.45 + 0.35 * Math.sin(t * 3.0 + i * 0.5);
        } else {
          ref.current.emissiveIntensity = 0.15 + 0.05 * Math.sin(t * 1.5 + i * 0.5);
        }
      });
    }

    // Taxi checkpoint rings — only animate when job is taxi_driver.
    if (aj?.job === "taxi_driver") {
      taxiCpRingRefs.forEach((ref, i) => {
        if (!ref.current) return;
        if (i < aj.nextCp) {
          ref.current.emissiveIntensity = 0.05;
        } else if (i === aj.nextCp) {
          ref.current.emissiveIntensity = 0.45 + 0.35 * Math.sin(t * 3.0 + i * 0.5);
        } else {
          ref.current.emissiveIntensity = 0.15 + 0.05 * Math.sin(t * 1.5 + i * 0.5);
        }
      });
    }

    // Delivery checkpoint rings — only animate when job is delivery_driver.
    if (aj?.job === "delivery_driver") {
      deliveryCpRingRefs.forEach((ref, i) => {
        if (!ref.current) return;
        if (i >= aj.checkpoints.length) return;
        if (i < aj.nextCp) {
          ref.current.emissiveIntensity = 0.05;
        } else if (i === aj.nextCp) {
          ref.current.emissiveIntensity = 0.45 + 0.35 * Math.sin(t * 3.0 + i * 0.5);
        } else {
          ref.current.emissiveIntensity = 0.15 + 0.05 * Math.sin(t * 1.5 + i * 0.5);
        }
      });
    }

    // License-test checkpoint rings — only animate when a test is active.
    // nextCp ring: bright fast pulse. Passed: static dim. Future: slow medium pulse.
    cpRingRefs.forEach((ref, i) => {
      if (!ref.current) return;
      if (!at) {
        // No test — rings not rendered; ref.current will be null, so this branch
        // is unreachable, but kept as a safety guard.
        return;
      }
      if (i < at.nextCp) {
        // Passed — dim static
        ref.current.emissiveIntensity = 0.05;
      } else if (i === at.nextCp) {
        // Active target — bright fast pulse
        ref.current.emissiveIntensity = 0.45 + 0.35 * Math.sin(t * 3.0 + i * 0.5);
      } else {
        // Future — slower medium pulse
        ref.current.emissiveIntensity = 0.15 + 0.05 * Math.sin(t * 1.5 + i * 0.5);
      }
    });
  });

  const [mx, , mz] = STATION_MARKER_POS;

  return (
    <>
      {/* ════ Station spawn platform ════════════════════════════════════════ */}
      <group position={[mx, 0, mz]}>
        {/* Platform slab — 8 m × 8 m × 5 cm */}
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

        {/* Platform edge trim (north + south sides) */}
        {([-3.97, 3.97] as const).map((zOff, i) => (
          <mesh key={i} position={[0, 0.06, zOff]}>
            <boxGeometry args={[8, 0.05, 0.06]} />
            <meshStandardMaterial color="#3366dd" emissive="#4488ff" emissiveIntensity={1} />
          </mesh>
        ))}

        {/* Sign post */}
        <mesh position={[0, 2, -3.6]}>
          <boxGeometry args={[0.14, 4, 0.14]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.7} metalness={0.5} />
        </mesh>

        {/* Sign board */}
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

        {/* Sign text band */}
        <mesh position={[0, 4.15, -3.54]}>
          <boxGeometry args={[4.8, 0.12, 0.01]} />
          <meshStandardMaterial color="#ffffff" emissive="#aaccff" emissiveIntensity={2} />
        </mesh>

        {/* Ground ring indicator — radius 9–10 m */}
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

        <pointLight position={[0, 5, -3]} color="#5577ff" intensity={3} distance={18} decay={2} />
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

            <pointLight position={[0, 4, 0]} color="#ffaa22" intensity={2.5} distance={14} decay={2} />
          </group>
        );
      })()}

      {/* ════ Dealership marker ══════════════════════════════════════════════ */}
      {(() => {
        const [dx, , dz] = DEALERSHIP_POS;
        return (
          <group position={[dx, 0, dz]}>
            {/* Ground ring — 6–7 m radius, gold/green */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[6, 7, 48]} />
              <meshStandardMaterial
                ref={dealerRingRef}
                color="#1a3a0a"
                emissive="#66cc22"
                emissiveIntensity={0.5}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Sign post */}
            <mesh position={[0, 2, -0.3]}>
              <boxGeometry args={[0.12, 4, 0.12]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.7} metalness={0.6} />
            </mesh>

            {/* Sign board */}
            <mesh position={[0, 3.7, -0.3]}>
              <boxGeometry args={[4.6, 0.85, 0.1]} />
              <meshStandardMaterial
                ref={dealerSignRef}
                color="#0a1400"
                emissive="#44bb00"
                emissiveIntensity={0.8}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>

            {/* Sign text strip */}
            <mesh position={[0, 4.0, -0.24]}>
              <boxGeometry args={[4.2, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffffff" emissive="#aaffaa" emissiveIntensity={2} />
            </mesh>

            <pointLight position={[0, 4.5, 0]} color="#66cc22" intensity={2.5} distance={16} decay={2} />
          </group>
        );
      })()}

      {/* ════ City Worker Depot marker ══════════════════════════════════════════ */}
      {(() => {
        const [dpx, , dpz] = CITY_WORKER_DEPOT;
        return (
          <group position={[dpx, 0, dpz]}>
            {/* Ground ring — 5–6 m radius, orange/municipal */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[5, 6, 48]} />
              <meshStandardMaterial
                ref={depotRingRef}
                color="#5a2a00"
                emissive="#ff6600"
                emissiveIntensity={0.4}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Sign post */}
            <mesh position={[0, 1.8, -0.3]}>
              <boxGeometry args={[0.12, 3.6, 0.12]} />
              <meshStandardMaterial color="#3a2a00" roughness={0.7} metalness={0.5} />
            </mesh>

            {/* Sign board */}
            <mesh position={[0, 3.3, -0.3]}>
              <boxGeometry args={[4.4, 0.8, 0.1]} />
              <meshStandardMaterial
                ref={depotSignRef}
                color="#1a0d00"
                emissive="#ff6600"
                emissiveIntensity={0.7}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>

            {/* Sign text strip */}
            <mesh position={[0, 3.6, -0.24]}>
              <boxGeometry args={[4.0, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffffff" emissive="#ffcc88" emissiveIntensity={2} />
            </mesh>

            <pointLight position={[0, 4, 0]} color="#ff8833" intensity={2.5} distance={14} decay={2} />
          </group>
        );
      })()}

      {/* ════ Taxi Depot marker ═════════════════════════════════════════════ */}
      {(() => {
        const [tdx, , tdz] = TAXI_DEPOT;
        return (
          <group position={[tdx, 0, tdz]}>
            {/* Ground ring — 5–6 m radius, yellow/cab */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[5, 6, 48]} />
              <meshStandardMaterial
                ref={taxiDepotRingRef}
                color="#3a2e00"
                emissive="#f5c518"
                emissiveIntensity={0.4}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Sign post */}
            <mesh position={[0, 1.8, -0.3]}>
              <boxGeometry args={[0.12, 3.6, 0.12]} />
              <meshStandardMaterial color="#3a3000" roughness={0.7} metalness={0.5} />
            </mesh>

            {/* Sign board */}
            <mesh position={[0, 3.3, -0.3]}>
              <boxGeometry args={[3.8, 0.8, 0.1]} />
              <meshStandardMaterial
                ref={taxiDepotSignRef}
                color="#1a1600"
                emissive="#f5c518"
                emissiveIntensity={0.7}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>

            {/* Sign text strip */}
            <mesh position={[0, 3.6, -0.24]}>
              <boxGeometry args={[3.4, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffffff" emissive="#fff59d" emissiveIntensity={2} />
            </mesh>

            <pointLight position={[0, 4, 0]} color="#f5c518" intensity={2.5} distance={14} decay={2} />
          </group>
        );
      })()}

      {/* ════ Delivery Hub marker ══════════════════════════════════════════════ */}
      {(() => {
        const [dhx, , dhz] = DELIVERY_HUB;
        return (
          <group position={[dhx, 0, dhz]}>
            {/* Ground ring — 5–6 m radius, brown/cargo */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[5, 6, 48]} />
              <meshStandardMaterial
                ref={deliveryHubRingRef}
                color="#3a1e00"
                emissive="#c8884a"
                emissiveIntensity={0.4}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Sign post */}
            <mesh position={[0, 1.8, -0.3]}>
              <boxGeometry args={[0.12, 3.6, 0.12]} />
              <meshStandardMaterial color="#2a1800" roughness={0.7} metalness={0.5} />
            </mesh>

            {/* Sign board */}
            <mesh position={[0, 3.3, -0.3]}>
              <boxGeometry args={[4.6, 0.8, 0.1]} />
              <meshStandardMaterial
                ref={deliveryHubSignRef}
                color="#1a0e00"
                emissive="#c8884a"
                emissiveIntensity={0.7}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>

            {/* Sign text strip */}
            <mesh position={[0, 3.6, -0.24]}>
              <boxGeometry args={[4.2, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffffff" emissive="#f4c08a" emissiveIntensity={2} />
            </mesh>

            <pointLight position={[0, 4, 0]} color="#c8884a" intensity={2.5} distance={14} decay={2} />
          </group>
        );
      })()}

      {/* ════ Mechanic Garage marker ══════════════════════════════════════════════ */}
      {(() => {
        const [mgx, , mgz] = MECHANIC_GARAGE;
        return (
          <group position={[mgx, 0, mgz]}>
            {/* Ground ring — 5–6 m radius, steel/industrial gray */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[5, 6, 48]} />
              <meshStandardMaterial
                ref={mechanicGarageRingRef}
                color="#1a1a2a"
                emissive="#8899bb"
                emissiveIntensity={0.4}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Sign post */}
            <mesh position={[0, 1.8, -0.3]}>
              <boxGeometry args={[0.12, 3.6, 0.12]} />
              <meshStandardMaterial color="#222233" roughness={0.6} metalness={0.7} />
            </mesh>

            {/* Sign board */}
            <mesh position={[0, 3.3, -0.3]}>
              <boxGeometry args={[4.6, 0.8, 0.1]} />
              <meshStandardMaterial
                ref={mechanicGarageSignRef}
                color="#0a0a14"
                emissive="#8899bb"
                emissiveIntensity={0.7}
                roughness={0.3}
                metalness={0.4}
              />
            </mesh>

            {/* Sign text strip */}
            <mesh position={[0, 3.6, -0.24]}>
              <boxGeometry args={[4.2, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffffff" emissive="#ccddff" emissiveIntensity={2} />
            </mesh>

            <pointLight position={[0, 4, 0]} color="#8899bb" intensity={2.5} distance={14} decay={2} />
          </group>
        );
      })()}

      {/* ════ Mechanic service-call ring — only while mechanic route active ══════
          Shows the single broken-vehicle target. Pulses orange when travelling
          (nextCp===0), fast red when repairing (nextCp===1). */}
      {activeJob?.job === "mechanic" && (() => {
        const cp = activeJob.checkpoints[0];
        if (!cp) return null;
        const [cx, , cz] = cp;
        const isRepairing = activeJob.nextCp === 1;
        const emissiveColor = isRepairing ? "#ff4422" : "#ff9944";
        const ringColor     = isRepairing ? "#3a0800" : "#3a1a00";
        return (
          <group position={[cx, 0, cz]}>
            {/* Ground ring — 10–11 m (vehicle-scale) */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[10, 11, 48]} />
              <meshStandardMaterial
                ref={mechanicCpRingRef}
                color={ringColor}
                emissive={emissiveColor}
                emissiveIntensity={0.35}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Pillar + cap + light */}
            <mesh position={[0, 2, 0]}>
              <cylinderGeometry args={[0.16, 0.16, 4, 8]} />
              <meshStandardMaterial
                color={emissiveColor}
                emissive={emissiveColor}
                emissiveIntensity={0.6}
                roughness={0.3}
              />
            </mesh>
            <mesh position={[0, 4.2, 0]}>
              <sphereGeometry args={[0.28, 8, 8]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive={emissiveColor}
                emissiveIntensity={1.2}
              />
            </mesh>
            <pointLight
              position={[0, 4.3, 0]}
              color={emissiveColor}
              intensity={2.0}
              distance={16}
              decay={2}
            />
          </group>
        );
      })()}

      {/* ════ City Worker checkpoint rings — only while city_worker route active ═ */}
      {activeJob?.job === "city_worker" &&
        CITY_WORKER_CHECKPOINTS.map(([cx, , cz], i) => {
          const isPassed = i < activeJob.nextCp;
          const isNext   = i === activeJob.nextCp;
          return (
            <group key={`jcp-${i}`} position={[cx, 0, cz]}>
              {/* Ground ring — 7–8 m, orange/amber */}
              <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[7, 8, 48]} />
                <meshStandardMaterial
                  ref={jobCpRingRefs[i]}
                  color={isPassed ? "#301000" : "#5a2200"}
                  emissive="#ff8800"
                  emissiveIntensity={isPassed ? 0.05 : isNext ? 0.45 : 0.15}
                  transparent
                  opacity={isPassed ? 0.12 : isNext ? 0.5 : 0.3}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>

              {/* Pillar + cap + light only for active/future checkpoints */}
              {!isPassed && (
                <>
                  <mesh position={[0, 1.5, 0]}>
                    <cylinderGeometry args={[0.12, 0.12, 3, 8]} />
                    <meshStandardMaterial
                      color="#ff8800"
                      emissive="#ff8800"
                      emissiveIntensity={isNext ? 0.6 : 0.25}
                      roughness={0.4}
                    />
                  </mesh>
                  <mesh position={[0, 3.1, 0]}>
                    <sphereGeometry args={[0.22, 8, 8]} />
                    <meshStandardMaterial
                      color="#ffffff"
                      emissive="#ffbb44"
                      emissiveIntensity={isNext ? 1.2 : 0.4}
                    />
                  </mesh>
                  <pointLight
                    position={[0, 3.2, 0]}
                    color="#ff8800"
                    intensity={isNext ? 1.5 : 0.6}
                    distance={12}
                    decay={2}
                  />
                </>
              )}
            </group>
          );
        })}

      {/* ════ Taxi checkpoint rings — only while taxi_driver route active ═══════
          checkpoints[0] = pickup, checkpoints[1] = dropoff.
          Yellow/cab color for pickup (stage 0), blue for dropoff (stage 1). */}
      {activeJob?.job === "taxi_driver" &&
        activeJob.checkpoints.map(([cx, , cz], i) => {
          const isPassed = i < activeJob.nextCp;
          const isNext   = i === activeJob.nextCp;
          const isDropoff = i === 1;
          const emissiveColor = isDropoff ? "#4488ff" : "#f5c518";
          const ringColor     = isDropoff ? "#001a3a" : "#3a2e00";
          return (
            <group key={`tcp-${i}`} position={[cx, 0, cz]}>
              {/* Ground ring — 10–11 m (larger for vehicles) */}
              <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[10, 11, 48]} />
                <meshStandardMaterial
                  ref={taxiCpRingRefs[i]}
                  color={isPassed ? "#0a0a0a" : ringColor}
                  emissive={emissiveColor}
                  emissiveIntensity={isPassed ? 0.05 : isNext ? 0.45 : 0.15}
                  transparent
                  opacity={isPassed ? 0.12 : isNext ? 0.5 : 0.3}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>

              {/* Pillar + cap + light only for active/future stages */}
              {!isPassed && (
                <>
                  <mesh position={[0, 2, 0]}>
                    <cylinderGeometry args={[0.16, 0.16, 4, 8]} />
                    <meshStandardMaterial
                      color={emissiveColor}
                      emissive={emissiveColor}
                      emissiveIntensity={isNext ? 0.6 : 0.2}
                      roughness={0.3}
                    />
                  </mesh>
                  <mesh position={[0, 4.2, 0]}>
                    <sphereGeometry args={[0.28, 8, 8]} />
                    <meshStandardMaterial
                      color="#ffffff"
                      emissive={emissiveColor}
                      emissiveIntensity={isNext ? 1.2 : 0.4}
                    />
                  </mesh>
                  <pointLight
                    position={[0, 4.3, 0]}
                    color={emissiveColor}
                    intensity={isNext ? 2.0 : 0.8}
                    distance={16}
                    decay={2}
                  />
                </>
              )}
            </group>
          );
        })}

      {/* ════ Delivery checkpoint rings — only while delivery_driver route active ═
          checkpoints[0] = pickup/loading at hub; checkpoints[1..N] = delivery stops.
          Brown for loading stage, orange for delivery stops. */}
      {activeJob?.job === "delivery_driver" &&
        activeJob.checkpoints.map(([cx, , cz], i) => {
          const isPassed  = i < activeJob.nextCp;
          const isNext    = i === activeJob.nextCp;
          const isLoading = i === 0;
          const emissiveColor = isLoading ? "#c8884a" : "#ff9944";
          const ringColor     = isLoading ? "#3a1e00" : "#3a1a00";
          return (
            <group key={`dcp-${i}`} position={[cx, 0, cz]}>
              {/* Ground ring — 10–11 m (vehicle-scale) */}
              <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[10, 11, 48]} />
                <meshStandardMaterial
                  ref={deliveryCpRingRefs[i]}
                  color={isPassed ? "#0a0a0a" : ringColor}
                  emissive={emissiveColor}
                  emissiveIntensity={isPassed ? 0.05 : isNext ? 0.45 : 0.15}
                  transparent
                  opacity={isPassed ? 0.12 : isNext ? 0.5 : 0.3}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>

              {/* Pillar + cap + light only for active/future stages */}
              {!isPassed && (
                <>
                  <mesh position={[0, 2, 0]}>
                    <cylinderGeometry args={[0.16, 0.16, 4, 8]} />
                    <meshStandardMaterial
                      color={emissiveColor}
                      emissive={emissiveColor}
                      emissiveIntensity={isNext ? 0.6 : 0.2}
                      roughness={0.3}
                    />
                  </mesh>
                  <mesh position={[0, 4.2, 0]}>
                    <sphereGeometry args={[0.28, 8, 8]} />
                    <meshStandardMaterial
                      color="#ffffff"
                      emissive={emissiveColor}
                      emissiveIntensity={isNext ? 1.2 : 0.4}
                    />
                  </mesh>
                  <pointLight
                    position={[0, 4.3, 0]}
                    color={emissiveColor}
                    intensity={isNext ? 2.0 : 0.8}
                    distance={16}
                    decay={2}
                  />
                </>
              )}
            </group>
          );
        })}

      {/* ════ Medical Center marker ═══════════════════════════════════════════════ */}
      {(() => {
        const [mcx, , mcz] = MEDIC_CENTER;
        return (
          <group position={[mcx, 0, mcz]}>
            {/* Ground ring — 5–6 m radius, red/white medical */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[5, 6, 48]} />
              <meshStandardMaterial
                ref={medicCenterRingRef}
                color="#3a0000"
                emissive="#ff2244"
                emissiveIntensity={0.4}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Sign post */}
            <mesh position={[0, 1.8, -0.3]}>
              <boxGeometry args={[0.12, 3.6, 0.12]} />
              <meshStandardMaterial color="#220000" roughness={0.6} metalness={0.5} />
            </mesh>

            {/* Sign board */}
            <mesh position={[0, 3.3, -0.3]}>
              <boxGeometry args={[4.8, 0.8, 0.1]} />
              <meshStandardMaterial
                ref={medicCenterSignRef}
                color="#1a0000"
                emissive="#ff2244"
                emissiveIntensity={0.7}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>

            {/* Sign text strip — white cross bar */}
            <mesh position={[0, 3.6, -0.24]}>
              <boxGeometry args={[4.4, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffffff" emissive="#ffaaaa" emissiveIntensity={2} />
            </mesh>

            <pointLight position={[0, 4, 0]} color="#ff2244" intensity={2.5} distance={14} decay={2} />
          </group>
        );
      })()}

      {/* ════ Medic patient ring — RESPOND+TREAT stages (nextCp 0 or 1) ══════════
          Only rendered while job is "medic" AND nextCp <= 1.
          Red/white; pulses fast during treatment. */}
      {activeJob?.job === "medic" && activeJob.nextCp <= 1 && (() => {
        const cp = activeJob.checkpoints[0];
        if (!cp) return null;
        const [cx, , cz] = cp;
        const isTreating = activeJob.nextCp === 1;
        const emissiveColor = "#ff2244";
        return (
          <group position={[cx, 0, cz]}>
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[10, 11, 48]} />
              <meshStandardMaterial
                ref={medicPatientRingRef}
                color="#3a0000"
                emissive={emissiveColor}
                emissiveIntensity={0.35}
                transparent
                opacity={isTreating ? 0.6 : 0.45}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            <mesh position={[0, 2, 0]}>
              <cylinderGeometry args={[0.16, 0.16, 4, 8]} />
              <meshStandardMaterial color={emissiveColor} emissive={emissiveColor} emissiveIntensity={0.6} roughness={0.3} />
            </mesh>
            <mesh position={[0, 4.2, 0]}>
              <sphereGeometry args={[0.28, 8, 8]} />
              <meshStandardMaterial color="#ffffff" emissive={emissiveColor} emissiveIntensity={1.2} />
            </mesh>
            <pointLight position={[0, 4.3, 0]} color={emissiveColor} intensity={2.0} distance={16} decay={2} />
          </group>
        );
      })()}

      {/* ════ Medic ER bay ring — TRANSPORT stage (nextCp === 2) ════════════════════
          Blue/white; pulses when patient is ready for transport. */}
      {activeJob?.job === "medic" && activeJob.nextCp === 2 && (() => {
        const [erx, , erz] = MEDIC_ER_BAY;
        const emissiveColor = "#4488ff";
        return (
          <group position={[erx, 0, erz]}>
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[10, 11, 48]} />
              <meshStandardMaterial
                ref={medicErRingRef}
                color="#001a3a"
                emissive={emissiveColor}
                emissiveIntensity={0.35}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            <mesh position={[0, 2, 0]}>
              <cylinderGeometry args={[0.16, 0.16, 4, 8]} />
              <meshStandardMaterial color={emissiveColor} emissive={emissiveColor} emissiveIntensity={0.6} roughness={0.3} />
            </mesh>
            <mesh position={[0, 4.2, 0]}>
              <sphereGeometry args={[0.28, 8, 8]} />
              <meshStandardMaterial color="#ffffff" emissive={emissiveColor} emissiveIntensity={1.2} />
            </mesh>
            <pointLight position={[0, 4.3, 0]} color={emissiveColor} intensity={2.0} distance={16} decay={2} />
          </group>
        );
      })()}

      {/* ════ Police Station marker ═══════════════════════════════════════════════ */}
      {(() => {
        const [psx, , psz] = POLICE_STATION;
        return (
          <group position={[psx, 0, psz]}>
            {/* Ground ring — 5–6 m radius, navy/blue */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[5, 6, 48]} />
              <meshStandardMaterial
                ref={policeStationRingRef}
                color="#000a2a"
                emissive="#2255cc"
                emissiveIntensity={0.4}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Sign post */}
            <mesh position={[0, 1.8, -0.3]}>
              <boxGeometry args={[0.12, 3.6, 0.12]} />
              <meshStandardMaterial color="#111122" roughness={0.6} metalness={0.6} />
            </mesh>

            {/* Sign board */}
            <mesh position={[0, 3.3, -0.3]}>
              <boxGeometry args={[4.8, 0.8, 0.1]} />
              <meshStandardMaterial
                ref={policeStationSignRef}
                color="#00091a"
                emissive="#2255cc"
                emissiveIntensity={0.7}
                roughness={0.3}
                metalness={0.3}
              />
            </mesh>

            {/* Sign text strip — white/light blue */}
            <mesh position={[0, 3.6, -0.24]}>
              <boxGeometry args={[4.4, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffffff" emissive="#aabbff" emissiveIntensity={2} />
            </mesh>

            <pointLight position={[0, 4, 0]} color="#2255cc" intensity={2.5} distance={14} decay={2} />
          </group>
        );
      })()}

      {/* ════ Police Patrol checkpoint rings — only while police_patrol route active ═
          4 sampled patrol points; blue/navy color scheme. */}
      {activeJob?.job === "police_patrol" &&
        activeJob.checkpoints.map(([cx, , cz], i) => {
          const isPassed = i < activeJob.nextCp;
          const isNext   = i === activeJob.nextCp;
          const emissiveColor = "#2255cc";
          const ringColor     = isPassed ? "#000510" : "#000a2a";
          return (
            <group key={`pcp-${i}`} position={[cx, 0, cz]}>
              {/* Ground ring — 10–11 m (vehicle-scale) */}
              <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[10, 11, 48]} />
                <meshStandardMaterial
                  ref={policeCpRingRefs[i]}
                  color={ringColor}
                  emissive={emissiveColor}
                  emissiveIntensity={isPassed ? 0.05 : isNext ? 0.45 : 0.15}
                  transparent
                  opacity={isPassed ? 0.12 : isNext ? 0.5 : 0.3}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>

              {/* Pillar + cap + light only for active/future stages */}
              {!isPassed && (
                <>
                  <mesh position={[0, 2, 0]}>
                    <cylinderGeometry args={[0.16, 0.16, 4, 8]} />
                    <meshStandardMaterial
                      color={emissiveColor}
                      emissive={emissiveColor}
                      emissiveIntensity={isNext ? 0.6 : 0.2}
                      roughness={0.3}
                    />
                  </mesh>
                  <mesh position={[0, 4.2, 0]}>
                    <sphereGeometry args={[0.28, 8, 8]} />
                    <meshStandardMaterial
                      color="#ffffff"
                      emissive={emissiveColor}
                      emissiveIntensity={isNext ? 1.2 : 0.4}
                    />
                  </mesh>
                  <pointLight
                    position={[0, 4.3, 0]}
                    color={emissiveColor}
                    intensity={isNext ? 2.0 : 0.8}
                    distance={16}
                    decay={2}
                  />
                </>
              )}
            </group>
          );
        })}

      {/* ════ ATM markers — 5 walk-up kiosks (Phase 5F) ═══════════════════════
          Teal/green color scheme. Small kiosk footprint (≈0.6 m × 0.3 m × 1.5 m).
          Ground ring 3–4 m radius to indicate walk-up radius. */}
      {ATM_LOCATIONS.map(({ id, pos }, i) => {
        const [ax, , az] = pos;
        return (
          <group key={`atm-${id}`} position={[ax, 0, az]}>
            {/* Ground ring — 3–4 m (walk-up scale) */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[3, 4, 32]} />
              <meshStandardMaterial
                ref={atmRingRefs[i]}
                color="#003322"
                emissive="#00cc88"
                emissiveIntensity={0.4}
                transparent
                opacity={0.45}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Kiosk body */}
            <mesh position={[0, 0.75, 0]}>
              <boxGeometry args={[0.6, 1.5, 0.3]} />
              <meshStandardMaterial
                color="#0a1a14"
                emissive="#00cc88"
                emissiveIntensity={0.2}
                roughness={0.3}
                metalness={0.6}
              />
            </mesh>

            {/* Screen face */}
            <mesh position={[0, 0.9, 0.155]}>
              <boxGeometry args={[0.46, 0.5, 0.01]} />
              <meshStandardMaterial
                color="#001a0e"
                emissive="#00ff99"
                emissiveIntensity={1.0}
                roughness={0.1}
                metalness={0.2}
              />
            </mesh>

            {/* $ sign strip */}
            <mesh position={[0, 1.35, 0.156]}>
              <boxGeometry args={[0.3, 0.12, 0.005]} />
              <meshStandardMaterial color="#ffffff" emissive="#aaffdd" emissiveIntensity={2} />
            </mesh>

            <pointLight
              position={[0, 1.6, 0]}
              color="#00cc88"
              intensity={1.8}
              distance={10}
              decay={2}
            />
          </group>
        );
      })}

      {/* ════ Phase 6D: Booking Desk marker ════════════════════════════════════ */}
      <group position={[POLICE_BOOKING_DESK_POS[0], POLICE_BOOKING_DESK_POS[1], POLICE_BOOKING_DESK_POS[2]]}>
        {/* Ground ring — 4 m radius */}
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.5, 4.5, 40]} />
          <meshStandardMaterial
            ref={bookingDeskRingRef}
            color="#3d1a00"
            emissive="#cc6600"
            emissiveIntensity={0.4}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Sign post */}
        <mesh position={[0, 2, -2]}>
          <boxGeometry args={[0.12, 4, 0.12]} />
          <meshStandardMaterial color="#2a1a0a" roughness={0.7} metalness={0.4} />
        </mesh>

        {/* Sign board */}
        <mesh position={[0, 3.6, -2]}>
          <boxGeometry args={[3.6, 0.8, 0.1]} />
          <meshStandardMaterial
            ref={bookingDeskSignRef}
            color="#1a0a00"
            emissive="#cc6600"
            emissiveIntensity={0.7}
            roughness={0.3}
            metalness={0.2}
          />
        </mesh>

        {/* Sign text strip */}
        <mesh position={[0, 3.85, -1.94]}>
          <boxGeometry args={[3.2, 0.1, 0.005]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffcc88" emissiveIntensity={2} />
        </mesh>

        <pointLight
          position={[0, 3.6, -1.8]}
          color="#cc6600"
          intensity={1.4}
          distance={10}
          decay={2}
        />
      </group>

      {/* ════ Phase 6D: Jail Cell confinement ring ══════════════════════════════ */}
      <group position={[POLICE_JAIL_CELL[0], POLICE_JAIL_CELL[1], POLICE_JAIL_CELL[2]]}>
        {/* Ground ring — matches POLICE_JAIL_RADIUS (8 m) */}
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[7.5, 8.5, 48]} />
          <meshStandardMaterial
            ref={jailCellRingRef}
            color="#200000"
            emissive="#cc0000"
            emissiveIntensity={0.3}
            transparent
            opacity={0.35}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Corner bar pillars — four corners of the cell perimeter */}
        {([[-5, -5], [5, -5], [5, 5], [-5, 5]] as const).map(([px, pz], i) => (
          <mesh key={i} position={[px, 2, pz]}>
            <cylinderGeometry args={[0.08, 0.08, 4, 6]} />
            <meshStandardMaterial
              color="#440000"
              emissive="#880000"
              emissiveIntensity={0.4}
              roughness={0.5}
              metalness={0.6}
            />
          </mesh>
        ))}

        <pointLight
          position={[0, 3, 0]}
          color="#cc2200"
          intensity={0.8}
          distance={12}
          decay={2}
        />
      </group>

      {/* ════ Phase 6D: Release Exit gate ═══════════════════════════════════════ */}
      <group position={[POLICE_RELEASE_POS[0], POLICE_RELEASE_POS[1], POLICE_RELEASE_POS[2]]}>
        {/* Ground ring — matches POLICE_RELEASE_RADIUS (4 m) */}
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.5, 4.5, 40]} />
          <meshStandardMaterial
            ref={releaseExitRingRef}
            color="#002010"
            emissive="#00cc55"
            emissiveIntensity={0.4}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Gate arch — left post */}
        <mesh position={[-1.5, 2, 0]}>
          <boxGeometry args={[0.2, 4, 0.2]} />
          <meshStandardMaterial
            color="#003310"
            emissive="#00aa44"
            emissiveIntensity={0.5}
            roughness={0.4}
            metalness={0.5}
          />
        </mesh>

        {/* Gate arch — right post */}
        <mesh position={[1.5, 2, 0]}>
          <boxGeometry args={[0.2, 4, 0.2]} />
          <meshStandardMaterial
            color="#003310"
            emissive="#00aa44"
            emissiveIntensity={0.5}
            roughness={0.4}
            metalness={0.5}
          />
        </mesh>

        {/* Gate arch — crossbar */}
        <mesh position={[0, 4.1, 0]}>
          <boxGeometry args={[3.2, 0.2, 0.2]} />
          <meshStandardMaterial
            color="#003310"
            emissive="#00cc66"
            emissiveIntensity={0.7}
            roughness={0.3}
            metalness={0.5}
          />
        </mesh>

        {/* Sign post */}
        <mesh position={[0, 2.2, -2.5]}>
          <boxGeometry args={[0.12, 4, 0.12]} />
          <meshStandardMaterial color="#0a2a12" roughness={0.7} metalness={0.4} />
        </mesh>

        {/* Sign board */}
        <mesh position={[0, 3.8, -2.5]}>
          <boxGeometry args={[4.0, 0.75, 0.1]} />
          <meshStandardMaterial
            color="#001a0a"
            emissive="#00cc55"
            emissiveIntensity={0.7}
            roughness={0.3}
            metalness={0.2}
          />
        </mesh>

        {/* Sign text strip */}
        <mesh position={[0, 4.0, -2.44]}>
          <boxGeometry args={[3.6, 0.1, 0.005]} />
          <meshStandardMaterial color="#ffffff" emissive="#aaffcc" emissiveIntensity={2} />
        </mesh>

        <pointLight
          position={[0, 4, 0]}
          color="#00cc55"
          intensity={1.6}
          distance={12}
          decay={2}
        />
      </group>

      {/* ════ License-test checkpoint rings — only while test is active ════════
          Passed rings are dimmed. The next target pulses brightly.
          Future rings are at medium intensity. Point lights omitted for passed
          checkpoints to avoid wasting the light budget after they're cleared. */}
      {/* ════ Phase 7D: Grove Street hangout marker ════════════════════════════
          Always-visible sign + ring at GROVE_STREET_HANGOUT_POS.
          Green color scheme matching the grove_street faction color #2e7d32. */}
      {(() => {
        const [gx, , gz] = GROVE_STREET_HANGOUT_POS;
        return (
          <group position={[gx, 0, gz]}>
            {/* Ground ring — 5–6 m radius, gang green */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[5, 6, 48]} />
              <meshStandardMaterial
                ref={gangHangoutRingRef}
                color="#0a2010"
                emissive="#2e7d32"
                emissiveIntensity={0.4}
                transparent
                opacity={0.55}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Sign post */}
            <mesh position={[0, 1.8, -0.3]}>
              <boxGeometry args={[0.12, 3.6, 0.12]} />
              <meshStandardMaterial color="#1a2a1a" roughness={0.7} metalness={0.4} />
            </mesh>

            {/* Sign board */}
            <mesh position={[0, 3.3, -0.3]}>
              <boxGeometry args={[4.8, 0.8, 0.1]} />
              <meshStandardMaterial
                ref={gangHangoutSignRef}
                color="#0a1a0a"
                emissive="#2e7d32"
                emissiveIntensity={0.7}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>

            {/* Sign text strip */}
            <mesh position={[0, 3.6, -0.24]}>
              <boxGeometry args={[4.4, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffffff" emissive="#81c784" emissiveIntensity={2} />
            </mesh>

            <pointLight position={[0, 4, 0]} color="#2e7d32" intensity={2.5} distance={14} decay={2} />
          </group>
        );
      })()}

      {/* ════ Phase 7D: Grove Street turf territory ring ════════════════════════
          Large slow-breathing ring indicating the turf boundary.
          Always visible — visual only in Phase 7D (no persistent capture yet). */}
      {(() => {
        const [tx, , tz] = GROVE_STREET_TURF_CENTER;
        const outerR = GROVE_STREET_TURF_RADIUS;
        const innerR = outerR - 1.5;
        return (
          <mesh position={[tx, 0.02, tz]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[innerR, outerR, 72]} />
            <meshStandardMaterial
              ref={gangTurfRingRef}
              color="#0a1a0a"
              emissive="#1b5e20"
              emissiveIntensity={0.15}
              transparent
              opacity={0.35}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })()}

      {/* ════ Phase 7G: Tag Turf mission checkpoint rings ══════════════════════
          Only rendered while activeGangMission is non-null.
          Current target pulses brightly green-yellow; completed = dim; future = muted. */}
      {activeGangMission &&
        GROVE_TAG_POINTS.map(([px, py, pz], i) => {
          const done    = i < activeGangMission.nextIdx;
          const current = i === activeGangMission.nextIdx;
          return (
            <group key={`tag-cp-${i}`} position={[px, 0, pz]}>
              {/* Ground ring */}
              <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[3.5, 4.5, 40]} />
                <meshStandardMaterial
                  ref={tagCpRingRefs[i]}
                  color={done ? "#001a00" : current ? "#1a2a00" : "#0a1a0a"}
                  emissive={current ? "#aaff00" : "#44aa00"}
                  emissiveIntensity={done ? 0.05 : current ? 0.55 : 0.2}
                  transparent
                  opacity={done ? 0.12 : current ? 0.55 : 0.25}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>

              {/* Pillar + cap — only for pending/current rings */}
              {!done && (
                <>
                  <mesh position={[0, 1.4, 0]}>
                    <cylinderGeometry args={[0.10, 0.10, 2.8, 8]} />
                    <meshStandardMaterial
                      color={current ? "#aaff00" : "#44aa00"}
                      emissive={current ? "#aaff00" : "#44aa00"}
                      emissiveIntensity={current ? 0.7 : 0.3}
                      roughness={0.4}
                    />
                  </mesh>
                  <mesh position={[0, 2.9, 0]}>
                    <sphereGeometry args={[0.18, 8, 8]} />
                    <meshStandardMaterial
                      color="#ffffff"
                      emissive={current ? "#ccff44" : "#88cc00"}
                      emissiveIntensity={current ? 1.4 : 0.5}
                    />
                  </mesh>
                  <pointLight
                    position={[0, 3.0, 0]}
                    color={current ? "#aaff00" : "#66bb00"}
                    intensity={current ? 1.8 : 0.7}
                    distance={10}
                    decay={2}
                  />
                </>
              )}

              {/* Number label (y offset above post) */}
              <mesh position={[0, py + 3.6, 0]} rotation={[0, Math.PI / 4, 0]}>
                <planeGeometry args={[0.6, 0.3]} />
                <meshStandardMaterial
                  color={current ? "#aaff00" : done ? "#334433" : "#446644"}
                  emissive={current ? "#88cc00" : "#224422"}
                  emissiveIntensity={current ? 0.8 : 0.2}
                  transparent
                  opacity={done ? 0.3 : 0.8}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            </group>
          );
        })}

      {activeTest &&
        LICENSE_TEST_CHECKPOINTS.map(([cx, , cz], i) => {
          const isPassed = i < activeTest.nextCp;
          const isNext   = i === activeTest.nextCp;
          return (
            <group key={`cp-${i}`} position={[cx, 0, cz]}>
              {/* Ground ring */}
              <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[7, 8, 48]} />
                <meshStandardMaterial
                  ref={cpRingRefs[i]}
                  color={isPassed ? "#002010" : "#004d20"}
                  emissive="#00e676"
                  emissiveIntensity={isPassed ? 0.05 : isNext ? 0.45 : 0.15}
                  transparent
                  opacity={isPassed ? 0.12 : isNext ? 0.45 : 0.28}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>

              {/* Pillar + cap + light only for not-yet-passed checkpoints */}
              {!isPassed && (
                <>
                  <mesh position={[0, 1.5, 0]}>
                    <cylinderGeometry args={[0.12, 0.12, 3, 8]} />
                    <meshStandardMaterial
                      color="#00e676"
                      emissive="#00e676"
                      emissiveIntensity={isNext ? 0.6 : 0.25}
                      roughness={0.4}
                    />
                  </mesh>
                  <mesh position={[0, 3.1, 0]}>
                    <sphereGeometry args={[0.22, 8, 8]} />
                    <meshStandardMaterial
                      color="#ffffff"
                      emissive="#00ff99"
                      emissiveIntensity={isNext ? 1.2 : 0.4}
                    />
                  </mesh>
                  <pointLight
                    position={[0, 3.2, 0]}
                    color="#00e676"
                    intensity={isNext ? 1.5 : 0.6}
                    distance={12}
                    decay={2}
                  />
                </>
              )}
            </group>
          );
        })}
    </>
  );
}
