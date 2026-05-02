import type {
  NpcRoute,
  TrafficCarSeed,
  TrafficRoute,
  VehicleVariant,
} from "./types";
import {
  BUILDINGS,
  CITY_HALF,
  REGIONAL_ROADS,
  ROADS,
  STATIC_OBSTACLES,
  VARIANT_DIMENSIONS,
} from "./cityData";
import { distancePointToPolyline } from "./roadGeom";

// =====================================================
// Body radii / margins
// =====================================================
//
// All collision math runs in the X/Z plane. Y (vertical) is ignored,
// which matches the game's hand-written movement code: walking moves in
// X/Z with gravity on Y, and driving keeps Y pinned to the road.

export const PLAYER_BODY_RADIUS = 0.45;
export const NPC_BODY_RADIUS = 0.35;

// Small padding added to a vehicle's OBB when used as a *target* of a
// collision check, to keep things from looking visibly clipped.
export const VEHICLE_PLAYER_MARGIN = 0.15;
export const VEHICLE_BUILDING_MARGIN = 0.05;
export const VEHICLE_VEHICLE_MARGIN = 0.05;

// Speed thresholds (units per second) that gate "did it really HIT me?"
// damage-style reactions vs. just touching at parking-lot speed.
export const VEHICLE_HIT_PLAYER_MIN_SPEED = 3.0;
export const VEHICLE_HIT_NPC_MIN_SPEED = 3.0;

// =====================================================
// Geometric primitives
// =====================================================

export interface AABB {
  x: number;
  z: number;
  hw: number; // half-width along world +X
  hd: number; // half-depth along world +Z
}

