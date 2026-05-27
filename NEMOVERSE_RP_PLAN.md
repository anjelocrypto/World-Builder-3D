# Nemoverse RP Foundation — Implementation Plan v1.2

> **Status:** Revised proposal — pending approval before any code changes.
>
> **Changes from v1.1:**
> - Station spawn relocated from `[18, 1, -65]` (inside downtown building block) to
>   `[128, 1, -65]` — ground-level exterior at the foot of the real Central Loop Station
>   stairs, validated against all buildings, parked cars, rail geometry, and obstacles.
> - Licensing Office relocated from `[24, 0, -22]` (2m from car-0) to `[14, 0, -30]` —
>   11m from car-0, 22m from car-10, clear of all roads and building blocks.
> - Test vehicle spawn updated to match new office position.
> - Checkpoint route redesigned from new office/spawn positions.
> - Drizzle TypeScript schema updated with proper `check()`, `index()`, and partial-index
>   syntax; seed row strategy clarified (separate seed script, not in migration).
> - Phase 1 scope confirmed narrow (no test, no jobs, no police, no saved position).

---

## Table of Contents

1. [Architecture Principles](#1-architecture-principles)
2. [Player Identity Strategy](#2-player-identity-strategy)
3. [Phase 1 — Minimal RP Core (First Coding Session)](#3-phase-1--minimal-rp-core-first-coding-session)
4. [Data Model & DB Schema](#4-data-model--db-schema)
5. [Phase 2 — Central Spawn](#5-phase-2--central-spawn)
6. [Phase 3 — Driver License Gate](#6-phase-3--driver-license-gate)
7. [Phase 4 — Money System](#7-phase-4--money-system)
8. [Phase 5 — RP Jobs](#8-phase-5--rp-jobs)
9. [Phase 6 — Police & Arrest](#9-phase-6--police--arrest)
10. [Phase 7 — Gangs & Factions](#10-phase-7--gangs--factions)
11. [Phase 8 — Mayor & Government](#11-phase-8--mayor--government)
12. [Validators](#12-validators)
13. [Socket Event Catalog](#13-socket-event-catalog)
14. [Anti-Cheat & Server Authority Rules](#14-anti-cheat--server-authority-rules)
15. [File Change Map](#15-file-change-map)
16. [Implementation Order](#16-implementation-order)
17. [Approval Checklist](#17-approval-checklist)

---

## 1. Architecture Principles

### What stays unchanged
- All movement, physics, collision, and vehicle driving mechanics.
- Terrain, map geometry, biomes, lighting, and day/night cycle.
- Existing multiplayer sync (`playerMoved` / `vehicleMoved` events).
- Server-side validation of position, animation state, and vehicle driver authority.

### What the RP layer adds
- Persistent player profiles loaded from PostgreSQL on join, written on meaningful events.
- A small **in-memory RP cache** on the server (`socketId → RpCacheEntry`) for fast
  per-event checks (license, cash, faction, active test) without querying the DB on
  every socket packet.
- New socket events (`rp:` prefix) carrying **intent only** — the server derives every
  outcome and pushes back authoritative state.
- Client-side UI that renders **server-authoritative state only** — never local guesses
  for money, license, ownership, or arrest status.

### Server authority model (license test example)
```
Client                               Server
  │                                    │
  │─ rp:interact                       │  ① Player within 6m of office?
  │    { building:"licensing_office",  │  ② cash >= TEST_FEE?
  │      action:"start_driver_test" } ─►  ③ driverLicense === false?
  │                                    │  ④ No active test already?
  │◄─ rp:toast { msg, color:"red" } ───│     any fail → toast, return
  │                                    │
  │                                    │  All pass:
  │                                    │  ⑤ Deduct TEST_FEE (walletTransfer)
  │                                    │  ⑥ Spawn test vehicle
  │                                    │  ⑦ Record testState in rpTestState Map
  │◄─ rp:licenseTestActive ────────────│  ⑧ Emit to this socket only
  │    { vehicleId, checkpoints[] }    │
```

---

## 2. Player Identity Strategy

### Problem
Players join with `{ username }` only. No auth exists. Without a stable identifier we
cannot persist wallet, license, or ownership across sessions.

### Proposed solution — Client UUID token
1. On first visit the client generates `crypto.randomUUID()` and stores it in
   `localStorage` under `nemoverse_player_token`.
2. Every `join` event includes `{ username, token }`.
3. The server **upserts** `rp_players` keyed on `token`. Username may change; the token
   is the stable identity key.
4. The server **never** sends one player's token to any other socket.

### Security posture
Token in `localStorage` is ownable by whoever controls the machine — acceptable for a
game (no real-world financial risk). Upgrade path: swap `token` column for `auth_id`
pointing to an OAuth row; no other RP code changes.

---

## 3. Phase 1 — Minimal RP Core (First Coding Session)

This is the **only** scope for the first coding session. Everything else is deferred.

### Deliverables

| # | Feature | Server | Client |
|---|---------|--------|--------|
| 1 | Stable player token on join | Upsert `rp_players` row | Generate + store UUID in localStorage |
| 2 | Wallet starting cash/bank | Insert `rp_wallets` (cash=500, bank=0) | — |
| 3 | Server sends `rp:profile` on join | Emit full `RpProfile` to joining socket | Store in React state |
| 4 | Central Station spawn | All spawns always use `STATION_SPAWN` | — |
| 5 | Cash / bank / license on HUD | — | Two new HUD lines + license badge |
| 6 | License flag | Persist `driver_license_at` in DB + cache | Show badge |
| 7 | Vehicle entry blocked if unlicensed | Reject `driverId` patch in `vehicleUpdate` | Show toast, skip `enterVehicle()` |

### Explicitly out of scope for Phase 1
Saved-position restore, license test flow, bank ATM, jobs, factions, police, gangs,
mayor, vehicle purchasing, warrants, arrests, jail — all deferred.

---

## 4. Data Model & DB Schema

### 4.1 Declaration order — critical for Drizzle FK generation

Drizzle generates FK constraints in declaration order. The sequence must be:

```
1. rpFactions      (no FKs)
2. rpPlayers       FK → rpFactions
3. rpWallets       FK → rpPlayers
4. rpTransactionLog  FK → rpPlayers
5. rpOwnedVehicles FK → rpPlayers
6. rpWarrants      FK → rpPlayers × 2
7. rpArrests       FK → rpPlayers × 2
8. rpJobs          (independent seed table, no FKs)
```

### 4.2 Migration strategy

**Do not run `drizzle-kit push`.** Instead:

```bash
# Step 1 — generate DDL migration file for review:
cd lib/db && pnpm drizzle-kit generate
# Produces: lib/db/drizzle/0001_rp_foundation.sql  ← review before applying

# Step 2 — review the generated SQL (compare against preview in §4.3 below)

# Step 3 — apply only after explicit approval:
cd lib/db && pnpm drizzle-kit migrate   # or psql -f drizzle/0001_rp_foundation.sql
```

### 4.3 What `drizzle-kit generate` will NOT include

`drizzle-kit generate` produces DDL only. It does **not** include:
- `INSERT` seed rows for `rp_factions` and `rp_jobs`
- Partial index (`WHERE cleared_at IS NULL`) — requires manual SQL or Drizzle raw SQL

These are handled by a **separate seed script** and a **manual SQL extension** described
in §4.6 below.

### 4.4 SQL migration preview — `0001_rp_foundation.sql`

This is what the reviewed, approved migration should contain. Compare against the
Drizzle-generated file before applying.

```sql
-- ============================================================
-- Nemoverse RP Foundation — migration preview v1.2
-- DO NOT APPLY until explicitly approved.
-- ============================================================

-- 1. rp_factions (must precede rp_players)
CREATE TABLE rp_factions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT        UNIQUE NOT NULL,
  name       TEXT        NOT NULL,
  type       TEXT        NOT NULL,
  color      TEXT        NOT NULL DEFAULT '#ffffff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. rp_players
CREATE TABLE rp_players (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token             TEXT        UNIQUE NOT NULL,
  username          TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  driver_license_at TIMESTAMPTZ,
  weapon_license_at TIMESTAMPTZ,
  jail_until        TIMESTAMPTZ,
  jail_reason       TEXT,
  faction_id        UUID        REFERENCES rp_factions(id) ON DELETE SET NULL,
  faction_rank      SMALLINT    NOT NULL DEFAULT 0,
  current_job       TEXT,
  on_duty           BOOLEAN     NOT NULL DEFAULT false,
  last_paycheck_at  TIMESTAMPTZ
);
CREATE INDEX idx_rp_players_token   ON rp_players(token);
CREATE INDEX idx_rp_players_faction ON rp_players(faction_id);

-- 3. rp_wallets
CREATE TABLE rp_wallets (
  player_id  UUID        PRIMARY KEY REFERENCES rp_players(id) ON DELETE CASCADE,
  cash       INTEGER     NOT NULL DEFAULT 500,
  bank       INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rp_wallets_cash_nonneg CHECK (cash >= 0),
  CONSTRAINT rp_wallets_bank_nonneg CHECK (bank >= 0)
);

-- 4. rp_transaction_log
CREATE TABLE rp_transaction_log (
  id           BIGSERIAL   PRIMARY KEY,
  player_id    UUID        NOT NULL REFERENCES rp_players(id) ON DELETE CASCADE,
  kind         TEXT        NOT NULL,
  cash_delta   INTEGER     NOT NULL DEFAULT 0,
  bank_delta   INTEGER     NOT NULL DEFAULT 0,
  cash_after   INTEGER     NOT NULL,
  bank_after   INTEGER     NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rp_tx_player_time ON rp_transaction_log(player_id, created_at DESC);

-- 5. rp_owned_vehicles
CREATE TABLE rp_owned_vehicles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID        NOT NULL REFERENCES rp_players(id) ON DELETE CASCADE,
  model          TEXT        NOT NULL,
  variant        TEXT        NOT NULL,
  color          TEXT        NOT NULL DEFAULT '#aabbcc',
  plate          TEXT        UNIQUE NOT NULL,
  locked         BOOLEAN     NOT NULL DEFAULT true,
  fuel           SMALLINT    NOT NULL DEFAULT 100,
  purchased_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_driven_at TIMESTAMPTZ
);
CREATE INDEX idx_rp_vehicles_owner ON rp_owned_vehicles(owner_id);

-- 6. rp_warrants
CREATE TABLE rp_warrants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID        NOT NULL REFERENCES rp_players(id) ON DELETE CASCADE,
  reason     TEXT        NOT NULL,
  stars      SMALLINT    NOT NULL DEFAULT 1,
  issued_by  UUID        REFERENCES rp_players(id) ON DELETE SET NULL,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at TIMESTAMPTZ,
  CONSTRAINT rp_warrants_stars_range CHECK (stars BETWEEN 1 AND 5)
);
-- Partial index: only active (uncleared) warrants need fast lookup
CREATE INDEX idx_rp_warrants_active
  ON rp_warrants(player_id)
  WHERE cleared_at IS NULL;

-- 7. rp_arrests
CREATE TABLE rp_arrests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID        NOT NULL REFERENCES rp_players(id) ON DELETE CASCADE,
  arrested_by    UUID        REFERENCES rp_players(id) ON DELETE SET NULL,
  reason         TEXT        NOT NULL,
  sentence_secs  INTEGER     NOT NULL,
  fine           INTEGER     NOT NULL DEFAULT 0,
  arrested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at    TIMESTAMPTZ
);
CREATE INDEX idx_rp_arrests_player ON rp_arrests(player_id, arrested_at DESC);

-- 8. rp_jobs (static reference — seed rows are in the seed script, not here)
CREATE TABLE rp_jobs (
  slug           TEXT     PRIMARY KEY,
  name           TEXT     NOT NULL,
  start_building TEXT     NOT NULL,
  pay_per_route  INTEGER  NOT NULL,
  cooldown_secs  INTEGER  NOT NULL DEFAULT 300,
  max_on_duty    SMALLINT NOT NULL DEFAULT 8
);
```

### 4.5 Drizzle TypeScript definitions (`lib/db/src/schema/rp.ts`)

The TypeScript now includes `check()` and `index()` calls so that `drizzle-kit generate`
produces DDL that closely matches the preview above.

```ts
import {
  pgTable, uuid, text, timestamp, boolean, smallint,
  integer, bigserial,
} from "drizzle-orm/pg-core";
import { index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── 1. rp_factions ────────────────────────────────────────────
// Declared first — rp_players has a FK to this table.
export const rpFactions = pgTable("rp_factions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  slug:      text("slug").unique().notNull(),
  name:      text("name").notNull(),
  type:      text("type").notNull(),
  color:     text("color").notNull().default("#ffffff"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 2. rp_players ─────────────────────────────────────────────
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

// ── 3. rp_wallets ─────────────────────────────────────────────
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

// ── 4. rp_transaction_log ─────────────────────────────────────
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

// ── 5. rp_owned_vehicles ──────────────────────────────────────
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

// ── 6. rp_warrants ────────────────────────────────────────────
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
    // NOTE: The partial index (WHERE cleared_at IS NULL) cannot be expressed as a
    // type-safe Drizzle index() call in most Drizzle versions. Add it manually to the
    // generated migration file before applying:
    //   CREATE INDEX idx_rp_warrants_active ON rp_warrants(player_id)
    //   WHERE cleared_at IS NULL;
    index("idx_rp_warrants_player").on(t.playerId),
  ],
);

// ── 7. rp_arrests ─────────────────────────────────────────────
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

// ── 8. rp_jobs (static reference table) ──────────────────────
// Seed rows are NOT inserted here — see §4.6 seed script.
export const rpJobs = pgTable("rp_jobs", {
  slug:          text("slug").primaryKey(),
  name:          text("name").notNull(),
  startBuilding: text("start_building").notNull(),
  payPerRoute:   integer("pay_per_route").notNull(),
  cooldownSecs:  integer("cooldown_secs").notNull().default(300),
  maxOnDuty:     smallint("max_on_duty").notNull().default(8),
});
```

### 4.6 Seed data strategy

`drizzle-kit generate` produces **DDL only**. It never generates `INSERT` statements.
Seed rows for `rp_factions` and `rp_jobs` must be handled separately.

**Option A — Seed script (recommended):**
Create `lib/db/src/seed/rpSeed.ts`, run once after migration:

```ts
// lib/db/src/seed/rpSeed.ts
import { db } from "../index";
import { rpFactions, rpJobs } from "../schema/rp";

await db.insert(rpFactions).values([
  { slug: "police",     name: "Nemoverse Police Department", type: "police",     color: "#3060ff" },
  { slug: "medic",      name: "Nemoverse Medical Service",   type: "medic",      color: "#ff4444" },
  { slug: "government", name: "City Government",             type: "government", color: "#d4aa00" },
]).onConflictDoNothing();

await db.insert(rpJobs).values([
  { slug: "taxi",     name: "Taxi Driver",     startBuilding: "taxi_depot",     payPerRoute: 120, cooldownSecs: 60,  maxOnDuty: 8  },
  { slug: "delivery", name: "Delivery Driver", startBuilding: "delivery_hub",   payPerRoute: 150, cooldownSecs: 90,  maxOnDuty: 6  },
  { slug: "mechanic", name: "Mechanic",        startBuilding: "auto_shop",      payPerRoute: 180, cooldownSecs: 120, maxOnDuty: 4  },
  { slug: "medic",    name: "Paramedic",       startBuilding: "medical_center", payPerRoute: 200, cooldownSecs: 180, maxOnDuty: 4  },
  { slug: "citywork", name: "City Worker",     startBuilding: "city_hall",      payPerRoute: 100, cooldownSecs: 60,  maxOnDuty: 10 },
]).onConflictDoNothing();
```

Run with: `cd lib/db && pnpm tsx src/seed/rpSeed.ts`

**Option B — Append to migration file manually:**
After `drizzle-kit generate`, open `0001_rp_foundation.sql` and append the `INSERT`
statements from the SQL preview. Mark the file as manually edited so Drizzle doesn't
overwrite it on the next generate run.

**Partial index — manual addition:**
After reviewing the generated file, manually insert before the final line:
```sql
CREATE INDEX idx_rp_warrants_active
  ON rp_warrants(player_id)
  WHERE cleared_at IS NULL;
```
Then delete the plain `idx_rp_warrants_player` index Drizzle generated.

---

## 5. Phase 2 — Central Spawn

### 5.1 Rule (Phase 1 only)
**All players always spawn at Nemoverse Central Station.** No saved-position restore.
Rejoining, respawning, and first-joining all use the same spawn. Last-position
persistence is deferred until property/housing is designed.

### 5.2 Why v1.1 station spawn was wrong

`STATION_SPAWN = [18, 1, -65]` from v1.1 falls inside downtown building block
`(22.5, -65, 15m wide, 30m deep)` which spans `x ∈ [15, 30]`, `z ∈ [−80, −50]`.
`x=18` is at the middle of this block. Players would spawn inside or pressed against
generated downtown buildings.

### 5.3 Corrected station spawn — Central Loop Station exterior

The real **central-loop-station** is at `cx=110, cz=−65`, deck at `y=12`, stair
foot at `x=122, z=−65`. Ground-level exterior east of the stair foot is completely
clear: no building blocks, no parked cars in the vicinity, no road carriageways.

```ts
// Platform deck: x ∈ [106, 114], z ∈ [−75, −55] at y=12
// Stair foot:    x=122, z=−65

export const STATION_MARKER_POS:   [number, number, number] = [128, 0,  -65];
export const STATION_SPAWN:        [number, number, number] = [128, 1,  -65];
export const STATION_SPAWN_JITTER_X = 4;   // ±4m — range x ∈ [124, 132]
export const STATION_SPAWN_JITTER_Z = 3;   // ±3m — range z ∈ [−68, −62]
```

### 5.4 Station spawn full validation table

Road carriageways: N-S at `x = −45, 0, 45` (half-width 10); E-W at `z = −45, 0, 45`
(half-width 10).

| Check | Calculation | Result |
|-------|------------|--------|
| Clear of x=0 road | `\|128 − 0\| = 128 ≥ 10` | ✅ |
| Clear of x=45 road | `\|128 − 45\| = 83 ≥ 10` | ✅ |
| Clear of x=−45 road | `\|128 − (−45)\| = 173 ≥ 10` | ✅ |
| Clear of z=−45 road | `\|−65 − (−45)\| = 20 ≥ 10` | ✅ |
| Clear of z=0 road | `\|−65 − 0\| = 65 ≥ 10` | ✅ |
| Clear of z=45 road | `\|−65 − 45\| = 110 ≥ 10` | ✅ |
| Outside station deck | x=128 > deck-east edge 114 | ✅ |
| Outside NE building block | NE block: x∈[50,80]. 128 > 80 | ✅ |
| No building block at x>80 north row | Blocks: NW(−65), N-split(±22.5), NE(65) — none at x>80 | ✅ |
| Nearest parked car: car-12 at (41, −70) | dist = √((128−41)²+(−65+70)²) = 87.6m | ✅ |
| Jitter worst-case x=124 clears deck east edge 114 | 124 > 114 by 10m | ✅ |
| Jitter worst-case z=−62: clear of z=−45 road | `\|−62 − (−45)\| = 17 ≥ 10` | ✅ |
| Jitter worst-case z=−68: clear of z=−45 road | `\|−68 − (−45)\| = 23 ≥ 10` | ✅ |

All checks pass including every worst-case jitter position.

### 5.5 Station marker description

A ground-level platform at `[128, 0, −65]` (12m × 8m flat slab, y=0.05) with:
- A glowing sign band (emissive mesh) at the west end facing the stair: "CENTRAL STATION"
- A canopy overhang mesh (thin box, 4m tall) to visually anchor the landmark
- A minimap floor ring (r=10) tinted with station color so the location is obvious

The marker sits to the east of the staircase and does not obscure the stair ramp or
the elevated deck above it.

---

## 6. Phase 3 — Driver License Gate

### 6.1 Why v1.1 Licensing Office was wrong

`LICENSING_OFFICE_POS = [24, 0, −22]` was only **2m** from parked `car-0` at
`(22, 0.6, −22)`. The interaction area (6m radius) and the office marker geometry would
visually overlap the parked sedan and block the entrance.

### 6.2 Corrected Licensing Office location

```ts
export const LICENSING_OFFICE_POS: [number, number, number] = [14, 0, -30];
```

Position `[14, 0, −30]` is in the SE inner block, on the east-facing sidewalk of the
central N-S road (`x=0`), two blocks south of the central intersection.

### 6.3 Licensing Office full validation table

| Check | Calculation | Result |
|-------|------------|--------|
| Clear of x=0 road | `\|14 − 0\| = 14 ≥ 10` | ✅ |
| Clear of x=45 road | `\|14 − 45\| = 31 ≥ 10` | ✅ |
| Clear of x=−45 road | `\|14 − (−45)\| = 59 ≥ 10` | ✅ |
| Clear of z=−45 road | `\|−30 − (−45)\| = 15 ≥ 10` | ✅ |
| Clear of z=0 road | `\|−30 − 0\| = 30 ≥ 10` | ✅ |
| Clear of z=45 road | `\|−30 − 45\| = 75 ≥ 10` | ✅ |
| Distance from car-0 at (22, −22) | √((14−22)²+(−30+22)²) = √(64+64) = **11.3m** ≥ 8m | ✅ |
| Distance from car-3 at (−22, −22) | √((14+22)²+(−30+22)²) = √(1296+64) = **36.9m** ≥ 8m | ✅ |
| Distance from car-10 at (35, −35) | √((14−35)²+(−30+35)²) = √(441+25) = **21.6m** ≥ 8m | ✅ |
| No N-split building block at this z | N-split blocks are at z∈[−80,−50]. z=−30 is outside | ✅ |
| No inner-city building block | All city blocks have cx=±65 — none at x=14 | ✅ |
| Static obstacle clearance | Run `validateRpMarkers()` at startup (see §12.3) | To confirm |

The static obstacle clearance must also pass `validateRpMarkers()` at server startup
(§12.3). If any procedurally generated obstacle is within 1m of this position, the
server will throw and the position must be adjusted.

### 6.4 Test vehicle spawn

```ts
export const TEST_VEHICLE_SPAWN: [number, number, number] = [11, 0.6, -30];
// x=11: just outside the central road edge (|11−0|=11 > 10), on the
//        east sidewalk — the test car pulls out directly onto x=0 road.
// z=−30: 15m north of z=−45 road, no obstructions.
```

| Check | Result |
|-------|--------|
| Off road carriageway: `\|11−0\|=11 ≥ 10` | ✅ |
| 3m from Licensing Office (14, −30) | ✅ close enough for walk-up |
| Distance from car-0 (22, −22): √((11−22)²+(−30+22)²) = 13.6m | ✅ |

### 6.5 Interaction event flow — single entry point

```
Player walks within 6m of LICENSING_OFFICE_POS
  Server (on playerUpdate proximity check) emits:
  → rp:prompt { building:"licensing_office",
                options:[{ action:"start_driver_test", label:"Start Driver Test ($200)" }] }

Player selects option
  Client emits: rp:interact { building:"licensing_office", action:"start_driver_test" }

Server validates (no client trust):
  ① Player within 6m of LICENSING_OFFICE_POS?
  ② rp.cash >= TEST_FEE (200)?
  ③ rp.driverLicense === false?
  ④ No active testState for this socket?
  → any fail: rp:toast, return

  All pass:
  ⑤ walletTransfer({ cashDelta: −200, kind:"license_fee" })
  ⑥ Spawn test vehicle at TEST_VEHICLE_SPAWN, assign to server vehicles Map
  ⑦ rpTestState.set(socket.id, { vehicleId, nextCp:0, startedAt:now, lastCpAt:now })
  ⑧ rp:licenseTestActive { vehicleId, checkpoints:LICENSE_TEST_CHECKPOINTS }
```

No separate `rp:licenseTestStart` event — `rp:interact` is the sole entry point for
all building interactions.

### 6.6 Test vehicle exception — unlicensed driving

```ts
// Server-side — in vehicleUpdate handler:
function canDriveVehicle(socketId: string, vehicleId: string): boolean {
  const rp        = rpCache.get(socketId);
  const testState = rpTestState.get(socketId);
  if (rp?.driverLicense)                             return true;  // licensed
  if (testState && testState.vehicleId === vehicleId) return true;  // active test vehicle only
  return false;
}

// Client-side — optimistic gate before enterVehicle():
function canDriveVehicleClient(vehicleId: string, rp: RpProfile): boolean {
  if (rp.driverLicense)                              return true;
  if (rp.activeTest?.vehicleId === vehicleId)        return true;
  return false;
}
```

Only the exact `testState.vehicleId` is exempt. All other world vehicles remain blocked
for unlicensed players regardless of how the socket payload is crafted.

### 6.7 Checkpoint validation — no animState

`animState` is client-controlled and must never be used for server validation.
The server validates using its own authoritative state only:

1. `rpTestState.get(socket.id)` exists
2. `idx === testState.nextCp` (correct order)
3. `vehicles.get(testVehicleId).driverId === socket.id` (player is driving it)
4. Euclidean distance from server vehicle position to checkpoint ≤ 8m
5. Time since last checkpoint: 3s ≤ elapsed ≤ 120s

### 6.8 Updated checkpoint route

Route from new test vehicle spawn at `[11, 0.6, −30]`: south on central road →
east at the south intersection → north on east road → return to office.

```ts
export const TEST_FEE = 200;

export const LICENSE_TEST_CHECKPOINTS: [number, number, number][] = [
  [  2,  0.5, -40],  // CP0 — south on x=0 road, approaching z=−45 intersection
  [ 42,  0.5, -44],  // CP1 — east on z=−45 road, at x=45 intersection
  [ 42,  0.5, -14],  // CP2 — north on x=45 road, mid-block
  [ 14,  0.5, -26],  // CP3 — finish line near Licensing Office entrance
];
```

Checkpoint validator confirmation:

| CP | x | z | Validation |
|----|---|---|-----------|
| CP0 | 2 | −40 | x=2: `\|2−0\|=2 < 10` ✅ on x=0 road; z=−40: `\|−40−(−45)\|=5 < 10` ✅ near z=−45 intersection |
| CP1 | 42 | −44 | x=42: `\|42−45\|=3 < 10` ✅ on x=45 road; z=−44: `\|−44−(−45)\|=1 < 10` ✅ at z=−45 intersection |
| CP2 | 42 | −14 | x=42: `\|42−45\|=3 < 10` ✅ on x=45 road; z=−14 clear of all EW roads ✅ mid-block |
| CP3 | 14 | −26 | Off-road finish marker at Licensing Office — intentionally off road ✅ |

Route narrative: pull out of sidewalk onto x=0 road → drive south to the south
intersection → turn right (east) → turn right (north) on x=45 road → return to the
office finish line. Clean triangular circuit on real city roads.

### 6.9 Test failure conditions

| Condition | Detection | Outcome |
|-----------|-----------|---------|
| CP timeout (>120s between checkpoints) | Server timing check on each checkpoint | Test cleared, no refund |
| Player exits test vehicle | `vehicleUpdate` with `driverId:null` for testVehicleId | Test cleared, no refund |
| Player drives >80m from route AABB | Server distance check on `playerUpdate` | Test cleared, no refund |
| Server restart | `rpTestState` is in-memory only — lost | Player retries; fee already deducted |

---

## 7. Phase 4 — Money System

### 7.1 HUD additions

```ts
// New props on HUD.tsx:
cash:          number;   // server-authoritative
bank:          number;   // server-authoritative
driverLicense: boolean;
```

Visual layout — bottom-right, above speed gauge:
```
💵 $1,240
🏦 $3,500
🪪 Licensed    ← green badge; absent when false
```

### 7.2 Starting money
`cash: 500`, `bank: 0` from `rp_wallets` column defaults. New-player toast on first
join: `"Welcome to Nemoverse! You have $500 cash."`

### 7.3 Wallet transfer API

```ts
interface WalletTransferInput {
  playerId:   string;
  cashDelta?: number;   // negative = deduct, positive = add
  bankDelta?: number;
  kind:       TransactionKind;
  note?:      string;
}

async function walletTransfer(
  input: WalletTransferInput,
): Promise<{ cash: number; bank: number }> {
  const { playerId, cashDelta = 0, bankDelta = 0, kind, note } = input;

  return await db.transaction(async (tx) => {
    // Row-lock prevents concurrent transfers from double-spending.
    const [wallet] = await tx
      .select().from(rpWallets)
      .where(eq(rpWallets.playerId, playerId))
      .for("update");

    if (!wallet) throw new Error(`No wallet for ${playerId}`);

    const newCash = wallet.cash + cashDelta;
    const newBank = wallet.bank + bankDelta;

    // Application check — descriptive error before hitting DB constraint.
    if (newCash < 0) throw new RpError("insufficient_cash",
      `Need $${-cashDelta}, have $${wallet.cash}`);
    if (newBank < 0) throw new RpError("insufficient_bank",
      `Need $${-bankDelta}, have $${wallet.bank}`);

    await tx.update(rpWallets)
      .set({ cash: newCash, bank: newBank, updatedAt: new Date() })
      .where(eq(rpWallets.playerId, playerId));

    await tx.insert(rpTransactionLog).values({
      playerId, kind, cashDelta, bankDelta,
      cashAfter: newCash, bankAfter: newBank, note,
    });

    return { cash: newCash, bank: newBank };
  });
}
```

### 7.4 Transaction kinds

| kind | cashDelta | bankDelta | Trigger |
|------|-----------|-----------|---------|
| `license_fee` | −200 | 0 | Starting driver test |
| `vehicle_purchase` | −price | 0 | Buying vehicle |
| `job_pay` | +amount | 0 | Completing job route |
| `fine` | −amount | 0 | Police fine |
| `bank_deposit` | −amount | +amount | ATM deposit |
| `bank_withdraw` | +amount | −amount | ATM withdrawal |
| `salary` | +amount | 0 | Faction duty-time pay |
| `admin_grant` | ±amount | ±amount | Admin command |

---

## 8. Phase 5 — RP Jobs *(Deferred)*

Each job has a handler in `artifacts/api-server/src/rp/jobs/`. Anti-farm validation:
`last_paycheck_at` cooldown enforced in DB; checkpoints timestamped server-side;
`on_duty` must stay true throughout; player must remain within route AABB.

---

## 9. Phase 6 — Police & Arrest *(Deferred)*

Police station at `[−44, 0, 0]`. Arrest requires officer on-duty + within 3m + active
warrant on target. Jail time in `rp_players.jail_until`; position confinement enforced
on every `playerUpdate`. Salary = duty time, never arrest count.

---

## 10. Phase 7 — Gangs & Factions *(Deferred)*

Generic faction system: `rp_factions` + `rp_players.faction_id/faction_rank`.
Faction chat routed server-side by matching `faction_id`. Territory capture deferred.

---

## 11. Phase 8 — Mayor & Government *(Deferred)*

Mayor = `faction.slug === "government"` + `faction_rank >= 4`. Powers: city
announcement, tax rate (0–15%), business licence approvals. `rp_city_config` table.

---

## 12. Validators

All validators live in `artifacts/api-server/src/rp/rpValidators.ts` and run as
**startup assertions** before any socket connections are accepted.

### 12.1 Road carriageway clearance (buildings/spawns must be OFF roads)

```ts
const NS_ROADS_X = [-45, 0, 45] as const;
const EW_ROADS_Z = [-45, 0, 45] as const;
const ROAD_HALF  = 10;

export function isInCarriageway(x: number, z: number): boolean {
  for (const rx of NS_ROADS_X) if (Math.abs(x - rx) < ROAD_HALF) return true;
  for (const rz of EW_ROADS_Z) if (Math.abs(z - rz) < ROAD_HALF) return true;
  return false;
}
```

### 12.2 On-road validator (checkpoints must be ON roads)

```ts
export function isOnRoad(x: number, z: number): boolean {
  return isInCarriageway(x, z);
}
// CP3 is intentionally off-road — not validated here.
```

### 12.3 Static obstacle clearance

```ts
export function isInsideObstacle(
  x: number, z: number,
  obstacles: StaticObstacle[],
  margin = 1,
): boolean {
  for (const o of obstacles) {
    if (Math.abs(x - o.x) < o.w / 2 + margin &&
        Math.abs(z - o.z) < o.d / 2 + margin) return true;
  }
  return false;
}

export function validateRpMarkers(obstacles: StaticObstacle[]): void {
  const OFF_ROAD_MARKERS = [
    { label: "STATION_SPAWN",        x: 128, z: -65 },
    { label: "LICENSING_OFFICE_POS", x:  14, z: -30 },
    { label: "TEST_VEHICLE_SPAWN",   x:  11, z: -30 },
    { label: "CP3_FINISH",           x:  14, z: -26 },
  ];
  const ON_ROAD_CHECKPOINTS = [
    { label: "CP0", x:  2, z: -40 },
    { label: "CP1", x: 42, z: -44 },
    { label: "CP2", x: 42, z: -14 },
  ];

  for (const m of OFF_ROAD_MARKERS) {
    if (isInCarriageway(m.x, m.z))
      throw new Error(`[rp] marker "${m.label}" is inside road carriageway`);
    if (isInsideObstacle(m.x, m.z, obstacles))
      throw new Error(`[rp] marker "${m.label}" overlaps static obstacle`);
    console.log(`[rp] marker OK: ${m.label} [${m.x}, ${m.z}]`);
  }

  for (const cp of ON_ROAD_CHECKPOINTS) {
    if (!isOnRoad(cp.x, cp.z))
      throw new Error(`[rp] checkpoint "${cp.label}" is NOT on a road`);
    if (isInsideObstacle(cp.x, cp.z, obstacles))
      throw new Error(`[rp] checkpoint "${cp.label}" overlaps static obstacle`);
    console.log(`[rp] checkpoint OK: ${cp.label} [${cp.x}, ${cp.z}]`);
  }
}
```

### 12.4 Parked-car clearance for RP markers

```ts
export function isNearParkedCar(
  x: number, z: number,
  vehicles: VehicleState[],
  minClearance = 8,
): boolean {
  for (const v of vehicles) {
    const dx = x - v.x;
    const dz = z - v.z;
    if (Math.sqrt(dx * dx + dz * dz) < minClearance) return true;
  }
  return false;
}

// Called at startup with the initial vehicles array from cityData:
export function validateRpMarkerVehicleClearance(
  vehicles: VehicleState[],
): void {
  const markers = [
    { label: "LICENSING_OFFICE_POS", x:  14, z: -30 },
    { label: "TEST_VEHICLE_SPAWN",   x:  11, z: -30 },
    { label: "STATION_SPAWN",        x: 128, z: -65 },
  ];
  for (const m of markers) {
    if (isNearParkedCar(m.x, m.z, vehicles)) {
      throw new Error(`[rp] marker "${m.label}" is within 8m of a parked vehicle`);
    }
    console.log(`[rp] vehicle clearance OK: ${m.label}`);
  }
}
```

### 12.5 Jitter spawn safety

```ts
export function safeStationSpawn(obstacles: StaticObstacle[]): [number, number, number] {
  for (let attempt = 0; attempt < 10; attempt++) {
    const jx = (Math.random() * 2 - 1) * STATION_SPAWN_JITTER_X;
    const jz = (Math.random() * 2 - 1) * STATION_SPAWN_JITTER_Z;
    const x  = STATION_SPAWN[0] + jx;
    const z  = STATION_SPAWN[2] + jz;
    if (!isInCarriageway(x, z) && !isInsideObstacle(x, z, obstacles)) {
      return [x, STATION_SPAWN[1], z];
    }
  }
  return [...STATION_SPAWN]; // fallback to exact centre
}
```

### 12.6 License check helpers

```ts
// Server:
export function canDriveVehicle(
  socketId: string,
  vehicleId: string,
  rpCache: Map<string, RpCacheEntry>,
  rpTestState: Map<string, TestState>,
): boolean {
  const rp   = rpCache.get(socketId);
  const test = rpTestState.get(socketId);
  if (rp?.driverLicense)                      return true;
  if (test && test.vehicleId === vehicleId)   return true;
  return false;
}

// Client (optimistic):
export function canDriveVehicleClient(vehicleId: string, rp: RpProfile): boolean {
  if (rp.driverLicense)                       return true;
  if (rp.activeTest?.vehicleId === vehicleId) return true;
  return false;
}
```

---

## 13. Socket Event Catalog

### Client → Server

| Event | Payload | Server validates |
|-------|---------|-----------------|
| `join` | `{ username, token }` | Token upsert; emit `rp:profile` |
| `rp:interact` | `{ building, action }` | Player within 6m; action valid; action-specific gates |
| `rp:bankDeposit` | `{ amount }` | Within 6m ATM; cash ≥ amount |
| `rp:bankWithdraw` | `{ amount }` | Within 6m ATM; bank ≥ amount |
| `rp:jobDuty` | `{ job, on }` | Player in correct building; faction match; cooldown |
| `rp:jobCheckpoint` | `{ idx }` | Proximity, order, timing, on-duty |
| `rp:issueWarrant` | `{ targetId, reason, stars }` | Police on-duty; within 12m |
| `rp:arrest` | `{ targetId }` | Police on-duty; within 3m; active warrant |
| `rp:factionChat` | `{ msg }` | Player is faction member |
| `rp:announce` | `{ msg }` | Mayor rank verified server-side |

`rp:licenseTestStart` does **not exist** — subsumed by `rp:interact`.

### Server → Client

| Event | Payload | When |
|-------|---------|------|
| `rp:profile` | Full `RpProfile` | On join |
| `rp:profileUpdate` | Partial `RpProfile` | After any state change |
| `rp:toast` | `{ msg, color, duration? }` | Feedback |
| `rp:prompt` | `{ building, options[] }` | Player near interactive building |
| `rp:promptHide` | — | Player walks away |
| `rp:licenseTestActive` | `{ vehicleId, checkpoints[] }` | Test started |
| `rp:licenseTestResult` | `{ passed, reason? }` | Test ended |
| `rp:wantedUpdate` | `{ playerId, stars }` | Warrant issued/cleared |
| `rp:jailStatus` | `{ releaseAt }` | On arrest |
| `rp:jailCountdown` | `{ secondsLeft }` | Every 10s while jailed |
| `rp:factionChat` | `{ fromId, username, msg }` | Faction members only |
| `rp:cityAnnounce` | `{ msg }` | All clients |

### Shared `RpProfile` type

```ts
// artifacts/city-sandbox/src/shared/rpTypes.ts

export interface ActiveTest {
  vehicleId:   string;
  checkpoints: [number, number, number][];
  nextCp:      number;
}

export interface RpProfile {
  playerId:      string;
  cash:          number;
  bank:          number;
  driverLicense: boolean;
  weaponLicense: boolean;
  jailUntil:     number | null;   // Unix ms; null = free
  factionId:     string | null;
  factionSlug:   string | null;
  factionRank:   number;
  currentJob:    string | null;
  onDuty:        boolean;
  wantedStars:   number;
  activeTest:    ActiveTest | null;
}
```

---

## 14. Anti-Cheat & Server Authority Rules

| Vector | Rule |
|--------|------|
| Fake license | `canDriveVehicle()` on server; client badge is display-only |
| Test-vehicle bypass | Only exact `testState.vehicleId` exempt; all others blocked |
| animState spoofing | Not used anywhere in test validation; server uses `vehicle.driverId` |
| Fake money | Client sends intent only; server reads payout from `rp_jobs` seed table |
| Double spend | `walletTransfer` uses DB row lock (`SELECT … FOR UPDATE`) |
| Duplicate checkpoint | `nextCp` advances only after full validation; replayed packets ignored |
| Fake checkpoint proximity | Server uses `vehicles.get(testVehicleId).{x,z}`, not client coordinates |
| Duplicate job payout | `last_paycheck_at` written to DB before emit |
| Jail escape | Server re-enforces jail AABB on every `playerUpdate` while jailed |
| Vehicle ownership spoof | `rp_owned_vehicles.owner_id` checked server-side |
| Negative cash exploit | Application check in `walletTransfer` + DB `CHECK` constraint as backup |
| Token theft | Token never broadcast to other sockets; server-only after join |
| Marker injection | `validateRpMarkers()` throws at startup if any position is invalid |

---

## 15. File Change Map

### New files

| File | Purpose |
|------|---------|
| `lib/db/src/schema/rp.ts` | Drizzle table definitions with `check()` + `index()` |
| `lib/db/src/seed/rpSeed.ts` | Seed script for `rp_factions` + `rp_jobs` |
| `artifacts/api-server/src/rp/rpTypes.ts` | Server-side RP types + coordinate constants |
| `artifacts/api-server/src/rp/rpValidators.ts` | Startup marker + spawn validators |
| `artifacts/api-server/src/rp/rpCache.ts` | In-memory `Map<socketId, RpCacheEntry>` |
| `artifacts/api-server/src/rp/rpPlayerService.ts` | DB CRUD: player upsert/load |
| `artifacts/api-server/src/rp/rpWalletService.ts` | `walletTransfer()` with row lock |
| `artifacts/api-server/src/rp/rpLicenseService.ts` | Test state machine |
| `artifacts/api-server/src/rp/rpVehicleService.ts` | Owned vehicle management |
| `artifacts/api-server/src/rp/rpFactionService.ts` | Faction membership + chat routing |
| `artifacts/api-server/src/rp/rpPoliceService.ts` | Arrest, warrant, jail |
| `artifacts/api-server/src/rp/rpJobService.ts` | Job duty, checkpoints, payout |
| `artifacts/api-server/src/rp/jobs/taxi.ts` | Taxi job handler |
| `artifacts/api-server/src/rp/jobs/delivery.ts` | Delivery job handler |
| `artifacts/api-server/src/rp/jobs/mechanic.ts` | Mechanic job handler |
| `artifacts/api-server/src/rp/jobs/medic.ts` | Medic job handler |
| `artifacts/api-server/src/rp/jobs/citywork.ts` | City worker job handler |
| `artifacts/api-server/src/rp/setupRpHandlers.ts` | Registers all `rp:*` events |
| `artifacts/city-sandbox/src/shared/rpTypes.ts` | `RpProfile` + constants |
| `artifacts/city-sandbox/src/hooks/useRpSocket.ts` | `rp:*` event listeners + React state |
| `artifacts/city-sandbox/src/game/RPMarkers.tsx` | Station platform, Licensing Office |
| `artifacts/city-sandbox/src/game/RPHud.tsx` | Cash/bank/license HUD + toast stack |
| `artifacts/city-sandbox/src/game/LicenseTestHUD.tsx` | Test overlay + checkpoint dots |

### Modified files

| File | Change |
|------|--------|
| `lib/db/src/schema/index.ts` | Re-export from `rp.ts` |
| `artifacts/api-server/src/socket/gameServer.ts` | License gate; call `setupRpHandlers`; run validators at startup |
| `artifacts/api-server/src/socket/cityData.ts` | Replace spawn array with `STATION_SPAWN` + jitter constants |
| `artifacts/city-sandbox/src/hooks/useSocket.ts` | Send `token` with `join`; hand off `rp:profile` to `useRpSocket` |
| `artifacts/city-sandbox/src/game/LocalPlayer.tsx` | `canDriveVehicleClient()` check before `enterVehicle()` |
| `artifacts/city-sandbox/src/game/GameScene.tsx` | Mount `<RPMarkers>`, `<RPHud>`, `<LicenseTestHUD>` |
| `artifacts/city-sandbox/src/game/HUD.tsx` | Add `cash`, `bank`, `driverLicense` props |

---

## 16. Implementation Order

### Phase 1 — Minimal RP Core (Session 1)

```
Step 1  — lib/db/src/schema/rp.ts                (Drizzle schema, factions first,
                                                   with check() + index())
Step 2  — lib/db/src/schema/index.ts             (re-export rp.ts)
Step 3  — lib/db/src/seed/rpSeed.ts              (seed script, do NOT run yet)
Step 4  — Run: cd lib/db && pnpm drizzle-kit generate
           Review output vs §4.4 preview
           Manually add partial index for rp_warrants
           Do NOT push yet
Step 5  — artifacts/city-sandbox/src/shared/rpTypes.ts   (RpProfile, constants)
Step 6  — artifacts/api-server/src/rp/rpValidators.ts    (all validators)
Step 7  — artifacts/api-server/src/rp/rpCache.ts
Step 8  — artifacts/api-server/src/rp/rpPlayerService.ts
Step 9  — artifacts/api-server/src/rp/rpWalletService.ts (walletTransfer)
Step 10 — artifacts/api-server/src/socket/cityData.ts    (STATION_SPAWN constants)
Step 11 — artifacts/api-server/src/socket/gameServer.ts  (token on join, license
                                                           gate, validateRpMarkers)
Step 12 — artifacts/api-server/src/rp/setupRpHandlers.ts (rp:interact stub,
                                                           rp:profile emit)
Step 13 — artifacts/city-sandbox/src/hooks/useSocket.ts  (send token, rp:profile)
Step 14 — artifacts/city-sandbox/src/hooks/useRpSocket.ts
Step 15 — artifacts/city-sandbox/src/game/RPMarkers.tsx  (station marker only)
Step 16 — artifacts/city-sandbox/src/game/RPHud.tsx      (cash/bank/license)
Step 17 — artifacts/city-sandbox/src/game/LocalPlayer.tsx (license gate)
Step 18 — artifacts/city-sandbox/src/game/GameScene.tsx  (mount new components)
Step 19 — artifacts/city-sandbox/src/game/HUD.tsx        (pass new props)
Step 20 — pnpm run typecheck + build verification
```

### Phase 2 — License Test (Session 2)
`rpLicenseService.ts` → `LicenseTestHUD.tsx` → extend `setupRpHandlers` → extend
`RPMarkers.tsx` with Licensing Office marker.

### Phases 3–8 (later sessions)
Jobs → Police → Factions → Mayor.

---

## 17. Approval Checklist

- [ ] **DB schema** approved (§4.4–§4.5)
- [ ] **Drizzle `check()` + `index()` syntax** reviewed — matches target Drizzle version
- [ ] **Seed strategy** approved: separate seed script (`rpSeed.ts`) + manual partial index
- [ ] **Migration**: `drizzle-kit generate` only; manual SQL review + partial index addition before push
- [ ] **Player identity**: UUID token in localStorage — approved
- [ ] **Station spawn** `[128, 1, −65]` — approved *(east exterior of Central Loop Station)*
- [ ] **Station jitter** ±4m x, ±3m z — approved
- [ ] **Licensing Office** `[14, 0, −30]` — approved *(subject to `validateRpMarkers()` passing)*
- [ ] **Test vehicle spawn** `[11, 0.6, −30]` — approved
- [ ] **License test fee** $200 — approved
- [ ] **Starting cash** $500, bank $0 — approved
- [ ] **Checkpoint route** (§6.8) — approved
- [ ] **Phase 1 minimal scope** confirmed (§3): no test, no jobs, no police, no saved position
- [ ] **`DATABASE_URL`** env var set in `artifacts/api-server` environment
- [ ] **PostgreSQL** instance accessible from api-server at deploy time

---

*Nemoverse RP Foundation — plan v1.2*
