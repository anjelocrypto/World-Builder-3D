# Nemoverse RP Foundation — Implementation Plan v1.1

> **Status:** Revised proposal — pending approval before any code changes.
> **Changes from v1.0:** Licensing Office relocated off-road; spawn always uses Central
> Station (no saved position restore in Phase 1); test vehicle exception for unlicensed
> drivers added; animState removed from test validation; duplicate events removed; Drizzle
> declaration order fixed; SQL migration preview only (no push); wallet transfer API
> redesigned with cashDelta/bankDelta; Phase 1 scope narrowed; validators section added.

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
- A small **in-memory RP state cache** on the server (`socketId → RpCacheEntry`) for
  fast per-event checks (license, cash, faction, active test) without querying the DB
  on every socket packet.
- New socket events with an `rp:` prefix. Each carries **intent only** — the server
  derives the outcome and pushes back authoritative state.
- Client-side UI that renders **server-authoritative state only** — never local guesses
  for money, license, ownership, or arrest status.

### Server authority model (example: license test)
```
Client                               Server
  │                                    │
  │─ rp:interact                       │
  │    { building:"licensing_office",  │  1. Player within 6m of office?
  │      action:"start_driver_test" } ─►  2. cash >= TEST_FEE?
  │                                    │  3. driverLicense === false?
  │                                    │  4. No active test already?
  │◄─ rp:toast { msg:"Insufficient    │     → any check fails: emit toast, return
  │    funds", color:"red" } ──────────│
  │                                    │  All pass:
  │                                    │  5. Deduct TEST_FEE from cash (DB + cache)
  │                                    │  6. Spawn test vehicle, record testState
  │◄─ rp:licenseTestActive ────────────│  7. Emit test data to this socket only
  │    { vehicleId, checkpoints[] }    │
```

---

## 2. Player Identity Strategy

### Problem
Players currently join with `{ username }` only. No auth exists. Without a stable
identifier we cannot persist wallet, license, or vehicle ownership across sessions.

### Proposed solution — Client UUID token
1. On first visit the client generates `crypto.randomUUID()` and stores it in
   `localStorage` under `nemoverse_player_token`.
2. Every `join` event includes: `{ username, token }`.
3. The server **upserts** `rp_players` keyed on `token`. Username is stored and may
   change; the token is the stable identity key.
4. The server **never** sends one player's token to another socket.

### Security posture
- A token in `localStorage` is ownable by whoever controls the machine. That is
  acceptable for a game (no real-world financial risk).
- Upgrade path: replace `token` column with `auth_id` pointing to an OAuth provider —
  no other RP code needs to change.

---

## 3. Phase 1 — Minimal RP Core (First Coding Session)

This is the **only** scope that should be implemented in the first coding session.
Everything else (jobs, police, gangs, bank ATM, mayor, full license test, dealership)
is deferred to later sessions.

### Deliverables

| # | Feature | Server | Client |
|---|---------|--------|--------|
| 1 | Stable player token on join | Upsert `rp_players` row | Generate + store UUID in localStorage |
| 2 | Wallet starting cash/bank | Insert `rp_wallets` (cash=500, bank=0) | — |
| 3 | Server sends `rp:profile` on join | Emit full `RpProfile` to joining socket | Store in React state |
| 4 | Central Station spawn | Override all spawns to STATION_SPAWN | — |
| 5 | Cash/bank display on HUD | — | Two new HUD lines |
| 6 | License flag | Persist `driver_license_at` in DB | Show license badge on HUD |
| 7 | Vehicle entry blocked if no license | Reject `driverId` patch if not licensed | Show toast, skip enterVehicle() |

### Explicitly out of scope for Phase 1
- Saved position restore (always spawn at station)
- License test flow (Office marker, checkpoints, test vehicle)
- Bank deposit/withdraw ATM
- Jobs, factions, police, gangs, mayor
- Vehicle purchasing
- Warrants, arrests, jail

---

## 4. Data Model & DB Schema

### Declaration order — critical for Drizzle
Drizzle generates foreign-key migrations in declaration order. `rp_factions` **must** be
declared and migrated before `rp_players` because `rp_players.faction_id` references it.

```
Declaration order in lib/db/src/schema/rp.ts:
  1. rpFactions
  2. rpPlayers       ← FK → rpFactions
  3. rpWallets       ← FK → rpPlayers
  4. rpTransactionLog← FK → rpPlayers
  5. rpOwnedVehicles ← FK → rpPlayers
  6. rpWarrants      ← FK → rpPlayers × 2
  7. rpArrests       ← FK → rpPlayers × 2
  8. rpJobs          (independent seed table)
```

### Migration strategy
Do **not** run `drizzle-kit push` until explicitly approved. Instead, generate a
reviewed SQL preview file:

```bash
# Command to generate — do NOT run the push variant:
cd lib/db && pnpm drizzle-kit generate
# Outputs: lib/db/drizzle/0001_rp_foundation.sql  ← review this file
```

The SQL preview below is what that migration should produce.

---

### SQL migration preview — `0001_rp_foundation.sql`

