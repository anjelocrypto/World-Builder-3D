// =============================================================
// Admin LOGIN auth — server-authoritative, env-gated, dev/testing only.
// -------------------------------------------------------------
// SECURITY MODEL (mirrors the wallet pre-join handshake in rpWalletAuth.ts):
//   - The client can ONLY request verification with a passcode. It NEVER
//     decides that it is admin. A client claiming `authMode:"admin"` without
//     passing this handshake gets nothing.
//   - Admin is DISABLED by default. It is enabled ONLY when the server env has
//     ADMIN_LOGIN_ENABLED=true AND a non-empty ADMIN_ACCESS_CODE. Missing /
//     empty env → fail closed (every attempt denied).
//   - On success the socket is recorded in `adminSockets` (memory only). The
//     gameServer join handler then accepts an "admin:<username>" token ONLY for
//     the socket that actually proved the passcode this session.
//   - Cleared on disconnect. Never persisted, never sent to other clients.
//   - The passcode is never logged (only an outcome string).
// =============================================================

import type { Socket } from "socket.io";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger";

/** socket.id → the admin username it proved this session (memory only). */
const adminSockets = new Map<string, string>();

/** True only when the server env explicitly enables admin login with a code. */
function adminConfig(): { enabled: boolean; code: string; allowed: Set<string> } {
  const enabled = process.env.ADMIN_LOGIN_ENABLED === "true";
  const code = (process.env.ADMIN_ACCESS_CODE ?? "").trim();
  const allowed = new Set(
    (process.env.ADMIN_ALLOWED_USERNAMES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return { enabled, code, allowed };
}

export function isAdminEnabled(): boolean {
  const { enabled, code } = adminConfig();
  return enabled && code.length > 0; // fail closed if the code is missing
}

/** Constant-time string compare (avoids passcode timing leaks). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * auth:adminVerify { username, passcode } — verify the dev passcode + (optional)
 * username allowlist. Emits auth:adminResult { ok }. NEVER logs the passcode.
 */
export function handleAdminVerify(
  socket: Socket,
  data: { username?: unknown; passcode?: unknown } | null | undefined,
): void {
  const deny = (reason: string, outcome: string): void => {
    adminSockets.delete(socket.id);
    logger.info({ outcome }, "[admin] verify");
    socket.emit("auth:adminResult", { ok: false, reason });
  };

  if (!isAdminEnabled()) {
    deny("Admin login is disabled on this server.", "admin-disabled");
    return;
  }
  const { code, allowed } = adminConfig();
  const username = typeof data?.username === "string" ? data.username.trim().slice(0, 20) : "";
  const passcode = typeof data?.passcode === "string" ? data.passcode : "";
  if (!username || !passcode) {
    deny("Admin access denied.", "admin-denied");
    return;
  }
  // If an allowlist is configured, the username must be on it.
  if (allowed.size > 0 && !allowed.has(username.toLowerCase())) {
    deny("Admin access denied.", "admin-denied");
    return;
  }
  if (!safeEqual(passcode, code)) {
    deny("Admin access denied.", "admin-denied");
    return;
  }
  adminSockets.set(socket.id, username);
  logger.info({ outcome: "admin-verified", username }, "[admin] verify");
  socket.emit("auth:adminResult", { ok: true });
}

/** True iff THIS socket proved admin for exactly this username this session. */
export function isAdminVerified(socketId: string, username: string): boolean {
  return adminSockets.get(socketId) === username;
}

/** True iff THIS socket is an authenticated admin (used for privilege bypasses). */
export function isAdminSocket(socketId: string): boolean {
  return adminSockets.has(socketId);
}

export function clearAdminAuth(socketId: string): void {
  adminSockets.delete(socketId);
}
