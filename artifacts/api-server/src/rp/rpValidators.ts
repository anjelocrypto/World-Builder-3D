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
  POLICE_RELEASE_POS,
  POLICE_BOOKING_DESK_POS,
  GROVE_STREET_HANGOUT_POS,
  GROVE_STREET_TURF_CENTER,
} from "../socket/cityData";
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
    { label: "LICENSING_OFFICE_POS",    x:  14,                       z: -30 },
    { label: "TEST_VEHICLE_SPAWN",      x:  13,                       z: -30 },
    { label: "CP3_FINISH",              x:  14,                       z: -26 },
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
  const gangOffRoadMarkers = [
    { label: "GROVE_STREET_HANGOUT_POS", x: GROVE_STREET_HANGOUT_POS[0], z: GROVE_STREET_HANGOUT_POS[2] },
    { label: "GROVE_STREET_TURF_CENTER", x: GROVE_STREET_TURF_CENTER[0],  z: GROVE_STREET_TURF_CENTER[2]  },
  ];

  for (const m of [...OFF_ROAD, ...cityWorkerMarkers, ...taxiMarkers, ...deliveryMarkers, ...mechanicMarkers, ...medicOffRoadMarkers, ...policeOffRoadMarkers, ...atmOffRoadMarkers, ...gangOffRoadMarkers]) {
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
    { label: "LICENSING_OFFICE_POS",    x:  14,                       z: -30 },
    { label: "TEST_VEHICLE_SPAWN",      x:  13,                       z: -30 },
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
