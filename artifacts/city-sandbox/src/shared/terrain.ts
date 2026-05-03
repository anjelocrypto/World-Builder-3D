// =============================================================
// Mountain terrain — single source of truth for ground height
// =============================================================
//
// `terrainHeightAt(x, z)` is the ONE function that decides where the
// ground sits in the mountain ring. Every consumer must funnel through
// it so road quads, the heightfield mesh, lamps, parked cars, ambient
// traffic, the player on foot, and the player's vehicle all agree on
// the same Y at any (x, z).
//
// The height is the maximum of two contributions:
//   1) ROAD SUPPORT — for each mountain road we project (x, z) onto
//      the polyline, lerp the elevation profile between the segment
//      endpoints, and smoothly skirt down to 0 over a wide blend
//      shoulder. This guarantees the visible terrain "wraps" the road
//      so cars never appear to fly above flat ground.
//   2) MASSIF DOMES — each MOUNTAIN_MASSIF entry contributes a smooth
//      cosine-like dome of radius m.r and peak m.h. Multiple massifs
//      blend via max() so a chain of overlapping domes reads as one
//      continuous ridge instead of isolated pyramids.
//
// Both contributions are deterministic and pure (no time/noise) so the
// heightfield mesh, every renderer sample, and the validator all see
// the exact same value.
//
// Performance: mountainRoads() is cached lazily; the heightfield mesh
// builds ~40k vertices once at mount (~50ms); per-frame consumers
// (player + ~22 ambient cars + obstacle/lamp init) run a tiny amount
// of work.
//
// IMPORTANT — circular-import note: shared/terrain.ts imports from
// shared/cityData.ts (REGIONAL_ROADS, MOUNTAIN_MASSIFS, etc.) but
// cityData.ts MUST NOT import from terrain.ts. The mountainRing
// validator inlines the same math instead.

import {
  REGIONAL_ROADS,
  ROAD_ELEVATION_PROFILES,
  MOUNTAIN_ROAD_IDS,
  MOUNTAIN_MASSIFS,
} from "./cityData";
import type { RoadPath } from "./types";

// Width of the smooth skirt (in metres) the road support function
// fades to 0 over, measured from the road carriageway edge. A wider
// skirt makes the road sit on a broader visible "ramp" so the
// transition from elevated road to surrounding terrain looks like a
// natural slope rather than a cliff.
const ROAD_SKIRT = 30.0;

function smoothstep01(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

// Lazily collected mountain RoadPath list — we don't filter
// REGIONAL_ROADS on every call. Refreshed on first use; module-load
// order means cityData.ts has finished initialising by then.
let _mountainRoadsCache: RoadPath[] | null = null;
function mountainRoads(): RoadPath[] {
  if (_mountainRoadsCache !== null) return _mountainRoadsCache;
  _mountainRoadsCache = REGIONAL_ROADS.filter((r) => MOUNTAIN_ROAD_IDS.has(r.id));
  return _mountainRoadsCache;
}

// Road-support contribution at (x, z). Returns 0 if no mountain road
// is within (halfWidth + ROAD_SKIRT) of the query.
function roadSupportAt(x: number, z: number): number {
  let best = 0;
  for (const r of mountainRoads()) {
    const profile = ROAD_ELEVATION_PROFILES[r.id];
    if (!profile || profile.length !== r.points.length) continue;
    const halfW = r.width * 0.5;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const seg2 = dx * dx + dz * dz;
      if (seg2 < 1e-6) continue;
      let t = ((x - ax) * dx + (z - az) * dz) / seg2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = ax + t * dx;
      const pz = az + t * dz;
      const d = Math.hypot(x - px, z - pz);
      if (d >= halfW + ROAD_SKIRT) continue;
      const y = profile[i] + (profile[i + 1] - profile[i]) * t;
      if (d <= halfW) {
        if (y > best) best = y;
      } else {
        // smoothstep skirt from the carriageway edge out to ROAD_SKIRT
        const u = 1 - (d - halfW) / ROAD_SKIRT;
        const yScaled = y * smoothstep01(u);
        if (yScaled > best) best = yScaled;
      }
    }
  }
  return best;
}

// Massif-dome contribution at (x, z). Returns 0 if no massif dome
// covers this point. Multiple overlapping domes blend via max() so a
// chain of massifs forms a continuous ridge silhouette.
function massifDomeAt(x: number, z: number): number {
  let best = 0;
  for (const m of MOUNTAIN_MASSIFS) {
    const dx = x - m.x;
    const dz = z - m.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= m.r * m.r) continue;
    const d = Math.sqrt(d2);
    const u = 1 - d / m.r;
    const h = m.h * smoothstep01(u);
    if (h > best) best = h;
  }
  return best;
}

// SINGLE SOURCE OF TRUTH for ground height at (x, z). Combines road
// support and massif domes. Used by:
//   - MountainTerrain heightfield mesh (per-vertex displacement)
//   - getRoadElevationAt / getVehicleGroundY (consumed by player car,
//     player on foot, ambient cars, lamps, mountain obstacles)
//   - mountainRing validator (terrain↔road consistency check)
export function terrainHeightAt(x: number, z: number): number {
  const r = roadSupportAt(x, z);
  const d = massifDomeAt(x, z);
  return r > d ? r : d;
}
