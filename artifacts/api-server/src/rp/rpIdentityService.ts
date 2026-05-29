/**
 * Phase 11B: RP identity sharing — show your ID to a nearby player, and police
 * inspection of a nearby player's ID.
 *
 * Security model (all server-authoritative):
 *   - Every ID field is derived from rpCache / ctx.players on the server. The
 *     client only sends a target socket id, which the server re-validates.
 *     Forged identity fields from the client are never trusted.
 *   - Range gate: sender and target must be within ID_SHARE_RADIUS (4 m), using
 *     authoritative positions from ctx.players.
 *   - Rate limit: ID_SHARE_COOLDOWN_MS per sender (keyed by DB playerId).
 *   - Payloads never include cash, bank, playerId (UUID), socket ids, or coords.
 *   - Public show: card delivered ONLY to the validated target's socket.
 *   - Police inspect: requires a valid on-duty officer; card (with legal status)
 *     delivered ONLY to the requesting officer's socket.
 */

import type { Socket } from "socket.io";
import type { LicenseContext } from "./rpLicenseService";
import type { RpCacheEntry } from "./rpCache";
import { isPolice } from "./rpFactionHelpers";
import { ID_SHARE_RADIUS, ID_SHARE_COOLDOWN_MS } from "../socket/cityData";
import { logger } from "../lib/logger";

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Per-sender ID-share cooldown, keyed by DB playerId. In-memory only. */
const idShareCooldown = new Map<string, number>();

/** Same on-duty-officer gate the police actions use (police, patrol, not jailed/cuffed). */
function isOfficerValid(entry: RpCacheEntry): boolean {
  return (
    isPolice(entry) &&
    entry.currentJob === "police_patrol" &&
    entry.onDuty &&
    entry.jailUntil === null &&
    entry.cuffedBy === null
  );
}

/** Build the public (voluntary-show) ID card from authoritative state. No financials/ids. */
function buildPublicCard(targetEntry: RpCacheEntry, targetName: string) {
  return {
    name:          targetName,
    driverLicense: targetEntry.driverLicense,
    weaponLicense: targetEntry.weaponLicense,
    factionName:   targetEntry.factionName,
    factionType:   targetEntry.factionType,
    factionRank:   targetEntry.factionName ? targetEntry.factionRank : null,
    factionColor:  targetEntry.factionColor,
    policeView:    false,
  };
}

/** Police view = public card + legal status (wanted / jailed / cuffed). Still no financials/ids. */
function buildPoliceCard(targetEntry: RpCacheEntry, targetName: string) {
  return {
    ...buildPublicCard(targetEntry, targetName),
    policeView:  true,
    wantedStars: targetEntry.wantedStars,
    jailed:      targetEntry.jailUntil !== null && targetEntry.jailUntil > new Date(),
    cuffed:      targetEntry.cuffedBy !== null,
  };
}

/** Shared: validate sender, target, self, range, cooldown. Returns target entry+name or null (and toasts). */
function validateShare(
  socket: Socket,
  ctx:    LicenseContext,
  targetSocketId: unknown,
): { targetEntry: RpCacheEntry; targetName: string } | null {
  const senderEntry = ctx.rpCache.get(socket.id);
  const senderPos   = ctx.players.get(socket.id);
  if (!senderEntry || !senderPos) return null;

  if (typeof targetSocketId !== "string" || !targetSocketId) {
    socket.emit("rp:toast", { msg: "No one nearby to show your ID to.", color: "yellow", duration: 2500 });
    return null;
  }
  if (targetSocketId === socket.id) {
    socket.emit("rp:toast", { msg: "You can't show your ID to yourself.", color: "yellow", duration: 2500 });
    return null;
  }

  // Rate limit (keyed by DB playerId so reconnects don't reset it within window).
  const now  = Date.now();
  const last = idShareCooldown.get(senderEntry.playerId) ?? 0;
  if (now - last < ID_SHARE_COOLDOWN_MS) {
    socket.emit("rp:toast", { msg: "Slow down.", color: "yellow", duration: 1500 });
    return null;
  }

  const targetEntry = ctx.rpCache.get(targetSocketId);
  const targetPos   = ctx.players.get(targetSocketId);
  if (!targetEntry || !targetPos) {
    socket.emit("rp:toast", { msg: "That player is no longer nearby.", color: "yellow", duration: 2500 });
    return null;
  }

  const distance = dist2d(senderPos.x, senderPos.z, targetPos.x, targetPos.z);
  if (distance > ID_SHARE_RADIUS) {
    socket.emit("rp:toast", { msg: `Move within ${ID_SHARE_RADIUS} m.`, color: "yellow", duration: 2500 });
    return null;
  }

  idShareCooldown.set(senderEntry.playerId, now);
  return { targetEntry, targetName: targetPos.username };
}

/**
 * rp:showID — the sender voluntarily shows their OWN public ID to a nearby player.
 * The card describes the SENDER; it is delivered to the TARGET's socket.
 */
export function handleShowID(socket: Socket, ctx: LicenseContext, targetSocketId: unknown): void {
  const senderEntry = ctx.rpCache.get(socket.id);
  const senderPos   = ctx.players.get(socket.id);
  if (!senderEntry || !senderPos) return;

  const v = validateShare(socket, ctx, targetSocketId);
  if (!v) return;

  // Card describes the SENDER (their own ID), sent to the target's socket.
  const card = buildPublicCard(senderEntry, senderPos.username);
  ctx.io.to(targetSocketId as string).emit("rp:idShown", card);
  socket.emit("rp:toast", { msg: `Showed your ID to ${v.targetName}.`, color: "green", duration: 2500 });
}

/**
 * rp:policeInspectID — an on-duty officer inspects a nearby player's ID.
 * The card describes the TARGET (incl. legal status); delivered to the OFFICER.
 */
export function handlePoliceInspectID(socket: Socket, ctx: LicenseContext, targetSocketId: unknown): void {
  const officerEntry = ctx.rpCache.get(socket.id);
  const officerPos   = ctx.players.get(socket.id);
  if (!officerEntry || !officerPos) return;

  if (!isOfficerValid(officerEntry)) {
    socket.emit("rp:toast", { msg: "You must be an on-duty Police Officer to inspect IDs.", color: "yellow", duration: 3000 });
    return;
  }

  const v = validateShare(socket, ctx, targetSocketId);
  if (!v) return;

  const card = buildPoliceCard(v.targetEntry, v.targetName);
  socket.emit("rp:idInspected", card);
  // Courtesy notice to the inspected player (no data, just awareness).
  ctx.io.to(targetSocketId as string).emit("rp:toast", {
    msg: "An officer inspected your ID.", color: "yellow", duration: 2500,
  });
  // Phase 11B: no socket ids in logs — log a generic event only.
  logger.info("[rp] police inspected a nearby ID");
}

/** Clear a disconnecting player's cooldown entry. */
export function clearIdShareForPlayer(playerId: string): void {
  idShareCooldown.delete(playerId);
}
