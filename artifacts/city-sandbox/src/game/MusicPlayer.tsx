import { useState } from "react";
import { useGameMusic } from "../hooks/useGameMusic";

// =============================================================
// MusicPlayer — compact in-game soundtrack control (bottom-left).
// Play/pause, next track, mute, and a volume slider (lower ↔ max). Loops the
// MUSIC_TRACKS playlist forever. Mount once in GameScene. Client-only audio.
// =============================================================

const RED = "#ff2d3a";

export default function MusicPlayer() {
  const { track, total, isPlaying, volume, muted, setVolume, toggleMute, next, togglePlay } = useGameMusic();
  const [open, setOpen] = useState(true);

  if (!track) return null;

  const pct = Math.round((muted ? 0 : volume) * 100);

  const iconBtn = (label: string, onClick: () => void, title: string) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26, height: 26, flex: "0 0 auto", display: "flex", alignItems: "center",
        justifyContent: "center", cursor: "pointer", borderRadius: 7, fontSize: 13,
        color: "#fff", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid="hud-music-player"
      style={{
        position: "fixed", bottom: 76, left: 22, zIndex: 1500, pointerEvents: "auto",
        fontFamily: "-apple-system, system-ui, 'Segoe UI', sans-serif",
        background: "rgba(12,12,14,0.7)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(226,29,43,0.28)", borderRadius: 12,
        boxShadow: "0 12px 34px rgba(0,0,0,0.5), 0 0 40px rgba(226,29,43,0.08)",
        padding: open ? "8px 10px" : "6px",
        display: "flex", alignItems: "center", gap: 8, userSelect: "none",
      }}
    >
      {/* Note / collapse toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? "Hide music" : "Show music"}
        style={{
          width: 28, height: 28, flex: "0 0 auto", display: "flex", alignItems: "center",
          justifyContent: "center", cursor: "pointer", borderRadius: 8, fontSize: 14, color: "#fff",
          background: `linear-gradient(180deg, ${RED} 0%, #c20f1c 100%)`,
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        ♪
      </button>

      {open && (
        <>
          {iconBtn(isPlaying ? "⏸" : "▶", togglePlay, isPlaying ? "Pause" : "Play")}

          <div style={{ minWidth: 0, width: 120 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {track.title}
            </div>
            <div style={{
              fontSize: 10.5, color: "#9a9da5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {track.artist ?? "Soundtrack"}{total > 1 ? ` · ${total} tracks` : ""}
            </div>
          </div>

          {total > 1 && iconBtn("⏭", next, "Next track")}
          {iconBtn(muted || volume === 0 ? "🔇" : "🔊", toggleMute, muted ? "Unmute" : "Mute")}

          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            title={`Volume ${pct}%`}
            aria-label="Music volume"
            style={{ width: 96, accentColor: RED, cursor: "pointer" }}
          />
        </>
      )}
    </div>
  );
}
