/**
 * Phase 7A: FactionChatHUD
 *
 * A small togglable panel for faction-scoped chat.
 * Toggle with Y key (handled in GameScene) or close button inside the panel.
 *
 * States:
 *   - No faction: shows a "No faction assigned" disabled view.
 *   - Has faction: shows message history (max 20) + text input.
 *     Input field captures keyboard focus while open so WASD etc. don't move the player.
 *
 * The panel does NOT process Y key itself — GameScene handles that so the
 * guard in the keydown handler can prevent duplicate opens.
 */

import { useEffect, useRef, useState } from "react";
import type { RpFactionMessage }       from "../shared/rpTypes";

// ── Styling constants (matches HUD.tsx palette) ────────────────────────────────
const PANEL_BG     = "rgba(8, 14, 28, 0.94)";
const PANEL_BORDER = "rgba(0, 229, 255, 0.22)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 24px rgba(0,0,0,0.6), 0 0 1px rgba(0,229,255,0.2), inset 0 1px 0 rgba(255,255,255,0.04)";

interface FactionChatHUDProps {
  /** null = player has no faction. */
  factionName:  string | null;
  factionColor: string | null;
  messages:     RpFactionMessage[];
  onSend:       (msg: string) => void;
  onClose:      () => void;
}

export default function FactionChatHUD({
  factionName,
  factionColor,
  messages,
  onSend,
  onClose,
}: FactionChatHUDProps) {
  const [draft, setDraft]     = useState("");
  const inputRef              = useRef<HTMLInputElement>(null);
  const messagesEndRef        = useRef<HTMLDivElement>(null);
  const hasFaction            = factionName !== null;
  const accentColor           = factionColor ?? "#00e5ff";

  // Auto-focus the input when opened.
  useEffect(() => {
    if (hasFaction) inputRef.current?.focus();
  }, [hasFaction]);

  // Scroll to latest message whenever messages update.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Escape key closes the panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !hasFaction) return;
    onSend(text);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
    // Prevent WASD/space etc. from propagating to the game while typing.
    e.stopPropagation();
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position:        "fixed",
        bottom:          90,
        right:           16,
        width:           320,
        zIndex:          2200,
        fontFamily:      "'Courier New', monospace",
        userSelect:      "none",
      }}
    >
      <div
        style={{
          background:     PANEL_BG,
          border:         `1px solid ${PANEL_BORDER}`,
          borderRadius:   PANEL_RADIUS,
          boxShadow:      PANEL_SHADOW,
          backdropFilter: "blur(12px)",
          overflow:       "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "space-between",
            padding:         "9px 12px 8px",
            borderBottom:    `1px solid rgba(255,255,255,0.06)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div
              style={{
                width:        8,
                height:       8,
                borderRadius: "50%",
                background:   accentColor,
                boxShadow:    `0 0 6px ${accentColor}`,
                flexShrink:   0,
              }}
            />
            <span
              style={{
                fontSize:      12,
                fontWeight:    "bold",
                color:         accentColor,
                letterSpacing: 1,
              }}
            >
              {hasFaction ? factionName!.toUpperCase() : "FACTION CHAT"}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background:    "transparent",
              border:        "none",
              color:         "#556",
              fontSize:      14,
              cursor:        "pointer",
              lineHeight:    1,
              padding:       "0 2px",
            }}
          >
            ✕
          </button>
        </div>

        {!hasFaction ? (
          /* ── No-faction disabled state ──────────────────────────────────── */
          <div
            style={{
              padding:   "24px 16px",
              textAlign: "center",
              color:     "#445",
              fontSize:  12,
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 8 }}>🔒</div>
            <div>No faction assigned.</div>
            <div style={{ marginTop: 4, color: "#334", fontSize: 11 }}>
              Contact an admin to be assigned to a faction.
            </div>
          </div>
        ) : (
          <>
            {/* ── Message history ──────────────────────────────────────────── */}
            <div
              style={{
                height:     200,
                overflowY:  "auto",
                padding:    "8px 10px",
                display:    "flex",
                flexDirection: "column",
                gap:        4,
              }}
            >
              {messages.length === 0 ? (
                <div
                  style={{
                    color:     "#334",
                    fontSize:  11,
                    margin:    "auto",
                    textAlign: "center",
                  }}
                >
                  No messages yet. Say something!
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} style={{ fontSize: 11, lineHeight: 1.45 }}>
                    <span
                      style={{
                        color:       accentColor,
                        fontWeight:  "bold",
                        marginRight: 5,
                      }}
                    >
                      {m.fromName}:
                    </span>
                    <span style={{ color: "#cdd" }}>{m.msg}</span>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* ── Input row ────────────────────────────────────────────────── */}
            <div
              style={{
                display:     "flex",
                gap:         6,
                padding:     "7px 8px",
                borderTop:   `1px solid rgba(255,255,255,0.06)`,
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={draft}
                maxLength={180}
                placeholder="Type a message…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                  flex:        1,
                  background:  "rgba(255,255,255,0.05)",
                  border:      `1px solid rgba(255,255,255,0.10)`,
                  borderRadius: 6,
                  color:       "#dde",
                  fontFamily:  "'Courier New', monospace",
                  fontSize:    11,
                  padding:     "5px 8px",
                  outline:     "none",
                }}
              />
              <button
                onClick={handleSend}
                disabled={!draft.trim()}
                style={{
                  padding:      "5px 10px",
                  borderRadius:  6,
                  border:       `1px solid ${draft.trim() ? accentColor : "rgba(255,255,255,0.10)"}`,
                  background:   draft.trim() ? `${accentColor}22` : "transparent",
                  color:        draft.trim() ? accentColor : "#445",
                  fontFamily:   "'Courier New', monospace",
                  fontSize:     11,
                  cursor:       draft.trim() ? "pointer" : "default",
                  fontWeight:   "bold",
                  transition:   "all 0.15s",
                }}
              >
                Send
              </button>
            </div>

            <div
              style={{
                fontSize:  9,
                color:     "#334",
                textAlign: "center",
                padding:   "3px 0 5px",
              }}
            >
              ENTER to send · ESC to close
            </div>
          </>
        )}
      </div>
    </div>
  );
}
