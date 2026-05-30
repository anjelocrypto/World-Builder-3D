/**
 * Proximity voice chat — Socket.IO is SIGNALING ONLY; audio is peer-to-peer
 * WebRTC. The server's job is purely:
 *   1. Track who has their mic enabled (in-memory Set, by socket id).
 *   2. Tell each mic-on player which OTHER mic-on players are within
 *      VOICE_RADIUS (so the client can open/close peer connections).
 *   3. Forward offer/answer/ICE between two peers ONLY after re-validating,
 *      with authoritative positions, that they are within VOICE_RADIUS. A
 *      client can never force a peer connection to someone out of range.
 *
 * Privacy/security:
 *   - No DB writes. No SDP, ICE candidates, socket ids, or player ids are ever
 *     logged. Socket ids are used only as internal signaling handles (the same
 *     ids the client already uses to render remote players) and never appear in
 *     a log line or a toast.
 *   - The audio media itself never touches the server (P2P).
 */

import type { Socket } from "socket.io";
import type { LicenseContext } from "./rpLicenseService";
import { logger } from "../lib/logger";

/** Players can hear each other within this radius (m). Mirror: client hook. */
export const VOICE_RADIUS = 18;
const VOICE_RADIUS2 = VOICE_RADIUS * VOICE_RADIUS;
/** Hard cap on peers any one client is told about (matches client cap). */
const MAX_VOICE_PEERS = 6;

/** socket ids with mic currently enabled. In-memory only. */
const micEnabled = new Set<string>();

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** True iff both sockets exist, both have mic on, and they are within range. */
function peersInRange(ctx: LicenseContext, aId: string, bId: string): boolean {
  if (aId === bId) return false;
  if (!micEnabled.has(aId) || !micEnabled.has(bId)) return false;
  const a = ctx.players.get(aId);
  const b = ctx.players.get(bId);
  if (!a || !b) return false;
  return dist2(a.x, a.z, b.x, b.z) <= VOICE_RADIUS2;
}

/** Send each mic-on player its current nearby mic-on peer set (≤ MAX_VOICE_PEERS). */
function pushPeerSets(ctx: LicenseContext): void {
  for (const aId of micEnabled) {
    const aPos = ctx.players.get(aId);
    if (!aPos) continue;
    const near: { id: string; d2: number }[] = [];
    for (const bId of micEnabled) {
      if (bId === aId) continue;
      const bPos = ctx.players.get(bId);
      if (!bPos) continue;
      const d2 = dist2(aPos.x, aPos.z, bPos.x, bPos.z);
      if (d2 <= VOICE_RADIUS2) near.push({ id: bId, d2 });
    }
    near.sort((p, q) => p.d2 - q.d2);
    const peers = near.slice(0, MAX_VOICE_PEERS).map((p) => p.id);
    ctx.io.to(aId).emit("voice:peers", { peers });
  }
}

/** voice:setEnabled — player toggles mic. Recomputes everyone's peer sets. */
export function handleVoiceSetEnabled(socket: Socket, ctx: LicenseContext, rawEnabled: unknown): void {
  const enabled = rawEnabled === true;
  if (enabled) micEnabled.add(socket.id);
  else micEnabled.delete(socket.id);
  pushPeerSets(ctx);
  logger.debug("[rpVoice] mic state changed");
}

/**
 * Forward a signaling message (offer/answer/ice) to `to`, but ONLY if the two
 * peers are currently in range and both mic-on. `payload` carries the opaque
 * SDP/ICE blob, which is forwarded verbatim and never inspected or logged.
 */
function forwardSignal(
  socket: Socket,
  ctx: LicenseContext,
  event: "voice:offer" | "voice:answer" | "voice:ice",
  to: unknown,
  payload: unknown,
): void {
  if (typeof to !== "string" || !to) return;
  if (!peersInRange(ctx, socket.id, to)) return; // authoritative proximity gate
  // `from` lets the recipient key the peer connection; it is the same id the
  // client already has for that remote player. No SDP/ICE is logged.
  ctx.io.to(to).emit(event, { from: socket.id, payload });
}

export function handleVoiceOffer(socket: Socket, ctx: LicenseContext, to: unknown, payload: unknown): void {
  forwardSignal(socket, ctx, "voice:offer", to, payload);
}
export function handleVoiceAnswer(socket: Socket, ctx: LicenseContext, to: unknown, payload: unknown): void {
  forwardSignal(socket, ctx, "voice:answer", to, payload);
}
export function handleVoiceIce(socket: Socket, ctx: LicenseContext, to: unknown, payload: unknown): void {
  forwardSignal(socket, ctx, "voice:ice", to, payload);
}

/**
 * Clear a disconnecting socket from voice + tell its former peers it left so
 * they tear down the connection. Call from the gameServer disconnect block.
 */
export function clearVoiceForSocket(socket: Socket, ctx: LicenseContext): void {
  if (!micEnabled.has(socket.id)) return;
  micEnabled.delete(socket.id);
  // Notify anyone who might still hold a peer connection to this socket.
  ctx.io.emit("voice:left", { id: socket.id });
  pushPeerSets(ctx);
}
