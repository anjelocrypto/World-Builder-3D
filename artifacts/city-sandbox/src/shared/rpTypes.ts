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

/**
 * Test vehicle starting position (Phase 2). Center at x=13; body edge at
 * x=12 → 2 m clearance from the x=0 road boundary at x=10.
 */
export const TEST_VEHICLE_SPAWN: [number, number, number] = [13, 0.6, -30];

/** Cash cost to attempt the driver license test (Phase 2). */
export const TEST_FEE = 200;

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

// ── Client-side optimistic license check ──────────────────────────────────

/**
 * Returns true if a player with the given profile is allowed to drive
 * `vehicleId`. This is an optimistic client check only — the server also
 * enforces this in vehicleUpdate. Never use the client result to unlock
 * real game state; use it only to skip the emitVehicleUpdate call and
 * show feedback.
 */
export function canDriveVehicleClient(
  vehicleId: string,
  rp: RpProfile | null,
): boolean {
  if (!rp) return false;
  if (rp.driverLicense) return true;
  if (rp.activeTest?.vehicleId === vehicleId) return true;
  return false;
}