```sql
-- ============================================================
-- Nemoverse RP Foundation — migration preview (do not apply
-- until explicitly approved by the project owner).
-- ============================================================

-- 1. Factions (must precede rp_players because of the FK)
CREATE TABLE rp_factions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT        UNIQUE NOT NULL,
  name       TEXT        NOT NULL,
  type       TEXT        NOT NULL,
  color      TEXT        NOT NULL DEFAULT '#ffffff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rp_factions (slug, name, type, color) VALUES
  ('police',     'Nemoverse Police Department', 'police',     '#3060ff'),
  ('medic',      'Nemoverse Medical Service',   'medic',      '#ff4444'),
  ('government', 'City Government',             'government', '#d4aa00');

-- 2. Players
CREATE TABLE rp_players (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token             TEXT        UNIQUE NOT NULL,
  username          TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  driver_license_at TIMESTAMPTZ,           -- NULL = no license
  weapon_license_at TIMESTAMPTZ,

  jail_until        TIMESTAMPTZ,
  jail_reason       TEXT,

  faction_id        UUID        REFERENCES rp_factions(id) ON DELETE SET NULL,
  faction_rank      SMALLINT    NOT NULL DEFAULT 0,

  current_job       TEXT,
  on_duty           BOOLEAN     NOT NULL DEFAULT false,
  last_paycheck_at  TIMESTAMPTZ
);
CREATE INDEX idx_rp_players_token     ON rp_players(token);
CREATE INDEX idx_rp_players_faction   ON rp_players(faction_id);

-- 3. Wallets
CREATE TABLE rp_wallets (
  player_id  UUID        PRIMARY KEY REFERENCES rp_players(id) ON DELETE CASCADE,
  cash       INTEGER     NOT NULL DEFAULT 500,
  bank       INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rp_wallets_cash_nonneg CHECK (cash >= 0),
  CONSTRAINT rp_wallets_bank_nonneg CHECK (bank >= 0)
);

-- 4. Transaction log
CREATE TABLE rp_transaction_log (
  id               BIGSERIAL   PRIMARY KEY,
  player_id        UUID        NOT NULL REFERENCES rp_players(id) ON DELETE CASCADE,
  kind             TEXT        NOT NULL,
  cash_delta       INTEGER     NOT NULL DEFAULT 0,
  bank_delta       INTEGER     NOT NULL DEFAULT 0,
  cash_after       INTEGER     NOT NULL,
  bank_after       INTEGER     NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rp_tx_player_time ON rp_transaction_log(player_id, created_at DESC);

-- 5. Owned vehicles
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

-- 6. Warrants
CREATE TABLE rp_warrants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID        NOT NULL REFERENCES rp_players(id) ON DELETE CASCADE,
  reason     TEXT        NOT NULL,
  stars      SMALLINT    NOT NULL DEFAULT 1 CHECK (stars BETWEEN 1 AND 5),
  issued_by  UUID        REFERENCES rp_players(id) ON DELETE SET NULL,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at TIMESTAMPTZ
);
CREATE INDEX idx_rp_warrants_active ON rp_warrants(player_id) WHERE cleared_at IS NULL;

-- 7. Arrests
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

-- 8. Job registry (seed data, static)
CREATE TABLE rp_jobs (
  slug           TEXT     PRIMARY KEY,
  name           TEXT     NOT NULL,
  start_building TEXT     NOT NULL,
  pay_per_route  INTEGER  NOT NULL,
  cooldown_secs  INTEGER  NOT NULL DEFAULT 300,
  max_on_duty    SMALLINT NOT NULL DEFAULT 8
);
INSERT INTO rp_jobs VALUES
  ('taxi',     'Taxi Driver',     'taxi_depot',      120, 60,  8),
  ('delivery', 'Delivery Driver', 'delivery_hub',    150, 90,  6),
  ('mechanic', 'Mechanic',        'auto_shop',       180, 120, 4),
  ('medic',    'Paramedic',       'medical_center',  200, 180, 4),
  ('citywork', 'City Worker',     'city_hall',       100, 60,  10);
```

---

### Drizzle TypeScript definitions (`lib/db/src/schema/rp.ts`)

```ts
import {
  pgTable, uuid, text, timestamp, boolean, smallint,
  integer, bigserial, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 1. Factions — declared FIRST (rp_players has a FK to this table)
export const rpFactions = pgTable("rp_factions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  slug:      text("slug").unique().notNull(),
  name:      text("name").notNull(),
  type:      text("type").notNull(),
  color:     text("color").notNull().default("#ffffff"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 2. Players — after rpFactions
export const rpPlayers = pgTable("rp_players", {
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
});

// 3. Wallets
export const rpWallets = pgTable("rp_wallets", {
  playerId:  uuid("player_id").primaryKey()
               .references(() => rpPlayers.id, { onDelete: "cascade" }),
  cash:      integer("cash").notNull().default(500),
  bank:      integer("bank").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 4. Transaction log — cashDelta + bankDelta; balances recorded after each transaction
export const rpTransactionLog = pgTable("rp_transaction_log", {
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
});

// 5. Owned vehicles
export const rpOwnedVehicles = pgTable("rp_owned_vehicles", {
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
});

// 6. Warrants
export const rpWarrants = pgTable("rp_warrants", {
  id:        uuid("id").primaryKey().defaultRandom(),
  playerId:  uuid("player_id").notNull()
               .references(() => rpPlayers.id, { onDelete: "cascade" }),
  reason:    text("reason").notNull(),
  stars:     smallint("stars").notNull().default(1),
  issuedBy:  uuid("issued_by").references(() => rpPlayers.id, { onDelete: "set null" }),
  issuedAt:  timestamp("issued_at",  { withTimezone: true }).notNull().defaultNow(),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
});

// 7. Arrests
export const rpArrests = pgTable("rp_arrests", {
  id:           uuid("id").primaryKey().defaultRandom(),
  playerId:     uuid("player_id").notNull()
                  .references(() => rpPlayers.id, { onDelete: "cascade" }),
  arrestedBy:   uuid("arrested_by").references(() => rpPlayers.id, { onDelete: "set null" }),
  reason:       text("reason").notNull(),
  sentenceSecs: integer("sentence_secs").notNull(),
  fine:         integer("fine").notNull().default(0),
  arrestedAt:   timestamp("arrested_at",  { withTimezone: true }).notNull().defaultNow(),
  releasedAt:   timestamp("released_at",  { withTimezone: true }),
});

// 8. Job registry (seed / static reference)
export const rpJobs = pgTable("rp_jobs", {
  slug:          text("slug").primaryKey(),
  name:          text("name").notNull(),
  startBuilding: text("start_building").notNull(),
  payPerRoute:   integer("pay_per_route").notNull(),
  cooldownSecs:  integer("cooldown_secs").notNull().default(300),
  maxOnDuty:     smallint("max_on_duty").notNull().default(8),
});
```

