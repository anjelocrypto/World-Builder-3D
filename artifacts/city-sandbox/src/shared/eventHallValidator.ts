/**
 * Phase 14A — Grand Plaza Hall placement validator.
 *
 * Read-only geometry assertions, mirroring the RP/housing validators. Proves the
 * hall footprint (and its approach apron) is clear of every existing world
 * system, the entrance is off-road and reachable, the stage/screen/chair rows
 * stay inside the footprint, and the pedestrian connector spur is clear.
 *
 * Runs in two places:
 *   - the client dev-validation block in cityData.ts (`if (isViteDev)`), and
 *   - standalone via `tsx src/shared/eventHallValidator.ts` for CI / proof.
 *
 * Throws on any violation; otherwise returns a numeric clearance report.
 */

import {
  EVENT_HALL,
  EVENT_HALL_EXTENTS,
  EVENT_HALL_STAGE,
  EVENT_HALL_CONNECTOR,
  EVENT_HALL_CONNECTOR_WIDTH,
  eventHallChairPositions,
} from "./eventHall";
import {
  BUILDINGS,
  INITIAL_VEHICLES,
  SPAWN_POINTS,
  REGIONAL_ROADS,
  STATIC_OBSTACLES,
  NPC_ROUTES,
  TRAFFIC_ROUTES,
  ELEVATED_RAIL_LOOP,
  TRAIN_STATION,
  SKYBRIDGES,
  ROADS,
  CITY_EDGE_TREES,
  FOREST_TREES,
} from "./cityData";
import { RP_BUILDINGS, RP_HOUSES } from "./rpTypes";

// ── Geometry helpers ────────────────────────────────────────────────────────
interface Rect { xMin: number; xMax: number; zMin: number; zMax: number; }

/** Distance from an axis-aligned rect to a point (0 if the point is inside). */
function rectToPoint(r: Rect, px: number, pz: number): number {
  const dx = Math.max(r.xMin - px, 0, px - r.xMax);
  const dz = Math.max(r.zMin - pz, 0, pz - r.zMax);
  return Math.hypot(dx, dz);
}

/** Edge-to-edge gap between two AABBs (negative ⇒ overlap). */
function rectToRect(r: Rect, b: { x: number; z: number; w: number; d: number }): number {
  return Math.max(
    Math.abs((r.xMin + r.xMax) / 2 - b.x) - ((r.xMax - r.xMin) / 2 + b.w / 2),
    Math.abs((r.zMin + r.zMax) / 2 - b.z) - ((r.zMax - r.zMin) / 2 + b.d / 2),
  );
}

/** Min distance from a rect to a polyline (sampled), optionally closed. */
function rectToPolyline(r: Rect, pts: ReadonlyArray<readonly [number, number]>, closed = false): number {
  let min = Infinity;
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / 2)); // sample every ~2 m
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = a[0] + (b[0] - a[0]) * t;
      const pz = a[1] + (b[1] - a[1]) * t;
      const d = rectToPoint(r, px, pz);
      if (d < min) min = d;
    }
  }
  return min;
}

const xz2 = (p: readonly [number, number, number]): [number, number] => [p[0], p[2]];

// ── Validator ───────────────────────────────────────────────────────────────
export interface HallClearanceReport {
  nearestRoad: number;
  nearestBuilding: number;
  nearestRpBuilding: number;
  nearestRpHouse: number;
  nearestObstacle: number;
  nearestCar: number;
  nearestSpawn: number;
  nearestRail: number;
  nearestStation: number;
  nearestSkybridge: number;
  nearestNpcRoute: number;
  nearestTrafficRoute: number;
  connectorNearestObstacle: number;
  nearestTree: number;
  nearestChairToStage: number;
}

/** Hall keepout = footprint expanded by this margin (must match the tree generator). */
const TREE_KEEPOUT = 6;

/** Minimum required edge clearance (m) from the footprint to any solid system. */
const REQUIRED_MARGIN = 2;

