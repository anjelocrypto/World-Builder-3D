# Phase 13A — Full World Map Structure & Placement Audit

**Originally an audit-only report.** All findings below are computed (seeded building generator
replicated exactly; distances/overlaps calculated in code), not eyeballed. **Status:** Batch A
(§8), the post-audit house relocation (§9–§10), Batch B full-map validators (§11), and Batch C
parked-car / NPC + traffic validators (§12) are implemented and verified; Batches D–F remain
optional polish, pending approval.

---

## 1. Executive Summary

**Overall map quality: 78 / 100.**

**Structurally coherent, with one real defect and several unenforced rules.** The world reads as
a deliberately planned place: a dense gridded city core, a ring road, an outer loop, themed
biomes (mountain north, bridge→forest south, industrial east, fields west), a peri-city
homestead belt, an elevated rail loop with a station, and a forest village with its own road
network. The *hand-placed* RP systems (buildings, houses, jobs, ATMs, gang turf, spawns) are
tightly validated. It is **not patchy** in layout intent — but it is *patchy in enforcement*:
the procedural building generator is invisible to every validator, and a deterministic replay
(seed = 42) shows **21 procedural towers physically clipping 5 of the 9 RP civic buildings.**
That is the single structural bug; the rest are cosmetic (towers merging) or coverage gaps.

### Top 10 issues (ranked)

| # | Sev | Issue |
|---|-----|-------|
| 1 | **P1** | 21 procedural buildings overlap 5 RP civic buildings (dealership ×6, police_station ×6, medic_center ×3, mechanic_garage ×3, delivery_hub ×3). Towers clip the civic shells. (§5.1) |
| 2 | **P2** | Procedural `GENERATED_BUILDINGS` (52) are unvalidated against everything — RP buildings, houses, cars, roads. (§4 matrix) |
| 3 | **P2** | `validateRpMarkers` / `validateVehicleSpawnOBB` / `safeStationSpawn` accept an `obstacles` arg but are invoked with `[]` — STATIC_OBSTACLES never enforced against markers/spawns. (§5.3) |
| 4 | **P2** | No validator for trees/flora (~600), NPC/traffic routes (9 loops), STATIC_OBSTACLES footprints, bridge, or rail. (§4) |
| 5 | **P3** | 92 procedural building *pairs* overlap each other → merged/blobby towers in corner blocks. (§5.2) |
| 6 | **P3** | Legacy `SPAWN_POINTS` plaza fallback: 4 of 8 points sit on road centerlines (0,−12),(12,0),(−12,0),(0,12). Deprecated (station spawn is active) but live as offline fallback. (§5.4) |
| 7 | **P3** | `footprintHitsRoad` treats city roads as *infinite lines* (no z/x bound). Harmless for in-city RP objects, but cannot be reused for rural objects without bounding road length. (§5.5) |
| 8 | **P3** | Rural parked cars (car-14…27) trusted via comments ("parks on a pad/spur"); no programmatic on-road/on-pad assertion. Regional-road placement is unchecked (needs polyline distance). (§5.6) |
| 9 | **P3** | 6 city cars at carriageway edges (car-4,5,6,7,12,13) — almost certainly intentional kerbside parking, but nothing marks them intentional vs a stray. (§5.7) |
| 10 | **P3** | Render-only systems (25 mountain massifs, bridge deck, 4 skybridges, rail deck/train) have no collision and no validator — correct by design, but undocumented. (§3) |

### Top 10 things already strong

1. RP building validator is footprint-aware: road clearance, ≥6 m building-to-building gap, parked-car-inside, door reachable/off-road, door-not-blocked-by-own-wall, police jail-confinement geometry.
2. RP house validator (12A): road, RP gap, cars, door reach, house-to-house, interior-inside-shell, + spawn/checkpoint/ATM/turf clearance.
3. All 3 RP houses are clear of the *broader* map: ≥88 m from homesteads, outside the 125–230 city-edge tree belt (so no tree spawns on them), no procedural/car overlap. (§5.8)
4. Inner-ring RP buildings (city hall, public works, taxi depot, licensing) are clear of procedural blocks. (§5.1)
5. Server↔client constant mirror is clean — every shared coordinate is identical; route/payout constants are intentionally server-only (anti-cheat).
6. Legacy road-race CHECKPOINTS/RAMPS/CheckpointRace system is fully removed; only job/license checkpoints remain.
7. City parked cars: none overlap any RP building footprint (9A relocations of car-2/car-3 hold) and none overlap a procedural building.
8. Traffic loops ride real roads (outer loop on the grid perimeter, inner loop on the ±100 ring); NPC pedestrian loops sit in the sidewalk band, off carriageway.
9. Flora scatter generators already reject points near roads, clearings, obstacles, lamps, vehicles, parking, and homestead yards (good *generation-time* hygiene even without a validator).
10. World edge is respected: nothing buildable sits near the ±499 clamp; only terrain massifs (±498) and ridge-far roads (±495) approach it, walled by ramparts.

