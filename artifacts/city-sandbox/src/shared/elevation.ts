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

// =============================================================
// getVehicleGroundFrame — shared 4-wheel slope sampler.
// -------------------------------------------------------------
// Samples the terrain at all four wheel-contact points for a vehicle
// at (x, z) facing yaw `rotY`, then returns:
//   centerY — average of the four wheel Y values (use for body height)
//   pitch   — rotation around the vehicle's lateral axis. POSITIVE
//             pitch = nose up = vehicle is climbing (front wheels
//             higher than rear). Sign matches Three.js rotation.x in
//             rotation order 'YXZ' (yaw applied first, then pitch
//             around the rotated +X axis: positive rotation lifts the
//             local -Z direction, which is the gameplay forward).
//   roll    — rotation around the vehicle's forward axis. POSITIVE
//             roll = right side up (right wheels higher than left).
//             Sign matches Three.js rotation.z in order 'YXZ'.
//   frontY/rearY/leftY/rightY exposed for validators.
//
// Vehicle forward convention (kept in lockstep with LocalPlayer.
// updateVehicle, AmbientTraffic, collision.ts): forward = local **−Z**.
// Therefore the "front" wheels are sampled at distance +halfWB along
// the forward direction `(-sin rotY, -cos rotY)`, the "rear" wheels at
// −halfWB, and the right side along `(cos rotY, -sin rotY)`.
//
// The returned object is a fresh literal — callers (LocalPlayer,
// VehicleObject, AmbientTraffic) only call this once per vehicle per
// frame, so allocation cost is negligible (≤ 50 cars total).
// =============================================================

export interface VehicleGroundFrame {
  centerY: number;
  pitch: number;
  roll: number;
  frontY: number;
  rearY: number;
  leftY: number;
  rightY: number;
}

export function getVehicleGroundFrame(
  x: number,
  z: number,
  rotY: number,
  wheelbase: number,
  trackWidth: number,
): VehicleGroundFrame {
  const halfWB = wheelbase * 0.5;
  const halfTW = trackWidth * 0.5;
  // Forward (local -Z) and right (local +X) basis vectors after yaw.
  const fwdX = -Math.sin(rotY);
  const fwdZ = -Math.cos(rotY);
  const rgtX = Math.cos(rotY);
  const rgtZ = -Math.sin(rotY);
  const flX = x + fwdX * halfWB - rgtX * halfTW;
  const flZ = z + fwdZ * halfWB - rgtZ * halfTW;
  const frX = x + fwdX * halfWB + rgtX * halfTW;
  const frZ = z + fwdZ * halfWB + rgtZ * halfTW;
  const rlX = x - fwdX * halfWB - rgtX * halfTW;
  const rlZ = z - fwdZ * halfWB - rgtZ * halfTW;
  const rrX = x - fwdX * halfWB + rgtX * halfTW;
  const rrZ = z - fwdZ * halfWB + rgtZ * halfTW;
  const flY = terrainHeightAt(flX, flZ);
  const frY = terrainHeightAt(frX, frZ);
  const rlY = terrainHeightAt(rlX, rlZ);
  const rrY = terrainHeightAt(rrX, rrZ);
  const frontY = (flY + frY) * 0.5;
  const rearY = (rlY + rrY) * 0.5;
  const leftY = (flY + rlY) * 0.5;
  const rightY = (frY + rrY) * 0.5;
  const centerY = (flY + frY + rlY + rrY) * 0.25;
  // atan2(dy, dx) instead of dy/dx so steep slopes don't blow up.
  const pitch = Math.atan2(frontY - rearY, wheelbase);
  const roll = Math.atan2(rightY - leftY, trackWidth);
  return { centerY, pitch, roll, frontY, rearY, leftY, rightY };
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
