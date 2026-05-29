# Phase 9B-4 — Police Station Relocation (plan only)

**Status:** Audit + solver complete. **No coordinates changed yet.** This proposes the target block and the rigid-cluster translation for your approval before implementation.

## Why the police station must move
At (−68,14) the station is wedged on the west wall between Medic (−68,28) and Mechanic (−68,−28). A believable station footprint can't gain road clearance there without overlapping them (verified in the 9A audit). It needs its own block.

## The police cluster (rigid group)
Four coordinates move together as one unit. Offsets relative to `POLICE_STATION`:

| Constant | Current | Offset from station | Role |
|---|---|---|---|
| `POLICE_STATION` | (−68, 0, 14) | (0, 0) | precinct anchor + clock-in gate |
| `POLICE_JAIL_CELL` | (−68, 1, 14) | (0, 0) | jail teleport target + confinement centre |
| `POLICE_RELEASE_POS` | (−68, 1, 22) | (0, +8) | release teleport target |
| `POLICE_BOOKING_DESK_POS` | (−62, 0, 14) | (+6, 0) | booking interaction point |

**NOT part of the cluster (do not touch):**
- `POLICE_PATROL_POINTS` — 6 points, all on-road carriageways, unchanged (police drive to them; distance from the station is gameplay-irrelevant).
- `STATION_SPAWN` / `STATION_MARKER_POS` (128/132, −65) — this is the **Central Loop transit/player spawn platform** on the far east, NOT the police station. Out of scope.

## Proposed target: (−68, 64) — SW outer block
Translation vector: **(0, +50)** — the whole cluster slides +50 on z, same x=−68 column.

| Constant | Current → Proposed |
|---|---|
| `POLICE_STATION` | (−68,14) → **(−68,64)** |
| `POLICE_JAIL_CELL` | (−68,14) → **(−68,64)** |
| `POLICE_RELEASE_POS` | (−68,22) → **(−68,72)** |
| `POLICE_BOOKING_DESK_POS` | (−62,14) → **(−62,64)** |

Verified for a 20×14 station footprint at (−68,64):
- footprint clears all road carriageways (road edge 2.0 m)
- ≥6 m from every other RP building (min gap 24 m, to Medic)
- nearest parked car 27.7 m (car-13)
- release (−68,72) and booking (−62,64) both off-road
- jail confinement (`POLICE_JAIL_RADIUS`=8 around jail cell) stays fully off-road and clear of buildings

Why this block: it's the SW outer-corner residential block, directly south of the Medic center on the same west civic line — reads as a "west-side civic strip" (hospital / mechanic / police precinct) with the precinct now in its own block instead of jammed between the other two. The +50 z move is the smallest that escapes the Medic/Mechanic squeeze while keeping the x=−68 identity.

## Flow dependencies to update (all use the constants, so they move automatically — but each must be re-verified)
1. **Arrest → jail teleport** (`rpPoliceService` ~L512): teleports arrestee to `POLICE_JAIL_CELL`. Moves with the constant.
2. **Jail confinement** (`gameServer` ~L309–363): clamps jailed players within `POLICE_JAIL_RADIUS` of `POLICE_JAIL_CELL`. Moves with the constant; re-verify the clamp zone is off-road at the new spot (it is).
3. **Booking** (`rpPoliceService` ~L570): officer must be within `POLICE_BOOKING_RADIUS` of `POLICE_BOOKING_DESK_POS`. Moves with the constant.
4. **Release teleport** (`rpPoliceService` ~L643): teleports released player to `POLICE_RELEASE_POS`. Moves with the constant.
5. **Station clock-in gate** (police patrol job): proximity to `POLICE_STATION`. Will be redirected to the new `POLICE_STATION_DOOR`.
6. **Client rings** (`RPMarkers`): station / jail / booking / release rings — move with the constants; reduce the station signpost (Batch-D style); add a `police_station` building + `POLICE_STATION_DOOR`.
7. **Validators** (`rpValidators`): police markers are read from the constants (not hardcoded), so they follow automatically — but the new `police_station` footprint gets added to `RP_BUILDINGS` and picked up by `validateRpBuildings`.

## Proposed implementation order (when approved)
- **9B-4a Data:** translate the 4 cluster constants by (0,+50), mirror server↔client. Add `police_station` (20×14, choose facing — likely **south**, door toward z=0) to `RP_BUILDINGS` + `POLICE_STATION_DOOR`.
- **9B-4b Gates/flow:** redirect the station clock-in gate + client ring/prompt to the door; reduce signpost; add signage. Confirm jail/booking/release teleports + confinement read the moved constants.
- **9B-4c Verify:** tsc x4 + standalone validator (9 buildings) + jail-confinement-zone geometry + a full manual **arrest → cuff → book → jail → release** regression run on the Mac.

## Confirmed decisions (locked — awaiting implementation go-ahead)
- **Target block: (−68, 64)** — SW block, cluster translated by (0, +50). ✅ confirmed.
- **Station facing: south** — door at **(−68, 72.5)**, toward the interior, clear of the z=45 road. ✅ confirmed.

Final cluster coordinates for 9B-4a (for reference, NOT yet applied):
| Constant | → New |
|---|---|
| `POLICE_STATION` | (−68, 0, 64) |
| `POLICE_JAIL_CELL` | (−68, 1, 64) |
| `POLICE_RELEASE_POS` | (−68, 1, 72) |
| `POLICE_BOOKING_DESK_POS` | (−62, 0, 64) |
| `police_station` building | centre (−68, 64), 20×14, facing south |
| `POLICE_STATION_DOOR` | (−68, 72.5) |

**Status: plan finalized. No coordinates edited. Awaiting your go-ahead to implement 9B-4a.**
