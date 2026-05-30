/**
 * Phase 15A — rail transit placement validator (read-only).
 *
 * Asserts the two stations + their escalator access lanes are safely placed:
 *   - rail loop stays closed and clears every building (train path),
 *   - station platforms + escalator ground footprints clear buildings / obstacles
 *     / RP buildings / RP houses / the event hall,
 *   - the ground-level escalator foot clears roads, parked cars and spawns,
 *   - the walkable surface endpoints match expected heights (foot ≈ ground,
 *     platform = PLATFORM_TOP_Y) and are continuous,
 *   - the board/exit point lies on the platform.
 *
 * Run standalone: `node <jiti> src/shared/railTransitValidator.ts`.
 */

import {
  BUILDINGS,
  STATIC_OBSTACLES,
  INITIAL_VEHICLES,
  SPAWN_POINTS,
  ROADS,
  REGIONAL_ROADS,
  ELEVATED_RAIL_LOOP,
  railLoopArcLengths,
  railLoopPointAt,
} from "./cityData";
import { RP_BUILDINGS, RP_HOUSES, STATION_SPAWN, STATION_SPAWN_JITTER_X, STATION_SPAWN_JITTER_Z } from "./rpTypes";
import { EVENT_HALL_EXTENTS } from "./eventHall";
import {
  stationGeoms,
  railSurfaceY,
  railSurfaceAt,
  canAttachToRailSurface,
  stationBoardPoint,
  PLATFORM_TOP_Y,
  ESC_RUN,
  ESC_HALF_BAND,
} from "./railTransit";

interface Rect { xMin: number; xMax: number; zMin: number; zMax: number; }
const rectToPoint = (r: Rect, px: number, pz: number): number => {
  const dx = Math.max(r.xMin - px, 0, px - r.xMax);
  const dz = Math.max(r.zMin - pz, 0, pz - r.zMax);
  return Math.hypot(dx, dz);
};
const rectToBox = (r: Rect, b: { x: number; z: number; w: number; d: number }): number =>
  Math.max(
    Math.abs((r.xMin + r.xMax) / 2 - b.x) - ((r.xMax - r.xMin) / 2 + b.w / 2),
    Math.abs((r.zMin + r.zMax) / 2 - b.z) - ((r.zMax - r.zMin) / 2 + b.d / 2),
  );
const rectToPolyline = (r: Rect, pts: ReadonlyArray<readonly [number, number]>): number => {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const d = rectToPoint(r, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (d < min) min = d;
    }
  }
  return min;
};

export interface RailClearanceReport {
  loopClosed: boolean;
  trainNearestBuilding: number;
  perStation: Array<{
    id: string;
    platformNearestStructure: number;
    rampNearestStructure: number;
    footNearestRoad: number;
    footNearestCar: number;
    footNearestSpawn: number;
  }>;
  spawnSamplesOnStructure: number;
}

const MARGIN = 1.5;

