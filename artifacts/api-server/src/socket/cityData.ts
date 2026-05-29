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
  { id: "car-2",  x:  22, y: 0.6, z:  15, rotY: 0,                  speed: 0, driverId: null, variant: "compact", color: "#c0392b" }, // Phase 9A: moved (22,22)→(22,15) to clear City Worker depot footprint
  { id: "car-3",  x: -22, y: 0.6, z: -31, rotY: Math.PI,            speed: 0, driverId: null, variant: "van",     color: "#7f8c8d" }, // Phase 9A: moved (-22,-22)→(-22,-31) to clear City Hall footprint
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
 * City Worker depot entrance — SE inner block, clear of all roads and cars.
 * Phase 9A: moved (30,28)→(24,24) so a real depot footprint (16×12) clears the
 * road grid (road edge 3.0 m) and sits ≥31 m from other civic buildings.
 * Validated: x=24 → |24−45|=21>10 (x=45 NS road), |24−0|=24>10 (x=0 road);
 *             z=24 → |24−45|=21>10 (z=45 EW road), |24−0|=24>10 (z=0 road).
 * car-2 relocated (22,22)→(22,15) to clear the new footprint.
 * Clock-in is a proximity gate only; CITY_WORKER_CHECKPOINTS are NOT moved.
 * Mirror: client CITY_WORKER_DEPOT in city-sandbox/src/shared/rpTypes.ts.
 */
export const CITY_WORKER_DEPOT: [number, number, number] = [24, 0, 24];

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
 * Nearest parked car (car-3 at −22,−31, relocated in Phase 9A): dist≈17.9 m > 8 m.
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
  [  10, 0.5, -44],  // D3 — z=−45 E-W road, east of center (was −5; moved for 8m car clearance)
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

// ── Phase 5C: Mechanic job ────────────────────────────────────────────────

/**
 * Mechanic Garage — player clocks in/out here.
 * Off-road at [−68, 0, −28]; nearest parked car (car-5 at [−55, 0.6, −8]) ≈ 23.85 m.
 */
export const MECHANIC_GARAGE: [number, number, number] = [-68, 0, -28];

/** Radius (m) within which the player can clock in/out at the Mechanic Garage. */
export const MECHANIC_GARAGE_RADIUS = 6;

/**
 * Server-authoritative broken-vehicle service call positions.
 * All are ON a road carriageway (validated at startup).
 * They represent fictional broken-down vehicles — NOT entries in INITIAL_VEHICLES.
 * The server picks one at random when the player clocks in.
 *
 * Geometry (verified programmatically):
 *   T0 [45, 0.5, −5]   — x=45 N-S road; nearest parked car ≈ 16.4 m
 *   T1 [−45, 0.5, 20]  — x=−45 N-S road; nearest parked car ≈ 18.0 m
 *   T2 [0, 0.5, 40]    — x=0  N-S road;  nearest parked car ≈ 17.0 m
 *   T3 [30, 0.5, −45]  — z=−45 E-W road; nearest parked car ≈ 11.2 m
 *   T4 [−20, 0.5, 45]  — z=45  E-W road; nearest parked car ≈ 18.0 m
 *   T5 [20, 0.5, −45]  — z=−45 E-W road; nearest parked car ≈ 18.0 m
 */
export const MECHANIC_TARGETS: [number, number, number][] = [
  [  45, 0.5,  -5],  // T0 — x=45  N-S road, south of center
  [ -45, 0.5,  20],  // T1 — x=−45 N-S road, north of center
  [   0, 0.5,  40],  // T2 — x=0   N-S road, north block
  [  30, 0.5, -45],  // T3 — z=−45 E-W road, east half
  [ -20, 0.5,  45],  // T4 — z=45  E-W road, west half
  [  20, 0.5, -45],  // T5 — z=−45 E-W road, east of center
];

/** Mechanic must stop within this distance (m) of the broken vehicle to begin/complete repair. */
export const MECHANIC_SERVICE_RADIUS = 12;

/** Server-side repair duration in ms. Client retries idx=1 every ~1s; server pays once elapsed. */
export const MECHANIC_REPAIR_DURATION_MS = 8_000;

/** Fixed pay for completing a mechanic service call. */
export const MECHANIC_PAY = 180;

/** Minimum ms between the travel arrival and subsequent repair-confirmation retries (not applied to repair stage). */
export const MECHANIC_MIN_STAGE_INTERVAL_MS = 5_000;

