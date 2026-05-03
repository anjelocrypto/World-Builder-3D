// =============================================================
// Mountain road elevation system
// =============================================================
//
// REGIONAL_ROADS store polylines purely in the X/Z plane. To make the
// mountain ring drivable (cars climbing visible peaks, road quads
// rendered at the right altitude, lamps/parked cars sitting on the
// surface) we keep an OPTIONAL parallel "elevation profile" per road in
// `ROAD_ELEVATION_PROFILES` (see cityData.ts) — one Y value per vertex,
// linearly interpolated along each segment.
//
// Roads not listed in `ROAD_ELEVATION_PROFILES` (i.e. every flat-land
// asphalt/forest/dirt/bridge road) implicitly sit at y=0 and the
// helpers in this module return 0 for them. This keeps the bulk of the
// world untouched while letting the few mountain roads climb.
//
// Performance: `getRoadElevationAt` is called once per frame per
// drivable car (~20 ambient + 1 player) and once per regional lamp at
// renderer init. We bail early when the query is outside mountain
// country (z > -150) and only iterate the small mountain-road list.

import { REGIONAL_ROADS, ROAD_ELEVATION_PROFILES, MOUNTAIN_ROAD_IDS } from "./cityData";
import type { RoadPath } from "./types";

// Lazily collected list of mountain RoadPath objects so we don't filter
// REGIONAL_ROADS on every call. Refreshed on first use; module-load
// order means cityData.ts has finished initialising by then.
let _mountainRoadsCache: RoadPath[] | null = null;
function mountainRoads(): RoadPath[] {
  if (_mountainRoadsCache !== null) return _mountainRoadsCache;
  _mountainRoadsCache = REGIONAL_ROADS.filter((r) => MOUNTAIN_ROAD_IDS.has(r.id));
  return _mountainRoadsCache;
}

export function isMountainRoadId(id: string): boolean {
  return MOUNTAIN_ROAD_IDS.has(id);
}

// Project (x,z) onto each segment of `road`, returning the
// 2D-distance-minimising surface Y (lerped from the road's profile)
// and the perpendicular distance from the road centerline.
function projectOntoRoad(
  road: RoadPath,
  x: number,
  z: number,
): { y: number; dist: number } {
  const profile = ROAD_ELEVATION_PROFILES[road.id];
  if (!profile || profile.length !== road.points.length) {
    return { y: 0, dist: Infinity };
  }
  let bestDist = Infinity;
  let bestY = 0;
  for (let i = 0; i < road.points.length - 1; i++) {
    const [ax, az] = road.points[i];
    const [bx, bz] = road.points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const seg2 = dx * dx + dz * dz;
    if (seg2 < 1e-6) continue;
    let t = ((x - ax) * dx + (z - az) * dz) / seg2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = ax + t * dx;
    const pz = az + t * dz;
    const ex = x - px;
    const ez = z - pz;
    const d = Math.hypot(ex, ez);
    if (d < bestDist) {
      bestDist = d;
      bestY = profile[i] + (profile[i + 1] - profile[i]) * t;
    }
  }
  return { y: bestY, dist: bestDist };
}

// Returns the surface Y of the nearest mountain road at (x, z),
// blended smoothly down to 0 over a `BLEND_OUT` shoulder. Outside the
// mountain country (z > -150) returns 0 immediately.
const ELEV_BLEND_OUT = 8.0;

export function getRoadElevationAt(x: number, z: number): number {
  if (z > -150) return 0;
  let bestY = 0;
  let bestDist = Infinity;
  let bestRoad: RoadPath | null = null;
  for (const r of mountainRoads()) {
    const { y, dist } = projectOntoRoad(r, x, z);
    if (dist < bestDist) {
      bestDist = dist;
      bestY = y;
      bestRoad = r;
    }
  }
  if (!bestRoad) return 0;
  const hw = bestRoad.width / 2;
  if (bestDist <= hw) return bestY;
  if (bestDist >= hw + ELEV_BLEND_OUT) return 0;
  const t = (bestDist - hw) / ELEV_BLEND_OUT;
  // Smoothstep so the road surface tapers gently into the ground
  // instead of forming a visible cliff at exactly halfWidth.
  const s = 1 - t * t * (3 - 2 * t);
  return bestY * s;
}

// Convenience wrapper used by vehicle code so the call site is
// self-documenting and we have a single place to evolve the math
// (suspension dip, tyre radius, etc.) in the future.
export function getVehicleGroundY(x: number, z: number): number {
  return getRoadElevationAt(x, z);
}

// Maximum |dy/dh| across every segment of every mountain road —
// surfaced for the validator's grade check.
export function maxMountainGrade(): number {
  let max = 0;
  for (const r of mountainRoads()) {
    const profile = ROAD_ELEVATION_PROFILES[r.id];
    if (!profile || profile.length !== r.points.length) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const dh = Math.hypot(bx - ax, bz - az);
      if (dh < 1e-3) continue;
      const grade = Math.abs(profile[i + 1] - profile[i]) / dh;
      if (grade > max) max = grade;
    }
  }
  return max;
}
