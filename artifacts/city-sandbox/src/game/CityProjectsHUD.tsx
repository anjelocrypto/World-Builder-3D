/**
 * Phase 8F: CityProjectsHUD — Mayor city project funding panel.
 *
 * - Opened with P key when the Mayor (government faction, rank >= 4) is near
 *   GOVERNMENT_OFFICE_POS.
 * - Shows current city budget and 3 project cards.
 * - Mayor clicks "Fund Project" to spend budget and activate a 10-minute boost.
 * - Active projects show a countdown timer.
 * - ESC or backdrop click closes without sending.
 * - Client never decides project cost, duration, or outcome — server is authoritative.
 */

import { useEffect, useState, useCallback } from "react";
import type { ActiveCityProject } from "../shared/rpTypes";
import { CITY_PROJECT_DEFS_CLIENT } from "../shared/rpTypes";

// ── Styling constants ─────────────────────────────────────────────────────────
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

// ── Props ─────────────────────────────────────────────────────────────────────

interface CityProjectsHUDProps {
  currentBudget:  number;
  activeProjects: ActiveCityProject[];
  onFund:         (projectId: string) => void;
  onClose:        () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CityProjectsHUD({
  currentBudget,
  activeProjects,
  onFund,
  onClose,
}: CityProjectsHUDProps) {
  // Live countdown — refresh every second.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
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

  const activeMap = new Map(activeProjects.map((p) => [p.projectId, p]));

  const handleFund = useCallback(
    (projectId: string) => {
      onFund(projectId);
      onClose();
    },
    [onFund, onClose],
  );

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
          width:         460,
          maxWidth:      "92vw",
          display:       "flex",
          flexDirection: "column",
          gap:           14,
        }}
        onKeyDown={stopKeys}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏗️</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: "bold", color: GOV_BLUE, letterSpacing: 0.8 }}>
              City Project Funding
            </div>
            <div style={{ fontSize: 11, color: "#778", marginTop: 2 }}>
              Mayor Control · 10-minute job pay boosts
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

        {/* ── Budget display ──────────────────────────────────────────── */}
        <div
          style={{
            background: "rgba(255,255,255,0.03)", border: `1px solid rgba(204,170,68,0.3)`,
            borderRadius: 6, padding: "10px 14px", display: "flex",
            alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 11, color: "#778" }}>City Budget Available</div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: GOV_GOLD, fontVariantNumeric: "tabular-nums" }}>
            ${currentBudget.toLocaleString()}
          </div>
        </div>

        {/* ── Project cards ───────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {CITY_PROJECT_DEFS_CLIENT.map((def) => {
            const active     = activeMap.get(def.id);
            const isActive   = !!active && active.expiresAt > Date.now();
            const canAfford  = currentBudget >= def.cost;
            const canFund    = !isActive && canAfford;

            return (
              <div
                key={def.id}
                style={{
                  background:   isActive ? "rgba(51,85,204,0.10)" : "rgba(255,255,255,0.03)",
                  border:       `1px solid ${isActive ? "rgba(51,85,204,0.55)" : "rgba(51,85,204,0.2)"}`,
                  borderRadius: 8,
                  padding:      "12px 14px",
                  display:      "flex",
                  alignItems:   "center",
                  gap:          12,
                  transition:   "background 0.15s",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: "bold", color: isActive ? GOV_BLUE : "#aab", marginBottom: 3 }}>
                    {def.label}
                  </div>
                  <div style={{ fontSize: 11, color: "#556" }}>{def.desc}</div>
                  <div style={{ fontSize: 10, color: isActive ? "#5fae5f" : "#4a5", marginTop: 3, fontWeight: 600 }}>
                    {def.effect}
                  </div>
                  {isActive && active && (
                    <div style={{ fontSize: 11, color: "#4488ff", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                      ⏱ {formatCountdown(active.expiresAt)} remaining
                    </div>
                  )}
                </div>

                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {isActive ? (
                    <div
                      style={{
                        background:   "rgba(51,85,204,0.2)",
                        border:       "1px solid rgba(51,85,204,0.5)",
                        borderRadius: 6, padding: "5px 12px",
                        fontSize:     11, color:  GOV_BLUE, fontWeight: "bold",
                      }}
                    >
                      ✓ Active
                    </div>
                  ) : (
                    <button
                      onClick={() => handleFund(def.id)}
                      disabled={!canFund}
                      title={!canAfford ? `Need $${def.cost}` : "Fund this project"}
                      style={{
                        background:   canFund ? `linear-gradient(180deg, #997722, #664400)` : "rgba(153,119,34,0.08)",
                        border:       `1px solid ${canFund ? "rgba(204,170,68,0.7)" : "rgba(204,170,68,0.2)"}`,
                        borderRadius: 6, cursor: canFund ? "pointer" : "not-allowed",
                        color:        canFund ? "#eebb44" : "#443322",
                        fontSize:     12, fontWeight: "bold",
                        padding:      "5px 12px", whiteSpace: "nowrap",
                        transition:   "background 0.12s",
                      }}
                    >
                      ${def.cost.toLocaleString()}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Hint ────────────────────────────────────────────────────── */}
        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>
          ESC to close · Projects last 10 minutes · Multiple projects can be active simultaneously
        </div>
      </div>
    </div>
  );
}
