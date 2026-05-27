/**
 * In-memory RP state cache. Keyed by socket.id.
 *
 * Populated from the DB on `join`; updated after wallet transfers and other
 * meaningful events. Cleared on `disconnect`. The DB is the source of truth —
 * this cache exists solely to avoid a DB round-trip on every socket packet.
 */

// ── Per-player cache entry ─────────────────────────────────────────────────

export interface RpCacheEntry {
  /** UUID primary key from rp_players.id */
  playerId:      string;
  cash:          number;
  bank:          number;
  driverLicense: boolean;
  weaponLicense: boolean;
  jailUntil:     Date | null;
  factionId:     string | null;
  /** Denormalised from rp_factions.slug — null when player has no faction. */
  factionSlug:   string | null;
  factionRank:   number;
  currentJob:    string | null;
  onDuty:        boolean;
  wantedStars:   number;
}

// ── Active license-test state ──────────────────────────────────────────────

export interface TestState {
  vehicleId: string;
  nextCp:    number;
  startedAt: number;   // Unix ms
  lastCpAt:  number;   // Unix ms
}

// ── Module-level maps ──────────────────────────────────────────────────────

/** socketId → RpCacheEntry. Entry removed on disconnect. */
export const rpCache = new Map<string, RpCacheEntry>();

/** socketId → TestState. Entry removed on disconnect or test end. */
export const rpTestState = new Map<string, TestState>();

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
  };
}
