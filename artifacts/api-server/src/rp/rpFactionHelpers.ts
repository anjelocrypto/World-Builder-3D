/**
 * Phase 7B: Faction authority helpers.
 * Phase 7D: Added gang helpers (isGang, isGroveStreet) + gang rank constants.
 *
 * Pure functions over RpCacheEntry — no DB, no sockets.
 * Import these wherever faction membership needs to be checked.
 *
 * Rank constants are defined here so they can be tightened in one place.
 * Current values are intentionally permissive for the prototype:
 *   - Most police actions require rank >= 0 (any police faction member)
 *   - Arrest requires rank >= 1 (junior officer and above)
 *   - Gang actions require rank >= 0 (any gang member)
 *   - Gang leader abilities require rank >= 4
 */

import type { RpCacheEntry } from "./rpCache";

// ── Rank constants ─────────────────────────────────────────────────────────────

/** Minimum faction rank to issue a warrant. */
export const POLICE_WARRANT_MIN_RANK = 0;
/** Minimum faction rank to issue a fine / ticket. */
export const POLICE_FINE_MIN_RANK    = 0;
/** Minimum faction rank to cuff a suspect. */
export const POLICE_CUFF_MIN_RANK    = 0;
/** Minimum faction rank to make an arrest. */
export const POLICE_ARREST_MIN_RANK  = 1;

// ── Phase 7D: Gang rank constants ──────────────────────────────────────────────

/** Minimum faction rank to perform a gang action (any member). */
export const GANG_ACTION_MIN_RANK  = 0;
/** Minimum faction rank for gang leader abilities. */
export const GANG_LEADER_MIN_RANK  = 4;

// ── Faction membership helpers ─────────────────────────────────────────────────

/**
 * True if the cache entry belongs to the police faction.
 * Checks both factionType ("police") and factionSlug ("police") for robustness.
 */
export function isPolice(entry: RpCacheEntry): boolean {
  return entry.factionType === "police" || entry.factionSlug === "police";
}

/**
 * True if the cache entry belongs to the medic faction.
 */
export function isMedic(entry: RpCacheEntry): boolean {
  return entry.factionType === "medic" || entry.factionSlug === "medic";
}

/**
 * True if the cache entry belongs to the government faction.
 */
export function isGovernment(entry: RpCacheEntry): boolean {
  return entry.factionType === "government" || entry.factionSlug === "government";
}

/**
 * True if the player's faction rank meets or exceeds minRank.
 * Always false when minRank > 0 and entry has no faction (factionRank defaults to 0).
 */
export function isFactionRankAtLeast(entry: RpCacheEntry, minRank: number): boolean {
  return entry.factionRank >= minRank;
}

// ── Phase 7D: Gang membership helpers ─────────────────────────────────────────

/**
 * True if the cache entry belongs to any gang faction (factionType === "gang").
 */
export function isGang(entry: RpCacheEntry): boolean {
  return entry.factionType === "gang";
}

/**
 * True if the cache entry belongs to the Grove Street Families gang specifically.
 */
export function isGroveStreet(entry: RpCacheEntry): boolean {
  return entry.factionSlug === "grove_street";
}