---

## 5. Phase 2 — Central Spawn

### Rule (Phase 1)
**All players always spawn at Nemoverse Central Station.** No saved-position restore in
Phase 1. Last-position persistence is deferred to a later phase (after property/housing
is designed). Rejoining, respawning, and first-joining all use the same station spawn.

### Station location rationale

The central city road grid has N-S roads at `x = −45, 0, 45` (carriageway ±10 from
centre) and E-W roads at `z = −45, 0, 45` (carriageway ±10 from centre).

```
Road clearance check:
  isInCarriageway(x, z):
    for each NS road at rx in [-45, 0, 45]:
      if |x − rx| < 10 → true (in road)
    for each EW road at rz in [-45, 0, 45]:
      if |z − rz| < 10 → true (in road)
    return false
```

The station platform is placed in the northern sector of the central city, east of the
central N-S road (x=0), clear of all road carriageways:

```ts
// Platform centre — the station building marker position
export const STATION_MARKER_POS: [number, number, number] = [18, 0, -65];

// Spawn origin — players spawn here with jitter
export const STATION_SPAWN:       [number, number, number] = [18, 1, -65];

// Jitter bounds: ±4m in x, ±3m in z — keeps all spawn points off roads
export const STATION_SPAWN_JITTER_X = 4;
export const STATION_SPAWN_JITTER_Z = 3;
```

Validator confirmation for `STATION_SPAWN = [18, 1, -65]`:

| Check | Result |
|-------|--------|
| `\|18 − 0\|  = 18 ≥ 10` (clear of x=0 road)  | ✅ |
| `\|18 − 45\| = 27 ≥ 10` (clear of x=45 road) | ✅ |
| `\|18 −(−45)\|= 63 ≥ 10` (clear of x=−45 road)| ✅ |
| `\|−65−(−45)\|= 20 ≥ 10` (clear of z=−45 road)| ✅ |
| `\|−65 − 0\| = 65 ≥ 10` (clear of z=0 road)  | ✅ |
| `\|−65 − 45\|= 110 ≥ 10` (clear of z=45 road)| ✅ |
| With max jitter x=22: `\|22−0\|=22≥10`, `\|22−45\|=23≥10` | ✅ |
| With max jitter z=−62: `\|−62−(−45)\|=17≥10` | ✅ |

All road clearance checks pass including worst-case jitter.

### Server changes

**`artifacts/api-server/src/socket/cityData.ts`**
- Remove the existing 8-element spawn array.
- Export `STATION_SPAWN`, `STATION_SPAWN_JITTER_X`, `STATION_SPAWN_JITTER_Z`.

**`artifacts/api-server/src/socket/gameServer.ts`** (on `join` event)
```ts
// Phase 1: always spawn at station, no DB position restore.
const jx = (Math.random() * 2 - 1) * STATION_SPAWN_JITTER_X;
const jz = (Math.random() * 2 - 1) * STATION_SPAWN_JITTER_Z;
const spawnX = STATION_SPAWN[0] + jx;
const spawnY = STATION_SPAWN[1];
const spawnZ = STATION_SPAWN[2] + jz;
```

**`artifacts/city-sandbox/src/game/RPMarkers.tsx`** (Phase 1 marker)
- A flat platform mesh (20m × 12m, y=0.05) with a distinct station tint.
- A vertical sign mesh (emissive material) reading "CENTRAL STATION" — rendered as a
  thin box with an emissive color band; actual text via a texture atlas or
  a canvas-generated texture is deferred to Phase 2 polish.
- A large floor ring (r=14) to mark the station on the minimap.

---

## 6. Phase 3 — Driver License Gate

### 6.1 Licensing Office location

`x=42, z=−38` from v1.0 is **invalid** — both values fall inside road carriageways
(`x=42` is inside the x=45 road at `|42−45|=3 < 10`; `z=−38` is inside the z=−45 road
at `|−38−(−45)|=7 < 10`).

**New location — SE quadrant block, between the central and east N-S roads:**

```ts
export const LICENSING_OFFICE_POS: [number, number, number] = [24, 0, -22];
```

Validator confirmation for `LICENSING_OFFICE_POS = [24, 0, -22]`:

| Check | Result |
|-------|--------|
| `\|24 − 0\|  = 24 ≥ 10` (clear of x=0 road)  | ✅ |
| `\|24 − 45\| = 21 ≥ 10` (clear of x=45 road) | ✅ |
| `\|24 −(−45)\|= 69 ≥ 10` (clear of x=−45 road)| ✅ |
| `\|−22−(−45)\|= 23 ≥ 10` (clear of z=−45 road)| ✅ |
| `\|−22 − 0\| = 22 ≥ 10` (clear of z=0 road)  | ✅ |
| `\|−22 − 45\|= 67 ≥ 10` (clear of z=45 road) | ✅ |

All road clearance checks pass. The office sits in the clear block bounded by
`x ∈ [10, 35]` and `z ∈ [−35, −10]`.

Note: a building generated by the procedural city could still overlap this position.
The **full obstacle validator** in Section 12 must also pass before implementation.

### 6.2 Interaction event flow (cleaned up — single `rp:interact`)

**v1.0 had two overlapping events** (`rp:interact` and `rp:licenseTestStart`). v1.1 uses
one clean entry point:

```
Client: rp:interact { building: "licensing_office", action: "start_driver_test" }
```

The server handles both validation and test startup in one handler. There is no separate
`rp:licenseTestStart` event.

