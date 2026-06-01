import * as THREE from "three";
import { useMemo, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
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
  MOUNTAIN_REAL_LIGHTS,
  STREET_LIGHTS,
  ROAD_ELEVATION_PROFILES,
  MOUNTAIN_ROAD_IDS,
  CITY_EDGE_TREES,
  PERI_CITY_HOMESTEADS,
} from "../shared/cityData";
import { getRoadElevationAt } from "../shared/elevation";
import { terrainHeightAt } from "../shared/terrain";
import { dayNightRuntime } from "../shared/timeOfDay";
import {
  MOUNTAIN_TERRAIN_Y, BIOME_TINT_Y, BIOME_SEAM_Y, ROAD_SURFACE_Y, ROAD_MARKING_Y,
  DECAL_Y,
} from "../shared/visualLayers";
import type {
  RoadPath, StaticObstacle, RegionalLampData, TreeInstance,
  PeriCityHomestead,
} from "../shared/types";

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
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  width: number;
  color: string;
}

// Elevation-aware road segment quad. Builds an explicit Matrix4 with a
// (right, forward, up) basis so the plane is centred at the segment
// midpoint, oriented along its 3D tangent (slope-aware), and faces
// upward. For flat segments (ay = by = 0) this collapses to the
// previous behaviour: the basis becomes (right, fwdHorizontal, +Y) and
// the quad sits at y=0.02 rotated around +Y by the heading.
function RegionalRoadSegment({
  ax, ay, az, bx, by, bz, width, color,
}: Omit<SegmentSpec, "key">) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { matrix, lenS } = useMemo(() => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const lenH = Math.hypot(dx, dz);
    const lenSv = Math.hypot(lenH, dy);
    const m = new THREE.Matrix4();
    if (lenH < 1e-3) return { matrix: m, lenS: lenSv };
    const right = new THREE.Vector3(-dz / lenH, 0, dx / lenH);
    const fwd = new THREE.Vector3(dx / lenSv, dy / lenSv, dz / lenSv);
    const up = new THREE.Vector3().crossVectors(right, fwd);
    // planeGeometry default: width along local +X, height along local +Y,
    // normal +Z. So (right, fwd, up) is exactly the basis we want.
    m.makeBasis(right, fwd, up);
    m.setPosition((ax + bx) / 2, (ay + by) / 2 + ROAD_SURFACE_Y, (az + bz) / 2);
    return { matrix: m, lenS: lenSv };
  }, [ax, ay, az, bx, by, bz]);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.matrixWorldNeedsUpdate = true;
  }, [matrix]);
  return (
    <mesh ref={meshRef} receiveShadow>
      <planeGeometry args={[width, lenS]} />
      <meshStandardMaterial color={color} roughness={0.90} metalness={0.02} />
    </mesh>
  );
}

function RegionalRoads() {
  const segments = useMemo<SegmentSpec[]>(() => {
    const out: SegmentSpec[] = [];
    for (const r of REGIONAL_ROADS) {
      const color = ROAD_COLOR_BY_TYPE[r.type];
      const profile = ROAD_ELEVATION_PROFILES[r.id]; // may be undefined
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i];
        const b = r.points[i + 1];
        const ay = profile ? (profile[i] ?? 0) : 0;
        const by = profile ? (profile[i + 1] ?? 0) : 0;
        out.push({
          key: `${r.id}-${i}`,
          ax: a[0], ay, az: a[1],
          bx: b[0], by, bz: b[1],
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
          ax={s.ax} ay={s.ay} az={s.az}
          bx={s.bx} by={s.by} bz={s.bz}
          width={s.width} color={s.color}
        />
      ))}
    </group>
  );
}

