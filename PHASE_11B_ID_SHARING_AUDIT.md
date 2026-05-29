# Phase 11B — Nearby ID Sharing + Police Inspection: Audit

**Verdict: safe to implement.** Reuses the established police-handler pattern; all identity fields are server-derived; no financials/UUIDs/socket-ids leak.

## Existing building blocks (reused)
- `isOfficerValid(entry)` in `rpPoliceService.ts`: police faction + on-duty `police_patrol` + not jailed + not cuffed. Exactly the gate police inspection needs.
- Handler template (`handleIssueWarrant`/`handleCuff`): officer/target lookup via `ctx.rpCache` + `ctx.players`, `dist2d` proximity vs a radius, target-not-self, toast on reject. ID handlers follow this shape.
- `PlayerState` (server `ctx.players`) carries **`username`** — so the display name is server-authoritative without a DB read.
- Client nearest-target pattern in `GameScene` (iterate `remotePlayers`, nearest within radius, emit `targetId`) — reused for "show to nearest".

## Privacy: payload definitions (server-derived only)
**Public ID (`rp:idShown`, voluntary show to nearest player):**
- `name` (username), `driverLicense` (bool), `weaponLicense` (bool), `factionName`, `factionType`, `factionRank` (only if in a faction).
- **Excluded:** cash, bank, wanted stars, jail/cuff status, playerId, socketId, coordinates.

**Police inspect (`rp:idInspected`, officer only):**
- All public fields **plus** `wantedStars`, `jailed` (bool), `cuffed` (bool) — legal status an officer can legitimately see.
- **Still excluded:** cash, bank, playerId, socketId, coordinates.

Neither payload includes a target identifier the client could weaponize — they're display-only cards.

## Server authority & anti-abuse
- Server derives every field from `rpCache`/`ctx.players`; **client-sent identity fields are ignored entirely** (the client only sends a target socket id, which the server re-validates).
- **Range:** `ID_SHARE_RADIUS = 4` m (face-to-face; tighter than warrant 14). Server checks sender↔target distance via authoritative positions.
- **Rate limit:** `ID_SHARE_COOLDOWN_MS = 2500` per sender, server-side, keyed by playerId (same map pattern as mayor cooldowns). Applies to both show + inspect.
- Target-not-self guard; target must exist in cache + players.
- Public show delivers the card **only to the validated target's socket**. Police inspect delivers **only to the requesting officer's socket**.

## Police authority
Police inspect requires `isOfficerValid(officer)` (police, on-duty patrol, not jailed/cuffed) + within `ID_SHARE_RADIUS`. Non-police / off-duty / jailed / cuffed → rejected with a toast. No rank gate (any on-duty officer can ID-check).

## Keybinds / UX
- `C` keeps opening the **own** ID card (11A, unchanged).
- **Show to nearest:** a button **inside `IDCardHUD`** ("Show ID to Nearest") — no new keybind, avoids the crowded keymap. Calls `emitShowIDNearest()`.
- **Police inspect:** a new key for officers. Free keys: M,N,O,Q,V,X,Z. Choose **`V`** ("Verify ID") — only acts when the presser is a valid on-duty officer near a player; otherwise no-op (so it's harmless for non-police). Mnemonic, unused.
- Received card shown via a small `ReceivedIDHUD` panel (auto-dismiss or ESC).

## Plan
- `rpTypes.ts`: `PublicIDCard` + `PoliceIDCard` (or one `ReceivedIDCard` with optional police fields), `ID_SHARE_RADIUS`, `ID_SHARE_COOLDOWN_MS`.
- Server `rpPlayerService` (or a new `rpIdentityService`): `handleShowID(socket, ctx, targetId)`, `handlePoliceInspectID(socket, ctx, targetId)`; wire `rp:showID` + `rp:policeInspectID` in `setupRpHandlers`.
- `useRpSocket`: `emitShowIDNearest`/`emitShowID(targetId)`, `emitPoliceInspectID(targetId)`, `receivedID` state + `rp:idShown`/`rp:idInspected` listeners.
- Client UI: button in `IDCardHUD`, `ReceivedIDHUD` panel, GameScene `V`-key wiring (officer near player → inspect nearest) + nearest-target selection + receivedID render.
- 11A own-ID card unchanged except the new button.
