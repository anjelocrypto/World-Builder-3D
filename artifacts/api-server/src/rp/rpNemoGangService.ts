// =============================================================
// Nemo Gang — session-cache eligibility + spawn (Batch B).
// -------------------------------------------------------------
// SERVER-AUTHORITATIVE and session-only: eligibility lives in an in-memory Set
// keyed by socket.id and is re-evaluated on every connect. NO DB and NO DB
// migration. NO Solana yet — Batch C replaces evaluateNemoEligibilityOnJoin()'s
// dev allowlist with real wallet-signature + on-chain $NEMOCLAW balance
// verification (by mint address). The client is NEVER trusted to set this.
// =============================================================

export const NEMO_GANG_ID = "nemo_gang";
export const NEMO_GANG_NAME = "Nemo Gang";

// MIRROR of the client's shared/nemoHood.ts NEMO_HOOD_SPAWN. The server must not
// import client modules, so this constant is duplicated here intentionally; keep
// the two in sync if the hood spawn ever moves.
export const NEMO_HOOD_SPAWN: readonly [number, number, number] = [-200, 1, 336];

/** socket.id → eligible. Cleared on disconnect; never persisted. */
const eligible = new Set<string>();

// Dev-only allowlist so Batch B (spawn + status) is testable BEFORE the wallet
// verification of Batch C exists. Comma-separated, case-insensitive usernames.
// Leave NEMO_DEV_ELIGIBLE_USERNAMES unset in production → nobody is eligible
// until Batch C grants it from a verified token balance.
const devUsernames = new Set(
  (process.env.NEMO_DEV_ELIGIBLE_USERNAMES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Decide eligibility for a freshly-joined socket. TEMPORARY: gated only by the
 * dev username allowlist. Batch C will replace the body with a server-side
 * wallet-ownership + $NEMOCLAW balance check, keeping the same signature.
 */
export function evaluateNemoEligibilityOnJoin(socketId: string, username: string): boolean {
  const ok = devUsernames.has(username.trim().toLowerCase());
  if (ok) eligible.add(socketId);
  else eligible.delete(socketId);
  return ok;
}

export function isNemoEligible(socketId: string): boolean {
  return eligible.has(socketId);
}

/**
 * Grant eligibility after a SUCCESSFUL server-side wallet+token verification
 * (Batch C). The only caller is the rp:nemoVerify handler, which has already
 * proven wallet ownership and a sufficient on-chain $NEMOCLAW balance. Session-
 * only — cleared on disconnect like every other eligibility path.
 */
export function grantNemoEligible(socketId: string): void {
  eligible.add(socketId);
}

export function clearNemoEligible(socketId: string): void {
  eligible.delete(socketId);
}

/** Safe status payload for the joining client (no internal flags/ids leaked). */
export function nemoGangStatus(socketId: string): {
  isMember: boolean;
  gangName: string;
  spawn: readonly [number, number, number] | null;
} {
  const member = eligible.has(socketId);
  return {
    isMember: member,
    gangName: NEMO_GANG_NAME,
    spawn: member ? NEMO_HOOD_SPAWN : null,
  };
}
