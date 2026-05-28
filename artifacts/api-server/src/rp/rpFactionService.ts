/**
 * Phase 7A: Faction Foundation service.
 *
 * Provides:
 *   loadFactionForPlayer(playerId)          — DB lookup, returns faction row or null
 *   setPlayerFaction(targetPlayerId, ...)   — DB write, updates rp_players
 *   clearPlayerFaction(targetPlayerId)      — DB write, nullifies faction fields
 *   canUseFactionChat(entry)                — cache check, returns true if player has a faction
 *   handleFactionChat(socket, ctx, rawMsg)  — validate + broadcast to faction members
 *   handleAdminSetFaction(socket, ctx, ...) — admin-only faction assignment via socket
 *
 * Faction chat rules:
 *   - Player must have factionId set in rpCache (i.e. loaded from DB on join).
 *   - msg must be a non-empty string, trimmed, max 180 chars.
 *   - Player must not be jailed.
 *   - Broadcast only to sockets whose rpCache entry has the SAME factionId.
 *   - Server supplies fromName, factionSlug, factionName, factionColor, createdAt.
 *
 * Admin gate (rp:adminSetFaction):
 *   - Allowed in development mode (NODE_ENV !== "production") OR if username === "admin".
 *   - No public privilege escalation. Document as DEV/manual-only until admin system phase.
 */

import type { Socket } from "socket.io";
import { db, rpPlayers, rpFactions } from "@workspace/db";
import { eq }   from "drizzle-orm";
import { logger } from "../lib/logger";
import type { LicenseContext } from "./rpLicenseService";
import type { RpCacheEntry }  from "./rpCache";

// ── Faction DB row (partial, fields we care about) ────────────────────────────

export interface FactionRow {
  id:    string;
  slug:  string;
  name:  string;
  type:  string;
  color: string;
}

// ── loadFactionForPlayer ──────────────────────────────────────────────────────

/**
 * Load the faction row for a player from the DB.
 * Returns null if the player has no faction or faction row is missing.
 */
export async function loadFactionForPlayer(
  playerId: string,
): Promise<FactionRow | null> {
  // JOIN rp_players → rp_factions for this player.
  const [row] = await db
    .select({
      factionId:    rpFactions.id,
      factionSlug:  rpFactions.slug,
      factionName:  rpFactions.name,
      factionType:  rpFactions.type,
      factionColor: rpFactions.color,
    })
    .from(rpPlayers)
    .innerJoin(rpFactions, eq(rpPlayers.factionId, rpFactions.id))
    .where(eq(rpPlayers.id, playerId));

  if (!row) return null;

  return {
    id:    row.factionId,
    slug:  row.factionSlug,
    name:  row.factionName,
    type:  row.factionType,
    color: row.factionColor,
  };
}

// ── setPlayerFaction ──────────────────────────────────────────────────────────

/**
 * Assign a faction + rank to a player in the DB.
 * Resolves the faction UUID from slug. Throws if slug is unknown.
 */
export async function setPlayerFaction(
  targetPlayerId: string,
  factionSlug:    string,
  rank:           number,
): Promise<FactionRow> {
  // Resolve faction row by slug.
  const [faction] = await db
    .select()
    .from(rpFactions)
    .where(eq(rpFactions.slug, factionSlug));

  if (!faction) {
    throw new Error(`[rpFaction] unknown faction slug: ${factionSlug}`);
  }

  const clampedRank = Math.max(0, Math.min(10, Math.floor(rank)));

  await db
    .update(rpPlayers)
    .set({ factionId: faction.id, factionRank: clampedRank })
    .where(eq(rpPlayers.id, targetPlayerId));

  logger.info(
    { targetPlayerId, factionSlug, rank: clampedRank },
    "[rpFaction] faction assigned",
  );

  return { id: faction.id, slug: faction.slug, name: faction.name, type: faction.type, color: faction.color };
}

// ── clearPlayerFaction ────────────────────────────────────────────────────────

/**
 * Remove a player's faction assignment in the DB.
 */
export async function clearPlayerFaction(targetPlayerId: string): Promise<void> {
  await db
    .update(rpPlayers)
    .set({ factionId: null, factionRank: 0 })
    .where(eq(rpPlayers.id, targetPlayerId));

  logger.info({ targetPlayerId }, "[rpFaction] faction cleared");
}

// ── canUseFactionChat ─────────────────────────────────────────────────────────

/**
 * Returns true if the cache entry has a faction assigned.
 * Does NOT check jailed state — callers must check that separately.
 */
export function canUseFactionChat(entry: RpCacheEntry): boolean {
  return entry.factionId !== null && entry.factionSlug !== null;
}

// ── handleFactionChat ─────────────────────────────────────────────────────────

/**
 * Phase 7A: Handle rp:factionChat from a client.
 * Validates message, finds all sockets in same faction, and broadcasts.
 */