/** Minimum ms between two completed mechanic service calls (cooldown). */
export const MECHANIC_ROUTE_COOLDOWN_MS = 60_000;

// ── Medic / Paramedic (Phase 5D) ──────────────────────────────────────────
// All positions geometry-verified: MEDIC_CENTER off-road (min 33.73 m from
// parked cars); all patient calls + ER bay on-road (min 11.18 m from parked
// cars). No adjustments were required.

/** Medical Center entrance — west outer district. Off-road. */
export const MEDIC_CENTER: [number, number, number] = [-68, 0, 28];

/** Radius (m) within which the player can clock in/out at the Medical Center. */
export const MEDIC_CENTER_RADIUS = 6;

/**
 * Allowlist of patient call positions [x, y, z]. All on road carriageways.
 * Server picks one at random on clock-in; client never chooses.
 */
export const MEDIC_PATIENT_CALLS: [number, number, number][] = [
  [ 45, 0.5,  30],   // P0 — x=45 N-S road, north of center
  [-45, 0.5, -30],   // P1 — x=−45 N-S road, south of center
  [  0, 0.5, -40],   // P2 — x=0  N-S road, approaching z=−45
  [ 30, 0.5,  45],   // P3 — z=45 E-W road, east half
  [-30, 0.5,  45],   // P4 — z=45 E-W road, west half
  [ 45, 0.5, -20],   // P5 — x=45 N-S road, south of center
];

/** Emergency Room drop-off bay — x=−45 N-S road near Medical Center. */
export const MEDIC_ER_BAY: [number, number, number] = [-45, 0.5, 28];

/** Acceptance radius (m) for patient call and ER bay checkpoints. */
export const MEDIC_SERVICE_RADIUS = 12;

/** Duration (ms) the paramedic must stay on scene to treat the patient. */
export const MEDIC_TREATMENT_DURATION_MS = 6_000;

/** Minimum pay for completing a full medic run (patient → ER). */
export const MEDIC_PAY_MIN = 220;

/** Maximum pay for completing a full medic run. */
export const MEDIC_PAY_MAX = 360;

/**
 * Pay per metre of total route distance
 * (MEDIC_CENTER → patient call + patient call → MEDIC_ER_BAY).
 */
export const MEDIC_PAY_PER_M = 1.1;

/** Minimum ms between two completed medic runs (cooldown). */
export const MEDIC_ROUTE_COOLDOWN_MS = 60_000;

// ── Phase 5E: Police Patrol job ───────────────────────────────────────────
// POLICE_STATION originally suggested as [-68, 0, 0]; adjusted to [-68, 0, 14]
// because z=0 falls on the E-W road carriageway at z=0 (half-width 10 m).
// Adjusted position [-68, 0, 14]: off-road ✓, nearest parked car (car-5) 25.55 m ✓.
// All 6 POLICE_PATROL_POINTS are on road carriageways ✓; min parked-car clearance
// 8.94 m (PP1 vs car-7) ✓ — no further adjustments required.

/** Police Station entrance — west outer district, between Mechanic Garage and Medical Center. */
export const POLICE_STATION: [number, number, number] = [-68, 0, 14];

/** Radius (m) within which the player can clock in/out at the Police Station. */
export const POLICE_STATION_RADIUS = 6;

/**
 * Allowlist of patrol checkpoint positions [x, y, z]. All are on road carriageways.
 * Server samples 4 without replacement per route. Client never chooses.
 *
 * Geometry (verified programmatically):
 *   PP0 [−45, 0.5, −40] — x=−45 N-S road; nearest car (car-9)  11.18 m ✓
 *   PP1 [  0, 0.5, −45] — z=−45 E-W road; nearest car (car-7)   8.94 m ✓
 *   PP2 [ 45, 0.5, −20] — x= 45 N-S road; nearest car (car-10) 18.03 m ✓
 *   PP3 [ 45, 0.5,  30] — x= 45 N-S road; nearest car (car-8)  11.18 m ✓
 *   PP4 [  0, 0.5,  45] — z= 45 E-W road; nearest car (car-6)  12.81 m ✓
 *   PP5 [−45, 0.5,  20] — x=−45 N-S road; nearest car (car-11) 18.03 m ✓
 */
export const POLICE_PATROL_POINTS: [number, number, number][] = [
  [-45, 0.5, -40],  // PP0 — x=−45 N-S road, south block
  [  0, 0.5, -45],  // PP1 — z=−45 E-W road, center
  [ 45, 0.5, -20],  // PP2 — x= 45 N-S road, south of center
  [ 45, 0.5,  30],  // PP3 — x= 45 N-S road, north of center
  [  0, 0.5,  45],  // PP4 — z= 45 E-W road, center
  [-45, 0.5,  20],  // PP5 — x=−45 N-S road, north of center
];

