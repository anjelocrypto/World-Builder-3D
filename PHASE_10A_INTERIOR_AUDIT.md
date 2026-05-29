# Phase 10A — Walk-In RP Interiors + Collision Audit

**Status:** Audit complete. No code changed yet. Awaiting scope confirmation before Batch A.

## How RP buildings work today (post 9A/9B)
`RPBuildings.tsx` renders each `RP_BUILDINGS` entry as a **visual-only** shell: four walls built as *separate thin boxes* (back + 2 sides + 2 front jambs flanking a 3 m doorway), a lintel over the door, a flat roof, fascia sign + text, and side window strips. Geometry is read from the shared `RP_BUILDINGS` table (mirrored server/client), so it can't drift from `validateRpBuildings`.

**Key finding — no collision on RP buildings.** The collision system (`shared/collision.ts`) collides the walking player against two AABB sets: `playerHitsAnyBuilding` (the procedural `BUILDINGS` city blocks/towers) and `playerHitsAnyObstacle` (the `STATIC_OBSTACLES` list). **`RP_BUILDINGS` is in neither.** So today you walk straight through every civic building's walls — they're pure decoration. There's no roof/ceiling collision and no interior floor (you stand on the world ground plane inside the shell).

## Audit table (4 priority buildings)

| Building | Center | Footprint | Facing | Door | Interior (inner) | Can visually enter? | Has collision? | Door aligns w/ gate? |
|---|---|---|---|---|---|---|---|---|
| Police Station | (−68,64) | 20×14 | south | (−68,72.5) | ~19×13 m | Yes (open doorway) | **No** | Yes (gate at door) |
| City Hall | (−22,−22) | 18×12 | south | (−22,−14.5) | ~17×11 m | Yes | **No** | Yes |
| Medical Center | (−68,28) | 18×10 | east | (−57.5,28) | ~17×9 m | Yes | **No** | Yes |
| DMV / Licensing | (17,−29) | 10×8 | south | (17,−23.5) | ~9×7 m | Yes | **No** | Yes |

Interaction ring positions (RPMarkers) already sit at each door (Phase 9 work). DMV's CP3 license-test finish coincides with its door.

## Audit answers
1. **Does any wall block the intended door?** No. The front wall is split into two jambs around a 3 m gap, and the door/interact point sits in that gap on every building. Verified.
2. **Can the player walk through walls (collision absent)?** Yes — RP buildings have zero collision today. This is the core gap.
3. **Would adding collision trap players / block roads / break radii?** Computed per-wall AABB boxes for all 4:
   - **Road clipping:** none. Every wall box clears all carriageways (verified).
   - **Trapping:** no. Doorways are 3 m wide (player body radius 0.45 m → 0.9 m diameter, ~3 m of clearance). All door/interact/teleport points are clear of wall boxes.
   - **Police flow:** jail cell (−68,64) and booking desk (−62,64) sit in the *interior* (not inside a wall); release (−68,72) and door (−68,72.5) sit in the open doorway. So arrest→jail→book→release all land in reachable space even with solid walls. The 8 m jail-confinement zone stays inside the building.
4. **Buildings safe for first-batch collision:** geometrically, all 4 are safe. The collision mechanism already exists (`STATIC_OBSTACLES`-style AABB list) — per-wall boxes can be fed through the same channel without touching the `BUILDINGS` footprint logic.

## Risk assessment for real collision
- **Low risk:** City Hall, DMV — pure proximity-gate interaction, no teleports, no confinement.
- **Higher coupling:** Police Station — solid walls interact with the jail-confinement clamp and arrest/release teleports. Geometry checks out, but it's the one building where a wall-vs-teleport edge case could strand a jailed/released player. It deserves its own careful batch, NOT the "safest first."
- **Medical Center** — low risk like City Hall (clock-in gate only), but east-facing (door on +X) — fine, just different axis.

## Recommended Batch A (safest)
Add a **data-driven interior + real per-wall collision** for the lowest-risk buildings first: **City Hall + DMV** (both south-facing, gate-only, no teleports). Treatment:
- Add an **interior floor** mesh inside each shell (visual; distinct lobby material).
- Feed each building's **per-wall AABB boxes** into the collision system via a new `RP_BUILDING_WALLS` obstacle list consumed by `playerHitsAnyObstacle` (or a parallel `playerHitsAnyRpWall`), so walls collide while the doorway stays open. Conservative: walls only, doorway gap left clear, no roof collision (so no vertical trapping).
- Keep everything low-poly; no furniture, no NPCs.

**Defer to 10B:** Police Station collision (jail/confinement/teleport interaction needs its own regression run) and Medical Center collision; and all furniture/NPC/interior detailing.

This differs slightly from the brief's "City Hall + Police first" suggestion: the audit shows **Police is the riskiest, not safest**, because of the jail-flow coupling. I recommend City Hall + DMV for Batch A and Police as its own 10B batch. Confirm before I implement.

## Collision: real or visual-only?
A real collision system **exists** and per-wall boxes are proven safe, so Batch A can do **real collision** (not faked). If you'd rather minimize gameplay-physics risk this round, the fallback is **visual interiors only** (floors + the existing walls) with collision deferred wholesale to 10B — explicitly documented, not silently faked.