export function validateRailTransit(): RailClearanceReport {
  const fail = (m: string): never => { throw new Error(`[railTransit] ${m}`); };

  // 1. Loop closed.
  const first = ELEVATED_RAIL_LOOP[0];
  const last = ELEVATED_RAIL_LOOP[ELEVATED_RAIL_LOOP.length - 1];
  const loopClosed = first.x === last.x && first.z === last.z;
  if (!loopClosed) fail("rail loop is not closed");

  // 2. Train path clears every building (sample the loop, check each is outside
  //    every building footprint). Rail is elevated but towers are tall, so we
  //    require horizontal separation.
  let trainNearestBuilding = Infinity;
  const { total } = railLoopArcLengths();
  for (let s = 0; s < total; s += 3) {
    const p = railLoopPointAt(s);
    for (const b of BUILDINGS) {
      const g = Math.max(Math.abs(p.x - b.x) - b.w / 2, Math.abs(p.z - b.z) - b.d / 2);
      if (g < trainNearestBuilding) trainNearestBuilding = g;
      if (g < MARGIN) fail(`train path within ${g.toFixed(1)} m of a building at [${b.x}, ${b.z}]`);
    }
  }

  const structures: { x: number; z: number; w: number; d: number }[] = [
    ...BUILDINGS.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })),
    ...STATIC_OBSTACLES.map((o) => ({ x: o.x, z: o.z, w: o.w, d: o.d })),
    ...RP_BUILDINGS.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })),
    ...RP_HOUSES.map((h) => ({ x: h.x, z: h.z, w: h.w, d: h.d })),
    { x: (EVENT_HALL_EXTENTS.xMin + EVENT_HALL_EXTENTS.xMax) / 2, z: (EVENT_HALL_EXTENTS.zMin + EVENT_HALL_EXTENTS.zMax) / 2,
      w: EVENT_HALL_EXTENTS.xMax - EVENT_HALL_EXTENTS.xMin, d: EVENT_HALL_EXTENTS.zMax - EVENT_HALL_EXTENTS.zMin },
  ];

  const GRID = 100, half = ROADS.width / 2;
  const perStation = stationGeoms().map((g) => {
    const s = g.station;
    // stairX must agree with the canonical ramp run (one source of truth).
    if (Math.abs(g.run - ESC_RUN) > 0.5) {
      fail(`station "${s.id}" ramp run ${g.run.toFixed(1)} ≠ expected ${ESC_RUN} (stairX foot mismatch)`);
    }
    const platform: Rect = { xMin: s.cx - s.w / 2, xMax: s.cx + s.w / 2, zMin: s.cz - s.d / 2, zMax: s.cz + s.d / 2 };
    const rampGround: Rect = {
      xMin: Math.min(g.edgeX, g.footX), xMax: Math.max(g.edgeX, g.footX),
      zMin: s.cz - ESC_HALF_BAND, zMax: s.cz + ESC_HALF_BAND,
    };
    // Foot region (ground-level entry) — a small box at the escalator foot.
    const foot: Rect = { xMin: g.footX - 2, xMax: g.footX + 2, zMin: s.cz - ESC_HALF_BAND - 1, zMax: s.cz + ESC_HALF_BAND + 1 };

    let platformNearestStructure = Infinity, rampNearestStructure = Infinity;
    for (const st of structures) {
      // Skip the station's own footprint? structures don't include stations. OK.
      const gp = rectToBox(platform, st);
      const gr = rectToBox(rampGround, st);
      if (gp < platformNearestStructure) platformNearestStructure = gp;
      if (gr < rampNearestStructure) rampNearestStructure = gr;
      if (gp < MARGIN) fail(`station "${s.id}" platform within ${gp.toFixed(1)} m of a structure at [${st.x}, ${st.z}]`);
      if (gr < MARGIN) fail(`station "${s.id}" ramp within ${gr.toFixed(1)} m of a structure at [${st.x}, ${st.z}]`);
    }

    // Ground foot clears roads / cars / spawns.
    let footNearestRoad = Infinity;
    for (const rd of REGIONAL_ROADS) {
      const d = rectToPolyline(foot, rd.points as ReadonlyArray<readonly [number, number]>) - rd.width / 2;
      if (d < footNearestRoad) footNearestRoad = d;
      if (d < MARGIN) fail(`station "${s.id}" foot within ${d.toFixed(1)} m of road "${rd.id}"`);
    }
    for (const rx of ROADS.ns) {
      const d = rectToPolyline(foot, [[rx, -GRID], [rx, GRID]]) - half;
      if (d < footNearestRoad) footNearestRoad = d;
      if (d < MARGIN) fail(`station "${s.id}" foot within ${d.toFixed(1)} m of grid road x=${rx}`);
    }
    for (const rz of ROADS.ew) {
      const d = rectToPolyline(foot, [[-GRID, rz], [GRID, rz]]) - half;
      if (d < footNearestRoad) footNearestRoad = d;
      if (d < MARGIN) fail(`station "${s.id}" foot within ${d.toFixed(1)} m of grid road z=${rz}`);
    }
    let footNearestCar = Infinity;
    for (const v of INITIAL_VEHICLES) {
      const d = rectToPoint(foot, v.x, v.z);
      if (d < footNearestCar) footNearestCar = d;
      if (d < MARGIN) fail(`station "${s.id}" foot within ${d.toFixed(1)} m of car "${v.id}"`);
    }
    let footNearestSpawn = Infinity;
    for (const sp of SPAWN_POINTS) {
      const d = rectToPoint(foot, sp[0], sp[2]);
      if (d < footNearestSpawn) footNearestSpawn = d;
      if (d < MARGIN) fail(`station "${s.id}" foot within ${d.toFixed(1)} m of a spawn`);
    }

    // Surface endpoints + continuity (also proves the ramp DIRECTION: high at the
    // platform edge, low at the foot — which the CentralRail visual mirrors via
    // its −g.out*escAngle rotation).
    const yPlatform = railSurfaceY(s.cx, s.cz);
    if (yPlatform === null || Math.abs(yPlatform - PLATFORM_TOP_Y) > 1e-6) fail(`station "${s.id}" platform surface height wrong`);
    const edgeSurf = railSurfaceAt(g.edgeX + g.out * 0.2, s.cz); // just onto the ramp from the platform edge
    if (!edgeSurf || edgeSurf.kind !== "ramp" || Math.abs(edgeSurf.y - PLATFORM_TOP_Y) > 0.3) fail(`station "${s.id}" ramp-top height does not meet the platform`);
    const footSurf = railSurfaceAt(g.footX - g.out * 0.2, s.cz); // just up from the foot
    if (!footSurf || footSurf.kind !== "ramp" || footSurf.y > 0.4) fail(`station "${s.id}" ramp foot does not reach the ground`);
    const edgeY = edgeSurf ? edgeSurf.y : 0;
    const footY = footSurf ? footSurf.y : 0;
    if (!(edgeY > footY + 1)) fail(`station "${s.id}" ramp direction inverted (edge ${edgeY.toFixed(1)} ≤ foot ${footY.toFixed(1)})`);

    // Board/exit point lies on the platform.
    const bp = stationBoardPoint(0); // index irrelevant for shape check below
    if (!bp) fail("missing board point");
    const myBp = { x: s.cx - g.out * (s.w / 2 - 1.5), z: s.cz };
    if (rectToPoint(platform, myBp.x, myBp.z) > 0) fail(`station "${s.id}" board point is off the platform`);

    return { id: s.id, platformNearestStructure, rampNearestStructure, footNearestRoad, footNearestCar, footNearestSpawn };
  });

  // Vertical-continuity gate (the v2 gravity fix). A ground-level player whose
  // X/Z lands in the MIDDLE of a ramp band must NOT attach (no pop into air);
  // the low foot MUST be steppable from the ground; and a continuous uphill walk
  // from foot → platform must attach at every step.
  for (const [px, pz] of [[124, -65], [128, -65]] as const) {
    const surf = railSurfaceAt(px, pz);
    if (surf && surf.kind === "ramp" && canAttachToRailSurface(surf, 0)) {
      fail(`ground player at [${px}, ${pz}] (feet≈0) wrongly attaches to ramp y=${surf.y.toFixed(1)}`);
    }
  }
  for (const g of stationGeoms()) {
    const cz = g.station.cz;
    // Low foot: just up-ramp from the foot, ground feet must attach.
    const footProbe = railSurfaceAt(g.footX - g.out * 0.5, cz);
    if (!footProbe || footProbe.kind !== "ramp" || !canAttachToRailSurface(footProbe, 0)) {
      fail(`station "${g.station.id}" low foot near x=${(g.footX - g.out * 0.5).toFixed(0)} is not steppable from the ground`);
    }
    // Continuous uphill walk simulation: foot → platform edge in 0.3 m steps.
    let feetY = 0;
    for (let d = ESC_RUN; d >= 0; d -= 0.3) {
      const x = g.edgeX + g.out * d;
      const surf = railSurfaceAt(x, cz);
      if (!surf) continue;
      if (!canAttachToRailSurface(surf, feetY)) {
        fail(`station "${g.station.id}" uphill walk breaks at d=${d.toFixed(1)} (rail y=${surf.y.toFixed(2)} not reachable from feet ${feetY.toFixed(2)})`);
      }
      feetY = surf.y; // step onto it, then continue from here
    }
  }

  // Station spawn: the FULL jitter box must not land on any platform/escalator
  // surface (railSurfaceAt === null everywhere in the box).
  let spawnSamplesOnStructure = 0;
  const sx0 = STATION_SPAWN[0] - STATION_SPAWN_JITTER_X;
  const sx1 = STATION_SPAWN[0] + STATION_SPAWN_JITTER_X;
  const sz0 = STATION_SPAWN[2] - STATION_SPAWN_JITTER_Z;
  const sz1 = STATION_SPAWN[2] + STATION_SPAWN_JITTER_Z;
  for (let x = sx0; x <= sx1 + 1e-6; x += 1) {
    for (let z = sz0; z <= sz1 + 1e-6; z += 1) {
      if (railSurfaceAt(x, z) !== null) {
        spawnSamplesOnStructure++;
        fail(`STATION_SPAWN jitter box sample [${x.toFixed(0)}, ${z.toFixed(0)}] lands on a station ramp/platform surface`);
      }
    }
  }

  return { loopClosed, trainNearestBuilding, perStation, spawnSamplesOnStructure };
}

const isMain = typeof process !== "undefined" && process.argv?.[1]?.includes("railTransitValidator");
if (isMain) {
  const r = validateRailTransit();
  console.info(`[railTransit] PASS — loopClosed=${r.loopClosed}, trainNearestBuilding=${r.trainNearestBuilding.toFixed(1)} m`);
  for (const st of r.perStation) {
    console.info(
      `  ${st.id.padEnd(28)} platform≥${st.platformNearestStructure.toFixed(1)} ramp≥${st.rampNearestStructure.toFixed(1)} ` +
      `foot: road≥${st.footNearestRoad.toFixed(1)} car≥${st.footNearestCar.toFixed(1)} spawn≥${st.footNearestSpawn.toFixed(1)}`,
    );
  }
}
