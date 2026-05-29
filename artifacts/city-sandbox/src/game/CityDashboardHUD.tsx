/**
 * Phase 8H: CityDashboardHUD — read-only Mayor / Government status panel.
 *
 * - Opened with D key when the Mayor (government faction, rank >= 4) is near
 *   GOVERNMENT_OFFICE_POS.
 * - Requests a fresh snapshot via onRequest() when opened.
 * - Displays city budget, tax rate, active projects (with countdowns), online
 *   players, on-duty job counts, faction counts, and wanted/jailed/cuffed
 *   counts.
 * - ESC or backdrop click closes.
 * - 100% display-only. Every value is a server-authoritative aggregate; the
 *   client never computes or mutates city state here.
 */

import { useEffect, useState } from "react";
import type { CityDashboard } from "../shared/rpTypes";
import { CITY_PROJECT_DEFS_CLIENT } from "../shared/rpTypes";

// ── Styling constants (mirrors the other Mayor panels) ──────────────────────────
const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_BORDER = "rgba(51, 85, 204, 0.45)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const GOV_BLUE = "#5577ee";
const GOV_GOLD = "#ccaa44";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(expiresAt: number): string {
  const ms  = Math.max(0, expiresAt - Date.now());
  const sec = Math.floor(ms / 1000);
  const m   = Math.floor(sec / 60);
  const s   = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Human label for a job slug (display-only). */
const JOB_LABELS: Record<string, string> = {
  city_worker:   "City Worker",
  taxi:          "Taxi Driver",
  delivery:      "Delivery Driver",
  mechanic:      "Mechanic",
  medic:         "Medic",
  police_patrol: "Police Patrol",
};

/** Human label for a faction type (display-only). */
const FACTION_LABELS: Record<string, string> = {
  government: "Government",
  police:     "Police",
  medic:      "Medical",
  gang:       "Gangs",
};

function jobLabel(slug: string): string {
  return JOB_LABELS[slug] ?? slug;
}

function factionLabel(type: string): string {
  return FACTION_LABELS[type] ?? type;
}

function projectLabel(projectId: string, fallback: string): string {
  return CITY_PROJECT_DEFS_CLIENT.find((d) => d.id === projectId)?.label ?? fallback;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CityDashboardHUDProps {
  dashboard: CityDashboard | null;
  onRequest: () => void;
  onClose:   () => void;
}

// ── Small presentational helpers ────────────────────────────────────────────────

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        flex:         "1 1 0",
        minWidth:     90,
        background:   "rgba(255,255,255,0.03)",
        border:       "1px solid rgba(51,85,204,0.25)",
        borderRadius: 6,
        padding:      "8px 10px",
      }}
    >
      <div style={{ fontSize: 10, color: "#778", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: "bold", color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: "bold", color: GOV_BLUE, letterSpacing: 0.6, marginBottom: 2 }}>
      {children}
    </div>
  );
}