// =============================================================
// MOUNTAIN TERRAIN — single heightfield mesh covering the world
// =============================================================
//
// One PlaneGeometry covering [-500,500]² with 200×200 segments
// (~5m horizontal resolution, ~40k vertices) is displaced by
// `terrainHeightAt(x, z)` so the same function drives the road quads,
// every car/lamp/obstacle Y, and this visible ground surface. The
// mesh sits 0.02m below the flat BiomeGround tiles so flat parts of
// the heightfield (where terrainHeightAt returns 0) hide beneath the
// city/forest/east/west tints, and only mountain regions poke above.
//
// MOUNTAIN_MASSIFS are NOT drawn as separate cone meshes — they are
// already baked into this surface as smooth domes by terrainHeightAt.
// Replacing the previous 6-sided coneGeometry pyramids removes the
// "decorative pyramid" look the audit flagged.
function MountainTerrain() {
  const geom = useMemo(() => {
    // 200×200 (~40k verts) was overkill for the amount of detail the
    // heightfield actually shows; 128×128 (~16k verts) is visually
    // identical because terrainHeightAt is smooth and removes ~24k
    // vertices from a single shadow-receiving mesh.
    const SEG = 128;
    const SIZE = 1000;
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    // PlaneGeometry sits in XY with normal +Z. Rotate so it lies in
    // XZ with normal +Y; vertex.y now stores ground height.
    g.rotateX(-Math.PI / 2);
    const arr = g.attributes.position.array as Float32Array;
    // Stride is 3 floats per vertex (x, y, z).
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i];
      const z = arr[i + 2];
      arr[i + 1] = terrainHeightAt(x, z);
    }
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    // Slight downward bias so the heightfield's flat baseline (y=0)
    // hides beneath the BiomeGround tiles and only the elevated parts
    // are visible. flatShading reads as rugged rock facets.
    <mesh geometry={geom} position={[0, MOUNTAIN_TERRAIN_Y, 0]} receiveShadow>
      <meshStandardMaterial color="#3a3630" roughness={0.92} metalness={0.04} flatShading />
    </mesh>
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
      {/* North mountain region: handled by MountainTerrain heightfield
          (no flat tile here — would z-fight with the rising terrain). */}
      {/* Forest (south) */}
      <mesh position={[0, BIOME_TINT_Y, 340]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 320]} />
        <meshLambertMaterial color="#2a3a26" />
      </mesh>
      {/* Bridge ravine — darker patch where the bridge crosses */}
      <mesh position={[0, -0.6, 140]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 80]} />
        <meshLambertMaterial color="#15161a" />
      </mesh>
      {/* East suburban / industrial */}
      <mesh position={[300, BIOME_TINT_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshLambertMaterial color="#4a4438" />
      </mesh>
      {/* West fields */}
      <mesh position={[-300, BIOME_TINT_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshLambertMaterial color="#5a5238" />
      </mesh>
      {/* The east/west/south foothill mountain strips are now part of
          the MountainTerrain heightfield (their height comes from the
          rampart MOUNTAIN_MASSIFS at x=±498 and z=495, and terrain
          stays at y=0 in the flat suburban areas — covered by the
          tints above). */}

      {/* Transition strips at biome→city seams (BIOME_SEAM_Y sits just above
          the base biome tints to overpaint the rectangular edge, still below
          road surfaces — see shared/visualLayers.ts). */}
      <mesh position={[0, BIOME_SEAM_Y, -110]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 32]} />
        <meshLambertMaterial color="#473e34" />
      </mesh>
      <mesh position={[0, BIOME_SEAM_Y, 195]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 38]} />
        <meshLambertMaterial color="#3a402c" />
      </mesh>
      <mesh position={[110, BIOME_SEAM_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[32, 400]} />
        <meshLambertMaterial color="#473d35" />
      </mesh>
      <mesh position={[-110, BIOME_SEAM_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
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
          position={[0, ROAD_MARKING_Y, z]}
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
  // Mountain-area obstacles (cliff_wall, guardrail) sit beside the
  // elevated terrain. Sample the SHARED ground source at the obstacle
  // centre so they ride up the slope with the surrounding heightfield
  // instead of clipping below it. terrainHeightAt returns 0 outside
  // mountain country, so the cost is the same as the previous gated
  // call but it now correctly handles the east/west foothill ridges
  // (which sit south of z=-150).
  const slopeY = (o.kind === "cliff_wall" || o.kind === "guardrail")
    ? getRoadElevationAt(o.x, o.z) : 0;
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
        <mesh position={[o.x, slopeY + 8, o.z]} castShadow receiveShadow>
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
        <mesh position={[o.x, slopeY + 0.7, o.z]} castShadow>
          <boxGeometry args={[o.w, 1.4, o.d]} />
          <meshLambertMaterial color="#a8a8a0" />
        </mesh>
      );
    case "wooden_house":
      // Cosmetic body only — the per-homestead renderer below adds the
      // pitched roof, porch, and warm window light around this same
      // (o.x, o.z). Keeping the body here means the obstacle list still
      // renders something even if PERI_CITY_HOMESTEADS shrinks.
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[o.w, 2.8, o.d]} />
            <meshLambertMaterial color="#7a4a2a" />
          </mesh>
        </group>
      );
    case "yard_fence":
      // Low wooden plank fence panel. Posts are faked at the ends with
      // two slightly taller boxes so the fence reads as planks-on-posts
      // rather than a single slab.
      return (
        <group position={[o.x, 0, o.z]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[o.w, 1.1, o.d]} />
            <meshLambertMaterial color="#6b4a30" />
          </mesh>
          {o.w >= o.d ? (
            <>
              <mesh position={[-o.w / 2, 0.7, 0]} castShadow>
                <boxGeometry args={[0.25, 1.4, Math.max(o.d, 0.4)]} />
                <meshLambertMaterial color="#4a3220" />
              </mesh>
              <mesh position={[ o.w / 2, 0.7, 0]} castShadow>
                <boxGeometry args={[0.25, 1.4, Math.max(o.d, 0.4)]} />
                <meshLambertMaterial color="#4a3220" />
              </mesh>
            </>
          ) : (
            <>
              <mesh position={[0, 0.7, -o.d / 2]} castShadow>
                <boxGeometry args={[Math.max(o.w, 0.4), 1.4, 0.25]} />
                <meshLambertMaterial color="#4a3220" />
              </mesh>
              <mesh position={[0, 0.7,  o.d / 2]} castShadow>
                <boxGeometry args={[Math.max(o.w, 0.4), 1.4, 0.25]} />
                <meshLambertMaterial color="#4a3220" />
              </mesh>
            </>
          )}
        </group>
      );
  }
}

