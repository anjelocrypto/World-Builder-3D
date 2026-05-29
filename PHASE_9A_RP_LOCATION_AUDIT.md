# Phase 9A — Center-City RP Location & Building Audit

**Status:** Audit complete. **Batch A is implemented and committed** (commit `98e655c`) — it moved Government Office, City Worker Depot, car-2, and car-3 only. Batches B–E are still pending.
**Method:** Coordinates read directly from `artifacts/api-server/src/socket/cityData.ts`; distances and footprint/road checks computed programmatically against the road grid in `rpValidators.ts` (N-S carriageways at x ∈ {−45, 0, 45}, E-W at z ∈ {−45, 0, 45}, each 20 m wide, half-width 10).

---

## 1. How locations are built today

Every RP location is a **point marker** plus an **interaction ring**. `RPMarkers.tsx` draws flat ring/pad geometry and signposts; there are no walls, roofs, doors, or interiors. The world's *real* buildings (`BUILDINGS` in client `cityData.ts`) are procedurally generated block fills and hand-placed towers that sit in the corner blocks (|x| or |z| ≥ 55) and the outer ring (80–94) — **none of them coincide with RP locations**. So civic services live in empty gaps between generic towers, marked only by a glowing disc. That is the "round stick placeholder" feel you described.

The startup validators (`validateRpMarkers`, `validateRpMarkerVehicleClearance`) only check **points**: is this single (x,z) inside a carriageway, inside a (currently empty) obstacle list, or within 8 m of a parked car. They do **not** check building footprints, building-to-building clearance, or entrance reachability. So a marker can pass today while a real building on the same spot would clip a road.

---

## 2. Full RP location table (center city)

Distances: `roadEdge` = clearance from footprint-free point to nearest carriageway edge; `nearCar` = nearest center-hub parked car; `nearRP` = nearest other RP location.

| Location | Coord (x,z) | Purpose | roadEdge | nearCar | nearRP | On/off road | Verdict |
|---|---|---|---|---|---|---|---|
| POLICE_STATION | (−68, 14) | Police HQ | 4.0 m | 25.6 | 0.0 (jail) | off ✓ | **Building** — too tight for footprint |
| POLICE_BOOKING_DESK | (−62, 14) | Booking inside station | 4.0 m | 23.1 | 6.0 (station) | off ✓ | Interior point (intentional) |
| POLICE_JAIL_CELL | (−68, 14) | Jail cell | 4.0 m | 25.6 | 0.0 (station) | off ✓ | Interior point (intentional, y-stacked) |
| POLICE_RELEASE_POS | (−68, 22) | Release exit | 12.0 m | 32.7 | 6.0 (medic) | off ✓ | Exit point — **too close to Medic** |
| GOVERNMENT_OFFICE | (−22, −32) | City Hall / Mayor | 3.0 m | 10.0 | 18.8 (taxi) | off ✓ | **Building** — very tight (3 m) |
| LICENSING_OFFICE | (14, −30) | DMV / auto school | 4.0 m | 11.3 | 1.0 (test veh) | off ✓ | **Building** — tight |
| TEST_VEHICLE_SPAWN | (13, −30) | License test car | 3.0 m | 12.0 | 1.0 (office) | off ✓ | Spawn point (intentional, beside office) |
| DEALERSHIP | (68, −72) | Vehicle showroom | 13.0 m | 27.1 | 4.0 (its pad) | off ✓ | **Building** — has room ✓ |
| DEALERSHIP_DELIVERY_PAD | (68, −68) | New-car delivery pad | 13.0 m | 27.1 | 4.0 (dealership) | off ✓ | Pad (intentional) |
| MEDIC_CENTER | (−68, 28) | Hospital / clinic | 7.0 m | 33.7 | 6.0 (release) | off ✓ | **Building** — has room ✓ |
| MEDIC_ER_BAY | (−45, 28) | Ambulance ER pull-up | — | 12.2 | 22.0 | **on road (intended)** | Road-side bay (intentional) |
| MECHANIC_GARAGE | (−68, −28) | Repair garage | 7.0 m | 23.9 | 40.2 | off ✓ | **Building** — has room ✓ |
| TAXI_DEPOT | (−30, −15) | Taxi yard | 5.0 m | 10.6 | 18.8 (gov) | off ✓ | **Depot** — tight |
| DELIVERY_HUB | (58, −28) | Delivery warehouse | 3.0 m | 24.0 | 41.2 | off ✓ | **Depot** — very tight (3 m) |
| CITY_WORKER_DEPOT | (30, 28) | Public-works yard | 5.0 m | 8.6 | 60.2 | off ✓ | **Depot** — tight + car at 8.6 m |
| STATION_SPAWN | (128, −65) | Player spawn / transit | 10.0 m | 87.1 | 60.1 | off ✓ | Platform (fine) |
| GROVE_HANGOUT / TURF | (95, 65) | Gang turf | 10.0 m | 67.1 | 74.8 | off ✓ | Plaza/turf — keep as zone ✓ |

