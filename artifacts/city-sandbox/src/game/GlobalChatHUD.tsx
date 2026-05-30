/**
 * Phase comms: GlobalChatHUD — a togglable GLOBAL text chat panel.
 *
 * Bottom-LEFT corner (faction chat is bottom-right), warm-amber accent so the
 * two are visually distinct. Toggle with the T key (handled in GameScene).
 * Open to all players (no faction gate). Transient/in-memory — the message list
 * comes from useRpSocket and is not persisted.
 *
 * The input captures keyboard focus while open and stopPropagation()s key
 * events so typing never moves the player or triggers gameplay keys. ESC closes.
 */

import { useEffect, useRef, useState } from "react";
import type { RpGlobalMessage } from "../shared/rpTypes";

const PANEL_BG     = "rgba(8, 14, 28, 0.94)";
const ACCENT       = "#ffb74d"; // warm amber — distinct from faction-chat cyan
const PANEL_BORDER = "rgba(255, 183, 77, 0.28)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 24px rgba(0,0,0,0.6), 0 0 1px rgba(255,183,77,0.2), inset 0 1px 0 rgba(255,255,255,0.04)";

/** Must match server GLOBAL_CHAT_MAX_LEN. */
const MAX_LEN = 200;

interface GlobalChatHUDProps {
  messages: RpGlobalMessage[];
  onSend:   (msg: string) => void;
  onClose:  () => void;
}

export default function GlobalChatHUD({ messages, onSend, onClose }: GlobalChatHUDProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
    // Stop game keys (WASD/space/etc.) from firing while typing.
    e.stopPropagation();
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        bottom: 90,
        left: 16,
        width: 340,
        zIndex: 2200,
        fontFamily: "'Courier New', monospace",
        userSelect: "none",
      }}
    >
      <div
        style={{
          background: PANEL_BG,
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: PANEL_RADIUS,
          boxShadow: PANEL_SHADOW,
          backdropFilter: "blur(12px)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "9px 12px 8px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: ACCENT,
                boxShadow: `0 0 6px ${ACCENT}`,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, fontWeight: "bold", color: ACCENT, letterSpacing: 1 }}>
              🌐 GLOBAL CHAT
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#556", fontSize: 14, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}
          >
            ✕
          </button>
        </div>

        {/* Message history */}
        <div
          style={{
            height: 200,
            overflowY: "auto",
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ color: "#334", fontSize: 11, margin: "auto", textAlign: "center" }}>
              No messages yet. Say hi to the city!
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} style={{ fontSize: 11, lineHeight: 1.45 }}>
                <span style={{ color: ACCENT, fontWeight: "bold", marginRight: 5 }}>{m.fromName}:</span>
                <span style={{ color: "#cdd", wordBreak: "break-word" }}>{m.msg}</span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input row */}
        <div style={{ display: "flex", gap: 6, padding: "7px 8px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={MAX_LEN}
            placeholder="Message everyone…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 6,
              color: "#dde",
              fontFamily: "'Courier New', monospace",
              fontSize: 11,
              padding: "5px 8px",
              outline: "none",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim()}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: `1px solid ${draft.trim() ? ACCENT : "rgba(255,255,255,0.10)"}`,
              background: draft.trim() ? `${ACCENT}22` : "transparent",
              color: draft.trim() ? ACCENT : "#445",
              fontFamily: "'Courier New', monospace",
              fontSize: 11,
              cursor: draft.trim() ? "pointer" : "default",
              fontWeight: "bold",
              transition: "all 0.15s",
            }}
          >
            Send
          </button>
        </div>

        <div style={{ fontSize: 9, color: "#334", textAlign: "center", padding: "3px 0 5px" }}>
          ENTER to send · ESC to close · T to toggle
        </div>
      </div>
    </div>
  );
}
