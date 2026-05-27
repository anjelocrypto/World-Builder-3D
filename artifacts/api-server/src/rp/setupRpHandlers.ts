/**
 * Registers RP-specific socket event listeners for one connected socket.
 * Called once inside the `join` handler in gameServer.ts, after the DB
 * upsert + rpCache population.
 *
 * Phase 1B: only `rp:interact` is registered (as a stub). Full handlers
 * (license test, ATM, job duty) arrive in Phase 2.
 *
 * Cleanup (rpCache.delete, rpTestState.delete) lives in gameServer.ts's
 * disconnect handler so teardown stays centralised.
 */

import type { Server, Socket } from "socket.io";
import { logger } from "../lib/logger";

export function setupRpHandlers(socket: Socket, _io: Server): void {
  // ── rp:interact (Phase 1B stub) ───────────────────────────────────────────
  // Phase 2 will implement the full license-test and ATM interaction flows.
  // For now we acknowledge the event so the client doesn't time out and
  // give a gentle "coming soon" toast.
  socket.on("rp:interact", (data: unknown) => {
    logger.info(
      { socketId: socket.id, data },
      "[rp] rp:interact received — Phase 2 handler pending",
    );
    socket.emit("rp:toast", {
      msg:      "Interactive buildings are coming in the next update!",
      color:    "yellow",
      duration: 3000,
    });
  });
}
