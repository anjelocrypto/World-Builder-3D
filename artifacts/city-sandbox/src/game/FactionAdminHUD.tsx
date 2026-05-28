/**
 * Phase 7C: FactionAdminHUD — DEV-ONLY faction assignment panel.
 *
 * - Only rendered when import.meta.env.DEV is true (Vite dev mode).
 * - Toggled with F7 key (handled by GameScene, which also guards modal conflicts).
 * - Lets a developer pick an online player, choose a faction slug (or "none"),
 *   set a rank 0–10, and submit rp:adminSetFaction.
 * - Does NOT render in production — the component returns null immediately.
 * - Clearly labelled "DEV FACTION ADMIN" so it cannot be confused with
 *   player-facing UI.
 * - Input fields capture keyboard focus so WASD/etc. don't move the player
 *   while the panel is open. e.stopPropagation() on key events.
 *
 * Security: emitAdminSetFaction emits to rp:adminSetFaction, which is not
 * registered on the server in production. Belt-and-suspenders: the server
 * also rejects it if NODE_ENV === "production". This UI only being rendered
 * in DEV is a third layer.
 */

import { useEffect, useRef, useState } from "react";
import type { FactionSummary, OnlinePlayerFactionSummary } from "../shared/rpTypes";

// ── Styling constants (matches existing HUD palette) ──────────────────────────
const PANEL_BG     = "rgba(8, 14, 28, 0.96)";
const PANEL_BORDER = "rgba(255, 200, 0, 0.35)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW = "0 8px 28px rgba(0,0,0,0.75), 0 0 1px rgba(255,200,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)";
const DEV_ACCENT   = "#ffcc00";

interface FactionAdminHUDProps {
  factions:            FactionSummary[];
  onlinePlayers:       OnlinePlayerFactionSummary[];
  mySocketId:          string;
  onRefreshFactions:   () => void;
  onRefreshPlayers:    () => void;
  onSetFaction:        (targetId: string, factionSlug: string, rank: number) => void;
  onClose:             () => void;
}

