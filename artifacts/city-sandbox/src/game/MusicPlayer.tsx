import { useState } from "react";
import { Music, Play, Pause, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useGameMusic } from "../hooks/useGameMusic";

// =============================================================
// MusicPlayer — compact in-game soundtrack control (bottom-left, Trench Theft Auto).
// Play/pause, next track, mute, and a red volume slider (lower ↔ max). Loops
// the MUSIC_TRACKS playlist forever. Mount once in GameScene. Behaviour (hook,
// localStorage, loop, next/mute/slider) is unchanged — this is the brand skin.
// =============================================================

const RED = "#ff3b46";
// Shared Trench Theft Auto HUD chassis (mirrors HUD.tsx PANEL_* so panels match).
const PANEL_BG = "rgba(10, 10, 12, 0.74)";
const PANEL_BORDER = "rgba(226, 29, 43, 0.30)";
const PANEL_SHADOW = "0 8px 24px rgba(0,0,0,0.5), 0 0 1px rgba(226,29,43,0.30), inset 0 1px 0 rgba(255,255,255,0.05)";
const LABEL = "#9aa0aa";

export default function MusicPlayer() {
  const { track, total, isPlaying, volume, muted, setVolume, toggleMute, next, togglePlay } = useGameMusic();
  const [open, setOpen] = useState(true);

  if (!track) return null;

  const pct = Math.round((muted ? 0 : volume) * 100);

  const iconBtn = (icon: React.ReactNode, onClick: () => void, title: string) => (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 28, height: 28, flex: "0 0 auto", display: "flex", alignItems: "center",
        justifyContent: "center", cursor: "pointer", borderRadius: 8,
        color: "#e8eaee", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {icon}
    </button>
  );

  return (
    <div
      data-testid="hud-music-player"
      style={{
        position: "fixed", bottom: 96, left: 22, zIndex: 1500, pointerEvents: "auto",
        fontFamily: "-apple-system, system-ui, 'Segoe UI', sans-serif",
        background: PANEL_BG, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        border: `1px solid ${PANEL_BORDER}`, borderRadius: 10, boxShadow: PANEL_SHADOW,
        padding: open ? "8px 10px" : "6px",
        display: "flex", alignItems: "center", gap: 8, userSelect: "none",
      }}
    >
      {/* Brand mark / collapse toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? "Hide music" : "Show music"}
        aria-label={open ? "Hide music" : "Show music"}
        style={{
          width: 30, height: 30, flex: "0 0 auto", display: "flex", alignItems: "center",
          justifyContent: "center", cursor: "pointer", borderRadius: 8, color: "#fff",
          background: `linear-gradient(180deg, ${RED} 0%, #c20f1c 100%)`,
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        <Music size={15} />
      </button>

      {open && (
        <>
          {iconBtn(isPlaying ? <Pause size={15} /> : <Play size={15} />, togglePlay, isPlaying ? "Pause" : "Play")}

          <div style={{ minWidth: 0, width: 118 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {track.title}
            </div>
            <div style={{
              fontSize: 10.5, color: LABEL, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {track.artist ?? "Soundtrack"}{total > 1 ? ` · ${total} tracks` : ""}
            </div>
          </div>

          {total > 1 && iconBtn(<SkipForward size={15} />, next, "Next track")}
          {iconBtn(muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />, toggleMute, muted ? "Unmute" : "Mute")}

          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            title={`Volume ${pct}%`}
            aria-label="Music volume"
            style={{ width: 92, height: 4, accentColor: RED, cursor: "pointer" }}
          />
        </>
      )}
    </div>
  );
}
