import * as THREE from "three";
import { useMemo, useRef, useEffect } from "react";
import {
  REGIONAL_ROADS,
  STATIC_OBSTACLES,
  FOREST_TREES,
  FOREST_ROCKS,
  MOUNTAIN_ROCKS,
  VILLAGE_LAMPS,
  VILLAGE_PARKING_PADS,
  REGIONAL_ROAD_LAMPS,
  VILLAGE_REAL_LIGHTS,
  JUNCTION_REAL_LIGHTS,
} from "../shared/cityData";
import type { RoadPath, StaticObstacle, RegionalLampData } from "../shared/types";

// =============================================================
// REGIONAL ROADS — chain of segment quads per polyline
// =============================================================
//
// REGIONAL_ROADS hold polylines, not pre-meshed strips. We render one
// flat plane per segment, oriented along the segment's tangent. The
// surface type controls colour; lane markings are intentionally omitted
// outside the central city to keep biomes visually distinct.

const ROAD_COLOR_BY_TYPE: Record<RoadPath["type"], string> = {
  asphalt:  "#1d1d22",
  bridge:   "#3a2e22",
  forest:   "#2a2218",
  mountain: "#3a342c",
  dirt:     "#52442e",
};

interface SegmentSpec {
  key: string;
  ax: number; az: number;
  bx: number; bz: number;
  width: number;
  color: string;
}

