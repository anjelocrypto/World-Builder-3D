import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { dayNightRuntime } from "../shared/timeOfDay";
import {
  BUILDINGS,
  ROADS,
  STREET_LIGHTS,
  TRAFFIC_LIGHTS,
  PARKING_SPOTS,
  PROPS,
} from "../shared/cityData";
import type { Building, PropData } from "../shared/types";
import CentralRail from "./CentralRail";

// =============================================================
// GROUND (sky + fog now live in DayNightController)
// =============================================================

function Ground() {
  // Base ground covers the full 1000-unit playable area plus a small
  // overhang. Biome render layers a per-region tint plane on top.
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[1100, 1100]} />
      {/* MeshStandard gives the city ground a subtle roughness under ACES
          lighting, so it reads as compacted earth/tarmac rather than a
          flat painted plane. */}
      <meshStandardMaterial color="#252830" roughness={0.92} metalness={0.02} />
    </mesh>
  );
}

// =============================================================
// ROADS — carriageway, sidewalks (raised curbs), lane markings, crosswalks
// =============================================================

const ROAD_COLOR = "#18181e";       // slightly darker asphalt
const LANE_COLOR = "#e8b830";       // aged yellow lane markings
const SIDEWALK_COLOR = "#42424a";   // darker concrete
const CURB_COLOR = "#626268";
const CROSSWALK_COLOR = "#d8d8dc";

