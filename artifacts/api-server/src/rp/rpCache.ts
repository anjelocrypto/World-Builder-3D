/**
 * In-memory RP state cache. Keyed by socket.id.
 *
 * Populated from the DB on `join`; updated after wallet transfers and other
 * meaningful events. Cleared on `disconnect`. The DB is the source of truth —
 * this cache exists solely to avoid a DB round-trip on every socket packet.
 */

// ── Per-player cache entry ─────────────────────────────────────────────────

/** Minimal summary of one player-owned vehicle kept in the RP cache. */
export interface OwnedVehicleSummary {
  /** UUID primary key from rp_owned_vehicles.id */
  dbId:      string;
  /** In-world vehicle id: "ov-<dbId>". Unique per session. */
  vehicleId: string;
  model:     string;
  variant:   string;
  color:     string;
  plate:     string;
  locked:    boolean;
}

export interface RpCacheEntry {
  /** UUID primary key from rp_players.id */
  playerId:       string;
  cash:           number;
  bank:           number;
  driverLicense:  boolean;
  weaponLicense:  boolean;
  jailUntil:      Date | null;
  factionId:      string | null;
  /** Denormalised from rp_factions.slug — null when player has no faction. */
  factionSlug:    string | null;
  factionRank:    number;
  currentJob:     string | null;
  onDuty:         boolean;
  /**
   * Unix ms of the last completed job route — loaded from DB on join so the
   * 60-second cooldown survives reconnects. null = never completed a route.
   */
  lastPaycheckAt: number | null;
  wantedStars:    number;
  /** Phase 3: vehicles owned by this player. Populated after DB load on join. */
  ownedVehicles:  OwnedVehicleSummary[];
}

// ── Active license-test state ──────────────────────────────────────────────

export interface TestState {
  vehicleId: string;
  nextCp:    number;
  startedAt: number;   // Unix ms
  lastCpAt:  number;   // Unix ms
}

// ── Active job state (Phase 4) ─────────────────────────────────────────────

/** In-memory job route progress. Keyed by socket.id. Cleared on disconnect. */
export interface JobState {
  job:       string;   // e.g. "city_worker" | "taxi_driver"
  nextCp:    number;   // index of next expected checkpoint (0=pickup, 1=dropoff for taxi)
  startedAt: number;   // Unix ms — when the player clocked in
  lastCpAt:  number;   // Unix ms — last accepted checkpoint hit; 0 = none yet

  // Phase 5A — Taxi Driver extras (undefined for city_worker)
  /** Server-assigned pickup position [x, y, z]. */
  taxiPickup?:  [number, number, number];
  /** Server-assigned dropoff position [x, y, z]. */
  taxiDropoff?: [number, number, number];
  /** Calculated fare in $, rounded to nearest $10. */
  taxiFare?:    number;
}

// ── Module-level maps ──────────────────────────────────────────────────────

/** socketId → RpCacheEntry. Entry removed on disconnect. */
export const rpCache = new Map<string, RpCacheEntry>();

/** socketId → TestState. Entry removed on disconnect or test end. */
export const rpTestState = new Map<string, TestState>();

/** socketId → JobState. Entry removed on disconnect or route end/abort. */
export const rpJobState = new Map<string, JobState>();

// ── Profile builder ────────────────────────────────────────────────────────

/**
 * Converts a cache entry (and optional test state) into the plain-object
 * shape that matches the client's `RpProfile` interface. This is what the
 * server emits as `rp:profile` / `rp:profileUpdate`.
 */
export function buildProfile(
  entry: RpCacheEntry,
  testState?: TestState,
  testCheckpoints?: [number, number, number][],
): Record<string, unknown> {
  return {
    playerId:      entry.playerId,
    cash:          entry.cash,
    bank:          entry.bank,
    driverLicense: entry.driverLicense,
    weaponLicense: entry.weaponLicense,
    jailUntil:     entry.jailUntil ? entry.jailUntil.getTime() : null,
    factionId:     entry.factionId,
    factionSlug:   entry.factionSlug,
    factionRank:   entry.factionRank,
    currentJob:    entry.currentJob,
    onDuty:        entry.onDuty,
    wantedStars:   entry.wantedStars,
    activeTest:    testState
      ? {
          vehicleId:   testState.vehicleId,
          checkpoints: testCheckpoints ?? [],
          nextCp:      testState.nextCp,
        }
      : null,
    // Phase 3: owned vehicles summary (client displays in shop/garage UI).
    ownedVehicles: entry.ownedVehicles,
    // Phase 4: activeJob is always null at join time — job route state is
    // in-memory and emitted as rp:profileUpdate patches by rpJobService.
    activeJob:     null,
  };
}