function RegionalRoadSegment({ ax, az, bx, bz, width, color }: Omit<SegmentSpec, "key">) {
  const cx = (ax + bx) / 2;
  const cz = (az + bz) / 2;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  // Local +Z aligned with segment; rotation around world +Y.
  const rotY = Math.atan2(dx, dz);
  return (
    <mesh position={[cx, 0.005, cz]} rotation={[-Math.PI / 2, 0, -rotY]} receiveShadow>
      <planeGeometry args={[width, len]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function RegionalRoads() {
  const segments = useMemo<SegmentSpec[]>(() => {
    const out: SegmentSpec[] = [];
    for (const r of REGIONAL_ROADS) {
      const color = ROAD_COLOR_BY_TYPE[r.type];
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i];
        const b = r.points[i + 1];
        out.push({
          key: `${r.id}-${i}`,
          ax: a[0], az: a[1],
          bx: b[0], bz: b[1],
          width: r.width,
          color,
        });
      }
    }
    return out;
  }, []);
  return (
    <group>
      {segments.map((s) => (
        <RegionalRoadSegment
          key={s.key}
          ax={s.ax} az={s.az} bx={s.bx} bz={s.bz}
          width={s.width} color={s.color}
        />
      ))}
    </group>
  );
}

// =============================================================
// BIOME GROUND TINTS — large planes giving each biome its own colour
// =============================================================

function BiomeGround() {
  // Each biome has a base tint plus a thin transition strip drawn at a
  // slightly higher Y, blending into the central city's tan ground.
  // Without these strips the four biome rectangles meet the city in a
  // hard rectangular seam; the strips paint over the seam with an
  // intermediate colour so the eye reads it as a softer transition.
  return (
    <group>
      {/* Mountain (north) */}
      <mesh position={[0, 0.001, -300]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 400]} />
        <meshLambertMaterial color="#3a3530" />
      </mesh>
      {/* Forest (south) */}
      <mesh position={[0, 0.001, 340]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 320]} />
        <meshLambertMaterial color="#2a3a26" />
      </mesh>
      {/* Bridge ravine — darker patch where the bridge crosses */}
      <mesh position={[0, -0.6, 140]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 80]} />
        <meshLambertMaterial color="#15161a" />
      </mesh>
      {/* East suburban / industrial */}
      <mesh position={[300, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshLambertMaterial color="#4a4438" />
      </mesh>
      {/* West fields */}
      <mesh position={[-300, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshLambertMaterial color="#5a5238" />
      </mesh>

      {/* Transition strips at biome→city seams (y=0.0015 sits just
          above the base biome tints to overpaint the rectangular edge). */}
      <mesh position={[0, 0.0015, -110]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 32]} />
        <meshLambertMaterial color="#473e34" />
      </mesh>
      <mesh position={[0, 0.0015, 195]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 38]} />
        <meshLambertMaterial color="#3a402c" />
      </mesh>
      <mesh position={[110, 0.0015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[32, 400]} />
        <meshLambertMaterial color="#473d35" />
      </mesh>
      <mesh position={[-110, 0.0015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[32, 400]} />
        <meshLambertMaterial color="#52472f" />
      </mesh>
    </group>
  );
}

// Bridge lane stripes — five short white quads down the middle of the
// (0,130)→(0,180) bridge segment, drawn just above the bridge surface.
function BridgeLaneStripes() {
  const positions = [137, 147, 157, 167, 177] as const;
  return (
    <group>
      {positions.map((z) => (
        <mesh
          key={z}
          position={[0, 0.012, z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[0.35, 4]} />
          <meshBasicMaterial color="#f0e8c8" />
        </mesh>
      ))}
    </group>
  );
}

// =============================================================
// STATIC OBSTACLES — landmark meshes per kind
// =============================================================

function ObstacleMesh({ o }: { o: StaticObstacle }) {
  switch (o.kind) {
    case "bridge_rail":
      return (
        <mesh position={[o.x, 1.2, o.z]} castShadow>
          <boxGeometry args={[o.w, 1.6, o.d]} />
          <meshLambertMaterial color="#8b8470" />
        </mesh>
      );
    case "cliff_wall":
      return (
        <mesh position={[o.x, 8, o.z]} castShadow receiveShadow>
          <boxGeometry args={[o.w, 16, o.d]} />
          <meshLambertMaterial color="#5a5044" />
        </mesh>
      );
    case "large_rock":
      return (
        <mesh position={[o.x, o.w / 2, o.z]} castShadow>
          <dodecahedronGeometry args={[Math.min(o.w, o.d) * 0.55, 0]} />
          <meshLambertMaterial color="#6c655a" flatShading />
        </mesh>
      );
    case "tree_trunk":
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 3, 0]} castShadow>
            <cylinderGeometry args={[o.w / 2, o.w / 2 + 0.2, 6, 6]} />
            <meshLambertMaterial color="#4a3424" />
          </mesh>
          <mesh position={[0, 7.5, 0]} castShadow>
            <coneGeometry args={[o.w * 1.6, 6, 8]} />
            <meshLambertMaterial color="#2c5a2a" />
          </mesh>
        </group>
      );
    case "warehouse":
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 5, 0]} castShadow receiveShadow>
            <boxGeometry args={[o.w, 10, o.d]} />
            <meshLambertMaterial color="#7a7064" />
          </mesh>
          <mesh position={[0, 10.3, 0]} castShadow>
            <boxGeometry args={[o.w + 0.4, 0.6, o.d + 0.4]} />
            <meshLambertMaterial color="#3a3530" />
          </mesh>
        </group>
      );
    case "water_tower_base":
      return (
        <group position={[o.x, 0, o.z]}>
          {([[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]] as const).map(([lx, lz], i) => (
            <mesh key={i} position={[lx, 6, lz]} castShadow>
              <cylinderGeometry args={[0.18, 0.22, 12, 6]} />
              <meshLambertMaterial color="#3a3a40" />
            </mesh>
          ))}
          <mesh position={[0, 13, 0]} castShadow>
            <cylinderGeometry args={[2.6, 2.6, 4.2, 16]} />
            <meshLambertMaterial color="#a8a098" />
          </mesh>
          <mesh position={[0, 15.5, 0]} castShadow>
            <coneGeometry args={[2.6, 1.5, 16]} />
            <meshLambertMaterial color="#7c7268" />
          </mesh>
        </group>
      );
    case "cabin":
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 1.7, 0]} castShadow receiveShadow>
            <boxGeometry args={[o.w, 3.4, o.d]} />
            <meshLambertMaterial color="#5a3a22" />
          </mesh>
          <mesh position={[0, 4.0, 0]} castShadow>
            <coneGeometry args={[Math.max(o.w, o.d) * 0.7, 2.2, 4]} />
            <meshLambertMaterial color="#2e2018" />
          </mesh>
          {/* Front door */}
          <mesh position={[0, 1.0, o.d / 2 + 0.025]}>
            <planeGeometry args={[1.0, 1.8]} />
            <meshBasicMaterial color="#1a1a1f" />
          </mesh>
        </group>
      );
    case "ranger_station":
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 2.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[o.w, 4.6, o.d]} />
            <meshLambertMaterial color="#3a4a32" />
          </mesh>
          <mesh position={[0, 5.0, 0]} castShadow>
            <boxGeometry args={[o.w + 0.6, 0.4, o.d + 0.6]} />
            <meshLambertMaterial color="#2a2018" />
          </mesh>
          {/* Ranger sign */}
          <mesh position={[0, 6.5, 0]}>
            <boxGeometry args={[2.4, 1.2, 0.1]} />
            <meshBasicMaterial color="#a02020" />
          </mesh>
        </group>
      );
    case "depot":
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 3, 0]} castShadow receiveShadow>
            <boxGeometry args={[o.w, 6, o.d]} />
            <meshLambertMaterial color="#665448" />
          </mesh>
          <mesh position={[0, 6.4, 0]} castShadow>
            <boxGeometry args={[o.w + 0.4, 0.8, o.d + 0.4]} />
            <meshLambertMaterial color="#3a3024" />
          </mesh>
        </group>
      );
    case "gas_stop":
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 1.8, 0]} castShadow receiveShadow>
            <boxGeometry args={[o.w, 3.6, o.d]} />
            <meshLambertMaterial color="#4a5a3a" />
          </mesh>
          <mesh position={[0, 4.0, 0]}>
            <boxGeometry args={[o.w + 1, 0.4, o.d + 1]} />
            <meshLambertMaterial color="#2a3022" />
          </mesh>
          {/* Sign */}
          <mesh position={[0, 5.4, 0]}>
            <boxGeometry args={[3.5, 1.0, 0.2]} />
            <meshBasicMaterial color="#f0c040" />
          </mesh>
        </group>
      );
    case "observatory":
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[Math.min(o.w, o.d) * 0.45, Math.min(o.w, o.d) * 0.55, 8, 16]} />
            <meshLambertMaterial color="#6a6c70" />
          </mesh>
          <mesh position={[0, 9.0, 0]} castShadow>
            <sphereGeometry args={[Math.min(o.w, o.d) * 0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshLambertMaterial color="#cdd0d4" />
          </mesh>
        </group>
      );
    case "guardrail":
      return (
        <mesh position={[o.x, 0.7, o.z]} castShadow>
          <boxGeometry args={[o.w, 1.4, o.d]} />
          <meshLambertMaterial color="#a8a8a0" />
        </mesh>
      );
  }
}