export interface OBB {
  x: number;
  z: number;
  hw: number; // half-extent along the box's local +X axis
  hd: number; // half-extent along the box's local +Z axis
  rotY: number; // Y rotation of the box (Three.js convention)
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

// Build an OBB for a vehicle from its current state. Margin grows the
// box uniformly. `variant` is normalized defensively because it may
// arrive from the network as an unknown string.
export function vehicleObb(
  state: { x: number; z: number; rotY: number; variant?: string | null },
  margin = 0,
): OBB {
  const v: VehicleVariant =
    state.variant && Object.hasOwn(VARIANT_DIMENSIONS, state.variant)
      ? (state.variant as VehicleVariant)
      : "sedan";
  const dim = VARIANT_DIMENSIONS[v];
  return {
    x: state.x,
    z: state.z,
    hw: dim.bodyW / 2 + margin,
    hd: dim.bodyD / 2 + margin,
    rotY: state.rotY,
  };
}

export function buildingAabb(
  b: { x: number; z: number; w: number; d: number },
  margin = 0,
): AABB {
  return { x: b.x, z: b.z, hw: b.w / 2 + margin, hd: b.d / 2 + margin };
}

// =====================================================
// Pairwise tests
// =====================================================

export function circleVsAabb(c: Circle, b: AABB): boolean {
  const cx = Math.max(b.x - b.hw, Math.min(c.x, b.x + b.hw));
  const cz = Math.max(b.z - b.hd, Math.min(c.z, b.z + b.hd));
  const dx = c.x - cx;
  const dz = c.z - cz;
  return dx * dx + dz * dz < c.r * c.r;
}

// Transform circle into OBB local frame, then closest-point-in-AABB.
//
// Local axes in world (x, z) plane for a box with rotY = r:
//   local +X axis -> ( cos r, -sin r )
//   local +Z axis -> ( sin r,  cos r )
// (matches Three.js Y-rotation: rotation.y = r maps local point (x,0,z)
// to world (x cos r + z sin r,  -x sin r + z cos r) — i.e. local-X
// projects onto world (cos r, -sin r) and local-Z onto (sin r, cos r).)
//
// To express the offset (dx, dz) in local coords we dot with each axis.
export function circleVsObb(c: Circle, o: OBB): boolean {
  const dx = c.x - o.x;
  const dz = c.z - o.z;
  const cos = Math.cos(o.rotY);
  const sin = Math.sin(o.rotY);
  const lx = dx * cos - dz * sin; // dot with local +X
  const lz = dx * sin + dz * cos; // dot with local +Z
  const px = Math.max(-o.hw, Math.min(lx, o.hw));
  const pz = Math.max(-o.hd, Math.min(lz, o.hd));
  const ddx = lx - px;
  const ddz = lz - pz;
  return ddx * ddx + ddz * ddz < c.r * c.r;
}

// 2D OBB-vs-OBB Separating Axis Theorem on the X/Z plane.
export function obbVsObb(a: OBB, b: OBB): boolean {
  const aAxisX: [number, number] = [Math.cos(a.rotY), -Math.sin(a.rotY)];
  const aAxisZ: [number, number] = [Math.sin(a.rotY), Math.cos(a.rotY)];
  const bAxisX: [number, number] = [Math.cos(b.rotY), -Math.sin(b.rotY)];
  const bAxisZ: [number, number] = [Math.sin(b.rotY), Math.cos(b.rotY)];

  const dx = b.x - a.x;
  const dz = b.z - a.z;

  const axes: [number, number][] = [aAxisX, aAxisZ, bAxisX, bAxisZ];
  for (const [ax, az] of axes) {
    const t = Math.abs(dx * ax + dz * az);
    const ra =
      Math.abs(a.hw * (aAxisX[0] * ax + aAxisX[1] * az)) +
      Math.abs(a.hd * (aAxisZ[0] * ax + aAxisZ[1] * az));
    const rb =
      Math.abs(b.hw * (bAxisX[0] * ax + bAxisX[1] * az)) +
      Math.abs(b.hd * (bAxisZ[0] * ax + bAxisZ[1] * az));
    if (t > ra + rb) return false;
  }
  return true;
}

export function obbVsAabb(o: OBB, b: AABB): boolean {
  // An AABB is just an OBB with rotY = 0.
  return obbVsObb(o, { x: b.x, z: b.z, hw: b.hw, hd: b.hd, rotY: 0 });
}

// =====================================================
// World-level helpers
// =====================================================

export function playerHitsAnyBuilding(
  px: number,
  pz: number,
  r = PLAYER_BODY_RADIUS,
): boolean {
  const c: Circle = { x: px, z: pz, r };
  for (const b of BUILDINGS) {
    if (circleVsAabb(c, buildingAabb(b))) return true;
  }
  return false;
}

export function vehicleHitsAnyBuilding(o: OBB): boolean {
  for (const b of BUILDINGS) {
    if (obbVsAabb(o, buildingAabb(b, VEHICLE_BUILDING_MARGIN))) return true;
  }
  return false;
}

// =====================================================
// Static obstacles (bridge rails, rocks, warehouses, etc.)
// =====================================================
//
// Same AABB-based approach as buildings, just sourced from the
// STATIC_OBSTACLES array in cityData. Bridge rails, large rocks, big
// tree trunks, mountain cliff walls, and landmark structures are all
// axis-aligned: they don't rotate.

export function obstacleAabb(
  o: { x: number; z: number; w: number; d: number },
  margin = 0,
): AABB {
  return { x: o.x, z: o.z, hw: o.w / 2 + margin, hd: o.d / 2 + margin };
}

export function playerHitsAnyObstacle(
  px: number,
  pz: number,
  r = PLAYER_BODY_RADIUS,
): boolean {
  const c: Circle = { x: px, z: pz, r };
  for (const o of STATIC_OBSTACLES) {
    if (circleVsAabb(c, obstacleAabb(o))) return true;
  }
  return false;
}

export function vehicleHitsAnyObstacle(o: OBB): boolean {
  for (const obs of STATIC_OBSTACLES) {
    if (obbVsAabb(o, obstacleAabb(obs, VEHICLE_BUILDING_MARGIN))) return true;
  }
  return false;
}

// =====================================================
// Nearest road query
// =====================================================
//
// Used by the dev-mode validator (in cityData.ts) and exposed for any
// future gameplay code that wants to know "am I on a road right now?".
// Iterates regional polylines plus the central city grid. The city
// grid is treated as straight bounded segments from -CITY_HALF to
// +CITY_HALF, matching the rendered carriageway.

export interface NearestRoadInfo {
  id: string;
  /** 2D distance from the query point to the nearest road centerline. */
  dist: number;
  /** Half of that road's carriageway width. */
  halfWidth: number;
  /** dist - halfWidth: positive = outside carriageway, ≤0 = on the road. */
  signedClearance: number;
}

const _cityCorridors: { id: string; points: [number, number][]; halfWidth: number }[] = [];
function _ensureCityCorridors(): void {
  if (_cityCorridors.length > 0) return;
  const half = ROADS.width / 2;
  for (const x of ROADS.ns) {
    _cityCorridors.push({
      id: `city-ns-${x}`,
      points: [[x, -CITY_HALF], [x, CITY_HALF]],
      halfWidth: half,
    });
  }
  for (const z of ROADS.ew) {
    _cityCorridors.push({
      id: `city-ew-${z}`,
      points: [[-CITY_HALF, z], [CITY_HALF, z]],
      halfWidth: half,
    });
  }
}

export function nearestRoad(px: number, pz: number): NearestRoadInfo {
  _ensureCityCorridors();
  let best: NearestRoadInfo = {
    id: "<none>",
    dist: Infinity,
    halfWidth: 0,
    signedClearance: Infinity,
  };
  const consider = (id: string, dist: number, halfWidth: number): void => {
    if (dist < best.dist) {
      best = { id, dist, halfWidth, signedClearance: dist - halfWidth };
    }
  };
  for (const r of REGIONAL_ROADS) {
    consider(r.id, distancePointToPolyline(px, pz, r.points), r.width / 2);
  }
  for (const r of _cityCorridors) {
    consider(r.id, distancePointToPolyline(px, pz, r.points), r.halfWidth);
  }
  return best;
}

// =====================================================
// Deterministic positions for ambient (non-networked) entities
// =====================================================
//
// These mirror the math used inside NPCs.tsx and AmbientTraffic.tsx so
// the LocalPlayer can collision-test ambient pedestrians and ambient
// cars without taking direct refs to those components.

export function npcPositionAt(
  route: NpcRoute,
  tMs: number,
): { x: number; z: number; rotY: number } {
  const progress = (tMs / 1000 / route.cycleSeconds) % 1;
  const segCount = route.waypoints.length;
  const segProgress = progress * segCount;
  const segIdx = Math.floor(segProgress) % segCount;
  const segT = segProgress - Math.floor(segProgress);
  const a = route.waypoints[segIdx];
  const b = route.waypoints[(segIdx + 1) % segCount];
  const x = a[0] + (b[0] - a[0]) * segT;
  const z = a[1] + (b[1] - a[1]) * segT;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  // rotY=0 → forward = -Z (matches LocalPlayer convention).
  const rotY = Math.atan2(-dx, -dz);
  return { x, z, rotY };
}

function shortestAngleDelta(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

export function ambientCarStateAt(
  route: TrafficRoute,
  seed: TrafficCarSeed,
  tMs: number,
): { x: number; z: number; rotY: number; speed: number; variant: VehicleVariant } {
  const dur = route.cycleSeconds;
  const progress = (tMs / 1000 / dur + seed.phase) % 1;
  const segCount = route.waypoints.length;
  const segProgress = progress * segCount;
  const segIdx = Math.floor(segProgress) % segCount;
  const segT = segProgress - Math.floor(segProgress);
  const a = route.waypoints[segIdx];
  const b = route.waypoints[(segIdx + 1) % segCount];
  const x = a[0] + (b[0] - a[0]) * segT;
  const z = a[1] + (b[1] - a[1]) * segT;
  const rotA = a[2];
  const rotB = b[2];
  const rotY = rotA + shortestAngleDelta(rotA, rotB) * segT;

  // Speed = segment length / time-to-traverse-segment.
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const segDur = dur / segCount;
  const speed = segLen / segDur;

  return { x, z, rotY, speed, variant: seed.variant };
}

// =====================================================
// NPC stumble state (shared with GameScene)
// =====================================================
//
// LocalPlayer writes when its driven car hits an NPC; NPC.tsx reads
// each frame and applies a decaying lateral offset + tilt. Purely
// visual / local — never broadcast over Socket.io.

export interface NpcStumble {
  vx: number;
  vz: number;
  /** Date.now() ms when stumble ends. */
  until: number;
}

export const NPC_STUMBLE_DURATION_MS = 800;

export type NpcStumbleMap = Map<number, NpcStumble>;
