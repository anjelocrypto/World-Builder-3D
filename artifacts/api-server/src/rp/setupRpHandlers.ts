/**
 * Registers RP-specific socket event listeners for one connected socket.
 * Called once inside the `join` handler in gameServer.ts, after the DB
 * upsert + rpCache population.
 *
 * Requires a LicenseContext (shared server state maps + io) so handlers
 * can validate against server-authoritative player/vehicle positions.
 *
 * Cleanup (rpCache.delete, rpTestState.delete, test vehicle despawn) lives in
 * gameServer.ts's disconnect handler so teardown stays centralised.
 */

import type { Socket } from "socket.io";
import { logger } from "../lib/logger";
import {
  startLicenseTest,
  handleCheckpoint,
  type LicenseContext,
} from "./rpLicenseService";
import {
  buyVehicle,
  toggleLock,
} from "./rpVehicleService";
import {
  toggleDuty,
  handleJobCheckpoint,
} from "./rpJobService";
import {
  bankDeposit,
  bankWithdraw,
} from "./rpWalletService";
import {
  handleIssueWarrant,
  handleArrest,
  handleCuff,
  handleUncuff,
} from "./rpPoliceService";
import {
  issueFine,
  respondFine,
} from "./rpFineService";
import {
  handleFactionChat,
  handleAdminSetFaction,
  handleListFactions,
  handleListOnlinePlayers,
  handleGangStatus,
  handleGangAction,
  handleGangJoinRequest,
  handleGangJoinResponse,
  handleGangRoster,
  handleGangSetRank,
  handleGangRemoveMember,
} from "./rpFactionService";

export type { LicenseContext };

