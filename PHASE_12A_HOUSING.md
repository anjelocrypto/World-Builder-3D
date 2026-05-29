# Phase 12A — Starter Player Housing (Implementation)

Buyable, owner-only houses. No selling, guests, keys, storage, furniture, garages, or rent (all deferred).

## Approach (approved)

Solid sealed house shells + server-gated teleport interiors. Walk-in shells were
rejected: collision is client-side with no server hook at the doorway, so a gap
can't enforce owner-only entry. Each house is a sealed 8×8 shell (4 solid walls,
no gap) — the only way inside is the server teleport, which validates ownership.

The interior IS the inside of each house's own shell (no remote rooms): the owner
teleports from the door to the shell centre and exits with E from inside. This
reuses the verified city-edge plots and avoids procedural-scatter risk entirely.
Teleport reuses the jail-release pattern (`players.set` + `io.emit("playerMoved")`)
plus a client `rp:houseTeleport` snap that sets the local avatar via the same
`pos.current.set` primitive as vehicle-exit. Reconnect spawns at the station, so
a player can never be trapped.

## Houses (verified clear of roads / RP buildings / cars / spawns)

| slug | label | price | center | door |
|------|-------|-------|--------|------|
| maple_court | Maple Court | $25,000 | (−92,−92) | (−92,−86) |
| lakeside_villa | Lakeside Villa | $40,000 | (−92, 92) | (−92, 86) |
| harbor_flat | Harbor Flat | $30,000 | (92,−92) | (92,−86) |

8×8 footprints; ≥31 m off every road, ≥12 m from any RP building, ≥51 m from any
parked car. Prices are cash (consistent with vehicle purchase; use an ATM to move
bank→cash).

## Data model

Static defs (slug, label, price, footprint, door, interior) live in mirrored code:
`artifacts/api-server/src/socket/cityData.ts` (authoritative) and
`artifacts/city-sandbox/src/shared/rpTypes.ts` (render + collision). The DB
persists ownership only:

```
rp_houses(id uuid pk, slug text unique, owner_id uuid null → rp_players set null,
          purchased_at timestamptz null, updated_at timestamptz default now,
          index idx_rp_houses_owner)
```

Seeded idempotently on boot (`onConflictDoNothing`, non-fatal).

## Security

- Price/geometry are server-side; the client sends only a slug (`rp:buyHouse`,
  `rp:enterHouse`) or nothing (`rp:getHouses`, `rp:exitHouse`).
- Atomic purchase in one `db.transaction`: conditional claim
  `UPDATE rp_houses SET owner_id=? WHERE slug=? AND owner_id IS NULL RETURNING *`
  (0 rows → `already_owned`, rollback, no charge) → `SELECT … FOR UPDATE` wallet,
  validate funds, deduct cash, write `rp_transaction_log`. Two buyers → one wins.
- Owner-only entry: server checks `rp_houses.owner_id === playerId` + proximity;
  non-owners get "This house is locked."
- Client payload is `{ slug, label, price, owned, ownedByMe }` — never an owner
  UUID or DB row id. New logs carry no socket/player id.
- No inventory/job/police/faction/economy side effects beyond the wallet charge.

## Verification

tsc ×4 pass. Standalone replication of `validateRpHouses` confirms all 3 houses
clear roads, RP buildings, cars, doors (2 m reach, outside shell), house-to-house
gaps, and interior-inside-shell. api-server build, Vite build (`BASE_PATH=/`), and
the tsx RP validators (incl. the new `validateRpHouses` at boot) run on the Mac.

## Manual tests

1. Run `pnpm --filter @workspace/db build` then `cd lib/db && pnpm generate && pnpm migrate`.
2. Walk to a corner house → "E — Buy <name> $X"; press E → confirm modal.
3. Buy (need cash) → money deducted, prompt becomes "E — Enter Home".
4. E at door → teleport inside; E inside → "E — Exit Home" → teleport to door.
5. Second player at the same house → "Locked"; can't enter; can't buy (owned).
6. Reconnect → still owner, can re-enter; never spawns trapped inside.
7. Two clients buy same house at once → only one succeeds, other is refunded-free.