export function handleFactionChat(
  socket:    Socket,
  ctx:       LicenseContext,
  rawMsg:    unknown,
): void {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // Player must have a faction.
  if (!canUseFactionChat(entry)) {
    socket.emit("rp:toast", {
      msg:      "You are not a member of any faction.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Player must not be jailed.
  if (entry.jailUntil !== null) {
    socket.emit("rp:toast", {
      msg:      "You cannot use faction chat while in jail.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Validate message.
  const msg =
    typeof rawMsg === "string" && rawMsg.trim().length > 0
      ? rawMsg.trim().slice(0, 180)
      : "";
  if (!msg) return;

  const player = ctx.players.get(socket.id);
  const fromName = player?.username ?? socket.id;

  const payload = {
    fromId:       socket.id,
    fromName,
    factionSlug:  entry.factionSlug!,
    factionName:  entry.factionName  ?? entry.factionSlug!,
    factionColor: entry.factionColor ?? "#ffffff",
    msg,
    createdAt:    Date.now(),
  };

  // Broadcast to all sockets in the same faction (including sender).
  let sent = 0;
  for (const [socketId, cacheEntry] of ctx.rpCache.entries()) {
    if (cacheEntry.factionId === entry.factionId) {
      ctx.io.to(socketId).emit("rp:factionChat", payload);
      sent++;
    }
  }

  logger.debug(
    { socketId: socket.id, factionSlug: entry.factionSlug, recipients: sent },
    "[rpFaction] faction chat broadcast",
  );
}

// ── handleAdminSetFaction ─────────────────────────────────────────────────────

/**
 * Phase 7A: rp:adminSetFaction handler.
 *
 * Gate: allowed only if:
 *   a) NODE_ENV !== "production"  (development / staging), OR
 *   b) The requesting player's username is "admin" (dev placeholder).
 *
 * This is intentionally restrictive. A full admin system will be introduced
 * in a later phase. Until then, faction assignment is DB/manual or dev-only.
 *
 * Payload: { targetId: string, factionSlug: string, rank: number }
 * targetId — socket.id of the target player (must be online)
 */
export async function handleAdminSetFaction(
  socket:         Socket,
  ctx:            LicenseContext,
  rawTargetId:    unknown,
  rawFactionSlug: unknown,
  rawRank:        unknown,
): Promise<void> {
  // ── Admin gate ────────────────────────────────────────────────────────────
  const isDev      = process.env["NODE_ENV"] !== "production";
  const player     = ctx.players.get(socket.id);
  const isAdminUser = player?.username === "admin";

  if (!isDev && !isAdminUser) {
    socket.emit("rp:toast", {
      msg:      "Permission denied.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Validate payload ──────────────────────────────────────────────────────
  const targetSocketId = typeof rawTargetId    === "string" ? rawTargetId.trim()    : "";
  const factionSlug    = typeof rawFactionSlug === "string" ? rawFactionSlug.trim() : "";
  const rank           = typeof rawRank        === "number" ? Math.floor(rawRank)   : 0;

  if (!targetSocketId) {
    socket.emit("rp:toast", { msg: "Missing targetId.", color: "red", duration: 3000 });
    return;
  }

  const targetEntry = ctx.rpCache.get(targetSocketId);
  if (!targetEntry) {
    socket.emit("rp:toast", {
      msg:      "Target player not found (must be online).",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Clear faction ─────────────────────────────────────────────────────────
  if (factionSlug === "" || factionSlug === "none") {
    await clearPlayerFaction(targetEntry.playerId);
    // Update in-memory cache.
    targetEntry.factionId    = null;
    targetEntry.factionSlug  = null;
    targetEntry.factionName  = null;
    targetEntry.factionType  = null;
    targetEntry.factionColor = null;
    targetEntry.factionRank  = 0;
    ctx.io.to(targetSocketId).emit("rp:profileUpdate", {
      factionId:    null,
      factionSlug:  null,
      factionName:  null,
      factionType:  null,
      factionColor: null,
      factionRank:  0,
    });
    socket.emit("rp:toast", { msg: "Faction cleared.", color: "green", duration: 3000 });
    return;
  }

  // ── Assign faction ────────────────────────────────────────────────────────
  let faction: FactionRow;
  try {
    faction = await setPlayerFaction(targetEntry.playerId, factionSlug, rank);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    socket.emit("rp:toast", { msg, color: "red", duration: 4000 });
    return;
  }

  // Update in-memory cache immediately.
  targetEntry.factionId    = faction.id;
  targetEntry.factionSlug  = faction.slug;
  targetEntry.factionName  = faction.name;
  targetEntry.factionType  = faction.type;
  targetEntry.factionColor = faction.color;
  targetEntry.factionRank  = rank;

  // Notify the target player of their new profile fields.
  ctx.io.to(targetSocketId).emit("rp:profileUpdate", {
    factionId:    faction.id,
    factionSlug:  faction.slug,
    factionName:  faction.name,
    factionType:  faction.type,
    factionColor: faction.color,
    factionRank:  rank,
  });

  // Notify the issuer.
  const targetPlayerState = ctx.players.get(targetSocketId);
  const targetName = targetPlayerState?.username ?? targetSocketId;
  socket.emit("rp:toast", {
    msg:      `${targetName} assigned to ${faction.name} (rank ${rank}).`,
    color:    "green",
    duration: 4000,
  });
}
