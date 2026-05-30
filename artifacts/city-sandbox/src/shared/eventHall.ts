/**
 * Phase 14A — Grand Plaza Hall (event / conference-concert venue).
 *
 * SINGLE SOURCE OF TRUTH for the hall's geometry. Consumed by:
 *   - EventHall.tsx          (visual shell, stage, screen, chairs, lights)
 *   - collision.ts           (player wall collision via EVENT_HALL_WALL_BOXES)
 *   - LocalPlayer.tsx        (proximity prompt + E interaction)
 *   - eventHallValidator.ts  (startup/dev clearance assertions)
 *   - cityData.ts            (the pedestrian connector spur in REGIONAL_ROADS)
 *
 * Location was chosen by audit (Candidate A): a peri-city event park SE of the
 * city, clear of all roads/buildings/RP/houses/homesteads/rail/cars/spawns by
 * ≥24 m, reached by a short pedestrian path from the inner-ring SE corner.
 *
 * Coordinate conventions match the rest of the world (X east, Z south; the hall
 * "faces north", i.e. its entrance is on the −Z side toward the city).
 */

import type { RpWallBox } from "./rpTypes";

// ── Core footprint ──────────────────────────────────────────────────────────
export const EVENT_HALL = {
  id: "grand_plaza_hall",
  label: "GRAND PLAZA HALL",
  /** Footprint centre. */
  x: 165,
  z: 150,
  /** Footprint size: 55 m wide (X) × 38 m deep (Z). */
  w: 55,
  d: 38,
  /** Entrance is on the −Z (north / city-facing) wall. */
  facing: "north" as const,
  wallHeight: 9,
  wallThickness: 0.6,
  /** Width of the open doorway gap in the north wall (wide public doors). */
  entranceGapWidth: 12,
  /** Apron clearances used by the validator (front larger than sides/back). */
  apronFront: 10,
  apronSide: 6,
  // ── Interaction anchors (world XZ) ──
  /** Just outside the north doorway, on the approach apron. */
  entrance: [165, 129] as [number, number],
  /** In front of the giant screen on the south wall. */
  screen: [165, 166] as [number, number],
  /** Stage platform centre (raised), in front of the screen. */
  stage: [165, 163] as [number, number],
  /** Player within this distance of the screen sees the "E — Open Event Screen" prompt. */
  interactRadius: 14,
} as const;

/** Footprint extents [xMin, xMax, zMin, zMax]. */
export const EVENT_HALL_EXTENTS = {
  xMin: EVENT_HALL.x - EVENT_HALL.w / 2, // 137.5
  xMax: EVENT_HALL.x + EVENT_HALL.w / 2, // 192.5
  zMin: EVENT_HALL.z - EVENT_HALL.d / 2, // 131
  zMax: EVENT_HALL.z + EVENT_HALL.d / 2, // 169
} as const;

// ── Wall colliders (player-only) ────────────────────────────────────────────
// Four shell walls; the north wall is split into two jambs flanking the open
// entrance gap (no collider in the gap, so the doorway stays walkable). Mirrors
// the RP-building wall-box pattern. Vehicles are unaffected (player-only), and
// the hall sits ≥24 m off any carriageway so driving is never blocked.
export const EVENT_HALL_WALL_BOXES: ReadonlyArray<RpWallBox> = (() => {
  const t = EVENT_HALL.wallThickness;
  const hw = EVENT_HALL.w / 2;
  const hd = EVENT_HALL.d / 2;
  const cx = EVENT_HALL.x;
  const cz = EVENT_HALL.z;
  const zFront = cz - hd; // north / entrance side
  const zBack = cz + hd;  // south / stage side
  const xWest = cx - hw;
  const xEast = cx + hw;
  const gap = EVENT_HALL.entranceGapWidth;
  const jamb = (EVENT_HALL.w - gap) / 2; // 21.5
  return [
    { x: cx, z: zBack, w: EVENT_HALL.w, d: t },                       // south (back) wall — full
    { x: xWest, z: cz, w: t, d: EVENT_HALL.d },                        // west wall
    { x: xEast, z: cz, w: t, d: EVENT_HALL.d },                        // east wall
    { x: cx - (gap / 2 + jamb / 2), z: zFront, w: jamb, d: t },        // north wall — left jamb
    { x: cx + (gap / 2 + jamb / 2), z: zFront, w: jamb, d: t },        // north wall — right jamb
  ];
})();

// ── Chair seating layout ────────────────────────────────────────────────────
// Rows run along X (seats side by side); rows step back along Z. All seats face
// the screen at the south (+Z) end. A central aisle aligns with the entrance,
// and the block is inset from the side walls leaving side aisles. Returns world
// XZ centres — used by EventHall.tsx (InstancedMesh) and the validator
// (inside-footprint assertion). All seats face +Z (toward the screen).
const CHAIR_LAYOUT = {
  rowZStart: 137,
  rowZEnd: 156,
  rowSpacing: 2.3,
  seatXMin: 142,
  seatXMax: 188,
  seatSpacing: 1.5,
  centerAisleX: 165,
  centerAisleHalf: 3,
} as const;

export function eventHallChairPositions(): [number, number][] {
  const c = CHAIR_LAYOUT;
  const out: [number, number][] = [];
  for (let z = c.rowZStart; z <= c.rowZEnd + 1e-6; z += c.rowSpacing) {
    for (let x = c.seatXMin; x <= c.seatXMax + 1e-6; x += c.seatSpacing) {
      if (Math.abs(x - c.centerAisleX) < c.centerAisleHalf) continue; // center aisle gap
      out.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
    }
  }
  return out;
}

// ── Pedestrian connector spur ───────────────────────────────────────────────
// A short dirt walkway from the inner-city-ring SE corner node (100,100) up to
// the hall entrance apron. points[0] is an existing ring graph node, so the
// road-graph validator sees it as a connected spur (like the homestead
// driveways). Added to REGIONAL_ROADS in cityData.ts.
export const EVENT_HALL_CONNECTOR: ReadonlyArray<[number, number]> = [
  [100, 100],
  [130, 116],
  [160, 128],
];
export const EVENT_HALL_CONNECTOR_WIDTH = 5;
