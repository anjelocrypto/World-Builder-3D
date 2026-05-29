# Phase 10B — Police + Medical Walk-In Collision: Audit

**Status:** Audit complete. No code changed yet. The two buildings split on safety — see verdict.

## Medical Center — SAFE ✅
- Footprint 18×10 @ (−68,28), **east-facing**, door (−57.5,28). Per-wall boxes: door clear, no box clips a road.
- `MEDIC_CENTER` (−68,28) is the **payout-distance origin** in `calcMedicPay` (line 1458) — it's a reference point for the pay formula, NOT a place the player stands, so solid walls around it are irrelevant to payouts. **Payout math unaffected.**
- Clock-in/out gate already measures to `MEDIC_CENTER_DOOR` (Phase 9). `MEDIC_ER_BAY` (−45,28) is on-road (ambulance pull-up) and well outside the walls — reachable.
- **No confinement clamp** anywhere for medic — just a door gate + a distance origin.
- Verdict: enable interior + per-wall collision exactly like City Hall/DMV. Player can walk in/out the 3 m east doorway; payout/ER flow untouched.

## Police Station — NOT SAFE as-is ❌ (jail radius vs. walls conflict)
Cluster: `POLICE_STATION`/`POLICE_JAIL_CELL` (−68,64), `POLICE_RELEASE_POS` (−68,72), `POLICE_BOOKING_DESK_POS` (−62,64), door (−68,72.5). Footprint 20×14, south-facing.

Point-vs-wall checks all pass: jail cell, booking desk, release, and door are each **clear of wall boxes**. So the static points are fine.

**The blocker is dynamic.** The jail-confinement clamp in `gameServer.ts` (Phase 6A/6D) does, every player update while jailed:
```
if (dist_from_jail_cell > POLICE_JAIL_RADIUS) {
  data.x = jailX + dx * (RADIUS / dist);   // server snaps player back to the radius edge
  data.z = jailZ + dz * (RADIUS / dist);
}
```
This is **server-side and wall-unaware**. The numbers:
- `POLICE_JAIL_RADIUS = 8`. Jail cell at (−68,64).
- Confinement circle spans Z:[56, 72]. Station **interior depth half = 6.5 m** (footprint depth 14, minus 0.5 walls each side) → interior Z spans only [57.5, 70.5].
- **The 8 m confinement circle pokes past the back wall (Z 56 < 57.5) and out the front (Z 72 > 70.5).**

Consequence with solid walls: a jailed player who walks to the back of the station gets **clamped by the server to radius 8 — a point that is inside/behind the back wall** — while the **client** collision simultaneously pushes them off that wall. Server and client disagree every frame → **position jitter / a stuck or oscillating jailed player.** That's a real bug, not theoretical. It also lets the confinement circle reach the open doorway (radius edge ~at the door), so a jailed player could potentially slip out before release.

### Options for Police (need your call)
- **(A) Defer Police collision to 10C.** Ship Medical now. Lowest risk; Police needs a reconciliation pass.
- **(B) Shrink `POLICE_JAIL_RADIUS` to fit the interior** (≤ 6, so the confinement circle stays inside the walls). Small server constant change — but it *is* touching police flow (the confinement zone gets tighter), needs its own regression and mirrors.
- **(C) Make the jail an interior sub-room / move the jail cell** so a radius-8 circle fits. Larger change; coordinate move.

My recommendation: **Medical now (safe), Police deferred (A)** — or if you want Police this batch, **(B)** with `POLICE_JAIL_RADIUS` reduced to 6 and a full arrest→jail→release regression. I would not enable Police collision while the radius exceeds the interior — it ships a known jitter/stuck bug.

## Cross-cutting (both)
- No road clipping (verified for both buildings' wall boxes).
- No parked-car overlap (footprints unchanged since Phase 9, already validated ≥8 m).
- No coordinate drift — no coordinates move in the safe path; only `RP_INTERIOR_BUILDING_IDS` gains entries.
- Vehicle collision untouched — `playerHitsAnyRpWall` stays player-only.
