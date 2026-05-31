/**
 * Nemo Gang hood validator (read-only, client-only).
 *
 * Proves the static hood geometry is safe against the real world data:
 *   - every house footprint is inside NEMO_HOOD_CLEARING (so forest trees are
 *     suppressed around it) and inside NEMO_HOOD_BOUNDS,
 *   - houses don't overlap each other (min gap),
 *   - the reserved spawn + hangout are clear of every house,
 *   - the whole footprint clears every REGIONAL_ROAD carriageway, the city road
 *     grid, every STATIC_OBSTACLE, the Grand Plaza Hall, and the Grove turf,
 *   - nothing pokes past the world edge.
 *
 * Run standalone: `node <jiti> src/shared/nemoHoodValidator.ts`.
 */

import {
  NEMO_HOOD_BOUNDS,
  NEMO_HOOD_CLEARING,
  NEMO_HOOD_HOUSES,
  NEMO_HOOD_SPAWN,
  NEMO_HOOD_HANGOUT_POS,
} from "./nemoHood";
import {
  REGIONAL_ROADS,
  ROADS,
  STATIC_OBSTACLES,
  WORLD_HALF,
} from "./cityData";
import { EVENT_HALL } from "./eventHall";
import { GROVE_STREET_TURF_CENTER, GROVE_STREET_TURF_RADIUS } from "./rpTypes";

const ROAD_CLEAR = 8; // m from any carriageway edge
const OBSTACLE_CLEAR = 5; // m from any static obstacle / building edge
const SOFT_CLEAR = 8; // m from Hall / Grove turf

interface HoodValidationReport {
  houses: number;
  minHouseGap: number;
  minRoadClear: number;
  minObstacleClear: number;
}

// gap from the hood footprint rectangle (NEMO_HOOD_BOUNDS) to a point.
function footprintGapToPoint(px: number, pz: number): number {
  const cx = (NEMO_HOOD_BOUNDS.x0 + NEMO_HOOD_BOUNDS.x1) / 2;
  const cz = (NEMO_HOOD_BOUNDS.z0 + NEMO_HOOD_BOUNDS.z1) / 2;
  const hx = (NEMO_HOOD_BOUNDS.x1 - NEMO_HOOD_BOUNDS.x0) / 2;
  const hz = (NEMO_HOOD_BOUNDS.z1 - NEMO_HOOD_BOUNDS.z0) / 2;
  const dx = Math.max(Math.abs(px - cx) - hx, 0);
  const dz = Math.max(Math.abs(pz - cz) - hz, 0);
  return Math.hypot(dx, dz);
}
function footprintGapToBox(bx: number, bz: number, bw: number, bd: number): number {
  const cx = (NEMO_HOOD_BOUNDS.x0 + NEMO_HOOD_BOUNDS.x1) / 2;
  const cz = (NEMO_HOOD_BOUNDS.z0 + NEMO_HOOD_BOUNDS.z1) / 2;
  const hx = (NEMO_HOOD_BOUNDS.x1 - NEMO_HOOD_BOUNDS.x0) / 2;
  const hz = (NEMO_HOOD_BOUNDS.z1 - NEMO_HOOD_BOUNDS.z0) / 2;
  const dx = Math.max(Math.abs(bx - cx) - hx - bw / 2, 0);
  const dz = Math.max(Math.abs(bz - cz) - hz - bd / 2, 0);
  return Math.hypot(dx, dz);
}

