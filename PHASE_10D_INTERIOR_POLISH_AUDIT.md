# Phase 10D — Interior Polish Audit

**Status:** Audit complete. Props are **visual-only** (no collision, no interaction). All placements verified safe.

## Interior usable zones (local frame, building centered at origin)
| Building | Footprint | Interior (usable) | Door side | Back wall (props) |
|---|---|---|---|---|
| City Hall | 18×12 | 17×11 (½ 8.5, 5.5) | south (+z) | z = −5.5 |
| DMV | 10×8 | 9×7 (½ 4.5, 3.5) | south (+z) | z = −3.5 |
| Medical | 18×10 | 17×9 (½ 8.5, 4.5) | east (+x) | x = −8.5 |
| Police | 20×14 | 19×13 (½ 9.5, 6.5) | south (+z) | z = −6.5 |

## Safe furnishing rule
Props sit against the **back/side walls**, clear of: the door corridor (|cross-axis| < 2 m near the front, ~3.5 m deep), interaction rings (at the door), and — for Police — the radius-6 jail circle (centered at the cell = building center) and the release path (out the door). All props are **visual-only** (no collision boxes), so they cannot trap or slow the player even in the unlikely event of overlap.

## Per-building props (all verified inside interior, clear of door corridor)
- **City Hall:** service counter (back), notice board (left wall), mayor desk (back-right).
- **DMV:** service counter, queue rail, test-start desk.
- **Medical:** intake counter (back/west wall), treatment bed, red wall stripe.
- **Police:** booking counter (back-right), notice board (left wall). **Jail-bars prop dropped** — a bar mesh near the cell would sit inside the radius-6 jail circle where the jailed player stands (caught by the audit check); the existing jail ring + corner pillars in RPMarkers already signal the cell.

## Police-specific verification
- Jail radius 6 unchanged; props verified **clear of the jail circle** (booking counter & notice board both outside r=6).
- Booking desk standing point (local (6,0)), jail cell (center), and release path (out the +z door) all remain clear.
- No prop blocks the release doorway.

## Medical verification
- Door corridor (east) clear; intake counter on the opposite (west) wall.
- `MEDIC_ER_BAY` is external (on-road, −45,28) — untouched, not an interior prop.

## Collidable vs visual-only
**All props visual-only.** No collidable interior props this phase → no new collision path, no new validator for collision needed. A lightweight static check (`auditRpInteriorProps`-style assertion, or the verified comment block) confirms prop bounds stay inside footprint and clear of door/jail. `validateRpBuildings()` is untouched and still passes.

## Deferred
NPCs, interactive props (functional desks/terminals), collidable furniture, and any building beyond the 4 interior-enabled civic buildings.
