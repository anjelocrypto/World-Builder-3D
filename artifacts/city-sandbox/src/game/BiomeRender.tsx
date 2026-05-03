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
  MOUNTAIN_REAL_LIGHTS,
  MOUNTAIN_MASSIFS,
  ROAD_ELEVATION_PROFILES,
  MOUNTAIN_ROAD_IDS,
  CITY_EDGE_TREES,
  PERI_CITY_HOMESTEADS,
} from "../shared/cityData";
import { getRoadElevationAt, isMountainRoadId } from "../shared/elevation";
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
    m.setPosition((ax + bx) / 2, (ay + by) / 2 + 0.02, (az + bz) / 2);
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
      <meshLambertMaterial color={color} />
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
// MOUNTAIN MASSIFS — large background cones for ridge silhouette
// =============================================================
function MountainMassifs() {
  return (
    <group>
      {MOUNTAIN_MASSIFS.map((m, i) => (
        <mesh key={i} position={[m.x, m.h / 2, m.z]} castShadow receiveShadow>
          <coneGeometry args={[m.r, m.h, 6]} />
          <meshLambertMaterial color="#3a3530" flatShading />
        </mesh>
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
      {/* East foothill mountain strip — darker tint outside outer-loop
          east leg (x=460), painted on top of the suburban tile so the
          ridge-east-far road and the eastern MOUNTAIN_MASSIFS read as a
          continuous mountain wall. */}
      <mesh position={[480, 0.0012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 1000]} />
        <meshLambertMaterial color="#3a3530" />
      </mesh>
      {/* West foothill mountain strip — mirror. */}
      <mesh position={[-480, 0.0012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 1000]} />
        <meshLambertMaterial color="#3a3530" />
      </mesh>
      {/* South foothill mountain strip — narrow band at z≈490 just
          past the trailhead/cabins so the south MOUNTAIN_MASSIFS feel
          rooted in mountain ground. */}
      <mesh position={[0, 0.0012, 488]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 24]} />
        <meshLambertMaterial color="#3a3530" />
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
  // Mountain-area obstacles (cliff_wall, guardrail) sit beside elevated
  // roads. Sample the road profile at the obstacle centre so they ride
  // up the slope with the carriageway instead of clipping below it.
  // Threshold mirrors the elevation helper's early bail (z > -150).
  const slopeY = o.z < -150 ? getRoadElevationAt(o.x, o.z) : 0;
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
    }
    trunkRef.current.instanceMatrix.needsUpdate = true;
    canopyRef.current.instanceMatrix.needsUpdate = true;
    trunkRef.current.computeBoundingSphere();
    trunkRef.current.computeBoundingBox();
    canopyRef.current.computeBoundingSphere();
    canopyRef.current.computeBoundingBox();
  }, [data, count]);

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

// Lamps on mountain roads need their pole/head/pool elevated to the
// road surface — without this they'd float at y=0 while the road is at
// y=8..22m up the slope.
function lampGroundY(l: RegionalLampData): number {
  return isMountainRoadId(l.roadId) ? getRoadElevationAt(l.x, l.z) : 0;
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
      m.compose(new THREE.Vector3(l.x, style.headY + lampGroundY(l), l.z), q, s);
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
      m.compose(new THREE.Vector3(l.x, 0.04 + lampGroundY(l), l.z), q, s);
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
      {MOUNTAIN_REAL_LIGHTS.map(([x, y, z], i) => (
        <pointLight
          key={`m-${i}`}
          position={[x, y, z]}
          color="#ffd0a0"
          intensity={3.5}
          distance={40}
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
      <PeriCityHomesteads />
      <ForestTrees />
      <ForestRocks />
      <MountainRocks />
      <MountainMassifs />
      <ForestLamps />
      <RegionalRoadLamps />
      <JunctionRealLights />
    </group>
  );
}
