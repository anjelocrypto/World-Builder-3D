/**
 * Phase 8A: CityAnnouncementHUD — Mayor city broadcast panel.
 *
 * - Opened with E key when the Mayor (government faction, rank >= 4) is near
 *   GOVERNMENT_OFFICE_POS.
 * - Text area for composing the announcement (1–200 chars).
 * - Character counter + Send button (disabled when empty or over limit).
 * - ESC closes without sending.
 * - Input focus must not propagate keydown events to the game (stopPropagation).
 *
 * Security constraints:
 * - All server-side authority checks happen in rpGovernmentService.ts.
 * - Client sends { msg } and the server validates rank + cooldown + length.
 * - No playerId, factionSlug, or username in the emitted payload — all
 *   derived server-side.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { MAYOR_ANNOUNCE_MAX_CHARS } from "../shared/rpTypes";

// ── Styling constants ─────────────────────────────────────────────────────────
const PANEL_BG     = "rgba(4, 10, 28, 0.97)";
const PANEL_BORDER = "rgba(51, 85, 204, 0.45)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(51,85,204,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const GOV_BLUE     = "#5577ee";
const GOV_GOLD     = "#ccaa44";

// ── Props ─────────────────────────────────────────────────────────────────────

interface CityAnnouncementHUDProps {
  onSend:  (msg: string) => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CityAnnouncementHUD({ onSend, onClose }: CityAnnouncementHUDProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea on mount.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // ESC closes without sending.
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

  const trimmed    = draft.trim();
  const charCount  = trimmed.length;
  const overLimit  = charCount > MAYOR_ANNOUNCE_MAX_CHARS;
  const canSend    = charCount >= 1 && !overLimit;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(trimmed);
    onClose();
  }, [canSend, trimmed, onSend, onClose]);

  // Prevent game keystrokes from firing while typing.
  const stopKeys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleSend();
    }
  };

  return (
    <div
      style={{
        position:    "fixed",
        inset:       0,
        display:     "flex",
        alignItems:  "center",
        justifyContent: "center",
        zIndex:      4000,
        background:  "rgba(0,0,0,0.35)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
      // Click backdrop to close.
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background:   PANEL_BG,
          border:       `1px solid ${PANEL_BORDER}`,
          borderRadius: PANEL_RADIUS,
          boxShadow:    PANEL_SHADOW,
          padding:      "20px 22px",
          width:        440,
          maxWidth:     "92vw",
          display:      "flex",
          flexDirection: "column",
          gap:          14,
        }}
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
              City Announcement
            </div>
            <div style={{ fontSize: 11, color: "#778", marginTop: 2 }}>
              Mayor Broadcast · Sent to all players
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              marginLeft:     "auto",
              background:     "transparent",
              border:         "1px solid rgba(255,255,255,0.12)",
              borderRadius:   6,
              color:          "#667",
              cursor:         "pointer",
              fontSize:       13,
              padding:        "2px 8px",
              lineHeight:     "1.6",
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

        {/* ── Textarea ───────────────────────────────────────────────── */}
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={stopKeys}
            placeholder="Type your city-wide message here…"
            rows={4}
            style={{
              width:         "100%",
              boxSizing:     "border-box",
              background:    "rgba(255,255,255,0.04)",
              border:        `1px solid ${overLimit ? "#cc4444" : "rgba(51,85,204,0.4)"}`,
              borderRadius:  6,
              color:         "#dde",
              fontSize:      13,
              padding:       "9px 11px",
              resize:        "vertical",
              outline:       "none",
              fontFamily:    "inherit",
              lineHeight:    1.55,
              transition:    "border-color 0.15s",
            }}
          />
          {/* Character counter */}
          <div
            style={{
              position:   "absolute",
              bottom:     8,
              right:      10,
              fontSize:   11,
              color:      overLimit ? "#ee4444" : charCount > MAYOR_ANNOUNCE_MAX_CHARS * 0.8 ? "#ccaa44" : "#445",
              pointerEvents: "none",
              fontFamily: "'Courier New', monospace",
            }}
          >
            {charCount}/{MAYOR_ANNOUNCE_MAX_CHARS}
          </div>
        </div>

        {/* ── Send / Cancel row ──────────────────────────────────────── */}
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
            onClick={handleSend}
            disabled={!canSend}
            title={!canSend ? "Type 1–200 characters" : "Ctrl+Enter also sends"}
            style={{
              background:   canSend
                ? `linear-gradient(180deg, #4466cc, #2244aa)`
                : "rgba(51,85,204,0.12)",
              border:       `1px solid ${canSend ? "rgba(51,85,204,0.8)" : "rgba(51,85,204,0.25)"}`,
              borderRadius: 6,
              color:        canSend ? "#ccd" : "#445",
              cursor:       canSend ? "pointer" : "not-allowed",
              fontSize:     13,
              fontWeight:   "bold",
              padding:      "6px 18px",
              transition:   "background 0.15s, color 0.15s",
            }}
          >
            📢 Broadcast
          </button>
        </div>

        {/* ── Hint line ──────────────────────────────────────────────── */}
        <div style={{ fontSize: 10, color: "#334", textAlign: "center" }}>
          ESC to cancel · Ctrl+Enter to send · 30 s cooldown between broadcasts
        </div>
      </div>
    </div>
  );
}
