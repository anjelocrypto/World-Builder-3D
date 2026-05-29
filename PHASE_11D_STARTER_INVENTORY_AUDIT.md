# Phase 11D — Starter Inventory Items + Server-Side Seeding (Audit + Implementation)

## Goal
Make the Phase 11C inventory panel show real starter RP items for every player,
with no item use, drops, trades, shops, contraband, weapons, or economy effects.

## Audit findings

1. **Player-load path.** RP players are upserted in `rpPlayerService.upsertPlayer`
   (idempotent on `rp_players.token` via `onConflictDoUpdate`, returns the stable
   UUID `player.id`). The join handler in `socket/gameServer.ts` calls it inside
   `upsertPlayer(...).then(async (rpEntry) => { rpCache.set(...); emit profile;
   await loadAndSpawnOwnedVehicles(...) })` with a tolerant outer `.catch`.

2. **Safest seed point.** Immediately after `rpCache.set` and the profile emit,
   before `loadAndSpawnOwnedVehicles`, inside its own `try/catch`. The player row
   + UUID already exist, and a seed failure must not block login or vehicle load.

3. **Reconnect behavior.** The join flow runs on every socket connection, so the
   seed call fires on every reconnect/refresh. Therefore idempotency must be at
   the DB level — not app-level "fire once".

4. **Schema is sufficient — no new table.** `rp_inventory_items` (11C) already has
   `uniqueIndex("uq_rp_inventory_player_item").on(playerId, itemSlug)` and
   `CHECK(quantity >= 0)`. A bulk insert with `onConflictDoNothing()` is therefore
   idempotent: each missing starter row inserts once; existing rows are untouched.

5. **Display works unchanged.** `rp:getInventory` already selects by `playerId`,
   maps slugs through the server-side `ITEM_CATALOG`, and emits `{ items }`. The
   starter slugs (`phone`, `keys`, `notebook`, `water_bottle`) all exist in the
   catalog, so they render with no client changes.

6. **No economic surface.** Starter items are plain `rp_inventory_items` rows.
   The seed touches no wallet/bank/license/job/police/faction/vehicle/city-budget
   state, and the catalog entries are non-usable and non-economic.

## Implementation

- `rpInventoryService.ts`
  - `STARTER_ITEMS` = `phone×1`, `keys×1`, `notebook×1`, `water_bottle×1` (all
    catalog slugs; `water_bottle` remains non-usable).
  - `ensureStarterInventoryForPlayer(playerId)`: server-only, bulk
    `db.insert(rpInventoryItems).values(...).onConflictDoNothing()`, wrapped in
    `try/catch`, logs `{ err }` only (no player/socket id), never throws.
- `socket/gameServer.ts`: call it in the join `.then` after `rpCache.set`/profile
  emit, in an isolated `try/catch`, before `loadAndSpawnOwnedVehicles`.
- Client UI unchanged: inventory is read-only, opened with `O`, no use/drop/trade.

## Idempotency guarantee
`onConflictDoNothing()` against `uq_rp_inventory_player_item (player_id, item_slug)`
means repeated seeding (reconnect, respawn, refresh, repeated profile loads) never
duplicates a stack and never overwrites a quantity. Pre-existing players receive
any missing starter items on their next join.

## Verification
- tsc ×4: pass.
- api-server build / Vite build (`BASE_PATH=/`) / RP validators: run on Mac
  (platform-locked esbuild/tsx). 11D adds no geometry — validators unaffected.
- Security greps: seed uses `onConflictDoNothing` only; logs carry no player/socket
  id; client emits only `rp:getInventory` (no slugs/quantities); no
  use/drop/trade/sell handlers; no wallet/bank/license/job mutation.

## Manual test checklist
1. Apply the 11C migration if not already applied.
2. Join with an empty inventory → press `O` → `phone`, `keys`, `notebook`,
   `water_bottle` appear at ×1.
3. Reconnect / reload / reopen → quantities do not duplicate.
4. Pre-existing players get the missing starter items exactly once.
5. Inventory remains read-only (no use/drop/trade buttons).
6. No cash/bank/license/job/police/faction values change.
