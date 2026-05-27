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

export type { LicenseContext };

export function setupRpHandlers(
  socket: Socket,
  ctx:    LicenseContext,
): void {

  // ── rp:interact ───────────────────────────────────────────────────────────
  // Phase 2: licensing office start-test.  Other buildings (ATM, job board,
  // police station) will be added here in later phases.
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
  // handleCheckpoint is async (final CP awaits DB write); errors are caught
  // here so an unhandled rejection cannot bring down the process.
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
}
