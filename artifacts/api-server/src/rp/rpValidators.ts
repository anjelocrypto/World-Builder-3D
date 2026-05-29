/**
 * RP startup validators. All functions here are called ONCE before the
 * Socket.io server accepts connections. If any assertion throws, the server
 * exits immediately — a bad spawn position must be caught before players
 * connect, not after.
 *
 * Coordinate conventions:
 *  - Road carriageways: N-S at x ∈ {−45, 0, 45}, E-W at z ∈ {−45, 0, 45},
 *    each 20 m wide (half-width = 10). Must match client cityData.ts ROADS.
 *  - rotY = 0 → vehicle front faces −Z (matches collision.ts + LocalPlayer).
 */

import {
  STATION_SPAWN,
  STATION_SPAWN_JITTER_X,
  STATION_SPAWN_JITTER_Z,
  DEALERSHIP_POS,
  DEALERSHIP_DELIVERY_PAD,
  DELIVERY_SLOT_OFFSETS,
  CITY_WORKER_DEPOT,
  CITY_WORKER_CHECKPOINTS,
  TAXI_DEPOT,
  TAXI_PICKUPS,
  TAXI_DROPOFFS,
  DELIVERY_HUB,
  DELIVERY_PICKUPS,
  DELIVERY_DROPOFFS,
  MECHANIC_GARAGE,
  MECHANIC_TARGETS,
  MEDIC_CENTER,
  MEDIC_PATIENT_CALLS,
  MEDIC_ER_BAY,
  POLICE_STATION,
  POLICE_PATROL_POINTS,
  ATM_LOCATIONS,
  POLICE_JAIL_CELL,
  POLICE_JAIL_RADIUS,
  POLICE_RELEASE_POS,
  POLICE_BOOKING_DESK_POS,
  GROVE_STREET_HANGOUT_POS,
  GROVE_STREET_TURF_CENTER,
  GROVE_STREET_TURF_RADIUS,
  GROVE_TAG_POINTS,
  GANG_TERRITORIES,
  GOVERNMENT_OFFICE_POS,
  RP_BUILDINGS,
  RP_BUILDING_MIN_GAP,
  rpBuildingDoor,
  RP_HOUSES,
  HOUSE_INTERACT_RADIUS,
  isInsideHouseFootprint,
} from "../socket/cityData";
import type { RpBuildingDef, RpHouseDef } from "../socket/cityData";
import type { RpCacheEntry, TestState } from "./rpCache";

// ── Local geometry types ───────────────────────────────────────────────────

/** Axis-aligned rectangle on the X/Z plane (no Y). */
interface StaticObstacle {
  x: number;
  z: number;
  w: number;   // total width along X
  d: number;   // total depth along Z
}

/** Minimal vehicle record — only the position is needed for clearance checks. */
interface VehiclePos {
  x: number;
  z: number;
}

// ── Road carriageway constants ─────────────────────────────────────────────

const NS_ROADS_X = [-45, 0, 45] as const;
const EW_ROADS_Z = [-45, 0, 45] as const;
const ROAD_HALF  = 10;

// ── §12.1 Carriageway check ────────────────────────────────────────────────

/** True if (x, z) falls within any road carriageway. */
export function isInCarriageway(x: number, z: number): boolean {
  for (const rx of NS_ROADS_X) if (Math.abs(x - rx) < ROAD_HALF) return true;
  for (const rz of EW_ROADS_Z) if (Math.abs(z - rz) < ROAD_HALF) return true;
  return false;
}

// ── §12.2 On-road check (checkpoint validation) ───────────────────────────

/** True if (x, z) is on a road carriageway (checkpoints must be on roads). */
export function isOnRoad(x: number, z: number): boolean {
  return isInCarriageway(x, z);
}

// ── §12.3 Static obstacle overlap ─────────────────────────────────────────

/**
 * True if (x, z) is inside any obstacle AABB, expanded by `margin`.
 * @param margin  Extra clearance in metres (default 1 m).
 */
export function isInsideObstacle(
  x: number,
  z: number,
  obstacles: StaticObstacle[],
  margin = 1,
): boolean {
  for (const o of obstacles) {
    if (
      Math.abs(x - o.x) < o.w / 2 + margin &&
      Math.abs(z - o.z) < o.d / 2 + margin
    ) {
      return true;
    }
  }
  return false;
}

// ── Phase 9A Batch B: building footprint checks ────────────────────────────

/**
 * True if an axis-aligned footprint (centre cx,cz, size w×d) overlaps any road
 * carriageway, optionally expanded by `margin` metres of required clearance.
 * Unlike isInCarriageway (a point test), this tests the whole rectangle.
 */
export function footprintHitsRoad(
  cx: number,
  cz: number,
  w: number,
  d: number,
  margin = 0,
): boolean {
  const x0 = cx - w / 2 - margin, x1 = cx + w / 2 + margin;
  const z0 = cz - d / 2 - margin, z1 = cz + d / 2 + margin;
  for (const rx of NS_ROADS_X) if (x1 > rx - ROAD_HALF && x0 < rx + ROAD_HALF) return true;
  for (const rz of EW_ROADS_Z) if (z1 > rz - ROAD_HALF && z0 < rz + ROAD_HALF) return true;
  return false;
}

