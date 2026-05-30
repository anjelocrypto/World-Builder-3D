/**
 * Global text chat — transient, in-memory, server-validated.
 *
 * Privacy/security model:
 *   - The broadcast payload contains ONLY public-safe fields: fromName, msg,
 *     createdAt. It never includes the socket id, DB playerId/UUID, coordinates,
 *     cash/bank, tokens, or any private state.
 *   - Server-side validation: the sender must be a known player; the message is
 *     trimmed, rejected if empty, and capped at GLOBAL_CHAT_MAX_LEN.
 *   - Rate limited per player (in-memory cooldown keyed by DB playerId).
 *   - No DB write. Logs carry no message contents and no socket/player ids.
 */

import type { Socket } from "socket.io";
import type { LicenseContext } from "./rpLicenseService";
import { logger } from "../lib/logger";

export const GLOBAL_CHAT_MAX_LEN = 200;
const GLOBAL_CHAT_COOLDOWN_MS = 1500;

/** Per-player send cooldown, keyed by DB playerId. In-memory only. */
const globalChatCooldown = new Map<string, number>();

/**
 * rp:globalChat — a player sends a global message. Validated + rate-limited,
 * then broadcast to everyone with only public-safe fields.
 */
export function handleGlobalChat(socket: Socket, ctx: LicenseContext, rawMsg: unknown): void {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // Rate limit (keyed by DB playerId so reconnects can't reset it in-window).
  const now = Date.now();
  const last = globalChatCooldown.get(entry.playerId) ?? 0;
  if (now - last < GLOBAL_CHAT_COOLDOWN_MS) {
    socket.emit("rp:toast", { msg: "Slow down.", color: "yellow", duration: 1200 });
    return;
  }

  const msg =
    typeof rawMsg === "string" && rawMsg.trim().length > 0
      ? rawMsg.trim().slice(0, GLOBAL_CHAT_MAX_LEN)
      : "";
  if (!msg) return;

  globalChatCooldown.set(entry.playerId, now);

  const player = ctx.players.get(socket.id);
  // fromName is the public display name only; fall back to a generic label —
  // NEVER the socket id.
  const fromName = (player?.username ?? "Player").slice(0, 20);

  // Public-safe payload only. No ids, coords, or private fields.
  ctx.io.emit("rp:globalChat", { fromName, msg, createdAt: now });

  // No message contents, no socket/player ids in the log.
  logger.debug("[rpGlobal] global chat broadcast");
}

/** Clear a disconnecting player's chat cooldown entry. */
export function clearGlobalChatForPlayer(playerId: string): void {
  globalChatCooldown.delete(playerId);
}