```
Player walks within 6m of LICENSING_OFFICE_POS
  → Server polls proximity each playerUpdate and emits:
     rp:prompt { building:"licensing_office",
                 options:[{ action:"start_driver_test",
                            label:"Start Driver Test ($200)" }] }

Player selects option → Client emits:
  rp:interact { building:"licensing_office", action:"start_driver_test" }

Server validates (all server-side, no client trust):
  ① Player within 6m of LICENSING_OFFICE_POS?
  ② rp.cash >= TEST_FEE (200)?
  ③ rp.driverLicense === false?
  ④ No active testState entry for this socket?
  If any fail → rp:toast { msg, color:"red" }; return.

  All pass:
  ⑤ Deduct TEST_FEE via walletTransfer({ cashDelta:-200, kind:"license_fee" })
  ⑥ Spawn temporary test vehicle at TEST_VEHICLE_SPAWN
  ⑦ Record in rpTestState Map: { socketId, vehicleId, nextCp:0, startedAt,
                                  lastCpAt:startedAt, passed:[] }
  ⑧ Emit rp:licenseTestActive { vehicleId, checkpoints:LICENSE_TEST_CHECKPOINTS }
```

### 6.3 Test vehicle exception — unlicensed driving

The rule "no driving without license" has exactly **one exception**: the server-spawned
test vehicle while a test is active.

**Server-side gate in `vehicleUpdate` handler:**

```ts
if (patch.driverId === socket.id) {
  const rp = rpCache.get(socket.id);
  const testState = rpTestState.get(socket.id);

  const isTestVehicle = testState !== undefined
    && patch.id === testState.vehicleId;

  if (!rp?.driverLicense && !isTestVehicle) {
    socket.emit("rp:toast", {
      msg: "Driver license required. Visit Nemoverse Licensing Office.",
      color: "red",
    });
    return; // Drop the vehicleUpdate — do not mutate server vehicle state
  }
}
```

There is no other exception. A player with no license who tries any vehicle other than
their active test vehicle is blocked server-side and shown the toast.

**Client-side optimistic gate in `LocalPlayer.tsx`:**

```ts
const testState = rpProfile.activeTest; // set by rp:licenseTestActive
const isTestVehicle = testState?.vehicleId === v.id;

if (!rpProfile.driverLicense && !isTestVehicle) {
  setToast("Driver license required. Visit Nemoverse Licensing Office.");
  return; // Skip enterVehicle() entirely — no flicker
}
```

This is a UX optimisation only. The server is always authoritative.

### 6.4 Test checkpoint validation (no animState)

`animState` is client-controlled. The server **does not** use it for test validation.

**Server validates using authoritative server state only:**

On `rp:interact { building:"checkpoint", idx:N }`:

```ts
function handleCheckpointInteract(socket, idx) {
  const testState = rpTestState.get(socket.id);
  const rp        = rpCache.get(socket.id);
  const player    = players.get(socket.id);    // server's authoritative PlayerState
  const vehicle   = vehicles.get(testState?.vehicleId); // server's authoritative VehicleState

  // 1. Active test exists for this socket?
  if (!testState) return;

  // 2. Correct checkpoint order?
  if (idx !== testState.nextCp) {
    socket.emit("rp:toast", { msg:"Drive to the next checkpoint.", color:"yellow" });
    return;
  }

  // 3. Player is the driver of the test vehicle (server-side check)?
  if (vehicle?.driverId !== socket.id) {
    socket.emit("rp:toast", { msg:"Get in the test vehicle.", color:"yellow" });
    return;
  }

  // 4. Player/vehicle is within 8m of the checkpoint?
  const cp = LICENSE_TEST_CHECKPOINTS[idx];
  const dx = (vehicle?.x ?? player.x) - cp[0];
  const dz = (vehicle?.z ?? player.z) - cp[2];
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > 8) {
    socket.emit("rp:toast", { msg:"Too far from checkpoint.", color:"yellow" });
    return;
  }

  // 5. Sane timing: at least 3s since last checkpoint, at most 120s
  const now = Date.now();
  const elapsed = (now - testState.lastCpAt) / 1000;
  if (elapsed < 3)   { /* silently ignore — probably a duplicate packet */ return; }
  if (elapsed > 120) {
    rpTestState.delete(socket.id);
    socket.emit("rp:licenseTestResult", { passed: false, reason:"timeout" });
    socket.emit("rp:toast", { msg:"Test timed out. Try again.", color:"red" });
    return;
  }

  // 6. All checks pass — advance checkpoint
  testState.nextCp++;
  testState.lastCpAt = now;
  testState.passed.push(idx);
  socket.emit("rp:interact", { ack:"checkpoint", idx });

  // 7. All checkpoints passed → grant license
  if (testState.nextCp >= LICENSE_TEST_CHECKPOINTS.length) {
    rpTestState.delete(socket.id);
    despawnTestVehicle(testState.vehicleId);
    await db.update(rpPlayers)
      .set({ driverLicenseAt: new Date() })
      .where(eq(rpPlayers.id, rp.playerId));
    rp.driverLicense = true; // update cache
    socket.emit("rp:licenseTestResult", { passed: true });
    socket.emit("rp:profileUpdate", { driverLicense: true });
    socket.emit("rp:toast", { msg:"✓ Driver License granted!", color:"green" });
  }
}
```

### 6.5 Test failure conditions

| Condition | Trigger | Outcome |
|-----------|---------|---------|
| Timeout (>120s between checkpoints) | Server polling or next checkpoint attempt | Test cleared, no refund |
| Player exits test vehicle | `vehicleUpdate` with `driverId:null` for testVehicleId | Test cleared, no refund |
| Player drives >80m from route AABB | Server distance check on playerUpdate | Test cleared, no refund |
| Server restart | rpTestState is in-memory only — lost on restart | Player must retry; $200 already deducted |

Fee is **never refunded** on failure (matches SA-MP DMV convention).

### 6.6 Test vehicle spawn and checkpoint route