/**
 * Phase 13A (Batch B): bounded variant of footprintHitsRoad.
 *
 * footprintHitsRoad above treats each central road centerline as an INFINITE
 * line (no length bound). That is a safe (stricter) superset for objects inside
 * the city core, but it is WRONG for peri-city objects: a footprint far north
 * at x≈45 would be falsely flagged as on the "x=45" road even though that grid
 * road only spans z∈[-CITY_GRID_HALF, +CITY_GRID_HALF]. This bounded version
 * only reports an overlap when the footprint also lies within the road's actual
 * length, so it is correct for objects placed outside the core (e.g. the
 * relocated RP houses). The central grid roads run the full ±CITY_GRID_HALF.
 */
const CITY_GRID_HALF = 100;
export function footprintHitsCentralRoadBounded(
  cx: number,
  cz: number,
  w: number,
  d: number,
  margin = 0,
): boolean {
  const x0 = cx - w / 2 - margin, x1 = cx + w / 2 + margin;
  const z0 = cz - d / 2 - margin, z1 = cz + d / 2 + margin;
  // N-S roads run along z within [-CITY_GRID_HALF, CITY_GRID_HALF].
  for (const rx of NS_ROADS_X)
    if (x1 > rx - ROAD_HALF && x0 < rx + ROAD_HALF &&
        z1 > -CITY_GRID_HALF && z0 < CITY_GRID_HALF) return true;
  // E-W roads run along x within [-CITY_GRID_HALF, CITY_GRID_HALF].
  for (const rz of EW_ROADS_Z)
    if (z1 > rz - ROAD_HALF && z0 < rz + ROAD_HALF &&
        x1 > -CITY_GRID_HALF && x0 < CITY_GRID_HALF) return true;
  return false;
}

/** Edge-to-edge gap (m) between two AABB footprints; negative = overlap. */
function footprintGap(a: RpBuildingDef, b: RpBuildingDef): number {
  return Math.max(
    Math.abs(a.x - b.x) - (a.w / 2 + b.w / 2),
    Math.abs(a.z - b.z) - (a.d / 2 + b.d / 2),
  );
}

/** Distance from a point to a footprint's nearest edge (0 if inside). */
function distPointToFootprint(px: number, pz: number, b: RpBuildingDef): number {
  const dx = Math.max(Math.abs(px - b.x) - b.w / 2, 0);
  const dz = Math.max(Math.abs(pz - b.z) - b.d / 2, 0);
  return Math.hypot(dx, dz);
}

/**
 * Startup assertion — throws if any RP building footprint:
 *   1. overlaps a road carriageway (footprintHitsRoad),
 *   2. comes within RP_BUILDING_MIN_GAP of another building footprint,
 *   3. has a parked vehicle inside it (vehicleFootprintClearance margin),
 *   4. has an unreachable entrance (door on a road, or inside any footprint).
 *
 * Read-only geometry check; mirrors RP_BUILDINGS, which mirrors the *_POS
 * constants. Called once at startup before connections are accepted.
 *
 * @param vehicles               Parked vehicle positions (server INITIAL_VEHICLES).
 * @param vehicleFootprintMargin Clearance (m) required between a parked car and
 *                               any building wall (default 1 m).
 */
