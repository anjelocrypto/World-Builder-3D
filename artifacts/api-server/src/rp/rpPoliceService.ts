/**
 * Police service — Phase 6A: Wanted Warrants + Arrest + Jail.
 *
 * Server-authoritative flow:
 *   rp:issueWarrant  — officer issues a 1-5 star warrant against a nearby player
 *   rp:arrest        — officer arrests a nearby wanted player
 *   releaseFromJail  — called by gameServer.ts when jailUntil has expired
 *
 * Rules:
 *   - Officer must be on duty as "police_patrol" and NOT jailed.
 *   - All money changes are DB-first (custom transaction; cash-first fine deduction).
 *   - Cache + socket emits happen only after DB commit.
 *   - jailReleaseInProgress Set guards against concurrent DB release calls (exported
 *     for use by gameServer.ts playerUpdate loop).
 */

import type { Socket } from "socket.io";
import { db, rpPlayers, rpWallets, rpWarrants, rpArrests, rpTransactionLog } from "@workspace/db";
import { eq, isNull, and, max }     from "drizzle-orm";
import { logger }                   from "../lib/logger";
import type { RpCacheEntry }        from "./rpCache";
import type { LicenseContext }      from "./rpLicenseService";
import {
  POLICE_ARREST_RADIUS,
  POLICE_WARRANT_RADIUS,
  POLICE_DEFAULT_SENTENCE_SECS,
  POLICE_DEFAULT_FINE,
  POLICE_MAX_FINE,
  POLICE_MAX_SENTENCE_SECS,
  POLICE_JAIL_CELL,
  POLICE_RELEASE_POS,
} from "../socket/cityData";

// ── Guards ────────────────────────────────────────────────────────────────────

/**
 * Prevents concurrent DB release calls while an async operation is in flight.
 * Keyed by socket.id. Populated before await; cleared in finally.
 * Exported so gameServer.ts can check before calling releaseFromJail.
 */
export const jailReleaseInProgress = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt((ax - bx) ** 2 + (az - bz) ** 2);
}

function isOfficerValid(entry: RpCacheEntry): boolean {
  return (
    entry.currentJob === "police_patrol" &&
    entry.onDuty &&
    entry.jailUntil === null
  );
}

// ── handleIssueWarrant ────────────────────────────────────────────────────────

/**
 * Phase 6A: Issue a wanted warrant against a nearby player.
 *
 * Validation order:
 *  1. Officer is on duty as police_patrol and not jailed
 *  2. stars: integer 1–5
 *  3. reason: non-empty string (max 200 chars; server sanitises)
 *  4. targetSocketId resolves to an active, non-jailed player
 *  5. Officer within POLICE_WARRANT_RADIUS (2D) of target
 *  6. DB: INSERT rp_warrants, query new MAX(stars) for wantedStars cache
 *  7. Update cache + emit rp:wantedUpdate to target
 */
