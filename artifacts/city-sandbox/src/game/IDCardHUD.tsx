/**
 * Phase 11A: IDCardHUD — local RP identity / wallet card.
 *
 * A read-only, open-on-demand "citizen ID + wallet" panel built entirely from
 * the local player's existing RpProfile (+ username). Opened with the C key
 * ("Card"). No server data beyond what RpProfile already carries.
 *
 * Privacy: never renders the raw DB playerId (UUID), socket ids, or tokens.
 * Local-only — shows the local player's own profile, not transmitted to others.
 */

import { useEffect } from "react";
import type { RpProfile } from "../shared/rpTypes";

// ── Styling (matches the civic Mayor panels) ────────────────────────────────────
const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_BORDER = "rgba(51, 85, 204, 0.45)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const ACCENT = "#5577ee";
const GOLD   = "#ccaa44";

// ── Display helpers (presentation only) ─────────────────────────────────────────
function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const FACTION_TYPE_LABEL: Record<string, string> = {
  government: "Government",
  police:     "Police",
  medic:      "Medical",
  gang:       "Gang",
};

interface IDCardHUDProps {
  username: string;
  profile:  RpProfile | null;
  onClose:  () => void;
  /** Phase 11B: show this ID to the nearest player; null when no one is in range. */
  onShowNearest?: (() => void) | null;
  /** Display name of the nearest player in range, for the button label. */
  nearestName?:   string | null;
}

// ── Small row helpers ───────────────────────────────────────────────────────────
function Row({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "#889" }}>{label}</span>
      <span style={{ color: color ?? "#dde", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function StatusPill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color,
      border: `1px solid ${color}66`, background: `${color}1a`,
      borderRadius: 5, padding: "2px 7px",
    }}>{text}</span>
  );
}

export default function IDCardHUD({ username, profile, onClose, onShowNearest, nearestName }: IDCardHUDProps) {
  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();

  const jailed = !!profile && profile.jailUntil !== null && profile.jailUntil > Date.now();
  const cuffed = !!profile && profile.cuffedBy !== null;
  const wanted = profile?.wantedStars ?? 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 4000, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: PANEL_RADIUS,
          boxShadow: PANEL_SHADOW, padding: "18px 20px", width: 360, maxWidth: "92vw",
          maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12,
        }}
        onKeyDown={stopKeys}
      >
        {/* Header — ID card banner */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🪪</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: "bold", color: ACCENT, letterSpacing: 0.6 }}>Citizen ID</div>
            <div style={{ fontSize: 16, color: "#fff", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {username || "Citizen"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6,
              color: "#667", cursor: "pointer", fontSize: 13, padding: "2px 8px", lineHeight: "1.6",
            }}
          >✕</button>
        </div>

        <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${GOLD}55, transparent)` }} />

        {!profile ? (
          <div style={{ fontSize: 12, color: "#778", textAlign: "center", padding: "20px 0" }}>Loading profile…</div>
        ) : (
          <>
            {/* Wallet */}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(204,170,68,0.3)", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: "#778" }}>Cash</div>
                <div style={{ fontSize: 18, fontWeight: "bold", color: GOLD, fontVariantNumeric: "tabular-nums" }}>${profile.cash.toLocaleString()}</div>
              </div>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(51,85,204,0.3)", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: "#778" }}>Bank</div>
                <div style={{ fontSize: 18, fontWeight: "bold", color: ACCENT, fontVariantNumeric: "tabular-nums" }}>${profile.bank.toLocaleString()}</div>
              </div>
            </div>

            {/* Licenses */}
            <div>
              <div style={{ fontSize: 11, fontWeight: "bold", color: ACCENT, letterSpacing: 0.5, marginBottom: 2 }}>Licenses</div>
              <Row label="Driver License" value={profile.driverLicense ? "VALID" : "None"} color={profile.driverLicense ? "#5fae5f" : "#998"} />
              <Row label="Weapon License" value={profile.weaponLicense ? "VALID" : "None"} color={profile.weaponLicense ? "#5fae5f" : "#998"} />
            </div>

            {/* Affiliation / employment */}
            <div>
              <div style={{ fontSize: 11, fontWeight: "bold", color: ACCENT, letterSpacing: 0.5, marginBottom: 2 }}>Affiliation</div>
              {profile.factionName ? (
                <Row
                  label="Faction"
                  value={`${profile.factionName}${profile.factionRank ? ` · Rank ${profile.factionRank}` : ""}`}
                  color={profile.factionColor ?? "#dde"}
                />
              ) : (
                <Row label="Faction" value="Civilian" color="#998" />
              )}
              {profile.factionType && (
                <Row label="Type" value={FACTION_TYPE_LABEL[profile.factionType] ?? titleCase(profile.factionType)} />
              )}
              <Row
                label="Employment"
                value={profile.currentJob ? `${titleCase(profile.currentJob)} ${profile.onDuty ? "(On Duty)" : "(Off Duty)"}` : "Unemployed"}
                color={profile.onDuty ? "#5fae5f" : "#dde"}
              />
            </div>

            {/* Legal status */}
            <div>
              <div style={{ fontSize: 11, fontWeight: "bold", color: ACCENT, letterSpacing: 0.5, marginBottom: 4 }}>Legal Status</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {wanted > 0
                  ? <StatusPill text={`WANTED ${"★".repeat(Math.min(wanted, 5))}`} color="#ee6655" />
                  : <StatusPill text="NO WARRANTS" color="#5fae5f" />}
                {jailed && <StatusPill text="JAILED" color="#ddaa55" />}
                {cuffed && <StatusPill text="CUFFED" color="#cc99ff" />}
              </div>
            </div>
          </>
        )}

        {/* Phase 11B: voluntarily show your public ID to the nearest player in range. */}
        {profile && (
          <button
            onClick={() => { if (onShowNearest) onShowNearest(); }}
            disabled={!onShowNearest}
            style={{
              width: "100%", padding: "9px 12px", borderRadius: 7, cursor: onShowNearest ? "pointer" : "default",
              border: `1px solid ${onShowNearest ? ACCENT : "rgba(255,255,255,0.1)"}`,
              background: onShowNearest ? "rgba(85,119,238,0.18)" : "rgba(255,255,255,0.03)",
              color: onShowNearest ? "#cdd8ff" : "#556", fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
            }}
          >
            {onShowNearest
              ? `Show My ID to ${nearestName || "Nearest Player"}`
              : "Show My ID — no one within 4 m"}
          </button>
        )}

        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>C or ESC to close · Your public ID hides cash, bank & legal status</div>
      </div>
    </div>
  );
}
