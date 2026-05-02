import * as THREE from "three";
import { useMemo } from "react";
import {
  BUILDINGS,
  RAMPS,
  ROADS,
  STREET_LIGHTS,
  TRAFFIC_LIGHTS,
  PARKING_SPOTS,
  PROPS,
} from "../shared/cityData";
import type { Building, PropData } from "../shared/types";
import CentralRail from "./CentralRail";

// =============================================================
// SKY + GROUND
// =============================================================

function Skybox() {
  // Slightly brighter night-blue so distant fog blends with sky and the
  // city is readable. Was: #0a0a1a (near-black). Sphere radius bumped
  // from 280 → 850 to enclose the 1000-unit expanded world.
  return (
    <mesh>
      <sphereGeometry args={[850, 24, 16]} />
      <meshBasicMaterial color="#1a2440" side={THREE.BackSide} />
    </mesh>
  );
}

function Ground() {
  // Base ground covers the full 1000-unit playable area plus a small
  // overhang. Biome render layers a per-region tint plane on top.
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[1100, 1100]} />
      <meshLambertMaterial color="#2a2e3a" />
    </mesh>
  );
}

// =============================================================
// ROADS — carriageway, sidewalks (raised curbs), lane markings, crosswalks
// =============================================================

const ROAD_COLOR = "#1d1d22";
const LANE_COLOR = "#f0c040";
const SIDEWALK_COLOR = "#4a4a52";
const CURB_COLOR = "#6b6b73";
const CROSSWALK_COLOR = "#dcdce0";

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
      {/* Podium — wider 2-floor base wrapping the tower */}
      {b.podium && (
        <mesh position={[0, 3, 0]} castShadow receiveShadow>
          <boxGeometry args={[b.w + 1.6, 6, b.d + 1.6]} />
          <meshLambertMaterial color="#2a2f38" />
        </mesh>
      )}
      {/* Crown light — emissive halo near the roof */}
      {b.crownLight && (
        <mesh position={[0, b.h - 0.3, 0]}>
          <boxGeometry args={[b.w + 0.4, 0.6, b.d + 0.4]} />
          <meshBasicMaterial
            color={b.tier === "landmark" ? "#7ed4ff" : "#ffd070"}
            transparent
            opacity={0.85}
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
  // Floor count varies by height. Each floor renders one emissive strip
  // per side of the building → 4 strips per floor. windowSeed-derived
  // opacity gives every building a different "lit/unlit" feel.
  const floors = Math.max(1, Math.floor(b.h / 3.5));
  const floorSpacing = b.h / (floors + 1);

  // Deterministic per-floor opacity so different floors look different
  // (some "lit", some "dim") but every client sees the same pattern.
  const litFloors = useMemo(() => {
    const out: number[] = [];
    let s = b.windowSeed | 0;
    for (let i = 0; i < floors; i++) {
      s = Math.imul(s, 1664525) + 1013904223;
      out.push(((s >>> 0) / 0x100000000) > 0.25 ? 1 : 0.25);
    }
    return out;
  }, [b.windowSeed, floors]);

  // Window-strip color: warmer for residential, cooler for downtown.
  const windowColor =
    b.district === "residential" ? "#ffd99a" :
    b.district === "downtown"    ? "#cfe6ff" :
                                   "#ffe9b0";

  return (
    <group position={[b.x, 0, b.z]}>
      {/* Body */}
      <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[b.w, b.h, b.d]} />
        <meshLambertMaterial color={b.color} />
      </mesh>

      {/* Window strips on all 4 sides */}
      {Array.from({ length: floors }, (_, f) => {
        const y = (f + 1) * floorSpacing;
        const opacity = 0.85 * litFloors[f];
        return (
          <group key={f}>
            {/* +Z face */}
            <mesh position={[0, y, b.d / 2 + 0.02]}>
              <planeGeometry args={[b.w * 0.7, 1.0]} />
              <meshBasicMaterial color={windowColor} transparent opacity={opacity} />
            </mesh>
            {/* -Z face */}
            <mesh position={[0, y, -b.d / 2 - 0.02]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[b.w * 0.7, 1.0]} />
              <meshBasicMaterial color={windowColor} transparent opacity={opacity} />
            </mesh>
            {/* +X face */}
            <mesh position={[b.w / 2 + 0.02, y, 0]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[b.d * 0.7, 1.0]} />
              <meshBasicMaterial color={windowColor} transparent opacity={opacity} />
            </mesh>
            {/* -X face */}
            <mesh position={[-b.w / 2 - 0.02, y, 0]} rotation={[0, -Math.PI / 2, 0]}>
              <planeGeometry args={[b.d * 0.7, 1.0]} />
              <meshBasicMaterial color={windowColor} transparent opacity={opacity} />
            </mesh>
          </group>
        );
      })}

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

function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b, i) => (
        <BuildingMesh key={i} b={b} />
      ))}
    </group>
  );
}

// =============================================================
// STREET LAMPS — emissive head + transparent ground "light pool"
// =============================================================

const LAMP_HEAD_COLOR = "#fff2c0";
const LAMP_POOL_COLOR = "#ffe49a";

