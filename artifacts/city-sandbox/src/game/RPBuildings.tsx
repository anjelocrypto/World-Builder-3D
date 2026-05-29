/**
 * Phase 9A Batch C: RPBuildings — readable low-poly shells for the civic RP
 * locations. Renders ONLY the 5 verified entries in the mirrored RP_BUILDINGS
 * table (City Hall, Public Works Depot, Medical Center, Mechanic Garage,
 * Dealership). Geometry is read straight from that table so it can never drift
 * from the server footprint validator (validateRpBuildings).
 *
 * Batch C is visual-only:
 *   - No collision/physics changes, no new interaction, no coordinate moves.
 *   - The existing marker rings in RPMarkers.tsx stay; these buildings sit
 *     around/behind them as the actual "place".
 *
 * Each building is a four-wall shell with a flat roof, an open doorway on its
 * `facing` side, a colored fascia sign band, and simple emissive window strips.
 * Walls are built as four thin boxes (not a solid block) so the doorway reads
 * as an actual opening and the lobby is hollow — the player model can stand in
 * the entrance. Kept deliberately simple/low-poly for performance.
 */

import { Text } from "@react-three/drei";
import type { RpBuildingDef, RpBuildingFacing } from "../shared/rpTypes";
import { RP_BUILDINGS, RP_INTERIOR_BUILDING_IDS } from "../shared/rpTypes";

// ── Per-building visual identity (color only — geometry comes from the table) ──

interface BuildingStyle {
  wall:      string;
  roof:      string;
  sign:      string;   // fascia band + emissive accent
  signText:  string;   // readable label rendered on the fascia
  floor?:    string;   // Phase 10A: interior lobby floor (only for walk-in buildings)
}

const STYLES: Record<string, BuildingStyle> = {
  government_office: { wall: "#c9c4b4", roof: "#8a8576", sign: "#5577ee", signText: "CITY HALL", floor: "#3b4252" },
  city_worker_depot: { wall: "#b6893f", roof: "#6e5526", sign: "#e0a93b", signText: "PUBLIC WORKS" },
  medic_center:      { wall: "#e8e8ee", roof: "#c2c6cf", sign: "#e2554e", signText: "MEDICAL CENTER", floor: "#dfe6ea" },
  mechanic_garage:   { wall: "#7d8893", roof: "#525a63", sign: "#e08a2b", signText: "MECHANIC" },
  dealership:        { wall: "#d8dde4", roof: "#9aa3ad", sign: "#3aa0d8", signText: "AUTO SALES" },
  taxi_depot:        { wall: "#d8c24a", roof: "#8a7c2e", sign: "#f1c40f", signText: "TAXI DEPOT" },
  delivery_hub:      { wall: "#9c8a6a", roof: "#5a4a36", sign: "#cf7a33", signText: "DELIVERY HUB" },
  licensing_office:  { wall: "#cfd6dc", roof: "#8b94a0", sign: "#3f7fbf", signText: "DMV / AUTO SCHOOL", floor: "#41484f" },
  police_station:    { wall: "#b9c2cc", roof: "#3a4654", sign: "#2f6fd0", signText: "POLICE", floor: "#2b333d" },
};

const DEFAULT_STYLE: BuildingStyle = { wall: "#bcc0c6", roof: "#80858c", sign: "#5577ee", signText: "" };

// ── Phase 10D: visual-only interior props ─────────────────────────────────────
//
// Data-driven, VISUAL-ONLY interior furnishings for the walk-in civic buildings.
// Coordinates are in a CANONICAL local frame where +Z points toward the door
// (back wall at −depthHalf, door at +depthHalf); the renderer rotates this frame
// to match each building's `facing`. Props sit against the back/side walls, clear
// of the door corridor, interaction rings, and (Police) the jail circle — all
// verified in PHASE_10D_INTERIOR_POLISH_AUDIT.md. No collision, no interaction:
// these meshes never enter playerHitsAnyRpWall or any gate, so they cannot trap
// or slow the player.

