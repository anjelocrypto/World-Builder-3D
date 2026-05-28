/**
 * Phase 6E: Police Fine / Ticket service.
 *
 * Server-authoritative flow:
 *   rp:issueFine  { targetId, amount, reason }
 *     → validates officer + radius + amount range
 *     → stores pendingFine in memory, starts 60s expiry timer
 *     → emits rp:fineIssued to target
 *     → emits rp:toast to officer (confirmation)
 *
 *   rp:respondFine { accept: boolean }
 *     → if accept: deduct cash-first then bank (never negative), DB-first inline tx
 *     → emits rp:fineResolved to both parties
 *     → if reject: emits toast to officer + clears pendingFine
 *
 * Cleanup:
 *   clearFinesForSocket(socketId, ctx) — called on disconnect; cancels fines where
 *     this socket is the officer OR the target.
 *   clearFinesForTarget(targetSocketId) — called on arrest; cancels pending fine.
 *
 * No SQL migrations — all state is in-memory.
 */

import type { Socket }     from "socket.io";
import { db, rpWallets, rpTransactionLog } from "@workspace/db";
import { eq }              from "drizzle-orm";
import { logger }          from "../lib/logger";
import type { LicenseContext } from "./rpLicenseService";
import { isPolice } from "./rpFactionHelpers";
import {
  POLICE_FINE_RADIUS,
  POLICE_MIN_FINE,
  POLICE_MAX_FINE,
  POLICE_FINE_EXPIRE_MS,
} from "../socket/cityData";

// ── In-memory state ───────────────────────────────────────────────────────────

interface PendingFine {
  officerSocketId: string;
  targetSocketId:  string;
  amount:          number;
  reason:          string;
  expiresAt:       number; // Unix ms
  timerId:         ReturnType<typeof setTimeout>;
}

/** Keyed by target socket.id. One pending fine per target at a time. */
const pendingFines = new Map<string, PendingFine>();

// ── issueFine ─────────────────────────────────────────────────────────────────

/**
 * Phase 6E: Officer issues a fine to a nearby player.
 * Called from setupRpHandlers on rp:issueFine.
 */
