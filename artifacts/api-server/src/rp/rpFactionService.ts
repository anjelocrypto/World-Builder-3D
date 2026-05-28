/**
 * Phase 7A: Faction Foundation service.
 * Phase 7C: Added safe read-only list endpoints + rp:factionAssigned emit.
 * Phase 7D: Added handleGangStatus (read-only) + handleGangAction (claim_presence).
 * Phase 7E: Added gang recruitment — handleGangJoinRequest, handleGangJoinResponse,
 *            cleanupPendingGangRequest, module-level pendingGangRequests Map.
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
 *   handleGangJoinRequest(socket, ctx, p)   — non-member requests to join a gang faction
 *   handleGangJoinResponse(socket, ctx, p)  — leader accepts or rejects a pending request
 *   cleanupPendingGangRequest(socketId)     — called on disconnect to remove stale requests
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
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { LicenseContext } from "./rpLicenseService";
import type { RpCacheEntry }  from "./rpCache";
import {
  isGang,
  isGroveStreet,
  isFactionRankAtLeast,
  GANG_ACTION_MIN_RANK,
  GANG_LEADER_MIN_RANK,
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

  // P2: count online members in the same faction for memberCountOnline.
  let memberCountOnline = 0;
  if (isMember && entry.factionId) {
    for (const cacheEntry of ctx.rpCache.values()) {
      if (cacheEntry.factionId === entry.factionId) memberCountOnline++;
    }
  }

  socket.emit("rp:gangStatus", {
    isMember,
    isGroveStreet:      isGroveStreetMember,
    factionSlug:        entry.factionSlug,
    factionName:        entry.factionName,
    factionColor:       entry.factionColor,
    factionRank:        entry.factionRank,
    // P2: required fields from prompt.
    turfName:           isGroveStreetMember ? "Grove Street" : null,
    memberCountOnline,
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

  // ── P1: Reject jailed players ────────────────────────────────────────────
  if (entry.jailUntil !== null && entry.jailUntil.getTime() > Date.now()) {
    socket.emit("rp:toast", {
      msg:      "You cannot use gang actions while in jail.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── P1: Reject cuffed players ─────────────────────────────────────────────
  if (entry.cuffedBy !== null) {
    socket.emit("rp:toast", {
      msg:      "You cannot use gang actions while restrained.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

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
    // ── P2: claim_presence is Grove Street-specific until multi-gang turf
    //        mapping is added in a later phase. ────────────────────────────
    if (!isGroveStreet(entry)) {
      socket.emit("rp:toast", {
        msg:      "Your gang does not have a turf assigned yet.",
        color:    "yellow",
        duration: 3000,
      });
      return;
    }

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

    // ── P1/P2: Safe presence payload — no coordinates. ────────────────────
    const presencePayload = {
      fromId:      socket.id,
      fromName:    playerState.username ?? socket.id,
      factionSlug: entry.factionSlug!,
      turfName:    "Grove Street",
      createdAt:   Date.now(),
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

// ── Phase 7E: Gang Recruitment ────────────────────────────────────────────────

/**
 * In-memory store of pending gang join requests.
 * Key: socketId of the requesting player.
 * Value: request metadata.
 *
 * Intentionally not persisted — requests survive only for the server session.
 * Accepted memberships ARE persisted via the existing DB faction write.
 */
interface PendingGangRequest {
  socketId:    string;
  username:    string;
  factionSlug: string;
  factionId:   string;
  ts:          number;
}
const pendingGangRequests = new Map<string, PendingGangRequest>();

/** P2: Pending requests older than this are silently dropped. */
const GANG_REQUEST_TTL_MS = 60_000; // 60 s

/**
 * Removes expired pending requests for a faction.
 * Returns true if any entries were pruned (caller can skip rebroadcast if false
 * and it would be a no-op, though most call sites broadcast unconditionally).
 */
function pruneExpiredGangRequests(factionId: string): boolean {
  const now  = Date.now();
  let pruned = false;
  for (const [socketId, req] of pendingGangRequests.entries()) {
    if (req.factionId === factionId && now - req.ts > GANG_REQUEST_TTL_MS) {
      pendingGangRequests.delete(socketId);
      pruned = true;
      logger.debug({ socketId, factionSlug: req.factionSlug }, "[rpGang] pending join request expired (60 s TTL)");
    }
  }
  return pruned;
}

