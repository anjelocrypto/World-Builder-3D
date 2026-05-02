import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  ELEVATED_RAIL_LOOP,
  RAIL_DECK_HEIGHT,
  getRailPillars,
  railLoopArcLengths,
  railLoopPointAt,
  trainStationArcS,
  TRAIN_STATION,
  SKYBRIDGES,
} from "../shared/cityData";

const DECK_COLOR = "#3a3a44";
const DECK_EDGE_COLOR = "#1f1f25";
const RAIL_COLOR = "#9aa0aa";
const PILLAR_COLOR = "#3a3f48";
const STATION_COLOR = "#2c333d";
const STATION_TRIM = "#cfd6e0";
const STATION_SIGN_COLOR = "#e8c878";
const SKYBRIDGE_COLOR = "#4a5260";
const SKYBRIDGE_GLASS = "#9ec0d8";
const TRAIN_BODY = "#2a4a78";
const TRAIN_WINDOW = "#cfe6ff";

// =============================================================
// RAIL DECK + RAILS — one box per polyline segment
// =============================================================

function RailDeck() {
  const segments = useMemo(() => {
    const out: { x: number; z: number; len: number; rotY: number }[] = [];
    for (let i = 0; i < ELEVATED_RAIL_LOOP.length - 1; i++) {
      const a = ELEVATED_RAIL_LOOP[i];
      const b = ELEVATED_RAIL_LOOP[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      // Local segment forward axis = (dx, dz). Box default is +Z forward,
      // so rotate by atan2(dx, dz).
      const rotY = Math.atan2(dx, dz);
      out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, len, rotY });
    }
    return out;
  }, []);

  return (
    <group>
      {segments.map((s, i) => (
        <group key={i} position={[s.x, RAIL_DECK_HEIGHT, s.z]} rotation={[0, s.rotY, 0]}>
          {/* Deck slab — 4m wide, 0.6m thick */}
          <mesh position={[0, -0.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[4, 0.6, s.len]} />
            <meshLambertMaterial color={DECK_COLOR} />
          </mesh>
          {/* Edge curbs (left + right) */}
          <mesh position={[ 1.95, -0.05, 0]}>
            <boxGeometry args={[0.1, 0.5, s.len]} />
            <meshLambertMaterial color={DECK_EDGE_COLOR} />
          </mesh>
          <mesh position={[-1.95, -0.05, 0]}>
            <boxGeometry args={[0.1, 0.5, s.len]} />
            <meshLambertMaterial color={DECK_EDGE_COLOR} />
          </mesh>
          {/* Two rails on top of the deck */}
          <mesh position={[ 0.7, 0.08, 0]}>
            <boxGeometry args={[0.12, 0.16, s.len]} />
            <meshLambertMaterial color={RAIL_COLOR} />
          </mesh>
          <mesh position={[-0.7, 0.08, 0]}>
            <boxGeometry args={[0.12, 0.16, s.len]} />
            <meshLambertMaterial color={RAIL_COLOR} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// =============================================================
// RAIL PILLARS — instanced columns with crossbeam caps
// =============================================================

function RailPillars() {
  const pillars = useMemo(() => getRailPillars(), []);
  const pillarHeight = RAIL_DECK_HEIGHT - 0.6; // sits under the deck slab
  const colRef = useRef<THREE.InstancedMesh>(null);
  const beamRef = useRef<THREE.InstancedMesh>(null);

  // Refs are null on first render — write the instance matrices in a
  // post-mount effect so the meshes actually become visible.
  useEffect(() => {
    const col = colRef.current;
    const beam = beamRef.current;
    if (!col || !beam) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sOne = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < pillars.length; i++) {
      const p = pillars[i];
      e.set(0, p.rotY, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(p.x, pillarHeight / 2, p.z), q, sOne);
      col.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, pillarHeight + 0.15, p.z), q, sOne);
      beam.setMatrixAt(i, m);
    }
    col.instanceMatrix.needsUpdate = true;
    beam.instanceMatrix.needsUpdate = true;
    col.computeBoundingSphere();
    col.computeBoundingBox();
    beam.computeBoundingSphere();
    beam.computeBoundingBox();
  }, [pillars, pillarHeight]);

  return (
    <group>
      <instancedMesh
        ref={colRef}
        args={[undefined, undefined, pillars.length]}
        castShadow
      >
        <boxGeometry args={[1.4, pillarHeight, 1.4]} />
        <meshLambertMaterial color={PILLAR_COLOR} />
      </instancedMesh>
      <instancedMesh
        ref={beamRef}
        args={[undefined, undefined, pillars.length]}
        castShadow
      >
        <boxGeometry args={[4.2, 0.3, 1.6]} />
        <meshLambertMaterial color={PILLAR_COLOR} />
      </instancedMesh>
    </group>
  );
}

// =============================================================
// TRAIN STATION — deck, canopy, stairs, sign
// =============================================================

function TrainStation() {
  const s = TRAIN_STATION;
  const platformThickness = 0.4;
  const canopyHeight = 3.2;

  return (
    <group position={[s.cx, 0, s.cz]} rotation={[0, s.rotY, 0]}>
      {/* Platform deck on top of rail deck */}
      <mesh position={[0, s.deckY + 0.2 + platformThickness / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[s.w, platformThickness, s.d]} />
        <meshLambertMaterial color={STATION_COLOR} />
      </mesh>
      {/* Yellow safety stripe along the rail-side edge */}
      <mesh
        position={[-s.w / 2 + 0.4, s.deckY + 0.2 + platformThickness + 0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[0.3, s.d - 0.6]} />
        <meshBasicMaterial color="#f5c542" />
      </mesh>
      {/* Canopy supports (4) */}
      {[
        [ s.w / 2 - 0.4, -s.d / 2 + 0.6],
        [ s.w / 2 - 0.4,  s.d / 2 - 0.6],
        [-s.w / 2 + 0.4, -s.d / 2 + 0.6],
        [-s.w / 2 + 0.4,  s.d / 2 - 0.6],
      ].map(([cx, cz], i) => (
        <mesh
          key={i}
          position={[cx, s.deckY + 0.4 + canopyHeight / 2, cz]}
          castShadow
        >
          <boxGeometry args={[0.2, canopyHeight, 0.2]} />
          <meshLambertMaterial color={STATION_TRIM} />
        </mesh>
      ))}
      {/* Canopy roof */}
      <mesh
        position={[0, s.deckY + 0.4 + canopyHeight + 0.1, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[s.w + 0.4, 0.2, s.d + 0.4]} />
        <meshLambertMaterial color={STATION_COLOR} />
      </mesh>
      {/* Emissive station sign on the canopy fascia (faces -X / inner side) */}
      <mesh
        position={[-s.w / 2 - 0.05, s.deckY + 0.4 + canopyHeight - 0.6, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[s.d * 0.7, 0.9]} />
        <meshBasicMaterial color={STATION_SIGN_COLOR} />
      </mesh>
      {/* Stair: from platform top down to ground at (stairX, stairZ),
          relative offset is (stairX - cx, stairZ - cz). */}
      {(() => {
        const dx = s.stairX - s.cx;
        const dz = s.stairZ - s.cz;
        const run = Math.hypot(dx, dz);
        const rise = s.deckY + 0.6;
        const rotY = Math.atan2(dx, dz);
        return (
          <group position={[dx / 2, rise / 2, dz / 2]} rotation={[0, rotY, 0]}>
            <mesh
              position={[0, 0, 0]}
              rotation={[Math.atan2(rise, run), 0, 0]}
              castShadow
            >
              <boxGeometry args={[1.6, 0.2, Math.hypot(run, rise)]} />
              <meshLambertMaterial color={STATION_COLOR} />
            </mesh>
            {/* Two handrails */}
            {[-0.7, 0.7].map((ox, i) => (
              <mesh
                key={i}
                position={[ox, 0.8, 0]}
                rotation={[Math.atan2(rise, run), 0, 0]}
              >
                <boxGeometry args={[0.05, 0.05, Math.hypot(run, rise)]} />
                <meshLambertMaterial color={STATION_TRIM} />
              </mesh>
            ))}
          </group>
        );
      })()}
    </group>
  );
}

// =============================================================
// SKYBRIDGES — beam + glass tube between two anchors
// =============================================================

function Skybridges() {
  return (
    <group>
      {SKYBRIDGES.map((sb) => {
        const dx = sb.x2 - sb.x1;
        const dz = sb.z2 - sb.z1;
        const len = Math.hypot(dx, dz);
        const cx = (sb.x1 + sb.x2) / 2;
        const cz = (sb.z1 + sb.z2) / 2;
        const rotY = Math.atan2(dx, dz);
        return (
          <group key={sb.id} position={[cx, sb.y, cz]} rotation={[0, rotY, 0]}>
            {/* Bottom beam */}
            <mesh position={[0, -0.25, 0]} castShadow>
              <boxGeometry args={[2.0, 0.3, len]} />
              <meshLambertMaterial color={SKYBRIDGE_COLOR} />
            </mesh>
            {/* Glass tube body */}
            <mesh position={[0, 0.8, 0]} castShadow>
              <boxGeometry args={[1.8, 1.8, len - 0.5]} />
              <meshPhysicalMaterial
                color={SKYBRIDGE_GLASS}
                transparent
                opacity={0.55}
                roughness={0.15}
                metalness={0.1}
              />
            </mesh>
            {/* Roof */}
            <mesh position={[0, 1.85, 0]} castShadow>
              <boxGeometry args={[2.0, 0.15, len]} />
              <meshLambertMaterial color={SKYBRIDGE_COLOR} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// =============================================================
// TRAIN — client-only deterministic loop traversal
// =============================================================
// Position is derived from Date.now() so every client sees the same
// train at the same arc length. Pauses ~3s at the station via a
// piecewise-linear arc-length schedule.

const TRAIN_SPEED = 14;        // m/s along the loop
const TRAIN_DWELL = 3.0;       // seconds paused at the station
const CAR_LEN = 11.5;
const CAR_WIDTH = 2.2;
const CAR_HEIGHT = 2.6;
const CAR_GAP = 0.8;
const TRAIN_CARS = 3;

function trainArcAtTime(tSec: number, total: number, sStation: number): number {
  // Time to make one lap = total/speed + dwell.
  const lapTime = total / TRAIN_SPEED + TRAIN_DWELL;
  const tt = ((tSec % lapTime) + lapTime) % lapTime;
  // Arc length to the station (from arc=0).
  const tToStation = sStation / TRAIN_SPEED;
  if (tt < tToStation) {
    return tt * TRAIN_SPEED;
  }
  if (tt < tToStation + TRAIN_DWELL) {
    return sStation;
  }
  return sStation + (tt - tToStation - TRAIN_DWELL) * TRAIN_SPEED;
}

function TrainCar({ s, total }: { s: number; total: number }) {
  const ref = useRef<THREE.Group>(null);
  // Update car position on every frame from its arc length s.
  useFrame(() => {
    if (!ref.current) return;
    const p = railLoopPointAt(((s % total) + total) % total);
    ref.current.position.set(p.x, RAIL_DECK_HEIGHT + 0.2 + CAR_HEIGHT / 2, p.z);
    ref.current.rotation.set(0, p.rotY, 0);
  });
  return (
    <group ref={ref}>
      {/* Body */}
      <mesh castShadow>
        <boxGeometry args={[CAR_WIDTH, CAR_HEIGHT, CAR_LEN]} />
        <meshLambertMaterial color={TRAIN_BODY} />
      </mesh>
      {/* Window strip on each side */}
      <mesh position={[ CAR_WIDTH / 2 + 0.005, 0.3, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[CAR_LEN * 0.85, 0.9]} />
        <meshBasicMaterial color={TRAIN_WINDOW} />
      </mesh>
      <mesh position={[-CAR_WIDTH / 2 - 0.005, 0.3, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[CAR_LEN * 0.85, 0.9]} />
        <meshBasicMaterial color={TRAIN_WINDOW} />
      </mesh>
      {/* Front headlight */}
      <mesh position={[0, 0.1, CAR_LEN / 2 + 0.005]}>
        <planeGeometry args={[1.4, 0.5]} />
        <meshBasicMaterial color="#fff5d0" />
      </mesh>
    </group>
  );
}

function Train() {
  // Use absolute wall-clock time so every client (regardless of mount
  // time) computes the same arc length for the same Date.now().
  const carRefs = useMemo(
    () => Array.from({ length: TRAIN_CARS }, () => ({ s: 0 })),
    [],
  );
  const { total } = useMemo(() => railLoopArcLengths(), []);
  const sStation = useMemo(() => trainStationArcS(), []);

  useFrame(() => {
    const tSec = Date.now() / 1000;
    const head = trainArcAtTime(tSec, total, sStation);
    for (let i = 0; i < TRAIN_CARS; i++) {
      // Each car trails the head by (i * (CAR_LEN + CAR_GAP)).
      carRefs[i].s = head - i * (CAR_LEN + CAR_GAP);
    }
  });

  return (
    <group>
      {carRefs.map((r, i) => (
        <DynamicTrainCar key={i} arcRef={r} total={total} />
      ))}
    </group>
  );
}

// A train car whose arc length is read from a mutable ref every frame
// (so the parent updates positions in one place).
function DynamicTrainCar({
  arcRef,
  total,
}: {
  arcRef: { s: number };
  total: number;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const sw = ((arcRef.s % total) + total) % total;
    const p = railLoopPointAt(sw);
    ref.current.position.set(p.x, RAIL_DECK_HEIGHT + 0.2 + CAR_HEIGHT / 2, p.z);
    ref.current.rotation.set(0, p.rotY, 0);
  });
  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[CAR_WIDTH, CAR_HEIGHT, CAR_LEN]} />
        <meshLambertMaterial color={TRAIN_BODY} />
      </mesh>
      <mesh position={[ CAR_WIDTH / 2 + 0.005, 0.3, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[CAR_LEN * 0.85, 0.9]} />
        <meshBasicMaterial color={TRAIN_WINDOW} />
      </mesh>
      <mesh position={[-CAR_WIDTH / 2 - 0.005, 0.3, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[CAR_LEN * 0.85, 0.9]} />
        <meshBasicMaterial color={TRAIN_WINDOW} />
      </mesh>
      <mesh position={[0, 0.1, CAR_LEN / 2 + 0.005]}>
        <planeGeometry args={[1.4, 0.5]} />
        <meshBasicMaterial color="#fff5d0" />
      </mesh>
    </group>
  );
}

// Suppress "unused" complaints — TrainCar is kept for reference but the
// active renderer uses DynamicTrainCar for shared-frame updates.
void TrainCar;

// =============================================================
// PUBLIC ENTRY
// =============================================================

export default function CentralRail() {
  return (
    <group>
      <RailDeck />
      <RailPillars />
      <TrainStation />
      <Skybridges />
      <Train />
    </group>
  );
}
