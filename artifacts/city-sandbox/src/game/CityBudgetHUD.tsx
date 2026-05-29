/**
 * Phase 8E: CityBudgetHUD — Mayor city grant panel.
 *
 * - Opened with B key when the Mayor (government faction, rank >= 4) is near
 *   GOVERNMENT_OFFICE_POS.
 * - Shows current city budget.
 * - Mayor selects an online player, enters an amount ($50–$1000) and optional
 *   note (≤120 chars), then clicks Grant.
 * - Client never decides budget math or outcome — server is authoritative.
 * - ESC or backdrop click closes without sending.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { CITY_GRANT_MIN, CITY_GRANT_MAX, CITY_GRANT_NOTE_MAX_CHARS } from "../shared/rpTypes";

// ── Styling constants ─────────────────────────────────────────────────────────
const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_BORDER = "rgba(51, 85, 204, 0.45)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const GOV_BLUE = "#5577ee";
const GOV_GOLD = "#ccaa44";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GrantablePlayer {
  id:       string;
  username: string;
}

interface CityBudgetHUDProps {
  currentBudget:  number;
  myId:           string;
  onlinePlayers:  GrantablePlayer[];
  onGrant:        (targetSocketId: string, amount: number, note: string) => void;
  onClose:        () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CityBudgetHUD({
  currentBudget,
  myId,
  onlinePlayers,
  onGrant,
  onClose,
}: CityBudgetHUDProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [amountStr,  setAmountStr]  = useState<string>("");
  const [note,       setNote]       = useState<string>("");
  const amountRef = useRef<HTMLInputElement>(null);

  // Focus amount on mount.
  useEffect(() => {
    amountRef.current?.focus();
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

  // Eligible players: all online except self.
  const eligible = onlinePlayers.filter((p) => p.id !== myId);

  // Validate amount.
  const parsedAmount = parseInt(amountStr, 10);
  const amountValid  =
    /^\d+$/.test(amountStr) &&
    Number.isInteger(parsedAmount) &&
    parsedAmount >= CITY_GRANT_MIN &&
    parsedAmount <= CITY_GRANT_MAX;

  const insufficient = amountValid && parsedAmount > currentBudget;
  const canGrant     = !!selectedId && amountValid && !insufficient;

  const handleGrant = useCallback(() => {
    if (!canGrant) return;
    onGrant(selectedId, parsedAmount, note.trim().slice(0, CITY_GRANT_NOTE_MAX_CHARS));
    onClose();
  }, [canGrant, selectedId, parsedAmount, note, onGrant, onClose]);

  const stopKeys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") handleGrant();
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
          width:         420,
          maxWidth:      "92vw",
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
              City Grant
            </div>
            <div style={{ fontSize: 11, color: "#778", marginTop: 2 }}>
              Mayor Control · Server-authoritative
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

        {/* ── Player list ─────────────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 11, color: "#556", marginBottom: 6 }}>Select recipient</div>
          {eligible.length === 0 ? (
            <div style={{ fontSize: 12, color: "#445", padding: "8px 0" }}>
              No other players online.
            </div>
          ) : (
            <div
              style={{
                maxHeight: 140, overflowY: "auto",
                display: "flex", flexDirection: "column", gap: 4,
              }}
            >
              {eligible.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id === selectedId ? "" : p.id)}
                  style={{
                    background:   p.id === selectedId ? "rgba(51,85,204,0.22)" : "rgba(255,255,255,0.03)",
                    border:       `1px solid ${p.id === selectedId ? "rgba(51,85,204,0.7)" : "rgba(51,85,204,0.2)"}`,
                    borderRadius: 6, padding: "7px 12px", cursor: "pointer",
                    color:        p.id === selectedId ? "#aac" : "#889",
                    fontSize:     13, textAlign: "left",
                    transition:   "background 0.12s, border-color 0.12s",
                  }}
                >
                  {p.username}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Amount input ────────────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 11, color: "#556", marginBottom: 6 }}>
            Amount (${ CITY_GRANT_MIN}–${CITY_GRANT_MAX})
          </div>
          <input
            ref={amountRef}
            type="number"
            min={CITY_GRANT_MIN}
            max={CITY_GRANT_MAX}
            step={1}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder={`e.g. 200`}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${insufficient ? "rgba(255,80,80,0.6)" : amountValid ? "rgba(51,85,204,0.6)" : "rgba(51,85,204,0.25)"}`,
              borderRadius: 6, color: insufficient ? "#f88" : "#ccd",
              fontSize: 15, padding: "7px 12px", outline: "none",
            }}
          />
          {insufficient && (
            <div style={{ fontSize: 11, color: "#f88", marginTop: 4 }}>
              Insufficient city budget.
            </div>
          )}
          {amountStr && !amountValid && !insufficient && (
            <div style={{ fontSize: 11, color: "#aa8833", marginTop: 4 }}>
              Enter a whole number between ${CITY_GRANT_MIN} and ${CITY_GRANT_MAX}.
            </div>
          )}
        </div>

        {/* ── Note input (optional) ────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 11, color: "#556", marginBottom: 6 }}>
            Note <span style={{ color: "#334" }}>(optional, {CITY_GRANT_NOTE_MAX_CHARS} chars)</span>
          </div>
          <input
            type="text"
            maxLength={CITY_GRANT_NOTE_MAX_CHARS}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Community service award"
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(51,85,204,0.25)",
              borderRadius: 6, color: "#aab", fontSize: 13,
              padding: "7px 12px", outline: "none",
            }}
          />
        </div>

        {/* ── Action row ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6, color: "#778", cursor: "pointer", fontSize: 12, padding: "6px 14px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleGrant}
            disabled={!canGrant}
            title={!canGrant ? "Select a player and enter a valid amount" : "Enter to grant"}
            style={{
              background:   canGrant ? `linear-gradient(180deg, #997722, #664400)` : "rgba(153,119,34,0.12)",
              border:       `1px solid ${canGrant ? "rgba(204,170,68,0.8)" : "rgba(204,170,68,0.25)"}`,
              borderRadius: 6, color: canGrant ? "#eebb44" : "#554422",
              cursor:       canGrant ? "pointer" : "not-allowed",
              fontSize:     13, fontWeight: "bold", padding: "6px 18px",
              transition:   "background 0.15s, color 0.15s",
            }}
          >
            💰 Issue Grant
          </button>
        </div>

        {/* ── Hint ────────────────────────────────────────────────────── */}
        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>
          ESC to cancel · Enter to grant · 30 s cooldown between grants
        </div>
      </div>
    </div>
  );
}
