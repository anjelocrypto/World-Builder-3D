// =============================================================
// Nemo Gang — Solana wallet ownership + $NEMOCLAW balance verification.
// -------------------------------------------------------------
// SERVER-AUTHORITATIVE. The client may ONLY: (1) request a nonce, and (2) submit
// { pubkey, signature }. Everything that decides eligibility happens here.
//
// Internally staged for audit:
//   C1 — ownership proof: server-issued single-use nonce (TTL, socket-bound) +
//        a server-reconstructed message + ed25519 signature verification.
//   C2 — on-chain check: $NEMOCLAW balance BY MINT ADDRESS, decimals read from
//        the parsed account data (never hardcoded), summed across all token
//        accounts, compared to a >0 / env threshold. Fails CLOSED on any error.
//
// Security invariants: nonce is single-use + expires + bound to socket.id;
// the signed message is reconstructed server-side (client never supplies text);
// signature is verified BEFORE any RPC call; balance is checked by mint only;
// per-socket rate limits on nonce + verify; eligibility is session-only; and we
// NEVER log pubkey / signature / nonce / RPC URL / balance.
// =============================================================

import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import { logger } from "../lib/logger";

// ── Config (env-driven; mint falls back to the known $NEMOCLAW mint) ─────────
const NEMOCLAW_MINT_FALLBACK = "tTJj3mquBmzSYM8VwCxmp1c2AhQCjidQ5DdCdL4pump";
function getMint(): string {
  return (process.env.NEMOCLAW_MINT ?? "").trim() || NEMOCLAW_MINT_FALLBACK;
}
/** Threshold; >0 by default. If NEMOCLAW_MIN_AMOUNT is a positive number, use it. */
function getMinAmount(): number {
  const raw = Number(process.env.NEMOCLAW_MIN_AMOUNT);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}
function getRpcUrl(): string | null {
  const u = (process.env.SOLANA_RPC_URL ?? "").trim();
  return u.length > 0 ? u : null;
}

// ── C1: nonce + rate-limit session state (in-memory, per socket) ─────────────
const NONCE_TTL_MS = 120_000;
const NONCE_COOLDOWN_MS = 3_000;
const VERIFY_COOLDOWN_MS = 5_000;
const SIG_LEN = 64;
const PUBKEY_LEN = 32;

const nonces = new Map<string, { nonce: string; expiresAt: number }>();
const rate = new Map<string, { lastNonceAt: number; lastVerifyAt: number }>();

/** Deterministic message the wallet signs. Reconstructed server-side on verify
 *  so the client can NEVER substitute its own text. */
function buildVerifyMessage(nonce: string): string {
  return `NemoVerse — verify wallet ownership for Nemo Gang.\nnonce: ${nonce}`;
}

export interface NonceResult {
  ok: boolean;
  nonce?: string;
  /** The exact text the wallet should sign. The client signs this verbatim; the
   *  server still RECONSTRUCTS it from its own stored nonce on verify, so the
   *  client's copy is never trusted as input — it's only a convenience to avoid
   *  duplicating the message format on the client. */
  message?: string;
  reason?: string;
}

/** Issue a fresh single-use nonce bound to this socket (rate-limited). */
export function issueNemoNonce(socketId: string): NonceResult {
  const now = Date.now();
  const r = rate.get(socketId) ?? { lastNonceAt: 0, lastVerifyAt: 0 };
  if (now - r.lastNonceAt < NONCE_COOLDOWN_MS) {
    return { ok: false, reason: "Please wait a moment before retrying." };
  }
  r.lastNonceAt = now;
  rate.set(socketId, r);

  const nonce = randomBytes(32).toString("hex");
  nonces.set(socketId, { nonce, expiresAt: now + NONCE_TTL_MS });
  return { ok: true, nonce, message: buildVerifyMessage(nonce) };
}

/** Consume the pending nonce for a socket (single-use; expired → null). */
function consumeNonce(socketId: string): string | null {
  const entry = nonces.get(socketId);
  nonces.delete(socketId); // single-use: always remove on attempt
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.nonce;
}

/** Drop all per-socket Solana session state (call on disconnect). */
export function clearSolanaSession(socketId: string): void {
  nonces.delete(socketId);
  rate.delete(socketId);
}

// ── C1: signature verification (ed25519 over the reconstructed message) ──────
function decodeKey(pubkey: string): Uint8Array | null {
  try {
    const raw = bs58.decode(pubkey);
    if (raw.length !== PUBKEY_LEN) return null;
    // Also ensure it's a structurally valid Solana public key.
    new PublicKey(pubkey);
    return raw;
  } catch {
    return null;
  }
}
function decodeSignature(sig: string): Uint8Array | null {
  // Client sends base64; accept base58 as a fallback. Must be 64 bytes.
  try {
    const b64 = Uint8Array.from(Buffer.from(sig, "base64"));
    if (b64.length === SIG_LEN) return b64;
  } catch { /* fall through */ }
  try {
    const b58 = bs58.decode(sig);
    if (b58.length === SIG_LEN) return b58;
  } catch { /* fall through */ }
  return null;
}

export interface VerifyResult {
  ok: boolean;
  eligible: boolean;
  /** User-facing reason (safe to toast; never includes secrets). */
  reason: string;
}

