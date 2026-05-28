/**
 * Phase 7A: Faction Foundation service.
 * Phase 7C: Added safe read-only list endpoints + rp:factionAssigned emit.
 * Phase 7D: Added handleGangStatus (read-only) + handleGangAction (claim_presence).
 *
 * Provides:
 *   loadFactionForPlayer(playerId)          — DB lookup, returns faction row or null
 *   setPlayerFaction(targetPlayerId, ...)   — DB write, updates rp_players
 *   clearPlayerFaction(targetPlayerId)      — DB write, nullifies faction fields
 *   canUseFactionChat(entry)                — cache check, returns true if player has a faction
 *   handleFactionChat(socket, ctx, rawMsg)  — validate + broadcast to faction members
 *   handleAdminSetFaction(socket, ctx, ...) — dev-only faction assignment via socket
 *   handleListFactions(socket)              — read-only; returns all seeded factions
 *   handleListOnlinePlayers(socket, ctx)    — read-only; returns online player faction summary
 *   handleGangStatus(socket, ctx)           — read-only; returns caller's gang status
 *   handleGangAction(socket, ctx, payload)  — validates membership + rank, broadcasts gang event
 *
 * Admin gate (rp:adminSetFaction):
 *   - ONLY allowed when NODE_ENV !== "production".
 *   - In production the handler is not registered at all (see setupRpHandlers.ts).
 *   - Faction assignment in production must be done directly via the DB.
 *   - A proper server-side admin role system will replace this in a future phase.
 *   - On success emits rp:factionAssigned to the requesting socket.
 */

import type { Socket } from "socket.io";
import { db, rpPlayers, rpFactions } from "@workspace/db";
import { eq }   from "drizzle-orm";
import { logger } from "../lib/logger";
import type { LicenseContext } from "./rpLicenseService";
import type { RpCacheEntry }  from "./rpCache";
import {
  isGang,
  isGroveStreet,
  isFactionRankAtLeast,
  GANG_ACTION_MIN_RANK,
} from "./rpFactionHelpers";
import {
  GROVE_STREET_HANGOUT_POS,
  GROVE_STREET_HANGOUT_RADIUS,
  GROVE_STREET_TURF_CENTER,
  GROVE_STREET_TURF_RADIUS,
} from "../socket/cityData";

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
 * Gate: allowed ONLY when NODE_ENV !== "production".
 * In production this handler is not registered (see setupRpHandlers.ts).
 * The belt-and-suspenders check here protects against accidental mis-configuration.
 *
 * username is client-controlled and is NEVER used as an auth signal.
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
  // ── Dev-only gate ─────────────────────────────────────────────────────────
  // Belt-and-suspenders: also reject here even though setupRpHandlers.ts
  // already skips registration in production.
  if (process.env["NODE_ENV"] === "production") {
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
  // Clamp rank here so the same value is written to DB, cache, profile, and toast.
  const rank           = typeof rawRank === "number"
    ? Math.max(0, Math.min(10, Math.floor(rawRank)))
    : 0;

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
    socket.emit("rp:factionAssigned", {
      targetId:     targetSocketId,
      factionSlug:  null,
      factionName:  null,
      factionType:  null,
      factionColor: null,
      factionRank:  0,
    });
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
  // `rank` was already clamped during payload validation — use it directly.
  targetEntry.factionId    = faction.id;
  targetEntry.factionSlug  = faction.slug;
  targetEntry.factionName  = faction.name;
  targetEntry.factionType  = faction.type;
  targetEntry.factionColor = faction.color;
  targetEntry.factionRank  = rank;   // clamped value

  // Notify the target player of their new profile fields.
  ctx.io.to(targetSocketId).emit("rp:profileUpdate", {
    factionId:    faction.id,
    factionSlug:  faction.slug,
    factionName:  faction.name,
    factionType:  faction.type,
    factionColor: faction.color,
    factionRank:  rank,              // clamped value
  });

  // Notify the issuer: toast + rp:factionAssigned.
  const targetPlayerState = ctx.players.get(targetSocketId);
  const targetName = targetPlayerState?.username ?? targetSocketId;
  socket.emit("rp:toast", {
    msg:      `${targetName} assigned to ${faction.name} (rank ${rank}).`,   // clamped value
    color:    "green",
    duration: 4000,
  });
  socket.emit("rp:factionAssigned", {
    targetId:     targetSocketId,
    factionSlug:  faction.slug,
    factionName:  faction.name,
    factionType:  faction.type,
    factionColor: faction.color,
    factionRank:  rank,
  });
}

// ── handleListFactions ────────────────────────────────────────────────────────

/**
 * Phase 7C: Read-only. Returns all seeded factions (slug, name, type, color).
 * Safe for all connected players — no player IDs or DB UUIDs exposed.
 */
export async function handleListFactions(socket: Socket): Promise<void> {
  const rows = await db
    .select({
      slug:  rpFactions.slug,
      name:  rpFactions.name,
      type:  rpFactions.type,
      color: rpFactions.color,
    })
    .from(rpFactions)
    .orderBy(rpFactions.slug);

  socket.emit("rp:factionsListed", { factions: rows });
}

// ── handleListOnlinePlayers ───────────────────────────────────────────────────

