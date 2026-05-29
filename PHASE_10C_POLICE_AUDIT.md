# Phase 10C — Police Station Walk-In Collision + Jail Radius Fix: Audit

**Verdict: SAFE with `POLICE_JAIL_RADIUS` 8 → 6.** No coordinate moves.

## Police points (unchanged)
`POLICE_STATION`/`POLICE_JAIL_CELL` (−68,64), `POLICE_RELEASE_POS` (−68,72), `POLICE_BOOKING_DESK_POS` (−62,64), `POLICE_STATION_DOOR` (−68,72.5), footprint 20×14 south. `POLICE_PATROL_POINTS` and `STATION_SPAWN`/`STATION_MARKER_POS` untouched.

## Static points vs per-wall boxes
Jail cell, booking desk, release, door, and the officer interaction ring are all **clear of wall boxes** (player-radius buffer). The jail-ring corner pillars (±5 from cell) sit inside the footprint, clear of walls.

## Jail radius computation (the blocker fix)
Jail cell is at the station center. Distances from the cell to each inner wall face, and the max radius that keeps a clamped player's body (r=0.45 + 0.1 buffer) off the wall / short of the doorway:

| Direction | Inner face dist | Max safe radius |
|---|---|---|
| Side walls (X) | 9.75 m | 9.20 m |
| Back wall (Z−) | 6.75 m | 6.20 m |
| Front door line (Z+) | 7.0 m | 6.45 m |

**Max safe radius = 6.20 m** (back-wall limited). **Chosen `POLICE_JAIL_RADIUS = 6`** fits on all three axes:
- Clamped jailed player stays ≥0.55 m off the side/back walls → no server-clamp-vs-client-collision fight, no jitter.
- Reaches at most z=70 toward the front; the door threshold is z≈71 → **jailed player cannot reach the open doorway** before release. Escape closed.

## Mirror / UI dependencies
- `POLICE_JAIL_RADIUS` is **server-only** (gameServer confinement clamp). Not imported client-side.
- BUT the jail confinement **visual ring** in `RPMarkers.tsx` is hardcoded (`ringGeometry [7.5, 8.5]`, corner pillars at ±5) to depict the old 8 m zone. It must be updated to match radius 6 so the visual doesn't overstate the confinement area. (Cosmetic mirror, not a logic mirror.)

## Flows reviewed — no logic change needed
- Officer clock-in/out (rpJobService): gate at `POLICE_STATION_DOOR`. Unchanged.
- Arrest/cuff/book/jail/release (rpPoliceService): teleports to jail cell / release, booking proximity. All land in clear interior/doorway space at radius 6. Unchanged.
- Confinement clamp (gameServer): the only thing affected — and only via the radius constant; the clamp code itself is unchanged.

## Vehicle collision
Untouched. `playerHitsAnyRpWall` stays player-only; police wall boxes never enter the vehicle path.

## Plan
1. `POLICE_JAIL_RADIUS` 8 → 6 (server cityData) + update its comment.
2. Add `police_station` to `RP_INTERIOR_BUILDING_IDS`.
3. Police interior floor style in RPBuildings.
4. Update the jail visual ring in RPMarkers to radius 6 (ring 5.5/6, pillars ±4.2).
5. Extend `validateRpBuildings` (or a sibling assertion) to assert `POLICE_JAIL_RADIUS` + player buffer fits inside the police interior and can't reach the door.