export function setupRpHandlers(
  socket: Socket,
  ctx:    LicenseContext,
): void {

  // ── rp:interact ───────────────────────────────────────────────────────────
  // Phase 2: licensing office start-test.
  // Phase 3: dealership is handled via rp:buyVehicle (separate event).
  // Other buildings (ATM, job board, police station) will be added in later phases.
  socket.on(
    "rp:interact",
    (data: { building?: string; action?: string } | null | undefined) => {
      logger.info(
        { socketId: socket.id, data },
        "[rp] rp:interact received",
      );

      const building = typeof data?.building === "string" ? data.building : "";
      const action   = typeof data?.action   === "string" ? data.action   : "";

      if (
        building === "licensing_office" &&
        action   === "start_driver_test"
      ) {
        startLicenseTest(socket, ctx).catch((err) => {
          logger.error({ err, socketId: socket.id }, "[rp] startLicenseTest threw");
          socket.emit("rp:toast", {
            msg:      "Server error starting test — try again.",
            color:    "red",
            duration: 4000,
          });
        });
        return;
      }

      // Unknown building / action — Phase-N stub
      socket.emit("rp:toast", {
        msg:      "Nothing to do here yet.",
        color:    "yellow",
        duration: 2500,
      });
    },
  );

  // ── rp:licenseTestCheckpoint ──────────────────────────────────────────────
  // Client emits { idx } when within range of a checkpoint marker.  Server
  // validates using authoritative vehicle position — never client coordinates.
  socket.on(
    "rp:licenseTestCheckpoint",
    (data: { idx?: unknown } | null | undefined) => {
      const idx = typeof data?.idx === "number" ? Math.floor(data.idx) : -1;
      if (idx < 0) {
        logger.debug({ socketId: socket.id, data }, "[rp] invalid checkpoint idx");
        return;
      }
      handleCheckpoint(socket, ctx, idx).catch((err) => {
        logger.error({ err, socketId: socket.id, idx }, "[rp] handleCheckpoint threw");
        socket.emit("rp:toast", {
          msg:      "Server error processing checkpoint — drive through again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:buyVehicle ─────────────────────────────────────────────────────────
  // Phase 3: client emits { model, variant, color } when purchasing from the
  // dealership. Server validates license, proximity, catalog, and cash.
  socket.on(
    "rp:buyVehicle",
    (data: { model?: unknown; variant?: unknown; color?: unknown } | null | undefined) => {
      const model   = typeof data?.model   === "string" ? data.model   : "";
      const variant = typeof data?.variant === "string" ? data.variant : "";
      const color   = typeof data?.color   === "string" ? data.color   : "";

      if (!model || !variant || !color) {
        logger.debug({ socketId: socket.id, data }, "[rp] rp:buyVehicle: missing fields");
        return;
      }

      buyVehicle(socket, ctx, model, variant, color).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] buyVehicle threw");
        socket.emit("rp:toast", {
          msg:      "Server error processing purchase — try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:toggleLock ─────────────────────────────────────────────────────────
  // Phase 3: client emits { vehicleId } to lock/unlock an owned vehicle.
  // Server validates ownership and proximity.
  socket.on(
    "rp:toggleLock",
    (data: { vehicleId?: unknown } | null | undefined) => {
      const vehicleId = typeof data?.vehicleId === "string" ? data.vehicleId : "";
      if (!vehicleId) {
        logger.debug({ socketId: socket.id, data }, "[rp] rp:toggleLock: missing vehicleId");
        return;
      }

      toggleLock(socket, ctx, vehicleId).catch((err) => {
        logger.error({ err, socketId: socket.id, vehicleId }, "[rp] toggleLock threw");
        socket.emit("rp:toast", {
          msg:      "Server error toggling lock — try again.",
          color:    "red",
          duration: 3000,
        });
      });
    },
  );

  // ── rp:toggleDuty ─────────────────────────────────────────────────────────
  // Phase 4: client emits { job } to clock in/out at the City Worker depot.
  socket.on(
    "rp:toggleDuty",
    (data: { job?: unknown } | null | undefined) => {
      const job = typeof data?.job === "string" ? data.job : "";
      if (!job) {
        logger.debug({ socketId: socket.id, data }, "[rp] rp:toggleDuty: missing job");
        return;
      }
      toggleDuty(socket, ctx, job).catch((err) => {
        logger.error({ err, socketId: socket.id, job }, "[rp] toggleDuty threw");
        socket.emit("rp:toast", {
          msg:      "Server error — could not toggle duty. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:jobCheckpoint ──────────────────────────────────────────────────────
  // Phase 4: client emits { idx } when within range of the next job checkpoint.
  // Server validates order, proximity, and timing anti-farm rules.
  socket.on(
    "rp:jobCheckpoint",
    (data: { idx?: unknown } | null | undefined) => {
      const idx = typeof data?.idx === "number" ? Math.floor(data.idx) : -1;
      if (idx < 0) {
        logger.debug({ socketId: socket.id, data }, "[rp] rp:jobCheckpoint: invalid idx");
        return;
      }
      handleJobCheckpoint(socket, ctx, idx).catch((err) => {
        logger.error({ err, socketId: socket.id, idx }, "[rp] handleJobCheckpoint threw");
        socket.emit("rp:toast", {
          msg:      "Server error processing checkpoint — walk through again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:bankDeposit ────────────────────────────────────────────────────────
  // Phase 5F: client emits { amount } to deposit cash → bank at an ATM.
  // Server validates proximity, vehicle state, balance, and runs DB-first tx.
  socket.on(
    "rp:bankDeposit",
    (data: { amount?: unknown } | null | undefined) => {
      const rawAmount = data?.amount;
      bankDeposit(socket, ctx, rawAmount).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] bankDeposit threw");
        socket.emit("rp:toast", {
          msg:      "Server error — deposit failed. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:bankWithdraw ───────────────────────────────────────────────────────
  // Phase 5F: client emits { amount } to withdraw bank → cash at an ATM.
  // Server validates proximity, vehicle state, balance, and runs DB-first tx.
  socket.on(
    "rp:bankWithdraw",
    (data: { amount?: unknown } | null | undefined) => {
      const rawAmount = data?.amount;
      bankWithdraw(socket, ctx, rawAmount).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] bankWithdraw threw");
        socket.emit("rp:toast", {
          msg:      "Server error — withdrawal failed. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:issueWarrant ───────────────────────────────────────────────────────
  // Phase 6A: officer emits { targetId, stars, reason } to issue a warrant.
  // Server validates officer duty state, proximity, and inserts rp_warrants row.
  socket.on(
    "rp:issueWarrant",
    (data: { targetId?: unknown; stars?: unknown; reason?: unknown } | null | undefined) => {
      handleIssueWarrant(socket, ctx, data?.targetId, data?.stars, data?.reason).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] handleIssueWarrant threw");
        socket.emit("rp:toast", {
          msg:      "Server error — warrant not issued. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:arrest ─────────────────────────────────────────────────────────────
  // Phase 6A: officer emits { targetId } to arrest a nearby wanted player.
  // Server validates officer duty state, warrant existence, proximity, and
  // runs DB-first transaction (fine deduction + jail sentence).
  socket.on(
    "rp:arrest",
    (data: { targetId?: unknown } | null | undefined) => {
      handleArrest(socket, ctx, data?.targetId).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] handleArrest threw");
        socket.emit("rp:toast", {
          msg:      "Server error — arrest failed. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:cuff ───────────────────────────────────────────────────────────────
  // Phase 6C: officer emits { targetId } to cuff a nearby wanted player.
  // Server validates officer duty state, target wanted status, proximity, and
  // sets in-memory cuff state.
  socket.on(
    "rp:cuff",
    (data: { targetId?: unknown } | null | undefined) => {
      handleCuff(socket, ctx, data?.targetId).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] handleCuff threw");
        socket.emit("rp:toast", {
          msg:      "Server error — cuff failed. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:uncuff ─────────────────────────────────────────────────────────────
  // Phase 6C: officer emits { targetId } to release a cuffed player.
  // Server validates that the officer is the one who cuffed the target.
  socket.on(
    "rp:uncuff",
    (data: { targetId?: unknown } | null | undefined) => {
      handleUncuff(socket, ctx, data?.targetId).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] handleUncuff threw");
        socket.emit("rp:toast", {
          msg:      "Server error — uncuff failed. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:issueFine ──────────────────────────────────────────────────────────
  // Phase 6E: officer emits { targetId, amount, reason } to issue a fine to a
  // nearby player. Server validates officer state, proximity, and amount range.
  socket.on(
    "rp:issueFine",
    (data: { targetId?: unknown; amount?: unknown; reason?: unknown } | null | undefined) => {
      issueFine(socket, ctx, data?.targetId, data?.amount, data?.reason).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] issueFine threw");
        socket.emit("rp:toast", {
          msg:      "Server error — fine not issued. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:respondFine ────────────────────────────────────────────────────────
  // Phase 6E: target emits { accept: boolean } to accept or reject a pending fine.
  // Server is authoritative for the payment outcome.
  socket.on(
    "rp:respondFine",
    (data: { accept?: unknown } | null | undefined) => {
      respondFine(socket, ctx, data?.accept).catch((err) => {
        logger.error({ err, socketId: socket.id }, "[rp] respondFine threw");
        socket.emit("rp:toast", {
          msg:      "Server error — could not process fine response. Try again.",
          color:    "red",
          duration: 4000,
        });
      });
    },
  );

  // ── rp:factionChat ────────────────────────────────────────────────────────
  // Phase 7A: player emits { msg } to send a message to faction members.
  // Server validates faction membership, jail state, and message content.
  // Broadcast is faction-scoped; client never decides recipients.
  socket.on(
    "rp:factionChat",
    (data: { msg?: unknown } | null | undefined) => {
      handleFactionChat(socket, ctx, data?.msg);
    },
  );

  // ── rp:listFactions ───────────────────────────────────────────────────────
  // Phase 7C: read-only. Returns all seeded factions (slug, name, type, color).
  // Safe for all connected players.
  socket.on("rp:listFactions", () => {
    handleListFactions(socket).catch((err) => {
      logger.error({ err, socketId: socket.id }, "[rp] handleListFactions threw");
      socket.emit("rp:toast", {
        msg:      "Server error loading factions.",
        color:    "red",
        duration: 3000,
      });
    });
  });

  // ── rp:listOnlinePlayers ──────────────────────────────────────────────────
  // Phase 7C: read-only. Returns online player faction summary.
  // Safe metadata only — no DB IDs, no wallet, no location.
  socket.on("rp:listOnlinePlayers", () => {
    handleListOnlinePlayers(socket, ctx);
  });

  // ── rp:gangStatus ─────────────────────────────────────────────────────────
  // Phase 7D: read-only. Returns the caller's gang membership, rank, and turf
  // geometry. Non-gang players receive isMember=false.
  socket.on("rp:gangStatus", () => {
    handleGangStatus(socket, ctx);
  });

  // ── rp:gangAction ─────────────────────────────────────────────────────────
  // Phase 7D: validates a gang action on the server and broadcasts the outcome
  // to all online faction members. Server validates proximity using authoritative
  // player position — client position is never trusted.
  socket.on(
    "rp:gangAction",
    (data: { action?: unknown } | null | undefined) => {
      handleGangAction(socket, ctx, data);
    },
  );

  // ── rp:adminSetFaction ────────────────────────────────────────────────────
  // Phase 7A: DEV-only event to assign a faction to an online player.
  // NOT registered in production — faction assignment there must be done
  // directly via the DB until a proper server-side admin system exists.
  // username is client-controlled and is never used as an auth signal.
  if (process.env["NODE_ENV"] !== "production") {
    socket.on(
      "rp:adminSetFaction",
      (data: { targetId?: unknown; factionSlug?: unknown; rank?: unknown } | null | undefined) => {
        handleAdminSetFaction(
          socket, ctx,
          data?.targetId, data?.factionSlug, data?.rank,
        ).catch((err) => {
          logger.error({ err, socketId: socket.id }, "[rp] handleAdminSetFaction threw");
          socket.emit("rp:toast", {
            msg:      "Server error — faction assignment failed.",
            color:    "red",
            duration: 4000,
          });
        });
      },
    );
  }

  // ── rp:gangJoinRequest ────────────────────────────────────────────────────
  // Phase 7E: Non-gang player requests to join a gang faction.
  // Server validates jailed/cuffed/already-gang/duplicate before storing.
  socket.on("rp:gangJoinRequest", (data: unknown) => {
    handleGangJoinRequest(socket, ctx, data).catch((err) => {
      logger.error({ err, socketId: socket.id }, "[rp] handleGangJoinRequest threw");
      socket.emit("rp:toast", { msg: "Server error — join request failed.", color: "red", duration: 4000 });
    });
  });

  // ── rp:gangJoinResponse ───────────────────────────────────────────────────
  // Phase 7E: Gang leader accepts or rejects a pending join request.
  // Server validates leader rank + matching factionId before acting.
  socket.on("rp:gangJoinResponse", (data: unknown) => {
    handleGangJoinResponse(socket, ctx, data).catch((err) => {
      logger.error({ err, socketId: socket.id }, "[rp] handleGangJoinResponse threw");
      socket.emit("rp:toast", { msg: "Server error — join response failed.", color: "red", duration: 4000 });
    });
  });

  // ── rp:gangRoster ────────────────────────────────────────────────────────
  // Phase 7F: Any gang member may request the faction roster.
  // Returns safe fields only; no token, cash, position, or socket IDs.
  socket.on("rp:gangRoster", () => {
    handleGangRoster(socket, ctx).catch((err) => {
      logger.error({ err, socketId: socket.id }, "[rp] handleGangRoster threw");
      socket.emit("rp:toast", { msg: "Server error — roster fetch failed.", color: "red", duration: 4000 });
    });
  });

  // ── rp:gangSetRank ───────────────────────────────────────────────────────
  // Phase 7F: Gang leader promotes or demotes a member (rank 0–3).
  // Full auth: leader rank, not jailed/cuffed, target in same faction, rank < caller.
  socket.on("rp:gangSetRank", (data: unknown) => {
    handleGangSetRank(socket, ctx, data).catch((err) => {
      logger.error({ err, socketId: socket.id }, "[rp] handleGangSetRank threw");
      socket.emit("rp:toast", { msg: "Server error — rank update failed.", color: "red", duration: 4000 });
    });
  });

  // ── rp:gangRemoveMember ──────────────────────────────────────────────────
  // Phase 7F: Gang leader removes a member from the faction.
  // Full auth: leader rank, not jailed/cuffed, target in same faction, rank < caller.
  socket.on("rp:gangRemoveMember", (data: unknown) => {
    handleGangRemoveMember(socket, ctx, data).catch((err) => {
      logger.error({ err, socketId: socket.id }, "[rp] handleGangRemoveMember threw");
      socket.emit("rp:toast", { msg: "Server error — member removal failed.", color: "red", duration: 4000 });
    });
  });
}