function Roads() {
  return (
    <group>
      {/* N-S roads */}
      {ROADS.ns.map((x) => (
        <group key={`ns-${x}`}>
          {/* Carriageway */}
          <mesh position={[x, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[20, 200]} />
            <meshLambertMaterial color={ROAD_COLOR} />
          </mesh>
          {/* Centre dashes */}
          {Array.from({ length: 20 }, (_, i) => (
            <mesh
              key={i}
              position={[x, 0.02, -95 + i * 10]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[0.3, 4]} />
              <meshBasicMaterial color={LANE_COLOR} />
            </mesh>
          ))}
          {/* Lane edge lines (white) at ±9 from centerline */}
          <mesh position={[x - 9, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.2, 200]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[x + 9, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.2, 200]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          {/* Sidewalks (raised slabs) on both sides of the carriageway */}
          <mesh position={[x - 11, 0.075, 0]} receiveShadow>
            <boxGeometry args={[2, 0.15, 200]} />
            <meshLambertMaterial color={SIDEWALK_COLOR} />
          </mesh>
          <mesh position={[x + 11, 0.075, 0]} receiveShadow>
            <boxGeometry args={[2, 0.15, 200]} />
            <meshLambertMaterial color={SIDEWALK_COLOR} />
          </mesh>
          {/* Curb edges (slightly lighter strip) */}
          <mesh position={[x - 10.05, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.2, 200]} />
            <meshBasicMaterial color={CURB_COLOR} />
          </mesh>
          <mesh position={[x + 10.05, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.2, 200]} />
            <meshBasicMaterial color={CURB_COLOR} />
          </mesh>
        </group>
      ))}
      {/* E-W roads */}
      {ROADS.ew.map((z) => (
        <group key={`ew-${z}`}>
          <mesh position={[0, 0.01, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[200, 20]} />
            <meshLambertMaterial color={ROAD_COLOR} />
          </mesh>
          {Array.from({ length: 20 }, (_, i) => (
            <mesh
              key={i}
              position={[-95 + i * 10, 0.02, z]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[4, 0.3]} />
              <meshBasicMaterial color={LANE_COLOR} />
            </mesh>
          ))}
          <mesh position={[0, 0.02, z - 9]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[200, 0.2]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, 0.02, z + 9]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[200, 0.2]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, 0.075, z - 11]} receiveShadow>
            <boxGeometry args={[200, 0.15, 2]} />
            <meshLambertMaterial color={SIDEWALK_COLOR} />
          </mesh>
          <mesh position={[0, 0.075, z + 11]} receiveShadow>
            <boxGeometry args={[200, 0.15, 2]} />
            <meshLambertMaterial color={SIDEWALK_COLOR} />
          </mesh>
          <mesh position={[0, 0.16, z - 10.05]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[200, 0.2]} />
            <meshBasicMaterial color={CURB_COLOR} />
          </mesh>
          <mesh position={[0, 0.16, z + 10.05]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[200, 0.2]} />
            <meshBasicMaterial color={CURB_COLOR} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Crosswalks() {
  // Painted crosswalks on each road approach to every intersection.
  // Each crosswalk is a row of 5 white stripes.
  const stripes: Array<{ x: number; z: number; rot: number }> = [];
  for (const ix of ROADS.ns) {
    for (const iz of ROADS.ew) {
      // North / south approaches (cross the N-S road)
      for (const offset of [-13, 13]) {
        for (let s = -8; s <= 8; s += 2) {
          stripes.push({ x: ix + s, z: iz + offset, rot: 0 });
        }
      }
      // East / west approaches (cross the E-W road)
      for (const offset of [-13, 13]) {
        for (let s = -8; s <= 8; s += 2) {
          stripes.push({ x: ix + offset, z: iz + s, rot: Math.PI / 2 });
        }
      }
    }
  }
  return (
    <group>
      {stripes.map((s, i) => (
        <mesh
          key={i}
          position={[s.x, 0.025, s.z]}
          rotation={[-Math.PI / 2, 0, s.rot]}
        >
          <planeGeometry args={[1.2, 0.5]} />
          <meshBasicMaterial color={CROSSWALK_COLOR} />
        </mesh>
      ))}
    </group>
  );
}

// =============================================================
// BUILDINGS — multi-side window strips, antennas, rooftop boxes, doors
// =============================================================

interface BuildingMeshProps {
  b: Building;
}

// Crown / podium / neon helpers extend the original mesh for the new
// `highrise` and `landmark` tiers. Plain mid-rises render unchanged.
function BuildingExtras({ b }: { b: Building }) {
  if (!b.tier || b.tier === "mid") return null;
  return (
    <group>
      {/* Podium — wider 2-floor base wrapping the tower. Darker material
          so the base reads as heavy stone/concrete, contrasting the
          glass curtain wall above. */}
      {b.podium && (
        <mesh position={[0, 3, 0]} castShadow receiveShadow>
          <boxGeometry args={[b.w + 1.6, 6, b.d + 1.6]} />
          <meshStandardMaterial color="#20242e" roughness={0.75} metalness={0.1} />
        </mesh>
      )}
      {/* Crown light — emissive band near the roof apex.
          Landmarks get a cool blue beacon, highrises warm amber. */}
      {b.crownLight && (
        <mesh position={[0, b.h - 0.3, 0]}>
          <boxGeometry args={[b.w + 0.4, 0.6, b.d + 0.4]} />
          <meshBasicMaterial
            color={b.tier === "landmark" ? "#60c8ff" : "#ffc040"}
            transparent
            opacity={0.92}
            toneMapped={false}
          />
        </mesh>
      )}
      {/* Neon vertical sign on the +Z face */}
      {b.neonSign && (
        <mesh position={[0, b.h * 0.6, b.d / 2 + 0.06]}>
          <planeGeometry args={[1.2, b.h * 0.5]} />
          <meshBasicMaterial color="#ff5a8a" />
        </mesh>
      )}
    </group>
  );
}

function BuildingMesh({ b }: BuildingMeshProps) {
  // Body, door, rooftop box, antenna, podium/crown extras. The window
  // strips that USED to live here (4 planes per floor × all 65
  // buildings ≈ 520 individual meshes) now live in the shared
  // <BuildingWindowsInstanced/> below, which collapses them into a
  // small fixed set of InstancedMesh draw calls.
  //
  // Material selection: highrise/landmark get MeshStandard so they pick
  // up reflections and roughness variation (glass-clad towers). Downtown
  // gets a rougher standard material. Residential/commercial stay Lambert
  // for performance (they're numerous and their brick/stucco finish
  // doesn't need specularity).
  const isHighrise = b.district === "highrise" || b.district === "landmark";
  const isDowntown = b.district === "downtown";

  return (
    <group position={[b.x, 0, b.z]}>
      {/* Body */}
      <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[b.w, b.h, b.d]} />
        {isHighrise ? (
          // Glass-clad towers: low roughness, high metalness → reflective
          // tinted panels. `glass` flag from cityData controls how
          // mirror-like each tower is.
          <meshStandardMaterial
            color={b.color}
            roughness={b.glass ? 0.12 : 0.38}
            metalness={b.glass ? 0.82 : 0.45}
          />
        ) : isDowntown ? (
          // Mid-rise commercial: concrete + stone, slightly specular.
          <meshStandardMaterial color={b.color} roughness={0.60} metalness={0.15} />
        ) : (
          // Residential / commercial: brick/stucco, flat Lambert is fine.
          <meshLambertMaterial color={b.color} />
        )}
      </mesh>

      {/* Door (front +Z face) */}
      <mesh position={[0, 1.0, b.d / 2 + 0.025]}>
        <planeGeometry args={[1.4, 2.0]} />
        <meshBasicMaterial color="#1a1a1f" />
      </mesh>

      {/* Rooftop box (HVAC/penthouse) */}
      {b.hasRooftopBox && (
        <mesh position={[0, b.h + 0.5, 0]} castShadow>
          <boxGeometry args={[b.w * 0.45, 1.0, b.d * 0.45]} />
          <meshLambertMaterial color="#3a3a40" />
        </mesh>
      )}

      {/* Antenna */}
      {b.hasAntenna && (
        <group position={[b.w * 0.25, b.h + 1.0, 0]}>
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 3, 6]} />
            <meshLambertMaterial color="#aaa" />
          </mesh>
          {/* Red blinking-style emissive tip */}
          <mesh position={[0, 3.0, 0]}>
            <sphereGeometry args={[0.15, 6, 6]} />
            <meshBasicMaterial color="#ff5050" />
          </mesh>
        </group>
      )}

      {/* Highrise / landmark extras (podium, crown light, neon sign). */}
      <BuildingExtras b={b} />
    </group>
  );
}

// Bucket every building's window strips by (color, lit/dim) so we can
// emit one InstancedMesh per bucket. With ~65 buildings × ~5 floors ×
// 4 faces ≈ 1300 strips, this turns ~520 individual meshes into 6
// instanced draw calls. Each instance is a unit-plane scaled to the
// face width via its matrix.
function BuildingWindowsInstanced() {
  const buckets = useMemo(() => {
    interface Bucket {
      color: string;
      opacity: number;
      matrices: THREE.Matrix4[];
    }
    const map = new Map<string, Bucket>();
    const tmpQ = new THREE.Quaternion();
    const tmpE = new THREE.Euler();
    const tmpP = new THREE.Vector3();
    const tmpS = new THREE.Vector3();
    for (const b of BUILDINGS) {
      const floors = Math.max(1, Math.floor(b.h / 3.5));
      const floorSpacing = b.h / (floors + 1);
      const windowColor =
        b.district === "residential" ? "#ffd99a" :
        b.district === "downtown"    ? "#cfe6ff" :
                                       "#ffe9b0";
      let s = b.windowSeed | 0;
      for (let f = 0; f < floors; f++) {
        s = Math.imul(s, 1664525) + 1013904223;
        const lit = ((s >>> 0) / 0x100000000) > 0.25 ? 1 : 0.25;
        const opacity = 0.85 * lit;
        const key = `${windowColor}|${lit === 1 ? "lit" : "dim"}`;
        let bucket = map.get(key);
        if (!bucket) {
          bucket = { color: windowColor, opacity, matrices: [] };
          map.set(key, bucket);
        }
        const y = (f + 1) * floorSpacing;
        // +Z face
        tmpE.set(0, 0, 0);
        tmpQ.setFromEuler(tmpE);
        tmpS.set(b.w * 0.7, 1.0, 1);
        tmpP.set(b.x, y, b.z + b.d / 2 + 0.02);
        bucket.matrices.push(new THREE.Matrix4().compose(tmpP, tmpQ, tmpS));
        // -Z face
        tmpE.set(0, Math.PI, 0);
        tmpQ.setFromEuler(tmpE);
        tmpP.set(b.x, y, b.z - b.d / 2 - 0.02);
        bucket.matrices.push(new THREE.Matrix4().compose(tmpP, tmpQ, tmpS));
        // +X face
        tmpE.set(0, Math.PI / 2, 0);
        tmpQ.setFromEuler(tmpE);
        tmpS.set(b.d * 0.7, 1.0, 1);
        tmpP.set(b.x + b.w / 2 + 0.02, y, b.z);
        bucket.matrices.push(new THREE.Matrix4().compose(tmpP, tmpQ, tmpS));
        // -X face
        tmpE.set(0, -Math.PI / 2, 0);
        tmpQ.setFromEuler(tmpE);
        tmpP.set(b.x - b.w / 2 - 0.02, y, b.z);
        bucket.matrices.push(new THREE.Matrix4().compose(tmpP, tmpQ, tmpS));
      }
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, []);

  return (
    <group>
      {buckets.map((b) => (
        <WindowBucket
          key={b.key}
          color={b.color}
          opacity={b.opacity}
          matrices={b.matrices}
        />
      ))}
    </group>
  );
}

function WindowBucket({
  color, opacity, matrices,
}: { color: string; opacity: number; matrices: THREE.Matrix4[] }) {
  const ref    = useRef<THREE.InstancedMesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const baseOpacity = opacity;

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  // Night-reactive windows: nearly invisible in bright daylight (stops
  // windows from reading as neon-bright rectangles at noon), warm and
  // glowing at night. The per-building seed variation (lit vs dim) is
  // preserved because the base opacity already encodes it.
  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    const n = dayNightRuntime.nightFactor;
    // Minimum 12% of base during full daylight → full base at night.
    mat.opacity = baseOpacity * (0.12 + 0.88 * n);
  });

  if (matrices.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b, i) => (
        <BuildingMesh key={i} b={b} />
      ))}
      <BuildingWindowsInstanced />
    </group>
  );
}

