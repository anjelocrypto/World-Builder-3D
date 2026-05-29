/**
 * Phase 11C: InventoryHUD — read-only personal inventory panel.
 *
 * Opens on the O key ("Objects"). Lists the local player's carried items:
 * name, quantity, category, and description. The data is server-authoritative
 * (fetched via rp:getInventory → rp:inventory) and contains no ids, financials,
 * or coordinates. No item use, transfer, drop, trade, or purchase this phase.
 */

import { useEffect } from "react";
import type { PlayerInventory } from "../shared/rpTypes";

// ── Styling (matches the civic / ID-card panels) ────────────────────────────────
const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_BORDER = "rgba(51, 85, 204, 0.45)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const ACCENT = "#5577ee";
const GOLD   = "#ccaa44";

interface InventoryHUDProps {
  inventory: PlayerInventory | null;
  onClose:   () => void;
}

export default function InventoryHUD({ inventory, onClose }: InventoryHUDProps) {
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

  const items = inventory?.items ?? [];
  const loading = inventory === null;

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
          boxShadow: PANEL_SHADOW, padding: "18px 20px", width: 380, maxWidth: "92vw",
          maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12,
        }}
        onKeyDown={stopKeys}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🎒</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: "bold", color: ACCENT, letterSpacing: 0.6 }}>Inventory</div>
            <div style={{ fontSize: 12, color: "#889" }}>Items you are carrying</div>
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

        {loading ? (
          <div style={{ fontSize: 12, color: "#778", textAlign: "center", padding: "20px 0" }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ fontSize: 13, color: "#778", textAlign: "center", padding: "24px 0" }}>No carried items</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((it) => (
              <div
                key={it.slug}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(51,85,204,0.25)",
                  borderRadius: 7, padding: "9px 11px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#dde" }}>{it.name}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: ACCENT,
                      border: `1px solid ${ACCENT}55`, background: `${ACCENT}1a`, borderRadius: 5, padding: "1px 6px",
                    }}>{it.category}</span>
                  </div>
                  {it.description && (
                    <div style={{ fontSize: 11, color: "#889", marginTop: 3, lineHeight: 1.4 }}>{it.description}</div>
                  )}
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 700, color: GOLD, fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap", paddingTop: 1,
                }}>×{it.quantity}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>O or ESC to close · Read-only · Your items only</div>
      </div>
    </div>
  );
}