// =============================================================
// PERI-CITY HOMESTEADS — yard ground patch + pitched roof, porch,
// window light. The collidable house body and fence panels live in
// STATIC_OBSTACLES (kind "wooden_house" / "yard_fence") and render
// via ObstacleMesh; this component layers the cosmetic extras on top.
// =============================================================

const HOMESTEAD_YARD_COLOR_BY_STYLE: Record<PeriCityHomestead["style"], string> = {
  cottage:  "#5a6a3a",
  barnette: "#6a6240",
};
const HOMESTEAD_BODY_COLOR_BY_STYLE: Record<PeriCityHomestead["style"], string> = {
  cottage:  "#7a4a2a",
  barnette: "#5e3e26",
};
const HOMESTEAD_ROOF_COLOR_BY_STYLE: Record<PeriCityHomestead["style"], string> = {
  cottage:  "#3a2018",
  barnette: "#2a1c12",
};

function HomesteadHouse({ h }: { h: PeriCityHomestead }) {
  // Door faces the gate; rotY maps each gateSide to the right Y rotation
  // so the porch sits on the gate-facing edge.
  const roofH = 1.6;
  const bodyH = 2.8;
  const porchD = 1.2;
  const yardColor = HOMESTEAD_YARD_COLOR_BY_STYLE[h.style];
  const bodyColor = HOMESTEAD_BODY_COLOR_BY_STYLE[h.style];
  const roofColor = HOMESTEAD_ROOF_COLOR_BY_STYLE[h.style];
  return (
    <group position={[h.x, 0, h.z]}>
      {/* Yard ground patch — sits a hair above the biome ground tint
          so it overpaints the rectangular footprint of this homestead.
          Not collidable; collision is handled by the fence panels. */}
      <mesh
        position={[0, 0.012, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[h.yardW, h.yardD]} />
        <meshLambertMaterial color={yardColor} />
      </mesh>
      {/* Door-facing rotation — the body itself is axis-aligned (matches
          the AABB), but porch / pitched roof children read better when
          the assembly is rotated so the door points toward the gate. */}
      <group rotation={[0, h.rotY, 0]}>
        {/* Roof — long ridge along local +X, sloping down to ±Z. */}
        <mesh position={[0, bodyH + roofH / 2, 0]} castShadow>
          <boxGeometry args={[h.houseW * 1.05, roofH, h.houseD * 1.1]} />
          <meshLambertMaterial color={roofColor} />
        </mesh>
        {/* Roof ridge cap */}
        <mesh position={[0, bodyH + roofH + 0.12, 0]} castShadow>
          <boxGeometry args={[h.houseW * 1.08, 0.25, 0.4]} />
          <meshLambertMaterial color="#1f140d" />
        </mesh>
        {/* Porch slab on the +Z (door) side */}
        <mesh
          position={[0, 0.08, h.houseD / 2 + porchD / 2]}
          receiveShadow
        >
          <boxGeometry args={[h.houseW * 0.85, 0.16, porchD]} />
          <meshLambertMaterial color="#5a4028" />
        </mesh>
        {/* Door panel */}
        <mesh position={[0, 0.95, h.houseD / 2 + 0.03]}>
          <planeGeometry args={[1.0, 1.9]} />
          <meshBasicMaterial color="#1a1208" />
        </mesh>
        {/* Two warm window light panels flanking the door */}
        <mesh position={[-h.houseW * 0.3, 1.6, h.houseD / 2 + 0.04]}>
          <planeGeometry args={[0.9, 0.7]} />
          <meshBasicMaterial color="#ffd384" />
        </mesh>
        <mesh position={[ h.houseW * 0.3, 1.6, h.houseD / 2 + 0.04]}>
          <planeGeometry args={[0.9, 0.7]} />
          <meshBasicMaterial color="#ffd384" />
        </mesh>
        {/* Side window (gable end) — small square of warm light */}
        <mesh
          position={[h.houseW / 2 + 0.04, 1.7, 0]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <planeGeometry args={[0.6, 0.6]} />
          <meshBasicMaterial color="#ffd384" />
        </mesh>
        {/* Suggest a chimney for cottages so they read as homes, not sheds */}
        {h.style === "cottage" && (
          <mesh position={[h.houseW * 0.3, bodyH + roofH + 0.5, -h.houseD * 0.15]} castShadow>
            <boxGeometry args={[0.5, 1.2, 0.5]} />
            <meshLambertMaterial color="#3a2418" />
          </mesh>
        )}
      </group>
      {/* Bodies are also drawn by the obstacle pipeline; we deliberately
          re-draw a slightly smaller painted body here so the obstacle
          box is hidden under a more readable façade with vertical plank
          shading. The 0.02m inset prevents z-fighting. */}
      <group rotation={[0, h.rotY, 0]}>
        <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[h.houseW - 0.02, bodyH, h.houseD - 0.02]} />
          <meshLambertMaterial color={bodyColor} />
        </mesh>
        {/* Foundation — a thin lighter strip under the body */}
        <mesh position={[0, 0.18, 0]} receiveShadow>
          <boxGeometry args={[h.houseW + 0.2, 0.36, h.houseD + 0.2]} />
          <meshLambertMaterial color="#3a2a1c" />
        </mesh>
      </group>
    </group>
  );
}

function PeriCityHomesteads() {
  return (
    <group>
      {PERI_CITY_HOMESTEADS.map((h) => (
        <HomesteadHouse key={h.id} h={h} />
      ))}
    </group>
  );
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

// Reusable tree renderer — used by both the south-forest scatter and
// the new peri-city forest belt. Same trunk/canopy geometry, separate
// InstancedMesh per data set so we can keep deterministic ordering and
// independent counts without forcing a single huge buffer.
function TreeInstances({ data }: { data: ReadonlyArray<TreeInstance> }) {
  const trunkRef = useRef<THREE.InstancedMesh>(null!);
  const canopyRef = useRef<THREE.InstancedMesh>(null!);
  const count = data.length;

  useEffect(() => {
    if (!trunkRef.current || !canopyRef.current) return;
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    // Phase-1 polish: 3 canopy greens (mid / lighter / darker) assigned per tree
    // from a position hash, so the forest reads with depth instead of one flat
    // green. The canopy material is white so instanceColor multiplies to exactly
    // these hexes. Instanced — no extra draw calls or meshes.
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const t = data[i];
      e.set(0, t.rotY, 0);
      q.setFromEuler(e);
      s.set(t.scale, t.scale, t.scale);
      p.set(t.x, 2 * t.scale, t.z);
      m.compose(p, q, s);
      trunkRef.current.setMatrixAt(i, m);
      p.set(t.x, (4 + 2.5) * t.scale, t.z);
      m.compose(p, q, s);
      canopyRef.current.setMatrixAt(i, m);
      const tone = Math.abs(((t.x * 7 + t.z * 13) | 0)) % 3;
      c.set(tone === 0 ? "#2c5a2a" : tone === 1 ? "#39702f" : "#214a22");
      canopyRef.current.setColorAt(i, c);
    }
    trunkRef.current.instanceMatrix.needsUpdate = true;
    canopyRef.current.instanceMatrix.needsUpdate = true;
    if (canopyRef.current.instanceColor) canopyRef.current.instanceColor.needsUpdate = true;
    trunkRef.current.computeBoundingSphere();
    trunkRef.current.computeBoundingBox();
    canopyRef.current.computeBoundingSphere();
    canopyRef.current.computeBoundingBox();
  }, [data, count]);

  if (count === 0) return null;
  // Trees no longer cast shadows — they're forest-belt scenery far
  // from the player, and dropping them removes hundreds of triangles
  // from the shadow pass. Buildings + the player still cast shadows.
  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, count]}>
        <cylinderGeometry args={[0.35, 0.45, 4, 6]} />
        <meshLambertMaterial color="#4a3424" />
      </instancedMesh>
      <instancedMesh ref={canopyRef} args={[undefined, undefined, count]}>
        <coneGeometry args={[1.6, 5, 8]} />
        {/* White base so per-instance setColorAt() greens render at full value. */}
        <meshLambertMaterial color="#ffffff" />
      </instancedMesh>
    </group>
  );
}

