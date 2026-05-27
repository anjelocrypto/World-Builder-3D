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
}
