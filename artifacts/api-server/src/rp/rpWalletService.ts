/**
 * Wallet service — atomic cash / bank transfers with SELECT … FOR UPDATE
 * to prevent double-spend races.
 */

import { db, rpWallets, rpTransactionLog } from "@workspace/db";
import { eq } from "drizzle-orm";

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
