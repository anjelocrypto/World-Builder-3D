/**
 * Phase 8I: CityLedgerHUD — read-only Mayor / Government budget ledger.
 *
 * - Opened with L key when the Mayor (government faction, rank >= 4) is near
 *   GOVERNMENT_OFFICE_POS.
 * - Requests a fresh snapshot via onRequest() when opened.
 * - Displays the latest city-budget events: tax revenue collected (inflow),
 *   grants issued, and city projects funded (outflows).
 * - ESC or backdrop click closes.
 * - 100% display-only — every figure is a server-authoritative aggregate.
 */

import { useEffect, useState } from "react";
import type { CityLedger, CityLedgerEntry } from "../shared/rpTypes";

// ── Styling constants (mirrors the other Mayor panels) ──────────────────────────
const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_BORDER = "rgba(51, 85, 204, 0.45)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const GOV_BLUE = "#5577ee";
const GOV_GOLD = "#ccaa44";

// ── Per-type display config ─────────────────────────────────────────────────────

interface TypeStyle {
  icon: string;
  /** true = budget inflow (green +), false = budget outflow (red −). */
  inflow: boolean;
}

const TYPE_STYLES: Record<CityLedgerEntry["type"], TypeStyle> = {
  tax_revenue:         { icon: "💰", inflow: true },
  government_grant:    { icon: "🎁", inflow: false },
  city_project_funded: { icon: "🏗️", inflow: false },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAgo(createdAt: number): string {
  const ms  = Math.max(0, Date.now() - createdAt);
  const sec = Math.floor(ms / 1000);
  if (sec < 60)    return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)    return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)     return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CityLedgerHUDProps {
  ledger:    CityLedger | null;
  onRequest: () => void;
  onClose:   () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CityLedgerHUD({ ledger, onRequest, onClose }: CityLedgerHUDProps) {
  // Tick once per second to keep the relative timestamps fresh.
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

  const entries = ledger?.entries ?? [];

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
          <span style={{ fontSize: 22 }}>📒</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: "bold", color: GOV_BLUE, letterSpacing: 0.8 }}>
              City Ledger
            </div>
            <div style={{ fontSize: 11, color: "#778", marginTop: 2 }}>
              Recent budget activity · read-only
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

        {!ledger ? (
          <div style={{ fontSize: 12, color: "#778", textAlign: "center", padding: "24px 0" }}>
            Loading ledger…
          </div>
        ) : entries.length === 0 ? (
          <div style={{ fontSize: 12, color: "#556", textAlign: "center", padding: "24px 0" }}>
            No recent budget activity.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map((e) => {
              const ts = TYPE_STYLES[e.type] ?? { icon: "•", inflow: false };
              const sign = ts.inflow ? "+" : "−";
              const amountColor = ts.inflow ? "#5fae5f" : "#ee8866";
              return (
                <div
                  key={e.id}
                  style={{
                    display:        "flex",
                    alignItems:     "center",
                    gap:            10,
                    background:     "rgba(255,255,255,0.03)",
                    border:         "1px solid rgba(51,85,204,0.18)",
                    borderRadius:   6,
                    padding:        "8px 12px",
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{ts.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#cdd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.label}
                      {e.note && <span style={{ color: "#667", fontSize: 11 }}> · {e.note}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#667" }}>{formatAgo(e.createdAt)}</div>
                  </div>
                  <div
                    style={{
                      fontSize:           14,
                      fontWeight:         "bold",
                      color:              amountColor,
                      fontVariantNumeric: "tabular-nums",
                      flexShrink:         0,
                    }}
                  >
                    {sign}${e.amount.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Hint ────────────────────────────────────────────────────── */}
        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>
          ESC to close · Latest 25 events · Server-authoritative · read-only
        </div>
      </div>
    </div>
  );
}