function StreetLamps() {
  return (
    <group>
      {STREET_LIGHTS.map((lamp, i) => (
        <group key={i} position={[lamp.x, 0, lamp.z]}>
          {/* Pole */}
          <mesh position={[0, 3, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.1, 6, 6]} />
            <meshLambertMaterial color="#444448" />
          </mesh>
          {/* Lamp arm */}
          <mesh position={[0, 6, 0]}>
            <boxGeometry args={[0.12, 0.12, 0.6]} />
            <meshLambertMaterial color="#444448" />
          </mesh>
          {/* Emissive head */}
          <mesh position={[0, 5.95, 0]}>
            <boxGeometry args={[0.7, 0.3, 0.7]} />
            <meshBasicMaterial color={LAMP_HEAD_COLOR} />
          </mesh>
          {/* Fake light pool on ground (transparent disc) */}
          <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[5, 16]} />
            <meshBasicMaterial color={LAMP_POOL_COLOR} transparent opacity={0.18} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// =============================================================
// TRAFFIC LIGHTS — at every intersection corner
// =============================================================

function TrafficLights() {
  return (
    <group>
      {TRAFFIC_LIGHTS.map((tl, i) => (
        <group
          key={i}
          position={[tl.x, 0, tl.z]}
          rotation={[0, tl.rotY, 0]}
        >
          {/* Pole */}
          <mesh position={[0, 2.5, 0]}>
            <cylinderGeometry args={[0.08, 0.1, 5, 6]} />
            <meshLambertMaterial color="#2c2c30" />
          </mesh>
          {/* Arm */}
          <mesh position={[0, 4.8, 0.4]}>
            <boxGeometry args={[0.1, 0.1, 0.8]} />
            <meshLambertMaterial color="#2c2c30" />
          </mesh>
          {/* Light box */}
          <group position={[0, 4.4, 0.85]}>
            <mesh>
              <boxGeometry args={[0.5, 1.2, 0.3]} />
              <meshLambertMaterial color="#1a1a1f" />
            </mesh>
            {/* Red */}
            <mesh position={[0, 0.4, 0.16]}>
              <sphereGeometry args={[0.12, 8, 8]} />
              <meshBasicMaterial color="#e74c3c" />
            </mesh>
            {/* Yellow (dim) */}
            <mesh position={[0, 0, 0.16]}>
              <sphereGeometry args={[0.12, 8, 8]} />
              <meshBasicMaterial color="#5a5028" />
            </mesh>
            {/* Green (dim) */}
            <mesh position={[0, -0.4, 0.16]}>
              <sphereGeometry args={[0.12, 8, 8]} />
              <meshBasicMaterial color="#2a4a32" />
            </mesh>
          </group>
        </group>
      ))}
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
  switch (p.type) {
    case "bench":
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[1.6, 0.1, 0.45]} />
            <meshLambertMaterial color="#6b4a2a" />
          </mesh>
          <mesh position={[0, 0.7, -0.18]} castShadow>
            <boxGeometry args={[1.6, 0.4, 0.08]} />
            <meshLambertMaterial color="#6b4a2a" />
          </mesh>
          <mesh position={[-0.7, 0.2, 0]} castShadow>
            <boxGeometry args={[0.1, 0.4, 0.45]} />
            <meshLambertMaterial color="#3a3a3a" />
          </mesh>
          <mesh position={[0.7, 0.2, 0]} castShadow>
            <boxGeometry args={[0.1, 0.4, 0.45]} />
            <meshLambertMaterial color="#3a3a3a" />
          </mesh>
        </group>
      );
    case "planter":
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh position={[0, 0.4, 0]} castShadow>
            <boxGeometry args={[1.0, 0.8, 1.0]} />
            <meshLambertMaterial color="#5a4a3a" />
          </mesh>
          <mesh position={[0, 1.1, 0]} castShadow>
            <sphereGeometry args={[0.55, 10, 10]} />
            <meshLambertMaterial color="#3a6c4a" />
          </mesh>
        </group>
      );
    case "trashcan":
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow>
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
          <mesh position={[0, 0.35, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.22, 0.7, 8]} />
            <meshLambertMaterial color="#c0392b" />
          </mesh>
          <mesh position={[0, 0.78, 0]} castShadow>
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
// RAMPS
// =============================================================

function Ramps() {
  return (
    <group>
      {RAMPS.map((r, i) => (
        <group key={i} position={[r.x, 0.5, r.z]} rotation={[0, r.rotY, 0]}>
          <mesh position={[0, 0, 0]} rotation={[-0.3, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[8, 0.3, 6]} />
            <meshLambertMaterial color="#666" />
          </mesh>
          <mesh position={[0, -0.5, 2.5]}>
            <boxGeometry args={[8, 1, 0.4]} />
            <meshLambertMaterial color="#555" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

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
      <Skybox />
      <Ground />
      <Roads />
      <Crosswalks />
      <ParkingMarkings />
      <Buildings />
      <StreetLamps />
      <TrafficLights />
      <Props />
      <Ramps />
      <CentralRail />

      {/* Four real point lights at the central plaza corners.
          Decay=2 + small distance keeps cost contained. */}
      {[
        [ 15, 6,  15],
        [-15, 6,  15],
        [ 15, 6, -15],
        [-15, 6, -15],
      ].map(([x, y, z], i) => (
        <pointLight
          key={i}
          position={[x, y, z]}
          color="#ffd9a0"
          intensity={6}
          distance={28}
          decay={2}
        />
      ))}

      {/* Atmospheric fog — extended for the 1000-unit world. Was
          ["#1a2440", 90, 260]. Far end is set just inside the camera
          far-plane so distant biomes fade into the sky. */}
      <fog attach="fog" args={["#1a2440", 200, 800]} />
    </group>
  );
}