---

## 2. Full World Structure

**City core (`±100`).** A 3×3 road grid (centerlines x,z ∈ {−45,0,45}, carriageway w20 + 2 m
sidewalks, bounded to length 200). 12 building blocks: four 30×30 corner blocks, edge blocks
split 15×30 around the bisecting road, and an empty central plaza (spawn area). 52 procedural
mid-rises (downtown/commercial/residential districts), 8 highrises on the ±86 ring, 5 landmark
towers on the ±87 corners (both rings deliberately in the empty 80–94 gap). An elevated octagonal
**rail loop** (r≈110, deck y=12) with a moving train and **Central Loop Station** at (110,−65),
plus 4 skybridges at y=10. This is where all civic/economy life sits.

**North = mountain (`z −500…−100`).** A switchback spine climbs from the city; ridge roads branch
east/west with real elevation profiles (`ROAD_ELEVATION_PROFILES`). 25 massif domes form
render-only terrain; cliff walls, boulders, guardrails, and a summit observatory are collidable.
4 parked cars on the passes.

**South = bridge → forest (`z 100…500`).** A bridge (z 130–180, rails x=±9) crosses a ravine into
the **South Forest Village**: gas stop, lodge, general store, inn, two ranger stations, 5 cabins,
on a dirt loop with driveways and a trailhead. ~220 scattered trees + 60 rocks with 9 clearing
rectangles keeping structures clear. 6 parked cars on pads/driveways.

**East (`x 100…500`).** Industrial: a service road, 4 warehouses, a water tower, suburban
driveways. 3 parked cars. The station spawn (128,−65) sits at the city/east seam.

**West (`x −500…−100`).** Rural fields: a utility road and 2 depots. 1 parked car. The least
populated zone.

**Peri-city belt (~±125).** 12 homestead cottages in 4 clusters (N/S/E/W) with yards, gated
fences (2 m gap), and 4 m dirt driveways connecting to the inner-ring road. ~420 city-edge trees
in the 125–230 ring soften the city→wilderness transition.

**Road hierarchy (feels planned):** city grid (w20) → inner-city ring at ±100 (w12) → outer loop
(w14) → regional spurs/ridge/connectors (w8–12) → driveways (w4–6). 42 regional polyline roads.
Elevation-aware in the mountains. The hierarchy is consistent and legible.

**Zoning:** civic/economy = city core; residential = SW/S blocks + peri-city homesteads + the 3 RP
houses on the quiet corners (±92); industrial = east warehouses + west depots; gang = Grove Street
turf at (95,65), r30, in the SE outskirts; rural/nature = forest village + mountain + fields.

---

## 3. Computed Geometry Audit (math, not eyeballing)

Method: replayed `seededRandom(42)` + `genBuilding` over `blockDefs` (rng call order/count and
DISTRICTS dimension ranges verified against source) to recover the exact 52 procedural
footprints; AABB-overlap and edge-distance math for the rest.