ATMs (5): `atm-central (18,−30)`, `atm-station (132,−58)`, `atm-police (−80,64)` *(moved with the police station in 9B-4; was (−80,14))*, `atm-medical (−80,28)`, `atm-dealership (82,−78)` — small kiosks, all off-road; keep as kiosks, just need a real kiosk mesh instead of a stick.

---

## 3. Bad placements (paranoid findings)

**P1 — Footprints clip roads.** A believable building centered on the current marker would intrude into a carriageway for: **POLICE_STATION, GOVERNMENT_OFFICE, LICENSING_OFFICE, TAXI_DEPOT, DELIVERY_HUB, CITY_WORKER_DEPOT.** These all sit only 3–5 m off a road edge — fine for a glowing disc, not for a 14–20 m wide building. This is the root cause of the placeholder feel and the central thing Phase 9A must fix.

**P2 — West column is stacked.** On the x ≈ −68 line we have, from north to south: MEDIC_CENTER (z 28), POLICE_RELEASE (z 22), POLICE_STATION/JAIL (z 14), MECHANIC_GARAGE (z −28). Police release exit is **6 m** from the hospital and the police/medic/mechanic all share one wall line. Three different civic identities crammed into one strip reads as "markers", not "districts".

**P3 — CITY_WORKER_DEPOT is 8.6 m from car-8** (35,35) — passes the 8 m rule by 0.6 m. A real depot yard would immediately overlap that parked car.

**P4 — Validators are point-only.** No footprint, no building-to-building clearance, no entrance-reachability, no road-overlap-for-rectangles check. Nothing stops a future building from clipping a road or another building.

**Intentional / NOT bugs (leave alone):** booking desk inside station, jail cell y-stacked on station, dealership pad beside dealership, test vehicle beside licensing office, and MEDIC_ER_BAY deliberately on-road (ambulance pull-up). These "VERY CLOSE" pairs are by design.

---

## 3b. VERIFIED Batch A layout (computed, all checks pass)

My initial §4 deltas (below) were eyeballed and **failed computed verification** — they clipped roads and crowded cars. The numbers here are from a joint solver (road-clearance ≥1.5 m, building-to-building gap ≥6 m, parked-car clearance ≥2 m from footprint). During implementation the scope was deliberately narrowed (see §3c) to only the moves with **no route or payout coupling**, so the **actually committed** Batch A is smaller than the solver's full candidate set.

### Buildings — ACTUALLY COMMITTED in Batch A (commit `98e655c`)

Only two buildings were relocated; three kept their coordinates (no move). No other civic building moved.

