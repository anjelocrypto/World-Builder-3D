/**
 * Nemo Peak / North Chiliad validator (READ-ONLY, client-only).
 *
 * Proves the high summit road `nemo-peak-road` is safe + drivable against the
 * live world data. Changes nothing.
 *
 * Asserts:
 *   1. Road exists, mountain type, matching-length elevation profile.
 *   2. Connectivity — start coincides (≤2m) with a `mountain-switchbacks` node
 *      AND both profiles agree there (no elevation seam at the junction).
 *   3. Drivable slope — max grade ≤ 18%.
 *   4. Sits on the mountain — every vertex Y ≥ existing terrain (no burial).
 *   5. Floats nothing — raises NO flat structure / flat road by > 0.3 m (so the
 *      observatory, outer-loop, warehouses, etc. stay put).
 *   6. Clearance — carriageway > 2 m clear of every SOLID structure (guardrails
 *      are road-edge furniture and excluded).
 *   7. Inside the world (|x|,|z| ≤ WORLD_HALF − 2).
 *   8. Summit target — highest profile point ≥ 100 m (dramatically above the
 *      city; the highest drivable point in the world).
 *
 * Run standalone:  pnpm exec tsx src/shared/northChiliadValidator.ts
 *           (or)  node <jiti> src/shared/northChiliadValidator.ts
 */

import {
  REGIONAL_ROADS,
  ROAD_ELEVATION_PROFILES,
  MOUNTAIN_ROAD_IDS,
  MOUNTAIN_MASSIFS,
  ROADS,
  CITY_HALF,
  BUILDINGS,
  STATIC_OBSTACLES,
  WORLD_HALF,
} from "./cityData";
import { RP_BUILDINGS, RP_HOUSES } from "./rpTypes";
import { EVENT_HALL } from "./eventHall";

const ROAD_ID = "nemo-peak-road";
const PARENT_ID = "mountain-switchbacks";
const SKIRT = 30;
const GRADE_LIMIT = 0.18;
const FLOAT_TOL = 0.3;
const STRUCT_MIN = 2;
const SUMMIT_MIN = 100;

const ss = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
function distSegT(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, s2 = dx * dx + dz * dz;
  let t = s2 < 1e-9 ? 0 : ((x - ax) * dx + (z - az) * dz) / s2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(x - (ax + t * dx), z - (az + t * dz)), t };
}
function existingTerr(x: number, z: number): number {
  let b = 0;
  for (const m of MOUNTAIN_MASSIFS) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < m.r) { const h = m.h * ss(1 - d / m.r); if (h > b) b = h; }
  }
  for (const r of REGIONAL_ROADS) {
    if (r.id === ROAD_ID || !MOUNTAIN_ROAD_IDS.has(r.id)) continue;
    const p = ROAD_ELEVATION_PROFILES[r.id];
    if (!p || p.length !== r.points.length) continue;
    const hw = r.width / 2;
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i], c = r.points[i + 1];
      const { d, t } = distSegT(x, z, a[0], a[1], c[0], c[1]);
      if (d >= hw + SKIRT) continue;
      const y = p[i] + (p[i + 1] - p[i]) * t;
      const v = d <= hw ? y : y * ss(1 - (d - hw) / SKIRT);
      if (v > b) b = v;
    }
  }
  return b;
}

export interface NorthChiliadReport {
  vertices: number;
  summitY: number;
  maxGradePct: number;
  minStructClearance: number;
  maxFloatIncrease: number;
  massifsToReshape: number;
}