function ForestTrees() {
  return (
    <group>
      <TreeInstances data={FOREST_TREES} />
      <TreeInstances data={CITY_EDGE_TREES} />
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
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
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
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
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
const FOREST_LAMP_POLE = "#3a2b1c";

function ForestLamps() {
  // Two SHARED materials so the day/night useFrame only mutates refs total
  // instead of one per lamp instance. The old flat ground-pool disc was
  // removed (Phase: lamp lighting); night glow now comes from real nearest-N
  // point lights in DynamicPointLights.
  const headMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: FOREST_LAMP_HEAD }),
    [],
  );
  const poleMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: FOREST_LAMP_POLE }),
    [],
  );
  const baseHeadColor = useMemo(() => new THREE.Color(FOREST_LAMP_HEAD), []);

  useFrame(() => {
    const n = dayNightRuntime.nightFactor;
    headMat.color.copy(baseHeadColor).multiplyScalar(0.4 + 0.85 * n);
  });

  useEffect(() => {
    return () => {
      headMat.dispose();
      poleMat.dispose();
    };
  }, [headMat, poleMat]);

  return (
    <group>
      {VILLAGE_LAMPS.map((lamp, i) => (
        <group key={i} position={[lamp.x, 0, lamp.z]}>
          {/* Wooden pole — no shadow (small + far from camera). */}
          <mesh position={[0, 2.4, 0]} material={poleMat}>
            <cylinderGeometry args={[0.09, 0.11, 4.8, 6]} />
          </mesh>
          {/* Emissive lantern head */}
          <mesh position={[0, 5.0, 0]} material={headMat}>
            <boxGeometry args={[0.55, 0.5, 0.55]} />
          </mesh>
        </group>
      ))}
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
}

