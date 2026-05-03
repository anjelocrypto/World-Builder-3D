// =============================================================
// Mountain road elevation helpers (thin facade over terrain.ts)
// =============================================================
//
// All ground-height queries route through `terrainHeightAt` in
// shared/terrain.ts so renderers, physics, lamps, obstacles, and the
// validator can never disagree about where the ground is. This module
// stays for backwards-compatibility with existing call sites.
//
// `terrainHeightAt` already returns 0 outside mountain country (no
// road skirt + no massif dome covers the point), so the previous
// `if (z > -150) return 0` shortcut would have caused a dual-source
// bug for the east/west foothill ridges (ridge-east-far,
// ridge-west-far) whose vertices live around z=30..-200. It is gone.

import { REGIONAL_ROADS, ROAD_ELEVATION_PROFILES, MOUNTAIN_ROAD_IDS } from "./cityData";
import { terrainHeightAt } from "./terrain";

export function isMountainRoadId(id: string): boolean {
  return MOUNTAIN_ROAD_IDS.has(id);
}

// Returns the visible ground Y at (x, z). Equal to the terrain
// heightfield Y at that point — guaranteed to match the rendered
// MountainTerrain mesh and the road quads.
export function getRoadElevationAt(x: number, z: number): number {
  return terrainHeightAt(x, z);
}

// Convenience wrapper used by vehicle / player code so the call site
// is self-documenting. Currently identical to getRoadElevationAt;
// kept as a separate symbol so we can later add suspension dip / tyre
// radius handling without touching every call.
export function getVehicleGroundY(x: number, z: number): number {
  return terrainHeightAt(x, z);
}

// Maximum |dy/dh| across every segment of every mountain road —
// surfaced for the validator's grade check. Operates purely on the
// declared profiles (independent of terrainHeightAt).
export function maxMountainGrade(): number {
  let max = 0;
  for (const r of REGIONAL_ROADS) {
    if (!MOUNTAIN_ROAD_IDS.has(r.id)) continue;
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