function StaticObstacles() {
  return (
    <group>
      {STATIC_OBSTACLES.map((o, i) => (
        <ObstacleMesh key={i} o={o} />
      ))}
    </group>
  );
}

// =============================================================
// INSTANCED FLORA — trees + rocks
// =============================================================
//
// One InstancedMesh per "part" (trunk, canopy, rock) keeps draw calls
// at a handful even for hundreds of trees. Per-instance transform is
// composed into a Matrix4 once on mount; the data never changes.

function ForestTrees() {
  const trunkRef = useRef<THREE.InstancedMesh>(null!);
  const canopyRef = useRef<THREE.InstancedMesh>(null!);
  const count = FOREST_TREES.length;

  useEffect(() => {
    if (!trunkRef.current || !canopyRef.current) return;
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const t = FOREST_TREES[i];
      e.set(0, t.rotY, 0);
      q.setFromEuler(e);
      s.set(t.scale, t.scale, t.scale);
      // Trunk geometry is height 4 centred on its own origin; lift by
      // 2 * scale so its base sits on y=0.
      p.set(t.x, 2 * t.scale, t.z);
      m.compose(p, q, s);
      trunkRef.current.setMatrixAt(i, m);
      // Canopy cone (height 5) sits on top of the trunk: trunk top is
      // y = 4*scale, cone centre is + 2.5*scale above that.
      p.set(t.x, (4 + 2.5) * t.scale, t.z);
      m.compose(p, q, s);
      canopyRef.current.setMatrixAt(i, m);
    }
    trunkRef.current.instanceMatrix.needsUpdate = true;
    canopyRef.current.instanceMatrix.needsUpdate = true;
    // Recompute bounds so frustum/shadow culling is correct in a
    // 1000x1000 world (default bounds assume origin-centred unit mesh).
    trunkRef.current.computeBoundingSphere();
    trunkRef.current.computeBoundingBox();
    canopyRef.current.computeBoundingSphere();
    canopyRef.current.computeBoundingBox();
  }, [count]);

  if (count === 0) return null;
  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, count]} castShadow>
        <cylinderGeometry args={[0.35, 0.45, 4, 6]} />
        <meshLambertMaterial color="#4a3424" />
      </instancedMesh>
      <instancedMesh ref={canopyRef} args={[undefined, undefined, count]} castShadow>
        <coneGeometry args={[1.6, 5, 8]} />
        <meshLambertMaterial color="#2c5a2a" />
      </instancedMesh>
    </group>
  );
}