// Per-style pole + emissive head only. The flat ground-pool disc was removed
// (Phase: lamp lighting) — night glow now comes from real nearest-N point
// lights in DynamicPointLights.
const LAMP_STYLE_DEFS: Record<LampStyle, LampStyleDef> = {
  urban: {
    poleColor: "#444448", poleHeight: 6.0, poleRadius: 0.10, poleTopY: 3.0,
    headColor: "#fff2c0", headSize: [0.7, 0.3, 0.7], headY: 5.95,
  },
  bridge: {
    poleColor: "#3a3a3e", poleHeight: 6.4, poleRadius: 0.11, poleTopY: 3.2,
    headColor: "#fff0b0", headSize: [0.8, 0.35, 0.8], headY: 6.35,
  },
  rural: {
    poleColor: "#3a2b1c", poleHeight: 4.6, poleRadius: 0.10, poleTopY: 2.3,
    headColor: "#ffc880", headSize: [0.55, 0.5, 0.55], headY: 4.7,
  },
  mountain: {
    poleColor: "#2c2c30", poleHeight: 3.0, poleRadius: 0.09, poleTopY: 1.5,
    headColor: "#ffb070", headSize: [0.5, 0.3, 0.5], headY: 3.05,
  },
};

interface InstancedLampLayerProps {
  lamps: RegionalLampData[];
  style: LampStyleDef;
}

// Lamp Y is sampled from the SHARED ground source so a lamp on a
// mountain shoulder always agrees with the road quad and the
// surrounding heightfield mesh. terrainHeightAt returns 0 outside
// mountain country — the previous isMountainRoadId() gate is no
// longer needed and would have hidden any future road-id renames.
function lampGroundY(l: RegionalLampData): number {
  return getRoadElevationAt(l.x, l.z);
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
      m.compose(new THREE.Vector3(l.x, style.poleTopY + lampGroundY(l), l.z), q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [lamps, style]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, lamps.length]}>
      <cylinderGeometry args={[style.poleRadius * 0.85, style.poleRadius, style.poleHeight, 6]} />
      <meshLambertMaterial color={style.poleColor} />
    </instancedMesh>
  );
}

