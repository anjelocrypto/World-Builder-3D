// =============================================================
// Nemo Gang hood — static neighborhood in the deep south-west forest.
// -------------------------------------------------------------
// CLIENT-ONLY map data (Batch A: geometry + visuals + collision + minimap
// blip only — NO gang membership and NO wallet gating here). This file is the
// SINGLE SOURCE OF TRUTH for the hood's footprint, houses, hangout marker,
// (future) gang spawn point, and the forest-tree clearing rectangle.
//
// Location was chosen by a free-space scan of the real world geometry: a 50×50
// pocket centered (-200, 345) that clears every road, static obstacle, ambient
// car route, homestead, the Grand Plaza Hall, and the Grove Street turf with
// large margins. The only thing there is procedural forest scatter, which is
// suppressed via NEMO_HOOD_CLEARING (added to FOREST_CLEARINGS in cityData.ts,
// the same mechanism the South Forest Village uses).
//
// Coordinate convention: [x, z], +x = east, +z = SOUTH. Ground y = 0.
// =============================================================

import type { StaticObstacle } from "./types";

/** Hood centre (also the gang hangout marker location). */
export const NEMO_HOOD_CENTER: readonly [number, number] = [-200, 345];

/** Square footprint the hood occupies (axis-aligned world bounds). */
export const NEMO_HOOD_BOUNDS = { x0: -225, x1: -175, z0: 320, z1: 370 } as const;

/**
 * Forest-tree keepout for the hood — a little larger than the footprint so the
 * scatter clears a clean margin around the houses. Spread into FOREST_CLEARINGS
 * in cityData.ts so the deterministic forest generator never drops a tree here.
 */
export const NEMO_HOOD_CLEARING = { x0: -230, x1: -170, z0: 315, z1: 375 } as const;

/** Hangout marker — `G`-prompt anchor in Batch B; visual beacon in Batch A. */
export const NEMO_HOOD_HANGOUT_POS: readonly [number, number, number] = [-200, 0, 345];
export const NEMO_HOOD_HANGOUT_RADIUS = 8;

/**
 * Reserved gang spawn point (used only in Batch B, and only for wallet-verified
 * Nemo members — server-authoritative). Defined here so the validator can prove
 * it is clear of every house now. Just south of the hangout, in open ground.
 */
export const NEMO_HOOD_SPAWN: readonly [number, number, number] = [-200, 1, 336];

export interface NemoHoodHouse {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  /** Visual yaw (radians); houses face the central green. Footprint stays the
   *  axis-aligned w×d box, so collision is exact regardless of yaw. */
  rotY: number;
  color: string;
}

// Six small houses ringing the central green, three on the north edge facing
// south and three on the south edge facing north. Inset from NEMO_HOOD_BOUNDS so
// every footprint + a gap stays inside the clearing.
const HOUSE_W = 8;
const HOUSE_D = 7;
const PALETTE = ["#6d4c41", "#5d4037", "#795548", "#4e342e", "#6d4c41", "#5d4037"];
export const NEMO_HOOD_HOUSES: ReadonlyArray<NemoHoodHouse> = [
  { id: "nemo-h1", x: -218, z: 327, w: HOUSE_W, d: HOUSE_D, rotY: Math.PI, color: PALETTE[0] },
  { id: "nemo-h2", x: -200, z: 325, w: HOUSE_W, d: HOUSE_D, rotY: Math.PI, color: PALETTE[1] },
  { id: "nemo-h3", x: -182, z: 327, w: HOUSE_W, d: HOUSE_D, rotY: Math.PI, color: PALETTE[2] },
  { id: "nemo-h4", x: -218, z: 363, w: HOUSE_W, d: HOUSE_D, rotY: 0,       color: PALETTE[3] },
  { id: "nemo-h5", x: -200, z: 365, w: HOUSE_W, d: HOUSE_D, rotY: 0,       color: PALETTE[4] },
  { id: "nemo-h6", x: -182, z: 363, w: HOUSE_W, d: HOUSE_D, rotY: 0,       color: PALETTE[5] },
];

/**
 * Cosmetic neighborhood loop street (a thin ground decal in NemoHood.tsx). NOT
 * part of the road graph and NOT collidable — it just reads as a driveway loop
 * around the green. Closed polyline.
 */
export const NEMO_HOOD_LOOP: ReadonlyArray<readonly [number, number]> = [
  [-212, 337], [-188, 337], [-188, 353], [-212, 353], [-212, 337],
];

/** Street-lamp positions (reuse the existing lamp visual/light pattern). */
export const NEMO_HOOD_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [-212, 337], [-188, 337], [-188, 353], [-212, 353],
];

/**
 * Solid collider AABBs for the houses, fed to a dedicated collision check
 * (playerHitsAnyHoodWall) — same additive pattern as the Event Hall walls.
 * Kept OUT of STATIC_OBSTACLES so no obstacle renderer double-draws them.
 */
export function nemoHoodColliders(): StaticObstacle[] {
  return NEMO_HOOD_HOUSES.map((h) => ({
    x: h.x, z: h.z, w: h.w, d: h.d, kind: "cabin" as const,
  }));
}