export function validateRpBuildings(
  vehicles: VehiclePos[],
  vehicleFootprintMargin = 1,
): void {
  for (let i = 0; i < RP_BUILDINGS.length; i++) {
    const b = RP_BUILDINGS[i];

    // 1. Footprint vs road carriageway.
    if (footprintHitsRoad(b.x, b.z, b.w, b.d)) {
      throw new Error(`[rp] building "${b.id}" footprint overlaps a road carriageway`);
    }

    // 2. Footprint vs every other building.
    for (let j = i + 1; j < RP_BUILDINGS.length; j++) {
      const other = RP_BUILDINGS[j];
      const gap = footprintGap(b, other);
      if (gap < RP_BUILDING_MIN_GAP) {
        throw new Error(
          `[rp] buildings "${b.id}" and "${other.id}" are only ${gap.toFixed(1)} m apart ` +
          `(min ${RP_BUILDING_MIN_GAP} m)`,
        );
      }
    }

    // 3. Footprint vs parked cars.
    for (const v of vehicles) {
      if (distPointToFootprint(v.x, v.z, b) < vehicleFootprintMargin) {
        throw new Error(`[rp] building "${b.id}" footprint is within ${vehicleFootprintMargin} m of a parked vehicle`);
      }
    }

    // 4. Entrance reachability — door must be off-road and outside all footprints.
    const [doorX, doorZ] = rpBuildingDoor(b);
    if (isInCarriageway(doorX, doorZ)) {
      throw new Error(`[rp] building "${b.id}" entrance [${doorX}, ${doorZ}] is on a road carriageway`);
    }
    for (const o of RP_BUILDINGS) {
      if (distPointToFootprint(doorX, doorZ, o) <= 0) {
        throw new Error(`[rp] building "${b.id}" entrance [${doorX}, ${doorZ}] is inside building "${o.id}"`);
      }
    }

    // 5. Phase 10A — the doorway must not be blocked by the building's own wall
    //    segments. Derive the 5 per-wall boxes (back + 2 sides + 2 front jambs
    //    around the doorway gap) and assert the door point lies in the open gap.
    const WALL_T = 0.5;
    const DOOR_W = 3.0;
    const fz = b.facing === "north" || b.facing === "south";
    const sgn = b.facing === "north" || b.facing === "west" ? -1 : 1;
    const hw = b.w / 2, hd = b.d / 2;
    const wallBoxes: { x: number; z: number; w: number; d: number }[] = [];
    if (fz) {
      wallBoxes.push({ x: b.x, z: b.z - sgn * hd, w: b.w, d: WALL_T });
      wallBoxes.push({ x: b.x - hw, z: b.z, w: WALL_T, d: b.d });
      wallBoxes.push({ x: b.x + hw, z: b.z, w: WALL_T, d: b.d });
      const jamb = (b.w - DOOR_W) / 2;
      wallBoxes.push({ x: b.x - (DOOR_W / 2 + jamb / 2), z: b.z + sgn * hd, w: jamb, d: WALL_T });
      wallBoxes.push({ x: b.x + (DOOR_W / 2 + jamb / 2), z: b.z + sgn * hd, w: jamb, d: WALL_T });
    } else {
      wallBoxes.push({ x: b.x - sgn * hw, z: b.z, w: WALL_T, d: b.d });
      wallBoxes.push({ x: b.x, z: b.z - hd, w: b.w, d: WALL_T });
      wallBoxes.push({ x: b.x, z: b.z + hd, w: b.w, d: WALL_T });
      const jamb = (b.d - DOOR_W) / 2;
      wallBoxes.push({ x: b.x + sgn * hw, z: b.z - (DOOR_W / 2 + jamb / 2), w: WALL_T, d: jamb });
      wallBoxes.push({ x: b.x + sgn * hw, z: b.z + (DOOR_W / 2 + jamb / 2), w: WALL_T, d: jamb });
    }
    for (const wbox of wallBoxes) {
      if (Math.abs(doorX - wbox.x) < wbox.w / 2 && Math.abs(doorZ - wbox.z) < wbox.d / 2) {
        throw new Error(`[rp] building "${b.id}" entrance [${doorX}, ${doorZ}] is blocked by its own wall`);
      }
    }

    console.info(`[rp] building OK: ${b.id} (${b.w}x${b.d} @ [${b.x}, ${b.z}], door [${doorX}, ${doorZ}])`);
  }

  // Phase 10C — the jail confinement circle must fit inside the (now solid)
  // police station walls and must not reach the open front doorway, or the
  // server clamp would fight client wall collision (jitter/stuck) and jailed
  // players could slip out. Computed from POLICE_JAIL_CELL + POLICE_JAIL_RADIUS
  // vs. the police_station interior bounds.
  const police = RP_BUILDINGS.find((b) => b.id === "police_station");
  if (police) {
    const WALL_T = 0.5;
    const PLAYER_BUFFER = 0.55; // body radius 0.45 + small margin
    const [jcx, , jcz] = POLICE_JAIL_CELL;
    // Inner wall-face distances from the jail cell (cell is at the station centre).
    const innerHalfW = police.w / 2 - WALL_T / 2 - Math.abs(jcx - police.x);
    const innerHalfD = police.d / 2 - WALL_T / 2 - Math.abs(jcz - police.z);
    const maxRadius = Math.min(innerHalfW, innerHalfD) - PLAYER_BUFFER;
    if (POLICE_JAIL_RADIUS > maxRadius) {
      throw new Error(
        `[rp] POLICE_JAIL_RADIUS=${POLICE_JAIL_RADIUS} exceeds the safe interior radius ` +
        `${maxRadius.toFixed(2)} m — the jail confinement circle would cross the station walls`,
      );
    }
    // The confinement circle (toward the door) must stop short of the doorway
    // threshold so a jailed player can't reach the open door before release.
    const [pdx, pdz] = rpBuildingDoor(police);
    const doorDist = Math.hypot(pdx - jcx, pdz - jcz);
    if (POLICE_JAIL_RADIUS + PLAYER_BUFFER >= doorDist) {
      throw new Error(
        `[rp] POLICE_JAIL_RADIUS=${POLICE_JAIL_RADIUS} reaches the station doorway ` +
        `(${doorDist.toFixed(2)} m away) — a jailed player could escape before release`,
      );
    }
    console.info(`[rp] jail confinement OK: radius ${POLICE_JAIL_RADIUS} fits interior + clears door`);
  }
}

