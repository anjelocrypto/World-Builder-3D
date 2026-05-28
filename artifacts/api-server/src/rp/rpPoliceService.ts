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
  isPolice,
  isFactionRankAtLeast,
  POLICE_ARREST_MIN_RANK,
} from "./rpFactionHelpers";
import {
  POLICE_ARREST_RADIUS,
  POLICE_WARRANT_RADIUS,
  POLICE_DEFAULT_SENTENCE_SECS,
  POLICE_DEFAULT_FINE,
  POLICE_MAX_FINE,
  POLICE_MAX_SENTENCE_SECS,
  POLICE_JAIL_CELL,
  POLICE_RELEASE_POS,
  POLICE_CUFF_RADIUS,
  POLICE_CUFF_TIMEOUT_SECS,
  POLICE_BOOKING_DESK_POS,
  POLICE_BOOKING_RADIUS,
} from "../socket/cityData";
import { clearFinesForTarget } from "./rpFineService";

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

/**
 * Phase 7B: officer must be police faction, on duty as police_patrol,
 * not jailed, and not cuffed.
 * Belt-and-suspenders — clock-in already requires police faction (rpJobService),
 * so a player could only have currentJob === "police_patrol" if they passed
 * that gate. This guard closes any future edge-case paths.
 */
function isOfficerValid(entry: RpCacheEntry): boolean {
  return (
    isPolice(entry) &&
    entry.currentJob === "police_patrol" &&
    entry.onDuty &&
    entry.jailUntil === null &&
    // Phase 6C: a cuffed officer cannot issue warrants, cuff, uncuff, or arrest.
    entry.cuffedBy === null
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
 *  7. Update cache + broadcast rp:wantedUpdate to all clients + emit rp:profileUpdate / toast to target
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

  // ── Broadcast wanted update to ALL clients + emit profile/toast to target ──
  // Broadcast so every officer's client can maintain its wantedByPlayerId map.
  // playerId field carries targetSocketId so clients know which player is wanted.
  ctx.io.emit("rp:wantedUpdate", { playerId: targetSocketId, wantedStars: targetEntry.wantedStars });

  const targetSocket = ctx.io.sockets.sockets.get(targetSocketId);
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

// ── Sentinel error for atomic warrant check ───────────────────────────────────

/**
 * Thrown inside the arrest DB transaction when no active warrant row is found.
 * Caught in handleArrest's catch block to distinguish "no warrant" (expected
 * race-condition outcome) from a genuine DB error.
 */
class NoActiveWarrantError extends Error {
  constructor() { super("no_active_warrant"); }
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

  // Phase 7B: arrest requires minimum rank (rank >= POLICE_ARREST_MIN_RANK).
  if (!isFactionRankAtLeast(officerEntry, POLICE_ARREST_MIN_RANK)) {
    socket.emit("rp:toast", {
      msg:      `Higher police rank required. (min rank ${POLICE_ARREST_MIN_RANK})`,
      color:    "red",
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

  // ── Proximity / cuff check ──────────────────────────────────────────────
  // Arrest is allowed if:
  //   a) Target is cuffed by THIS officer (escort distance — skip range check), OR
  //   b) Officer is within POLICE_ARREST_RADIUS of the suspect (classic field arrest).
  const isCuffedByMe = targetEntry.cuffedBy === socket.id;
  if (!isCuffedByMe) {
    const distance = dist2d(officerPos.x, officerPos.z, targetPos.x, targetPos.z);
    if (distance > POLICE_ARREST_RADIUS) {
      socket.emit("rp:toast", {
        msg:      `Too far away. Cuff the suspect first [U], then arrest [K].`,
        color:    "yellow",
        duration: 3500,
      });
      return;
    }
  }

  // ── DB transaction (atomic warrant claim) ───────────────────────────────
  //
  // The warrant existence check is intentionally INSIDE the transaction, placed
  // after locking the wallet row with SELECT … FOR UPDATE.  This serialises
  // concurrent arrest attempts on the same suspect: the second officer to acquire
  // the wallet lock will find no active warrants (the first already cleared them)
  // and abort cleanly before touching wallet / jail state.  A pre-transaction
  // SELECT would be non-atomic — two officers could both pass the check and then
  // both execute the fine / jail / log writes.
  let newCash:      number;
  let newBank:      number;
  let actualFine:   number;
  let sentenceSecs: number;
  let jailUntil:    Date;
  let reason:       string;

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Lock wallet row — serialises concurrent arrests on the same suspect.
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, targetEntry.playerId))
        .for("update");

      if (!wallet) throw new Error(`[rp] handleArrest: no wallet for ${targetEntry.playerId}`);

      // 2. Atomically verify active warrants exist under the wallet lock.
      //    If another officer already arrested this suspect the warrants will be
      //    cleared; we throw a sentinel so the catch block can handle it cleanly.
      const [{ maxStars }] = await tx
        .select({ maxStars: max(rpWarrants.stars) })
        .from(rpWarrants)
        .where(and(eq(rpWarrants.playerId, targetEntry.playerId), isNull(rpWarrants.clearedAt)));

      if (!maxStars) throw new NoActiveWarrantError();

      // 3. Compute sentence / fine from the authoritative DB star count.
      const dbStars        = Number(maxStars);
      const dbSentenceSecs = Math.min(POLICE_DEFAULT_SENTENCE_SECS * dbStars, POLICE_MAX_SENTENCE_SECS);
      const dbFine         = Math.min(POLICE_DEFAULT_FINE * dbStars, POLICE_MAX_FINE);
      const dbReason       = `Arrested by officer — ${dbStars}★ warrant`;
      const dbJailUntil    = new Date(Date.now() + dbSentenceSecs * 1000);

      // 4. Cash-first fine deduction — never go negative.
      let cashDeduct = 0;
      let bankDeduct = 0;

      if (dbFine > 0) {
        if (wallet.cash >= dbFine) {
          cashDeduct = dbFine;
        } else {
          cashDeduct = wallet.cash;
          const remaining = dbFine - cashDeduct;
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
          note:      `Arrest fine — ${dbStars}★ warrant`,
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
        reason:       dbReason,
        sentenceSecs: dbSentenceSecs,
        fine:         af,
      });

      // Set jail sentence on the player row.
      await tx
        .update(rpPlayers)
        .set({ jailUntil: dbJailUntil, jailReason: dbReason })
        .where(eq(rpPlayers.id, targetEntry.playerId));

      return {
        newCash:      nc,
        newBank:      nb,
        actualFine:   af,
        sentenceSecs: dbSentenceSecs,
        jailUntil:    dbJailUntil,
        reason:       dbReason,
      };
    });

    newCash      = result.newCash;
    newBank      = result.newBank;
    actualFine   = result.actualFine;
    sentenceSecs = result.sentenceSecs;
    jailUntil    = result.jailUntil;
    reason       = result.reason;
  } catch (err) {
    if (err instanceof NoActiveWarrantError) {
      // Race lost — another officer arrested this suspect first.
      // Reconcile the stale cache entry so all clients reflect reality.
      targetEntry.wantedStars = 0;
      const staleSocket = ctx.io.sockets.sockets.get(targetSocketId);
      staleSocket?.emit("rp:profileUpdate", { wantedStars: 0 });
      ctx.io.emit("rp:wantedUpdate", { playerId: targetSocketId, wantedStars: 0 });
      socket.emit("rp:toast", {
        msg:      "That player has no active warrants (warrant may have just been cleared).",
        color:    "yellow",
        duration: 4000,
      });
      return;
    }
    logger.error({ err, socketId: socket.id, targetSocketId }, "[rp] handleArrest: tx failed");
    socket.emit("rp:toast", {
      msg:      "Server error — arrest failed. Try again.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // ── Phase 6E: cancel any pending fine for the arrested player ────────────
  clearFinesForTarget(targetSocketId);

  // ── Update target cache (DB committed) ───────────────────────────────────
  targetEntry.cash        = newCash;
  targetEntry.bank        = newBank;
  targetEntry.wantedStars = 0;
  targetEntry.jailUntil   = jailUntil;
  targetEntry.jailReason  = reason;
  // Phase 6C: clear any active cuff — suspect is now jailed.
  targetEntry.cuffedBy    = null;
  targetEntry.cuffedUntil = null;

  // ── Broadcast warrant + cuff cleared to all clients ─────────────────────
  ctx.io.emit("rp:wantedUpdate",  { playerId: targetSocketId, wantedStars: 0 });
  ctx.io.emit("rp:cuffedUpdate",  { targetId: targetSocketId, cuffedBy: null, cuffedUntil: null });

  // ── Server-authoritative teleport to jail cell ────────────────────────────
  // Update the players Map so the confinement logic sees the correct position
  // immediately, and broadcast so all clients move the target instantly.
  const jailedPlayer = ctx.players.get(targetSocketId);
  if (jailedPlayer) {
    const teleported = {
      ...jailedPlayer,
      x:          POLICE_JAIL_CELL[0],
      y:          POLICE_JAIL_CELL[1],
      z:          POLICE_JAIL_CELL[2],
      isInVehicle: false,
      vehicleId:   null,
      speed:       0,
    };
    ctx.players.set(targetSocketId, teleported);
    ctx.io.emit("playerMoved", teleported);
  }

  // ── Release any vehicle the target was driving ────────────────────────────
  ctx.vehicles.forEach((v, vid) => {
    if (v.driverId === targetSocketId) {
      const released = { ...v, driverId: null as null, speed: 0 };
      ctx.vehicles.set(vid, released);
      ctx.io.emit("vehicleMoved", released);
    }
  });

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
  // Phase 6D: booking desk tip — only when officer is NOT already at the desk
  // (if they're already there the HUD K-prompt gives all the context needed).
  const officerNow = ctx.players.get(socket.id);
  if (officerNow) {
    const bdx = officerNow.x - POLICE_BOOKING_DESK_POS[0];
    const bdz = officerNow.z - POLICE_BOOKING_DESK_POS[2];
    const distToDesk = Math.sqrt(bdx * bdx + bdz * bdz);
    if (distToDesk > POLICE_BOOKING_RADIUS) {
      setTimeout(() => {
        socket.emit("rp:toast", {
          msg:      "📋 Escort the suspect to the Booking Desk inside the station.",
          color:    "blue",
          duration: 5000,
        });
      }, 2500);
    }
  }

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

    // DB committed — update cache.
    entry.jailUntil   = null;
    entry.jailReason  = null;
    entry.wantedStars = 0;
    // Phase 6C: clear any residual cuff state on release.
    entry.cuffedBy    = null;
    entry.cuffedUntil = null;

    // ── Server-authoritative teleport to release position ─────────────────
    // Move the player out of the jail zone in the authoritative Map so the
    // confinement logic in playerUpdate never re-clamps them, then broadcast
    // so all clients see the immediate position change.
    const releasedPlayer = ctx.players.get(socketId);
    if (releasedPlayer) {
      const teleported = {
        ...releasedPlayer,
        x:          POLICE_RELEASE_POS[0],
        y:          POLICE_RELEASE_POS[1],
        z:          POLICE_RELEASE_POS[2],
        isInVehicle: false,
        vehicleId:   null,
        speed:       0,
      };
      ctx.players.set(socketId, teleported);
      ctx.io.emit("playerMoved", teleported);
    }

    // Broadcast warrant-cleared to all clients so their wantedByPlayerId maps
    // reflect the release (wantedStars already cleared on arrest, but be explicit).
    ctx.io.emit("rp:wantedUpdate", { playerId: socketId, wantedStars: 0 });

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

    logger.info(
      { socketId, playerId: entry.playerId },
      "[rp] player released from jail",
    );
  } catch (err) {
    logger.error({ err, socketId, playerId: entry.playerId }, "[rp] releaseFromJail: tx failed");
  } finally {
    // Always clear the guard — even if a later emit/Map update throws,
    // the guard cannot get permanently stuck.
    jailReleaseInProgress.delete(socketId);
  }
}

// ── handleCuff ────────────────────────────────────────────────────────────────

/**
 * Phase 6C: Cuff a nearby wanted player.
 *
 * Validation order:
 *  1. Officer is on duty as police_patrol and not jailed.
 *  2. targetSocketId resolves to an active, non-jailed player.
 *  3. Target has wantedStars > 0.
 *  4. Target is not already cuffed.
 *  5. Officer is within POLICE_CUFF_RADIUS of target.
 *  6. Set in-memory cuff state on target cache entry.
 *  7. Emit rp:profileUpdate to target; broadcast rp:cuffedUpdate to all.
 */
export async function handleCuff(
  socket:         Socket,
  ctx:            LicenseContext,
  targetSocketId: unknown,
): Promise<void> {
  const officerEntry = ctx.rpCache.get(socket.id);
  const officerPos   = ctx.players.get(socket.id);
  if (!officerEntry || !officerPos) return;

  if (!isOfficerValid(officerEntry)) {
    socket.emit("rp:toast", {
      msg:      "You must be on duty as a Police Officer to cuff suspects.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  if (typeof targetSocketId !== "string" || !targetSocketId || targetSocketId === socket.id) {
    socket.emit("rp:toast", { msg: "Invalid target.", color: "red", duration: 3000 });
    return;
  }

  const targetEntry = ctx.rpCache.get(targetSocketId);
  const targetPos   = ctx.players.get(targetSocketId);
  if (!targetEntry || !targetPos) {
    socket.emit("rp:toast", { msg: "Target player not found.", color: "red", duration: 3000 });
    return;
  }

  if (targetEntry.jailUntil !== null) {
    socket.emit("rp:toast", { msg: "That player is already in jail.", color: "yellow", duration: 3000 });
    return;
  }

  if (targetEntry.wantedStars <= 0) {
    socket.emit("rp:toast", { msg: "That player has no active warrants.", color: "yellow", duration: 3000 });
    return;
  }

  if (targetEntry.cuffedBy !== null) {
    socket.emit("rp:toast", {
      msg:      "That suspect is already cuffed by another officer.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const distance = dist2d(officerPos.x, officerPos.z, targetPos.x, targetPos.z);
  if (distance > POLICE_CUFF_RADIUS) {
    socket.emit("rp:toast", {
      msg:      `Move within ${POLICE_CUFF_RADIUS} m to cuff the suspect.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Apply cuff state ─────────────────────────────────────────────────────
  const cuffedUntil = new Date(Date.now() + POLICE_CUFF_TIMEOUT_SECS * 1000);
  targetEntry.cuffedBy    = socket.id;
  targetEntry.cuffedUntil = cuffedUntil;

  // P1 fix: release any vehicle the suspect is currently driving.
  // Without this the vehicles map retains driverId === targetSocketId,
  // locking that vehicle until arrest or disconnect.
  ctx.vehicles.forEach((vehicle, vehicleId) => {
    if (vehicle.driverId === targetSocketId) {
      const released = { ...vehicle, driverId: null, speed: 0 };
      ctx.vehicles.set(vehicleId, released);
      ctx.io.emit("vehicleMoved", released);
      logger.info(
        { vehicleId, targetId: targetEntry.playerId },
        "[rp] vehicle released on cuff",
      );
    }
  });

  const cuffedUntilMs = cuffedUntil.getTime();

  ctx.io.emit("rp:cuffedUpdate", {
    targetId:    targetSocketId,
    cuffedBy:    socket.id,
    cuffedUntil: cuffedUntilMs,
  });

  const targetSocket = ctx.io.sockets.sockets.get(targetSocketId);
  targetSocket?.emit("rp:profileUpdate", { cuffedBy: socket.id, cuffedUntil: cuffedUntilMs });
  targetSocket?.emit("rp:toast", {
    msg:      "🔒 You have been cuffed! Wait for officer action.",
    color:    "red",
    duration: 6000,
  });

  socket.emit("rp:toast", {
    msg:      "Suspect cuffed. You can now escort and arrest them [K].",
    color:    "green",
    duration: 4000,
  });

  logger.info(
    { officerId: officerEntry.playerId, targetId: targetEntry.playerId },
    "[rp] suspect cuffed",
  );
}

// ── handleUncuff ──────────────────────────────────────────────────────────────

/**
 * Phase 6C: Release (uncuff) a cuffed player.
 *
 * Validation order:
 *  1. Officer is on duty as police_patrol.
 *  2. targetSocketId resolves to a cuffed player.
 *  3. The caller is the cuffing officer, or any officer on duty (e.g. backup).
 *  4. Clear in-memory cuff state; broadcast rp:cuffedUpdate to all.
 */
export async function handleUncuff(
  socket:         Socket,
  ctx:            LicenseContext,
  targetSocketId: unknown,
): Promise<void> {
  const officerEntry = ctx.rpCache.get(socket.id);
  if (!officerEntry) return;

  if (!isOfficerValid(officerEntry)) {
    socket.emit("rp:toast", {
      msg:      "You must be on duty as a Police Officer to uncuff suspects.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // P1 fix: reject self-uncuff attempts.
  if (typeof targetSocketId !== "string" || !targetSocketId || targetSocketId === socket.id) {
    socket.emit("rp:toast", { msg: "Invalid target.", color: "red", duration: 3000 });
    return;
  }

  // P1 fix: require server-authoritative officer position (officer must be in the world).
  const officerPos = ctx.players.get(socket.id);
  if (!officerPos) return;

  const targetEntry = ctx.rpCache.get(targetSocketId);
  // P1 fix: require target position to exist server-side.
  const targetPos   = ctx.players.get(targetSocketId);
  if (!targetEntry || !targetPos) {
    socket.emit("rp:toast", { msg: "Target player not found.", color: "red", duration: 3000 });
    return;
  }

  if (targetEntry.cuffedBy === null) {
    socket.emit("rp:toast", { msg: "That player is not cuffed.", color: "yellow", duration: 3000 });
    return;
  }

  // P1 fix: enforce server-side proximity check — officer must be within cuff radius.
  const uncuffDist = dist2d(officerPos.x, officerPos.z, targetPos.x, targetPos.z);
  if (uncuffDist > POLICE_CUFF_RADIUS) {
    socket.emit("rp:toast", {
      msg:      `Move within ${POLICE_CUFF_RADIUS} m to uncuff the suspect.`,
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // ── Clear cuff state ─────────────────────────────────────────────────────
  targetEntry.cuffedBy    = null;
  targetEntry.cuffedUntil = null;

  ctx.io.emit("rp:cuffedUpdate", {
    targetId:    targetSocketId,
    cuffedBy:    null,
    cuffedUntil: null,
  });

  const targetSocket = ctx.io.sockets.sockets.get(targetSocketId);
  targetSocket?.emit("rp:profileUpdate", { cuffedBy: null, cuffedUntil: null });
  targetSocket?.emit("rp:toast", {
    msg:      "🔓 You have been uncuffed.",
    color:    "green",
    duration: 4000,
  });

  socket.emit("rp:toast", {
    msg:      "Suspect uncuffed.",
    color:    "green",
    duration: 2500,
  });

  logger.info(
    { officerId: officerEntry.playerId, targetId: targetEntry.playerId },
    "[rp] suspect uncuffed",
  );
}
