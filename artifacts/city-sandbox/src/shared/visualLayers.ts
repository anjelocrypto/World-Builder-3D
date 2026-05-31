// =============================================================
// Visual layer Y-offsets — single source of truth for every large flat
// ground / road / decal plane, to PREVENT z-fighting (the flickering
// patches seen on the ground and at distance while moving).
// -------------------------------------------------------------
// Why this file exists:
//   The world camera runs near:0.5 far:1500. Depth precision degrades with
//   distance, so two near-coplanar planes only ~0.001–0.002 m apart (the old
//   full-world ground at y=0, biome tints at y=0.001, transition strips at
//   y=0.0015) cannot be resolved at 200–500 m and flicker. The fix is a small
//   number of named layers with COMFORTABLE vertical gaps:
//     - >= ~0.04 between the big far ground planes (base / biome),
//     - >= ~0.02 between the closer road / marking / decal planes.
//
// Design rules:
//   - Visible TOP surfaces stay within a few cm of y=0 so entities (placed by
//     terrainHeightAt ≈ 0) never visibly float. The base ground sits a little
//     below because it is hidden under biome tints / roads where they exist.
//   - Opaque layers rely on these physical gaps.
//   - Transparent decals (crosswalks, parking, RP rings, car contact shadows)
//     additionally use depthWrite:false (+ polygonOffset where needed) so they
//     blend on top without fighting.
//   - Lower numbers are deeper. Never reintroduce 0.001/0.0015-scale offsets.
//
// VISUAL-ONLY: these are render Y offsets. They do not affect collision,
// terrainHeightAt, coordinates, routes, or where entities stand.
// =============================================================

/** Full-world base ground plane (CityMap). Hidden under biome tints / roads
 *  where those exist; visible in the city between roads. */
export const GROUND_BASE_Y = -0.06;

/** Mountain heightfield flat baseline (BiomeRender). Sits just below the biome
 *  tints so the flat edges where they meet don't z-fight. */
export const MOUNTAIN_TERRAIN_Y = -0.04;

/** Biome recolor planes — forest / east / west (BiomeRender). Above the base
 *  ground, well below road surfaces so they never cover roads. */
export const BIOME_TINT_Y = -0.02;

/** Biome→city transition strips (BiomeRender). Just above the biome tints,
 *  still below road surfaces. */
export const BIOME_SEAM_Y = -0.005;

/** Road carriageway surface lift (city grid + regional roads). */
export const ROAD_SURFACE_Y = 0.02;

/** Lane paint / crosswalks / bridge lane stripes — above the road surface. */
export const ROAD_MARKING_Y = 0.04;

/** Ground decals: RP marker rings, parking-spot quads, car contact shadows.
 *  Above markings; transparent decals here also set depthWrite:false. */
export const DECAL_Y = 0.06;
