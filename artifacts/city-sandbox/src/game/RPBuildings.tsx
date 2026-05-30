/**
 * Phase 9A Batch C (+ signage/detail polish): RPBuildings — readable low-poly
 * shells for the civic RP locations. Renders all 9 verified entries in the
 * mirrored RP_BUILDINGS table (City Hall, Public Works Depot, Medical Center,
 * Mechanic Garage, Dealership, Taxi Depot, Delivery Hub, DMV/Licensing Office,
 * Police Station). Geometry is read straight from that table so it can never
 * drift from the server footprint validator (validateRpBuildings).
 *
 * VISUAL-ONLY:
 *   - No collision/physics changes, no new interaction, no coordinate moves,
 *     no door/desk/interaction-ring changes. All added meshes are decorative
 *     and never enter playerHitsAnyRpWall or any gameplay gate.
 *   - The existing marker rings in RPMarkers.tsx stay; these buildings sit
 *     around/behind them as the actual "place".
 *
 * Each building is a four-wall shell with a flat roof and an open doorway on
 * its `facing` side, plus a readable front banner (sign board + dark backing
 * panel + 1–2 lines of dynamically-sized text mounted CLEARLY below the roof
 * and above the door), a door frame + awning, front window panels, and a small
 * service-specific accent (police light bar, medical cross, DMV plaque, City
 * Hall columns, …). Walls are four thin boxes so the doorway reads as a real
 * opening and the lobby is hollow. Kept deliberately low-poly for performance.
 */

import { Text } from "@react-three/drei";
import type { RpBuildingDef, RpBuildingFacing } from "../shared/rpTypes";
import { RP_BUILDINGS, RP_INTERIOR_BUILDING_IDS } from "../shared/rpTypes";

// ── Per-building visual identity (color + signage + detail; geometry from table) ──

type DetailType =
  | "police" | "medical" | "dmv" | "cityhall"
  | "taxi" | "delivery" | "mechanic" | "dealer" | "works";

interface BuildingStyle {
  wall:      string;
  roof:      string;
  sign:      string;          // sign-board face + emissive accent
  signText:  string;          // single-line label (used when signLines is absent)
  signLines?: string[];       // optional explicit multi-line label (overrides signText)
  accent?:   string;          // service accent color (defaults to sign)
  detailType?: DetailType;    // chooses the small front accent mesh
  floor?:    string;          // Phase 10A: interior lobby floor (walk-in buildings only)
}