function ForestRocks() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const count = FOREST_ROCKS.length;
  useEffect(() => {
    if (!ref.current) return;
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const r = FOREST_ROCKS[i];
      e.set(0, r.rotY, 0);
      q.setFromEuler(e);
      s.set(r.scale, r.scale * 0.7, r.scale);
      p.set(r.x, r.scale * 0.4, r.z);
      m.compose(p, q, s);
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
    ref.current.computeBoundingBox();
  }, [count]);
  if (count === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow>
      <dodecahedronGeometry args={[0.9, 0]} />
      <meshLambertMaterial color="#6c655a" flatShading />
    </instancedMesh>
  );
}

function MountainRocks() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const count = MOUNTAIN_ROCKS.length;
  useEffect(() => {
    if (!ref.current) return;
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const r = MOUNTAIN_ROCKS[i];
      e.set(0, r.rotY, 0);
      q.setFromEuler(e);
      s.set(r.scale, r.scale * 1.2, r.scale);
      p.set(r.x, r.scale * 0.6, r.z);
      m.compose(p, q, s);
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
    ref.current.computeBoundingBox();
  }, [count]);
  if (count === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow>
      <dodecahedronGeometry args={[1.1, 0]} />
      <meshLambertMaterial color="#5a5248" flatShading />
    </instancedMesh>
  );
}

// =============================================================
// VILLAGE PARKING PADS — flat dirt rectangles under each village pad.
// Like ParkingMarkings in CityMap, but darker and oriented per pad.
// =============================================================

const PAD_COLOR = "#3f3322";

function VillageParkingPads() {
  return (
    <group>
      {VILLAGE_PARKING_PADS.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, 0.025, p.z]}
          rotation={[-Math.PI / 2, 0, p.rotY]}
        >
          <planeGeometry args={[3.0, 6.0]} />
          <meshLambertMaterial color={PAD_COLOR} />
        </mesh>
      ))}
    </group>
  );
}

// =============================================================
// FOREST / VILLAGE LAMPS — wooden poles + emissive head + ground pool.
// Cheaper than the city streetlamps (no shadow casting); 3 real point
// lights are added at the busiest village corners only.
// =============================================================

const FOREST_LAMP_HEAD = "#ffd58a";
const FOREST_LAMP_POOL = "#f0c074";
const FOREST_LAMP_POLE = "#3a2b1c";

function ForestLamps() {
  return (
    <group>
      {VILLAGE_LAMPS.map((lamp, i) => (
        <group key={i} position={[lamp.x, 0, lamp.z]}>
          {/* Wooden pole */}
          <mesh position={[0, 2.4, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.11, 4.8, 6]} />
            <meshLambertMaterial color={FOREST_LAMP_POLE} />
          </mesh>
          {/* Emissive lantern head */}
          <mesh position={[0, 5.0, 0]}>
            <boxGeometry args={[0.55, 0.5, 0.55]} />
            <meshBasicMaterial color={FOREST_LAMP_HEAD} />
          </mesh>
          {/* Fake light pool on the ground */}
          <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[4, 14]} />
            <meshBasicMaterial color={FOREST_LAMP_POOL} transparent opacity={0.16} />
          </mesh>
        </group>
      ))}
      {/* Real point lights for the village centre live in
          JunctionRealLights so the entire scene's pointLight set is
          declared in exactly one place. */}
    </group>
  );
}

// =============================================================
// REGIONAL ROAD LAMPS — instanced fake lighting along every road
// =============================================================
//
// REGIONAL_ROAD_LAMPS is a procedurally generated list of pole positions
// along the shoulder of every regional road, one entry per pole. We
// bucket the list by style and render three instanced meshes per style
// (pole / emissive head / transparent ground pool). With ~200-300 lamps
// total and 4 styles, that's ~12 InstancedMesh objects but only ~75
// draw calls' worth of geometry — far cheaper than 600+ individual
// meshes, and it deliberately uses zero real lights.

type LampStyle = RegionalLampData["style"];
interface LampStyleDef {
  poleColor: string;
  poleHeight: number;
  poleRadius: number;
  poleTopY: number;
  headColor: string;
  headSize: [number, number, number];
  headY: number;
  poolColor: string;
  poolRadius: number;
  poolOpacity: number;
}

