/**
 * Nemoverse RP Foundation — seed script
 *
 * Inserts reference rows for rp_factions and rp_jobs.
 * Safe to re-run: all inserts use onConflictDoNothing().
 *
 * ⚠️  DO NOT RUN in Phase 1A.
 *     Run only after:
 *       1. DATABASE_URL is set and confirmed reachable.
 *       2. The migration (0001_rp_foundation.sql) has been reviewed and applied.
 *
 * Run with:
 *   cd lib/db && pnpm seed:rp
 */

import { db, pool } from "../index";
import { rpFactions, rpJobs } from "../schema/rp";

async function main(): Promise<void> {
  // ── Factions ────────────────────────────────────────────────────────────────
  await db.insert(rpFactions).values([
    {
      slug:  "police",
      name:  "Nemoverse Police Department",
      type:  "police",
      color: "#3060ff",
    },
    {
      slug:  "medic",
      name:  "Nemoverse Medical Service",
      type:  "medic",
      color: "#ff4444",
    },
    {
      slug:  "government",
      name:  "City Government",
      type:  "government",
      color: "#d4aa00",
    },
    // Phase 7A: civilian faction — default for unassigned players.
    {
      slug:  "civilian",
      name:  "Civilian",
      type:  "civilian",
      color: "#ffffff",
    },
  ]).onConflictDoNothing();

  // ── Jobs ────────────────────────────────────────────────────────────────────
  await db.insert(rpJobs).values([
    {
      slug:          "taxi",
      name:          "Taxi Driver",
      startBuilding: "taxi_depot",
      payPerRoute:   120,
      cooldownSecs:  60,
      maxOnDuty:     8,
    },
    {
      slug:          "delivery",
      name:          "Delivery Driver",
      startBuilding: "delivery_hub",
      payPerRoute:   150,
      cooldownSecs:  90,
      maxOnDuty:     6,
    },
    {
      slug:          "mechanic",
      name:          "Mechanic",
      startBuilding: "auto_shop",
      payPerRoute:   180,
      cooldownSecs:  120,
      maxOnDuty:     4,
    },
    {
      slug:          "medic",
      name:          "Paramedic",
      startBuilding: "medical_center",
      payPerRoute:   200,
      cooldownSecs:  180,
      maxOnDuty:     4,
    },
    {
      slug:          "citywork",
      name:          "City Worker",
      startBuilding: "city_hall",
      payPerRoute:   100,
      cooldownSecs:  60,
      maxOnDuty:     10,
    },
  ]).onConflictDoNothing();

  console.log("[rpSeed] done — factions and jobs seeded.");
}

main()
  .catch((err) => {
    console.error("[rpSeed] error:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