- **Procedural building vs city grid roads:** 0 on-road ✓ (the 5 m block padding holds).
- **Procedural building vs RP buildings:** **21 overlaps across 5 RP buildings** ✗ (§5.1). The 4 inner-ring RP buildings are clear.
- **Procedural building vs RP houses:** 0 ✓.
- **Procedural building vs city parked cars:** 0 ✓.
- **Procedural building vs each other:** **92 overlapping pairs** (merged towers, cosmetic) (§5.2).
- **Parked cars vs roads:** 8/14 city cars off-road; 6 at carriageway edges (intentional kerbside) (§5.7). Rural cars: regional-road placement unchecked (polyline distance not computed here).
- **Parked cars vs RP buildings:** 0 overlaps ✓. **vs procedural buildings:** 0 ✓. **vs RP houses:** 0 ✓.
- **Player spawns:** active station spawn box (124–132, −68…−62) is clear (nearest building 68 m; ATM 4 m; flat ground) ✓. Legacy plaza `SPAWN_POINTS`: 4/8 on road centerlines ✗ (deprecated) (§5.4).
- **Traffic route points:** outer loop on grid perimeter; inner loop on the ±100 ring; regional routes follow regional polylines — on-road by construction ✓. NPC pedestrian loops at block-edge+3 → sidewalk band, off carriageway ✓.
- **NPC routes vs buildings/obstacles/houses:** not separately validated; spot-checks of the city loops show no incursion into block footprints (loops run on roads between blocks). Mountain/forest traffic rides the same roads obstacles were generated to avoid.
- **RP buildings/houses vs the FULL client world (not just server data):** houses clear of homesteads/tree-belt/procedural (§5.8); the RP-building clip (§5.1) is exactly the full-world cross-check the server-only validator misses.
- **Train/rail/bridge/station render vs collision:** rail loop, train, station, skybridges, and the bridge deck are render-only (no collision); the player collides only with `bridge_rail` AABBs and walks under skybridges/rail at ground level. Consistent and intentional, but unasserted.
- **World edge:** no buildable object near the ±499 clamp; massifs at ±498 (terrain), ridge-far roads at ±495 (4 m from clamp, walled by ramparts). ✓

---

## 4. Validator Coverage Matrix

`V1=validateRpBuildings`, `V2=validateRpHouses`, `V3=validateRpMarkers`,
`V4=validateRpMarkerVehicleClearance`, `V5=validateVehicleSpawnOBB`, `V6=safeStationSpawn`.

| Category | Covered | Validator | Checks | Misses |
|----------|---------|-----------|--------|--------|
| Center roads | YES | V1/V2/V3 (`footprintHitsRoad`/`isInCarriageway`) | footprint & point vs grid | treats roads as infinite lines (no length bound) |
| Regional roads | NO | — | — | no polyline placement/continuity check |
| Procedural buildings | NO | — | — | everything (road, RP, car, house, self-overlap) |
| Landmark/highrise buildings | PARTIAL | (design) | sit in empty 80–94 ring by construction | not asserted in code |
| Static obstacles | PARTIAL | V3/V5/V6 *(param)* | would check IF `obstacles` were passed | always called `[]` → effectively NO |
| Homestead houses/fences | NO | — | — | vs roads, driveways, trees, each other |
| Trees / flora | NO | — | (generation-time rejection only) | no startup assertion |
| Rocks | NO | — | (generation-time rejection only) | no startup assertion |
| Parked cars | PARTIAL | V1/V4 | inside RP footprint; 8 m from markers | vs procedural/static obstacles/regional roads |
| NPC traffic routes | NO | — | — | waypoints vs roads/buildings/obstacles |
| Player spawns | PARTIAL | V3/V6 | station spawn off-road + (would-be) obstacle | legacy plaza points unvalidated & on-road |
| RP buildings | YES | V1 | road, gap, cars, doors, walls, jail geom | vs procedural buildings, trees, obstacles |
| RP houses | YES | V2 | road, RP gap, cars, doors, house gap, interior, markers | vs procedural buildings, trees, homesteads |
| ATMs | YES | V3 | off-road + (would-be) obstacle | footprint n/a (points) |
| Job checkpoints | YES | V3/V4 | on/off-road per role + 8 m car clearance | vs procedural buildings |
| Train station / rail / bridge | NO | — | — | render-vs-collision consistency unasserted |
| Gang turf | YES | V3 (point) + V2 (house clearance) | hangout/tag off-road; houses clear turf radius | turf circle not used elsewhere |
| Old race system remnants | YES (removed) | grep-confirmed | n/a | none — fully gone |

---

## 5. Specific Findings

### 5.1 — P1 — Procedural towers clip 5 RP civic buildings *(deterministic, seed 42)*
**Objects & overlaps** (procedural building index → RP building):

