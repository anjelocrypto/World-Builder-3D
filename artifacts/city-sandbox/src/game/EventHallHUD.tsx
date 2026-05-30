/**
 * Phase 14A — EventHallHUD.
 *
 * Opened with E near the Grand Plaza Hall screen. Lets a presenter open a
 * Google Meet (or any http/https link) in a NEW BROWSER TAB. The meeting is
 * NOT embedded in-world (Meet forbids iframing; we never pretend otherwise) —
 * the in-world screen shows only a static branded placeholder.
 *
 * - Editable URL field, default placeholder https://meet.google.com/.
 * - Only http/https URLs may be opened (validated before window.open).
 * - Not persisted to any DB this phase (local component state only).
 * - Esc or backdrop click closes. Input stopPropagation so typing never moves
 *   the player or triggers gameplay/chat/voice keys.
 */

import { useEffect, useRef, useState } from "react";

const DEFAULT_URL = "https://meet.google.com/";
const ACCENT = "#2bd4ff";

interface EventHallHUDProps {
  onClose: () => void;
}

/** True only for a well-formed absolute http/https URL. */
function isSafeUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function EventHallHUD({ onClose }: EventHallHUDProps) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const valid = isSafeUrl(url);
  const isMeetDefault = url.trim() === DEFAULT_URL; // bare host, no room code yet

  const openMeet = () => {
    if (!valid) return;
    // New tab; never embed. noopener/noreferrer for safety.
    window.open(url.trim(), "_blank", "noopener,noreferrer");
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2600,
        background: "rgba(2,6,14,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Courier New', monospace",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: 420,
          background: "linear-gradient(160deg, #0a1830 0%, #060a14 100%)",
          border: `1.5px solid ${ACCENT}`,
          borderRadius: 12,
          padding: "20px 22px 22px",
          color: "#e9f6ff",
          boxShadow: "0 0 34px rgba(43,212,255,0.22), 0 10px 28px rgba(0,0,0,0.7)",
          userSelect: "none",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 1, color: ACCENT }}>🎬 GRAND PLAZA HALL</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: `1px solid ${ACCENT}55`, borderRadius: 6, color: ACCENT, cursor: "pointer", padding: "2px 9px", fontSize: 13 }}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#9fc6dd", marginBottom: 16, lineHeight: 1.5 }}>
          Event screen. Open a Google Meet in a new tab to present. The meeting
          opens in your browser — it is not embedded on the in-world screen.
        </div>

        {/* URL input */}
        <label style={{ fontSize: 10, color: "#7fb4cc", letterSpacing: 1 }}>MEETING URL (http/https)</label>
        <input
          ref={inputRef}
          type="text"
          value={url}
          placeholder="https://meet.google.com/abc-defg-hij"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); openMeet(); }
            e.stopPropagation();
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            marginTop: 5,
            marginBottom: 8,
            background: "rgba(255,255,255,0.06)",
            border: `1px solid ${valid ? `${ACCENT}66` : "rgba(255,120,120,0.5)"}`,
            borderRadius: 7,
            color: "#dff3ff",
            fontFamily: "'Courier New', monospace",
            fontSize: 12,
            padding: "8px 10px",
            outline: "none",
          }}
        />
        {!valid && url.trim() !== "" && (
          <div style={{ fontSize: 10, color: "#ff8a8a", marginBottom: 8 }}>
            Only valid http:// or https:// links can be opened.
          </div>
        )}
        {valid && isMeetDefault && (
          <div style={{ fontSize: 10, color: "#9fc6dd", marginBottom: 8 }}>
            Tip: paste your full meeting link (e.g. https://meet.google.com/abc-defg-hij).
          </div>
        )}

        {/* Actions */}
        <button
          onClick={openMeet}
          disabled={!valid}
          style={{
            width: "100%",
            marginTop: 4,
            padding: "10px 0",
            borderRadius: 8,
            border: `1px solid ${valid ? ACCENT : "rgba(255,255,255,0.12)"}`,
            background: valid ? `${ACCENT}22` : "transparent",
            color: valid ? ACCENT : "#566",
            fontFamily: "'Courier New', monospace",
            fontSize: 13,
            fontWeight: "bold",
            letterSpacing: 1,
            cursor: valid ? "pointer" : "default",
          }}
        >
          ↗ OPEN GOOGLE MEET (NEW TAB)
        </button>

        <div style={{ fontSize: 9, color: "#46637a", textAlign: "center", marginTop: 12 }}>
          ENTER to open · ESC to close · Live screen-share coming later
        </div>
      </div>
    </div>
  );
}
