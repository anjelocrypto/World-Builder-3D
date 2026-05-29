# Phase 9B — Deferred Civic Buildings (plan)

Phase 9A (A–E) built real shells + door-aligned interaction for the 5 unconstrained civic buildings. Four locations were deferred because each has coupling beyond "place a footprint." This plan sequences them lowest-risk first. Each becomes its own reviewed batch; nothing here is implemented yet.

## Shared groundwork (do once, first)
Extend `RP_BUILDINGS` only after each location's coordinate/coupling decision is locked, so the footprint validator and `RPBuildings` renderer pick them up automatically (same pattern as 9A-B/C). Reuse `rpBuildingDoor()` + the `*_DOOR` gate pattern from 9A-E. No new systems needed.

## Batch ordering (risk-ascending)

### 9B-1 — Taxi Depot building ✅ COMPLETE (commit bc6fc20)
- **Coupling:** proximity gate only (clock-in/out). Taxi fare is pickup→dropoff distance, **not** depot-based, so payouts are unaffected — verified unchanged.
- **Outcome:** `TAXI_DEPOT` moved (−30,−15) → **(−28,16)**, 31 m. The old origin's pocket is occupied by the City Hall footprint, and no taxi footprint fits there without overlapping it; the only all-clearances-pass spot is the SW-north pocket. Built as a compact **10×8** yard, facing south, door at **(−28,21.5)**. Road edge 2.0 m; nearest car 8.5 m; nearest building 26 m; nearest taxi pickup (P3) 14.6 m.
- **Shipped:** moved `TAXI_DEPOT` (server/client mirror); added `taxi_depot` to `RP_BUILDINGS` + `TAXI_DEPOT_DOOR`; redirected both clock-in/out gates, client prompt, and visual ring to the door; reduced the old signpost to a subtle marker (Batch-D style); added the TAXI DEPOT building style. Pickups/dropoffs/fare math untouched. All tsc + API/Vite builds + RP validators pass.

### 9B-2 — Delivery Hub building ✅ COMPLETE (commit e489591)
- **Coupling:** `DELIVERY_HUB` is a **payout origin** (`calcDeliveryPay(DELIVERY_HUB, …)`).
- **Decision taken:** option (a) — kept the payout origin fixed at (58,−28); introduced a separate building + door.
- **Outcome:** added a `delivery_hub` warehouse building at centre **(66,−26)**, 18×14, facing **west**, door at **(55.5,−26)**. The unchanged payout origin sits *inside* the footprint (warehouse-over-dock). Gates (clock-in/out) + ring + prompt redirected to the door; signpost reduced; "DELIVERY HUB" signage added. Road edge 2.0 m; nearest car 32 m; nearest building 31 m. **Delivery payout math unchanged** — verified.

### 9B-3 — Licensing Office + license-test route ✅ COMPLETE (commit 9a2ffd7)
- **Coupling:** license-test CP3 finish at the office door; start gate measures to `LICENSING_OFFICE_POS`; `TEST_VEHICLE_SPAWN` beside it.
- **Decision taken:** moved the office and re-derived **only** the coupled finish/spawn; CP0–CP2 untouched.
- **Outcome:** office (14,−30) → **(17,−29)** as a 10×8 DMV, facing **south**, door at **(17,−23.5)**. CP3 re-derived to **(17,−23.5)** (coincides with the door — drive-up finish). `TEST_VEHICLE_SPAWN` (13,−30) → **(11,−30)**, OBB-verified clear of all carriageways. Start gate + ring + prompt redirected to the door; signpost reduced; "DMV / AUTO SCHOOL" signage added. Updated the 5 hardcoded validator/OBB literals. **Test fee, license-grant logic, socket events unchanged.** Road edge 2.0 m; nearest car 8.6 m; nearest building 25 m.

### 9B-4 — Police Station relocation (structural)
- **Coupling:** boxed between Medic (z=28) and Mechanic (z=−28) on the west wall; anchors `POLICE_JAIL_CELL`, `POLICE_RELEASE_POS`, `POLICE_BOOKING_DESK_POS` (all offset from the station) plus the jail/release teleport targets in `rpPoliceService` + the jail-confinement clamp in `gameServer`. **NOT** related to `STATION_SPAWN`/`STATION_MARKER_POS` — those are the far-east transit / player-spawn platform (128/132,−65) and are **out of scope** for the police cluster.
- **Decision needed:** give the station its own block (likely outside the −68 west strip). Every dependent point (jail/booking/release) must move as a rigid group and stay off-road + mutually consistent.
- **Catch:** highest blast radius — touches the police arrest/booking/jail/release flow. Treat as its own mini-phase with a full police-flow regression check.
- **Steps:** pick a block → translate the whole police cluster as a unit → footprint + all-point validation → add to `RP_BUILDINGS` + door → redirect gates/rings → validators + tsc + manual arrest→book→jail→release run.

## Verification (every batch)
Same gate as 9A: four `tsc` projects (enforced in-session), then api-server build + vite build + RP marker/building validators on the Mac. Mirror every moved coordinate server↔client. Commit per batch; push after Codex verification.
