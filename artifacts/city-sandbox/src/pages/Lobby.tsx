import { useState } from "react";
import MenuWorldPreview from "@/game/MenuWorldPreview";
import { CHARACTER_LIST, type CharacterId } from "@/game/character/characterCatalog";

// =============================================================
// Lobby — NEMOVERSE name + character select (step 2 after AuthGate).
// VISUAL/branding only: red + white over near-black, matching AuthGate. All
// logic (onJoin, validation, character picker, data-testids) is unchanged.
// =============================================================

interface LobbyProps {
  onJoin: (username: string, character: CharacterId) => void;
}

const STYLES = `
.lb-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Arial,sans-serif;}
.lb-input{transition:border-color .18s ease,box-shadow .18s ease;}
.lb-input::placeholder{color:#6f727a;}
.lb-input:focus{border-color:#ff2d3a;box-shadow:0 0 0 3px rgba(226,29,43,.18);}
.lb-char{transition:transform .12s ease,background .18s ease,border-color .18s ease,box-shadow .2s ease;}
.lb-char:hover{transform:translateY(-1px);}
.lb-join{transition:transform .12s ease,box-shadow .22s ease;}
.lb-join:hover{transform:translateY(-1px);box-shadow:0 16px 46px rgba(226,29,43,.58),inset 0 1px 0 rgba(255,255,255,.34);}
.lb-join:active{transform:translateY(1px) scale(.996);}
`;

export default function Lobby({ onJoin }: LobbyProps) {
  const [username, setUsername] = useState("");
  const [character, setCharacter] = useState<CharacterId>("classic");
  const [error, setError] = useState("");

  const handleJoin = () => {
    const name = username.trim();
    if (!name || name.length < 2) {
      setError("Username must be at least 2 characters.");
      return;
    }
    if (name.length > 20) {
      setError("Username must be 20 characters or less.");
      return;
    }
    setError("");
    onJoin(name, character);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleJoin();
  };

  return (
    <div
      className="lb-root"
      style={{
        position: "relative", width: "100vw", height: "100vh", overflow: "hidden",
        color: "#fff", background: "#08080a",
      }}
    >
      <style>{STYLES}</style>

      {/* Live 3D world preview behind the UI (no socket / no HUD). */}
      <MenuWorldPreview />

      {/* Cinematic grade — matches the AuthGate landing. */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 38%, rgba(8,8,10,0.10) 0%, rgba(6,6,8,0.70) 60%, rgba(2,2,4,0.94) 100%)",
      }} />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "linear-gradient(180deg, rgba(150,12,20,0.22) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 58%, rgba(120,10,16,0.30) 100%)",
      }} />

      {/* Foreground */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 2,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "24px", boxSizing: "border-box",
      }}>
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 6, color: "#ff3b46",
            marginBottom: 12, textTransform: "uppercase",
          }}>
            ◆ Create your character
          </div>
          <div style={{
            fontSize: "clamp(34px, 6.5vw, 62px)", fontWeight: 900, color: "#fff",
            letterSpacing: 6, lineHeight: 0.95,
            textShadow: "0 0 40px rgba(226,29,43,0.42), 0 8px 30px rgba(0,0,0,0.85)",
          }}>
            NEMOVERSE
          </div>
          <div style={{
            margin: "14px auto 0", width: 56, height: 3, borderRadius: 2,
            background: "linear-gradient(90deg, rgba(226,29,43,0) 0%, #ff2d3a 50%, rgba(226,29,43,0) 100%)",
          }} />
        </div>

        {/* Panel — dark glass / metal */}
        <div style={{
          width: "min(92vw, 400px)", boxSizing: "border-box",
          background: "rgba(12,12,14,0.62)",
          backdropFilter: "blur(16px) saturate(120%)",
          WebkitBackdropFilter: "blur(16px) saturate(120%)",
          border: "1px solid rgba(226,29,43,0.22)",
          borderRadius: 16, padding: "26px 26px",
          display: "flex", flexDirection: "column", gap: 12,
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px rgba(226,29,43,0.10)",
        }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 2, color: "#b8bcc4" }}>
            CHOOSE YOUR NAME
          </div>
          <input
            className="lb-input"
            data-testid="input-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Enter username…"
            maxLength={20}
            autoFocus
            style={{
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: 10, padding: "12px 14px",
              color: "#fff", fontSize: 16, fontFamily: "inherit", outline: "none",
            }}
          />
          {error && (
            <div style={{ fontSize: 12, color: "#ff8a90" }}>{error}</div>
          )}

          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 2, color: "#b8bcc4", marginTop: 4 }}>
            CHOOSE YOUR CHARACTER
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {CHARACTER_LIST.map((c) => {
              const selected = character === c.id;
              return (
                <button
                  key={c.id}
                  className="lb-char"
                  data-testid={`button-character-${c.id}`}
                  onClick={() => setCharacter(c.id)}
                  style={{
                    flex: 1, padding: "11px 0", borderRadius: 10, cursor: "pointer",
                    fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, letterSpacing: 0.6,
                    color: "#fff",
                    background: selected
                      ? "linear-gradient(180deg,#ff2d3a 0%,#c20f1c 100%)"
                      : "rgba(255,255,255,0.05)",
                    border: `1px solid ${selected ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.16)"}`,
                    boxShadow: selected ? "0 8px 22px rgba(226,29,43,0.40)" : "none",
                  }}
                >
                  {c.label.toUpperCase()}
                </button>
              );
            })}
          </div>

          <button
            className="lb-join"
            data-testid="button-join"
            onClick={handleJoin}
            style={{
              marginTop: 8, padding: "13px 0", borderRadius: 12, cursor: "pointer",
              fontFamily: "inherit", fontSize: 15, fontWeight: 800, letterSpacing: 2, color: "#fff",
              background: "linear-gradient(180deg,#ff2d3a 0%,#c20f1c 100%)",
              border: "1px solid rgba(255,255,255,0.20)",
              boxShadow: "0 12px 34px rgba(226,29,43,.40), inset 0 1px 0 rgba(255,255,255,.28)",
            }}
          >
            JOIN WORLD
          </button>
        </div>

        {/* Server status */}
        <div
          style={{
            marginTop: 22, fontSize: 12.5, color: "#cfd2d8",
            display: "flex", alignItems: "center", gap: 8,
            textShadow: "0 2px 8px rgba(0,0,0,0.8)",
          }}
          data-testid="text-server-status"
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2ecc71", boxShadow: "0 0 8px #2ecc71" }} />
          Server online — join to see other players
        </div>

        {/* Controls */}
        <div style={{
          marginTop: 28, fontSize: 11.5, color: "#8a8d95", textAlign: "center",
          lineHeight: 1.9, letterSpacing: 0.3, textShadow: "0 2px 8px rgba(0,0,0,0.85)",
        }}>
          WASD — Move&nbsp;&nbsp;·&nbsp;&nbsp;Shift — Run&nbsp;&nbsp;·&nbsp;&nbsp;Space — Jump
          <br />
          E — Enter/Exit Vehicle&nbsp;&nbsp;·&nbsp;&nbsp;Click — Capture Mouse
        </div>
      </div>
    </div>
  );
}