/**
 * Phase 12A — startup assertion for the starter player houses. Throws if any
 * house footprint or door violates placement rules. Read-only geometry check
 * over RP_HOUSES; mirrors the client RP_HOUSES used for collision + rendering.
 *
 * Asserts, for each house:
 *   1. footprint clears every road carriageway,
 *   2. footprint keeps ≥ RP_BUILDING_MIN_GAP from every RP building,
 *   3. no parked car sits inside the footprint (+ margin),
 *   4. the door point is OFF-road, OUTSIDE the shell, and within reach
 *      (≤ HOUSE_INTERACT_RADIUS of the shell) so entry/exit can never trap,
 *   5. houses don't overlap each other (so interiors — which are the shells —
 *      never overlap), and
 *   6. the interior teleport target is inside its own footprint (owner lands
 *      inside the sealed shell).
 */
export function validateRpHouses(
  vehicles: VehiclePos[],
  vehicleFootprintMargin = 1,
): void {
  const gap = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }) =>
    Math.max(Math.abs(a.x - b.x) - (a.w / 2 + b.w / 2), Math.abs(a.z - b.z) - (a.d / 2 + b.d / 2));
  const insideFootprint = (px: number, pz: number, h: RpHouseDef) =>
    Math.abs(px - h.x) <= h.w / 2 && Math.abs(pz - h.z) <= h.d / 2;

  for (let i = 0; i < RP_HOUSES.length; i++) {
    const h = RP_HOUSES[i];

    // 1. off-road footprint (bounded central-road check — houses are peri-city,
    //    so the infinite-line variant would mis-handle them).
    if (footprintHitsCentralRoadBounded(h.x, h.z, h.w, h.d)) {
      throw new Error(`[rp] house "${h.slug}" footprint overlaps a central road carriageway`);
    }

    // 1b. Phase 13A — clear of the entire city-core envelope. The inner-city-ring
    // road sits at |x|=|z|=100 with width 12 → its outer edge is at 106. EVERYTHING
    // in the core (the ±45 grid roads, all 52 procedural buildings, all 13 highrise/
    // landmark towers, and the ring road itself) is contained within the square
    // [-106,106]². Requiring each house footprint to clear that square on at least
    // one axis therefore guarantees no overlap with ANY of them — without the
    // api-server importing client geometry (BUILDINGS/REGIONAL_ROADS live in
    // city-sandbox). This catches the Phase 12A regression where the (±92) houses
    // clipped the ±87 landmark towers and the ±100 ring road. The literal
    // house-vs-full-BUILDINGS / vs-REGIONAL_ROADS check lives in the client dev
    // validation block (cityData.ts `if (isViteDev)`), where that data exists.
    const CITY_CORE_OUTER_RADIUS = 106;
    const CORE_MARGIN = 1;
    const clearOnX = Math.abs(h.x) - h.w / 2 >= CITY_CORE_OUTER_RADIUS + CORE_MARGIN;
    const clearOnZ = Math.abs(h.z) - h.d / 2 >= CITY_CORE_OUTER_RADIUS + CORE_MARGIN;
    if (!clearOnX && !clearOnZ) {
      throw new Error(
        `[rp] house "${h.slug}" footprint intersects the city-core envelope ` +
        `(|x|,|z| ≤ ${CITY_CORE_OUTER_RADIUS} m) — would clip the ring road, towers, or buildings`,
      );
    }

    // 2. clearance from every RP building
    for (const b of RP_BUILDINGS) {
      if (gap(h, b) < RP_BUILDING_MIN_GAP) {
        throw new Error(`[rp] house "${h.slug}" is within ${RP_BUILDING_MIN_GAP} m of building "${b.id}"`);
      }
    }

    // 3. no parked car inside the footprint (+ margin)
    for (const v of vehicles) {
      if (
        Math.abs(v.x - h.x) <= h.w / 2 + vehicleFootprintMargin &&
        Math.abs(v.z - h.z) <= h.d / 2 + vehicleFootprintMargin
      ) {
        throw new Error(`[rp] house "${h.slug}" footprint is within ${vehicleFootprintMargin} m of a parked vehicle`);
      }
    }

    // 4. door off-road, outside the shell, and reachable
    const [dx, , dz] = h.door;
    if (footprintHitsCentralRoadBounded(dx, dz, 0, 0)) {
      throw new Error(`[rp] house "${h.slug}" door [${dx}, ${dz}] is on a central road carriageway`);
    }
    if (insideFootprint(dx, dz, h)) {
      throw new Error(`[rp] house "${h.slug}" door [${dx}, ${dz}] is inside the sealed shell (would trap)`);
    }
    const doorReach = Math.max(Math.abs(dx - h.x) - h.w / 2, Math.abs(dz - h.z) - h.d / 2);
    if (doorReach > HOUSE_INTERACT_RADIUS) {
      throw new Error(`[rp] house "${h.slug}" door is ${doorReach.toFixed(2)} m from the shell — beyond reach ${HOUSE_INTERACT_RADIUS} m`);
    }

    // 5. no overlap with another house
    for (let j = i + 1; j < RP_HOUSES.length; j++) {
      if (gap(h, RP_HOUSES[j]) < RP_BUILDING_MIN_GAP) {
        throw new Error(`[rp] houses "${h.slug}" and "${RP_HOUSES[j].slug}" are within ${RP_BUILDING_MIN_GAP} m`);
      }
    }

    // 6. interior teleport target lands inside the shell
    if (!insideFootprint(h.interior[0], h.interior[2], h) || !isInsideHouseFootprint(h, h.interior[0], h.interior[2])) {
      throw new Error(`[rp] house "${h.slug}" interior target is not inside its shell`);
    }

    // 7. clearance from spawns / job-route + police markers / ATMs / gang points.
    //    edgeDist = footprint-edge → point distance (0 if the point is inside).
    const edgeDist = (px: number, pz: number) =>
      Math.hypot(Math.max(Math.abs(px - h.x) - h.w / 2, 0), Math.max(Math.abs(pz - h.z) - h.d / 2, 0));
    const MARKER_CLEARANCE = 4;
    const xz = (p: readonly [number, number, number]): [number, number] => [p[0], p[2]];
    const markerXZ: Array<[number, number]> = [
      xz(STATION_SPAWN),
      xz(POLICE_BOOKING_DESK_POS),
      xz(POLICE_RELEASE_POS),
      xz(POLICE_JAIL_CELL),
      xz(GROVE_STREET_HANGOUT_POS),
      ...CITY_WORKER_CHECKPOINTS.map(xz),
      ...TAXI_PICKUPS.map(xz), ...TAXI_DROPOFFS.map(xz),
      ...DELIVERY_PICKUPS.map(xz), ...DELIVERY_DROPOFFS.map(xz),
      ...MECHANIC_TARGETS.map(xz),
      ...MEDIC_PATIENT_CALLS.map(xz),
      ...POLICE_PATROL_POINTS.map(xz),
      ...ATM_LOCATIONS.map((a) => xz(a.pos)),
      ...GROVE_TAG_POINTS.map(xz),
    ];
    for (const [mx, mz] of markerXZ) {
      if (edgeDist(mx, mz) < MARKER_CLEARANCE) {
        throw new Error(`[rp] house "${h.slug}" footprint is within ${MARKER_CLEARANCE} m of a spawn/checkpoint/marker at [${mx}, ${mz}]`);
      }
    }
    // Gang turf is a circle — the footprint must stay fully outside it.
    if (edgeDist(GROVE_STREET_TURF_CENTER[0], GROVE_STREET_TURF_CENTER[2]) < GROVE_STREET_TURF_RADIUS) {
      throw new Error(`[rp] house "${h.slug}" footprint overlaps the Grove Street turf radius (${GROVE_STREET_TURF_RADIUS} m)`);
    }

    console.info(`[rp] house OK: ${h.slug} (${h.w}x${h.d} @ [${h.x}, ${h.z}], door [${dx}, ${dz}])`);
  }
}

