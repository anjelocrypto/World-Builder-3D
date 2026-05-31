// =============================================================
// Guest-mode gating (Batch A) — server-authoritative.
// -------------------------------------------------------------
// Guests may explore the world (movement is handled in gameServer) but get
// NO RP systems: no token, no DB row, no rpCache, and — enforced here — none
// of the rp:*/voice:* handlers are even registered for them (see
// setupRpHandlers, which early-returns for guests). This module is the single
// source of truth for "is this socket a guest" + a reusable guard for any
// handler that is ever registered outside that gate.
// =============================================================

import type { Socket } from "socket.io";

/** socket.id of every guest session. Cleared on disconnect. */
const guests = new Set<string>();

export function setGuestSocket(socketId: string, isGuest: boolean): void {
  if (isGuest) guests.add(socketId);
  else guests.delete(socketId);
}

export function isGuestSocket(socketId: string): boolean {
  return guests.has(socketId);
}

export function clearGuestSocket(socketId: string): void {
  guests.delete(socketId);
}

/**
 * Shared guard for RP/gameplay handlers. Returns true if the socket may perform
 * authenticated RP actions; for guests it emits a clear toast and returns false.
 * Primary enforcement is non-registration (setupRpHandlers skips guests), so
 * this is defence-in-depth for any handler attached elsewhere.
 */
export function requireAuthenticatedRp(socket: Socket): boolean {
  if (guests.has(socket.id)) {
    socket.emit("rp:toast", {
      msg: "Sign in or connect a wallet to use that.",
      color: "yellow",
      duration: 3000,
    });
    return false;
  }
  return true;
}
