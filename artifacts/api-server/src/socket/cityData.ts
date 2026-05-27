// IMPORTANT: must stay in sync with the client INITIAL_VEHICLES and
// SPAWN_POINTS in artifacts/city-sandbox/src/shared/cityData.ts. The
// server is authoritative — it owns each vehicle's position/driverId
// and broadcasts state to all clients. The client reads `variant` for
// purely visual rendering (sedan/van/taxi/compact body shape).

// World bounds — must match client `shared/cityData.ts` so that
// authoritative server-side clamps never disagree with client-side
// movement clamps.
export const WORLD_HALF = 500;
export const WORLD_SIZE = 1000;

export const INITIAL_VEHICLES = [
  // ===== City (14 cars) — original 200x200 hub =====
  { id: "car-0",  x:  22, y: 0.6, z: -22, rotY: 0,                  speed: 0, driverId: null, variant: "sedan",   color: "#e74c3c" },
  { id: "car-1",  x: -22, y: 0.6, z:  22, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#3498db" },
  { id: "car-2",  x:  22, y: 0.6, z:  22, rotY: 0,                  speed: 0, driverId: null, variant: "compact", color: "#c0392b" },
  { id: "car-3",  x: -22, y: 0.6, z: -22, rotY: Math.PI,            speed: 0, driverId: null, variant: "van",     color: "#7f8c8d" },
  { id: "car-4",  x:  55, y: 0.6, z:   8, rotY: Math.PI / 2,        speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" },
  { id: "car-5",  x: -55, y: 0.6, z:  -8, rotY: -Math.PI / 2,       speed: 0, driverId: null, variant: "compact", color: "#f39c12" },
  { id: "car-6",  x:   8, y: 0.6, z:  55, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#9b59b6" },
  { id: "car-7",  x:  -8, y: 0.6, z: -49, rotY: 0,                  speed: 0, driverId: null, variant: "van",     color: "#16a085" },
  { id: "car-8",  x:  35, y: 0.6, z:  35, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#e67e22" },
  { id: "car-9",  x: -35, y: 0.6, z: -35, rotY: 0,                  speed: 0, driverId: null, variant: "van",     color: "#34495e" },
  { id: "car-10", x:  35, y: 0.6, z: -35, rotY: -Math.PI / 2,       speed: 0, driverId: null, variant: "compact", color: "#1abc9c" },
  { id: "car-11", x: -35, y: 0.6, z:  35, rotY: Math.PI / 2,        speed: 0, driverId: null, variant: "sedan",   color: "#d35400" },
  { id: "car-12", x:  41, y: 0.6, z: -70, rotY: 0,                  speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" },
  { id: "car-13", x: -41, y: 0.6, z:  70, rotY: Math.PI,            speed: 0, driverId: null, variant: "compact", color: "#27ae60" },
  // ===== Mountain biome (4 cars) =====
  // Mountain biome — y values match the client-side mountain road
  // elevation profiles (see ROAD_ELEVATION_PROFILES in client cityData).
  { id: "car-14", x:  90, y:  5.4, z: -250, rotY: -Math.PI / 2,     speed: 0, driverId: null, variant: "sedan",   color: "#5d6d7e" },
  { id: "car-15", x: -75, y:  8.49, z: -290, rotY: 0,               speed: 0, driverId: null, variant: "van",     color: "#7d6e58" },
  { id: "car-16", x:  75, y: 12.49, z: -340, rotY: Math.PI,         speed: 0, driverId: null, variant: "compact", color: "#a04060" },
  { id: "car-17", x:  -3, y: 22.6, z: -462, rotY: 0,                speed: 0, driverId: null, variant: "taxi",    color: "#e8a02a" },
  // ===== Forest biome (6 cars) — South Forest Village =====
  // Each car parks on a pad/spur/driveway (validator enforces this).
  { id: "car-18", x:  15, y: 0.6, z:  213, rotY: Math.PI,           speed: 0, driverId: null, variant: "compact", color: "#2e7d32" }, // gateway-spur
  { id: "car-19", x: -58, y: 0.6, z:  320, rotY: Math.PI / 2,       speed: 0, driverId: null, variant: "sedan",   color: "#558b2f" }, // village loop W
  { id: "car-20", x:  60, y: 0.6, z:  340, rotY: -Math.PI / 2,      speed: 0, driverId: null, variant: "van",     color: "#6d4c41" }, // village loop E
  { id: "car-21", x: -37, y: 0.6, z:  418, rotY: -Math.PI / 2,      speed: 0, driverId: null, variant: "sedan",   color: "#8d6e63" }, // cabin-W1 driveway
  { id: "car-22", x:  47, y: 0.6, z:  376, rotY: Math.atan2(10, 12), speed: 0, driverId: null, variant: "compact", color: "#33691e" }, // cabin-E1 driveway
  { id: "car-23", x: -15, y: 0.6, z:  482, rotY: Math.PI / 2,       speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" }, // trailhead-spur
  // ===== East suburban / industrial (3 cars) =====
  { id: "car-24", x: 235, y: 0.6, z:  -30, rotY: 0,                 speed: 0, driverId: null, variant: "van",     color: "#455a64" },
  { id: "car-25", x: 310, y: 0.6, z:   80, rotY: -Math.PI / 2,      speed: 0, driverId: null, variant: "sedan",   color: "#5d4037" },
  { id: "car-26", x: 420, y: 5.16, z:  -55, rotY: Math.PI,          speed: 0, driverId: null, variant: "compact", color: "#37474f" },
  // ===== West fields / depot (1 car) =====
  { id: "car-27", x: -220, y: 0.6, z:   65, rotY: Math.PI / 2,      speed: 0, driverId: null, variant: "van",     color: "#3e2723" },
];

// Spawn points placed inside the central plaza (cx=0, cz=0 block has no
// generated buildings). Must match the client SPAWN_POINTS array.
// NOTE: Phase 1B replaces the random-round-robin spawn with safeStationSpawn().
// SPAWN_POINTS is kept exported so client code that imports it for the
// deterministic offline fallback continues to compile.
export const SPAWN_POINTS: [number, number, number][] = [
  [0,   1, -12],
  [12,  1,  0 ],
  [-12, 1,  0 ],
  [0,   1,  12],
  [15,  1,  15],
  [-15, 1,  15],
  [15,  1, -15],
  [-15, 1, -15],
];

// ── Central Station spawn (Phase 1B) ──────────────────────────────────────
// All players now spawn here instead of the rotating SPAWN_POINTS array.
// Positions validated against buildings, roads, cars, and obstacles in
// NEMOVERSE_RP_PLAN.md §5.3–§5.4.

/** Platform center of Central Loop Station exterior (visual marker position). */
export const STATION_MARKER_POS: [number, number, number] = [132, 0, -65];

/**
 * Primary spawn point — ground-level exterior east of the station stair foot
 * at x=122. Both jitter extremes (x ∈ [124, 132], z ∈ [−68, −62]) clear
 * all buildings, roads, and parked cars.
 */
export const STATION_SPAWN: [number, number, number] = [128, 1, -65];

/** Jitter half-width on X: final x ∈ [STATION_SPAWN[0]−4, STATION_SPAWN[0]+4]. */
export const STATION_SPAWN_JITTER_X = 4;

/** Jitter half-depth on Z: final z ∈ [STATION_SPAWN[2]−3, STATION_SPAWN[2]+3]. */
export const STATION_SPAWN_JITTER_Z = 3;

// ── Dealership (Phase 3) ──────────────────────────────────────────────────

/**
 * Vehicle dealership entrance — NE outer district, clear of all roads.
 * Validated: x=68 is 23 m from x=45 NS road (>10 m); z=−72 is 27 m from
 * z=−45 EW road (>10 m).
 */
export const DEALERSHIP_POS: [number, number, number] = [68, 0, -72];

/**
 * Delivery pad — where purchased vehicles spawn.
 * Validated off-road (same district as DEALERSHIP_POS).
 */
export const DEALERSHIP_DELIVERY_PAD: [number, number, number] = [68, 0.6, -68];

/** Radius (m) player must be within to interact with the Dealership. */
export const DEALERSHIP_INTERACT_RADIUS = 8;

/**
 * Delivery slot offsets [dx, dz] relative to DEALERSHIP_DELIVERY_PAD.
 * All slots validated road-clear at startup (see rpValidators + gameServer).
 *
 *   Absolute positions (base x=68, z=−68):
 *   slot 0:  x=68,  z=−68  (base pad)
 *   slot 1:  x=72,  z=−68  (+4 east)
 *   slot 2:  x=64,  z=−68  (−4 west)
 *   slot 3:  x=76,  z=−68  (+8 east)
 *   slot 4:  x=60,  z=−68  (−8 west)
 *   slot 5:  x=68,  z=−64  (+4 south)
 *   slot 6:  x=72,  z=−64  (SE)
 *   slot 7:  x=64,  z=−64  (SW)
 *
 * All clear of every NS road (|x−45|≥10, |x−0|≥10) and EW road (|z+45|≥10).
 */
export const DELIVERY_SLOT_OFFSETS: [number, number][] = [
  [  0,  0 ],  // slot 0 — base pad
  [  4,  0 ],  // slot 1
  [ -4,  0 ],  // slot 2
  [  8,  0 ],  // slot 3
  [ -8,  0 ],  // slot 4
  [  0,  4 ],  // slot 5
  [  4,  4 ],  // slot 6
  [ -4,  4 ],  // slot 7
];

/**
 * Server-authoritative vehicle purchase catalog.
 * model+variant uniquely identify a vehicle body.
 * colors is the allowlist the server accepts — client cannot send other values.
 */
export const VEHICLE_SHOP_CATALOG = [
  {
    model:   "compact",
    variant: "compact" as const,
    price:   300,
    colors:  ["#e84141", "#4169e1", "#f5f5f5", "#2d2d2d"],
  },
  {
    model:   "sedan",
    variant: "sedan"   as const,
    price:   700,
    colors:  ["#e84141", "#4169e1", "#f5f5f5", "#2d2d2d", "#1a5c1a"],
  },
  {
    model:   "taxi",
    variant: "taxi"    as const,
    price:   900,
    colors:  ["#f5c518"],
  },
  {
    model:   "van",
    variant: "van"     as const,
    price:   1200,
    colors:  ["#e84141", "#f5f5f5", "#1a5c1a", "#2d2d2d"],
  },
] as const;

// ── City Worker job (Phase 4) ─────────────────────────────────────────────

/**
 * City Worker depot entrance — NE inner block, clear of all roads and cars.
 * Validated: x=30 → |30−45|=15>10 (x=45 NS road), |30−0|=30>10 (x=0 road);
 *             z=28 → |28−45|=17>10 (z=45 EW road), |28−0|=28>10 (z=0 road).
 * Vehicle clearance: nearest car is car-2 at (22,22) → dist≈10 m > 8 m.
 */
export const CITY_WORKER_DEPOT: [number, number, number] = [30, 0, 28];

/** Radius (m) player must be within to clock in/out at the depot. */
export const CITY_WORKER_DEPOT_RADIUS = 6;

/**
 * City Worker foot-patrol route — 4 checkpoints forming a clockwise loop
 * around the central plaza. All positions are off-road (inner-block plazas).
 * Must stay in sync with CITY_WORKER_CHECKPOINTS in city-sandbox/shared/rpTypes.ts.
 */
export const CITY_WORKER_CHECKPOINTS: [number, number, number][] = [
  [ 22, 0.5, -18],  // CP0 — E side, south half
  [ 22, 0.5,  18],  // CP1 — E side, north half
  [-22, 0.5,  18],  // CP2 — W side, north half
  [-22, 0.5, -18],  // CP3 — W side, south half
];

/** Cash paid per completed City Worker route. */
export const JOB_CITY_WORKER_PAY     = 120;

/** Minimum ms between consecutive checkpoint hits (anti-farm). */
export const JOB_MIN_CP_INTERVAL_MS  = 3_000;

/** Minimum ms between two completed routes (anti-farm cooldown). */
export const JOB_ROUTE_COOLDOWN_MS   = 60_000;

/** Player must be within this distance (m) of a checkpoint to trigger it. */
export const JOB_CP_ACCEPT_RADIUS    = 8;

// ── Taxi Driver job (Phase 5A) ────────────────────────────────────────────

/**
 * Taxi Depot — NW inner block, clear of all roads.
 * x=−30: |−30−(−45)|=15>10 (x=−45 NS road), |−30−0|=30>10 (x=0 road);
 * z=−15: |−15−(−45)|=30>10 (z=−45 EW road), |−15−0|=15>10 (z=0 road).
 * Nearest parked car (car-3 at −22,−22): dist≈10.6 m > 8 m.
 */
export const TAXI_DEPOT: [number, number, number] = [-30, 0, -15];

/** Radius (m) player must be within to clock in/out at the Taxi Depot. */
export const TAXI_DEPOT_RADIUS = 6;

/**
 * Server-authoritative taxi pickup locations.
 * All points are ON a road carriageway (validated at startup).
 * The server picks one at random when the player clocks in.
 *
 * Must stay in sync with TAXI_PICKUPS in city-sandbox/shared/rpTypes.ts.
 */
export const TAXI_PICKUPS: [number, number, number][] = [
  [   0, 0.5, -30],  // P0 — x=0 N-S road, south block
  [   0, 0.5,  20],  // P1 — x=0 N-S road, north block
  [  42, 0.5, -20],  // P2 — x=45 N-S road, south half
  [ -42, 0.5,  20],  // P3 — x=−45 N-S road, north half
  [  25, 0.5, -44],  // P4 — z=−45 E-W road, east of center
  [ -25, 0.5,  44],  // P5 — z=45 E-W road, west of center
];

/**
 * Server-authoritative taxi dropoff locations.
 * All points are ON a road carriageway (validated at startup).
 * Must stay in sync with TAXI_DROPOFFS in city-sandbox/shared/rpTypes.ts.
 */
export const TAXI_DROPOFFS: [number, number, number][] = [
  [  42, 0.5,  20],  // D0 — x=45 N-S road, north half
  [ -42, 0.5, -20],  // D1 — x=−45 N-S road, south half
  [   0, 0.5, -44],  // D2 — z=−45 E-W road, center
  [  25, 0.5,  44],  // D3 — z=45 E-W road, east of center
  [ -25, 0.5, -44],  // D4 — z=−45 E-W road, west of center
  [ -42, 0.5,   0],  // D5 — x=−45 N-S road, center (also on z=0 road)
];

/** Minimum fare for a completed Taxi route (short trip). */
export const TAXI_PAY_MIN = 80;

/** Maximum fare for a completed Taxi route (long trip). */
export const TAXI_PAY_MAX = 180;

/** Distance factor for fare calculation: pay = clamp(dist * TAXI_PAY_PER_M, MIN, MAX). */
export const TAXI_PAY_PER_M = 1.2;

/** Player/vehicle must be within this distance (m) of a taxi target to trigger it. */
export const TAXI_CP_ACCEPT_RADIUS = 12;

/** Minimum ms between consecutive taxi stages (anti-teleport). */
export const TAXI_MIN_STAGE_INTERVAL_MS = 5_000;

/** Minimum ms between two completed Taxi routes (cooldown). */
export const TAXI_ROUTE_COOLDOWN_MS = 60_000;

// ── Delivery Driver job (Phase 5B) ────────────────────────────────────────

/**
 * Delivery Hub — east outer block, clear of all roads and parked cars.
 * x=58: |58−45|=13>10 (x=45 road), |58−0|=58>10 (x=0 road);
 * z=−28: |−28−(−45)|=17>10 (z=−45 road), |−28−0|=28>10 (z=0 road).
 * Nearest parked car (car-4 at 55,8): dist≈36 m > 8 m.
 *
 * MUST stay in sync with DELIVERY_HUB in city-sandbox/shared/rpTypes.ts.
 */
export const DELIVERY_HUB: [number, number, number] = [58, 0, -28];

/** Radius (m) player must be within to clock in/out at the Delivery Hub. */
export const DELIVERY_HUB_RADIUS = 6;

/**
 * Server-authoritative delivery pickup/loading locations.
 * All points are ON a road carriageway (validated at startup).
 * The server picks one at random when the player clocks in.
 *
 * MUST stay in sync with DELIVERY_PICKUPS in city-sandbox/shared/rpTypes.ts.
 */
export const DELIVERY_PICKUPS: [number, number, number][] = [
  [  45, 0.5, -10],  // P0 — x=45 N-S road, center-south block
  [   0, 0.5, -20],  // P1 — x=0  N-S road, south block
  [ -45, 0.5,  10],  // P2 — x=−45 N-S road, north of center
  [  20, 0.5,  45],  // P3 — z=45  E-W road, east of center
];

/**
 * Server-authoritative delivery dropoff locations (used to build stop sequences).
 * All points are ON a road carriageway (validated at startup).
 * Routes use 2 or 3 stops sampled without replacement.
 *
 * MUST stay in sync with DELIVERY_DROPOFFS in city-sandbox/shared/rpTypes.ts.
 */
export const DELIVERY_DROPOFFS: [number, number, number][] = [
  [  42, 0.5,  30],  // D0 — x=45  N-S road, north half
  [ -42, 0.5, -30],  // D1 — x=−45 N-S road, south half
  [   5, 0.5,  44],  // D2 — z=45  E-W road, near center
  [  -5, 0.5, -44],  // D3 — z=−45 E-W road, near center
  [  42, 0.5, -40],  // D4 — x=45  N-S road, south
  [ -42, 0.5,  40],  // D5 — x=−45 N-S road, north
  [   0, 0.5,  35],  // D6 — x=0   N-S road, north
  [   0, 0.5, -35],  // D7 — x=0   N-S road, south
];

/** Minimum pay for a completed Delivery route. */
export const DELIVERY_PAY_MIN = 150;

/** Maximum pay for a completed Delivery route. */
export const DELIVERY_PAY_MAX = 280;

/**
 * Distance factor for pay calculation.
 * pay = clamp(totalRouteDist * DELIVERY_PAY_PER_M, MIN, MAX), rounded to $10.
 * Total route distance = hub→pickup + pickup→drop1 + drop1→drop2 [+ drop2→drop3].
 */
export const DELIVERY_PAY_PER_M = 0.9;

/** Vehicle must be within this distance (m) of a delivery stage target to trigger it. */
export const DELIVERY_CP_ACCEPT_RADIUS = 12;

/** Minimum ms between consecutive delivery stages (anti-teleport). */
export const DELIVERY_MIN_STAGE_INTERVAL_MS = 5_000;

/** Minimum ms between two completed Delivery routes (cooldown). */
export const DELIVERY_ROUTE_COOLDOWN_MS = 60_000;

// ── Licensing Office (Phase 2) ─────────────────────────────────────────────

/** Entrance of the Licensing Office — SE inner block, east-facing sidewalk. */
export const LICENSING_OFFICE_POS: [number, number, number] = [14, 0, -30];

/** Test vehicle spawn — 2 m clear of the x=0 road edge at x=10. */
export const TEST_VEHICLE_SPAWN: [number, number, number] = [13, 0.6, -30];

/** Cash required to attempt the driver license test. */
export const TEST_FEE = 200;

/**
 * Server-authoritative license-test checkpoint route.
 * MUST stay in sync with LICENSE_TEST_CHECKPOINTS in
 * artifacts/city-sandbox/src/shared/rpTypes.ts.
 * rotY=0 → front toward -Z (matches vehicleObb + LocalPlayer).
 */
export const LICENSE_TEST_CHECKPOINTS: [number, number, number][] = [
  [  2, 0.5, -40],  // CP0 — south on x=0 road, approaching z=−45
  [ 42, 0.5, -44],  // CP1 — east on z=−45 road, at x=45 intersection
  [ 42, 0.5, -14],  // CP2 — north on x=45 road, mid-block
  [ 14, 0.5, -26],  // CP3 — finish line near Licensing Office entrance
];