/**
 * Startup assertion — throws if any RP marker violates road or obstacle rules.
 *
 * Phase 1B: pass `obstacles = []` — all spawn positions were pre-validated
 * against the full obstacle list in NEMOVERSE_RP_PLAN.md §5.3 + §6.2.
 * Phase 2: wire in the server-side static obstacle list when available.
 */
export function validateRpMarkers(obstacles: StaticObstacle[]): void {
  // Build delivery slot entries from DELIVERY_SLOT_OFFSETS
  const deliverySlotMarkers = DELIVERY_SLOT_OFFSETS.map(([dx, dz], i) => ({
    label: `DELIVERY_SLOT_${i}`,
    x: DEALERSHIP_DELIVERY_PAD[0] + dx,
    z: DEALERSHIP_DELIVERY_PAD[2] + dz,
  }));

  const OFF_ROAD = [
    { label: "STATION_SPAWN",           x: 128,                       z: -65 },
    // Phase 9B-3: licensing office/spawn/CP3 relocated (mirror cityData.ts).
    { label: "LICENSING_OFFICE_POS",    x:  17,                       z: -29 },
    { label: "TEST_VEHICLE_SPAWN",      x:  11,                       z: -30 },
    { label: "CP3_FINISH",              x:  17,                       z: -23.5 },
    // Phase 3
    { label: "DEALERSHIP_POS",          x: DEALERSHIP_POS[0],         z: DEALERSHIP_POS[2] },
    ...deliverySlotMarkers,
  ];
  const ON_ROAD = [
    { label: "CP0", x:  2, z: -40 },
    { label: "CP1", x: 42, z: -44 },
    { label: "CP2", x: 42, z: -14 },
  ];

  // Phase 4: City Worker depot + patrol checkpoints must be off-road
  const cityWorkerMarkers = [
    { label: "CITY_WORKER_DEPOT", x: CITY_WORKER_DEPOT[0], z: CITY_WORKER_DEPOT[2] },
    ...CITY_WORKER_CHECKPOINTS.map(([cx, , cz], i) => ({
      label: `CITY_WORKER_CP${i}`,
      x: cx,
      z: cz,
    })),
  ];

  // Phase 5A: Taxi Depot must be off-road
  const taxiMarkers = [
    { label: "TAXI_DEPOT", x: TAXI_DEPOT[0], z: TAXI_DEPOT[2] },
  ];

  // Phase 5B: Delivery Hub must be off-road
  const deliveryMarkers = [
    { label: "DELIVERY_HUB", x: DELIVERY_HUB[0], z: DELIVERY_HUB[2] },
  ];

  // Phase 5C: Mechanic Garage must be off-road
  const mechanicMarkers = [
    { label: "MECHANIC_GARAGE", x: MECHANIC_GARAGE[0], z: MECHANIC_GARAGE[2] },
  ];

  // Phase 5D: Medical Center must be off-road
  const medicOffRoadMarkers = [
    { label: "MEDIC_CENTER", x: MEDIC_CENTER[0], z: MEDIC_CENTER[2] },
  ];

  // Phase 5E: Police Station must be off-road
  // Phase 6A: Jail cell + release position must be off-road
  const policeOffRoadMarkers = [
    { label: "POLICE_STATION",       x: POLICE_STATION[0],          z: POLICE_STATION[2] },
    { label: "POLICE_JAIL_CELL",     x: POLICE_JAIL_CELL[0],        z: POLICE_JAIL_CELL[2] },
    { label: "POLICE_RELEASE_POS",   x: POLICE_RELEASE_POS[0],      z: POLICE_RELEASE_POS[2] },
    // Phase 6D: booking desk inside station
    { label: "POLICE_BOOKING_DESK",  x: POLICE_BOOKING_DESK_POS[0], z: POLICE_BOOKING_DESK_POS[2] },
  ];

  // Phase 5F: ATM machines must be off-road
  const atmOffRoadMarkers = ATM_LOCATIONS.map(({ id, pos }) => ({
    label: `ATM_${id}`,
    x: pos[0],
    z: pos[2],
  }));

  // Phase 5A: Taxi pickups + dropoffs must be on roads
  const taxiOnRoad = [
    ...TAXI_PICKUPS.map(([cx, , cz], i) => ({ label: `TAXI_PICKUP_${i}`, x: cx, z: cz })),
    ...TAXI_DROPOFFS.map(([cx, , cz], i) => ({ label: `TAXI_DROPOFF_${i}`, x: cx, z: cz })),
  ];

  // Phase 5B: Delivery pickups + dropoffs must be on roads
  const deliveryOnRoad = [
    ...DELIVERY_PICKUPS.map(([cx, , cz], i) => ({ label: `DELIVERY_PICKUP_${i}`, x: cx, z: cz })),
    ...DELIVERY_DROPOFFS.map(([cx, , cz], i) => ({ label: `DELIVERY_DROPOFF_${i}`, x: cx, z: cz })),
  ];

  // Phase 5C: Mechanic targets must be on roads
  const mechanicOnRoad = [
    ...MECHANIC_TARGETS.map(([cx, , cz], i) => ({ label: `MECHANIC_TARGET_${i}`, x: cx, z: cz })),
  ];

  // Phase 5D: Patient calls + ER bay must be on roads
  const medicOnRoad = [
    ...MEDIC_PATIENT_CALLS.map(([cx, , cz], i) => ({ label: `MEDIC_PATIENT_CALL_${i}`, x: cx, z: cz })),
    { label: "MEDIC_ER_BAY", x: MEDIC_ER_BAY[0], z: MEDIC_ER_BAY[2] },
  ];

  // Phase 5E: Patrol points must be on roads
  const policeOnRoad = [
    ...POLICE_PATROL_POINTS.map(([cx, , cz], i) => ({ label: `POLICE_PATROL_POINT_${i}`, x: cx, z: cz })),
  ];

  // Phase 7D: Grove Street gang markers must be off-road
  // Phase 7G: Tag Turf mission points must also be off-road
  // Phase 7H: territory centres (from GANG_TERRITORIES) must be off-road
  const gangOffRoadMarkers = [
    { label: "GROVE_STREET_HANGOUT_POS", x: GROVE_STREET_HANGOUT_POS[0], z: GROVE_STREET_HANGOUT_POS[2] },
    { label: "GROVE_STREET_TURF_CENTER", x: GROVE_STREET_TURF_CENTER[0],  z: GROVE_STREET_TURF_CENTER[2]  },
    ...GROVE_TAG_POINTS.map(([px, , pz], i) => ({ label: `GROVE_TAG_POINT_${i}`, x: px, z: pz })),
    // Phase 7H: dynamic loop so any future GANG_TERRITORIES entry is also covered.
    // GROVE_STREET_TURF_CENTER is already listed explicitly above; duplicates are
    // harmless (they just log twice) and catching a future mis-placed centre early
    // is worth the redundancy.
    ...GANG_TERRITORIES.map((t) => ({
      label: `GANG_TERRITORY_CENTER_${t.id}`,
      x:     t.center[0],
      z:     t.center[2],
    })),
  ];

  // Phase 8A: Government Office must be off-road
  const govOffRoadMarkers = [
    { label: "GOVERNMENT_OFFICE_POS", x: GOVERNMENT_OFFICE_POS[0], z: GOVERNMENT_OFFICE_POS[2] },
  ];

  for (const m of [...OFF_ROAD, ...cityWorkerMarkers, ...taxiMarkers, ...deliveryMarkers, ...mechanicMarkers, ...medicOffRoadMarkers, ...policeOffRoadMarkers, ...atmOffRoadMarkers, ...gangOffRoadMarkers, ...govOffRoadMarkers]) {
    if (isInCarriageway(m.x, m.z))
      throw new Error(`[rp] marker "${m.label}" is inside road carriageway`);
    if (isInsideObstacle(m.x, m.z, obstacles))
      throw new Error(`[rp] marker "${m.label}" overlaps static obstacle`);
    console.info(`[rp] marker OK: ${m.label} [${m.x}, ${m.z}]`);
  }

  for (const cp of [...ON_ROAD, ...taxiOnRoad, ...deliveryOnRoad, ...mechanicOnRoad, ...medicOnRoad, ...policeOnRoad]) {
    if (!isOnRoad(cp.x, cp.z))
      throw new Error(`[rp] checkpoint "${cp.label}" is NOT on a road`);
    if (isInsideObstacle(cp.x, cp.z, obstacles))
      throw new Error(`[rp] checkpoint "${cp.label}" overlaps static obstacle`);
    console.info(`[rp] checkpoint OK: ${cp.label} [${cp.x}, ${cp.z}]`);
  }
}

