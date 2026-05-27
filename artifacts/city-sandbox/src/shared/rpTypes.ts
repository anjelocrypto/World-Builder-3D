/**
 * Shared RP types — consumed by client UI and used as the shape of server
 * socket payloads. The api-server NEVER imports from city-sandbox; it emits
 * plain objects that conform to these interfaces.
 */

// ── Profile types ──────────────────────────────────────────────────────────

export interface ActiveTest {
  vehicleId:   string;
  checkpoints: [number, number, number][];
  nextCp:      number;
}

/** Phase 3: one player-owned vehicle as returned by the server. */
export interface OwnedVehicleSummary {
  dbId:      string;
  vehicleId: string;
  model:     string;
  variant:   string;
  color:     string;
  plate:     string;
  locked:    boolean;
}

/** Phase 3: one entry in the dealership catalog as used by the shop UI. */
export interface VehicleShopItem {
  model:   string;
  variant: string;
  price:   number;
  colors:  readonly string[];
}

/** Phase 4+: active job route payload. Phase 5A adds label + mode. */
export interface ActiveJob {
  job:         string;
  /** Human-readable name for HUD display (e.g. "City Worker", "Taxi Driver"). */
  label:       string;
  /** "walk" = on-foot route; "vehicle" = must be driving. */
  mode:        "walk" | "vehicle";
  checkpoints: [number, number, number][];
  nextCp:      number;
  pay:         number;
}

export interface RpProfile {
  playerId:      string;
  cash:          number;
  bank:          number;
  driverLicense: boolean;
  weaponLicense: boolean;
  /** Unix ms timestamp; null means the player is not jailed. */
  jailUntil:     number | null;
  factionId:     string | null;
  /** Denormalised from rp_factions.slug for fast HUD render. */
  factionSlug:   string | null;
  factionRank:   number;
  currentJob:    string | null;
  onDuty:        boolean;
  wantedStars:   number;
  /** Non-null only while a driver-license test is in progress. */
  activeTest:    ActiveTest | null;
  /** Phase 3: vehicles owned by this player. Empty until server sends them. */
  ownedVehicles: OwnedVehicleSummary[];
  /** Phase 4: non-null while a City Worker route is active. */
  activeJob:     ActiveJob | null;
}

export interface RpToast {
  id:        number;   // client-assigned monotonic id for keying
  msg:       string;
  color:     "red" | "green" | "yellow" | "blue" | string;
  duration?: number;   // ms; default 3000
}

// ── World coordinate constants ─────────────────────────────────────────────
// All positions are [x, y, z] in world-space. rotY convention: 0 = front
// toward −Z (matches vehicleObb + LocalPlayer updateVehicle forward axis).

/** Platform center of Central Loop Station exterior (ground level). */
export const STATION_MARKER_POS: [number, number, number] = [132, 0, -65];

/**
 * Primary player spawn — ground-level exterior east of the Central Loop
 * Station stair foot (x=122). Validated against all buildings, roads, parked
 * cars, and static obstacles. See NEMOVERSE_RP_PLAN.md §5.3 + §5.4.
 */
export const STATION_SPAWN: [number, number, number] = [128, 1, -65];

/** Random jitter applied per-spawn: X ∈ [−JITTER_X, +JITTER_X]. */
export const STATION_SPAWN_JITTER_X = 4;
/** Random jitter applied per-spawn: Z ∈ [−JITTER_Z, +JITTER_Z]. */
export const STATION_SPAWN_JITTER_Z = 3;

/** Licensing Office entrance — SE inner block, east-facing sidewalk. */
export const LICENSING_OFFICE_POS: [number, number, number] = [14, 0, -30];

/** Vehicle dealership entrance — NE outer district. */
export const DEALERSHIP_POS: [number, number, number] = [68, 0, -72];

/**
 * Dealership catalog — mirrors server VEHICLE_SHOP_CATALOG in cityData.ts.
 * Must stay in sync; the server allowlist is authoritative.
 */