// =============================================================
// STREET LAMPS — emissive head + transparent ground "light pool"
// =============================================================

const LAMP_HEAD_COLOR = "#fff2c0";
const LAMP_POOL_COLOR = "#ffcc70";

function StreetLamps() {
  // Was: 90 lamps × 4 child meshes = 360 individual meshes. Now: 4
  // InstancedMesh objects (pole / arm / head / pool) regardless of
  // count — and the pole no longer casts shadows since the lamps are
  // thin and far from gameplay focus.
  const count = STREET_LIGHTS.length;
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const armRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);
  const headMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const poolMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const baseHeadColor = useMemo(() => new THREE.Color(LAMP_HEAD_COLOR), []);
  // Stronger pool at night (0.38) — additive blending means it won't
  // over-expose; depthWrite=false prevents z-sorting artefacts on the road.
  const STREET_POOL_BASE_OPACITY = 0.38;
  useFrame(() => {
    const n = dayNightRuntime.nightFactor;
    if (poolMatRef.current) poolMatRef.current.opacity = STREET_POOL_BASE_OPACITY * n;
    if (headMatRef.current) {
      // Head dims to ~35% of full brightness during the day so it doesn't
      // read as a bright white square in sunlight.
      headMatRef.current.color.copy(baseHeadColor).multiplyScalar(0.35 + 0.65 * n);
    }
  });
  useEffect(() => {
    const m = new THREE.Matrix4();
    const idQ = new THREE.Quaternion();
    const flatQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const lamp = STREET_LIGHTS[i];
      m.compose(new THREE.Vector3(lamp.x, 3, lamp.z), idQ, s);
      poleRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(lamp.x, 6, lamp.z), idQ, s);
      armRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(lamp.x, 5.95, lamp.z), idQ, s);
      headRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(lamp.x, 0.04, lamp.z), flatQ, s);
      poolRef.current?.setMatrixAt(i, m);
    }
    for (const r of [poleRef, armRef, headRef, poolRef]) {
      if (r.current) {
        r.current.instanceMatrix.needsUpdate = true;
        r.current.computeBoundingSphere();
      }
    }
  }, [count]);
  if (count === 0) return null;
  return (
    <group>
      <instancedMesh ref={poleRef} args={[undefined, undefined, count]}>
        <cylinderGeometry args={[0.08, 0.1, 6, 6]} />
        <meshLambertMaterial color="#444448" />
      </instancedMesh>
      <instancedMesh ref={armRef} args={[undefined, undefined, count]}>
        <boxGeometry args={[0.12, 0.12, 0.6]} />
        <meshLambertMaterial color="#444448" />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, count]}>
        <boxGeometry args={[0.7, 0.3, 0.7]} />
        <meshBasicMaterial ref={headMatRef} color={LAMP_HEAD_COLOR} />
      </instancedMesh>
      <instancedMesh ref={poolRef} args={[undefined, undefined, count]}>
        <circleGeometry args={[5.5, 20]} />
        {/* Additive blending makes the pool look like real emitted light on
            the dark asphalt. depthWrite=false prevents z-sort artefacts. */}
        <meshBasicMaterial
          ref={poolMatRef}
          color={LAMP_POOL_COLOR}
          transparent
          opacity={STREET_POOL_BASE_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}