// ── §12.4 Parked-car clearance ─────────────────────────────────────────────

export function isNearParkedCar(
  x: number,
  z: number,
  vehicles: VehiclePos[],
  minClearance = 8,
): boolean {
  for (const v of vehicles) {
    const dx = x - v.x;
    const dz = z - v.z;
    if (Math.sqrt(dx * dx + dz * dz) < minClearance) return true;
  }
  return false;
}

/**
 * Startup assertion — throws if any RP marker is within 8 m of a parked car.
 */
export function validateRpMarkerVehicleClearance(vehicles: VehiclePos[]): void {
  const deliverySlotMarkers = DELIVERY_SLOT_OFFSETS.map(([dx, dz], i) => ({
    label: `DELIVERY_SLOT_${i}`,
    x: DEALERSHIP_DELIVERY_PAD[0] + dx,
    z: DEALERSHIP_DELIVERY_PAD[2] + dz,
  }));

  const markers = [
    // Phase 9B-3: licensing office/spawn relocated (mirror cityData.ts).
    { label: "LICENSING_OFFICE_POS",    x:  17,                       z: -29 },
    { label: "TEST_VEHICLE_SPAWN",      x:  11,                       z: -30 },
    { label: "STATION_SPAWN",           x: 128,                       z: -65 },
    // Phase 3 — dealership entrance + all delivery slots
    { label: "DEALERSHIP_POS",          x: DEALERSHIP_POS[0],         z: DEALERSHIP_POS[2] },
    ...deliverySlotMarkers,
    // Phase 4 — city worker depot
    { label: "CITY_WORKER_DEPOT",       x: CITY_WORKER_DEPOT[0],      z: CITY_WORKER_DEPOT[2] },
    // Phase 5A — taxi depot + all taxi pickup/dropoff route points
    { label: "TAXI_DEPOT",              x: TAXI_DEPOT[0],              z: TAXI_DEPOT[2] },
    ...TAXI_PICKUPS.map(([cx, , cz], i)  => ({ label: `TAXI_PICKUP_${i}`,   x: cx, z: cz })),
    ...TAXI_DROPOFFS.map(([cx, , cz], i) => ({ label: `TAXI_DROPOFF_${i}`,  x: cx, z: cz })),
    // Phase 5B — delivery hub + all delivery pickup/dropoff route points
    { label: "DELIVERY_HUB",            x: DELIVERY_HUB[0],            z: DELIVERY_HUB[2] },
    ...DELIVERY_PICKUPS.map(([cx, , cz], i)  => ({ label: `DELIVERY_PICKUP_${i}`,   x: cx, z: cz })),
    ...DELIVERY_DROPOFFS.map(([cx, , cz], i) => ({ label: `DELIVERY_DROPOFF_${i}`,  x: cx, z: cz })),
    // Phase 5C — mechanic garage + all service call targets
    { label: "MECHANIC_GARAGE",         x: MECHANIC_GARAGE[0],         z: MECHANIC_GARAGE[2] },
    ...MECHANIC_TARGETS.map(([cx, , cz], i)  => ({ label: `MECHANIC_TARGET_${i}`,   x: cx, z: cz })),
    // Phase 5D — medical center + all patient calls + ER bay
    { label: "MEDIC_CENTER",            x: MEDIC_CENTER[0],            z: MEDIC_CENTER[2] },
    ...MEDIC_PATIENT_CALLS.map(([cx, , cz], i) => ({ label: `MEDIC_PATIENT_CALL_${i}`, x: cx, z: cz })),
    { label: "MEDIC_ER_BAY",            x: MEDIC_ER_BAY[0],            z: MEDIC_ER_BAY[2] },
    // Phase 5E — police station + all patrol points
    { label: "POLICE_STATION",          x: POLICE_STATION[0],          z: POLICE_STATION[2] },
    ...POLICE_PATROL_POINTS.map(([cx, , cz], i) => ({ label: `POLICE_PATROL_POINT_${i}`, x: cx, z: cz })),
    // Phase 5F — ATM machines
    ...ATM_LOCATIONS.map(({ id, pos }) => ({ label: `ATM_${id}`, x: pos[0], z: pos[2] })),
    // Phase 6A — jail cell + release position
    { label: "POLICE_JAIL_CELL",        x: POLICE_JAIL_CELL[0],        z: POLICE_JAIL_CELL[2] },
    { label: "POLICE_RELEASE_POS",      x: POLICE_RELEASE_POS[0],      z: POLICE_RELEASE_POS[2] },
    // Phase 6D — booking desk
    { label: "POLICE_BOOKING_DESK",     x: POLICE_BOOKING_DESK_POS[0], z: POLICE_BOOKING_DESK_POS[2] },
    // Phase 7D — Grove Street gang hangout (turf center is same position, no duplicate needed)
    { label: "GROVE_STREET_HANGOUT",    x: GROVE_STREET_HANGOUT_POS[0], z: GROVE_STREET_HANGOUT_POS[2] },
    // Phase 7G — Tag Turf mission points
    ...GROVE_TAG_POINTS.map(([px, , pz], i) => ({ label: `GROVE_TAG_POINT_${i}`, x: px, z: pz })),
    // Phase 8A — Government Office
    { label: "GOVERNMENT_OFFICE_POS", x: GOVERNMENT_OFFICE_POS[0], z: GOVERNMENT_OFFICE_POS[2] },
  ];
  for (const m of markers) {
    if (isNearParkedCar(m.x, m.z, vehicles)) {
      throw new Error(
        `[rp] marker "${m.label}" is within 8 m of a parked vehicle`,
      );
    }
    console.info(`[rp] vehicle clearance OK: ${m.label}`);
  }
}

