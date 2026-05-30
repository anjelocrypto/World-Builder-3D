import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  ELEVATED_RAIL_LOOP,
  RAIL_DECK_HEIGHT,
  getRailPillars,
  railLoopArcLengths,
  railLoopPointAt,
  SKYBRIDGES,
} from "../shared/cityData";
import {
  TRAIN,
  ESC_RUN,
  ESC_HALF_BAND,
  PLATFORM_TOP_Y,
  stationGeoms,
  trainCarArcs,
} from "../shared/railTransit";

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

// One station: platform deck + canopy + sign + TWO walkable escalator lanes
// (UP / DOWN) that descend OUTWARD to a ground foot. Geometry comes from the
// shared railTransit `stationGeoms()` so visuals match the walkable surface +
// colliders exactly. All world-space (rotY handled by the outward sign).
function Station({ g }: { g: ReturnType<typeof stationGeoms>[number] }) {
  const s = g.station;
  const platformThickness = 0.4;
  const canopyHeight = 3.2;
  const top = PLATFORM_TOP_Y;                 // walkable platform top
  const railRise = top;                       // ramp rise from ground (≈12.6)
  const escSpan = Math.hypot(ESC_RUN, railRise);
  const escAngle = Math.atan2(railRise, ESC_RUN);
  const innerX = s.cx - g.out * (s.w / 2);    // rail-side (train) edge
  const rampMidX = (g.edgeX + g.footX) / 2;
  const rampMidY = top / 2;

  return (
    <group>
      {/* Platform deck (top surface at PLATFORM_TOP_Y) */}
      <mesh position={[s.cx, top - platformThickness / 2, s.cz]} castShadow receiveShadow>
        <boxGeometry args={[s.w, platformThickness, s.d]} />
        <meshLambertMaterial color={STATION_COLOR} />
      </mesh>
      {/* Yellow safety stripe along the rail-side edge */}
      <mesh position={[innerX + g.out * 0.4, top + 0.002, s.cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.3, s.d - 0.6]} />
        <meshBasicMaterial color="#f5c542" />
      </mesh>
      {/* Platform perimeter guard-rails (visual; collision is in railTransit) */}
      {[
        { p: [s.cx, top + 0.55, s.cz - s.d / 2], s: [s.w, 1.1, 0.1] },
        { p: [s.cx, top + 0.55, s.cz + s.d / 2], s: [s.w, 1.1, 0.1] },
        { p: [innerX, top + 0.55, s.cz], s: [0.1, 1.1, s.d] },
      ].map((b, i) => (
        <mesh key={`prail-${i}`} position={b.p as [number, number, number]}>
          <boxGeometry args={b.s as [number, number, number]} />
          <meshLambertMaterial color={STATION_TRIM} />
        </mesh>
      ))}
      {/* Canopy supports (4) + roof */}
      {[
        [g.edgeX - g.out * 0.4, s.cz - s.d / 2 + 0.6],
        [g.edgeX - g.out * 0.4, s.cz + s.d / 2 - 0.6],
        [innerX + g.out * 0.4, s.cz - s.d / 2 + 0.6],
        [innerX + g.out * 0.4, s.cz + s.d / 2 - 0.6],
      ].map(([px, pz], i) => (
        <mesh key={`sup-${i}`} position={[px, top + canopyHeight / 2, pz]} castShadow>
          <boxGeometry args={[0.2, canopyHeight, 0.2]} />
          <meshLambertMaterial color={STATION_TRIM} />
        </mesh>
      ))}
      <mesh position={[s.cx, top + canopyHeight + 0.1, s.cz]} castShadow receiveShadow>
        <boxGeometry args={[s.w + 0.4, 0.2, s.d + 0.4]} />
        <meshLambertMaterial color={STATION_COLOR} />
      </mesh>
      {/* Emissive station sign on the canopy fascia (faces the rail / inner side) */}
      <mesh position={[innerX - g.out * 0.05, top + canopyHeight - 0.6, s.cz]} rotation={[0, g.out * Math.PI / 2, 0]}>
        <planeGeometry args={[s.d * 0.7, 0.9]} />
        <meshBasicMaterial color={STATION_SIGN_COLOR} />
      </mesh>

      {/* ── Two escalator lanes (one walkable ramp band, visually split) ── */}
      {/* Ramp deck (full band, walkable) */}
      <mesh position={[rampMidX, rampMidY, s.cz]} rotation={[0, 0, g.out * escAngle]} castShadow receiveShadow>
        <boxGeometry args={[escSpan, 0.2, ESC_HALF_BAND * 2]} />
        <meshLambertMaterial color={STATION_COLOR} />
      </mesh>
      {/* Centre divider rail (between UP / DOWN lanes) */}
      <mesh position={[rampMidX, rampMidY + 0.55, s.cz]} rotation={[0, 0, g.out * escAngle]}>
        <boxGeometry args={[escSpan, 1.0, 0.12]} />
        <meshLambertMaterial color={STATION_TRIM} />
      </mesh>
      {/* Side guard rails (both long edges of the ramp band) */}
      {[-ESC_HALF_BAND, ESC_HALF_BAND].map((dz, i) => (
        <mesh key={`erail-${i}`} position={[rampMidX, rampMidY + 0.55, s.cz + dz]} rotation={[0, 0, g.out * escAngle]}>
          <boxGeometry args={[escSpan, 1.0, 0.1]} />
          <meshLambertMaterial color={STATION_TRIM} />
        </mesh>
      ))}
      {/* Direction arrow / tread strips: cyan UP lane, amber DOWN lane */}
      {([[-ESC_HALF_BAND / 2, "#39d0ff"], [ESC_HALF_BAND / 2, "#ffb347"]] as const).map(([dz, col], i) => (
        <mesh key={`tread-${i}`} position={[rampMidX, rampMidY + 0.12, s.cz + dz]} rotation={[0, 0, g.out * escAngle]}>
          <boxGeometry args={[escSpan - 0.4, 0.05, ESC_HALF_BAND - 0.4]} />
          <meshBasicMaterial color={col} />
        </mesh>
      ))}
      {/* Ground landing pad at the foot */}
      <mesh position={[g.footX, 0.06, s.cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.2, ESC_HALF_BAND * 2 + 1]} />
        <meshLambertMaterial color={STATION_COLOR} />
      </mesh>
    </group>
  );
}