/** Vehicle must be within this distance (m) of a patrol checkpoint to trigger it. */
export const POLICE_PATROL_ACCEPT_RADIUS = 12;

/** Minimum pay for completing a full Police Patrol route. */
export const POLICE_PATROL_PAY_MIN = 180;

/** Maximum pay for completing a full Police Patrol route. */
export const POLICE_PATROL_PAY_MAX = 300;

/**
 * Pay per metre of total route distance (sum of consecutive checkpoint segments).
 * pay = clamp(totalDist * 0.8, MIN, MAX), rounded to nearest $10.
 */
export const POLICE_PATROL_PAY_PER_M = 0.8;

/** Minimum ms between consecutive patrol checkpoint hits (anti-farm). */
export const POLICE_PATROL_MIN_STAGE_INTERVAL_MS = 5_000;

/** Minimum ms between two completed Police Patrol routes (cooldown). */
export const POLICE_PATROL_ROUTE_COOLDOWN_MS = 60_000;

// ── Bank / ATM (Phase 5F) ──────────────────────────────────────────────────

/**
 * ATM machine world positions.  All five are verified off-road (≥10 m from any
 * carriageway centre-line) and ≥8 m from every named landmark.
 *
 * Geometry audit results (run Node.js check before each commit):
 *   atm-central    [ 18, 0, -30] ✅ off-road, clear
 *   atm-station    [132, 0, -58] ✅ off-road, clear
 *   atm-police     [-80, 0,  14] ✅ 12 m west of POLICE_STATION ([-68,0,14])
 *   atm-medical    [-80, 0,  28] ✅ 12 m west of MEDIC_CENTER   ([-68,0,28])
 *   atm-dealership [ 82, 0, -78] ✅ 12 m east of DEALERSHIP     ([ 70,0,-78])
 */
export const ATM_LOCATIONS: { id: string; pos: [number, number, number] }[] = [
  { id: "atm-central",    pos: [  18, 0, -30] },
  { id: "atm-station",    pos: [ 132, 0, -58] },
  { id: "atm-police",     pos: [ -80, 0,  14] },
  { id: "atm-medical",    pos: [ -80, 0,  28] },
  { id: "atm-dealership", pos: [  82, 0, -78] },
];

/** Radius (m) within which a walking player (not in a vehicle) can use an ATM. */
export const ATM_INTERACT_RADIUS = 4;

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

// ── Phase 6A: Police Wanted + Arrest ─────────────────────────────────────────

/**
 * Jail cell world position — inside the Police Station compound. Off-road.
 * Geometry check:
 *   x=−68: nearest NS road is x=−45, |−68−(−45)| = 23 > ROAD_HALF(10) ✅
 *   z=14:  nearest EW road is z=0,   |14−0|       = 14 > ROAD_HALF(10) ✅
 * NOTE: z=6 (originally suggested) fails — |6−0|=6 < 10 (on z=0 carriageway).
 *       z=14 matches POLICE_STATION z, already validated off-road.
 */
export const POLICE_JAIL_CELL: [number, number, number] = [-68, 1, 14];

/**
 * Release position — just outside the jail area, between station and medic center.
 * z=22: |22−0|=22 > 10 ✅, |22−45|=23 > 10 ✅.
 */
export const POLICE_RELEASE_POS: [number, number, number] = [-68, 1, 22];

/** Radius (m) of the jail confinement zone centred on POLICE_JAIL_CELL. */
export const POLICE_JAIL_RADIUS = 8;

/** Officer must be within this distance (m) of the target to arrest. */
export const POLICE_ARREST_RADIUS = 4;

/** Officer must be within this distance (m) of the target to issue a warrant. */
export const POLICE_WARRANT_RADIUS = 14;

/** Default sentence duration in seconds. */
export const POLICE_DEFAULT_SENTENCE_SECS = 120;

/** Default fine deducted on arrest (cash-first, then bank; never below 0). */
export const POLICE_DEFAULT_FINE = 150;

/** Maximum fine an officer may issue (server-validated). */
export const POLICE_MAX_FINE = 5_000;

/** Maximum sentence an officer may issue (server-validated). */
export const POLICE_MAX_SENTENCE_SECS = 900;