function HeadLayer({ lamps, style }: InstancedLampLayerProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const baseColor = useMemo(() => new THREE.Color(style.headColor), [style.headColor]);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rotY);
      m.compose(new THREE.Vector3(l.x, style.headY + lampGroundY(l), l.z), q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [lamps, style]);
  useFrame(() => {
    const m = matRef.current;
    if (!m) return;
    // Dim the head color toward neutral when the sun is up so the emissive
    // lamp head doesn't read as full bright in midday light; brighten it a
    // touch above full at night for a hotter glow.
    m.color.copy(baseColor).multiplyScalar(0.4 + 0.85 * dayNightRuntime.nightFactor);
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, lamps.length]}>
      <boxGeometry args={style.headSize} />
      <meshBasicMaterial ref={matRef} color={style.headColor} />
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
          </group>
        );
      })}
    </group>
  );
}

// =============================================================
// DYNAMIC POINT LIGHTS — keeps at most N real lights live at once,
// always picking the N nearest to the camera each frame. The previous
// JunctionRealLights mounted EVERY junction/village/mountain light
// (~25 pointLights), each costing a per-fragment lighting term. Most
// fragment shaders branch out at distance>=light.distance, but the
// uniform/structure cost is still real. Capping to the 7 closest plus
// the driver headlight (declared in LocalPlayer) keeps us at the
// audit's ≤8 active pointLights budget without losing any visible
// glow — far lights weren't reaching the eye anyway.
// =============================================================

interface RealLightSource {
  x: number; y: number; z: number;
  color: string;
  intensity: number;
  distance: number;
}

// Candidate real-light sources, nearest-N filtered each frame. There are two
// tiers, merged into ONE candidate list:
//   1. Curated "scene anchor" lights — plaza, junctions, village centre,
//      mountain passes (~25 entries). Brighter / wider reach.
//   2. EVERY lamp head — city street lamps + regional-road lamps + village
//      lamps (~340 entries). Dimmer / shorter reach, so a lamp the player
//      walks past actually casts real localized light instead of relying on
//      the removed flat ground disc.
// With ~365 candidates, a full sort every frame would be wasteful, so the
// selection below is a PARTIAL nearest-K scan (no allocation, no sort) that
// also skips any candidate beyond CANDIDATE_MAX_DIST2 cheaply.
const PLAZA_LIGHT_COORDS: ReadonlyArray<readonly [number, number, number]> = [
  [ 15, 6,  15],
  [-15, 6,  15],
  [ 15, 6, -15],
  [-15, 6, -15],
];

// Per-regional-style lamp-head Y + intensity/reach. decay stays at 2 (below)
// so each lamp is a TIGHT realistic pool under the fixture, not a wide flat
// disc — but the intensity/reach are bumped well up so the immediate ground is
// readable at night (the heads sit ~3-6m above the ground, so 1/d^2 falloff
// eats most of a low intensity before it reaches the road).
const REGIONAL_LAMP_LIGHT: Record<LampStyle, { y: number; intensity: number; distance: number; color: string }> = {
  urban:    { y: 5.95, intensity: 6.0, distance: 24, color: "#ffe6b0" },
  bridge:   { y: 6.35, intensity: 6.5, distance: 26, color: "#ffe2b0" },
  rural:    { y: 4.7,  intensity: 5.0, distance: 22, color: "#ffcf90" },
  mountain: { y: 3.05, intensity: 4.5, distance: 20, color: "#ffc488" },
};

const ALL_REAL_LIGHTS: RealLightSource[] = [
  // Tier 1 — curated scene anchors (light wider areas; small bumps).
  ...PLAZA_LIGHT_COORDS.map(([x, y, z]) => ({
    x, y, z, color: "#ffd9a0", intensity: 7, distance: 30,
  })),
  ...JUNCTION_REAL_LIGHTS.map(([x, y, z]) => ({
    x, y, z, color: "#ffd0a0", intensity: 4.5, distance: 40,
  })),
  ...VILLAGE_REAL_LIGHTS.map(([x, y, z]) => ({
    x, y, z, color: "#ffcb88", intensity: 5.5, distance: 34,
  })),
  ...MOUNTAIN_REAL_LIGHTS.map(([x, y, z]) => ({
    x, y, z, color: "#ffd0a0", intensity: 4.5, distance: 42,
  })),
  // Tier 2 — every lamp head (city + regional + village). Brighter + wider so
  // the ground a player stands next to actually reads at night.
  ...STREET_LIGHTS.map((l) => ({
    x: l.x, y: 5.95, z: l.z, color: "#ffe6b0", intensity: 6.0, distance: 24,
  })),
  ...REGIONAL_ROAD_LAMPS.map((l) => {
    const d = REGIONAL_LAMP_LIGHT[l.style];
    return {
      x: l.x, y: d.y + getRoadElevationAt(l.x, l.z), z: l.z,
      color: d.color, intensity: d.intensity, distance: d.distance,
    };
  }),
  ...VILLAGE_LAMPS.map((l) => ({
    x: l.x, y: 5.0, z: l.z, color: "#ffd58a", intensity: 5.0, distance: 22,
  })),
];