/**
 * Broadcasts the current pending requests for a faction to all its online leaders.
 * Called after any mutation (add / remove / expiry) to keep leader HUDs in sync.
 * Prunes expired requests before building the list.
 */
function broadcastPendingRequests(ctx: LicenseContext, factionId: string): void {
  pruneExpiredGangRequests(factionId);

  const requests = Array.from(pendingGangRequests.values())
    .filter((r) => r.factionId === factionId)
    .map((r) => ({
      fromId:      r.socketId,
      fromName:    r.username,
      factionSlug: r.factionSlug,
      ts:          r.ts,
    }));

  for (const [socketId, cacheEntry] of ctx.rpCache.entries()) {
    if (
      cacheEntry.factionId === factionId &&
      isFactionRankAtLeast(cacheEntry, GANG_LEADER_MIN_RANK)
    ) {
      ctx.io.to(socketId).emit("rp:gangJoinRequests", requests);
    }
  }
}

/**
 * Phase 7E: A non-gang player near the Grove Street hangout requests to join.
 *
 * Client emits: rp:gangJoinRequest { factionSlug: "grove_street" }
 *
 * Server validates:
 *   - Not jailed / not cuffed.
 *   - Not already in a gang.
 *   - factionSlug is a known gang faction (DB lookup).
 *   - No duplicate pending request from this socket (one at a time).
 *
 * On success:
 *   - Stores request in pendingGangRequests.
 *   - Emits rp:gangJoinRequests (full list) to all online leaders of that faction.
 *   - Toasts the requester.
 *
 * Security: server validates everything; client position is never trusted.
 * No persistent state change until a leader accepts.
 */
export async function handleGangJoinRequest(
  socket:     Socket,
  ctx:        LicenseContext,
  rawPayload: unknown,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── P1: Server-side proximity check — client nearHangout is UX only ──────
  const playerState = ctx.players.get(socket.id);
  if (!playerState) {
    socket.emit("rp:toast", { msg: "Player state not found. Try again.", color: "red", duration: 3000 });
    return;
  }
  {
    const dx = playerState.x - GROVE_STREET_HANGOUT_POS[0];
    const dz = playerState.z - GROVE_STREET_HANGOUT_POS[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > GROVE_STREET_HANGOUT_RADIUS) {
      socket.emit("rp:toast", { msg: "You must be at the Grove Street hangout to request membership.", color: "red", duration: 3000 });
      return;
    }
  }

  // ── Reject if jailed ──────────────────────────────────────────────────────
  if (entry.jailUntil !== null && entry.jailUntil.getTime() > Date.now()) {
    socket.emit("rp:toast", { msg: "You cannot send a join request while in jail.", color: "red", duration: 3000 });
    return;
  }
  // ── Reject if cuffed ──────────────────────────────────────────────────────
  if (entry.cuffedBy !== null) {
    socket.emit("rp:toast", { msg: "You cannot send a join request while restrained.", color: "red", duration: 3000 });
    return;
  }
  // ── P1: Reject if player has ANY faction (not just gang) ─────────────────
  if (entry.factionId !== null) {
    socket.emit("rp:toast", { msg: "You are already in a faction.", color: "yellow", duration: 3000 });
    return;
  }
  // ── P2: Prune own expired request before duplicate check ─────────────────
  // Without this, a player whose 60s TTL elapsed would be blocked from sending
  // a new request until an unrelated gang event triggered broadcastPendingRequests.
  {
    const existing = pendingGangRequests.get(socket.id);
    if (existing && Date.now() - existing.ts > GANG_REQUEST_TTL_MS) {
      pendingGangRequests.delete(socket.id);
      // Reset client state so the join button reappears.
      socket.emit("rp:gangJoinRequestSent", null);
      logger.debug({ socketId: socket.id }, "[rpGang] requester's own pending request expired — cleared for retry");
    }
  }

  // ── Reject duplicate pending request ──────────────────────────────────────
  if (pendingGangRequests.has(socket.id)) {
    socket.emit("rp:toast", { msg: "You already have a pending join request.", color: "yellow", duration: 3000 });
    return;
  }

  // ── Parse + validate faction slug ─────────────────────────────────────────
  const payload     = rawPayload as Record<string, unknown> | null | undefined;
  const factionSlug = typeof payload?.factionSlug === "string" ? payload.factionSlug.trim() : "";
  if (!factionSlug) {
    socket.emit("rp:toast", { msg: "Invalid join request.", color: "red", duration: 3000 });
    return;
  }

  // DB lookup — confirm it's a real gang faction.
  const [factionRow] = await db
    .select()
    .from(rpFactions)
    .where(eq(rpFactions.slug, factionSlug));

  if (!factionRow) {
    socket.emit("rp:toast", { msg: "Unknown faction.", color: "red", duration: 3000 });
    return;
  }
  if (factionRow.type !== "gang") {
    socket.emit("rp:toast", { msg: "That faction does not accept open applications.", color: "yellow", duration: 3000 });
    return;
  }
  // ── P2: Grove Street is the only gang with a mapped hangout/turf ──────────
  if (factionRow.slug !== "grove_street") {
    socket.emit("rp:toast", { msg: "That gang is not currently recruiting via this channel.", color: "yellow", duration: 3000 });
    return;
  }

  // ── Store request ─────────────────────────────────────────────────────────
  const username = playerState.username ?? socket.id;
  pendingGangRequests.set(socket.id, {
    socketId:    socket.id,
    username,
    factionSlug: factionRow.slug,
    factionId:   factionRow.id,
    ts:          Date.now(),
  });

  logger.debug({ socketId: socket.id, factionSlug }, "[rpGang] join request received");

  // ── Notify requester ──────────────────────────────────────────────────────
  socket.emit("rp:toast", {
    msg:      `Join request sent to ${factionRow.name}. A leader will review it.`,
    color:    "green",
    duration: 5000,
  });
  socket.emit("rp:gangJoinRequestSent", { factionSlug: factionRow.slug, factionName: factionRow.name });

  // ── Notify leaders ────────────────────────────────────────────────────────
  broadcastPendingRequests(ctx, factionRow.id);
}