export default function FactionAdminHUD({
  factions,
  onlinePlayers,
  mySocketId,
  onRefreshFactions,
  onRefreshPlayers,
  onSetFaction,
  onClose,
}: FactionAdminHUDProps) {
  // ── Hard production guard ─────────────────────────────────────────────────
  // Vite replaces import.meta.env.DEV at build time; in production the whole
  // component tree is dead code that tree-shaking will eliminate.
  if (!import.meta.env.DEV) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [selectedFactionSlug, setSelectedFactionSlug] = useState<string>("none");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [rank, setRank] = useState<number>(0);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [lastResult, setLastResult] = useState<string>("");

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape key closes the panel.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Refresh both lists when first opened.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    onRefreshFactions();
    onRefreshPlayers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopProp = (e: React.KeyboardEvent) => e.stopPropagation();

  const handleSubmit = () => {
    if (!selectedTargetId) {
      setLastResult("⚠ No player selected.");
      return;
    }
    onSetFaction(selectedTargetId, selectedFactionSlug, rank);
    const target = onlinePlayers.find((p) => p.socketId === selectedTargetId);
    const targetName = target?.username ?? selectedTargetId;
    const factionLabel = selectedFactionSlug === "none" ? "none (clear)" : selectedFactionSlug;
    setLastResult(`✓ Sent: ${targetName} → ${factionLabel} rank ${rank}`);
  };

  const rankStr   = String(rank);
  const clampRank = (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n)) return;
    setRank(Math.max(0, Math.min(10, n)));
  };

  const inputStyle: React.CSSProperties = {
    background:   "rgba(255,255,255,0.06)",
    border:       "1px solid rgba(255,255,255,0.12)",
    borderRadius: 5,
    color:        "#dde",
    fontFamily:   "'Courier New', monospace",
    fontSize:     11,
    padding:      "4px 7px",
    outline:      "none",
    width:        "100%",
    boxSizing:    "border-box",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding:      "5px 12px",
    borderRadius: 5,
    border:       `1px solid ${active ? DEV_ACCENT : "rgba(255,255,255,0.12)"}`,
    background:   active ? `${DEV_ACCENT}22` : "rgba(255,255,255,0.04)",
    color:        active ? DEV_ACCENT : "#556",
    fontFamily:   "'Courier New', monospace",
    fontSize:     11,
    cursor:       active ? "pointer" : "default",
    fontWeight:   "bold",
    transition:   "all 0.12s",
    whiteSpace:   "nowrap",
  });

  // Find the selected player's current faction for display.
  const selectedPlayer = onlinePlayers.find((p) => p.socketId === selectedTargetId);

  return (
    <div
      ref={containerRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position:   "fixed",
        top:        60,
        left:       16,
        width:      340,
        zIndex:     3000,
        fontFamily: "'Courier New', monospace",
        userSelect: "none",
      }}
    >
      <div
        style={{
          background:     PANEL_BG,
          border:         `1px solid ${PANEL_BORDER}`,
          borderRadius:   PANEL_RADIUS,
          boxShadow:      PANEL_SHADOW,
          backdropFilter: "blur(14px)",
          overflow:       "hidden",
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            padding:        "9px 12px 8px",
            borderBottom:   "1px solid rgba(255,200,0,0.12)",
            background:     "rgba(255,200,0,0.07)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 14 }}>⚙</span>
            <span
              style={{
                fontSize:      11,
                fontWeight:    "bold",
                color:         DEV_ACCENT,
                letterSpacing: 1.5,
              }}
            >
              DEV FACTION ADMIN
            </span>
            <span
              style={{
                fontSize:      9,
                color:         "#664400",
                background:    "rgba(255,160,0,0.15)",
                border:        "1px solid rgba(255,160,0,0.25)",
                borderRadius:  3,
                padding:       "1px 5px",
                letterSpacing: 1,
              }}
            >
              DEV ONLY
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background:  "transparent",
              border:      "none",
              color:       "#556",
              fontSize:    14,
              cursor:      "pointer",
              lineHeight:  1,
              padding:     "0 2px",
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Online player selector */}
          <div>
            <div style={{ fontSize: 10, color: "#778", letterSpacing: 1, marginBottom: 4 }}>
              TARGET PLAYER ({onlinePlayers.length} online)
              <button
                onClick={() => { onRefreshPlayers(); onRefreshFactions(); }}
                style={{
                  marginLeft:   8,
                  background:   "transparent",
                  border:       "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 3,
                  color:        "#667",
                  fontSize:     9,
                  cursor:       "pointer",
                  padding:      "1px 5px",
                  fontFamily:   "'Courier New', monospace",
                }}
              >
                ↺ refresh
              </button>
            </div>
            <select
              value={selectedTargetId}
              onChange={(e) => setSelectedTargetId(e.target.value)}
              onKeyDown={stopProp}
              style={selectStyle}
            >
              <option value="">— select player —</option>
              {onlinePlayers.map((p) => (
                <option key={p.socketId} value={p.socketId}>
                  {p.username}
                  {p.socketId === mySocketId ? " (you)" : ""}
                  {" "}
                  [{p.factionSlug ?? "no faction"} r{p.factionRank}]
                </option>
              ))}
            </select>
            {selectedPlayer && (
              <div style={{ fontSize: 10, color: "#556", marginTop: 3 }}>
                Current:{" "}
                <span style={{ color: "#8ab" }}>
                  {selectedPlayer.factionName ?? "none"}{" "}
                  (rank {selectedPlayer.factionRank})
                </span>
              </div>
            )}
          </div>

          {/* Faction selector */}
          <div>
            <div style={{ fontSize: 10, color: "#778", letterSpacing: 1, marginBottom: 4 }}>
              FACTION
            </div>
            <select
              value={selectedFactionSlug}
              onChange={(e) => setSelectedFactionSlug(e.target.value)}
              onKeyDown={stopProp}
              style={selectStyle}
            >
              <option value="none">none (clear faction)</option>
              {factions.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name} [{f.type}]
                </option>
              ))}
            </select>
          </div>

          {/* Rank input */}
          <div>
            <div style={{ fontSize: 10, color: "#778", letterSpacing: 1, marginBottom: 4 }}>
              RANK (0–10)
            </div>
            <input
              type="number"
              min={0}
              max={10}
              step={1}
              value={rankStr}
              onChange={(e) => clampRank(e.target.value)}
              onKeyDown={stopProp}
              disabled={selectedFactionSlug === "none"}
              style={{
                ...inputStyle,
                width: 80,
                opacity: selectedFactionSlug === "none" ? 0.4 : 1,
              }}
            />
          </div>

          {/* Submit row */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleSubmit}
              style={btnStyle(!!selectedTargetId)}
              disabled={!selectedTargetId}
            >
              Apply Faction
            </button>
            {lastResult && (
              <span style={{ fontSize: 10, color: "#8ab", flex: 1 }}>
                {lastResult}
              </span>
            )}
          </div>

          {/* ── Online player summary table ─────────────────────────────── */}
          {onlinePlayers.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "#778", letterSpacing: 1, marginBottom: 4 }}>
                ONLINE FACTION SUMMARY
              </div>
              <div
                style={{
                  maxHeight:  160,
                  overflowY:  "auto",
                  border:     "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 5,
                }}
              >
                {onlinePlayers.map((p) => (
                  <div
                    key={p.socketId}
                    onClick={() => setSelectedTargetId(p.socketId)}
                    style={{
                      display:         "flex",
                      justifyContent:  "space-between",
                      alignItems:      "center",
                      padding:         "4px 8px",
                      cursor:          "pointer",
                      background:      selectedTargetId === p.socketId
                        ? "rgba(255,200,0,0.08)"
                        : "transparent",
                      borderBottom:    "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <span style={{ fontSize: 10, color: "#cdd" }}>
                      {p.username}
                      {p.socketId === mySocketId ? (
                        <span style={{ color: "#556", marginLeft: 4, fontSize: 9 }}>(you)</span>
                      ) : null}
                    </span>
                    <span
                      style={{
                        fontSize:      9,
                        color:         p.factionSlug ? "#8ab" : "#445",
                        letterSpacing: 0.5,
                      }}
                    >
                      {p.factionSlug ?? "—"}{" "}
                      {p.factionSlug ? `r${p.factionRank}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hint footer */}
          <div style={{ fontSize: 9, color: "#334", textAlign: "center", paddingTop: 2 }}>
            ESC / F7 to close · server rejects in production
          </div>
        </div>
      </div>
    </div>
  );
}