export function validateNemoHood(): HoodValidationReport {
  const fail = (m: string): never => { throw new Error(`[nemoHood] ${m}`); };

  // World edge
  if (
    Math.abs(NEMO_HOOD_BOUNDS.x0) > WORLD_HALF - 5 ||
    Math.abs(NEMO_HOOD_BOUNDS.x1) > WORLD_HALF - 5 ||
    Math.abs(NEMO_HOOD_BOUNDS.z1) > WORLD_HALF - 5
  ) fail("footprint too close to world edge");

  // Houses inside clearing + bounds; no overlap.
  let minHouseGap = Infinity;
  for (let i = 0; i < NEMO_HOOD_HOUSES.length; i++) {
    const a = NEMO_HOOD_HOUSES[i];
    const ax0 = a.x - a.w / 2, ax1 = a.x + a.w / 2, az0 = a.z - a.d / 2, az1 = a.z + a.d / 2;
    if (ax0 < NEMO_HOOD_CLEARING.x0 || ax1 > NEMO_HOOD_CLEARING.x1 ||
        az0 < NEMO_HOOD_CLEARING.z0 || az1 > NEMO_HOOD_CLEARING.z1) {
      fail(`${a.id} extends outside the tree clearing`);
    }
    if (ax0 < NEMO_HOOD_BOUNDS.x0 || ax1 > NEMO_HOOD_BOUNDS.x1 ||
        az0 < NEMO_HOOD_BOUNDS.z0 || az1 > NEMO_HOOD_BOUNDS.z1) {
      fail(`${a.id} extends outside the hood footprint`);
    }
    for (let j = i + 1; j < NEMO_HOOD_HOUSES.length; j++) {
      const b = NEMO_HOOD_HOUSES[j];
      const gx = Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, 0);
      const gz = Math.max(Math.abs(a.z - b.z) - (a.d + b.d) / 2, 0);
      const gap = Math.hypot(gx, gz);
      if (gap < 2) fail(`${a.id} and ${b.id} are too close (${gap.toFixed(1)}m)`);
      if (gap < minHouseGap) minHouseGap = gap;
    }
  }

  // Spawn + hangout clear of every house.
  for (const p of [NEMO_HOOD_SPAWN, NEMO_HOOD_HANGOUT_POS]) {
    for (const h of NEMO_HOOD_HOUSES) {
      const inside = Math.abs(p[0] - h.x) < h.w / 2 + 1 && Math.abs(p[2] - h.z) < h.d / 2 + 1;
      if (inside) fail(`spawn/hangout (${p[0]},${p[2]}) overlaps ${h.id}`);
    }
  }

  // Footprint clearance to roads.
  let minRoadClear = Infinity;
  for (const r of REGIONAL_ROADS) {
    // Sample the polyline; measure each sample to the footprint.
    for (let i = 0; i < r.points.length - 1; i++) {
      const [x0, z0] = r.points[i];
      const [x1, z1] = r.points[i + 1];
      const segs = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3));
      for (let s = 0; s <= segs; s++) {
        const px = x0 + (x1 - x0) * (s / segs);
        const pz = z0 + (z1 - z0) * (s / segs);
        const clear = footprintGapToPoint(px, pz) - r.width / 2;
        if (clear < ROAD_CLEAR) fail(`footprint within ${ROAD_CLEAR}m of road ${r.id} (${clear.toFixed(1)}m)`);
        if (clear < minRoadClear) minRoadClear = clear;
      }
    }
  }
  // City road grid (±100 core) — far away, but check anyway.
  for (const x of ROADS.ns) {
    const clear = footprintGapToPoint(x, Math.max(-100, Math.min(100, (NEMO_HOOD_BOUNDS.z0 + NEMO_HOOD_BOUNDS.z1) / 2))) - 10;
    if (clear < minRoadClear) minRoadClear = clear;
  }

  // Footprint clearance to static obstacles + Hall + Grove.
  let minObstacleClear = Infinity;
  for (const o of STATIC_OBSTACLES) {
    const clear = footprintGapToBox(o.x, o.z, o.w, o.d);
    if (clear < OBSTACLE_CLEAR) fail(`footprint within ${OBSTACLE_CLEAR}m of ${o.kind} at (${o.x},${o.z})`);
    if (clear < minObstacleClear) minObstacleClear = clear;
  }
  if (footprintGapToBox(EVENT_HALL.x, EVENT_HALL.z, EVENT_HALL.w, EVENT_HALL.d) < SOFT_CLEAR) {
    fail("footprint too close to Grand Plaza Hall");
  }
  if (footprintGapToPoint(GROVE_STREET_TURF_CENTER[0], GROVE_STREET_TURF_CENTER[2]) - GROVE_STREET_TURF_RADIUS < SOFT_CLEAR) {
    fail("footprint too close to Grove Street turf");
  }

  return {
    houses: NEMO_HOOD_HOUSES.length,
    minHouseGap: +minHouseGap.toFixed(1),
    minRoadClear: +minRoadClear.toFixed(1),
    minObstacleClear: +minObstacleClear.toFixed(1),
  };
}

const isMain = typeof process !== "undefined" && process.argv?.[1]?.includes("nemoHoodValidator");
if (isMain) {
  const r = validateNemoHood();
  console.info(
    `[nemoHood] PASS — ${r.houses} houses; min house gap ${r.minHouseGap}m, ` +
    `road clearance ${r.minRoadClear}m, obstacle clearance ${r.minObstacleClear}m`,
  );
}