function CountRow({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "center",
        fontSize:       12,
        color:          "#aab",
        padding:        "2px 0",
      }}
    >
      <span>{label}</span>
      <span style={{ color: "#cdd", fontWeight: "bold", fontVariantNumeric: "tabular-nums" }}>{count}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CityDashboardHUD({ dashboard, onRequest, onClose }: CityDashboardHUDProps) {
  // Live countdown refresh for active-project timers.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Request a fresh snapshot when the panel opens.
  useEffect(() => {
    onRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const jobEntries     = dashboard ? Object.entries(dashboard.onDutyByJob).sort((a, b) => b[1] - a[1]) : [];
  const factionEntries = dashboard ? Object.entries(dashboard.factionCounts).sort((a, b) => b[1] - a[1]) : [];
  const activeProjects = dashboard ? dashboard.projects.filter((p) => p.expiresAt > Date.now()) : [];

  return (
    <div
      style={{
        position:       "fixed",
        inset:          0,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         4000,
        background:     "rgba(0,0,0,0.35)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background:    PANEL_BG,
          border:        `1px solid ${PANEL_BORDER}`,
          borderRadius:  PANEL_RADIUS,
          boxShadow:     PANEL_SHADOW,
          padding:       "20px 22px",
          width:         500,
          maxWidth:      "94vw",
          maxHeight:     "88vh",
          overflowY:     "auto",
          display:       "flex",
          flexDirection: "column",
          gap:           14,
        }}
        onKeyDown={stopKeys}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏛️</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: "bold", color: GOV_BLUE, letterSpacing: 0.8 }}>
              City Dashboard
            </div>
            <div style={{ fontSize: 11, color: "#778", marginTop: 2 }}>
              Government Status · read-only
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto", background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6,
              color: "#667", cursor: "pointer", fontSize: 13, padding: "2px 8px", lineHeight: "1.6",
            }}
          >✕</button>
        </div>

        {/* ── Gold rule ───────────────────────────────────────────────── */}
        <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${GOV_GOLD}55, transparent)` }} />

        {!dashboard ? (
          <div style={{ fontSize: 12, color: "#778", textAlign: "center", padding: "24px 0" }}>
            Loading city status…
          </div>
        ) : (
          <>
            {/* ── Economy tiles ─────────────────────────────────────── */}
            <div style={{ display: "flex", gap: 8 }}>
              <StatTile label="City Budget"   value={`$${dashboard.cityBudget.toLocaleString()}`}        color={GOV_GOLD} />
              <StatTile label="Tax Rate"      value={`${(dashboard.taxRate * 100).toFixed(1)}%`}         color={GOV_BLUE} />
              <StatTile label="Online"        value={`${dashboard.onlinePlayers}`}                       color="#9fd" />
            </div>

            {/* ── Law & order tiles ─────────────────────────────────── */}
            <div style={{ display: "flex", gap: 8 }}>
              <StatTile label="Wanted" value={`${dashboard.wantedPlayers}`} color="#ee6655" />
              <StatTile label="Jailed" value={`${dashboard.jailedPlayers}`} color="#ddaa55" />
              <StatTile label="Cuffed" value={`${dashboard.cuffedPlayers}`} color="#cc99ff" />
            </div>

            {/* ── Active projects ───────────────────────────────────── */}
            <div>
              <SectionTitle>Active City Projects</SectionTitle>
              {activeProjects.length === 0 ? (
                <div style={{ fontSize: 12, color: "#556", padding: "2px 0" }}>None active.</div>
              ) : (
                activeProjects.map((p) => (
                  <div
                    key={p.projectId}
                    style={{
                      display:        "flex",
                      justifyContent: "space-between",
                      alignItems:     "center",
                      fontSize:       12,
                      color:          "#aab",
                      padding:        "2px 0",
                    }}
                  >
                    <span>🏗️ {projectLabel(p.projectId, p.label)}</span>
                    <span style={{ color: "#4488ff", fontVariantNumeric: "tabular-nums" }}>
                      ⏱ {formatCountdown(p.expiresAt)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* ── On-duty by job ────────────────────────────────────── */}
            <div>
              <SectionTitle>On-Duty Workers</SectionTitle>
              {jobEntries.length === 0 ? (
                <div style={{ fontSize: 12, color: "#556", padding: "2px 0" }}>Nobody on duty.</div>
              ) : (
                jobEntries.map(([slug, count]) => (
                  <CountRow key={slug} label={jobLabel(slug)} count={count} />
                ))
              )}
            </div>

            {/* ── Faction counts ────────────────────────────────────── */}
            <div>
              <SectionTitle>Faction Membership</SectionTitle>
              {factionEntries.length === 0 ? (
                <div style={{ fontSize: 12, color: "#556", padding: "2px 0" }}>No faction members online.</div>
              ) : (
                factionEntries.map(([type, count]) => (
                  <CountRow key={type} label={factionLabel(type)} count={count} />
                ))
              )}
            </div>
          </>
        )}

        {/* ── Hint ────────────────────────────────────────────────────── */}
        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>
          ESC to close · Read-only snapshot · All stats are server-authoritative
        </div>
      </div>
    </div>
  );
}
