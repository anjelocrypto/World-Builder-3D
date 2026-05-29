# Phase 10F — Final Civic Interior QA & Regression Sweep

**Result: ✅ PASS — no bugs found, no code changes required.** Read-only audit; git working tree unchanged.

## 1. Coordinate parity (server ↔ client) — ✅
All civic constants match exactly between `api-server/src/socket/cityData.ts` and `city-sandbox/src/shared/rpTypes.ts`:
GOVERNMENT_OFFICE_POS (−22,0,−22), LICENSING_OFFICE_POS (17,0,−29), MEDIC_CENTER (−68,0,28), POLICE_STATION (−68,0,64), POLICE_JAIL_CELL (−68,1,64), POLICE_RELEASE_POS (−68,1,72), POLICE_BOOKING_DESK_POS (−62,0,64), TAXI_DEPOT (−28,0,16), DELIVERY_HUB (58,0,−28), plus all `*_DOOR` constants. `RP_BUILDINGS` mirrors and doors derive correctly.

## 2. Collision scope — ✅
- `RP_INTERIOR_BUILDING_IDS` = exactly **government_office, licensing_office, medic_center, police_station** (the 4 intended).
- `RP_BUILDING_WALL_BOXES` generated from those ids only.
- `playerHitsAnyRpWall()` used only in the LocalPlayer **walking** path (lines 1098/1110); vehicle collision (1401-1402) uses only `vehicleHitsAnyBuilding` / `vehicleHitsAnyObstacle` — **RP wall boxes never enter the vehicle path.**

## 3. Geometry — ✅
Standalone validation of all 9 buildings + 4 desk anchors:
- Every footprint clears roads; building-to-building gaps ≥ 6 m; no parked-car overlap.
- Every door is off-road and **not blocked by its own wall**.
- Every desk anchor (City Hall (−22,−18.5), DMV (17,−26.5), Medical (−61.5,28), Police (−68,67.5)) is **inside the footprint, clear of walls, and within the door's gate radius** → a player at the desk ring still triggers the door-based server gate.

## 4. Server gates — ✅
- City Hall: 6 handlers still gate on `GOVERNMENT_OFFICE_DOOR`.
- DMV: license-test start still gates on `LICENSING_OFFICE_DOOR`.
- Medical: clock-in + clock-out (2) still gate on `MEDIC_CENTER_DOOR`.
- Police: clock-in + clock-out (2) still gate on `POLICE_STATION_DOOR`.
- **Zero server imports of the client `*_DESK` anchors** (confirmed; the only `*_DESK` server reference is the unrelated `POLICE_BOOKING_DESK_POS`).

## 5. Police safety — ✅
- `POLICE_JAIL_RADIUS = 6`.
- Validator (`validateRpBuildings`) asserts the radius fits the interior and clears the door (7 references).
- Jail cell, booking desk, release point all clear of wall boxes.
- Jail confinement clamp in `gameServer.ts` still reads `POLICE_JAIL_RADIUS` (6 references) — logic unchanged, only the constant.
- Jail visual ring matches radius 6 (`ringGeometry [5.5, 6]`).

## 6. Gameplay regressions — ✅ none
- License test: CP0 (2,−40), CP1 (42,−44), CP2 (42,−14) **unchanged**; CP3 finish at the relocated DMV door (17,−23.5). TEST_FEE = 200.
- Medic payout origin still `MEDIC_CENTER` (`calcMedicPay` line 1460).
- Police patrol points = 6, unchanged.
- Arrest/book/jail/release logic unchanged except the jail-radius constant.
- Mayor/government handlers unchanged; location validation still door-based.

## 7. Race removal still clean — ✅
No `CheckpointRace`, `raceActive`, `raceTime`, `racePassed`, `CHECKPOINTS`, `RAMPS`, `CheckpointData`, or `RampData` anywhere (excluding removal-note comments). RP job/license/gang checkpoints (`LICENSE_TEST_CHECKPOINTS`, `CITY_WORKER_CHECKPOINTS`, `TAXI_PICKUPS`, `GROVE_TAG_POINTS`, etc.) all present.

## Verification
- `tsc` × 4 (lib/db, lib/api-zod, api-server, city-sandbox): **all PASS**.
- Standalone building/desk geometry validation: **PASS**.
- api-server build, Vite build, and the `tsx` RP validators run on the Mac (esbuild macOS-binary limitation in the audit sandbox); `tsc` is the gate enforced here.

## Conclusion
The 10A–10E civic interior arc is internally consistent: collision is correctly scoped and player-only, server gates remain authoritative at the doors, the client desk anchors are visual-only and provably within range, police jail safety holds at radius 6, and no core RP gameplay regressed. **No fixes applied.**
