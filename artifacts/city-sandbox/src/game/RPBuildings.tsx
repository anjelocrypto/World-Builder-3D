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
import { RP_BUILDINGS } from "../shared/rpTypes";

// ── Per-building visual identity (color only — geometry comes from the table) ──

interface BuildingStyle {
  wall:      string;
  roof:      string;
  sign:      string;   // fascia band + emissive accent
  signText:  string;   // readable label rendered on the fascia
}

const STYLES: Record<string, BuildingStyle> = {
  government_office: { wall: "#c9c4b4", roof: "#8a8576", sign: "#5577ee", signText: "CITY HALL" },
  city_worker_depot: { wall: "#b6893f", roof: "#6e5526", sign: "#e0a93b", signText: "PUBLIC WORKS" },
  medic_center:      { wall: "#e8e8ee", roof: "#c2c6cf", sign: "#e2554e", signText: "MEDICAL CENTER" },
  mechanic_garage:   { wall: "#7d8893", roof: "#525a63", sign: "#e08a2b", signText: "MECHANIC" },
  dealership:        { wall: "#d8dde4", roof: "#9aa3ad", sign: "#3aa0d8", signText: "AUTO SALES" },
};

const DEFAULT_STYLE: BuildingStyle = { wall: "#bcc0c6", roof: "#80858c", sign: "#5577ee", signText: "" };

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

  return (
    <group position={[b.x, 0, b.z]}>
      {/* Walls */}
      {walls.map((w, i) => (
        <mesh key={`w${i}`} position={[w.px, WALL_HEIGHT / 2, w.pz]} castShadow receiveShadow>
          <boxGeometry args={[w.w, WALL_HEIGHT, w.d]} />
          <meshStandardMaterial color={s.wall} roughness={0.78} metalness={0.06} />
        </mesh>
      ))}

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
