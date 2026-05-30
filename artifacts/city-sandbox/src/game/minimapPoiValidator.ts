/**
 * Minimap POI validator (read-only, client-only).
 *
 * Asserts the data-driven blip layer stays sane as the underlying world
 * constants evolve:
 *   - every POI is within world bounds and has finite coords,
 *   - ids are unique, labels/icons/colors are non-empty, size > 0,
 *   - the list is sorted by ascending priority (so high-priority blips
 *     paint last / on top), and
 *   - the expected source categories are all represented (buildings,
 *     stations, hall, houses, ATMs).
 *
 * Run standalone: `node <jiti> src/game/minimapPoiValidator.ts`.
 */

import { MINIMAP_POIS } from "./minimapPois";
import { WORLD_HALF } from "../shared/cityData";
import { RP_BUILDINGS, RP_HOUSES, ATM_LOCATIONS } from "../shared/rpTypes";
import { TRAIN_STATIONS } from "../shared/cityData";

export interface MinimapPoiReport {
  total: number;
  buildings: number;
  stations: number;
  houses: number;
  atms: number;
  hall: number;
  turf: number;
}

export function validateMinimapPois(): MinimapPoiReport {
  const fail = (m: string): never => { throw new Error(`[minimap] ${m}`); };

  if (MINIMAP_POIS.length === 0) fail("no POIs generated");

  const seen = new Set<string>();
  let prevPriority = -Infinity;
  for (const p of MINIMAP_POIS) {
    if (seen.has(p.id)) fail(`duplicate POI id: ${p.id}`);
    seen.add(p.id);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) fail(`${p.id}: non-finite coord`);
    if (Math.abs(p.x) > WORLD_HALF || Math.abs(p.z) > WORLD_HALF) {
      fail(`${p.id}: out of world bounds [${p.x}, ${p.z}]`);
    }
    if (!p.label) fail(`${p.id}: empty label`);
    if (!p.icon) fail(`${p.id}: empty icon`);
    if (!p.color) fail(`${p.id}: empty color`);
    if (!(p.size > 0)) fail(`${p.id}: size must be > 0`);
    if (p.priority < prevPriority) fail(`${p.id}: list not sorted by ascending priority`);
    prevPriority = p.priority;
  }

  const count = (prefix: string) => MINIMAP_POIS.filter((p) => p.id.startsWith(prefix)).length;
  const r: MinimapPoiReport = {
    total: MINIMAP_POIS.length,
    buildings: count("bld-"),
    stations: count("station-"),
    houses: count("house-"),
    atms: MINIMAP_POIS.filter((p) => p.id.startsWith("atm-")).length,
    hall: count("hall-"),
    turf: count("turf-"),
  };

  // Every source category must be fully represented (no silent drops).
  if (r.buildings !== RP_BUILDINGS.length) fail(`buildings ${r.buildings} != RP_BUILDINGS ${RP_BUILDINGS.length}`);
  if (r.stations !== TRAIN_STATIONS.length) fail(`stations ${r.stations} != TRAIN_STATIONS ${TRAIN_STATIONS.length}`);
  if (r.houses !== RP_HOUSES.length) fail(`houses ${r.houses} != RP_HOUSES ${RP_HOUSES.length}`);
  if (r.atms !== ATM_LOCATIONS.length) fail(`atms ${r.atms} != ATM_LOCATIONS ${ATM_LOCATIONS.length}`);
  if (r.hall !== 1) fail(`expected exactly 1 hall, got ${r.hall}`);

  return r;
}

const isMain = typeof process !== "undefined" && process.argv?.[1]?.includes("minimapPoiValidator");
if (isMain) {
  const r = validateMinimapPois();
  console.info(
    `[minimap] PASS — ${r.total} POIs (${r.buildings} buildings, ${r.stations} stations, ` +
    `${r.hall} hall, ${r.houses} houses, ${r.turf} turf, ${r.atms} ATMs)`,
  );
}
