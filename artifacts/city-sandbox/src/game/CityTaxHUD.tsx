/**
 * Phase 8B: CityTaxHUD — Mayor city tax rate panel.
 *
 * - Opened with T key when the Mayor (government faction, rank >= 4) is near
 *   GOVERNMENT_OFFICE_POS.
 * - Slider (0%–15%, step 0.5%) + numeric input display.
 * - Shows current server rate and the preview rate as you drag.
 * - Apply button only enabled when the rate has changed and is valid.
 * - ESC or backdrop click closes without applying.
 * - Input events are stopPropagation-ed so the game doesn't see them.
 *
 * Security:
 * - Client sends { rate } (decimal, e.g. 0.075) — server validates authority,
 *   range, and cooldown. The client never receives netPay or decides payout.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { CITY_TAX_MIN, CITY_TAX_MAX } from "../shared/rpTypes";

// ── Styling constants ─────────────────────────────────────────────────────────
const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_BORDER = "rgba(51, 85, 204, 0.45)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const GOV_BLUE = "#5577ee";
const GOV_GOLD = "#ccaa44";

// Step size: 0.5 percentage point = 0.005 in decimal
const STEP = 0.005;
// Number of steps
const STEPS = Math.round((CITY_TAX_MAX - CITY_TAX_MIN) / STEP); // 30

/** Format decimal rate as percentage string, e.g. 0.075 → "7.5%" */
function fmtPct(rate: number): string {
  const pct = (rate * 100).toFixed(1).replace(/\.0$/, "");
  return `${pct}%`;
}