// =============================================================
// TRAFFIC LIGHTS — at every intersection corner
// =============================================================

function TrafficLights() {
  // Was: ~36 traffic lights × 6 child meshes = ~216 individual meshes.
  // Now: 6 InstancedMesh objects, with each instance carrying its
  // own rotY via the matrix (positions of the arm / box / bulbs are
  // all expressed in the local frame, then transformed by the matrix
  // built from tl.x/tl.z + tl.rotY).
  const count = TRAFFIC_LIGHTS.length;
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const armRef = useRef<THREE.InstancedMesh>(null);
  const boxRef = useRef<THREE.InstancedMesh>(null);
  const redRef = useRef<THREE.InstancedMesh>(null);
  const yellowRef = useRef<THREE.InstancedMesh>(null);
  const greenRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const root = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    const writeAll = (
      ref: React.MutableRefObject<THREE.InstancedMesh | null>,
      lx: number, ly: number, lz: number,
      i: number,
    ) => {
      local.makeTranslation(lx, ly, lz);
      m.multiplyMatrices(root, local);
      ref.current?.setMatrixAt(i, m);
    };
    for (let i = 0; i < count; i++) {
      const tl = TRAFFIC_LIGHTS[i];
      e.set(0, tl.rotY, 0);
      q.setFromEuler(e);
      root.compose(new THREE.Vector3(tl.x, 0, tl.z), q, s);
      writeAll(poleRef, 0, 2.5, 0, i);
      writeAll(armRef, 0, 4.8, 0.4, i);
      writeAll(boxRef, 0, 4.4, 0.85, i);
      writeAll(redRef, 0, 4.4 + 0.4, 0.85 + 0.16, i);
      writeAll(yellowRef, 0, 4.4, 0.85 + 0.16, i);
      writeAll(greenRef, 0, 4.4 - 0.4, 0.85 + 0.16, i);
    }
    for (const r of [poleRef, armRef, boxRef, redRef, yellowRef, greenRef]) {
      if (r.current) {
        r.current.instanceMatrix.needsUpdate = true;
        r.current.computeBoundingSphere();
      }
    }
  }, [count]);
  if (count === 0) return null;
  return (
    <group>
      <instancedMesh ref={poleRef} args={[undefined, undefined, count]}>
        <cylinderGeometry args={[0.08, 0.1, 5, 6]} />
        <meshLambertMaterial color="#2c2c30" />
      </instancedMesh>
      <instancedMesh ref={armRef} args={[undefined, undefined, count]}>
        <boxGeometry args={[0.1, 0.1, 0.8]} />
        <meshLambertMaterial color="#2c2c30" />
      </instancedMesh>
      <instancedMesh ref={boxRef} args={[undefined, undefined, count]}>
        <boxGeometry args={[0.5, 1.2, 0.3]} />
        <meshLambertMaterial color="#1a1a1f" />
      </instancedMesh>
      <instancedMesh ref={redRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshBasicMaterial color="#e74c3c" />
      </instancedMesh>
      <instancedMesh ref={yellowRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshBasicMaterial color="#5a5028" />
      </instancedMesh>
      <instancedMesh ref={greenRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshBasicMaterial color="#2a4a32" />
      </instancedMesh>
    </group>
  );
}

// =============================================================
// PARKING SPOT MARKINGS — white painted rectangles under each parked car
// =============================================================

function ParkingMarkings() {
  return (
    <group>
      {PARKING_SPOTS.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, 0.03, p.z]}
          rotation={[-Math.PI / 2, 0, p.rotY]}
        >
          <planeGeometry args={[2.6, 5.2]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.18} />
        </mesh>
      ))}
    </group>
  );
}