- **dealership** (68,−72) 22×16 ← gen #14 (65.2,−65.0), #15 (60.7,−66.2), #16 (66.2,−65.3), #17 (66.3,−64.8), #18 (62.1,−63.1), #19 (64.3,−64.3)
- **police_station** (−68,64) 20×14 ← gen #32 (−68.0,67.1), #33 (−68.0,67.8), #34 (−66.3,68.8), #35 (−63.1,71.2), #36 (−63.2,66.0), #37 (−63.1,69.6)
- **mechanic_garage** (−68,−28) 18×10 ← gen #20 (−60.8,−22.5), #21 (−64.4,−22.5), #22 (−62.2,−22.5)
- **medic_center** (−68,28) 18×10 ← gen #23 (−62.9,22.5), #24 (−64.9,22.5), #25 (−63.4,22.5)
- **delivery_hub** (66,−26) 18×14 ← gen #26 (69.6,−22.5), #27 (65.7,−22.5), #28 (63.7,−22.5)

**Computed:** AABB overlap on both axes (e.g. dealership↔gen#17: Δx 1.7 < 18.4, Δz 7.2 < 14.95).
**Cause:** these 5 RP buildings sit inside corner/edge building blocks; the generator has no RP
keep-out. **Why it matters:** procedural towers visibly intersect the civic shells (broken-looking
geometry; players walk to a dealership/police station embedded in random towers).
**Recommended fix (Batch A):** filter `GENERATED_BUILDINGS` to drop any footprint overlapping an
RP-building footprint (+~1 m margin), or add RP keep-out rectangles to the block fill. No RP
coordinates move. Re-run the seed replay to confirm 0 overlaps. *Confirm visually in-game once
(deterministic, so the math should match the runtime exactly).*

### 5.2 — P3 — Procedural buildings merge into each other
**92 overlapping pairs** among the 52 towers (random offsets within each 30×30 block, no
intra-block spacing). Concentrated in corner blocks. Cosmetic (no collision bug), but it's why
some skyline clusters look blobby/unplanned. **Fix (Batch F):** add a per-block spacing/rejection
pass so towers stop interpenetrating.

### 5.3 — P2 — Rural obstacles never validated against markers/spawns
`validateRpMarkers([])`, `validateVehicleSpawnOBB(..., obstacles=[])`, `safeStationSpawn([])` are
all called with an empty obstacle list, so warehouses, cabins, homesteads, depots, and rocks are
never enforced against markers/spawns. No current collision results (markers are city-center, far
from rural obstacles), but the promised rule is unenforced. **Fix (Batch B):** pass the real
`STATIC_OBSTACLES` array.

### 5.4 — P3 — Legacy plaza spawns on road centerlines
`SPAWN_POINTS` (offline fallback): (0,−12),(12,0),(−12,0),(0,12) each sit on an x=0 or z=0 road
carriageway. The active spawn is `safeStationSpawn` (128,−65), so live play is unaffected, but the
fallback would drop a player on a road. **Fix (Batch B/D):** move these 4 off-road or retire the
array.

### 5.5 — P3 — `footprintHitsRoad` uses unbounded road lines
The check tests `|x − roadX| < ROAD_HALF` for all z (and vice-versa), ignoring that city roads are
length-200 (±100). Harmless for RP buildings/houses (all in-city), but it cannot be reused for
rural objects without bounding road extent or switching to regional-polyline distance. **Fix
(Batch B):** bound road segments before extending road validation to rural objects.

### 5.6 — P3 — Rural parked cars unasserted
car-14…27 placement is trusted via comments. No on-road/on-pad assertion; regional-road distance
not computed. **Fix (Batch C):** validator sampling each rural car against its intended
regional-road/pad polyline.

### 5.7 — P3 — City kerbside cars
car-4 (55,8), car-5 (−55,−8), car-6 (8,55), car-7 (−8,−49), car-12 (41,−70), car-13 (−41,70) touch
a carriageway ±10 band — consistent with parallel parking and they're drivable spawns, so **likely
intentional**. **Fix (Batch C):** tag intentional roadside spawns so a validator can distinguish
them from a stray car rather than flagging all six.

### 5.8 — OK — RP houses vs broader map
maple_court & lakeside_villa ~88 m from nearest homestead, harbor_flat ~107 m; all three have
`max(|x|,|z|)=92` → outside the 125–230 tree belt (no tree spawns on them); no procedural/car
overlap. No action.

---

## 6. Fix Plan (Batch A–C implemented; D–F pending approval)

- **Batch A — P0/P1 hard geometry. ✅ IMPLEMENTED (§8).** Filtered `GENERATED_BUILDINGS` against
  RP-building footprints (+1 m). Client-only; no RP coords moved. Seed replay → 0 overlaps.
- **Post-audit house relocation. ✅ IMPLEMENTED (§9–§10).** Moved the 3 starter houses off the
  landmark towers + ring road to clean ±117 corners.
- **Batch B — validator upgrades. ✅ IMPLEMENTED (§11 — source of truth).** Client dev block checks
  RP houses + RP buildings + all BUILDINGS against the full world (BUILDINGS / REGIONAL_ROADS via a
  proper AABB-band helper / STATIC_OBSTACLES / cars); server gained `footprintHitsCentralRoadBounded`
  + the city-core-envelope assertion. Validator-only; no gameplay change. *(The plan originally
  proposed a `validateGeneratedBuildings()` and wiring `STATIC_OBSTACLES` into the server marker
  validators — implemented instead in the client dev block, where that geometry actually lives, to
  respect the api-server → city-sandbox import boundary.)*
- **Batch C — parked cars / NPC traffic polish. ✅ IMPLEMENTED (§12).** On-road/on-pad assertions
  for rural cars (§5.6); intentional-roadside tag set for city kerbside cars (§5.7); ambient-traffic
  waypoint + segment-midpoint on-road assertion; NPC-route in-bounds + not-in-building/obstacle.
- **Batch D — residential / homestead polish.** Retire or relocate the on-road legacy plaza spawns
  (§5.4); programmatic check that each homestead's driveway reaches the inner-ring road and no fence
  blocks its own gate; verify cluster spacing reads intentional.
- **Batch E — nature/tree/rock density polish.** Audit flora density per region (west fields look
  sparse; some corner clusters dense); assert no trunk/rock sits on a driveway, cabin door, or path;
  optionally lightly populate the under-used west zone.
- **Batch F — visual-only quality.** Reduce intra-block procedural overlaps (§5.2); document the
  render-only/no-collision systems (massifs, bridge deck, skybridges, rail); minor skyline variety.

---

## 7. Stop

Audit complete. The only P1 was §5.1 (procedural towers clipping 5 RP buildings). **Batch A is
implemented (§8), the post-audit house relocation (§9–§10), Batch B full-map validators (§11),
and Batch C parked-car / NPC + traffic validators (§12) are all implemented and verified.
Batches D–F remain optional polish, pending your approval.**

---

## 8. Batch A — Implemented (procedural keep-out around RP civic footprints)

**Change:** `artifacts/city-sandbox/src/shared/cityData.ts` — after `GENERATED_BUILDINGS` are
created, `.filter()` out any whose footprint overlaps an `RP_BUILDINGS` footprint + 1 m margin
(`overlapsRpBuilding`). `RP_BUILDINGS` is imported from `rpTypes.ts` (a pure leaf module → no
import cycle). Filtering runs **after** generation, so the seeded rng sequence and every
surviving building's position are unchanged (deterministic). No RP building, house, road, car,
checkpoint, marker, highrise, landmark, or gameplay coordinate was moved. Server/economy/police/
faction/housing untouched.

**Computed before/after (seed = 42 replay + filter):**

| Check | Before | After |
|-------|--------|-------|
| Generated buildings | 52 | 31 (dropped 21) |
| Generated ↔ RP buildings overlaps | **21** | **0** ✓ |
| Generated ↔ RP houses overlaps | 0 | 0 ✓ |
| Generated ↔ parked cars overlaps | 0 | 0 ✓ |
| Generated ↔ roads overlaps | 0 | 0 ✓ |

Highrises (8) and landmarks (5) were left unchanged — the audit confirms they sit in the empty
80–94 ring and do not overlap any RP footprint, so the filter (applied only to
`GENERATED_BUILDINGS`) is sufficient.

**Verification:** tsc ×4 pass. api-server build, Vite build, and tsx RP validators run on the
Mac (no server/validator code changed in Batch A). Batch B (full-map validator upgrades) is now
implemented — see §11 for the authoritative summary and coverage matrix.

---

## 9. MISSED FINDING (post-Batch-A) — P1 — 12A starter houses clipped landmarks + ring road

**Audit miss:** the Phase 12A house validation (and §5.8 of this audit) only checked the central
grid roads (±45) and RP-building footprints. It never checked the **landmark towers (±87)** or the
**inner-city-ring road (±100, width 12 → carriageway |coord|∈[94,106])**. Codex independently
flagged this. Computed overlaps for the original (±92) plots:

| House | original pos | overlaps landmark | clips ring road |
|-------|-------------|-------------------|-----------------|
| maple_court | (−92,−92) | landmark (−87,−87) 12×12 (Δ5 < 10) | x=−100 & z=−100 ring (house x_min −96 < −94) |
| lakeside_villa | (−92,92) | landmark (−87,87) | x=−100 & z=100 ring |
| harbor_flat | (92,−92) | landmark (87,−87) | x=100 & z=−100 ring |

**Why it matters:** the sealed house shells visually intersect the tallest landmark towers and sit
on the ring carriageway — broken geometry, and the ring road would clip into the house collider.

**Fix (implemented below, §10):** relocate all 3 houses to verified-clean diagonal peri-city
pockets at (±117,±117), re-solved against the FULL world; and extend the validators so a house
can never again be placed against the core/ring/towers.

---

## 10. Relocation — starter houses moved to clean peri-city corners

Re-solved via a full-world grid search (central ROADS, REGIONAL_ROADS incl. inner-city-ring,
all BUILDINGS = generated+highrise+landmark, RP_BUILDINGS, STATIC_OBSTACLES incl. homesteads,
parked cars, spawns, ATMs, gang turf, and the 125–230 city-edge tree belt). The four diagonal
corners are clean (cardinal homestead clusters don't reach the diagonals; below the tree belt;
outside the ring). New plots (8×8):

| House | new pos | door | interior | min margin |
|-------|---------|------|----------|-----------|
| maple_court | (−117,−117) | (−117,−111) | (−117,−117) | 12.4 m |
| lakeside_villa | (−117,117) | (−117,111) | (−117,117) | 12.4 m |
| harbor_flat | (117,−117) | (117,−111) | (117,−117) | 12.4 m |

**Validator hardening (so it can't regress):**
- Server `validateRpHouses`: added a drift-free **city-core-outer-radius** assertion
  (`CITY_CORE_OUTER_RADIUS = 106`) — every house footprint must be fully outside the core
  envelope, which contains the grid, all 52 procedural buildings, all 13 towers/landmarks, and
  the inner-city-ring road. One check covers them all without importing client geometry.
- Client dev validation block (`if (isViteDev)` in cityData.ts): added a literal RP_HOUSES check
  against the real `BUILDINGS`, `REGIONAL_ROADS`, `STATIC_OBSTACLES`, and `INITIAL_VEHICLES`
  arrays (no mirror, no drift) — the complete full-world coverage, placed where that data lives
  (the api-server must never import from city-sandbox).

**Computed after relocation:** houses vs all buildings = 0; vs all roads incl. regional = 0; vs
cars/spawns/ATMs/turf/homesteads = clear (see §10 verification in the commit).

---

## 11. Batch B — Full-map validator upgrades (validator-only; no coordinates moved)

**No map bug was found.** A pre-flight of every new assertion against current data read 0
overlaps. One important methodology note: a naïve centre+radius "circle" road test reports a
false −1.49 m on the (±87) landmark towers vs the inner-city-ring; the towers are in fact a
real 1 m clear of the ring. The new validator therefore uses **proper AABB-vs-road-band
geometry** (axis-aligned segments tested exactly; diagonal segments conservative), which
correctly reports 0. No object was moved.

### Server (`rpValidators.ts`) — server-owned constants only
- Added `footprintHitsCentralRoadBounded(cx,cz,w,d,margin)` — a length-bounded variant of
  `footprintHitsRoad` (the old one treats grid centerlines as infinite lines, which is a safe
  superset for in-city objects but wrong for peri-city ones). `validateRpHouses` now uses the
  bounded helper for the house footprint + door road checks (houses are peri-city at ±117).
- `validateRpHouses` already gained (in the §10 fix) the drift-free `CITY_CORE_OUTER_RADIUS`
  envelope assertion covering the grid, all 52 procedural buildings, all 13 towers/landmarks,
  and the inner-city-ring in one check.

### Client dev block (`cityData.ts` `if (isViteDev)`) — full real geometry, no mirrors
- Added `footprintHitsRoadPath()` — proper AABB-vs-road-band helper (used below).
- RP_HOUSES vs the FULL world: every BUILDING, every REGIONAL_ROAD (AABB-band), the central
  grid, every STATIC_OBSTACLE (incl. homestead house+fence obstacles), and every parked car.
- RP_BUILDINGS vs all BUILDINGS (margin 0) — regression guard for the Batch A procedural
  keep-out; and RP_BUILDINGS vs every REGIONAL_ROAD.
- All BUILDINGS (generated + highrise + landmark) vs every REGIONAL_ROAD carriageway.

### Updated coverage matrix

| Category | Server validator | Client dev validator | Asserts | Remaining gap |
|----------|------------------|----------------------|---------|---------------|
| Central roads | `footprintHitsRoad` + new `…Bounded` | grid checks | footprint vs grid (bounded) | — |
| Regional roads (incl. inner-city-ring, outer-loop, spurs, driveways) | — (client-only data) | `footprintHitsRoadPath` | buildings/RP/houses vs band; rail pillars; lamps; connectivity | diagonal segments use conservative distance (over-safe) |
| Procedural buildings | — | YES | vs grid, vs regional roads, vs RP buildings | self-overlap (§5.2) still cosmetic-only, unchecked |
| Highrise / landmark | — | YES | vs regional roads, vs RP buildings (in BUILDINGS set) | — |
| RP buildings | `validateRpBuildings` | NEW | road/gap/cars/doors/walls/jail + vs full BUILDINGS + regional | — |
| RP houses | `validateRpHouses` (+core envelope, bounded roads) | NEW (full world) | road/RP-gap/cars/doors/interior/markers/core + vs BUILDINGS/regional/obstacles/cars | — |
| Static obstacles / homesteads / fences | — | PARTIAL | houses & spawns & vehicles vs obstacles; homesteads vs vehicles/lamps/station/stairs | obstacle-vs-road not asserted (hand-placed roadside by design) |
| Parked cars | `validateRpBuildings`/`…Houses`/`…VehicleClearance` | YES | vs RP buildings/houses, 8 m marker clearance, vs buildings/obstacles, grounding | — |
| Spawns | `validateRpMarkers`/`safeStationSpawn` | YES | off-road + obstacle + bounds + vs buildings | legacy plaza `SPAWN_POINTS` on grid (P3, §5.4) — unmoved |
| ATMs / job & checkpoint markers | `validateRpMarkers`/`…VehicleClearance` | — | on/off-road per role, obstacle, 8 m car clearance | — |
| Gang turf / tag points | `validateRpMarkers` + `validateRpHouses` | — | off-road; house turf-radius clearance | — |
| Ambient traffic routes | — | YES (Batch C, §12) | every waypoint AND segment midpoint hard-asserted on-road (grid + regional, 3 m apex tol) | diagonal-segment road test is conservative (over-safe) |
| NPC pedestrian routes | — | YES (Batch C, §12) | segment-sampled (~3 m, body radius): in-bounds + never enters a building or static obstacle | not asserted off-carriageway (loops hug sidewalk by design); vs homestead fences deferred |
| Bridge / rail / station / skybridges | — | YES | rail loop closed, pillars clear of all roads, station clear of roads+buildings, train path clear, skybridge clearance | render-only massifs/decks have no collision (by design) |
| Old race system | grep-confirmed removed | — | n/a | none |

### Intentionally still uncovered (and why)
- **Procedural self-overlap** (§5.2, 92 pairs): cosmetic merged towers; no collision/gameplay
  impact. Deferred to Batch F (visual polish).
- **Static-obstacle-vs-road footprints**: warehouses/cabins/gas-stop are hand-placed *beside*
  regional roads by design; a footprint-vs-road check would flag intentional roadside placement.
  Left as-is to avoid false positives.
- *(Resolved in Batch C, §12)* Ambient-traffic waypoints + segment midpoints are now hard-asserted
  on-road, and NPC pedestrian routes are segment-sampled against buildings/obstacles — this is no
  longer metric-only.

### Verification
- tsc ×4 pass.
- Pre-flight overlap script (proper AABB-band): RP↔BUILDINGS 0, BUILDINGS↔grid 0,
  BUILDINGS↔regional 0, houses↔(buildings/regional/obstacles/cars) 0, cars↔houses 0.
- api-server build, `BASE_PATH=/ PORT=5173 pnpm build` (Vite), and tsx `rpValidators` run on the
  Mac; the client dev validator runs at Vite dev module-load (console-warns, non-fatal).

---

## 12. Batch C — parked cars / NPC + ambient traffic polish (validator-only)

**No map bug found.** Every new assertion was pre-flighted against current data and reads 0.
(One pre-flight false alarm — 3 "off-road" points on the bridge route — was traced to my local
road list omitting `spine-south`/`bridge`; the real validator iterates all `REGIONAL_ROADS`, so
it's clean. No coordinate changed.)

All Batch C checks live in the client dev block (`if (isViteDev)`), since cars, traffic routes,
NPC routes, regional roads, and village pads are all client geometry (the api-server already
validates parked cars vs RP buildings/houses/markers from its own constants).

Added:
- **Rural parked cars (car-14…27):** each must sit on a regional-road carriageway (edge allowed,
  2.5 m slack) or a `VILLAGE_PARKING_PADS` pad. All 14 pass (worst margin +1.3 m, car-14).
- **City kerbside cars (§5.7):** a validator-local `INTENTIONAL_ROADSIDE_CARS` set tags car-4,
  -5, -6, -7, -12, -13 (parallel-parked at a carriageway edge by design). Every city car must be
  off the grid carriageway OR in that set — otherwise it's flagged as a stray. No data mutation.
- **Ambient traffic (9 routes):** every waypoint AND every segment midpoint must lie on a road
  carriageway (grid bounded or any regional polyline, 3 m turn-apex tolerance). Upgrades the prior
  on-road metric to a hard assertion. All sampled points pass.
- **NPC pedestrian loops (12) — REAL BUG FOUND & FIXED.** The validator (segment-sampled, since
  `npcPositionAt` interpolates) revealed that the loops at the old `block_half + 3` offset walked
  **up to 2.35 m INTO the highrise/landmark tower ring** (e.g. route 0 corner (−83,−83) inside
  landmark (−87,−87); route 1 (−33,−83) inside highrise (−30,−86)). Codex independently confirmed
  all 12 routes had building hits. **Fix:** rerouted `makeBlockSidewalkLoop` from `block_half + 3`
  to `block_half − 2` — the loops now walk the lot band between each block's own buildings (≤ ±10
  from centre) and the tower ring (≥ 81), with ≥ 2.6 m clearance to every building footprint
  (dense segment sampling). This is an ambient-NPC path change only — no RP/gameplay/economy
  coordinate moved. The validator now samples every segment at ~3 m steps (not just corners) and
  uses the NPC body radius, so this class of bug cannot recur. (My initial Batch C pre-flight was
  wrong: it tested NPC corners against the block rectangles, not the actual `BUILDINGS` array,
  which includes the separately-placed towers — hence the missed hit.)

**Coverage delta:** "Parked cars" and "NPC traffic routes" rows in §11 move from PARTIAL/metric
to fully asserted (placement + on-road + segment-sampled building/obstacle clearance). Still
uncovered (deferred): NPC routes vs homestead fences (loops are city-core, far from fences), and
static-obstacle-vs-road footprints (hand-placed roadside by design; §11).

**Verification:** tsc ×4 pass. Direct replay (offset −2, 3 m segment sampling, body radius 0.35):
**NPC building hits 0, obstacle hits 0** across all 12 routes (was −2.35 m / 12 routes hitting at
+3). Pre-flight also clean: 14/14 rural cars on road/pad, 14/14 city cars off-road-or-tagged,
traffic 0 off-road (full road set). api-server build, `BASE_PATH=/ PORT=5173 pnpm build`, and tsx
`rpValidators` run on the Mac; the client dev validator runs at Vite dev module-load (non-fatal).
