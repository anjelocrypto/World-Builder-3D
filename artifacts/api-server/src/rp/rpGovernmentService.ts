/**
 * Phase 8A: Government / Mayor service.
 *
 * Handles:
 *   handleCityAnnounce(socket, ctx, data) — rp:cityAnnounce
 *
 * Authority rules (all server-side):
 *   - Requester must be in the government faction (factionType "government"
 *     OR factionSlug "government") with factionRank >= MAYOR_MIN_RANK (4).
 *   - Not jailed.  Not cuffed.
 *   - Server position must be within GOVERNMENT_OFFICE_RADIUS of GOVERNMENT_OFFICE_POS.
 *     A malicious client can emit rp:cityAnnounce from any location; the server
 *     enforces the City Hall proximity requirement independently of the client UI.
 *   - Message must be a non-empty string, trimmed, 1–MAYOR_ANNOUNCE_MAX_CHARS chars.
 *   - Per-mayor cooldown: MAYOR_ANNOUNCE_COOLDOWN_MS (30 s), keyed by DB playerId.
 *     The cooldown is NOT consumed on a proximity / validation failure.
 *
 * Broadcast payload:
 *   rp:cityAnnounce { msg, fromName, createdAt }
 *   — no faction slug, no socketId, no playerId, no coords.
 *
 * The client display name is derived from ctx.players (server-authoritative) so
 * the client can never spoof it.
 *
 * Security constraints (Phase 8A):
 *   - No SQL migration.  No DB writes.  No election / tax-rate system.
 *   - No username-based authority — isMayor() checks factionType + rank from rpCache.
 *   - No admin bypass.  No production shortcut.
 */

import type { Socket } from "socket.io";
import type { LicenseContext } from "./rpLicenseService";
import {
  MAYOR_ANNOUNCE_MAX_CHARS,
  MAYOR_ANNOUNCE_COOLDOWN_MS,
  GOVERNMENT_OFFICE_POS,
  GOVERNMENT_OFFICE_RADIUS,
} from "../socket/cityData";
import { isMayor } from "./rpFactionHelpers";
import { logger } from "../lib/logger";

// ── Per-mayor announcement rate-limit ─────────────────────────────────────────
/**
 * Keyed by DB playerId (stable across reconnects).
 * Value = Unix ms when the last accepted announcement was broadcast.
 */
const announceCooldownMap = new Map<string, number>();

// ── handleCityAnnounce ─────────────────────────────────────────────────────────

/**
 * rp:cityAnnounce — Mayor broadcasts a message to all connected clients.
 *
 * The handler performs ALL authority checks before touching any shared state.
 * The broadcast payload contains only: msg, fromName, createdAt — no faction
 * slug, no socketId, no playerId, no coordinates.
 */
export function handleCityAnnounce(
  socket: Socket,
  ctx:    LicenseContext,
  data:   unknown,
): void {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // ── Guard 1: must be a Mayor (government faction + rank >= 4) ──────────────
  if (!isMayor(entry)) {
    socket.emit("rp:toast", {
      msg:      "Only the Mayor can broadcast city announcements.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 2: not jailed ────────────────────────────────────────────────────
  if (entry.jailUntil && entry.jailUntil > new Date()) {
    socket.emit("rp:toast", {
      msg:      "You cannot do that while jailed.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 3: not cuffed ────────────────────────────────────────────────────
  if (entry.cuffedBy) {
    socket.emit("rp:toast", {
      msg:      "You cannot do that while cuffed.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Guard 4: server-side City Hall proximity ──────────────────────────────
  // A malicious client can emit rp:cityAnnounce from any location.
  // The server derives position from ctx.players (authoritative join state) —
  // the client cannot spoof it.
  const playerState = ctx.players.get(socket.id);
  if (!playerState) return;

  const [gx, , gz] = GOVERNMENT_OFFICE_POS;
  const dx4 = playerState.x - gx;
  const dz4 = playerState.z - gz;
  if (Math.sqrt(dx4 * dx4 + dz4 * dz4) > GOVERNMENT_OFFICE_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "Visit City Hall to broadcast announcements.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // ── Parse + validate message ───────────────────────────────────────────────
  const raw = data as Record<string, unknown> | null | undefined;
  const msg = typeof raw?.msg === "string" ? raw.msg.trim() : "";
  if (msg.length < 1 || msg.length > MAYOR_ANNOUNCE_MAX_CHARS) {
    socket.emit("rp:toast", {
      msg:      `Announcement must be 1–${MAYOR_ANNOUNCE_MAX_CHARS} characters.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Guard 5: per-mayor cooldown ────────────────────────────────────────────
  const cooldownKey  = entry.playerId;
  const lastAnnounce = announceCooldownMap.get(cooldownKey) ?? 0;
  const nowMs        = Date.now();
  const remainingMs  = MAYOR_ANNOUNCE_COOLDOWN_MS - (nowMs - lastAnnounce);
  if (remainingMs > 0) {
    socket.emit("rp:toast", {
      msg:      `Announcement cooldown. Wait ${Math.ceil(remainingMs / 1000)}s.`,
      color:    "yellow",
      duration: 2000,
    });
    return;
  }

  // ── Commit cooldown before broadcast ──────────────────────────────────────
  // Set pessimistically so a partial failure can't reset the throttle.
  announceCooldownMap.set(cooldownKey, nowMs);

  // ── Derive display name from server-authoritative ctx.players ─────────────
  // Never trust client-provided name — use the username from the join event.
  const fromName = ctx.players.get(socket.id)?.username ?? "Mayor";

  const payload = {
    msg,
    fromName,
    createdAt: nowMs,
    // Anti-trust: no faction slug, no socketId, no playerId, no coordinates.
  };

  logger.info(
    { socketId: socket.id, fromName, msgLen: msg.length },
    "[rpGov] city announcement broadcast",
  );

  // Broadcast to every connected client (global announcement).
  ctx.io.emit("rp:cityAnnounce", payload);
}
