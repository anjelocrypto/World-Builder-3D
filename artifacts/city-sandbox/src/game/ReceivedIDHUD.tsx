/**
 * Phase 11B: ReceivedIDHUD — shows an ID handed to you by another player, or the
 * result of a police ID inspection.
 *
 * The payload (ReceivedIDCard) is built entirely server-side from authoritative
 * state. It never contains cash, bank, the DB playerId (UUID), socket ids, or
 * coordinates. The public view shows identity + licenses + affiliation only; the
 * police view additionally shows legal status (wanted / jailed / cuffed).
 */

import { useEffect } from "react";
import type { ReceivedIDCard } from "../shared/rpTypes";

const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const ACCENT = "#5577ee";
const GOLD   = "#ccaa44";
const POLICE = "#4488dd";

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const FACTION_TYPE_LABEL: Record<string, string> = {
  government: "Government",
  police:     "Police",
  medic:      "Medical",
  gang:       "Gang",
};

interface ReceivedIDHUDProps {
  card:    ReceivedIDCard;
  onClose: () => void;
}

function Row({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "#889" }}>{label}</span>
      <span style={{ color: color ?? "#dde", fontWeight: 600 }}>{value}</span>
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

export default function ReceivedIDHUD({ card, onClose }: ReceivedIDHUDProps) {
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

  const headerColor = card.policeView ? POLICE : ACCENT;
  const wanted = card.wantedStars ?? 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 4001, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: PANEL_BG, border: `1px solid ${headerColor}73`, borderRadius: PANEL_RADIUS,
          boxShadow: PANEL_SHADOW, padding: "18px 20px", width: 340, maxWidth: "92vw",
          maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12,
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>{card.policeView ? "🛂" : "🪪"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: headerColor, letterSpacing: 0.6 }}>
              {card.policeView ? "ID Inspection" : "ID Presented"}
            </div>
            <div style={{ fontSize: 16, color: "#fff", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {card.name || "Citizen"}
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

        {/* Licenses */}
        <div>
          <div style={{ fontSize: 11, fontWeight: "bold", color: headerColor, letterSpacing: 0.5, marginBottom: 2 }}>Licenses</div>
          <Row label="Driver License" value={card.driverLicense ? "VALID" : "None"} color={card.driverLicense ? "#5fae5f" : "#998"} />
          <Row label="Weapon License" value={card.weaponLicense ? "VALID" : "None"} color={card.weaponLicense ? "#5fae5f" : "#998"} />
        </div>

        {/* Affiliation */}
        <div>
          <div style={{ fontSize: 11, fontWeight: "bold", color: headerColor, letterSpacing: 0.5, marginBottom: 2 }}>Affiliation</div>
          {card.factionName ? (
            <Row
              label="Faction"
              value={`${card.factionName}${card.factionRank ? ` · Rank ${card.factionRank}` : ""}`}
              color={card.factionColor ?? "#dde"}
            />
          ) : (
            <Row label="Faction" value="Civilian" color="#998" />
          )}
          {card.factionType && (
            <Row label="Type" value={FACTION_TYPE_LABEL[card.factionType] ?? titleCase(card.factionType)} />
          )}
        </div>

        {/* Police-only legal status */}
        {card.policeView && (
          <div>
            <div style={{ fontSize: 11, fontWeight: "bold", color: POLICE, letterSpacing: 0.5, marginBottom: 4 }}>Legal Status</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {wanted > 0
                ? <StatusPill text={`WANTED ${"★".repeat(Math.min(wanted, 5))}`} color="#ee6655" />
                : <StatusPill text="NO WARRANTS" color="#5fae5f" />}
              {card.jailed && <StatusPill text="JAILED" color="#ddaa55" />}
              {card.cuffed && <StatusPill text="CUFFED" color="#cc99ff" />}
            </div>
          </div>
        )}

        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>
          {card.policeView ? "Officer view · legal status included" : "Public ID · cash, bank & legal status hidden"} · ESC to close
        </div>
      </div>
    </div>
  );
}