interface InteriorProp {
  /** cross-axis position (local X) */ x: number;
  /** door-axis position (local Z; − = back wall, + = toward door) */ z: number;
  w: number;   // size along cross-axis
  d: number;   // size along door-axis
  h: number;   // height
  y?: number;  // base height (default sits on floor)
  color: string;
  emissive?: string;
}

const INTERIOR_PROPS: Record<string, InteriorProp[]> = {
  government_office: [
    { x: 0,    z: -4.0, w: 8,   d: 1.2, h: 1.1, color: "#6b5e3a" },                 // service counter
    { x: -7.5, z: -1,   w: 0.3, d: 3,   h: 2.0, y: 1.0, color: "#2b2f3a", emissive: "#3355cc" }, // notice board
    { x: 5,    z: -4.2, w: 3,   d: 1.2, h: 1.0, color: "#5b4f33" },                 // mayor desk
  ],
  licensing_office: [
    { x: 0,    z: -2.5, w: 5,   d: 1.0, h: 1.1, color: "#5a6470" },                 // service counter
    { x: -2.5, z: 1.0,  w: 0.2, d: 2.0, h: 0.9, color: "#8b94a0" },                 // queue rail
    { x: 2.5,  z: -2.6, w: 2,   d: 1.0, h: 1.0, color: "#4f5864" },                 // test-start desk
  ],
  medic_center: [
    { x: 0,    z: -7.5, w: 6,   d: 1.2, h: 1.1, color: "#d7dde2" },                 // intake counter
    { x: -3,   z: -3,   w: 1.0, d: 2.2, h: 0.6, color: "#eef2f5" },                 // treatment bed
    { x: -4.0, z: 0,    w: 0.1, d: 14,  h: 0.4, y: 2.4, color: "#e2554e", emissive: "#e2554e" }, // red wall stripe
  ],
  police_station: [
    { x: 6,    z: -5.5, w: 5,   d: 1.2, h: 1.1, color: "#3a4654" },                 // booking counter
    { x: -9.0, z: -2,   w: 0.3, d: 3,   h: 2.0, y: 1.0, color: "#22303f", emissive: "#2f6fd0" }, // notice board
  ],
};

/** Rotation (rad) that maps the canonical +Z-toward-door frame onto a facing.
 *  Matches the fascia-label convention: rotation.y=θ maps local +Z to world
 *  (sinθ, cosθ) on (x,z). south(+Z)=0, north(−Z)=π, east(+X)=π/2, west(−X)=−π/2. */
function interiorPropRotation(f: RpBuildingFacing): number {
  switch (f) {
    case "south": return 0;
    case "north": return Math.PI;
    case "east":  return Math.PI / 2;
    case "west":  return -Math.PI / 2;
  }
}

const WALL_HEIGHT     = 6;     // m — civic single-storey shell
const WALL_THICKNESS  = 0.5;   // m
const ROOF_THICKNESS  = 0.4;   // m
const DOOR_WIDTH      = 3.0;    // m — opening on the facing wall
const DOOR_HEIGHT     = 3.6;    // m
const SIGN_HEIGHT     = 1.1;    // m — fascia band above the door

// Axis the entrance faces sits on: north/south → front wall is on ±Z,
// east/west → front wall is on ±X.
function isFacingZ(f: RpBuildingFacing): boolean {
  return f === "north" || f === "south";
}