export async function handleIssueWarrant(
  socket:         Socket,
  ctx:            LicenseContext,
  targetSocketId: unknown,
  rawStars:       unknown,
  rawReason:      unknown,
): Promise<void> {
  // ── Officer validation ───────────────────────────────────────────────────
  const officerEntry = ctx.rpCache.get(socket.id);
  const officerPos   = ctx.players.get(socket.id);
  if (!officerEntry || !officerPos) return;

  if (!isOfficerValid(officerEntry)) {
    socket.emit("rp:toast", {
      msg:      "You must be on duty as a Police Officer to issue warrants.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Input validation ─────────────────────────────────────────────────────
  if (typeof targetSocketId !== "string" || !targetSocketId) {
    socket.emit("rp:toast", { msg: "Invalid target.", color: "red", duration: 3000 });
    return;
  }

  const stars = typeof rawStars === "number" && Number.isInteger(rawStars) &&
                rawStars >= 1 && rawStars <= 5
    ? rawStars
    : 1; // default to 1 star if not provided / invalid

  const reason = typeof rawReason === "string" && rawReason.trim().length > 0
    ? rawReason.trim().slice(0, 200)
    : "Suspicious behaviour";

  // ── Target validation ────────────────────────────────────────────────────
  const targetEntry = ctx.rpCache.get(targetSocketId);
  const targetPos   = ctx.players.get(targetSocketId);
  if (!targetEntry || !targetPos) {
    socket.emit("rp:toast", { msg: "Target player not found.", color: "red", duration: 3000 });
    return;
  }

  if (targetEntry.jailUntil !== null) {
    socket.emit("rp:toast", {
      msg:      "That player is already in jail.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  if (targetSocketId === socket.id) {
    socket.emit("rp:toast", { msg: "You cannot issue a warrant against yourself.", color: "yellow", duration: 3000 });
    return;
  }

  // ── Proximity check ──────────────────────────────────────────────────────
  const distance = dist2d(officerPos.x, officerPos.z, targetPos.x, targetPos.z);
  if (distance > POLICE_WARRANT_RADIUS) {
    socket.emit("rp:toast", {
      msg:      `Too far away. Move within ${POLICE_WARRANT_RADIUS} m of the suspect.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── DB: insert warrant ───────────────────────────────────────────────────
  try {
    await db.insert(rpWarrants).values({
      playerId: targetEntry.playerId,
      reason,
      stars,
      issuedBy: officerEntry.playerId,
    });
  } catch (err) {
    logger.error({ err, socketId: socket.id }, "[rp] handleIssueWarrant: DB insert failed");
    socket.emit("rp:toast", {
      msg:      "Server error — warrant not issued. Try again.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // ── Update cache: query new max active stars ─────────────────────────────
  try {
    const [row] = await db
      .select({ maxStars: max(rpWarrants.stars) })
      .from(rpWarrants)
      .where(and(eq(rpWarrants.playerId, targetEntry.playerId), isNull(rpWarrants.clearedAt)));

    targetEntry.wantedStars = Number(row?.maxStars ?? stars);
  } catch {
    // Non-fatal: cache reflects at least the stars we just inserted.
    targetEntry.wantedStars = Math.max(targetEntry.wantedStars, stars);
  }

  // ── Emit to target ───────────────────────────────────────────────────────
  const targetSocket = ctx.io.sockets.sockets.get(targetSocketId);
  targetSocket?.emit("rp:wantedUpdate", { wantedStars: targetEntry.wantedStars });
  targetSocket?.emit("rp:profileUpdate", { wantedStars: targetEntry.wantedStars });
  targetSocket?.emit("rp:toast", {
    msg:      `⭐ You have been issued a ${stars}-star warrant: ${reason}`,
    color:    "red",
    duration: 6000,
  });

  // ── Confirm to officer ───────────────────────────────────────────────────
  socket.emit("rp:toast", {
    msg:      `Warrant issued (${stars}★). Suspect is now wanted.`,
    color:    "green",
    duration: 3500,
  });

  logger.info(
    {
      officerId: officerEntry.playerId,
      targetId:  targetEntry.playerId,
      stars,
      reason,
      wantedStars: targetEntry.wantedStars,
    },
    "[rp] warrant issued",
  );
}

// ── handleArrest ──────────────────────────────────────────────────────────────

/**
 * Phase 6A: Arrest a nearby wanted player.
 *
 * Validation order:
 *  1. Officer is on duty as police_patrol and not jailed
 *  2. targetSocketId resolves to an active player
 *  3. Target has wantedStars > 0 (active warrant)
 *  4. Target is not already jailed
 *  5. Officer within POLICE_ARREST_RADIUS (2D) of target
 *  6. DB transaction (serializable):
 *       a. SELECT … FOR UPDATE on rp_wallets (fine deduction, cash-first)
 *       b. INSERT rpTransactionLog (fine kind: "fine")
 *       c. UPDATE rpWallets
 *       d. UPDATE rp_warrants SET cleared_at = now() WHERE player_id = ? AND cleared_at IS NULL
 *       e. INSERT rp_arrests
 *       f. UPDATE rp_players SET jail_until = ?, jail_reason = ?
 *  7. After commit: update cache, emit rp:jailStatus + rp:profileUpdate + toast to target
 *  8. Confirm to officer
 */
export async function handleArrest(
  socket:         Socket,
  ctx:            LicenseContext,
  targetSocketId: unknown,
): Promise<void> {
  // ── Officer validation ───────────────────────────────────────────────────
  const officerEntry = ctx.rpCache.get(socket.id);
  const officerPos   = ctx.players.get(socket.id);
  if (!officerEntry || !officerPos) return;

  if (!isOfficerValid(officerEntry)) {
    socket.emit("rp:toast", {
      msg:      "You must be on duty as a Police Officer to make arrests.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Input / target validation ────────────────────────────────────────────
  if (typeof targetSocketId !== "string" || !targetSocketId) {
    socket.emit("rp:toast", { msg: "Invalid target.", color: "red", duration: 3000 });
    return;
  }

  if (targetSocketId === socket.id) {
    socket.emit("rp:toast", { msg: "You cannot arrest yourself.", color: "yellow", duration: 3000 });
    return;
  }

  const targetEntry = ctx.rpCache.get(targetSocketId);
  const targetPos   = ctx.players.get(targetSocketId);
  if (!targetEntry || !targetPos) {
    socket.emit("rp:toast", { msg: "Target player not found.", color: "red", duration: 3000 });
    return;
  }

  if (targetEntry.wantedStars === 0) {
    socket.emit("rp:toast", {
      msg:      "That player has no active warrants.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  if (targetEntry.jailUntil !== null) {
    socket.emit("rp:toast", {
      msg:      "That player is already in jail.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Proximity check ──────────────────────────────────────────────────────
  const distance = dist2d(officerPos.x, officerPos.z, targetPos.x, targetPos.z);
  if (distance > POLICE_ARREST_RADIUS) {
    socket.emit("rp:toast", {
      msg:      `Too far away. Move within ${POLICE_ARREST_RADIUS} m of the suspect.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Sentence parameters ──────────────────────────────────────────────────
  const sentenceSecs = Math.min(
    POLICE_DEFAULT_SENTENCE_SECS * targetEntry.wantedStars,
    POLICE_MAX_SENTENCE_SECS,
  );
  const fine = Math.min(
    POLICE_DEFAULT_FINE * targetEntry.wantedStars,
    POLICE_MAX_FINE,
  );
  const reason = `Arrested by officer — ${targetEntry.wantedStars}★ warrant`;
  const jailUntil = new Date(Date.now() + sentenceSecs * 1000);

  // ── DB transaction ───────────────────────────────────────────────────────
  let newCash: number;
  let newBank: number;
  let actualFine: number;

  try {
    const result = await db.transaction(async (tx) => {
      // Lock wallet row to prevent races.
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, targetEntry.playerId))
        .for("update");

      if (!wallet) throw new Error(`[rp] handleArrest: no wallet for ${targetEntry.playerId}`);

      // Cash-first fine deduction — never go negative.
      let cashDeduct = 0;
      let bankDeduct = 0;

      if (fine > 0) {
        if (wallet.cash >= fine) {
          cashDeduct = fine;
        } else {
          cashDeduct = wallet.cash;
          const remaining = fine - cashDeduct;
          bankDeduct = Math.min(remaining, wallet.bank);
        }
      }

      const nc = wallet.cash - cashDeduct;
      const nb = wallet.bank - bankDeduct;
      const af = cashDeduct + bankDeduct; // actual fine collected

      // Update wallet if any fine was collected.
      if (af > 0) {
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
          note:      `Arrest fine — ${targetEntry.wantedStars}★ warrant`,
        });
      }

      // Clear all active warrants for this player.
      await tx
        .update(rpWarrants)
        .set({ clearedAt: new Date() })
        .where(
          and(
            eq(rpWarrants.playerId, targetEntry.playerId),
            isNull(rpWarrants.clearedAt),
          ),
        );

      // Insert arrest record.
      await tx.insert(rpArrests).values({
        playerId:     targetEntry.playerId,
        arrestedBy:   officerEntry.playerId,
        reason,
        sentenceSecs,
        fine:         af,
      });

      // Set jail sentence on the player row.
      await tx
        .update(rpPlayers)
        .set({ jailUntil, jailReason: reason })
        .where(eq(rpPlayers.id, targetEntry.playerId));

      return { newCash: nc, newBank: nb, actualFine: af };
    });

    newCash    = result.newCash;
    newBank    = result.newBank;
    actualFine = result.actualFine;
  } catch (err) {
    logger.error({ err, socketId: socket.id, targetSocketId }, "[rp] handleArrest: tx failed");
    socket.emit("rp:toast", {
      msg:      "Server error — arrest failed. Try again.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // ── Update target cache (DB committed) ───────────────────────────────────
  targetEntry.cash        = newCash;
  targetEntry.bank        = newBank;
  targetEntry.wantedStars = 0;
  targetEntry.jailUntil   = jailUntil;
  targetEntry.jailReason  = reason;

  // ── Emit to target ───────────────────────────────────────────────────────
  const targetSocket = ctx.io.sockets.sockets.get(targetSocketId);
  targetSocket?.emit("rp:jailStatus", {
    jailed:    true,
    jailUntil: jailUntil.getTime(),
    jailReason: reason,
    jailCell:  POLICE_JAIL_CELL,
  });
  targetSocket?.emit("rp:profileUpdate", {
    cash:        newCash,
    bank:        newBank,
    wantedStars: 0,
    jailUntil:   jailUntil.getTime(),
    jailReason:  reason,
  });
  targetSocket?.emit("rp:toast", {
    msg:      `You have been arrested! Fine: $${actualFine}. Sentence: ${sentenceSecs}s.`,
    color:    "red",
    duration: 8000,
  });

  // ── Confirm to officer ───────────────────────────────────────────────────
  socket.emit("rp:toast", {
    msg:      `Arrested! Fine collected: $${actualFine}. Sentence: ${sentenceSecs}s.`,
    color:    "green",
    duration: 4000,
  });

  logger.info(
    {
      officerId: officerEntry.playerId,
      targetId:  targetEntry.playerId,
      fine:      actualFine,
      sentenceSecs,
      jailUntil: jailUntil.toISOString(),
    },
    "[rp] player arrested",
  );
}

// ── releaseFromJail ───────────────────────────────────────────────────────────

/**
 * Phase 6A: Release an expired jail sentence.
 *
 * Called by gameServer.ts playerUpdate loop when Date.now() >= entry.jailUntil.
 * The jailReleaseInProgress guard must be checked before calling to prevent
 * concurrent invocations.
 *
 * DB-first:
 *  1. UPDATE rp_players SET jail_until = NULL, jail_reason = NULL
 *  2. UPDATE rp_arrests SET released_at = NOW() WHERE player_id = ? AND released_at IS NULL
 * Cache-second: clear jailUntil, jailReason, wantedStars.
 * Socket-last: rp:jailStatus { jailed: false } + rp:profileUpdate + release toast.
 */
export async function releaseFromJail(
  socketId: string,
  entry:    RpCacheEntry,
  ctx:      LicenseContext,
): Promise<void> {
  jailReleaseInProgress.add(socketId);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(rpPlayers)
        .set({ jailUntil: null, jailReason: null })
        .where(eq(rpPlayers.id, entry.playerId));

      await tx
        .update(rpArrests)
        .set({ releasedAt: new Date() })
        .where(
          and(
            eq(rpArrests.playerId, entry.playerId),
            isNull(rpArrests.releasedAt),
          ),
        );
    });
  } catch (err) {
    logger.error({ err, socketId, playerId: entry.playerId }, "[rp] releaseFromJail: tx failed");
    jailReleaseInProgress.delete(socketId);
    return;
  }

  // DB committed — update cache.
  entry.jailUntil   = null;
  entry.jailReason  = null;
  entry.wantedStars = 0;

  const socket = ctx.io.sockets.sockets.get(socketId);
  socket?.emit("rp:jailStatus", {
    jailed:     false,
    releasePos: POLICE_RELEASE_POS,
  });
  socket?.emit("rp:profileUpdate", {
    jailUntil:   null,
    jailReason:  null,
    wantedStars: 0,
  });
  socket?.emit("rp:toast", {
    msg:      "You have been released from jail. Stay out of trouble.",
    color:    "green",
    duration: 5000,
  });

  jailReleaseInProgress.delete(socketId);

  logger.info(
    { socketId, playerId: entry.playerId },
    "[rp] player released from jail",
  );
}
