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

// ── Raised stage (Phase 14D) ────────────────────────────────────────────────
// A solid raised platform at the south end. Its SIDES block walk-in from the
// floor; its TOP is a standable surface you reach by jumping. Base sits at y=0,
// so topY === h. Rendered from these constants by EventHall.tsx.
export const EVENT_HALL_STAGE = {
  x: EVENT_HALL.stage[0],
  z: EVENT_HALL.stage[1],
  w: 32,
  d: 9,
  h: 1,
  /** Top standable surface height (= h, base at y=0). */
  topY: 1,
  /** Feet at/above this height may pass the sides (jumped on / already on top);
   *  below it, the sides block walk-in from the floor. */
  mountFeetY: 0.82,
} as const;

/** True if (px,pz) is within the stage footprint, optionally expanded by margin. */
export function isInsideEventHallStage(px: number, pz: number, margin = 0): boolean {
  return (
    Math.abs(px - EVENT_HALL_STAGE.x) <= EVENT_HALL_STAGE.w / 2 + margin &&
    Math.abs(pz - EVENT_HALL_STAGE.z) <= EVENT_HALL_STAGE.d / 2 + margin
  );
}

// ── Chair colliders + sit anchors (Phase 14C) ───────────────────────────────
// Each chair is a small solid AABB so players can't walk through the seating.
// CHAIR_BOX_HALF roughly matches the rendered seat (0.9×0.9) minus the player
// body radius so a player can stand right up against a chair before sitting.
// Chair proportions, sized for the 1.2 m Simple character — normal
// conference/audience chairs. SINGLE SOURCE OF TRUTH: EventHall.tsx renders
// from these, the collider derives from them, and the sit pose is tuned to fit.
// Geometry order in three is [width(X), height(Y), depth(Z)].
export const EVENT_HALL_CHAIR = {
  // Seat pad
  seatW: 0.62,
  seatH: 0.10,
  seatD: 0.58,
  seatY: 0.38,          // seat-pad centre height (top ≈ 0.43)
  // Backrest
  backW: 0.62,
  backH: 0.56,
  backD: 0.10,
  backY: 0.70,          // backrest centre height (top ≈ 0.98)
  backZOffset: -0.36,   // behind the sitter (−Z, the seat's back edge)
  // Collider half-extents — deliberately SMALLER than the visual seat so the
  // chairs block walking without being huge invisible boxes.
  colliderHalfX: 0.32,
  colliderHalfZ: 0.30,
} as const;

export const EVENT_HALL_CHAIR_BOXES: ReadonlyArray<{ x: number; z: number; hw: number; hd: number }> =
  eventHallChairPositions().map(([x, z]) => ({
    x, z, hw: EVENT_HALL_CHAIR.colliderHalfX, hd: EVENT_HALL_CHAIR.colliderHalfZ,
  }));

/**
 * Sitting parameters (Phase 14C). Tunable in ONE place so the seated pose can be
 * nudged to "exactly fit" the chair without hunting through the player code:
 *   - radius:     how close (m) to a chair the player must be to get the prompt.
 *   - yOffset:    vertical nudge (m) applied to the seated avatar root so the
 *                 hips rest on the seat pad (raise if floating, lower if sunk).
 *   - forward:    +Z nudge (m) onto the seat (toward the screen) if the sit pose
 *                 sits slightly forward/back of the chair centre.
 *   - lateral:    X nudge (m) to centre the sit pose on the seat. +X moves the
 *                 seated avatar to the viewer's LEFT when looking at its front
 *                 (the seated player faces +Z). Flip the sign if it drifts the
 *                 wrong way.
 *   - faceY:      avatar rotation.y while seated. 0 faces +Z (the screen). Add
 *                 Math.PI if the sit clip ends up facing away from the screen.
 *   - standBackZ: how far north (−Z, toward the entrance/aisle gap) to place the
 *                 player when they stand up, so they don't stand inside the chair.
 */
export const EVENT_HALL_SIT = {
  radius: 1.7,
  yOffset: 0.0,
  forward: 0.36,
  lateral: 0.12,
  faceY: 0.0,
  standBackZ: 1.1,
} as const;

// Positions are static — compute once, reuse every frame (no per-frame alloc).
const CHAIR_POSITIONS: ReadonlyArray<readonly [number, number]> = eventHallChairPositions();

/** Nearest chair to (px,pz) within `radius`, or null. Returns the seat XZ. */
export function nearestEventHallChair(px: number, pz: number): { x: number; z: number; index: number } | null {
  // Cheap early-out: skip the chair scan unless the player is inside the hall.
  if (
    px < EVENT_HALL_EXTENTS.xMin - 2 || px > EVENT_HALL_EXTENTS.xMax + 2 ||
    pz < EVENT_HALL_EXTENTS.zMin - 2 || pz > EVENT_HALL_EXTENTS.zMax + 2
  ) {
    return null;
  }
  let best: { x: number; z: number; index: number } | null = null;
  let bestD2 = EVENT_HALL_SIT.radius * EVENT_HALL_SIT.radius;
  for (let i = 0; i < CHAIR_POSITIONS.length; i++) {
    const [x, z] = CHAIR_POSITIONS[i];
    const dx = px - x;
    const dz = pz - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = { x, z, index: i }; }
  }
  return best;
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