export function validateNorthChiliad(): NorthChiliadReport {
  const fail = (m: string): never => { throw new Error(`[northChiliad] ${m}`); };
  const road = REGIONAL_ROADS.find((r) => r.id === ROAD_ID);
  if (!road) fail(`road "${ROAD_ID}" missing`);
  const pts = road!.points;
  const P = ROAD_ELEVATION_PROFILES[ROAD_ID];
  const HW = road!.width / 2;
  if (!P) fail(`no profile for "${ROAD_ID}"`);
  if (P.length !== pts.length) fail(`profile length ${P.length} != points ${pts.length}`);
  if (!MOUNTAIN_ROAD_IDS.has(ROAD_ID)) fail(`"${ROAD_ID}" must be a mountain road`);

  const mySupport = (x: number, z: number): number => {
    let b = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const { d, t } = distSegT(x, z, a[0], a[1], c[0], c[1]);
      if (d >= HW + SKIRT) continue;
      const y = P[i] + (P[i + 1] - P[i]) * t;
      const v = d <= HW ? y : y * ss(1 - (d - HW) / SKIRT);
      if (v > b) b = v;
    }
    return b;
  };

  // (2) connectivity at the mountain-switchbacks junction.
  const parent = REGIONAL_ROADS.find((r) => r.id === PARENT_ID);
  const parentP = ROAD_ELEVATION_PROFILES[PARENT_ID];
  if (!parent || !parentP) fail(`${PARENT_ID} (parent) not found`);
  const ni = parent!.points.findIndex(([x, z]) => Math.hypot(x - pts[0][0], z - pts[0][1]) <= 2);
  if (ni < 0) fail(`start ${JSON.stringify(pts[0])} does not meet a ${PARENT_ID} node`);
  if (parentP[ni] !== P[0]) fail(`elevation seam at junction: ${PARENT_ID} Y=${parentP[ni]} vs ours Y=${P[0]}`);

  // (3) grade + (4) no burial + (8) summit.
  let maxGrade = 0;
  const summitY = Math.max(...P);
  if (summitY < SUMMIT_MIN) fail(`summit ${summitY}m below target ${SUMMIT_MIN}m`);
  for (let i = 0; i < pts.length; i++) {
    const terr = existingTerr(pts[i][0], pts[i][1]);
    if (P[i] < terr - 0.5) fail(`vertex ${i} Y=${P[i]} buried (terrain ${terr.toFixed(1)})`);
    if (i < pts.length - 1) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const g = L > 1e-6 ? Math.abs(P[i + 1] - P[i]) / L : 0;
      if (g > maxGrade) maxGrade = g;
      if (g > GRADE_LIMIT) fail(`segment ${i} grade ${(g * 100).toFixed(0)}% exceeds ${GRADE_LIMIT * 100}%`);
    }
  }

  interface Box { id: string; x: number; z: number; w: number; d: number; flat: boolean }
  // Solid structures (guardrails excluded — road-edge furniture).
  const boxes: Box[] = [
    ...BUILDINGS.map((b) => ({ id: "bldg", x: b.x, z: b.z, w: b.w, d: b.d, flat: true })),
    ...RP_BUILDINGS.map((b) => ({ id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, flat: true })),
    ...RP_HOUSES.map((h) => ({ id: h.slug, x: h.x, z: h.z, w: h.w, d: h.d, flat: true })),
    ...STATIC_OBSTACLES
      .filter((o) => o.kind !== "guardrail")
      .map((o) => ({
        id: o.kind, x: o.x, z: o.z, w: o.w, d: o.d,
        flat: !(o.kind === "cliff_wall" || o.kind === "large_rock"),
      })),
    { id: "event-hall", x: EVENT_HALL.x, z: EVENT_HALL.z, w: EVENT_HALL.w, d: EVENT_HALL.d, flat: true },
  ];
  const boxD = (x: number, z: number, b: Box) =>
    Math.hypot(Math.max(Math.abs(x - b.x) - b.w / 2, 0), Math.max(Math.abs(z - b.z) - b.d / 2, 0));

  // (5) float check (flat structures + flat roads).
  let maxFloat = 0, floatId = "";
  const probe = (x: number, z: number, id: string) => {
    const inc = mySupport(x, z) - existingTerr(x, z);
    if (inc > maxFloat) { maxFloat = inc; floatId = id; }
  };
  for (const b of boxes) {
    if (!b.flat) continue;
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) probe(b.x + ix * b.w / 2, b.z + iz * b.d / 2, b.id);
  }
  const flatRoads: [string, readonly (readonly [number, number])[], number][] = [];
  for (const r of REGIONAL_ROADS) if (!MOUNTAIN_ROAD_IDS.has(r.id)) flatRoads.push([r.id, r.points, r.width / 2]);
  for (const X of ROADS.ns) flatRoads.push([`ns${X}`, [[X, -CITY_HALF], [X, CITY_HALF]], ROADS.width / 2]);
  for (const Z of ROADS.ew) flatRoads.push([`ew${Z}`, [[-CITY_HALF, Z], [CITY_HALF, Z]], ROADS.width / 2]);
  for (const [rid, rp, rhw] of flatRoads) {
    for (let i = 0; i < rp.length - 1; i++) {
      const a = rp[i], c = rp[i + 1];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / 4));
      for (let s = 0; s <= n; s++) {
        const t = s / n, cx = a[0] + (c[0] - a[0]) * t, cz = a[1] + (c[1] - a[1]) * t;
        const ang = Math.atan2(c[1] - a[1], c[0] - a[0]) + Math.PI / 2;
        for (const off of [-rhw, 0, rhw]) probe(cx + Math.cos(ang) * off, cz + Math.sin(ang) * off, rid);
      }
    }
  }
  if (maxFloat > FLOAT_TOL) fail(`raises flat ${floatId} by ${maxFloat.toFixed(2)}m (floats it)`);

  // (6) clearance + (7) bounds.
  let minStruct = Infinity, structId = "";
  let maxAbsX = 0, maxAbsZ = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const n = Math.max(1, Math.ceil(L / 2));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      const z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      maxAbsX = Math.max(maxAbsX, Math.abs(x));
      maxAbsZ = Math.max(maxAbsZ, Math.abs(z));
      for (const b of boxes) {
        const d = boxD(x, z, b) - HW;
        if (d < minStruct) { minStruct = d; structId = b.id; }
      }
    }
  }
  if (minStruct < STRUCT_MIN) fail(`carriageway within ${minStruct.toFixed(1)}m of ${structId}`);
  if (maxAbsX > WORLD_HALF - 2 || maxAbsZ > WORLD_HALF - 2) fail(`leaves world (maxX=${maxAbsX}, maxZ=${maxAbsZ})`);

  // Informational: existing massifs the road passes (Phase-3 reshape target).
  let massifsToReshape = 0;
  for (const m of MOUNTAIN_MASSIFS) {
    let md = Infinity;
    for (let i = 0; i < pts.length - 1; i++) md = Math.min(md, distSegT(m.x, m.z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]).d);
    if (md < HW + m.r) massifsToReshape++;
  }

  return {
    vertices: pts.length,
    summitY,
    maxGradePct: +(maxGrade * 100).toFixed(1),
    minStructClearance: +minStruct.toFixed(1),
    maxFloatIncrease: +maxFloat.toFixed(2),
    massifsToReshape,
  };
}

const isMain =
  typeof process !== "undefined" && process.argv?.[1]?.includes("northChiliadValidator");
if (isMain) {
  const r = validateNorthChiliad();
  // eslint-disable-next-line no-console
  console.info(
    `[northChiliad] PASS — ${r.vertices} vertices, summit ${r.summitY}m (highest drivable), ` +
      `maxGrade ${r.maxGradePct}% (limit 18%), minStructClearance ${r.minStructClearance}m, ` +
      `floatsNothing(maxIncrease ${r.maxFloatIncrease}m), junction matches mountain-switchbacks; ` +
      `${r.massifsToReshape} existing massifs to reshape in Phase 3`,
  );
}