/** Phase 6C: Radius (m) within which an officer may cuff / uncuff a suspect. */
export const POLICE_CUFF_RADIUS = 4;

/** Phase 6C: Seconds before an unresolved cuff auto-expires (in-memory only). */
export const POLICE_CUFF_TIMEOUT_SECS = 120;

/**
 * Phase 6D: Booking Desk — inside the police station, used by officers to
 * log a booking after escorting a cuffed suspect.
 *
 * Position: x=-62, y=0, z=14.
 *   x=-62: |−62−(−45)|=17 > 10 ✅ (off NS road at x=−45)
 *   z=14:  |14−0|=14 > 10 ✅, |14−45|=31 > 10 ✅ (off EW roads)
 *   Nearest parked car (car-5 at [−55, 0.6, −8]): dist ≈ 23.1 m > 8 ✅
 */
export const POLICE_BOOKING_DESK_POS: [number, number, number] = [-62, 0, 14];

/** Radius (m) within which officer/suspect interact with the Booking Desk. */
export const POLICE_BOOKING_RADIUS = 4;

/** Radius (m) within which a sentence-expired inmate can trigger their release. */
export const POLICE_RELEASE_RADIUS = 4;

/** Phase 6E: Radius (m) within which an officer may issue a fine to a player. */
export const POLICE_FINE_RADIUS = 8;

/** Phase 6E: Minimum fine amount the server will accept. */
export const POLICE_MIN_FINE = 10;

/** Phase 6E: Milliseconds before an unresolved pending fine auto-expires. */
export const POLICE_FINE_EXPIRE_MS = 60_000;

// ── Phase 7D: Grove Street gang turf ──────────────────────────────────────────
//
// Location: east outer district at [95, 0, 65].
// Geometry audit:
//   x=95: nearest NS road is x=45, |95−45|=50 > ROAD_HALF(10) ✅
//         also |95−0|=95 > 10 ✅, |95−(−45)|=140 > 10 ✅
//   z=65: nearest EW road is z=45, |65−45|=20 > ROAD_HALF(10) ✅
//         also |65−0|=65 > 10 ✅
// Nearest named RP marker: DEALERSHIP_POS [68, 0, −72] → dist ≈ 143 m ✅
// Nearest parked car: city cars at (55,8) → dist ≈ 58 m; none within 30 m ✅

/** World centre of the Grove Street gang hangout / sign marker. */
export const GROVE_STREET_HANGOUT_POS: [number, number, number] = [95, 0, 65];

/**
 * Interaction radius (m) — players within this radius of the hangout can open
 * the gang HUD panel with G.
 */
export const GROVE_STREET_HANGOUT_RADIUS = 8;

/** World centre of the Grove Street turf territory ring (visual only for Phase 7D). */
export const GROVE_STREET_TURF_CENTER: [number, number, number] = [95, 0, 65];

/**
 * Radius (m) of the turf territory ring displayed on the ground.
 * Only visual in Phase 7D — persistent capture is a later phase.
 */
export const GROVE_STREET_TURF_RADIUS = 30;

// ── Phase 7G: Grove Street "Tag Turf" mission ─────────────────────────────────
//
// Three tag points inside the Grove Street turf ring (dist < GROVE_STREET_TURF_RADIUS=30
// from GROVE_STREET_TURF_CENTER=[95,0,65]).
//
// Off-road verification (NS roads: x ∈ {−45,0,45}; EW roads: z ∈ {−45,0,45};
// ROAD_HALF=10 — must satisfy |coord − road| > 10 strictly):
//
//   Point 0  [90, 0.5, 56]  SW tag
//     x=90: |90−45|=45 > 10 ✅
//     z=56: |56−45|=11 > 10 ✅
//     dist to turf center: sqrt((90−95)²+(56−65)²) ≈ 10.3 m < 30 ✅
//     nearest parked car: > 59 m ✅
//
//   Point 1  [108, 0.5, 72]  E tag
//     x=108: |108−45|=63 > 10 ✅
//     z=72:  |72−45|=27 > 10 ✅
//     dist to turf center: sqrt((108−95)²+(72−65)²) ≈ 14.8 m < 30 ✅
//     nearest parked car: > 60 m ✅
//
//   Point 2  [82, 0.5, 78]  NW tag
//     x=82: |82−45|=37 > 10 ✅
//     z=78: |78−45|=33 > 10 ✅
//     dist to turf center: sqrt((82−95)²+(78−65)²) ≈ 18.4 m < 30 ✅
//     nearest parked car: > 60 m ✅

