/**
 * Wallet service — atomic cash / bank transfers with SELECT … FOR UPDATE
 * to prevent double-spend races.
 *
 * Phase 5F: bankDeposit + bankWithdraw socket handlers added.
 *   - Player must be walking (not in vehicle) near an ATM.
 *   - Amount: positive integer, ≤ 100 000.
 *   - DB transaction commits before any cache mutation or socket emit.
 *   - rp:profileUpdate { cash, bank } only emitted after commit.
 */

import { db, rpWallets, rpTransactionLog } from "@workspace/db";
import { eq }                               from "drizzle-orm";
import type { Socket }                      from "socket.io";
import { logger }                           from "../lib/logger";
import type { RpCacheEntry }                from "./rpCache";
import { ATM_LOCATIONS, ATM_INTERACT_RADIUS } from "../socket/cityData";

// ── Transaction kinds ──────────────────────────────────────────────────────

export type TransactionKind =
  | "license_fee"
  | "vehicle_purchase"
  | "job_pay"
  | "fine"
  | "bank_deposit"
  | "bank_withdraw"
  | "salary"
  | "admin_grant";

// ── Error type ─────────────────────────────────────────────────────────────

/** Thrown by walletTransfer on application-level rejections (e.g. insufficient funds). */
export class RpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RpError";
  }
}

// ── Transfer input ─────────────────────────────────────────────────────────

export interface WalletTransferInput {
  playerId:   string;
  cashDelta?: number;   // negative = deduct, positive = add; default 0
  bankDelta?: number;   // negative = deduct, positive = add; default 0
  kind:       TransactionKind;
  note?:      string;
}

// ── walletTransfer ─────────────────────────────────────────────────────────

/**
 * Apply a cash/bank delta in a serializable DB transaction.
 *
 * Uses `SELECT … FOR UPDATE` to prevent two concurrent events from
 * double-spending the same balance. Application-level bounds checks
 * run before the UPDATE, giving descriptive errors before the DB
 * constraint fires.
 *
 * Returns the new { cash, bank } on success.
 * Throws `RpError` on insufficient funds; throws `Error` if no wallet found.
 */
export async function walletTransfer(
  input: WalletTransferInput,
): Promise<{ cash: number; bank: number }> {
  const { playerId, cashDelta = 0, bankDelta = 0, kind, note } = input;

  return db.transaction(async (tx) => {
    // Row-lock prevents concurrent transfers from racing on the same row.
    const [wallet] = await tx
      .select()
      .from(rpWallets)
      .where(eq(rpWallets.playerId, playerId))
      .for("update");

    if (!wallet) {
      throw new Error(`[rp] walletTransfer: no wallet for playerId=${playerId}`);
    }

    const newCash = wallet.cash + cashDelta;
    const newBank = wallet.bank + bankDelta;

    // Application-level checks — descriptive before hitting the DB CHECK constraint.
    if (newCash < 0) {
      throw new RpError(
        "insufficient_cash",
        `Need $${-cashDelta}, have $${wallet.cash}`,
      );
    }
    if (newBank < 0) {
      throw new RpError(
        "insufficient_bank",
        `Need $${-bankDelta}, have $${wallet.bank}`,
      );
    }

    await tx
      .update(rpWallets)
      .set({ cash: newCash, bank: newBank, updatedAt: new Date() })
      .where(eq(rpWallets.playerId, playerId));

    await tx.insert(rpTransactionLog).values({
      playerId,
      kind,
      cashDelta,
      bankDelta,
      cashAfter: newCash,
      bankAfter: newBank,
      note:      note ?? null,
    });

    return { cash: newCash, bank: newBank };
  });
}

// ── ATM socket context ─────────────────────────────────────────────────────────

/** Minimal player fields the ATM handlers need. */
interface PlayerState {
  x:           number;
  y:           number;
  z:           number;
  isInVehicle: boolean;
}

export interface AtmContext {
  players: Map<string, PlayerState>;
  rpCache: Map<string, RpCacheEntry>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ATM_MAX_AMOUNT = 100_000;

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt((ax - bx) ** 2 + (az - bz) ** 2);
}

function isNearAtm(x: number, z: number): boolean {
  return ATM_LOCATIONS.some(
    ({ pos }) => dist2d(x, z, pos[0], pos[2]) <= ATM_INTERACT_RADIUS,
  );
}

function parseAmount(raw: unknown): number | null {
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw)) return null;
  if (raw <= 0 || raw > ATM_MAX_AMOUNT) return null;
  return raw;
}

// ── bankDeposit ────────────────────────────────────────────────────────────────

/**
 * Phase 5F: Move `amount` from cash → bank.
 *
 * Validation order:
 *  1. amount parse (positive integer, ≤ 100 000)
 *  2. player exists + not in vehicle
 *  3. within ATM_INTERACT_RADIUS of any ATM
 *  4. DB transaction via walletTransfer (SELECT FOR UPDATE, RpError on
 *     insufficient cash)
 *  5. Cache + rp:profileUpdate only after commit
 */
