/**
 * Player DB service — upsert on stable token, ensure wallet row exists,
 * return an RpCacheEntry ready to store in rpCache.
 */

import { db, rpPlayers, rpWallets, rpWarrants, rpFactions } from "@workspace/db";
import { eq, and, isNull, max }                              from "drizzle-orm";
import type { RpCacheEntry } from "./rpCache";

/**
 * Upsert a player by token and return a populated RpCacheEntry.
 *
 * - If the token is new: inserts rp_players + rp_wallets (cash=500, bank=0).
 * - If the token exists: updates username + last_seen_at, leaves wallet alone.
 * - Always loads the wallet row and builds the full cache entry.
 *
 * Throws if the DB is unreachable.
 */
export async function upsertPlayer(
  token:    string,
  username: string,
): Promise<RpCacheEntry> {
  // Upsert the player row. On conflict (same token) update mutable fields.
  const [player] = await db
    .insert(rpPlayers)
    .values({ token, username })
    .onConflictDoUpdate({
      target: rpPlayers.token,
      set: {
        username,
        lastSeenAt: new Date(),
      },
    })
    .returning();

  if (!player) {
    throw new Error(`[rp] upsertPlayer returned no row for token=${token}`);
  }

  // Ensure the wallet row exists. Column defaults supply cash=500, bank=0.
  await db
    .insert(rpWallets)
    .values({ playerId: player.id })
    .onConflictDoNothing();

  // Load the wallet (always present after the insert above).
  const [wallet] = await db
    .select()
    .from(rpWallets)
    .where(eq(rpWallets.playerId, player.id));

  // Phase 6A: query the highest active (un-cleared) warrant star count.
  const [warrantRow] = await db
    .select({ maxStars: max(rpWarrants.stars) })
    .from(rpWarrants)
    .where(
      and(
        eq(rpWarrants.playerId, player.id),
        isNull(rpWarrants.clearedAt),
      ),
    );
  const wantedStars = warrantRow?.maxStars !== null && warrantRow?.maxStars !== undefined
    ? Number(warrantRow.maxStars)
    : 0;

  // Phase 7A: JOIN rp_factions to load slug, name, type, color if player has a faction.
  let factionSlug:  string | null = null;
  let factionName:  string | null = null;
  let factionType:  string | null = null;
  let factionColor: string | null = null;

  if (player.factionId) {
    const [faction] = await db
      .select()
      .from(rpFactions)
      .where(eq(rpFactions.id, player.factionId));
    if (faction) {
      factionSlug  = faction.slug;
      factionName  = faction.name;
      factionType  = faction.type;
      factionColor = faction.color;
    }
  }

  return {
    playerId:       player.id,
    cash:           wallet?.cash  ?? 500,
    bank:           wallet?.bank  ?? 0,
    driverLicense:  player.driverLicenseAt !== null,
    weaponLicense:  player.weaponLicenseAt !== null,
    jailUntil:      player.jailUntil ?? null,
    jailReason:     player.jailReason ?? null,
    factionId:      player.factionId ?? null,
    factionSlug,
    factionName,
    factionType,
    factionColor,
    factionRank:    player.factionRank,
    currentJob:     player.currentJob ?? null,
    // Phase 4: in-memory job route state is never persisted across reconnects.
    // Always start as off-duty so the client HUD is in a consistent state even
    // if the DB still has on_duty=true from a crash/disconnect mid-route.
    onDuty:         false,
    // Phase 4: load last paycheck timestamp so the 60-second cooldown survives
    // reconnects (player cannot farm by reconnecting just before cooldown expires).
    lastPaycheckAt: player.lastPaycheckAt ? player.lastPaycheckAt.getTime() : null,
    // Phase 6A: loaded above from rp_warrants WHERE cleared_at IS NULL.
    wantedStars,
    // Phase 6C: cuff state is in-memory only — always starts null on join.
    cuffedBy:       null,
    cuffedUntil:    null,
    // Phase 3: loaded separately via loadAndSpawnOwnedVehicles after join.
    ownedVehicles:  [],
  };
}