/** Three ordered tag points for the "Tag Turf" repeatable gang mission. */
export const GROVE_TAG_POINTS: [number, number, number][] = [
  [90, 0.5, 56],
  [108, 0.5, 72],
  [82, 0.5, 78],
];

/** Server-authoritative proximity radius (m) for accepting a checkpoint hit. */
export const GROVE_TAG_RADIUS = 8;

/** Cash payout on successful completion. */
export const GROVE_TAG_PAY = 150;

/** Cooldown (ms) before the same player can start another Tag Turf mission. */
export const GROVE_TAG_COOLDOWN_MS = 120_000;

// ── Phase 7H: Gang Territory Control ─────────────────────────────────────────

/**
 * Static territory definitions. All runtime state lives in rpFactionService's
 * territoryStateById Map — nothing here is persisted to the DB.
 *
 * id                     Stable slug; used as the rp:gangTerritoryPulse key.
 * name                   Human-readable display name.
 * center                 World-space turf centre (same as GROVE_STREET_TURF_CENTER
 *                        for Grove Street — kept here for forward extensibility).
 * radius                 Capture radius (m) — must match turf ring on client.
 * controllingFactionSlug Faction that starts in control and defends this turf.
 */
export const GANG_TERRITORIES: Array<{
  id:                     string;
  name:                   string;
  center:                 [number, number, number];
  radius:                 number;
  controllingFactionSlug: string;
}> = [
  {
    id:                     "grove_street",
    name:                   "Grove Street",
    center:                 GROVE_STREET_TURF_CENTER,
    radius:                 GROVE_STREET_TURF_RADIUS,
    controllingFactionSlug: "grove_street",
  },
];

// ── Phase 8A: Government Office / City Hall ────────────────────────────────
//
// Location: NW inner civic block at [−22, 0, −22].
// Geometry audit (Phase 9A — moved from [−22,−32] so a real City Hall footprint fits):
//   x=−22: nearest NS road x=0,   |−22−0|  =22 > ROAD_HALF(10) ✅
//           nearest NS road x=−45, |−22−(−45)|=23 > ROAD_HALF(10) ✅
//   z=−22: nearest EW road z=0,   |−22−0|  =22 > ROAD_HALF(10) ✅
//           nearest EW road z=−45, |−22−(−45)|=23 > ROAD_HALF(10) ✅
// 18×12 footprint → road edge clearance 3.0 m; ≥27 m from other civic buildings.
// car-3 relocated [−22,−22]→[−22,−31] to clear the new footprint.
// Mirror: client GOVERNMENT_OFFICE_POS in city-sandbox/src/shared/rpTypes.ts.

/** Government Office (City Hall) entrance — NW inner civic block. Off-road. */
export const GOVERNMENT_OFFICE_POS: [number, number, number] = [-22, 0, -22];

/** Radius (m) within which a player can interact with the Government Office. */
export const GOVERNMENT_OFFICE_RADIUS = 8;

/** Maximum characters in a mayor city-announcement message (server-validated). */
export const MAYOR_ANNOUNCE_MAX_CHARS = 200;

/** Minimum ms between two city announcements from the same mayor (server-validated). */
export const MAYOR_ANNOUNCE_COOLDOWN_MS = 30_000;

// ── Phase 8B: City Tax Rate ────────────────────────────────────────────────────

/** Minimum city tax rate (0 = no tax). */
export const CITY_TAX_MIN = 0;

/** Maximum city tax rate (0.15 = 15%). */
export const CITY_TAX_MAX = 0.15;

/** Default city tax rate at server startup (5%). */
export const CITY_TAX_DEFAULT = 0.05;

/** Minimum ms between two tax-rate changes from the same mayor. */
export const MAYOR_SET_TAX_COOLDOWN_MS = 30_000;

// ── Phase 8E: City Budget Grants ──────────────────────────────────────────────

/** Minimum single grant amount in dollars. */
export const CITY_GRANT_MIN = 50;

/** Maximum single grant amount in dollars. */
export const CITY_GRANT_MAX = 1_000;

/** Minimum ms between grants from the same mayor (30 s). */
export const MAYOR_GRANT_COOLDOWN_MS = 30_000;

/** Maximum characters in a grant note (server-validated). */
export const CITY_GRANT_NOTE_MAX_CHARS = 120;

// ── Phase 8F: City Project Funding ────────────────────────────────────────────

/** Duration of each funded city project: 10 minutes. */
export const CITY_PROJECT_DURATION_MS = 10 * 60 * 1_000;