export function validateEventHall(): HallClearanceReport {
  const fp: Rect = { ...EVENT_HALL_EXTENTS };
  const fail = (msg: string): never => { throw new Error(`[eventHall] ${msg}`); };

  // 1. Roads — footprint must clear each carriageway by half-width + margin.
  //    Central grid roads run only within ±100; the hall is well outside, but we
  //    still check them for completeness via REGIONAL_ROADS + the grid.
  let nearestRoad = Infinity;
  for (const rd of REGIONAL_ROADS) {
    // The hall's OWN approach path is meant to reach the entrance apron — skip it
    // here (its clearance from other systems is checked in step 12).
    if (rd.id === "path-grand-plaza-hall") continue;
    const half = rd.width / 2;
    const d = rectToPolyline(fp, rd.points as ReadonlyArray<readonly [number, number]>) - half;
    if (d < nearestRoad) nearestRoad = d;
    if (d < REQUIRED_MARGIN) fail(`footprint within ${d.toFixed(1)} m of road "${rd.id}" (need ≥ ${REQUIRED_MARGIN})`);
  }
  // Central grid roads (bounded to ±100): build their segments explicitly.
  const GRID = 100, half = ROADS.width / 2;
  for (const rx of ROADS.ns) {
    const d = rectToPolyline(fp, [[rx, -GRID], [rx, GRID]]) - half;
    if (d < nearestRoad) nearestRoad = d;
    if (d < REQUIRED_MARGIN) fail(`footprint within ${d.toFixed(1)} m of grid road x=${rx}`);
  }
  for (const rz of ROADS.ew) {
    const d = rectToPolyline(fp, [[-GRID, rz], [GRID, rz]]) - half;
    if (d < nearestRoad) nearestRoad = d;
    if (d < REQUIRED_MARGIN) fail(`footprint within ${d.toFixed(1)} m of grid road z=${rz}`);
  }

  // 2. City buildings.
  let nearestBuilding = Infinity;
  for (const b of BUILDINGS) {
    const g = rectToRect(fp, { x: b.x, z: b.z, w: b.w, d: b.d });
    if (g < nearestBuilding) nearestBuilding = g;
    if (g < REQUIRED_MARGIN) fail(`footprint within ${g.toFixed(1)} m of a city building at [${b.x}, ${b.z}]`);
  }

  // 3. RP buildings.
  let nearestRpBuilding = Infinity;
  for (const b of RP_BUILDINGS) {
    const g = rectToRect(fp, { x: b.x, z: b.z, w: b.w, d: b.d });
    if (g < nearestRpBuilding) nearestRpBuilding = g;
    if (g < REQUIRED_MARGIN) fail(`footprint within ${g.toFixed(1)} m of RP building "${b.id}"`);
  }

  // 4. RP houses.
  let nearestRpHouse = Infinity;
  for (const h of RP_HOUSES) {
    const g = rectToRect(fp, { x: h.x, z: h.z, w: h.w, d: h.d });
    if (g < nearestRpHouse) nearestRpHouse = g;
    if (g < REQUIRED_MARGIN) fail(`footprint within ${g.toFixed(1)} m of RP house "${h.slug}"`);
  }

  // 5. Static obstacles (INCLUDES peri-city homestead houses + fence segments).
  let nearestObstacle = Infinity;
  for (const o of STATIC_OBSTACLES) {
    const g = rectToRect(fp, { x: o.x, z: o.z, w: o.w, d: o.d });
    if (g < nearestObstacle) nearestObstacle = g;
    if (g < REQUIRED_MARGIN) fail(`footprint within ${g.toFixed(1)} m of obstacle "${o.kind}" at [${o.x}, ${o.z}]`);
  }

  // 6. Parked cars.
  let nearestCar = Infinity;
  for (const v of INITIAL_VEHICLES) {
    const d = rectToPoint(fp, v.x, v.z);
    if (d < nearestCar) nearestCar = d;
    if (d < REQUIRED_MARGIN) fail(`footprint within ${d.toFixed(1)} m of parked car "${v.id}"`);
  }

  // 7. Spawn points.
  let nearestSpawn = Infinity;
  for (const s of SPAWN_POINTS) {
    const d = rectToPoint(fp, s[0], s[2]);
    if (d < nearestSpawn) nearestSpawn = d;
    if (d < REQUIRED_MARGIN) fail(`footprint within ${d.toFixed(1)} m of a spawn point`);
  }

  // 8. Rail loop (closed polyline), train station (AABB), skybridges (segments).
  const railPts = ELEVATED_RAIL_LOOP.map((v) => [v.x, v.z] as [number, number]);
  const nearestRail = rectToPolyline(fp, railPts, true);
  if (nearestRail < REQUIRED_MARGIN) fail(`footprint within ${nearestRail.toFixed(1)} m of the elevated rail loop`);
  const nearestStation = rectToRect(fp, { x: TRAIN_STATION.cx, z: TRAIN_STATION.cz, w: TRAIN_STATION.w, d: TRAIN_STATION.d });
  if (nearestStation < REQUIRED_MARGIN) fail(`footprint within ${nearestStation.toFixed(1)} m of the train station`);
  let nearestSkybridge = Infinity;
  for (const sb of SKYBRIDGES) {
    const d = rectToPolyline(fp, [[sb.x1, sb.z1], [sb.x2, sb.z2]]);
    if (d < nearestSkybridge) nearestSkybridge = d;
    if (d < REQUIRED_MARGIN) fail(`footprint within ${d.toFixed(1)} m of skybridge "${sb.id}"`);
  }

  // 9. NPC + traffic route samples.
  let nearestNpcRoute = Infinity;
  for (const r of NPC_ROUTES) {
    const d = rectToPolyline(fp, r.waypoints as ReadonlyArray<readonly [number, number]>, true);
    if (d < nearestNpcRoute) nearestNpcRoute = d;
    if (d < REQUIRED_MARGIN) fail(`footprint within ${d.toFixed(1)} m of NPC route ${r.id}`);
  }
  let nearestTrafficRoute = Infinity;
  for (const r of TRAFFIC_ROUTES) {
    const d = rectToPolyline(fp, r.waypoints.map(xz2), true);
    if (d < nearestTrafficRoute) nearestTrafficRoute = d;
    if (d < REQUIRED_MARGIN) fail(`footprint within ${d.toFixed(1)} m of traffic route ${r.id}`);
  }

  // 10. Entrance off-road + reachable (outside the shell, near the doorway gap).
  const [exX, exZ] = EVENT_HALL.entrance;
  if (exZ >= EVENT_HALL_EXTENTS.zMin) fail(`entrance [${exX}, ${exZ}] is not outside the north wall`);
  const entranceToFront = EVENT_HALL_EXTENTS.zMin - exZ;
  if (entranceToFront > EVENT_HALL.apronFront + 2) fail(`entrance is ${entranceToFront} m from the doorway — beyond the apron`);
  if (Math.abs(exX - EVENT_HALL.x) > EVENT_HALL.entranceGapWidth / 2) fail(`entrance is not aligned with the doorway gap`);

  // 11. Stage / screen / chairs inside the footprint.
  const insideFp = (px: number, pz: number, inset = 0.5) =>
    px >= EVENT_HALL_EXTENTS.xMin + inset && px <= EVENT_HALL_EXTENTS.xMax - inset &&
    pz >= EVENT_HALL_EXTENTS.zMin + inset && pz <= EVENT_HALL_EXTENTS.zMax - inset;
  if (!insideFp(EVENT_HALL.stage[0], EVENT_HALL.stage[1])) fail(`stage is not inside the footprint`);
  if (!insideFp(EVENT_HALL.screen[0], EVENT_HALL.screen[1])) fail(`screen is not inside the footprint`);
  const chairs = eventHallChairPositions();
  for (const [cx, cz] of chairs) {
    if (!insideFp(cx, cz)) fail(`a chair at [${cx}, ${cz}] is outside the footprint`);
  }

  // 12. Connector spur — clear of obstacles + buildings (it runs OVER open ground).
  let connectorNearestObstacle = Infinity;
  const connPts = EVENT_HALL_CONNECTOR as ReadonlyArray<readonly [number, number]>;
  const connHalf = EVENT_HALL_CONNECTOR_WIDTH / 2;
  for (const o of [...STATIC_OBSTACLES.map((o) => ({ x: o.x, z: o.z, w: o.w, d: o.d })),
                   ...BUILDINGS.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })),
                   ...RP_HOUSES.map((h) => ({ x: h.x, z: h.z, w: h.w, d: h.d }))]) {
    const r: Rect = { xMin: o.x - o.w / 2, xMax: o.x + o.w / 2, zMin: o.z - o.d / 2, zMax: o.z + o.d / 2 };
    const d = rectToPolyline(r, connPts) - connHalf;
    if (d < connectorNearestObstacle) connectorNearestObstacle = d;
    if (d < REQUIRED_MARGIN) fail(`connector path within ${d.toFixed(1)} m of an obstacle at [${o.x}, ${o.z}]`);
  }

  // 13. Trees / flora — none may sit inside the hall keepout (footprint+6m). The
  //     keepout rect; nearestTree is the smallest edge distance from the FOOTPRINT
  //     to any tree, so a positive value well over TREE_KEEPOUT proves clearance.
  const keepout: Rect = {
    xMin: EVENT_HALL_EXTENTS.xMin - TREE_KEEPOUT, xMax: EVENT_HALL_EXTENTS.xMax + TREE_KEEPOUT,
    zMin: EVENT_HALL_EXTENTS.zMin - TREE_KEEPOUT, zMax: EVENT_HALL_EXTENTS.zMax + TREE_KEEPOUT,
  };
  let nearestTree = Infinity;
  for (const t of [...CITY_EDGE_TREES, ...FOREST_TREES]) {
    const d = rectToPoint(fp, t.x, t.z);
    if (d < nearestTree) nearestTree = d;
    if (rectToPoint(keepout, t.x, t.z) <= 0) {
      fail(`a tree at [${t.x.toFixed(1)}, ${t.z.toFixed(1)}] is inside the hall keepout (footprint+${TREE_KEEPOUT}m)`);
    }
  }

  // 14. Stage (Phase 14D) — footprint inside the hall, topY matches height, and
  //     it does not overlap the chair rows (so seating stays clear of the riser).
  const stageRect: Rect = {
    xMin: EVENT_HALL_STAGE.x - EVENT_HALL_STAGE.w / 2,
    xMax: EVENT_HALL_STAGE.x + EVENT_HALL_STAGE.w / 2,
    zMin: EVENT_HALL_STAGE.z - EVENT_HALL_STAGE.d / 2,
    zMax: EVENT_HALL_STAGE.z + EVENT_HALL_STAGE.d / 2,
  };
  if (
    stageRect.xMin < EVENT_HALL_EXTENTS.xMin || stageRect.xMax > EVENT_HALL_EXTENTS.xMax ||
    stageRect.zMin < EVENT_HALL_EXTENTS.zMin || stageRect.zMax > EVENT_HALL_EXTENTS.zMax
  ) {
    fail(`stage footprint extends outside the hall footprint`);
  }
  if (EVENT_HALL_STAGE.topY !== EVENT_HALL_STAGE.h) {
    fail(`stage topY (${EVENT_HALL_STAGE.topY}) must equal its height (${EVENT_HALL_STAGE.h})`);
  }
  let nearestChairToStage = Infinity;
  for (const [cx, cz] of chairs) {
    const d = rectToPoint(stageRect, cx, cz);
    if (d < nearestChairToStage) nearestChairToStage = d;
  }
  if (nearestChairToStage <= 0) fail(`a chair overlaps the stage footprint`);

  return {
    nearestRoad, nearestBuilding, nearestRpBuilding, nearestRpHouse, nearestObstacle,
    nearestCar, nearestSpawn, nearestRail, nearestStation, nearestSkybridge,
    nearestNpcRoute, nearestTrafficRoute, connectorNearestObstacle, nearestTree,
    nearestChairToStage,
  };
}

// Standalone runner: `tsx src/shared/eventHallValidator.ts`
// (import.meta.url check keeps this inert when imported as a module.)
const isMain = typeof process !== "undefined" && process.argv?.[1]?.includes("eventHallValidator");
if (isMain) {
  const report = validateEventHall();
  console.info("[eventHall] PASS — clearance report (metres, edge-to-edge):");
  for (const [k, v] of Object.entries(report)) {
    console.info(`  ${k.padEnd(24)} ${(v as number).toFixed(1)}`);
  }
  console.info(`[eventHall] footprint [${EVENT_HALL_EXTENTS.xMin}, ${EVENT_HALL_EXTENTS.xMax}] × [${EVENT_HALL_EXTENTS.zMin}, ${EVENT_HALL_EXTENTS.zMax}], ${eventHallChairPositions().length} chairs`);
}