```ts
export const TEST_VEHICLE_SPAWN: [number, number, number] = [34, 0, -22];
// x=34: just outside east road carriageway edge (|34-45|=11 > 10), acts as parking spot.

export const TEST_FEE = 200; // $200

export const LICENSE_TEST_CHECKPOINTS: [number, number, number][] = [
  [42,  0.5, -40],  // CP0 — south on x=45 road, approaching z=-45 intersection
  [ 0,  0.5, -44],  // CP1 — west on z=-45 road, at x=0 intersection
  [ 2,  0.5, -22],  // CP2 — north on x=0 road back toward city center
  [24,  0.5, -18],  // CP3 (finish) — return near Licensing Office entrance
];
```

Checkpoint validator confirmation (checkpoints must be **on** road carriageways, except
CP3 which is the office return marker):

| CP | x | z | On road? |
|----|---|---|----------|
| CP0 | 42 | −40 | x=42: `\|42−45\|=3 < 10` ✅ on x=45 road |
| CP1 |  0 | −44 | x=0: `\|0−0\|=0 < 10` ✅ on x=0 road; z=−44: `\|−44−(−45)\|=1 < 10` ✅ intersection |
| CP2 |  2 | −22 | x=2: `\|2−0\|=2 < 10` ✅ on x=0 road |
| CP3 | 24 | −18 | Off-road by design (finish marker at office entrance) ✅ |

Route narrative: drive from test spawn at [34,0,−22] → south on east road → west at
the southern intersection → north on central road → finish near the Licensing Office.

---

## 7. Phase 4 — Money System

### 7.1 HUD additions

**New props added to `HUD.tsx`:**
```ts
cash: number;   // server-authoritative
bank: number;   // server-authoritative
driverLicense: boolean;
```

Visual placement — bottom-right panel, above speed gauge:
```
💵 $1,240
🏦 $3,500
🪪 Licensed  ← green badge if true; absent if false
```

### 7.2 Starting money
- `cash: 500`, `bank: 0` — set by `rp_wallets` column defaults on insert.
- New player toast on first join: `"Welcome to Nemoverse! You have $500 cash."`

### 7.3 Wallet transfer API — revised

**v1.0 had `transfer(playerId, amount, kind, note)`** which only handled cash.
**v1.1 uses a structured input that handles both cash and bank atomically:**

```ts
interface WalletTransferInput {
  playerId:   string;
  cashDelta?: number;  // negative = deduct, positive = add, 0 = no change
  bankDelta?: number;  // same
  kind:       TransactionKind;
  note?:      string;
}

interface WalletTransferResult {
  cash: number;
  bank: number;
}

async function walletTransfer(
  input: WalletTransferInput,
): Promise<WalletTransferResult> {
  const { playerId, cashDelta = 0, bankDelta = 0, kind, note } = input;

  return await db.transaction(async (tx) => {
    // Row-lock the wallet row for the duration of this transaction.
    // SELECT ... FOR UPDATE prevents concurrent transfers from double-spending.
    const [wallet] = await tx
      .select()
      .from(rpWallets)
      .where(eq(rpWallets.playerId, playerId))
      .for("update");           // pg row lock

    if (!wallet) throw new Error(`No wallet for player ${playerId}`);

    const newCash = wallet.cash + cashDelta;
    const newBank = wallet.bank + bankDelta;

    // Application-level check before hitting the DB constraint — gives a
    // descriptive error rather than a raw constraint violation string.
    if (newCash < 0) throw new RpError("insufficient_cash", `Need $${-cashDelta}, have $${wallet.cash}`);
    if (newBank < 0) throw new RpError("insufficient_bank", `Need $${-bankDelta}, have $${wallet.bank}`);

    await tx
      .update(rpWallets)
      .set({ cash: newCash, bank: newBank, updatedAt: new Date() })
      .where(eq(rpWallets.playerId, playerId));

    await tx.insert(rpTransactionLog).values({
      playerId,
      kind,
      cashDelta,
      bankDelta,
      cashAfter: newCash,
      bankAfter: newBank,
      note,
    });

    return { cash: newCash, bank: newBank };
  });
}
```

The PostgreSQL `CHECK` constraints (`cash >= 0`, `bank >= 0`) remain as a last-resort
safety net against application bugs, but `walletTransfer` explicitly validates before
the `UPDATE` so the error is always descriptive and caught by the application.

### 7.4 Transaction kinds (complete list)

| kind | cashDelta | bankDelta | Trigger |
|------|-----------|-----------|---------|
| `license_fee` | −200 | 0 | Starting driver test |
| `vehicle_purchase` | −price | 0 | Buying vehicle (Phase 3+) |
| `job_pay` | +amount | 0 | Completing job route |
| `fine` | −amount | 0 | Police fine |
| `bank_deposit` | −amount | +amount | ATM deposit |
| `bank_withdraw` | +amount | −amount | ATM withdrawal |
| `salary` | +amount | 0 | Faction duty-time pay |
| `admin_grant` | ±amount | ±amount | Admin command |

### 7.5 Anti-spoof rules for money

- Client sends **intent** only: `{ action:"job_complete", jobId }`.
- Server reads `pay_per_route` from `rp_jobs` seed table — never from the client payload.
- Server validates job was started, all checkpoints were hit, and cooldown has elapsed.
- Server calls `walletTransfer()` and emits `rp:profileUpdate { cash, bank }`.
- Client **never** sends an amount in any event.

---

## 8. Phase 5 — RP Jobs

*(Deferred to a later coding session — architecture unchanged from v1.0)*

Each job has a dedicated handler in `artifacts/api-server/src/rp/jobs/`. Anti-farm
validation: `last_paycheck_at` cooldown enforced in DB; route checkpoints timestamped
server-side; `on_duty` must remain true throughout route; player must stay within
route AABB.

---

## 9. Phase 6 — Police & Arrest

*(Deferred — architecture unchanged from v1.0)*