// ── §12.5 Vehicle spawn OBB clearance ─────────────────────────────────────

/**
 * Returns true if all four corners of the vehicle's OBB are off all road
 * carriageways and outside all static obstacles.
 *
 * OBB convention: rotY=0 → front toward −Z (matches LocalPlayer + collision.ts).
 *
 * @param halfWidth  Half-width (X axis) of the vehicle body (default 1.0 m).
 * @param halfLen    Half-length (Z axis) of the vehicle body (default 2.2 m).
 * @param headingRad Heading in radians (0 = front toward −Z).
 */
export function validateVehicleSpawnOBB(
  cx: number,
  cz: number,
  halfWidth  = 1.0,
  halfLen    = 2.2,
  headingRad = 0,
  obstacles: StaticObstacle[] = [],
): boolean {
  const cos = Math.cos(headingRad);
  const sin = Math.sin(headingRad);

  // Local offsets for 4 corners: (±halfWidth, ±halfLen) in vehicle-local space.
  const localCorners: [number, number][] = [
    [-halfWidth, -halfLen],
    [ halfWidth, -halfLen],
    [ halfWidth,  halfLen],
    [-halfWidth,  halfLen],
  ];

  for (const [lx, lz] of localCorners) {
    // Local → world  (rotY=0 → identity, so lx = world-X offset, lz = world-Z offset)
    const wx = cx + lx * cos - lz * sin;
    const wz = cz + lx * sin + lz * cos;

    if (isInCarriageway(wx, wz))                   return false;
    if (isInsideObstacle(wx, wz, obstacles, 0))    return false;
  }
  return true;
}