function Stations() {
  const geoms = useMemo(() => stationGeoms(), []);
  return (
    <group>
      {geoms.map((g) => (
        <Station key={g.station.id} g={g} />
      ))}
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

function Train() {
  // Wall-clock time so every client computes the same arc length, now via the
  // shared multi-station schedule (stops + dwell at EVERY station).
  const carRefs = useMemo(
    () => Array.from({ length: TRAIN.cars }, () => ({ s: 0 })),
    [],
  );
  useFrame(() => {
    const arcs = trainCarArcs(Date.now() / 1000);
    for (let i = 0; i < carRefs.length; i++) carRefs[i].s = arcs[i];
  });

  return (
    <group>
      {carRefs.map((r, i) => (
        <DynamicTrainCar key={i} arcRef={r} />
      ))}
    </group>
  );
}

// A train car whose arc length is read from a mutable ref every frame.
function DynamicTrainCar({ arcRef }: { arcRef: { s: number } }) {
  const ref = useRef<THREE.Group>(null);
  const total = useMemo(() => railLoopArcLengths().total, []);
  useFrame(() => {
    if (!ref.current) return;
    const sw = ((arcRef.s % total) + total) % total;
    const p = railLoopPointAt(sw);
    ref.current.position.set(p.x, RAIL_DECK_HEIGHT + 0.2 + TRAIN.carHeight / 2, p.z);
    ref.current.rotation.set(0, p.rotY, 0);
  });
  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[TRAIN.carWidth, TRAIN.carHeight, TRAIN.carLen]} />
        <meshLambertMaterial color={TRAIN_BODY} />
      </mesh>
      <mesh position={[ TRAIN.carWidth / 2 + 0.005, 0.3, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[TRAIN.carLen * 0.85, 0.9]} />
        <meshBasicMaterial color={TRAIN_WINDOW} />
      </mesh>
      <mesh position={[-TRAIN.carWidth / 2 - 0.005, 0.3, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[TRAIN.carLen * 0.85, 0.9]} />
        <meshBasicMaterial color={TRAIN_WINDOW} />
      </mesh>
      <mesh position={[0, 0.1, TRAIN.carLen / 2 + 0.005]}>
        <planeGeometry args={[1.4, 0.5]} />
        <meshBasicMaterial color="#fff5d0" />
      </mesh>
    </group>
  );
}

// =============================================================
// PUBLIC ENTRY
// =============================================================

export default function CentralRail() {
  return (
    <group>
      <RailDeck />
      <RailPillars />
      <Stations />
      <Skybridges />
      <Train />
    </group>
  );
}