Police station proposed at `[−44, 0, 0]`. Arrest requires officer on-duty, within 3m of
target with active warrant. Jail time stored in `rp_players.jail_until`; server enforces
position confinement on every `playerUpdate`. Police salary = duty time, not arrest count.

---

## 10. Phase 7 — Gangs & Factions

*(Deferred — architecture unchanged from v1.0)*

Generic faction system using `rp_factions` + `rp_players.faction_id/faction_rank`.
Faction chat uses `rp:factionChat`; server routes only to matching `faction_id` sockets.

---

## 11. Phase 8 — Mayor & Government

*(Deferred — architecture unchanged from v1.0)*

Mayor = `faction.slug === "government"` + `faction_rank >= 4`. Powers: city announcement,
tax rate (0–15%), business licence approvals. `rp_city_config` table stores live config.

---

## 12. Validators

These validator functions must be implemented in
`artifacts/api-server/src/rp/rpValidators.ts` and executed as startup assertions
and in any code that adds new RP markers.

### 12.1 Road carriageway clearance (buildings/spawns must be OFF roads)

```ts
const NS_ROADS_X = [-45, 0, 45] as const;
const EW_ROADS_Z = [-45, 0, 45] as const;
const ROAD_HALF  = 10; // half-width of 20m carriageway

function isInCarriageway(x: number, z: number): boolean {
  for (const rx of NS_ROADS_X) {
    if (Math.abs(x - rx) < ROAD_HALF) return true;
  }
  for (const rz of EW_ROADS_Z) {
    if (Math.abs(z - rz) < ROAD_HALF) return true;
  }
  return false;
}

// Pass: returns false (not in carriageway)
assertFalse(isInCarriageway(18,  -65), "STATION_SPAWN");
assertFalse(isInCarriageway(24,  -22), "LICENSING_OFFICE_POS");
assertFalse(isInCarriageway(34,  -22), "TEST_VEHICLE_SPAWN");
```

### 12.2 On-road validator (checkpoints must be ON roads)

```ts
function isOnRoad(x: number, z: number): boolean {
  // A point is on a road if it is in any carriageway
  return isInCarriageway(x, z);
}

// CP0–CP2 must be on roads; CP3 is the finish line (off-road is intentional)
assertTrue(isOnRoad(42,  -40), "CP0");
assertTrue(isOnRoad( 0,  -44), "CP1");
assertTrue(isOnRoad( 2,  -22), "CP2");
// CP3 is intentionally off-road (office return marker) — not validated here
```

### 12.3 Static obstacle clearance

The server already has `STATIC_OBSTACLES` from `cityData.ts`. Each obstacle has an axis-
aligned bounding box derived from `(o.x, o.z, o.w, o.d)`. Any RP marker that overlaps
an obstacle AABB must be relocated.

```ts
function isInsideObstacle(x: number, z: number, obstacles: StaticObstacle[]): boolean {
  for (const o of obstacles) {
    const hw = o.w / 2 + 1; // +1m clearance margin
    const hd = o.d / 2 + 1;
    if (Math.abs(x - o.x) < hw && Math.abs(z - o.z) < hd) return true;
  }
  return false;
}

// Run at server startup:
function validateRpMarkers(obstacles: StaticObstacle[]): void {
  const markers = [
    { label: "STATION_SPAWN",        x: 18,  z: -65 },
    { label: "LICENSING_OFFICE_POS", x: 24,  z: -22 },
    { label: "TEST_VEHICLE_SPAWN",   x: 34,  z: -22 },
    { label: "CP0",                  x: 42,  z: -40 },
    { label: "CP1",                  x:  0,  z: -44 },
    { label: "CP2",                  x:  2,  z: -22 },
    { label: "CP3",                  x: 24,  z: -18 },
  ];

  for (const m of markers) {
    if (isInCarriageway(m.x, m.z) && !["CP0","CP1","CP2"].includes(m.label)) {
      throw new Error(`RP marker "${m.label}" is inside a road carriageway`);
    }
    if (isInsideObstacle(m.x, m.z, obstacles)) {
      throw new Error(`RP marker "${m.label}" overlaps a static obstacle`);
    }
    console.log(`[rp] marker OK: ${m.label} [${m.x}, ${m.z}]`);
  }
}
```

This runs **once at server startup**, before any socket connections are accepted. If any
marker fails, the server throws and refuses to start — forcing the developer to fix the
position before deployment.

### 12.4 Jitter spawn safety

Every time a player spawns, verify the jittered position before applying:

```ts
function safeStationSpawn(): [number, number, number] {
  for (let attempt = 0; attempt < 10; attempt++) {
    const jx = (Math.random() * 2 - 1) * STATION_SPAWN_JITTER_X;
    const jz = (Math.random() * 2 - 1) * STATION_SPAWN_JITTER_Z;
    const x  = STATION_SPAWN[0] + jx;
    const z  = STATION_SPAWN[2] + jz;
    if (!isInCarriageway(x, z) && !isInsideObstacle(x, z, STATIC_OBSTACLES)) {
      return [x, STATION_SPAWN[1], z];
    }
  }
  // Fallback: exact platform centre if all jittered positions fail
  return [...STATION_SPAWN];
}
```

### 12.5 License check — vehicle entry (server)

```ts
function canDriveVehicle(socketId: string, vehicleId: string): boolean {
  const rp        = rpCache.get(socketId);
  const testState = rpTestState.get(socketId);

  if (rp?.driverLicense) return true;  // licensed — always allowed

  // Unlicensed exception: only the active test vehicle
  if (testState && testState.vehicleId === vehicleId) return true;

  return false;
}
```

### 12.6 License check — vehicle entry (client, optimistic)

```ts
function canDriveVehicleClient(vehicleId: string, rpProfile: RpProfile): boolean {
  if (rpProfile.driverLicense) return true;
  if (rpProfile.activeTest?.vehicleId === vehicleId) return true;
  return false;
}
```

---

## 13. Socket Event Catalog