// ── §12.6 Jitter-safe station spawn ───────────────────────────────────────

/**
 * Returns a randomised spawn near STATION_SPAWN that clears roads and
 * obstacles. Falls back to the exact centre if all 10 attempts fail.
 */
export function safeStationSpawn(
  obstacles: StaticObstacle[],
): [number, number, number] {
  for (let attempt = 0; attempt < 10; attempt++) {
    const jx = (Math.random() * 2 - 1) * STATION_SPAWN_JITTER_X;
    const jz = (Math.random() * 2 - 1) * STATION_SPAWN_JITTER_Z;
    const x  = STATION_SPAWN[0] + jx;
    const z  = STATION_SPAWN[2] + jz;
    if (!isInCarriageway(x, z) && !isInsideObstacle(x, z, obstacles)) {
      return [x, STATION_SPAWN[1], z];
    }
  }
  // All attempts clipped — fall back to exact centre (always valid per plan §5.3).
  return [STATION_SPAWN[0], STATION_SPAWN[1], STATION_SPAWN[2]];
}

// ── §12.7 Server-side license check ───────────────────────────────────────

/**
 * Returns true if the socket is allowed to drive `vehicleId`.
 * Licensed players may drive any vehicle. An unlicensed player may only
 * drive their active test vehicle (Phase 2).
 */
export function canDriveVehicle(
  socketId:       string,
  vehicleId:      string,
  rpCacheMap:     Map<string, RpCacheEntry>,
  rpTestStateMap: Map<string, TestState>,
): boolean {
  const rp   = rpCacheMap.get(socketId);
  const test = rpTestStateMap.get(socketId);
  if (rp?.driverLicense)                          return true;
  if (test && test.vehicleId === vehicleId)       return true;
  return false;
}
