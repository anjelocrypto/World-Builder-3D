// =============================================================
// Wallet LOGIN auth (Batch B) — server-authoritative account identity.
// -------------------------------------------------------------
// A pre-join handshake that proves wallet OWNERSHIP (signature only — NOT
// $NEMOCLAW; that stays separate in rpNemoGangService/rpSolanaService). On
// success the socket is recorded as having verified a specific address; the
// gameServer join handler then accepts a "wallet:<address>" token ONLY for the
// socket that actually proved that address, so the wallet becomes the durable
// rp_players identity (no DB migration: wallet address is the token).
//
// The client may ONLY: request a challenge (auth:walletNonce) and submit
// { pubkey, signature } (auth:walletVerify). It never decides identity.
// =============================================================

import type { Socket } from "socket.io";
import { issueNemoNonce, verifyWalletOwnership } from "./rpSolanaService";

/** socket.id → the wallet address it has proven ownership of this session. */
const verified = new Map<string, string>();

/** auth:walletNonce — issue a single-use challenge for the wallet to sign. */
export function handleWalletNonce(socket: Socket): void {
  const res = issueNemoNonce(socket.id);
  if (!res.ok) {
    socket.emit("auth:walletResult", { ok: false, reason: res.reason ?? "Try again shortly." });
    return;
  }
  socket.emit("auth:walletChallenge", { message: res.message });
}

/** auth:walletVerify — verify the signature and record the proven address. */
export function handleWalletVerify(
  socket: Socket,
  data: { pubkey?: unknown; signature?: unknown } | null | undefined,
): void {
  const r = verifyWalletOwnership(socket.id, data?.pubkey, data?.signature);
  if (r.ok && r.address) {
    verified.set(socket.id, r.address);
    socket.emit("auth:walletResult", { ok: true, address: r.address });
  } else {
    socket.emit("auth:walletResult", { ok: false, reason: r.reason });
  }
}

/** True iff THIS socket proved ownership of exactly this address. */
export function isWalletVerified(socketId: string, address: string): boolean {
  return verified.get(socketId) === address;
}

export function clearWalletAuth(socketId: string): void {
  verified.delete(socketId);
}