### Client → Server

| Event | Payload | Server validates |
|-------|---------|-----------------|
| `join` | `{ username, token }` | Token upsert; emit `rp:profile` |
| `rp:interact` | `{ building, action }` | Player within 6m; action valid for building; action-specific gates |
| `rp:bankDeposit` | `{ amount }` | Within 6m ATM; cash ≥ amount |
| `rp:bankWithdraw` | `{ amount }` | Within 6m ATM; bank ≥ amount |
| `rp:jobDuty` | `{ job, on }` | Player in right building; correct faction; cooldown |
| `rp:jobCheckpoint` | `{ idx }` | Proximity, order, timing, on-duty |
| `rp:issueWarrant` | `{ targetId, reason, stars }` | Police on-duty; within 12m of target |
| `rp:arrest` | `{ targetId }` | Police on-duty; within 3m; target has active warrant |
| `rp:factionChat` | `{ msg }` | Player is faction member |
| `rp:announce` | `{ msg }` | Mayor rank verified |

**Removed from v1.0:** `rp:licenseTestStart` (replaced by `rp:interact` with
`action:"start_driver_test"`).

The `rp:interact` handler is the single entry point for all building interactions.
The `action` field selects which sub-handler runs on the server.

### Server → Client

| Event | Payload | When |
|-------|---------|------|
| `rp:profile` | Full `RpProfile` | On join (after `gameState`) |
| `rp:profileUpdate` | Partial `RpProfile` (changed fields only) | After any state change |
| `rp:toast` | `{ msg, color, duration? }` | Feedback for any interaction |
| `rp:prompt` | `{ building, options[] }` | Player near interactive building |
| `rp:promptHide` | — | Player walks away from building |
| `rp:licenseTestActive` | `{ vehicleId, checkpoints[] }` | Test started successfully |
| `rp:licenseTestResult` | `{ passed, reason? }` | Test ended (pass or fail) |
| `rp:wantedUpdate` | `{ playerId, stars }` | Warrant issued/cleared (broadcast) |
| `rp:jailStatus` | `{ releaseAt }` | On arrest |
| `rp:jailCountdown` | `{ secondsLeft }` | Every 10s while jailed |
| `rp:factionChat` | `{ fromId, username, msg }` | Faction members only |
| `rp:cityAnnounce` | `{ msg }` | All clients (mayor broadcast) |

### Shared `RpProfile` type (`artifacts/city-sandbox/src/shared/rpTypes.ts`)

```ts
export interface ActiveTest {
  vehicleId: string;
  checkpoints: [number, number, number][];
  nextCp: number;
}

export interface RpProfile {
  playerId:       string;
  cash:           number;
  bank:           number;
  driverLicense:  boolean;
  weaponLicense:  boolean;
  jailUntil:      number | null;   // Unix ms; null = free
  factionId:      string | null;
  factionSlug:    string | null;
  factionRank:    number;
  currentJob:     string | null;
  onDuty:         boolean;
  wantedStars:    number;          // 0 = clean
  activeTest:     ActiveTest | null;  // set during license test only
}
```

---

## 14. Anti-Cheat & Server Authority Rules

| Vector | Rule |
|--------|------|
| Fake license | Server checks `rpCache.driverLicense` before allowing `driverId` patch. Client flag is display-only. |
| Test vehicle bypass | `canDriveVehicle()` — only the exact `testState.vehicleId` is exempt; any other vehicle is blocked. |
| animState spoofing for test | Checkpoint validation uses `vehicle.driverId === socket.id` from the server's `vehicles` Map, plus Euclidean distance. `animState` is never read. |
| Fake money | Client never sends earn amounts. Server reads payout from `rp_jobs` seed data. `walletTransfer` uses a DB row lock. |
| Duplicate checkpoint | `testState.nextCp` advances only after full validation. Replayed packets for the same index are ignored. |
| Fake checkpoint proximity | Server computes distance from the server's `vehicles.get(testVehicleId).{x,z}`, not from client-supplied coordinates. |
| Duplicate job payout | `last_paycheck_at` is written to DB before emit. Concurrent requests are serialised by DB row lock. |
| Jail escape | Server re-enforces jail AABB on every `playerUpdate` while `jail_until > Date.now()`. |
| Vehicle ownership spoof | `rp_owned_vehicles.owner_id` checked server-side before spawning personal vehicle. |
| Negative cash exploit | `walletTransfer()` validates `newCash >= 0` in application code before the `UPDATE`. DB `CHECK` is last resort. |
| Mayor power abuse | Tax rate hard-capped `[0, 0.15]` in handler. Announcement max 200 chars. Mayor identity verified against DB, not client claim. |
| Token theft | Token is never broadcast to other sockets. Server-side token is the sole identity. |

---

## 15. File Change Map

### New files