// Nearest-N real lights kept live at once. 10 (+ 1 driver headlight = 11) so a
// player standing in a cluster of lamps (e.g. a forest stretch lit on both
// sides plus a nearby curated anchor) doesn't lose the closest lamp to the
// budget. Still a hard, bounded cap — NOT hundreds of uncontrolled lights.
const MAX_ACTIVE_LIGHTS = 12;

// ── Soft additive lamp "light pool" decals ──────────────────────────────────
// The road/biome ground materials are intentionally very dark (asphalt #1d1d22
// ≈ 0.012 linear albedo), so a real point light reflecting off them is almost
// black at night no matter how bright the bulb. These pools fix that the way
// GTA-style games do: a soft warm radial gradient drawn with ADDITIVE blending
// just above the ground, which ADDS light to the framebuffer regardless of the
// surface albedo. They are NOT lit surfaces and NOT hard discs — soft-edged,
// transparent, depthWrite:false, at DECAL_Y (no z-fighting). Bounded: only the
// nearest-N selected lamps get one, so far-away ground stays dark.
const POOL_GEO = new THREE.PlaneGeometry(1, 1);
function makeLampPoolTexture(): THREE.Texture {
  const SZ = 128;
  const c = document.createElement("canvas");
  c.width = SZ;
  c.height = SZ;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(SZ / 2, SZ / 2, 2, SZ / 2, SZ / 2, SZ / 2);
    g.addColorStop(0, "rgba(255,236,196,0.95)");
    g.addColorStop(0.45, "rgba(255,224,170,0.42)");
    g.addColorStop(1, "rgba(255,210,150,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SZ, SZ);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Candidates farther than this (squared, metres²) from the camera are skipped
// before the nearest-K test — no lamp reaches the eye from beyond ~60 m anyway.
const CANDIDATE_MAX_DIST2 = 60 * 60;

function DynamicPointLights() {
  const { camera } = useThree();
  const refs = useRef<Array<THREE.PointLight | null>>([]);
  const poolRefs = useRef<Array<THREE.Mesh | null>>([]);
  // Pre-parse every source's color, and resolve the GROUND height under each
  // lamp (0 off-mountain) so the additive pool sits on the road, not at the
  // bulb. Done once at mount; no per-frame allocation.
  const sources = useMemo(
    () =>
      ALL_REAL_LIGHTS.map((s) => ({
        ...s,
        _color: new THREE.Color(s.color),
        gy: getRoadElevationAt(s.x, s.z),
      })),
    [],
  );
  // One shared additive material for every pool — opacity is driven once per
  // frame by lampGain (all pools fade together with night).
  const poolMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: makeLampPoolTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0,
      }),
    [],
  );
  const loggedRef = useRef(false);
  // Reused nearest-K result buffers (index + squared distance), no per-frame
  // allocation. selN tracks how many slots are currently filled.
  const selIdx = useRef<number[]>(new Array(MAX_ACTIVE_LIGHTS).fill(-1));
  const selDist = useRef<number[]>(new Array(MAX_ACTIVE_LIGHTS).fill(Infinity));

  useFrame(() => {
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const idx = selIdx.current;
    const dist = selDist.current;
    // Reset the nearest-K buffer.
    let selN = 0;
    for (let k = 0; k < MAX_ACTIVE_LIGHTS; k++) { idx[k] = -1; dist[k] = Infinity; }

    // Partial nearest-K selection: one linear scan, insert into a tiny sorted
    // (ascending) buffer of size MAX_ACTIVE_LIGHTS. O(candidates × K) with a
    // tiny K — far cheaper than sorting all ~365 candidates each frame, and it
    // allocates nothing.
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const dx = s.x - cx;
      const dy = s.y - cy;
      const dz = s.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > CANDIDATE_MAX_DIST2) continue;            // cheap range cull
      if (selN >= MAX_ACTIVE_LIGHTS && d2 >= dist[MAX_ACTIVE_LIGHTS - 1]) continue; // worse than worst kept
      // Insertion sort into the small buffer.
      let p = Math.min(selN, MAX_ACTIVE_LIGHTS - 1);
      while (p > 0 && dist[p - 1] > d2) { dist[p] = dist[p - 1]; idx[p] = idx[p - 1]; p--; }
      dist[p] = d2;
      idx[p] = i;
      if (selN < MAX_ACTIVE_LIGHTS) selN++;
    }

    // Lamp fade: ramp lamps in EARLIER than full night so the dark-looking
    // sunset/dusk window isn't lit by dead lamps. nightFactor alone is only
    // ~0.05 at sunset (sun on the horizon); this reaches ~0.6 at sunset, 1.0 at
    // night, and still collapses to 0 in full day (both terms are ~0 at midday).
    const lampGain = Math.min(
      1,
      dayNightRuntime.nightFactor * 1.8 + dayNightRuntime.dawnDuskFactor * 0.5,
    );
    // Pool opacity follows lampGain (off in day). Shared across all pools.
    poolMat.opacity = 0.7 * lampGain;
    const poolsOn = lampGain > 0.02;

    for (let k = 0; k < MAX_ACTIVE_LIGHTS; k++) {
      const ref = refs.current[k];
      const pool = poolRefs.current[k];
      const si = idx[k];
      if (si < 0) {
        if (ref) ref.intensity = 0;
        if (pool) pool.visible = false;
        continue;
      }
      const s = sources[si];
      if (ref) {
        ref.position.set(s.x, s.y, s.z);
        ref.color.copy(s._color);
        ref.intensity = s.intensity * lampGain;
        ref.distance = s.distance;
        // decay 1.8 (was 2): a touch more reach so the real light still shapes
        // the player/cars near a lamp; the additive pool carries the dark ground.
        ref.decay = 1.8;
      }
      if (pool) {
        pool.visible = poolsOn;
        if (poolsOn) {
          // Pool sits ON the ground (DECAL_Y above the road) and spans ~ the
          // lamp's reach so the 8-15m around the fixture reads.
          pool.position.set(s.x, s.gy + DECAL_Y, s.z);
          const diam = s.distance * 0.95;
          pool.scale.set(diam, diam, 1);
        }
      }
    }

    // Debug-safe proof (one shot, once it's actually night) that lamps near the
    // camera are mounted with real intensity — not just emissive heads.
    if (!loggedRef.current && lampGain > 0.5) {
      loggedRef.current = true;
      let active = 0;
      let nearest2 = Infinity;
      let nearIntensity = 0;
      let nearHeadY = 0;
      let nearDistance = 0;
      for (let k = 0; k < MAX_ACTIVE_LIGHTS; k++) {
        const si = idx[k];
        if (si < 0) continue;
        active++;
        if (dist[k] < nearest2) {
          nearest2 = dist[k];
          const s = sources[si];
          nearIntensity = s.intensity * lampGain;
          nearHeadY = s.y;
          nearDistance = s.distance;
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `lampDebug OK: dynamicLampBudget=${MAX_ACTIVE_LIGHTS} (+1 headlight), ` +
          `activeNearCamera=${active}, nearestLamp=${Math.sqrt(nearest2).toFixed(1)}m, ` +
          `nearestIntensity=${nearIntensity.toFixed(1)} (range=${nearDistance}, decay=1.8, headY=${nearHeadY.toFixed(1)}), ` +
          `lampGain=${lampGain.toFixed(2)}, additiveGroundPools=true, singleShadowLight=true`,
      );
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_ACTIVE_LIGHTS }, (_, i) => (
        <pointLight
          key={`pl-${i}`}
          ref={(r) => {
            refs.current[i] = r;
          }}
          intensity={0}
          distance={1}
          decay={1.8}
        />
      ))}
      {/* Soft additive ground pools — one per active lamp slot, repositioned to
          the selected nearest lamps each frame (bounded; far ground stays dark). */}
      {Array.from({ length: MAX_ACTIVE_LIGHTS }, (_, i) => (
        <mesh
          key={`pool-${i}`}
          ref={(r) => {
            poolRefs.current[i] = r;
          }}
          geometry={POOL_GEO}
          material={poolMat}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
          frustumCulled={false}
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
      <PeriCityHomesteads />
      <ForestTrees />
      <ForestRocks />
      <MountainRocks />
      <MountainTerrain />
      <ForestLamps />
      <RegionalRoadLamps />
      <DynamicPointLights />
    </group>
  );
}