/**
 * Phase 7C: Read-only. Returns faction summary for every currently online socket.
 * Exposes: socketId, username, factionSlug, factionName, factionType, factionRank.
 * No DB IDs, no cash, no location — safe public metadata.
 */
export function handleListOnlinePlayers(
  socket: Socket,
  ctx:    LicenseContext,
): void {
  const players: {
    socketId:    string;
    username:    string;
    factionSlug: string | null;
    factionName: string | null;
    factionType: string | null;
    factionRank: number;
  }[] = [];

  for (const [socketId, entry] of ctx.rpCache.entries()) {
    const playerState = ctx.players.get(socketId);
    players.push({
      socketId,
      username:    playerState?.username ?? socketId,
      factionSlug: entry.factionSlug,
      factionName: entry.factionName,
      factionType: entry.factionType,
      factionRank: entry.factionRank,
    });
  }

  socket.emit("rp:onlinePlayersListed", { players });
}

// ── handleGangStatus ──────────────────────────────────────────────────────────

/**
 * Phase 7D: Read-only. Returns the caller's gang status.
 * Emits rp:gangStatus with faction/rank metadata plus the turf geometry so the
 * client HUD can render the hangout and turf ring without hard-coding coordinates.
 *
 * Non-gang players receive a gangStatus with isMember=false.
 * Security: pure read — no state mutations, no broadcasts.
 */
export function handleGangStatus(
  socket: Socket,
  ctx:    LicenseContext,
): void {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  const isMember    = isGang(entry);
  const isGroveStreetMember = isGroveStreet(entry);

  socket.emit("rp:gangStatus", {
    isMember,
    isGroveStreet: isGroveStreetMember,
    factionSlug:   entry.factionSlug,
    factionName:   entry.factionName,
    factionColor:  entry.factionColor,
    factionRank:   entry.factionRank,
    // Turf geometry for the HUD — allows future server-driven turf changes.
    hangoutPos:    GROVE_STREET_HANGOUT_POS,
    hangoutRadius: GROVE_STREET_HANGOUT_RADIUS,
    turfCenter:    GROVE_STREET_TURF_CENTER,
    turfRadius:    GROVE_STREET_TURF_RADIUS,
  });
}

// ── handleGangAction ──────────────────────────────────────────────────────────

/**
 * Phase 7D: Validates a gang action and broadcasts the outcome to faction members.
 *
 * Supported actions:
 *   claim_presence — player asserts their presence in the turf.
 *     - Requires: gang member, rank >= GANG_ACTION_MIN_RANK, player within turf radius.
 *     - Broadcasts: rp:gangPresence { socketId, username, factionSlug, rank, pos, ts }
 *       to every online socket in the same faction.
 *
 * Server validates position using the authoritative player position from ctx.players.
 * The client-supplied position is NEVER trusted.
 *
 * Security: no persistent state mutations in Phase 7D (turf capture is a later phase).
 */
export function handleGangAction(
  socket:  Socket,
  ctx:     LicenseContext,
  rawPayload: unknown,
): void {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Validate gang membership ──────────────────────────────────────────────
  if (!isGang(entry)) {
    socket.emit("rp:toast", {
      msg:      "You are not a member of a gang.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Validate rank ─────────────────────────────────────────────────────────
  if (!isFactionRankAtLeast(entry, GANG_ACTION_MIN_RANK)) {
    socket.emit("rp:toast", {
      msg:      "Your rank is too low for gang actions.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Parse action ──────────────────────────────────────────────────────────
  const payload = rawPayload as Record<string, unknown> | null | undefined;
  const action  = typeof payload?.action === "string" ? payload.action : "";

  if (action === "claim_presence") {
    // ── Validate turf proximity (server-authoritative position) ───────────
    const playerState = ctx.players.get(socket.id);
    if (!playerState) return;

    const dx   = playerState.x - GROVE_STREET_TURF_CENTER[0];
    const dz   = playerState.z - GROVE_STREET_TURF_CENTER[2];
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > GROVE_STREET_TURF_RADIUS) {
      socket.emit("rp:toast", {
        msg:      "You are not in the turf zone.",
        color:    "yellow",
        duration: 3000,
      });
      return;
    }

    const presencePayload = {
      socketId:    socket.id,
      username:    playerState.username ?? socket.id,
      factionSlug: entry.factionSlug!,
      rank:        entry.factionRank,
      x:           playerState.x,
      z:           playerState.z,
      ts:          Date.now(),
    };

    // Broadcast to every online socket in the same faction.
    let sent = 0;
    for (const [socketId, cacheEntry] of ctx.rpCache.entries()) {
      if (cacheEntry.factionId === entry.factionId) {
        ctx.io.to(socketId).emit("rp:gangPresence", presencePayload);
        sent++;
      }
    }

    logger.debug(
      { socketId: socket.id, factionSlug: entry.factionSlug, dist, recipients: sent },
      "[rpGang] claim_presence broadcast",
    );
    return;
  }

  // Unknown action — ignore silently (no toast, avoids spamming the log for
  // future-proofed clients sending new action types the server hasn't
  // implemented yet).
  logger.debug({ socketId: socket.id, action }, "[rpGang] unknown gang action ignored");
}
