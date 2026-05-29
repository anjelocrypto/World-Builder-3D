# Phase 10E — Interior Interaction Anchor Audit

**Status:** Audit complete. A nuance changes the recommended scope — please confirm before Batch A.

## Current gates (all server-authoritative, at the DOOR)
| Building | Gate(s) | Constant | Radius |
|---|---|---|---|
| City Hall | 6 mayor handlers (announce, tax, grant, project, dashboard, ledger) | `GOVERNMENT_OFFICE_DOOR` | 8 |
| DMV | license-test start | `LICENSING_OFFICE_DOOR` | 6 (`INTERACT_RADIUS`) |
| Medical | medic clock-in **and** clock-out | `MEDIC_CENTER_DOOR` | 6 |
| Police | patrol clock-in **and** clock-out | `POLICE_STATION_DOOR` | 6 |

Client UX (HUD prompts, LocalPlayer proximity, GameScene key handlers, RPMarkers rings) all key off the same door constants. Police booking/jail/release use their own points (`POLICE_BOOKING_DESK_POS`, `POLICE_JAIL_CELL`, `POLICE_RELEASE_POS`) — **out of scope, not touched.**

## Proposed interior desk anchors (verified inside footprint + clear of walls)
Standing spots ~1 m in front of each 10D desk prop:
| Building | Anchor (world) | At desk | Inside footprint | Clear of walls |
|---|---|---|---|---|
| City Hall | (−22, −24.5) | service counter | ✓ | ✓ |
| DMV | (19.5, −30.4) | test-start desk | ✓ | ✓ |
| Medical | (−74, 28) | intake counter | ✓ | ✓ |
| Police | (−62, 59.8) | booking/front counter | ✓ | ✓ |

## The nuance that matters (why this isn't a free move)
Two issues the audit surfaced:

1. **Radius vs. walls.** Each gate radius (6–8 m) is *larger* than the anchor-to-nearest-wall distance (2.5–3.5 m). If I move the gate to an interior anchor but keep the radius, the trigger zone **pokes through the exterior wall** — a player standing outside against the wall could trigger the interaction through it (fails manual-check #7 "no prompt through a wall"). To move gates inside cleanly, **each radius must shrink** to roughly the interior depth (so it covers the desk but not beyond the wall). That's a real (conservative, shrinking) change to gate semantics.

2. **Both clock-in and clock-out are gated.** Medic and Police each check the door constant in *two* places (clock-in + clock-out). Moving the anchor means moving both, or clock-out breaks. City Hall has 6 handlers all reading the door constant.

So "move all four inside" = new `*_DESK_POS` constants (server+client mirror) + radius reductions + updating 6 City-Hall handlers + 2 medic gates + 2 police gates + DMV start + all client prompts/rings + new validators. That's a sizable, multi-file change with gameplay-gate semantics in it.

## Recommendation
Do **Batch A = DMV + City Hall only**, OR **DMV only first**, and defer Medical/Police:
- **DMV** is the cleanest: a single start gate, no clock-out, no teleport coupling. Lowest risk, proves the anchor pattern end-to-end.
- **City Hall** is next (6 handlers but all read one constant, so it's a single anchor swap + radius shrink; no clock-out, no teleports).
- **Medical & Police** each have clock-in+clock-out pairs and (Police) sit adjacent to the jail flow — higher coupling, better as their own batch (10F) with a clock-in/out + (police) arrest-flow regression.

Alternatively, if you want the desks to feel live everywhere at once, **all four** is doable but is the largest-blast-radius gameplay-gate change in this whole arc, and I'd want the full per-building regression run.

### A simpler, lower-risk option worth considering
Keep the **server gates at the door** (unchanged, safe) and only move the **client visual ring + HUD prompt** to the interior desk so it *reads* like a reception desk — while the actual trigger radius still spans door→desk. This gives the "interaction belongs at the desk" feel with **zero server-gate change and zero radius change**, because the door-centered radius already reaches the nearby desk. Lowest possible risk; no gate semantics touched. (Downside: a player could still technically trigger from just outside the door, but the *prompt* and *ring* sit at the desk.)

## Decision needed
1. **Scope:** DMV only / DMV+City Hall / all four / (visual-ring-only, no gate move).
2. If moving server gates: confirm you accept **reducing the gate radii** to keep trigger zones inside the walls (I'll compute the exact safe radius per building, conservative/shrinking only).

I will not move server gates inside while the radius pokes through the wall — that ships a "trigger through wall" bug. Awaiting your call.