/** Gross pay bonus rate applied by an active project (+10%). */
export const CITY_PROJECT_BONUS_RATE = 0.1;

/**
 * Static project catalogue.  The server is authoritative for costs, durations,
 * and job slug coverage; the client mirrors these values for UI only.
 */
export const CITY_PROJECT_DEFS: ReadonlyArray<{
  readonly id:       string;
  readonly label:    string;
  readonly cost:     number;
  readonly desc:     string;
  readonly jobSlugs: ReadonlyArray<string>;
}> = [
  {
    id:       "public_works",
    label:    "Public Works Boost",
    cost:     500,
    desc:     "City Worker and Delivery Driver payouts +10% for 10 min",
    jobSlugs: ["city_worker", "delivery"],
  },
  {
    id:       "transit_subsidy",
    label:    "Transit Subsidy",
    cost:     400,
    desc:     "Taxi Driver payouts +10% for 10 min",
    jobSlugs: ["taxi"],
  },
  {
    id:       "emergency_funding",
    label:    "Emergency Services Funding",
    cost:     600,
    desc:     "Medic, Mechanic, and Police Patrol payouts +10% for 10 min",
    jobSlugs: ["medic", "mechanic", "police_patrol"],
  },
];

// ── Phase 9A Batch B: RP building footprints ──────────────────────────────────
//
// Axis-aligned building footprints (X/Z plane) for the civic RP buildings that
// have a verified, collision-free placement. The startup validator
// (validateRpBuildings) asserts each footprint clears the road grid, keeps a
// minimum gap from every other building, sits clear of parked cars, and has a
// reachable off-road entrance. The client building renderer (later batch) will
// read the SAME table so geometry and validation never drift.
//
// `facing` is the direction the entrance faces; the door/interact point is the
// front-edge midpoint pushed RP_BUILDING_DOOR_OFFSET metres outside the wall.
//
// MUST stay in sync with RP_BUILDINGS in city-sandbox/src/shared/rpTypes.ts.
// Coordinates here mirror the existing *_POS constants (Batch A) — do not edit
// one without the other.

export type RpBuildingFacing = "north" | "south" | "east" | "west";

export interface RpBuildingDef {
  /** Stable id; matches the civic location it represents. */
  id:     string;
  /** Footprint centre X (mirrors the matching *_POS constant). */
  x:      number;
  /** Footprint centre Z. */
  z:      number;
  /** Footprint width along X. */
  w:      number;
  /** Footprint depth along Z. */
  d:      number;
  /** Direction the entrance faces. */
  facing: RpBuildingFacing;
  /** Short display label. */
  label:  string;
}

/** Metres the door/interact point sits outside the building's front wall. */
export const RP_BUILDING_DOOR_OFFSET = 1.5;

/** Minimum metres required between any two RP building footprint edges. */
export const RP_BUILDING_MIN_GAP = 6;

export const RP_BUILDINGS: ReadonlyArray<RpBuildingDef> = [
  { id: "government_office", x: GOVERNMENT_OFFICE_POS[0], z: GOVERNMENT_OFFICE_POS[2], w: 18, d: 12, facing: "south", label: "City Hall" },
  { id: "city_worker_depot", x: CITY_WORKER_DEPOT[0],     z: CITY_WORKER_DEPOT[2],     w: 16, d: 12, facing: "south", label: "Public Works Depot" },
  { id: "medic_center",      x: MEDIC_CENTER[0],          z: MEDIC_CENTER[2],          w: 18, d: 10, facing: "east",  label: "Medical Center" },
  { id: "mechanic_garage",   x: MECHANIC_GARAGE[0],       z: MECHANIC_GARAGE[2],       w: 18, d: 10, facing: "east",  label: "Mechanic Garage" },
  { id: "dealership",        x: DEALERSHIP_POS[0],        z: DEALERSHIP_POS[2],        w: 22, d: 16, facing: "north", label: "Dealership" },
];

/** Door/interact point for a building: front-edge midpoint pushed outside. */
export function rpBuildingDoor(b: RpBuildingDef): [number, number] {
  const o = RP_BUILDING_DOOR_OFFSET;
  switch (b.facing) {
    case "north": return [b.x, b.z - b.d / 2 - o];
    case "south": return [b.x, b.z + b.d / 2 + o];
    case "east":  return [b.x + b.w / 2 + o, b.z];
    case "west":  return [b.x - b.w / 2 - o, b.z];
  }
}