| Building | Old (x,z) | New (x,z) | W×D (planned) | Disp | Road edge | Economy | Status |
|---|---|---|---|---|---|---|---|
| GOVERNMENT_OFFICE | (−22,−32) | **(−22,−22)** | 18×12 | 10 m | 3.0 m | none (proximity gate) | ✅ moved |
| CITY_WORKER_DEPOT | (30,28) | **(24,24)** | 16×12 | 7 m | 3.0 m | none (clock-in gate) | ✅ moved |
| MEDIC_CENTER | (−68,28) | (−68,28) **no move** | 18×10 | 0 | 2.0 m | payout origin — unchanged | ⏸ no move |
| MECHANIC_GARAGE | (−68,−28) | (−68,−28) **no move** | 18×10 | 0 | 2.0 m | none | ⏸ no move |
| DEALERSHIP | (68,−72) | (68,−72) **no move** | 22×16 | 0 | 2.0 m | none | ⏸ no move |

### Parked cars — ACTUALLY COMMITTED in Batch A — 2 moved, both off-road

Only the two cars sitting inside the two relocated footprints were moved. car-0 and car-1 were **not** moved (their nearby buildings — Licensing/Taxi — were deferred).

| Car | Old (x,z) | New (x,z) | Move | Reason | Status |
|---|---|---|---|---|---|
| car-2 | (22,22) | **(22,15)** | 7 m | clear new City Worker depot footprint | ✅ moved |
| car-3 | (−22,−22) | **(−22,−31)** | 9 m | clear new City Hall footprint | ✅ moved |