const LAMP_STYLE_DEFS: Record<LampStyle, LampStyleDef> = {
  urban: {
    poleColor: "#444448", poleHeight: 6.0, poleRadius: 0.10, poleTopY: 3.0,
    headColor: "#fff2c0", headSize: [0.7, 0.3, 0.7], headY: 5.95,
    poolColor: "#ffe49a", poolRadius: 5.5, poolOpacity: 0.16,
  },
  bridge: {
    poleColor: "#3a3a3e", poleHeight: 6.4, poleRadius: 0.11, poleTopY: 3.2,
    headColor: "#fff0b0", headSize: [0.8, 0.35, 0.8], headY: 6.35,
    poolColor: "#ffe0a0", poolRadius: 6.5, poolOpacity: 0.20,
  },
  rural: {
    poleColor: "#3a2b1c", poleHeight: 4.6, poleRadius: 0.10, poleTopY: 2.3,
    headColor: "#ffc880", headSize: [0.55, 0.5, 0.55], headY: 4.7,
    poolColor: "#f0a060", poolRadius: 4.5, poolOpacity: 0.14,
  },
  mountain: {
    poleColor: "#2c2c30", poleHeight: 3.0, poleRadius: 0.09, poleTopY: 1.5,
    headColor: "#ffb070", headSize: [0.5, 0.3, 0.5], headY: 3.05,
    poolColor: "#e09060", poolRadius: 3.5, poolOpacity: 0.16,
  },
};

interface InstancedLampLayerProps {
  lamps: RegionalLampData[];
  style: LampStyleDef;
}

function PoleLayer({ lamps, style }: InstancedLampLayerProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rotY);
      m.compose(new THREE.Vector3(l.x, style.poleTopY, l.z), q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [lamps, style]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, lamps.length]} castShadow>
      <cylinderGeometry args={[style.poleRadius * 0.85, style.poleRadius, style.poleHeight, 6]} />
      <meshLambertMaterial color={style.poleColor} />
    </instancedMesh>
  );
}

function HeadLayer({ lamps, style }: InstancedLampLayerProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rotY);
      m.compose(new THREE.Vector3(l.x, style.headY, l.z), q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [lamps, style]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, lamps.length]}>
      <boxGeometry args={style.headSize} />
      <meshBasicMaterial color={style.headColor} />
    </instancedMesh>
  );
}

function PoolLayer({ lamps, style }: InstancedLampLayerProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    // Lay the disc flat on the ground (rotate around X by -PI/2).
    const flat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0)
    );
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      q.copy(flat);
      m.compose(new THREE.Vector3(l.x, 0.04, l.z), q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [lamps, style]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, lamps.length]}>
      <circleGeometry args={[style.poolRadius, 14]} />
      <meshBasicMaterial color={style.poolColor} transparent opacity={style.poolOpacity} />
    </instancedMesh>
  );
}

function RegionalRoadLamps() {
  const buckets = useMemo(() => {
    const grouped: Record<LampStyle, RegionalLampData[]> = {
      urban: [], bridge: [], rural: [], mountain: [],
    };
    for (const lamp of REGIONAL_ROAD_LAMPS) grouped[lamp.style].push(lamp);
    return grouped;
  }, []);
  const styles = Object.keys(buckets) as LampStyle[];
  return (
    <group>
      {styles.map((style) => {
        const lamps = buckets[style];
        if (lamps.length === 0) return null;
        const def = LAMP_STYLE_DEFS[style];
        return (
          <group key={style}>
            <PoleLayer lamps={lamps} style={def} />
            <HeadLayer lamps={lamps} style={def} />
            <PoolLayer lamps={lamps} style={def} />
          </group>
        );
      })}
    </group>
  );
}

// =============================================================
// JUNCTION REAL LIGHTS — a fixed list of warm point lights at the
// busiest road junctions. No shadows; modest distance + decay=2 keeps
// the per-frame cost flat.
// =============================================================

function JunctionRealLights() {
  return (
    <group>
      {JUNCTION_REAL_LIGHTS.map(([x, y, z], i) => (
        <pointLight
          key={`j-${i}`}
          position={[x, y, z]}
          color="#ffd0a0"
          intensity={3.5}
          distance={38}
          decay={2}
        />
      ))}
      {VILLAGE_REAL_LIGHTS.map(([x, y, z], i) => (
        <pointLight
          key={`v-${i}`}
          position={[x, y, z]}
          color="#ffcb88"
          intensity={4.0}
          distance={32}
          decay={2}
        />
      ))}
    </group>
  );
}

// =============================================================
// ROOT
// =============================================================

export default function BiomeRender() {
  return (
    <group>
      <BiomeGround />
      <RegionalRoads />
      <BridgeLaneStripes />
      <VillageParkingPads />
      <StaticObstacles />
      <ForestTrees />
      <ForestRocks />
      <MountainRocks />
      <ForestLamps />
      <RegionalRoadLamps />
      <JunctionRealLights />
    </group>
  );
}
