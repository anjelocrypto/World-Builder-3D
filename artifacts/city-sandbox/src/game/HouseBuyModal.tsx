/**
 * Phase 12A: HouseBuyModal — confirm a house purchase before spending money.
 *
 * Display-only: the price shown here is the mirrored static value; the server
 * re-validates and charges the authoritative price. Confirm emits rp:buyHouse
 * with only the slug.
 */

import { useEffect } from "react";

const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_BORDER = "rgba(51, 85, 204, 0.45)";
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const ACCENT = "#5577ee";
const GOLD   = "#ccaa44";

interface HouseBuyModalProps {
  label:   string;
  price:   number;
  canAfford: boolean;
  onConfirm: () => void;
  onCancel:  () => void;
}

export default function HouseBuyModal({ label, price, canAfford, onConfirm, onCancel }: HouseBuyModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 4200, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 10,
          boxShadow: PANEL_SHADOW, padding: "20px 22px", width: 340, maxWidth: "92vw",
          display: "flex", flexDirection: "column", gap: 14,
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>🏠</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: "bold", color: ACCENT, letterSpacing: 0.5 }}>Buy Property</div>
            <div style={{ fontSize: 16, color: "#fff", fontWeight: 700 }}>{label}</div>
          </div>
        </div>

        <div style={{ fontSize: 13, color: "#ccd", lineHeight: 1.5 }}>
          Purchase this house for{" "}
          <span style={{ color: GOLD, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            ${price.toLocaleString()}
          </span>{" "}
          in cash? You'll be the only one who can enter.
        </div>

        {!canAfford && (
          <div style={{ fontSize: 12, color: "#ee6655", fontWeight: 600 }}>
            You don't have enough cash. Withdraw from your bank at an ATM first.
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "9px 12px", borderRadius: 7, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)",
              color: "#bcd", fontSize: 13, fontWeight: 600,
            }}
          >Cancel</button>
          <button
            onClick={() => { if (canAfford) onConfirm(); }}
            disabled={!canAfford}
            style={{
              flex: 1, padding: "9px 12px", borderRadius: 7, cursor: canAfford ? "pointer" : "default",
              border: `1px solid ${canAfford ? GOLD : "rgba(255,255,255,0.1)"}`,
              background: canAfford ? "rgba(204,170,68,0.18)" : "rgba(255,255,255,0.03)",
              color: canAfford ? "#ffe9a8" : "#667", fontSize: 13, fontWeight: 700,
            }}
          >Buy ${price.toLocaleString()}</button>
        </div>
      </div>
    </div>
  );
}