/** One civic building shell. */
function RPBuildingMesh({ b }: { b: RpBuildingDef }) {
  const s = STYLES[b.id] ?? DEFAULT_STYLE;
  const halfW = b.w / 2;
  const halfD = b.d / 2;
  const t = WALL_THICKNESS;

  // Door sits on the facing wall. Compute the two wall segments that flank the
  // opening on that wall, plus the three solid walls.
  const facingZ = isFacingZ(b.facing);
  // Sign of the facing wall along its axis (+1 front, -1 back).
  const sign = (b.facing === "north" || b.facing === "west") ? -1 : 1;

  // Build the four walls. The facing wall is split into two jambs around the door.
  const walls: { px: number; pz: number; w: number; d: number }[] = [];

  if (facingZ) {
    // Front/back walls run along X (width b.w); side walls run along Z (depth b.d).
    const frontZ = sign * halfD;
    const backZ  = -sign * halfD;
    // back wall (solid)
    walls.push({ px: 0, pz: backZ, w: b.w, d: t });
    // side walls (solid) along Z
    walls.push({ px: -halfW, pz: 0, w: t, d: b.d });
    walls.push({ px:  halfW, pz: 0, w: t, d: b.d });
    // front wall split into two jambs around DOOR_WIDTH
    const jamb = (b.w - DOOR_WIDTH) / 2;
    walls.push({ px: -(DOOR_WIDTH / 2 + jamb / 2), pz: frontZ, w: jamb, d: t });
    walls.push({ px:  (DOOR_WIDTH / 2 + jamb / 2), pz: frontZ, w: jamb, d: t });
  } else {
    // Front/back walls run along Z (depth b.d); side walls run along X (width b.w).
    const frontX = sign * halfW;
    const backX  = -sign * halfW;
    walls.push({ px: backX, pz: 0, w: t, d: b.d });
    walls.push({ px: 0, pz: -halfD, w: b.w, d: t });
    walls.push({ px: 0, pz:  halfD, w: b.w, d: t });
    const jamb = (b.d - DOOR_WIDTH) / 2;
    walls.push({ px: frontX, pz: -(DOOR_WIDTH / 2 + jamb / 2), w: t, d: jamb });
    walls.push({ px: frontX, pz:  (DOOR_WIDTH / 2 + jamb / 2), w: t, d: jamb });
  }

  // Lintel above the door (so the opening is a doorway, not a full-height gap).
  const lintel = (() => {
    const lintelH = WALL_HEIGHT - DOOR_HEIGHT;
    if (lintelH <= 0) return null;
    const y = DOOR_HEIGHT + lintelH / 2;
    if (facingZ) {
      const frontZ = sign * halfD;
      return { px: 0, py: y, pz: frontZ, w: DOOR_WIDTH, h: lintelH, d: t };
    }
    const frontX = sign * halfW;
    return { px: frontX, py: y, pz: 0, w: t, h: lintelH, d: DOOR_WIDTH };
  })();

  // Fascia sign band: a colored bar centered over the door, just below the roof.
  const fascia = (() => {
    const y = WALL_HEIGHT + ROOF_THICKNESS / 2;
    const len = facingZ ? Math.min(b.w * 0.7, 12) : Math.min(b.d * 0.7, 12);
    if (facingZ) {
      const frontZ = sign * (halfD + 0.05);
      return { px: 0, py: y, pz: frontZ, w: len, h: SIGN_HEIGHT, d: 0.3 };
    }
    const frontX = sign * (halfW + 0.05);
    return { px: frontX, py: y, pz: 0, w: 0.3, h: SIGN_HEIGHT, d: len };
  })();

  // Readable text label on the fascia, rotated so it faces outward from the
  // entrance wall and sits a hair in front of the sign band.
  const label = (() => {
    const y = fascia.py;
    switch (b.facing) {
      case "south": return { pos: [0, y, halfD + 0.3] as const,  ry: 0 };
      case "north": return { pos: [0, y, -halfD - 0.3] as const, ry: Math.PI };
      case "east":  return { pos: [halfW + 0.3, y, 0] as const,  ry: Math.PI / 2 };
      case "west":  return { pos: [-halfW - 0.3, y, 0] as const, ry: -Math.PI / 2 };
    }
  })();

  // Window strip: a thin emissive band along the two side walls.
  const sideWindows = (() => {
    const y = WALL_HEIGHT * 0.58;
    const len = facingZ ? b.d * 0.7 : b.w * 0.7;
    const out: { px: number; pz: number; w: number; d: number }[] = [];
    if (facingZ) {
      out.push({ px: -halfW - 0.03, pz: 0, w: 0.06, d: len });
      out.push({ px:  halfW + 0.03, pz: 0, w: 0.06, d: len });
    } else {
      out.push({ px: 0, pz: -halfD - 0.03, w: len, d: 0.06 });
      out.push({ px: 0, pz:  halfD + 0.03, w: len, d: 0.06 });
    }
    return { y, out };
  })();

  // Phase 10A: walk-in interior — distinct lobby floor for interior-enabled
  // buildings (City Hall + DMV). Inset slightly inside the walls; visual only.
  const hasInterior = RP_INTERIOR_BUILDING_IDS.includes(b.id) && !!s.floor;
  const floorW = b.w - 2 * WALL_THICKNESS;
  const floorD = b.d - 2 * WALL_THICKNESS;

  return (
    <group position={[b.x, 0, b.z]}>
      {/* Walls */}
      {walls.map((w, i) => (
        <mesh key={`w${i}`} position={[w.px, WALL_HEIGHT / 2, w.pz]} castShadow receiveShadow>
          <boxGeometry args={[w.w, WALL_HEIGHT, w.d]} />
          <meshStandardMaterial color={s.wall} roughness={0.78} metalness={0.06} />
        </mesh>
      ))}

      {/* Phase 10A: interior lobby floor (walk-in buildings only) */}
      {hasInterior && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[floorW, floorD]} />
          <meshStandardMaterial color={s.floor} roughness={0.9} metalness={0.04} />
        </mesh>
      )}

      {/* Phase 10D: visual-only interior props (rotated from canonical +Z-door frame) */}
      {hasInterior && INTERIOR_PROPS[b.id] && (
        <group rotation={[0, interiorPropRotation(b.facing), 0]}>
          {INTERIOR_PROPS[b.id].map((p, i) => (
            <mesh key={`prop${i}`} position={[p.x, (p.y ?? 0) + p.h / 2, p.z]} castShadow receiveShadow>
              <boxGeometry args={[p.w, p.h, p.d]} />
              <meshStandardMaterial
                color={p.color}
                emissive={p.emissive ?? "#000000"}
                emissiveIntensity={p.emissive ? 0.5 : 0}
                roughness={0.8}
                metalness={0.05}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* Door lintel (header above the opening) */}
      {lintel && (
        <mesh position={[lintel.px, lintel.py, lintel.pz]} castShadow>
          <boxGeometry args={[lintel.w, lintel.h, lintel.d]} />
          <meshStandardMaterial color={s.wall} roughness={0.78} metalness={0.06} />
        </mesh>
      )}

      {/* Flat roof slab (slight overhang) */}
      <mesh position={[0, WALL_HEIGHT + ROOF_THICKNESS / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[b.w + 0.8, ROOF_THICKNESS, b.d + 0.8]} />
        <meshStandardMaterial color={s.roof} roughness={0.85} metalness={0.05} />
      </mesh>

      {/* Fascia sign band over the entrance (emissive accent) */}
      <mesh position={[fascia.px, fascia.py, fascia.pz]}>
        <boxGeometry args={[fascia.w, fascia.h, fascia.d]} />
        <meshStandardMaterial color={s.sign} emissive={s.sign} emissiveIntensity={0.6} roughness={0.4} />
      </mesh>

      {/* Readable building label on the fascia (Batch D). Faces outward. */}
      {s.signText && (
        <Text
          position={label.pos}
          rotation={[0, label.ry, 0]}
          fontSize={0.7}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.04}
          outlineColor="#000000"
          maxWidth={Math.max(fascia.w, fascia.d) - 0.5}
        >
          {s.signText}
        </Text>
      )}

      {/* Side window strips (emissive) */}
      {sideWindows.out.map((w, i) => (
        <mesh key={`win${i}`} position={[w.px, sideWindows.y, w.pz]}>
          <boxGeometry args={[w.w, 0.9, w.d]} />
          <meshStandardMaterial color="#bfe6ff" emissive="#9fd4ff" emissiveIntensity={0.35} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** All civic RP buildings. Visual-only; mounted alongside RPMarkers. */
export default function RPBuildings() {
  return (
    <group>
      {RP_BUILDINGS.map((b) => (
        <RPBuildingMesh key={b.id} b={b} />
      ))}
    </group>
  );
}
