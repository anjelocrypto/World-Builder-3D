/**
 * Nemoverse RP Foundation — Drizzle schema
 *
 * Declaration order is critical for FK generation:
 *   1. rpFactions       (no FKs)
 *   2. rpPlayers        FK → rpFactions
 *   3. rpWallets        FK → rpPlayers
 *   4. rpTransactionLog FK → rpPlayers
 *   5. rpOwnedVehicles  FK → rpPlayers
 *   6. rpWarrants       FK → rpPlayers × 2
 *   7. rpArrests        FK → rpPlayers × 2
 *   8. rpJobs           (independent seed table, no FKs)
 *
 * DO NOT import this file from api-server runtime until Phase 1B is approved.
 * Schema-only — no migrations are applied in Phase 1A.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  smallint,
  integer,
  bigserial,
} from "drizzle-orm/pg-core";
import { index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── 1. rp_factions ────────────────────────────────────────────────────────────
// Declared first — rp_players has a FK to this table.
export const rpFactions = pgTable("rp_factions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  slug:      text("slug").unique().notNull(),
  name:      text("name").notNull(),
  type:      text("type").notNull(),
  color:     text("color").notNull().default("#ffffff"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 2. rp_players ─────────────────────────────────────────────────────────────
export const rpPlayers = pgTable(
  "rp_players",
  {
    id:               uuid("id").primaryKey().defaultRandom(),
    token:            text("token").unique().notNull(),
    username:         text("username").notNull(),
    createdAt:        timestamp("created_at",        { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt:       timestamp("last_seen_at",       { withTimezone: true }).notNull().defaultNow(),
    driverLicenseAt:  timestamp("driver_license_at",  { withTimezone: true }),
    weaponLicenseAt:  timestamp("weapon_license_at",  { withTimezone: true }),
    jailUntil:        timestamp("jail_until",          { withTimezone: true }),
    jailReason:       text("jail_reason"),
    factionId:        uuid("faction_id").references(() => rpFactions.id, { onDelete: "set null" }),
    factionRank:      smallint("faction_rank").notNull().default(0),
    currentJob:       text("current_job"),
    onDuty:           boolean("on_duty").notNull().default(false),
    lastPaycheckAt:   timestamp("last_paycheck_at",   { withTimezone: true }),
  },
  (t) => [
    index("idx_rp_players_token").on(t.token),
    index("idx_rp_players_faction").on(t.factionId),
  ],
);

// ── 3. rp_wallets ─────────────────────────────────────────────────────────────
export const rpWallets = pgTable(
  "rp_wallets",
  {
    playerId:  uuid("player_id").primaryKey()
                 .references(() => rpPlayers.id, { onDelete: "cascade" }),
    cash:      integer("cash").notNull().default(500),
    bank:      integer("bank").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("rp_wallets_cash_nonneg", sql`${t.cash} >= 0`),
    check("rp_wallets_bank_nonneg", sql`${t.bank} >= 0`),
  ],
);

// ── 4. rp_transaction_log ─────────────────────────────────────────────────────
export const rpTransactionLog = pgTable(
  "rp_transaction_log",
  {
    id:         bigserial("id", { mode: "number" }).primaryKey(),
    playerId:   uuid("player_id").notNull()
                  .references(() => rpPlayers.id, { onDelete: "cascade" }),
    kind:       text("kind").notNull(),
    cashDelta:  integer("cash_delta").notNull().default(0),
    bankDelta:  integer("bank_delta").notNull().default(0),
    cashAfter:  integer("cash_after").notNull(),
    bankAfter:  integer("bank_after").notNull(),
    note:       text("note"),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_rp_tx_player_time").on(t.playerId, t.createdAt),
  ],
);

// ── 5. rp_owned_vehicles ──────────────────────────────────────────────────────
export const rpOwnedVehicles = pgTable(
  "rp_owned_vehicles",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    ownerId:      uuid("owner_id").notNull()
                    .references(() => rpPlayers.id, { onDelete: "cascade" }),
    model:        text("model").notNull(),
    variant:      text("variant").notNull(),
    color:        text("color").notNull().default("#aabbcc"),
    plate:        text("plate").unique().notNull(),
    locked:       boolean("locked").notNull().default(true),
    fuel:         smallint("fuel").notNull().default(100),
    purchasedAt:  timestamp("purchased_at",   { withTimezone: true }).notNull().defaultNow(),
    lastDrivenAt: timestamp("last_driven_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_rp_vehicles_owner").on(t.ownerId),
  ],
);

// ── 6. rp_warrants ────────────────────────────────────────────────────────────
export const rpWarrants = pgTable(
  "rp_warrants",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    playerId:  uuid("player_id").notNull()
                 .references(() => rpPlayers.id, { onDelete: "cascade" }),
    reason:    text("reason").notNull(),
    stars:     smallint("stars").notNull().default(1),
    issuedBy:  uuid("issued_by").references(() => rpPlayers.id, { onDelete: "set null" }),
    issuedAt:  timestamp("issued_at",  { withTimezone: true }).notNull().defaultNow(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (t) => [
    check("rp_warrants_stars_range", sql`${t.stars} BETWEEN 1 AND 5`),
    // Option A: keep this Drizzle-generated normal index (do NOT delete it).
    // After `drizzle-kit generate`, also manually APPEND the partial index below
    // to the generated SQL file — do not replace this one:
    //
    //   CREATE INDEX idx_rp_warrants_active
    //     ON rp_warrants(player_id)
    //     WHERE cleared_at IS NULL;
    //
    // Both indexes coexist. Deleting idx_rp_warrants_player causes migration drift.
    index("idx_rp_warrants_player").on(t.playerId),
  ],
);

// ── 7. rp_arrests ─────────────────────────────────────────────────────────────
export const rpArrests = pgTable(
  "rp_arrests",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    playerId:     uuid("player_id").notNull()
                    .references(() => rpPlayers.id, { onDelete: "cascade" }),
    arrestedBy:   uuid("arrested_by").references(() => rpPlayers.id, { onDelete: "set null" }),
    reason:       text("reason").notNull(),
    sentenceSecs: integer("sentence_secs").notNull(),
    fine:         integer("fine").notNull().default(0),
    arrestedAt:   timestamp("arrested_at",  { withTimezone: true }).notNull().defaultNow(),
    releasedAt:   timestamp("released_at",  { withTimezone: true }),
  },
  (t) => [
    index("idx_rp_arrests_player").on(t.playerId, t.arrestedAt),
  ],
);

// ── 8. rp_jobs (static reference table) ──────────────────────────────────────
// Seed rows are NOT inserted here — see lib/db/src/seed/rpSeed.ts (Phase 1A, do not run yet).
export const rpJobs = pgTable("rp_jobs", {
  slug:          text("slug").primaryKey(),
  name:          text("name").notNull(),
  startBuilding: text("start_building").notNull(),
  payPerRoute:   integer("pay_per_route").notNull(),
  cooldownSecs:  integer("cooldown_secs").notNull().default(300),
  maxOnDuty:     smallint("max_on_duty").notNull().default(8),
});
