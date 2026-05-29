# Phase 9B — Deferred Civic Buildings (plan)

Phase 9A (A–E) built real shells + door-aligned interaction for the 5 unconstrained civic buildings. Four locations were deferred because each has coupling beyond "place a footprint." This plan sequences them lowest-risk first. Each becomes its own reviewed batch; nothing here is implemented yet.

## Shared groundwork (do once, first)
Extend `RP_BUILDINGS` only after each location's coordinate/coupling decision is locked, so the footprint validator and `RPBuildings` renderer pick them up automatically (same pattern as 9A-B/C). Reuse `rpBuildingDoor()` + the `*_DOOR` gate pattern from 9A-E. No new systems needed.

## Batch ordering (risk-ascending)

### 9B-1 — Taxi Depot building (lowest risk)
- **Coupling:** proximity gate only (clock-in/out). Taxi fare is pickup→dropoff distance, **not** depot-based, so payouts are unaffected.
- **Catch:** the audit found the only collision-free taxi footprint forces a ~40 m relocation (origin shares City Hall's NW pocket). Must move `TAXI_DEPOT` + its gate + ring + the taxi clock-in/out checks, and confirm the new spot stays near enough to the on-road `TAXI_PICKUPS` to feel coherent (pickups are NOT moved).
- **Steps:** solve a verified footprint+door spot → move `TAXI_DEPOT` (mirror server/client) → add to `RP_BUILDINGS` + `TAXI_DEPOT_DOOR` → redirect gate/ring/prompt → validators + tsc.

### 9B-2 — Delivery Hub building (payout-origin analysis required)
- **Coupling:** `DELIVERY_HUB` is a **payout origin** (`calcDeliveryPay(DELIVERY_HUB, …)`). Moving it changes delivery pay for every route.
- **Decision needed from you:** either (a) keep the payout origin fixed and only relocate the *gate/building* to a door-style point nearby (like the Medic split in 9A-E), or (b) accept a payout shift and document the delta. Recommend (a).
- **Catch:** can't host a footprint near (58,−28) without clipping the x=45 road; needs a small relocation of the building shell while the payout origin stays put.
- **Steps:** decide (a)/(b) → introduce `DELIVERY_HUB_DOOR`/building point distinct from payout origin → footprint solve → validators + tsc + a before/after pay sample if (b).

### 9B-3 — Licensing Office + license-test route (most coupled)
- **Coupling:** the license-test **CP3 finish is at the current office door (14,−26)**; the test start gate measures distance to `LICENSING_OFFICE_POS`; `TEST_VEHICLE_SPAWN` sits beside it. Moving the office orphans the checkpoint.
- **Decision needed:** move the office **and** re-derive CP3 + test-vehicle spawn together (a coordinated route edit), or keep the office where it is and build a tighter footprint around it.
- **Catch:** CP0–CP2 are on-road and must NOT move; only CP3 (finish) and the spawn can follow the office. Needs the full license-test flow re-validated.
- **Steps:** choose move-vs-stay → if move, re-solve CP3 + `TEST_VEHICLE_SPAWN` with the office → footprint + OBB spawn validation → validators + tsc + a manual license-test run.

### 9B-4 — Police Station relocation (structural)
- **Coupling:** boxed between Medic (z=28) and Mechanic (z=−28) on the west wall; also anchors `POLICE_JAIL_CELL`, `POLICE_RELEASE_POS`, `POLICE_BOOKING_DESK_POS` (all offset from the station), and `STATION_SPAWN`/jail teleport targets in `rpPoliceService` + `gameServer`.
- **Decision needed:** give the station its own block (likely outside the −68 west strip). Every dependent point (jail/booking/release/spawn) must move as a rigid group and stay off-road + mutually consistent.
- **Catch:** highest blast radius — touches police arrest/booking/release flow and spawn. Treat as its own mini-phase with a full police-flow regression check.
- **Steps:** pick a block → translate the whole police cluster as a unit → footprint + all-point validation → add to `RP_BUILDINGS` + door → redirect gates/rings → validators + tsc + manual arrest→book→jail→release run.

## Verification (every batch)
Same gate as 9A: four `tsc` projects (enforced in-session), then api-server build + vite build + RP marker/building validators on the Mac. Mirror every moved coordinate server↔client. Commit per batch; push after Codex verification.