export async function bankDeposit(
  socket:    Socket,
  ctx:       AtmContext,
  rawAmount: unknown,
): Promise<void> {
  const amount = parseAmount(rawAmount);
  if (amount === null) {
    logger.debug({ socketId: socket.id, rawAmount }, "[rp] bankDeposit: invalid amount");
    socket.emit("rp:toast", { msg: "Invalid deposit amount.", color: "red", duration: 3000 });
    return;
  }

  const player = ctx.players.get(socket.id);
  const entry  = ctx.rpCache.get(socket.id);
  if (!player || !entry) {
    logger.debug({ socketId: socket.id }, "[rp] bankDeposit: no player/cache entry");
    return;
  }

  // Phase 6D: jailed players cannot use the ATM.
  if (entry.jailUntil !== null) {
    socket.emit("rp:toast", { msg: "You cannot use the ATM while in jail.", color: "yellow", duration: 3000 });
    return;
  }

  if (player.isInVehicle) {
    socket.emit("rp:toast", { msg: "Exit your vehicle to use the ATM.", color: "yellow", duration: 3000 });
    return;
  }
  if (!isNearAtm(player.x, player.z)) {
    socket.emit("rp:toast", { msg: "You're not close enough to an ATM.", color: "yellow", duration: 3000 });
    return;
  }

  let result: { cash: number; bank: number };
  try {
    result = await walletTransfer({
      playerId:  entry.playerId,
      cashDelta: -amount,
      bankDelta:  amount,
      kind:      "bank_deposit",
      note:      `ATM deposit $${amount}`,
    });
  } catch (err) {
    if (err instanceof RpError && err.code === "insufficient_cash") {
      socket.emit("rp:toast", {
        msg:      `Not enough cash. You only have $${entry.cash}.`,
        color:    "red",
        duration: 4000,
      });
      return;
    }
    logger.error({ err, socketId: socket.id, amount }, "[rp] bankDeposit: tx failed");
    socket.emit("rp:toast", {
      msg:      "Server error — deposit failed. Try again.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // DB committed — update cache
  entry.cash = result.cash;
  entry.bank = result.bank;

  socket.emit("rp:profileUpdate", { cash: result.cash, bank: result.bank });
  socket.emit("rp:toast", {
    msg:      `Deposited $${amount}. Bank: $${result.bank}.`,
    color:    "green",
    duration: 3500,
  });

  logger.info(
    { socketId: socket.id, playerId: entry.playerId, amount, cash: result.cash, bank: result.bank },
    "[rp] bankDeposit complete",
  );
}

// ── bankWithdraw ───────────────────────────────────────────────────────────────

/**
 * Phase 5F: Move `amount` from bank → cash.
 *
 * Same validation + DB-first pattern as bankDeposit.
 */
export async function bankWithdraw(
  socket:    Socket,
  ctx:       AtmContext,
  rawAmount: unknown,
): Promise<void> {
  const amount = parseAmount(rawAmount);
  if (amount === null) {
    logger.debug({ socketId: socket.id, rawAmount }, "[rp] bankWithdraw: invalid amount");
    socket.emit("rp:toast", { msg: "Invalid withdrawal amount.", color: "red", duration: 3000 });
    return;
  }

  const player = ctx.players.get(socket.id);
  const entry  = ctx.rpCache.get(socket.id);
  if (!player || !entry) {
    logger.debug({ socketId: socket.id }, "[rp] bankWithdraw: no player/cache entry");
    return;
  }

  // Phase 6D: jailed players cannot use the ATM.
  if (entry.jailUntil !== null) {
    socket.emit("rp:toast", { msg: "You cannot use the ATM while in jail.", color: "yellow", duration: 3000 });
    return;
  }

  if (player.isInVehicle) {
    socket.emit("rp:toast", { msg: "Exit your vehicle to use the ATM.", color: "yellow", duration: 3000 });
    return;
  }
  if (!isNearAtm(player.x, player.z)) {
    socket.emit("rp:toast", { msg: "You're not close enough to an ATM.", color: "yellow", duration: 3000 });
    return;
  }

  let result: { cash: number; bank: number };
  try {
    result = await walletTransfer({
      playerId:  entry.playerId,
      cashDelta:  amount,
      bankDelta: -amount,
      kind:      "bank_withdraw",
      note:      `ATM withdrawal $${amount}`,
    });
  } catch (err) {
    if (err instanceof RpError && err.code === "insufficient_bank") {
      socket.emit("rp:toast", {
        msg:      `Not enough in bank. Balance: $${entry.bank}.`,
        color:    "red",
        duration: 4000,
      });
      return;
    }
    logger.error({ err, socketId: socket.id, amount }, "[rp] bankWithdraw: tx failed");
    socket.emit("rp:toast", {
      msg:      "Server error — withdrawal failed. Try again.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // DB committed — update cache
  entry.cash = result.cash;
  entry.bank = result.bank;

  socket.emit("rp:profileUpdate", { cash: result.cash, bank: result.bank });
  socket.emit("rp:toast", {
    msg:      `Withdrew $${amount}. Cash: $${result.cash}.`,
    color:    "green",
    duration: 3500,
  });

  logger.info(
    { socketId: socket.id, playerId: entry.playerId, amount, cash: result.cash, bank: result.bank },
    "[rp] bankWithdraw complete",
  );
}