const STYLES: Record<string, BuildingStyle> = {
  government_office: { wall: "#c9c4b4", roof: "#8a8576", sign: "#5577ee", signText: "CITY HALL", accent: "#d9b441", detailType: "cityhall", floor: "#3b4252" },
  city_worker_depot: { wall: "#b6893f", roof: "#6e5526", sign: "#e0a93b", signText: "PUBLIC WORKS", accent: "#f0c14b", detailType: "works" },
  medic_center:      { wall: "#e8e8ee", roof: "#c2c6cf", sign: "#e2554e", signText: "MEDICAL CENTER", accent: "#e2554e", detailType: "medical", floor: "#dfe6ea" },
  mechanic_garage:   { wall: "#7d8893", roof: "#525a63", sign: "#e08a2b", signText: "MECHANIC", accent: "#e08a2b", detailType: "mechanic" },
  dealership:        { wall: "#d8dde4", roof: "#9aa3ad", sign: "#3aa0d8", signText: "AUTO SALES", accent: "#3aa0d8", detailType: "dealer" },
  taxi_depot:        { wall: "#d8c24a", roof: "#8a7c2e", sign: "#f1c40f", signText: "TAXI DEPOT", accent: "#f1c40f", detailType: "taxi" },
  delivery_hub:      { wall: "#9c8a6a", roof: "#5a4a36", sign: "#cf7a33", signText: "DELIVERY HUB", accent: "#cf7a33", detailType: "delivery" },
  licensing_office:  { wall: "#cfd6dc", roof: "#8b94a0", sign: "#3f7fbf", signText: "DMV", signLines: ["DMV", "AUTO SCHOOL"], accent: "#3f7fbf", detailType: "dmv", floor: "#41484f" },
  police_station:    { wall: "#b9c2cc", roof: "#3a4654", sign: "#2f6fd0", signText: "POLICE", accent: "#2f6fd0", detailType: "police", floor: "#2b333d" },
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

// ── Signage band placement ───────────────────────────────────────────────────
// The OLD fascia sat at WALL_HEIGHT + ROOF_THICKNESS/2 (= roof centre), so the
// sign, its text, and the roof slab (which also overhangs +0.4m outward) all
// shared one vertical band → the label was clipped/occluded by the roof. The
// banner now sits clearly BELOW the roof and ABOVE the door header.
const SIGN_BOARD_H    = 1.5;                 // m — taller, readable sign board
const SIGN_CENTER_Y   = WALL_HEIGHT - 0.95;  // = 5.05 → board spans 4.30–5.80,
                                             //   under the roof base (6.0) and
                                             //   above the door header (3.6).
const SIGN_FACE_OUT   = 0.18;  // m — how far the board sits proud of the wall.

// Axis the entrance faces sits on: north/south → front wall is on ±Z,
// east/west → front wall is on ±X.
function isFacingZ(f: RpBuildingFacing): boolean {
  return f === "north" || f === "south";
}

/**
 * Map a position given in the building's CANONICAL FRONT-FACE local frame onto
 * world-local coordinates for a given facing. In the canonical frame:
 *   +out  = outward from the front wall (toward the street)
 *   +lat  = left↔right ALONG the front wall
 *   y     = height (unchanged)
 * For south the front wall is +Z, north −Z, east +X, west −X. This lets every
 * decorative front mesh be authored once (door trim, awning, windows, accents,
 * sign) and placed correctly for all four facings without per-building hacks.
 */
function frontPoint(
  b: RpBuildingDef,
  out: number,
  lat: number,
  y: number,
): [number, number, number] {
  const halfW = b.w / 2;
  const halfD = b.d / 2;
  switch (b.facing) {
    case "south": return [lat, y, halfD + out];
    case "north": return [-lat, y, -halfD - out];
    case "east":  return [halfW + out, y, -lat];
    case "west":  return [-halfW - out, y, lat];
  }
}

/** Rotation.y so a flat/box mesh's local +Z faces outward along the front wall. */
function frontRotationY(f: RpBuildingFacing): number {
  switch (f) {
    case "south": return 0;
    case "north": return Math.PI;
    case "east":  return Math.PI / 2;
    case "west":  return -Math.PI / 2;
  }
}

/** A box sized in the canonical front frame → [worldW, h, worldD] for a facing.
 *  `lat` spans along the wall, `thick` is the outward depth. */
function frontBoxArgs(
  f: RpBuildingFacing,
  lat: number,
  h: number,
  thick: number,
): [number, number, number] {
  return isFacingZ(f) ? [lat, h, thick] : [thick, h, lat];
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

  // ── Front banner: sign board + dark backing panel + dynamic 1–2 line text ──
  // Sits below the roof, above the door header. Width tracks the front-wall
  // length so long labels have room; text is sized to fit that width.
  const frontLen = facingZ ? b.w : b.d;          // length of the front wall
  const signLat = Math.min(frontLen - 1.0, 13);  // sign board length along wall
  const signLines = s.signLines ?? (s.signText ? [s.signText] : []);
  // Dynamic font size: fit the longest line into the board width, but also cap
  // by line count so two lines stack inside SIGN_BOARD_H. ~0.62 = avg glyph
  // advance / fontSize for this font; clamp to a readable range.
  const longest = signLines.reduce((m, l) => Math.max(m, l.length), 0);
  const widthFont = longest > 0 ? (signLat - 0.8) / (longest * 0.62) : 1;
  const heightFont = signLines.length >= 2 ? 0.62 : 1.05;
  const fontSize = Math.max(0.55, Math.min(1.05, widthFont, heightFont));
  const lineGap = fontSize * 1.18;

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

      {/* ── Front banner: emissive accent board + dark backing + label ── */}
      {signLines.length > 0 && (
        <group>
          {/* Colored sign board (the accent strip) */}
          <mesh position={frontPoint(b, SIGN_FACE_OUT, 0, SIGN_CENTER_Y)} rotation={[0, frontRotationY(b.facing), 0]}>
            <boxGeometry args={frontBoxArgs(b.facing, signLat, SIGN_BOARD_H, 0.3)} />
            <meshStandardMaterial color={s.sign} emissive={s.sign} emissiveIntensity={0.6} roughness={0.4} />
          </mesh>
          {/* Dark backing panel for text contrast, a hair proud of the board */}
          <mesh position={frontPoint(b, SIGN_FACE_OUT + 0.16, 0, SIGN_CENTER_Y)} rotation={[0, frontRotationY(b.facing), 0]}>
            <boxGeometry args={frontBoxArgs(b.facing, signLat - 0.5, SIGN_BOARD_H - 0.45, 0.06)} />
            <meshStandardMaterial color="#15171c" roughness={0.6} metalness={0.1} />
          </mesh>
          {/* Dynamically-sized label, 1–2 lines, mounted in front of the panel.
              renderOrder + depthOffset keep it from z-fighting the board/wall. */}
          {signLines.map((line, li) => {
            const yOff = signLines.length === 2 ? (li === 0 ? lineGap / 2 : -lineGap / 2) : 0;
            return (
              <Text
                key={li}
                position={frontPoint(b, SIGN_FACE_OUT + 0.26, 0, SIGN_CENTER_Y + yOff)}
                rotation={[0, frontRotationY(b.facing), 0]}
                fontSize={fontSize}
                color="#ffffff"
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.045}
                outlineColor="#000000"
                renderOrder={2}
                maxWidth={signLat - 0.5}
              >
                {line}
              </Text>
            );
          })}
        </group>
      )}

      {/* ── Door frame trim (two posts + header bar), a hair proud of wall ── */}
      {[-1, 1].map((sd) => (
        <mesh
          key={`dpost${sd}`}
          position={frontPoint(b, 0.08, sd * (DOOR_WIDTH / 2 + 0.12), DOOR_HEIGHT / 2)}
          rotation={[0, frontRotationY(b.facing), 0]}
        >
          <boxGeometry args={frontBoxArgs(b.facing, 0.24, DOOR_HEIGHT + 0.2, 0.18)} />
          <meshStandardMaterial color={s.accent ?? s.sign} roughness={0.5} metalness={0.15} />
        </mesh>
      ))}
      <mesh
        position={frontPoint(b, 0.08, 0, DOOR_HEIGHT + 0.1)}
        rotation={[0, frontRotationY(b.facing), 0]}
      >
        <boxGeometry args={frontBoxArgs(b.facing, DOOR_WIDTH + 0.48, 0.24, 0.18)} />
        <meshStandardMaterial color={s.accent ?? s.sign} roughness={0.5} metalness={0.15} />
      </mesh>

      {/* ── Awning / canopy above the door (sloped slab) ── */}
      <mesh
        position={frontPoint(b, 0.85, 0, DOOR_HEIGHT + 0.5)}
        rotation={[0, frontRotationY(b.facing), 0]}
      >
        <boxGeometry args={frontBoxArgs(b.facing, DOOR_WIDTH + 1.4, 0.16, 1.7)} />
        <meshStandardMaterial color={s.roof} roughness={0.7} metalness={0.08} />
      </mesh>

      {/* ── Front window panels flanking the door ── */}
      {[-1, 1].map((sd) => (
        <mesh
          key={`fwin${sd}`}
          position={frontPoint(b, 0.06, sd * (DOOR_WIDTH / 2 + 1.7), WALL_HEIGHT * 0.42)}
          rotation={[0, frontRotationY(b.facing), 0]}
        >
          <boxGeometry args={frontBoxArgs(b.facing, Math.min(2.2, frontLen * 0.2), 1.6, 0.08)} />
          <meshStandardMaterial color="#bfe6ff" emissive="#9fd4ff" emissiveIntensity={0.4} roughness={0.25} metalness={0.1} />
        </mesh>
      ))}

      {/* ── Service-specific accent ── */}
      <FrontAccent b={b} s={s} />

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

/** Small low-poly service accent above/around the entrance, chosen by
 *  detailType. Visual-only; all placed via the canonical front-frame helper. */
function FrontAccent({ b, s }: { b: RpBuildingDef; s: BuildingStyle }) {
  const accent = s.accent ?? s.sign;
  const ry = frontRotationY(b.facing);
  switch (s.detailType) {
    case "police":
      // Blue + red light bar above the awning.
      return (
        <group>
          {[-0.45, 0.45].map((lat, i) => (
            <mesh key={i} position={frontPoint(b, 1.0, lat, DOOR_HEIGHT + 1.05)} rotation={[0, ry, 0]}>
              <boxGeometry args={frontBoxArgs(b.facing, 0.8, 0.3, 0.3)} />
              <meshStandardMaterial
                color={i === 0 ? "#2f6fd0" : "#e23b3b"}
                emissive={i === 0 ? "#2f6fd0" : "#e23b3b"}
                emissiveIntensity={1.1}
                roughness={0.3}
              />
            </mesh>
          ))}
        </group>
      );
    case "medical": {
      // Red cross plaque (two crossed bars) above the door.
      const y = DOOR_HEIGHT + 1.3;
      return (
        <group>
          <mesh position={frontPoint(b, 0.16, 0, y)} rotation={[0, ry, 0]}>
            <boxGeometry args={frontBoxArgs(b.facing, 0.9, 0.3, 0.12)} />
            <meshStandardMaterial color="#e2554e" emissive="#e2554e" emissiveIntensity={0.9} roughness={0.35} />
          </mesh>
          <mesh position={frontPoint(b, 0.16, 0, y)} rotation={[0, ry, 0]}>
            <boxGeometry args={frontBoxArgs(b.facing, 0.3, 0.9, 0.12)} />
            <meshStandardMaterial color="#e2554e" emissive="#e2554e" emissiveIntensity={0.9} roughness={0.35} />
          </mesh>
        </group>
      );
    }
    case "dmv":
      // Blue/white service plaque beside the door.
      return (
        <mesh position={frontPoint(b, 0.14, DOOR_WIDTH / 2 + 2.9, WALL_HEIGHT * 0.42)} rotation={[0, ry, 0]}>
          <boxGeometry args={frontBoxArgs(b.facing, 1.3, 1.0, 0.1)} />
          <meshStandardMaterial color="#ffffff" emissive={accent} emissiveIntensity={0.4} roughness={0.4} />
        </mesh>
      );
    case "cityhall":
      // Two civic columns flanking the entrance + gold lintel cap.
      return (
        <group>
          {[-1, 1].map((sd) => (
            <mesh key={sd} position={frontPoint(b, 0.55, sd * (DOOR_WIDTH / 2 + 1.0), WALL_HEIGHT * 0.45)} rotation={[0, ry, 0]} castShadow>
              <cylinderGeometry args={[0.32, 0.36, WALL_HEIGHT * 0.9, 10]} />
              <meshStandardMaterial color="#e8e3d2" roughness={0.7} metalness={0.05} />
            </mesh>
          ))}
          <mesh position={frontPoint(b, 0.55, 0, WALL_HEIGHT * 0.9)} rotation={[0, ry, 0]}>
            <boxGeometry args={frontBoxArgs(b.facing, DOOR_WIDTH + 2.4, 0.3, 0.4)} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.4} roughness={0.4} metalness={0.3} />
          </mesh>
        </group>
      );
    case "taxi":
    case "delivery":
    case "mechanic":
    case "dealer":
    case "works":
      // Generic matching accent panel above the door.
      return (
        <mesh position={frontPoint(b, 0.14, 0, DOOR_HEIGHT + 1.25)} rotation={[0, ry, 0]}>
          <boxGeometry args={frontBoxArgs(b.facing, 2.2, 0.5, 0.1)} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} roughness={0.4} />
        </mesh>
      );
    default:
      return null;
  }
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