export const VEHICLE_SHOP_CATALOG: VehicleShopItem[] = [
  { model: "compact", variant: "compact", price: 300, colors: ["#e84141", "#4169e1", "#f5f5f5", "#2d2d2d"] },
  { model: "sedan",   variant: "sedan",   price: 700, colors: ["#e84141", "#4169e1", "#f5f5f5", "#2d2d2d", "#1a5c1a"] },
  { model: "taxi",    variant: "taxi",    price: 900, colors: ["#f5c518"] },
  { model: "van",     variant: "van",     price: 1200, colors: ["#e84141", "#f5f5f5", "#1a5c1a", "#2d2d2d"] },
];

/**
 * Test vehicle starting position (Phase 2). Center at x=13; body edge at
 * x=12 → 2 m clearance from the x=0 road boundary at x=10.
 */
export const TEST_VEHICLE_SPAWN: [number, number, number] = [13, 0.6, -30];

/** Cash cost to attempt the driver license test (Phase 2). */
export const TEST_FEE = 200;

// ── Phase 4: City Worker job constants ────────────────────────────────────
// These MUST stay in sync with CITY_WORKER_* in api-server/src/socket/cityData.ts.

/** City Worker depot position [x, y, z]. */
export const CITY_WORKER_DEPOT: [number, number, number] = [30, 0, 28];

/** Radius (m) within which the player can clock in/out at the depot. */
export const CITY_WORKER_DEPOT_RADIUS = 6;

/** Walking patrol checkpoints around the central plaza (server-authoritative order). */
export const CITY_WORKER_CHECKPOINTS: [number, number, number][] = [
  [ 22, 0.5, -18],  // CP0 — E side, south half
  [ 22, 0.5,  18],  // CP1 — E side, north half
  [-22, 0.5,  18],  // CP2 — W side, north half
  [-22, 0.5, -18],  // CP3 — W side, south half
];

/** Pay for completing a full City Worker route. */
export const JOB_CITY_WORKER_PAY = 120;

/** Acceptance radius (m) for each job checkpoint. */
export const JOB_CP_ACCEPT_RADIUS = 8;

/**
 * License-test checkpoint route (Phase 2).
 * South on x=0 road → east on z=−45 → north on x=45 → finish at office.
 */
export const LICENSE_TEST_CHECKPOINTS: [number, number, number][] = [
  [  2, 0.5, -40],   // CP0 — south on x=0 road, approaching z=−45 intersection
  [ 42, 0.5, -44],   // CP1 — east on z=−45 road, at x=45 intersection
  [ 42, 0.5, -14],   // CP2 — north on x=45 road, mid-block
  [ 14, 0.5, -26],   // CP3 — finish line near Licensing Office entrance
];

// ── Phase 5A: Taxi Driver job constants ───────────────────────────────────
// These MUST stay in sync with TAXI_* in api-server/src/socket/cityData.ts.

/** Taxi Depot position [x, y, z]. */
export const TAXI_DEPOT: [number, number, number] = [-30, 0, -15];

/** Radius (m) within which the player can clock in/out at the Taxi Depot. */
export const TAXI_DEPOT_RADIUS = 6;

/** Acceptance radius (m) for taxi pickup/dropoff stages. */
export const TAXI_CP_ACCEPT_RADIUS = 12;

// ── Client-side optimistic license + lock check ────────────────────────────

/**
 * Returns true if a player with the given profile is allowed to drive
 * `vehicleId`. Accepts optional ownership fields so locked owned vehicles
 * are blocked optimistically before the server rejects them.
 *
 * This is an optimistic client check only — the server also enforces this in
 * vehicleUpdate. Never use the client result to unlock real game state; use it
 * only to skip the emitVehicleUpdate call and show feedback.
 */
export function canDriveVehicleClient(
  vehicleId: string,
  rp: RpProfile | null,
  vehicleOwned?: boolean,
  vehicleLocked?: boolean,
  vehicleOwnerId?: string,
): boolean {
  if (!rp) return false;
  // Phase 3: locked owned vehicle — only owner can enter
  if (vehicleOwned && vehicleLocked) {
    const isOwner = rp.ownedVehicles.some(
      (v) => v.vehicleId === vehicleId && v.dbId !== undefined,
    ) || vehicleOwnerId === rp.playerId;
    if (!isOwner) return false;
  }
  if (rp.driverLicense) return true;
  if (rp.activeTest?.vehicleId === vehicleId) return true;
  return false;
}
