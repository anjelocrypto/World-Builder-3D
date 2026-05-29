import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupGameServer } from "./socket/gameServer";
import { loadCityConfigFromDb } from "./rp/rpGovernmentService";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = http.createServer(app);

// Phase 8C: load persisted city config (tax rate etc.) from DB before
// accepting socket connections.  loadCityConfigFromDb() never throws —
// on DB failure it logs and falls back to CITY_TAX_DEFAULT.
// We wrap startup in an async IIFE so we can await the DB load without
// changing setupGameServer's synchronous signature.
(async () => {
  await loadCityConfigFromDb();

  setupGameServer(httpServer);

  httpServer.listen(port, () => {
    logger.info({ port }, "Server listening");
  });

  httpServer.on("error", (err) => {
    logger.error({ err }, "Error starting server");
    process.exit(1);
  });
})();