/** Snap to the nearest 0.5 pp step and clamp to [CITY_TAX_MIN, CITY_TAX_MAX]. */
function snap(rate: number): number {
  const clamped = Math.max(CITY_TAX_MIN, Math.min(CITY_TAX_MAX, rate));
  return Math.round(clamped / STEP) * STEP;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CityTaxHUDProps {
  currentRate: number;
  onApply:     (rate: number) => void;
  onClose:     () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CityTaxHUD({ currentRate, onApply, onClose }: CityTaxHUDProps) {
  const [draft, setDraft] = useState<number>(snap(currentRate));
  const sliderRef = useRef<HTMLInputElement>(null);

  // Focus slider on mount.
  useEffect(() => {
    sliderRef.current?.focus();
  }, []);

  // ESC closes without applying.
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

  const changed  = Math.abs(draft - snap(currentRate)) > 1e-9;
  const canApply = changed;

  const handleApply = useCallback(() => {
    if (!canApply) return;
    onApply(draft);
    onClose();
  }, [canApply, draft, onApply, onClose]);

  // The slider value is the step index (0–STEPS)
  const sliderIdx = Math.round((draft - CITY_TAX_MIN) / STEP);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value);
    setDraft(snap(CITY_TAX_MIN + idx * STEP));
  };

  // Stop game keystrokes while focused inside the modal.
  const stopKeys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") handleApply();
  };

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
          width:         400,
          maxWidth:      "92vw",
          display:       "flex",
          flexDirection: "column",
          gap:           16,
        }}
        onKeyDown={stopKeys}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏛️</span>
          <div>
            <div
              style={{
                fontSize:      15,
                fontWeight:    "bold",
                color:         GOV_BLUE,
                letterSpacing: 0.8,
              }}
            >
              City Tax Rate
            </div>
            <div style={{ fontSize: 11, color: "#778", marginTop: 2 }}>
              Mayor Control · Server-authoritative
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              marginLeft:   "auto",
              background:   "transparent",
              border:       "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color:        "#667",
              cursor:       "pointer",
              fontSize:     13,
              padding:      "2px 8px",
              lineHeight:   "1.6",
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Gold rule ──────────────────────────────────────────────── */}
        <div
          style={{
            height:     1,
            background: `linear-gradient(90deg, transparent, ${GOV_GOLD}55, transparent)`,
          }}
        />

        {/* ── Current / Preview rates ─────────────────────────────── */}
        <div
          style={{
            display:         "grid",
            gridTemplateColumns: "1fr 1fr",
            gap:             10,
          }}
        >
          {/* Current */}
          <div
            style={{
              background:   "rgba(255,255,255,0.03)",
              border:       "1px solid rgba(51,85,204,0.25)",
              borderRadius: 6,
              padding:      "10px 14px",
              textAlign:    "center",
            }}
          >
            <div style={{ fontSize: 11, color: "#556", marginBottom: 4 }}>Current rate</div>
            <div style={{ fontSize: 22, fontWeight: "bold", color: "#aab" }}>
              {fmtPct(currentRate)}
            </div>
          </div>
          {/* Preview */}
          <div
            style={{
              background:   changed ? "rgba(51,85,204,0.08)" : "rgba(255,255,255,0.03)",
              border:       `1px solid ${changed ? "rgba(51,85,204,0.55)" : "rgba(51,85,204,0.25)"}`,
              borderRadius: 6,
              padding:      "10px 14px",
              textAlign:    "center",
              transition:   "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{ fontSize: 11, color: "#556", marginBottom: 4 }}>New rate</div>
            <div
              style={{
                fontSize:   22,
                fontWeight: "bold",
                color:      changed ? GOV_BLUE : "#aab",
                transition: "color 0.15s",
              }}
            >
              {fmtPct(draft)}
            </div>
          </div>
        </div>

        {/* ── Slider ─────────────────────────────────────────────────── */}
        <div>
          <div
            style={{
              display:         "flex",
              justifyContent:  "space-between",
              fontSize:        11,
              color:           "#445",
              marginBottom:    6,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>{fmtPct(CITY_TAX_MIN)}</span>
            <span style={{ color: "#667" }}>
              Step 0.5 pp
            </span>
            <span>{fmtPct(CITY_TAX_MAX)}</span>
          </div>
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={STEPS}
            step={1}
            value={sliderIdx}
            onChange={handleSliderChange}
            style={{
              width:  "100%",
              cursor: "pointer",
              accentColor: GOV_BLUE,
            }}
          />
        </div>

        {/* ── Note about tax impact ───────────────────────────────────── */}
        {changed && (
          <div
            style={{
              fontSize:     11,
              color:        "#778",
              background:   "rgba(255,255,255,0.03)",
              borderRadius: 6,
              padding:      "8px 12px",
              lineHeight:   1.5,
            }}
          >
            All job payouts will be taxed at <strong style={{ color: GOV_BLUE }}>{fmtPct(draft)}</strong> until you change it again.
            The server broadcasts the update to all connected players.
          </div>
        )}

        {/* ── Apply / Cancel row ─────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              background:   "rgba(255,255,255,0.05)",
              border:       "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color:        "#778",
              cursor:       "pointer",
              fontSize:     12,
              padding:      "6px 14px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply}
            title={!canApply ? "Adjust the slider to a new value" : "Enter to apply"}
            style={{
              background:   canApply
                ? `linear-gradient(180deg, #4466cc, #2244aa)`
                : "rgba(51,85,204,0.12)",
              border:       `1px solid ${canApply ? "rgba(51,85,204,0.8)" : "rgba(51,85,204,0.25)"}`,
              borderRadius: 6,
              color:        canApply ? "#ccd" : "#445",
              cursor:       canApply ? "pointer" : "not-allowed",
              fontSize:     13,
              fontWeight:   "bold",
              padding:      "6px 18px",
              transition:   "background 0.15s, color 0.15s",
            }}
          >
            ✅ Apply
          </button>
        </div>

        {/* ── Hint line ──────────────────────────────────────────────── */}
        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>
          ESC to cancel · Enter to apply · 30 s cooldown between changes
        </div>
      </div>
    </div>
  );
}