| File | Purpose |
|------|---------|
| `lib/db/src/schema/rp.ts` | All RP Drizzle table definitions (factions first) |
| `lib/db/drizzle/0001_rp_foundation.sql` | SQL migration preview for review |
| `artifacts/api-server/src/rp/rpTypes.ts` | Server-side RP types + constants |
| `artifacts/api-server/src/rp/rpValidators.ts` | Marker + spawn validators (startup assertions) |
| `artifacts/api-server/src/rp/rpCache.ts` | In-memory `Map<socketId, RpCacheEntry>` |
| `artifacts/api-server/src/rp/rpPlayerService.ts` | DB CRUD: player profile upsert/load |
| `artifacts/api-server/src/rp/rpWalletService.ts` | `walletTransfer()` with row lock |
| `artifacts/api-server/src/rp/rpLicenseService.ts` | Test state machine + test vehicle lifecycle |
| `artifacts/api-server/src/rp/rpVehicleService.ts` | Owned vehicle management |
| `artifacts/api-server/src/rp/rpFactionService.ts` | Faction membership + chat routing |
| `artifacts/api-server/src/rp/rpPoliceService.ts` | Arrest, warrant, jail |
| `artifacts/api-server/src/rp/rpJobService.ts` | Job duty, checkpoints, payout |
| `artifacts/api-server/src/rp/jobs/taxi.ts` | Taxi job handler |
| `artifacts/api-server/src/rp/jobs/delivery.ts` | Delivery job handler |
| `artifacts/api-server/src/rp/jobs/mechanic.ts` | Mechanic job handler |
| `artifacts/api-server/src/rp/jobs/medic.ts` | Medic job handler |
| `artifacts/api-server/src/rp/jobs/citywork.ts` | City worker job handler |
| `artifacts/api-server/src/rp/setupRpHandlers.ts` | Registers all `rp:*` socket events |
| `artifacts/city-sandbox/src/shared/rpTypes.ts` | `RpProfile` + constants (shared with client) |
| `artifacts/city-sandbox/src/hooks/useRpSocket.ts` | `rp:*` event listeners + React state |
| `artifacts/city-sandbox/src/game/RPMarkers.tsx` | Station platform, Licensing Office, job depots |
| `artifacts/city-sandbox/src/game/RPHud.tsx` | Cash/bank/license HUD overlay + toast stack |
| `artifacts/city-sandbox/src/game/LicenseTestHUD.tsx` | Test overlay with checkpoint dots + progress |

### Modified files

| File | Change |
|------|--------|
| `lib/db/src/schema/index.ts` | Re-export from `rp.ts` |
| `artifacts/api-server/src/socket/gameServer.ts` | License gate on `vehicleUpdate`; call `setupRpHandlers`; load rpCache on join; run `validateRpMarkers` at startup |
| `artifacts/api-server/src/socket/cityData.ts` | Replace spawn array with `STATION_SPAWN` + jitter constants |
| `artifacts/city-sandbox/src/hooks/useSocket.ts` | Send `token` with `join`; hand off `rp:profile` to `useRpSocket` |
| `artifacts/city-sandbox/src/game/LocalPlayer.tsx` | Add `canDriveVehicleClient()` check before `enterVehicle()` |
| `artifacts/city-sandbox/src/game/GameScene.tsx` | Mount `<RPMarkers>`, `<RPHud>`, `<LicenseTestHUD>` |
| `artifacts/city-sandbox/src/game/HUD.tsx` | Add `cash`, `bank`, `driverLicense` props; render `<RPHud>` |

---

## 16. Implementation Order

### Phase 1 — Minimal RP Core (Session 1)

```
Step 1  — lib/db/src/schema/rp.ts               (Drizzle schema — factions first)
Step 2  — lib/db/src/schema/index.ts             (re-export)
Step 3  — lib/db/drizzle/0001_rp_foundation.sql  (generate migration preview, do NOT push)
Step 4  — artifacts/city-sandbox/src/shared/rpTypes.ts   (RpProfile, constants)
Step 5  — artifacts/api-server/src/rp/rpValidators.ts    (marker + spawn validators)
Step 6  — artifacts/api-server/src/rp/rpCache.ts         (in-memory cache)
Step 7  — artifacts/api-server/src/rp/rpPlayerService.ts (upsert + load)
Step 8  — artifacts/api-server/src/rp/rpWalletService.ts (walletTransfer)
Step 9  — artifacts/api-server/src/socket/cityData.ts    (STATION_SPAWN constants)
Step 10 — artifacts/api-server/src/socket/gameServer.ts  (token on join, license gate,
                                                           validateRpMarkers at startup)
Step 11 — artifacts/api-server/src/rp/setupRpHandlers.ts (rp:interact stub, rp:profile)
Step 12 — artifacts/city-sandbox/src/hooks/useSocket.ts  (send token, receive rp:profile)
Step 13 — artifacts/city-sandbox/src/hooks/useRpSocket.ts (rp state in React)
Step 14 — artifacts/city-sandbox/src/game/RPMarkers.tsx  (station marker only for Ph.1)
Step 15 — artifacts/city-sandbox/src/game/RPHud.tsx      (cash/bank/license display)
Step 16 — artifacts/city-sandbox/src/game/LocalPlayer.tsx (license gate before enterVehicle)
Step 17 — artifacts/city-sandbox/src/game/GameScene.tsx  (mount new components)
Step 18 — artifacts/city-sandbox/src/game/HUD.tsx        (pass cash/bank/driverLicense props)
Step 19 — pnpm run typecheck + build verification
```

### Phase 2 — License Test (Session 2)
Steps: `rpLicenseService.ts` → `LicenseTestHUD.tsx` → extend `setupRpHandlers` →
extend `RPMarkers.tsx` with Licensing Office marker.

### Phases 3–8 (later sessions)
Jobs → Police → Factions → Mayor. Each builds on the DB schema already in place.

---

## 17. Approval Checklist

Before any code is written, confirm:

- [ ] **DB schema** approved (Section 4)
- [ ] **Migration strategy**: `drizzle-kit generate` only; manual SQL review before push
- [ ] **Player identity**: UUID token in localStorage — approved
- [ ] **Station spawn** `[18, 1, −65]` — approved
- [ ] **Station spawn jitter** ±4m x, ±3m z — approved
- [ ] **Licensing Office** `[24, 0, −22]` — approved *(subject to obstacle validator passing)*
- [ ] **Test vehicle spawn** `[34, 0, −22]` — approved
- [ ] **License test fee** $200 — approved
- [ ] **Starting cash** $500, starting bank $0 — approved
- [ ] **Checkpoint route** (Section 6.6) — approved
- [ ] **Phase 1 minimal scope** (Section 3) — approved; jobs/police/gangs/mayor deferred
- [ ] **`DATABASE_URL` env var** is set in `artifacts/api-server` environment
- [ ] **PostgreSQL** instance is accessible from the api-server at deploy time

---

*Nemoverse RP Foundation — plan v1.1*