export async function issueFine(
  socket:    Socket,
  ctx:       LicenseContext,
  rawTarget: unknown,
  rawAmount: unknown,
  rawReason: unknown,
): Promise<void> {
  const officerEntry = ctx.rpCache.get(socket.id);
  if (!officerEntry) return;

  // Phase 7B: Officer must be police faction, on duty, not jailed, not cuffed.
  if (
    !isPolice(officerEntry) ||
    officerEntry.currentJob !== "police_patrol" ||
    !officerEntry.onDuty ||
    officerEntry.jailUntil !== null ||
    officerEntry.cuffedBy !== null
  ) {
    socket.emit("rp:toast", {
      msg:      "You must be on duty as a police officer to issue fines.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Validate targetSocketId
  const targetSocketId = typeof rawTarget === "string" ? rawTarget.trim() : "";
  if (!targetSocketId || targetSocketId === socket.id) {
    socket.emit("rp:toast", { msg: "Invalid target.", color: "red", duration: 3000 });
    return;
  }

  const targetEntry = ctx.rpCache.get(targetSocketId);
  if (!targetEntry) {
    socket.emit("rp:toast", { msg: "Player not found.", color: "red", duration: 3000 });
    return;
  }

  // Target must not already be in jail.
  if (targetEntry.jailUntil !== null) {
    socket.emit("rp:toast", {
      msg:      "This player is already in jail.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Validate amount — must be a positive integer in [POLICE_MIN_FINE, POLICE_MAX_FINE].
  const amount = typeof rawAmount === "number" && Number.isInteger(rawAmount)
    ? rawAmount
    : -1;
  if (amount < POLICE_MIN_FINE || amount > POLICE_MAX_FINE) {
    socket.emit("rp:toast", {
      msg:      `Fine must be between $${POLICE_MIN_FINE} and $${POLICE_MAX_FINE}.`,
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Sanitise reason (max 120 chars, non-empty).
  const reason =
    typeof rawReason === "string" && rawReason.trim().length > 0
      ? rawReason.trim().slice(0, 120)
      : "Violation";

  // Proximity check — 2D distance between officer and target.
  const officer = ctx.players.get(socket.id);
  const target  = ctx.players.get(targetSocketId);
  if (!officer || !target) return;

  const dx   = officer.x - target.x;
  const dz   = officer.z - target.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > POLICE_FINE_RADIUS) {
    socket.emit("rp:toast", {
      msg:      `Too far away — move within ${POLICE_FINE_RADIUS}m to issue a fine.`,
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Reject if target already has a pending fine — one fine at a time.
  if (pendingFines.has(targetSocketId)) {
    socket.emit("rp:toast", {
      msg:      "Target already has a pending fine.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const expiresAt = Date.now() + POLICE_FINE_EXPIRE_MS;

  const timerId = setTimeout(() => {
    pendingFines.delete(targetSocketId);
    // Notify both parties that the fine expired.
    ctx.io.to(targetSocketId).emit("rp:fineExpired", {});
    ctx.io.to(targetSocketId).emit("rp:toast", {
      msg:      "Fine notice expired.",
      color:    "yellow",
      duration: 3000,
    });
    ctx.io.to(socket.id).emit("rp:toast", {
      msg:      "Fine expired — target did not respond.",
      color:    "yellow",
      duration: 3000,
    });
    logger.info({ officerSocketId: socket.id, targetSocketId }, "[rp] fine expired");
  }, POLICE_FINE_EXPIRE_MS);

  pendingFines.set(targetSocketId, {
    officerSocketId: socket.id,
    targetSocketId,
    amount,
    reason,
    expiresAt,
    timerId,
  });

  // Emit fine notice to target.
  const officerName = officer.username ?? "Officer";
  ctx.io.to(targetSocketId).emit("rp:fineIssued", {
    officerId:   socket.id,
    officerName,
    amount,
    reason,
    expiresAt,
  });

  // Confirm to officer.
  socket.emit("rp:toast", {
    msg:      `Fine issued to ${target.username ?? targetSocketId}: $${amount} — ${reason}.`,
    color:    "green",
    duration: 4000,
  });

  logger.info(
    { officerSocketId: socket.id, targetSocketId, amount, reason },
    "[rp] fine issued",
  );
}

// ── respondFine ───────────────────────────────────────────────────────────────

/**
 * Phase 6E: Target accepts or rejects a pending fine.
 * Called from setupRpHandlers on rp:respondFine.
 */
export async function respondFine(
  socket:    Socket,
  ctx:       LicenseContext,
  rawAccept: unknown,
): Promise<void> {
  const targetSocketId = socket.id;
  const fine = pendingFines.get(targetSocketId);

  if (!fine) {
    socket.emit("rp:toast", {
      msg:      "No pending fine.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const accept = rawAccept === true;

  if (!accept) {
    // ── Rejected: clear immediately, no DB needed ─────────────────────────────
    clearTimeout(fine.timerId);
    pendingFines.delete(targetSocketId);

    socket.emit("rp:fineResolved", { accepted: false, amount: fine.amount });
    socket.emit("rp:toast", {
      msg:      "Fine rejected.",
      color:    "red",
      duration: 3000,
    });
    ctx.io.to(fine.officerSocketId).emit("rp:fineResolved", { accepted: false, amount: fine.amount });
    ctx.io.to(fine.officerSocketId).emit("rp:toast", {
      msg:      "Fine rejected — issue warrant if appropriate.",
      color:    "red",
      duration: 4000,
    });
    logger.info(
      { officerSocketId: fine.officerSocketId, targetSocketId, amount: fine.amount },
      "[rp] fine rejected",
    );
    return;
  }

  // ── Accepted: DB-first cash/bank deduction ─────────────────────────────────
  // NOTE: keep pendingFines entry alive until the DB transaction commits so the
  // target can retry payment if the DB fails (DB-first pattern, Phase 6E P1 fix).
  const targetEntry = ctx.rpCache.get(targetSocketId);
  if (!targetEntry) {
    // Cache entry missing (race with disconnect) — clear fine and notify both.
    clearTimeout(fine.timerId);
    pendingFines.delete(targetSocketId);
    ctx.io.to(fine.officerSocketId).emit("rp:toast", {
      msg:      "Fine cancelled — player left the server.",
      color:    "yellow",
      duration: 3000,
    });
    logger.warn({ targetSocketId }, "[rp] respondFine: targetEntry missing on accept");
    return;
  }

  let newCash       = targetEntry.cash;
  let newBank       = targetEntry.bank;
  let actualDeducted = 0;

  try {
    const result = await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, targetEntry.playerId))
        .for("update");

      if (!wallet) throw new Error("Wallet not found");

      // Cash-first, then bank; never below zero.
      let remaining  = fine.amount;
      let cashDeduct = 0;
      let bankDeduct = 0;

      if (wallet.cash >= remaining) {
        cashDeduct = remaining;
        remaining  = 0;
      } else {
        cashDeduct = wallet.cash;
        remaining -= wallet.cash;
      }
      if (remaining > 0) {
        bankDeduct = Math.min(remaining, wallet.bank);
      }

      const deducted = cashDeduct + bankDeduct;
      const nc       = wallet.cash - cashDeduct;
      const nb       = wallet.bank - bankDeduct;

      if (deducted > 0) {
        await tx
          .update(rpWallets)
          .set({ cash: nc, bank: nb, updatedAt: new Date() })
          .where(eq(rpWallets.playerId, targetEntry.playerId));

        await tx.insert(rpTransactionLog).values({
          playerId:  targetEntry.playerId,
          kind:      "fine",
          cashDelta: -cashDeduct,
          bankDelta: -bankDeduct,
          cashAfter: nc,
          bankAfter: nb,
          note:      `Fine paid: ${fine.reason}`,
        });
      }

      return { nc, nb, deducted };
    });

    newCash        = result.nc;
    newBank        = result.nb;
    actualDeducted = result.deducted;
  } catch (err) {
    // DB failed — leave pendingFine in place so target can retry before expiry.
    logger.error({ err, targetSocketId }, "[rp] respondFine: DB transaction failed");
    socket.emit("rp:toast", {
      msg:      "Server error processing fine payment — try again.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // ── DB committed: now clear the fine + update cache + notify both parties ──
  clearTimeout(fine.timerId);
  pendingFines.delete(targetSocketId);

  targetEntry.cash = newCash;
  targetEntry.bank = newBank;

  socket.emit("rp:fineResolved", { accepted: true, amount: actualDeducted });
  socket.emit("rp:profileUpdate", { cash: newCash, bank: newBank });
  socket.emit("rp:toast", {
    msg:      `Fine paid: $${actualDeducted}. Stay out of trouble!`,
    color:    "yellow",
    duration: 4000,
  });

  const targetName = ctx.players.get(targetSocketId)?.username ?? targetSocketId;
  ctx.io.to(fine.officerSocketId).emit("rp:fineResolved", { accepted: true, amount: actualDeducted });
  ctx.io.to(fine.officerSocketId).emit("rp:toast", {
    msg:      `Fine accepted — $${actualDeducted} collected from ${targetName}.`,
    color:    "green",
    duration: 4000,
  });

  logger.info(
    { officerSocketId: fine.officerSocketId, targetSocketId, amount: actualDeducted },
    "[rp] fine accepted and paid",
  );
}

// ── clearFinesForSocket ───────────────────────────────────────────────────────

/**
 * Phase 6E: Called on disconnect.
 * Cancels any pending fine where this socket is the target OR the officer.
 */
export function clearFinesForSocket(socketId: string, ctx: LicenseContext): void {
  // Case 1: this socket was the target.
  const asTarget = pendingFines.get(socketId);
  if (asTarget) {
    clearTimeout(asTarget.timerId);
    pendingFines.delete(socketId);
    ctx.io.to(asTarget.officerSocketId).emit("rp:toast", {
      msg:      "Target disconnected — fine cancelled.",
      color:    "yellow",
      duration: 3000,
    });
  }

  // Case 2: this socket was the officer who issued one or more fines.
  for (const [targetId, fine] of pendingFines.entries()) {
    if (fine.officerSocketId === socketId) {
      clearTimeout(fine.timerId);
      pendingFines.delete(targetId);
      ctx.io.to(targetId).emit("rp:fineExpired", {});
      ctx.io.to(targetId).emit("rp:toast", {
        msg:      "Officer disconnected — fine cancelled.",
        color:    "yellow",
        duration: 3000,
      });
    }
  }
}

// ── clearFinesForTarget ───────────────────────────────────────────────────────

/**
 * Phase 6E: Called after arrest.
 * Cancels any pending fine for the arrested target (no need to notify — arrest takes precedence).
 */
export function clearFinesForTarget(targetSocketId: string): void {
  const fine = pendingFines.get(targetSocketId);
  if (fine) {
    clearTimeout(fine.timerId);
    pendingFines.delete(targetSocketId);
  }
}