Both are plaza-corner decorative cars (not job vehicles or route points). Mirrored in server `INITIAL_VEHICLES` + client `INITIAL_VEHICLES`. Verified post-move: both off-road, ≥6 m from other cars, and every off-road RP marker still clears all parked cars by ≥8 m (Taxi Depot's nearest-car clearance actually improved from 10.6 m → 17.9 m because car-3 moved away).

---

## 3c. Deferred / rejected solver candidates (NOT implemented)

The joint solver also proposed moving the locations below, but they were **dropped from Batch A** because each conflicts with the "don't move route checkpoints / flag payout math" rules. They remain as-is in the code; revisit in a later, separately-reviewed batch.

| Candidate | Solver proposed | Why deferred (NOT committed) |
|---|---|---|
| LICENSING_OFFICE | (14,−30) → (22,−22) | Deferred from 9A (CP3 finish coupling). **✅ Completed in Phase 9B-3** (commit 9a2ffd7): moved to **(17,−29)** as a 10×8 DMV; CP3 re-derived to the door; CP0–CP2 unchanged; test fee/license logic unchanged. |
| TEST_VEHICLE_SPAWN | (13,−30) → (22,−15) | Moved *with* the office in **9B-3** to **(11,−30)** (OBB-verified clear of roads). |
| TAXI_DEPOT (building) | (−30,−15) → (−22,24) | A real taxi-yard footprint forces a relocation (its origin shares City Hall's NW pocket). Deferred from 9A. **✅ Completed in Phase 9B-1** (commit bc6fc20): relocated to **(−28,16)** as a 10×8 yard; fare math unchanged. |
| DELIVERY_HUB | (58,−28) → (66,−26) | Deferred from 9A (payout origin). **✅ Completed in Phase 9B-2** (commit e489591): payout origin kept fixed at (58,−28); added a separate warehouse building at (66,−26) + door at (55.5,−26). Delivery pay unchanged. |
| POLICE_STATION | (−68,14) → (−68,21) | Deferred from 9A (boxed between Medic/Mechanic). **✅ Completed in Phase 9B-4** (commits 4356dd1 / e8f0b9e): whole police cluster relocated (0,+50) to its own SW block — `POLICE_STATION`/`POLICE_JAIL_CELL` **(−68,64)**, `POLICE_RELEASE_POS` **(−68,72)**, `POLICE_BOOKING_DESK_POS` **(−62,64)**; 20×14 station building + door (−68,72.5); arrest/booking/jail/release logic unchanged. |
| car-0 | (22,−22) → (22,−31) | Only needed if Licensing moves; Licensing deferred, so car-0 **unchanged**. |
| car-1 | (−22,22) → (−22,15) | Only needed if the Taxi building moves; deferred, so car-1 **unchanged**. |

---

## 4. (Superseded) original eyeballed proposal

Principle: give each civic building a real footprint with ≥ 4 m clearance from every carriageway edge and ≥ 6 m from any other civic building, with a clearly-faced entrance and the interact ring moved to the door. Job depots become real yards with a gated front. Where a current marker can't host a footprint without clipping a road, nudge it **away from the nearest road**, not across town — so existing routes/checkpoints barely move.

Candidate moves (to be finalized in Batch A, all mirrored server↔client):

| Location | Old (x,z) | Proposed (x,z) | Why |
|---|---|---|---|
| GOVERNMENT_OFFICE | (−22, −32) | (−30, −34) | gain road clearance 3→7 m for City Hall footprint |
| LICENSING_OFFICE | (14, −30) | (20, −34) | clear road for DMV footprint; keep test-car + CP3 relation |
| TAXI_DEPOT | (−30, −15) | (−32, −20) | clear road for taxi yard; stay near pickups |
| DELIVERY_HUB | (58, −28) | (64, −34) | 3→8 m clearance for warehouse |
| CITY_WORKER_DEPOT | (30, 28) | (34, 34) | clear road + clear car-8 |
| POLICE_RELEASE_POS | (−68, 22) | (−74, 20) | open 6 m gap to Medic; tuck against station |
| MEDIC_CENTER | (−68, 28) | (−72, 36) | separate hospital from police strip |

Police Station, Dealership, Mechanic already have enough room and would keep their coordinates; they only need real building meshes. **These specific deltas are proposals — I'd confirm them with you before editing, because every moved coordinate has to stay consistent with its job route checkpoints (which are on-road and must NOT move).**

---

## 5. Building design approach (Batch C/D)

A small, data-driven `RPBuilding` component: low-poly shell (walls + flat/low roof), a front opening (door gap) facing a specified direction, 1–2 window strips, a colored fascia sign, and an optional open-front lobby for the big civic buildings (Police, City Hall, Medic) so the player can walk in to the interact point. Each building defined by `{ pos, w, d, h, facing, label, color, kind }` in shared data so the server validator and the client renderer read the same footprint. Interiors stay empty shells (no furniture clutter, no orbs) for performance. Marker rings shrink to a subtle door affordance.

---

## 6. Validator upgrades (Batch B)

Add footprint-aware checks alongside the existing point checks:
- `footprintHitsRoad(cx,cz,w,d,facing)` — reject any civic footprint overlapping a carriageway (except kiosks/road-side bays explicitly flagged).
- building-to-building min clearance (≥ 6 m) across all RP buildings.
- entrance/interact point must be off-road, reachable (not inside its own or another footprint), and within N m of the building front.
- parked-car clearance vs. the **footprint**, not just the center point.
- mirror-check: assert server `cityData.ts` and client `rpTypes.ts` coordinates match.

---

## 7. Implementation plan (small commits)

- **A. Data/coordinate cleanup** — finalize moves in §4, mirror server↔client, keep job routes fixed. Verify with existing validators.
- **B. Validator footprint checks** — add the §6 checks; prove no footprint clips a road or another building.
- **C. Building component system** — `RPBuilding` + shared building table. No placement change.
- **D. Replace civic stick markers with buildings** — Police, City Hall, DMV, Medic, Mechanic, Dealership, depots.
- **E. Align prompts/interact rings to doors** — move interact rings to entrances; update HUD prompt anchors.

Gameplay, economy, jobs, police, and faction logic stay byte-for-byte unchanged except where a relocated coordinate forces a constant update (mirrored on both sides).

---

## 8. Verification status

`tsc` for all four projects (lib/db, lib/api-zod, api-server, city-sandbox) runs natively in this environment and is the gate I can fully enforce here. The esbuild-based `api-server` build, `vite` build, and `tsx` RP validators must run on your Mac — the installed `node_modules` carry the macOS esbuild binary, which can't execute on this Linux sandbox, and the package registry is firewalled so I can't install the Linux build. I run all four `tsc` checks here after every batch and hand you the three esbuild steps to run before each commit.