// =============================================================
// PROPS — benches, planters, trashcans, hydrants
// =============================================================

function Prop({ p }: { p: PropData }) {
  // Sidewalk props are small and clutter the shadow caster set
  // (~hundred extra entries). Their shadow contribution at the
  // distance/angle the sun lands is barely visible, so castShadow is
  // dropped across the board here.
  switch (p.type) {
    case "bench":
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[1.6, 0.1, 0.45]} />
            <meshLambertMaterial color="#6b4a2a" />
          </mesh>
          <mesh position={[0, 0.7, -0.18]}>
            <boxGeometry args={[1.6, 0.4, 0.08]} />
            <meshLambertMaterial color="#6b4a2a" />
          </mesh>
          <mesh position={[-0.7, 0.2, 0]}>
            <boxGeometry args={[0.1, 0.4, 0.45]} />
            <meshLambertMaterial color="#3a3a3a" />
          </mesh>
          <mesh position={[0.7, 0.2, 0]}>
            <boxGeometry args={[0.1, 0.4, 0.45]} />
            <meshLambertMaterial color="#3a3a3a" />
          </mesh>
        </group>
      );
    case "planter":
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh position={[0, 0.4, 0]}>
            <boxGeometry args={[1.0, 0.8, 1.0]} />
            <meshLambertMaterial color="#5a4a3a" />
          </mesh>
          <mesh position={[0, 1.1, 0]}>
            <sphereGeometry args={[0.55, 10, 10]} />
            <meshLambertMaterial color="#3a6c4a" />
          </mesh>
        </group>
      );
    case "trashcan":
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh position={[0, 0.45, 0]}>
            <cylinderGeometry args={[0.3, 0.28, 0.9, 10]} />
            <meshLambertMaterial color="#2a2a2a" />
          </mesh>
          <mesh position={[0, 0.95, 0]}>
            <cylinderGeometry args={[0.32, 0.32, 0.06, 10]} />
            <meshLambertMaterial color="#1a1a1a" />
          </mesh>
        </group>
      );
    case "hydrant":
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.18, 0.22, 0.7, 8]} />
            <meshLambertMaterial color="#c0392b" />
          </mesh>
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.22, 8, 8]} />
            <meshLambertMaterial color="#c0392b" />
          </mesh>
        </group>
      );
  }
}

function Props() {
  return (
    <group>
      {PROPS.map((p, i) => (
        <Prop key={i} p={p} />
      ))}
    </group>
  );
}

// =============================================================
// =============================================================
// MAIN CITY MAP
// =============================================================
//
// Lighting note: the scene's main lights (hemisphere, sun, ambient) live
// in GameScene.tsx so they apply to players/vehicles too. We only place
// 4 real point lights here, at the inner intersections, to give an extra
// warm glow at the busiest corners. Every other lamp is an emissive
// material + a transparent ground "light pool" disc — fake but cheap.

export default function CityMap() {
  return (
    <group>
      <Ground />
      <Roads />
      <Crosswalks />
      <ParkingMarkings />
      <Buildings />
      <StreetLamps />
      <TrafficLights />
      <Props />
      <CentralRail />

      {/* Plaza point lights have moved into BiomeRender's
          DynamicPointLights, where they're nearest-N filtered with
          junction / village / mountain lights so the scene stays
          inside the audit's ≤8 active pointLight budget.

          Sky + fog moved to DayNightController so they shift hue
          with the time of day (and the controller is the single
          owner of scene.background and scene.fog). */}
    </group>
  );
}
