# Phase 11A — RP Identity / Wallet Card Audit

**Verdict: implement client-only. No server change, no DB migration needed.**

## Identity data already available
`RpProfile` (client, mirrored from server `buildProfile`) already carries everything an ID card needs:
- cash, bank
- driverLicense, weaponLicense
- factionName / factionType / factionSlug / factionRank / factionColor
- currentJob, onDuty
- wantedStars
- jailUntil, jailReason
- cuffedBy, cuffedUntil
- playerId (**raw DB UUID — must NOT display**)

`username` is **not** in RpProfile but is already passed as a prop to GameScene/HUD (rendered in the HUD nameplate). So the citizen name is available without any new data.

## Persistence
- Persisted in DB (`rp_players` / `rp_wallets`): cash, bank, driverLicense, weaponLicense, faction membership, jail state.
- Cache/in-memory only: cuffedBy/cuffedUntil, activeJob, wantedStars, onDuty (per session).
- **No new DB field needed** for 11A — the card is a read-only view of existing profile data.

## Server change?
**None.** `RpProfile` already has enough fields; no new socket event or response is required. The card is pure client UX over existing data.

## Keybind
Used keys: A,B,D,E,F,G,H,**I**,J,K,L,P,R,S,T,U,W,Y, F7. `KeyI` is the **police uncuff** action — taken. Free: C,M,N,O,Q,V,X,Z.
**Chosen: `KeyC`** ("Card" / "Citizen") — free, mnemonic, no conflict with movement (WASD), interactions (E), faction (Y), gang (G), mayor panels (T/B/P/D/L), vehicle lock (L), or dev admin (F7).

## Privacy / security
- **Never display** `playerId` (raw DB UUID) — shown nowhere in the card.
- No socket IDs (`cuffedBy` is a socket id used only as a boolean "are you cuffed" — rendered as a status, never printed).
- No tokens/secrets in RpProfile.
- Card is **local-only** (the local player's own profile); not transmitted to other players. Showing IDs to nearby police is deferred to a later phase.

## HUD duplication
The main HUD shows a small cash/faction nameplate. The ID card is a fuller "open on demand" panel (full wallet + license + job + status); it complements rather than replaces the always-on HUD. No always-on duplication added.

## Plan
- New `IDCardHUD.tsx` (client) rendering RpProfile + username as an in-world ID/wallet card.
- Wire `KeyC` into GameScene: state/ref, keydown allow-list, `anyModalOpen` guard (open only when no other modal; ESC/own-key always closes), render block.
- Fields shown: citizen name, cash, bank, driver license (+ weapon license), faction name/type/rank, current job + duty, wanted stars, jail/cuffed status. No UUID/socket id.