/**
 * Phase 7E: A gang leader accepts or rejects a pending join request.
 *
 * Client emits: rp:gangJoinResponse { targetSocketId: string, accept: boolean }
 *
 * Server validates:
 *   - Caller is a gang member with rank >= GANG_LEADER_MIN_RANK.
 *   - targetSocketId has a pending request for the SAME faction.
 *   - Target player is still online.
 *
 * On accept:
 *   - Calls setPlayerFaction (DB write) for rank 0.
 *   - Updates rpCache for the target.
 *   - Emits rp:profileUpdate to target and rp:gangJoinResult to target.
 *   - Broadcasts updated pending list to leaders.
 *
 * On reject:
 *   - Removes request from pending store.
 *   - Emits rp:gangJoinResult (accepted: false) to target.
 *   - Broadcasts updated pending list to leaders.
 *
 * Security: server validates membership + rank; client authority is never trusted.
 */
export async function handleGangJoinResponse(
  socket:     Socket,
  ctx:        LicenseContext,
  rawPayload: unknown,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Caller must be a gang leader ──────────────────────────────────────────
  if (!isGang(entry)) {
    socket.emit("rp:toast", { msg: "You are not in a gang.", color: "red", duration: 3000 });
    return;
  }
  if (!isFactionRankAtLeast(entry, GANG_LEADER_MIN_RANK)) {
    socket.emit("rp:toast", { msg: "Only gang leaders can respond to join requests.", color: "red", duration: 3000 });
    return;
  }
  // ── P1: Reject if leader is jailed or cuffed ─────────────────────────────
  if (entry.jailUntil !== null && entry.jailUntil.getTime() > Date.now()) {
    socket.emit("rp:toast", { msg: "You cannot respond to join requests while in jail.", color: "red", duration: 3000 });
    return;
  }
  if (entry.cuffedBy !== null) {
    socket.emit("rp:toast", { msg: "You cannot respond to join requests while restrained.", color: "red", duration: 3000 });
    return;
  }

  // ── P2: Prune expired requests before any processing ─────────────────────
  if (entry.factionId) pruneExpiredGangRequests(entry.factionId);

  // ── Parse payload ─────────────────────────────────────────────────────────
  const payload        = rawPayload as Record<string, unknown> | null | undefined;
  const targetSocketId = typeof payload?.targetSocketId === "string" ? payload.targetSocketId : "";
  const accept         = payload?.accept === true;

  if (!targetSocketId) {
    socket.emit("rp:toast", { msg: "Invalid response payload.", color: "red", duration: 3000 });
    return;
  }

  // ── Validate pending request ──────────────────────────────────────────────
  const request = pendingGangRequests.get(targetSocketId);
  if (!request) {
    socket.emit("rp:toast", { msg: "No pending request from that player.", color: "yellow", duration: 3000 });
    return;
  }
  if (request.factionId !== entry.factionId) {
    socket.emit("rp:toast", { msg: "That request is not for your faction.", color: "red", duration: 3000 });
    return;
  }

  // ── Reject path — delete before broadcast is fine here ───────────────────
  if (!accept) {
    pendingGangRequests.delete(targetSocketId);
    ctx.io.to(targetSocketId).emit("rp:gangJoinResult", {
      accepted:    false,
      factionSlug: request.factionSlug,
    });
    ctx.io.to(targetSocketId).emit("rp:toast", {
      msg:      `Your request to join ${request.factionSlug} was declined.`,
      color:    "yellow",
      duration: 5000,
    });
    socket.emit("rp:toast", { msg: `Declined ${request.username}'s request.`, color: "yellow", duration: 3000 });
    broadcastPendingRequests(ctx, entry.factionId!);
    logger.debug({ leader: socket.id, target: targetSocketId }, "[rpGang] join request rejected");
    return;
  }

  // ── Accept path: re-validate target is still online + eligible ───────────
  const targetEntry = ctx.rpCache.get(targetSocketId);
  if (!targetEntry) {
    socket.emit("rp:toast", { msg: "Player disconnected before you could accept.", color: "yellow", duration: 4000 });
    pendingGangRequests.delete(targetSocketId);
    broadcastPendingRequests(ctx, entry.factionId!);
    return;
  }
  // ── P1: Reject if target has any faction (not just gang) ─────────────────
  if (targetEntry.factionId !== null) {
    socket.emit("rp:toast", { msg: "That player already belongs to a faction.", color: "yellow", duration: 3000 });
    pendingGangRequests.delete(targetSocketId);
    broadcastPendingRequests(ctx, entry.factionId!);
    return;
  }
  // ── P1: Reject if target is currently jailed or cuffed ───────────────────
  if (targetEntry.jailUntil !== null && targetEntry.jailUntil.getTime() > Date.now()) {
    socket.emit("rp:toast", { msg: "That player is currently in jail.", color: "yellow", duration: 3000 });
    pendingGangRequests.delete(targetSocketId);
    broadcastPendingRequests(ctx, entry.factionId!);
    return;
  }
  if (targetEntry.cuffedBy !== null) {
    socket.emit("rp:toast", { msg: "That player is currently restrained.", color: "yellow", duration: 3000 });
    pendingGangRequests.delete(targetSocketId);
    broadcastPendingRequests(ctx, entry.factionId!);
    return;
  }

  // ── P1: DB write first — delete pending only after success ───────────────
  let faction: FactionRow;
  try {
    faction = await setPlayerFaction(targetEntry.playerId, request.factionSlug, 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    socket.emit("rp:toast", { msg, color: "red", duration: 4000 });
    // Keep request alive so the leader can retry — do NOT delete.
    broadcastPendingRequests(ctx, entry.factionId!);
    return;
  }

  // ── DB succeeded — now remove from pending store ──────────────────────────
  pendingGangRequests.delete(targetSocketId);

  // ── Update in-memory cache for target ────────────────────────────────────
  targetEntry.factionId    = faction.id;
  targetEntry.factionSlug  = faction.slug;
  targetEntry.factionName  = faction.name;
  targetEntry.factionType  = faction.type;
  targetEntry.factionColor = faction.color;
  targetEntry.factionRank  = 0;

  // ── Notify target ─────────────────────────────────────────────────────────
  ctx.io.to(targetSocketId).emit("rp:profileUpdate", {
    factionId:    faction.id,
    factionSlug:  faction.slug,
    factionName:  faction.name,
    factionType:  faction.type,
    factionColor: faction.color,
    factionRank:  0,
  });
  ctx.io.to(targetSocketId).emit("rp:gangJoinResult", {
    accepted:     true,
    factionSlug:  faction.slug,
    factionName:  faction.name,
    factionColor: faction.color,
  });
  ctx.io.to(targetSocketId).emit("rp:toast", {
    msg:      `Welcome to ${faction.name}! You are now an Associate.`,
    color:    "green",
    duration: 6000,
  });

  // ── Notify leader ─────────────────────────────────────────────────────────
  socket.emit("rp:toast", {
    msg:      `${request.username} has been welcomed into ${faction.name}.`,
    color:    "green",
    duration: 4000,
  });

  broadcastPendingRequests(ctx, faction.id);
  logger.debug({ leader: socket.id, target: targetSocketId, faction: faction.slug }, "[rpGang] join request accepted");
}

/**
 * Phase 7E: Remove a pending gang join request when the requester disconnects.
 * Called from gameServer.ts disconnect handler (centralised teardown).
 * Also updates online leaders so their pending list stays accurate.
 */
export function cleanupPendingGangRequest(socketId: string, ctx: LicenseContext): void {
  const request = pendingGangRequests.get(socketId);
  if (!request) return;
  pendingGangRequests.delete(socketId);
  broadcastPendingRequests(ctx, request.factionId);
  logger.debug({ socketId, factionSlug: request.factionSlug }, "[rpGang] pending join request cleaned up on disconnect");
}

// ── Phase 7F: Gang Roster Management ─────────────────────────────────────────

/** Maps a numeric rank to a human-readable label (matches client GangHUD). */
function gangRankLabel(rank: number): string {
  if (rank >= 8) return "OG";
  if (rank >= 6) return "Shot Caller";
  if (rank >= 4) return "Lieutenant";
  if (rank >= 2) return "Soldier";
  return "Associate";
}

/** Max rank a leader may assign to a subordinate (leader threshold - 1). */
const MAX_ASSIGNABLE_RANK = GANG_LEADER_MIN_RANK - 1; // 3

/**
 * Fetches all members of a faction from DB and annotates each with online status.
 * Intentionally omits token, cash, bank, position, and socket IDs.
 */
async function fetchGangRoster(
  ctx:       LicenseContext,
  factionId: string,
): Promise<Array<{ playerId: string; username: string; factionRank: number; rankLabel: string; isOnline: boolean }>> {
  const rows = await db
    .select({ id: rpPlayers.id, username: rpPlayers.username, factionRank: rpPlayers.factionRank })
    .from(rpPlayers)
    .where(eq(rpPlayers.factionId, factionId));

  // Build a Set of currently-online playerIds in O(n) from rpCache.
  const onlineIds = new Set(Array.from(ctx.rpCache.values()).map((e) => e.playerId));

  return rows.map((r) => ({
    playerId:    r.id,
    username:    r.username,
    factionRank: r.factionRank,
    rankLabel:   gangRankLabel(r.factionRank),
    isOnline:    onlineIds.has(r.id),
  }));
}

/**
 * Phase 7F: Return the gang roster to the requesting member.
 *
 * Client emits: rp:gangRoster (no payload)
 *
 * Server validates:
 *   - Caller is a gang member.
 *
 * Safe fields only: playerId (DB UUID), username, factionRank, rankLabel, isOnline.
 * No token, cash, bank, position, or socket IDs.
 */
export async function handleGangRoster(
  socket: Socket,
  ctx:    LicenseContext,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  if (!isGang(entry) || !entry.factionId) {
    socket.emit("rp:toast", { msg: "You are not in a gang.", color: "red", duration: 3000 });
    return;
  }

  const roster = await fetchGangRoster(ctx, entry.factionId);
  socket.emit("rp:gangRoster", roster);
}

/**
 * Phase 7F: Gang leader promotes or demotes a member.
 *
 * Client emits: rp:gangSetRank { targetPlayerId: string, rank: number }
 *
 * Server validates:
 *   - Caller is a gang leader (rank >= GANG_LEADER_MIN_RANK), not jailed/cuffed.
 *   - Target exists in DB, is in the same faction, has lower rank than the caller.
 *   - New rank is clamped to [0, MAX_ASSIGNABLE_RANK] (0–3).
 *   - Caller cannot change their own rank.
 *
 * On success: DB write → cache update → rp:profileUpdate to target (if online)
 *   → rp:gangRoster to caller.
 *
 * Security: all checks are server-side; client UI is UX only.
 */
export async function handleGangSetRank(
  socket:     Socket,
  ctx:        LicenseContext,
  rawPayload: unknown,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Leader auth ───────────────────────────────────────────────────────────
  if (!isGang(entry)) {
    socket.emit("rp:toast", { msg: "You are not in a gang.", color: "red", duration: 3000 });
    return;
  }
  if (!isFactionRankAtLeast(entry, GANG_LEADER_MIN_RANK)) {
    socket.emit("rp:toast", { msg: "Only gang leaders can manage ranks.", color: "red", duration: 3000 });
    return;
  }
  if (entry.jailUntil !== null && entry.jailUntil.getTime() > Date.now()) {
    socket.emit("rp:toast", { msg: "You cannot manage ranks while in jail.", color: "red", duration: 3000 });
    return;
  }
  if (entry.cuffedBy !== null) {
    socket.emit("rp:toast", { msg: "You cannot manage ranks while restrained.", color: "red", duration: 3000 });
    return;
  }

  // ── Parse payload ─────────────────────────────────────────────────────────
  const payload        = rawPayload as Record<string, unknown> | null | undefined;
  const targetPlayerId = typeof payload?.targetPlayerId === "string" ? payload.targetPlayerId.trim() : "";
  const rankRaw        = typeof payload?.rank === "number" ? payload.rank : -1;

  if (!targetPlayerId) {
    socket.emit("rp:toast", { msg: "Invalid payload.", color: "red", duration: 3000 });
    return;
  }

  // Clamp + validate rank
  const newRank = Math.max(0, Math.min(MAX_ASSIGNABLE_RANK, Math.floor(rankRaw)));
  if (rankRaw < 0 || rankRaw > MAX_ASSIGNABLE_RANK || !Number.isFinite(rankRaw)) {
    socket.emit("rp:toast", { msg: `Rank must be 0–${MAX_ASSIGNABLE_RANK}.`, color: "red", duration: 3000 });
    return;
  }

  // ── Cannot manage self ────────────────────────────────────────────────────
  if (targetPlayerId === entry.playerId) {
    socket.emit("rp:toast", { msg: "You cannot change your own rank.", color: "red", duration: 3000 });
    return;
  }

  // ── DB lookup: confirm target exists and is in same faction ───────────────
  const [targetRow] = await db
    .select({ id: rpPlayers.id, username: rpPlayers.username, factionId: rpPlayers.factionId, factionRank: rpPlayers.factionRank })
    .from(rpPlayers)
    .where(eq(rpPlayers.id, targetPlayerId));

  if (!targetRow) {
    socket.emit("rp:toast", { msg: "Player not found.", color: "red", duration: 3000 });
    return;
  }
  if (targetRow.factionId !== entry.factionId) {
    socket.emit("rp:toast", { msg: "That player is not in your faction.", color: "red", duration: 3000 });
    return;
  }
  // ── Cannot manage equal or higher rank ────────────────────────────────────
  if (targetRow.factionRank >= entry.factionRank) {
    socket.emit("rp:toast", { msg: "You cannot manage members of equal or higher rank.", color: "red", duration: 3000 });
    return;
  }

  // ── DB write — safe WHERE includes factionId to guard against race ────────
  // .returning() lets us detect whether the guarded WHERE matched any row.
  const updated = await db
    .update(rpPlayers)
    .set({ factionRank: newRank })
    .where(and(
      eq(rpPlayers.id, targetPlayerId),
      eq(rpPlayers.factionId, entry.factionId!),
    ))
    .returning({ id: rpPlayers.id });

  // ── P1: If 0 rows updated, the target left the faction between SELECT and UPDATE.
  // Do NOT mutate cache. Notify the leader and push a fresh roster.
  if (updated.length !== 1) {
    socket.emit("rp:toast", { msg: "Member changed; refresh roster.", color: "yellow", duration: 4000 });
    const roster = await fetchGangRoster(ctx, entry.factionId!);
    socket.emit("rp:gangRoster", roster);
    logger.debug({ leader: socket.id, target: targetPlayerId }, "[rpGang] gangSetRank: guarded UPDATE matched 0 rows — skipping cache mutation");
    return;
  }

  // ── Cache + live notification if target is online ─────────────────────────
  for (const [sid, cacheEntry] of ctx.rpCache.entries()) {
    // P1: also guard factionId so a race-replaced cache entry is never mutated.
    if (cacheEntry.playerId === targetPlayerId && cacheEntry.factionId === entry.factionId) {
      cacheEntry.factionRank = newRank;
      ctx.io.to(sid).emit("rp:profileUpdate", {
        factionId:    cacheEntry.factionId,
        factionSlug:  cacheEntry.factionSlug,
        factionName:  cacheEntry.factionName,
        factionType:  cacheEntry.factionType,
        factionColor: cacheEntry.factionColor,
        factionRank:  newRank,
      });
      // P2: also push updated gangStatus so GangHUD stays consistent if open.
      {
        let memberCountOnline = 0;
        for (const ce of ctx.rpCache.values()) {
          if (ce.factionId === cacheEntry.factionId) memberCountOnline++;
        }
        const isGroveStreetTarget = cacheEntry.factionSlug === "grove_street";
        ctx.io.to(sid).emit("rp:gangStatus", {
          isMember:         true,
          isGroveStreet:    isGroveStreetTarget,
          factionSlug:      cacheEntry.factionSlug,
          factionName:      cacheEntry.factionName,
          factionColor:     cacheEntry.factionColor,
          factionRank:      newRank,
          turfName:         isGroveStreetTarget ? "Grove Street" : null,
          memberCountOnline,
          hangoutPos:    GROVE_STREET_HANGOUT_POS,
          hangoutRadius: GROVE_STREET_HANGOUT_RADIUS,
          turfCenter:    GROVE_STREET_TURF_CENTER,
          turfRadius:    GROVE_STREET_TURF_RADIUS,
        });
      }
      break;
    }
  }

  const direction = newRank > targetRow.factionRank ? "promoted" : "demoted";
  socket.emit("rp:toast", {
    msg:      `${targetRow.username} ${direction} to ${gangRankLabel(newRank)} (rank ${newRank}).`,
    color:    "green",
    duration: 4000,
  });
  logger.debug({ leader: socket.id, target: targetPlayerId, newRank }, "[rpGang] rank updated");

  // ── Push refreshed roster to the leader ───────────────────────────────────
  const roster = await fetchGangRoster(ctx, entry.factionId!);
  socket.emit("rp:gangRoster", roster);
}

/**
 * Phase 7F: Gang leader removes a member from the faction.
 *
 * Client emits: rp:gangRemoveMember { targetPlayerId: string }
 *
 * Server validates:
 *   - Caller is a gang leader (rank >= GANG_LEADER_MIN_RANK), not jailed/cuffed.
 *   - Target exists in DB, is in the same faction, has lower rank than the caller.
 *   - Cannot remove self.
 *
 * On success: DB clear → cache wipe (if online) → rp:profileUpdate to target
 *   → rp:gangRoster to caller.
 *
 * DB write uses AND (id, faction_id) so a race where the target already left
 * never accidentally clears a different faction assignment.
 */
export async function handleGangRemoveMember(
  socket:     Socket,
  ctx:        LicenseContext,
  rawPayload: unknown,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Leader auth ───────────────────────────────────────────────────────────
  if (!isGang(entry)) {
    socket.emit("rp:toast", { msg: "You are not in a gang.", color: "red", duration: 3000 });
    return;
  }
  if (!isFactionRankAtLeast(entry, GANG_LEADER_MIN_RANK)) {
    socket.emit("rp:toast", { msg: "Only gang leaders can remove members.", color: "red", duration: 3000 });
    return;
  }
  if (entry.jailUntil !== null && entry.jailUntil.getTime() > Date.now()) {
    socket.emit("rp:toast", { msg: "You cannot manage members while in jail.", color: "red", duration: 3000 });
    return;
  }
  if (entry.cuffedBy !== null) {
    socket.emit("rp:toast", { msg: "You cannot manage members while restrained.", color: "red", duration: 3000 });
    return;
  }

  // ── Parse payload ─────────────────────────────────────────────────────────
  const payload        = rawPayload as Record<string, unknown> | null | undefined;
  const targetPlayerId = typeof payload?.targetPlayerId === "string" ? payload.targetPlayerId.trim() : "";

  if (!targetPlayerId) {
    socket.emit("rp:toast", { msg: "Invalid payload.", color: "red", duration: 3000 });
    return;
  }

  // ── Cannot remove self ────────────────────────────────────────────────────
  if (targetPlayerId === entry.playerId) {
    socket.emit("rp:toast", { msg: "You cannot remove yourself from the gang.", color: "red", duration: 3000 });
    return;
  }

  // ── DB lookup: confirm target exists and is in same faction ───────────────
  const [targetRow] = await db
    .select({ id: rpPlayers.id, username: rpPlayers.username, factionId: rpPlayers.factionId, factionRank: rpPlayers.factionRank })
    .from(rpPlayers)
    .where(eq(rpPlayers.id, targetPlayerId));

  if (!targetRow) {
    socket.emit("rp:toast", { msg: "Player not found.", color: "red", duration: 3000 });
    return;
  }
  if (targetRow.factionId !== entry.factionId) {
    socket.emit("rp:toast", { msg: "That player is not in your faction.", color: "red", duration: 3000 });
    return;
  }
  // ── Cannot remove equal or higher rank ────────────────────────────────────
  if (targetRow.factionRank >= entry.factionRank) {
    socket.emit("rp:toast", { msg: "You cannot remove members of equal or higher rank.", color: "red", duration: 3000 });
    return;
  }

  // ── DB-first: clear faction with AND guard so a race never over-clears ────
  // .returning() lets us detect whether the guarded WHERE matched any row.
  const updated = await db
    .update(rpPlayers)
    .set({ factionId: null, factionRank: 0 })
    .where(and(
      eq(rpPlayers.id, targetPlayerId),
      eq(rpPlayers.factionId, entry.factionId!),
    ))
    .returning({ id: rpPlayers.id });

  // ── P1: If 0 rows updated, the target already left the faction. Skip cache mutation.
  if (updated.length !== 1) {
    socket.emit("rp:toast", { msg: "Member changed; refresh roster.", color: "yellow", duration: 4000 });
    const roster = await fetchGangRoster(ctx, entry.factionId!);
    socket.emit("rp:gangRoster", roster);
    logger.debug({ leader: socket.id, target: targetPlayerId }, "[rpGang] gangRemoveMember: guarded UPDATE matched 0 rows — skipping cache mutation");
    return;
  }

  // ── Cache wipe + live notification if target is online ────────────────────
  for (const [sid, cacheEntry] of ctx.rpCache.entries()) {
    // P1: also guard factionId to avoid wiping a cache entry that already changed.
    if (cacheEntry.playerId === targetPlayerId && cacheEntry.factionId === entry.factionId) {
      cacheEntry.factionId    = null;
      cacheEntry.factionSlug  = null;
      cacheEntry.factionName  = null;
      cacheEntry.factionType  = null;
      cacheEntry.factionColor = null;
      cacheEntry.factionRank  = 0;
      ctx.io.to(sid).emit("rp:profileUpdate", {
        factionId:    null,
        factionSlug:  null,
        factionName:  null,
        factionType:  null,
        factionColor: null,
        factionRank:  0,
      });
      // P2: push updated gangStatus so GangHUD immediately reflects removal.
      ctx.io.to(sid).emit("rp:gangStatus", {
        isMember:         false,
        isGroveStreet:    false,
        factionSlug:      null,
        factionName:      null,
        factionColor:     null,
        factionRank:      0,
        turfName:         null,
        memberCountOnline: 0,
        hangoutPos:    GROVE_STREET_HANGOUT_POS,
        hangoutRadius: GROVE_STREET_HANGOUT_RADIUS,
        turfCenter:    GROVE_STREET_TURF_CENTER,
        turfRadius:    GROVE_STREET_TURF_RADIUS,
      });
      ctx.io.to(sid).emit("rp:toast", {
        msg:      "You have been removed from the gang.",
        color:    "yellow",
        duration: 5000,
      });
      break;
    }
  }

  socket.emit("rp:toast", {
    msg:      `${targetRow.username} has been removed from the gang.`,
    color:    "yellow",
    duration: 4000,
  });
  logger.debug({ leader: socket.id, target: targetPlayerId }, "[rpGang] member removed");

  // ── Push refreshed roster to the leader ───────────────────────────────────
  const roster = await fetchGangRoster(ctx, entry.factionId!);
  socket.emit("rp:gangRoster", roster);
}