/**
 * Full verify pipeline for one { pubkey, signature } submission.
 * Returns eligible=true ONLY when ownership is proven AND the on-chain
 * $NEMOCLAW balance meets the threshold. Fails closed on every error path.
 */
export async function verifyNemoWallet(
  socketId: string,
  pubkey: unknown,
  signature: unknown,
): Promise<VerifyResult> {
  const now = Date.now();
  const r = rate.get(socketId) ?? { lastNonceAt: 0, lastVerifyAt: 0 };
  if (now - r.lastVerifyAt < VERIFY_COOLDOWN_MS) {
    return { ok: false, eligible: false, reason: "Please wait a moment before retrying." };
  }
  r.lastVerifyAt = now;
  rate.set(socketId, r);

  if (typeof pubkey !== "string" || typeof signature !== "string") {
    return { ok: false, eligible: false, reason: "Invalid wallet response." };
  }

  // C1: consume the nonce (single-use) and reconstruct the exact signed bytes.
  const nonce = consumeNonce(socketId);
  if (!nonce) {
    return { ok: false, eligible: false, reason: "Verification expired — reconnect your wallet." };
  }
  const keyBytes = decodeKey(pubkey);
  const sigBytes = decodeSignature(signature);
  if (!keyBytes || !sigBytes) {
    return { ok: false, eligible: false, reason: "Invalid wallet signature." };
  }
  const msgBytes = new TextEncoder().encode(buildVerifyMessage(nonce));
  const signatureValid = nacl.sign.detached.verify(msgBytes, sigBytes, keyBytes);
  if (!signatureValid) {
    logger.info({ outcome: "sig_invalid" }, "[nemoSolana] verify failed");
    return { ok: false, eligible: false, reason: "Wallet signature did not verify." };
  }

  // C2: on-chain $NEMOCLAW balance check (by mint only). Fail closed on error.
  let balance: number;
  try {
    balance = await getNemoBalance(pubkey);
  } catch (err) {
    const reason = (err as Error)?.message === "RPC_UNAVAILABLE"
      ? "Wallet verification unavailable."
      : "Wallet verification temporarily unavailable.";
    logger.warn({ outcome: "rpc_error" }, "[nemoSolana] balance check failed");
    return { ok: false, eligible: false, reason };
  }

  const min = getMinAmount();
  const eligible = min > 0 ? balance >= min : balance > 0;
  logger.info({ outcome: eligible ? "eligible" : "ineligible" }, "[nemoSolana] verify done");
  return {
    ok: true,
    eligible,
    reason: eligible ? "Verified — welcome to the Nemo Gang." : "No $NEMOCLAW found in this wallet.",
  };
}

// ── Batch B: wallet LOGIN — ownership proof only (NO $NEMOCLAW balance) ──────
// This is general account authorization: it proves the wallet owns the address
// and stops. It deliberately does NOT check any token balance — that is the
// SEPARATE Nemo Gang authorization (verifyNemoWallet above). Reuses the same
// nonce store + ed25519 verify; consumes the single-use nonce like any verify.
export function verifyWalletOwnership(
  socketId: string,
  pubkey: unknown,
  signature: unknown,
): { ok: boolean; address?: string; reason: string } {
  const now = Date.now();
  const r = rate.get(socketId) ?? { lastNonceAt: 0, lastVerifyAt: 0 };
  if (now - r.lastVerifyAt < VERIFY_COOLDOWN_MS) {
    return { ok: false, reason: "Please wait a moment before retrying." };
  }
  r.lastVerifyAt = now;
  rate.set(socketId, r);

  if (typeof pubkey !== "string" || typeof signature !== "string") {
    return { ok: false, reason: "Invalid wallet response." };
  }
  const nonce = consumeNonce(socketId);
  if (!nonce) {
    return { ok: false, reason: "Sign-in expired — reconnect your wallet." };
  }
  const keyBytes = decodeKey(pubkey);
  const sigBytes = decodeSignature(signature);
  if (!keyBytes || !sigBytes) {
    return { ok: false, reason: "Invalid wallet signature." };
  }
  const msgBytes = new TextEncoder().encode(buildVerifyMessage(nonce));
  const valid = nacl.sign.detached.verify(msgBytes, sigBytes, keyBytes);
  if (!valid) {
    logger.info({ outcome: "login_sig_invalid" }, "[walletAuth] login verify failed");
    return { ok: false, reason: "Wallet signature did not verify." };
  }
  logger.info({ outcome: "login_ok" }, "[walletAuth] login verified");
  return { ok: true, address: pubkey, reason: "Wallet verified." };
}

// ── C2: balance by MINT ADDRESS, decimals read from chain, summed accounts ───
async function getNemoBalance(pubkey: string): Promise<number> {
  const rpcUrl = getRpcUrl();
  if (!rpcUrl) throw new Error("RPC_UNAVAILABLE");

  const conn = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(pubkey);
  const mint = new PublicKey(getMint());

  // Query ONLY accounts for this owner + this mint address. A wallet can hold
  // several token accounts for one mint, so we sum them. uiAmount is already
  // decimal-adjusted using the mint decimals reported by the chain — we never
  // hardcode decimals.
  const res = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  let total = 0;
  for (const { account } of res.value) {
    const info = (account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } })
      ?.parsed?.info?.tokenAmount;
    total += info?.uiAmount ?? 0;
  }
  return total;
}
