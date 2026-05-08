import { useState } from "react";
import MenuWorldPreview from "@/game/MenuWorldPreview";

interface LobbyProps {
  onJoin: (username: string) => void;
}

export default function Lobby({ onJoin }: LobbyProps) {
  const [username, setUsername] = useState("");
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
    onJoin(name);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleJoin();
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "'Courier New', monospace",
        color: "#e0e0e0",
        background: "#0a0a1a",
      }}
    >
      {/* Live 3D world preview — full-screen behind the lobby UI.
          Owns its own R3F Canvas so it can mount/unmount cleanly when
          the user joins and App.tsx swaps to <Game />. No socket, no
          player models, no HUD — see MenuWorldPreview. */}
      <MenuWorldPreview />

      {/* Dark vignette overlay for legibility — keeps the world
          visible everywhere but darkens the edges and the bottom
          where the controls hint sits. pointer-events: none so the
          input + button below stay clickable. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(10,10,26,0.15) 0%, rgba(10,10,26,0.6) 70%, rgba(10,10,26,0.85) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Foreground UI layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div
            style={{
              fontSize: 48,
              fontWeight: "bold",
              color: "#00e5ff",
              letterSpacing: 6,
              textShadow:
                "0 0 30px rgba(0,229,255,0.6), 0 4px 18px rgba(0,0,0,0.8)",
              marginBottom: 8,
            }}
          >
            HANTA CITY
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#9bb",
              letterSpacing: 3,
              textShadow: "0 2px 10px rgba(0,0,0,0.8)",
            }}
          >
            HANTAVIRUS MULTIPLAYER GAMEPLAY
          </div>
        </div>

        {/* Card — translucent + blurred so the live world remains
            visible behind it. Falls back to solid darkness on
            browsers without backdrop-filter support. */}
        <div
          style={{
            background: "rgba(10, 10, 26, 0.55)",
            backdropFilter: "blur(14px) saturate(140%)",
            WebkitBackdropFilter: "blur(14px) saturate(140%)",
            border: "1px solid rgba(0,229,255,0.35)",
            borderRadius: 8,
            padding: "40px 48px",
            minWidth: 340,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxShadow:
              "0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(0,229,255,0.08)",
          }}
        >
          <div style={{ fontSize: 13, color: "#aac", marginBottom: 4 }}>
            CHOOSE YOUR NAME
          </div>
          <input
            data-testid="input-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Enter username..."
            maxLength={20}
            autoFocus
            style={{
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(0,229,255,0.4)",
              borderRadius: 4,
              padding: "10px 14px",
              color: "#fff",
              fontSize: 16,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          {error && (
            <div style={{ fontSize: 12, color: "#e74c3c" }}>{error}</div>
          )}

          <button
            data-testid="button-join"
            onClick={handleJoin}
            style={{
              background: "#00e5ff",
              color: "#000",
              border: "none",
              borderRadius: 4,
              padding: "12px 0",
              fontSize: 15,
              fontWeight: "bold",
              fontFamily: "inherit",
              letterSpacing: 2,
              cursor: "pointer",
              marginTop: 8,
              boxShadow: "0 6px 20px rgba(0,229,255,0.35)",
            }}
          >
            JOIN WORLD
          </button>
        </div>

        {/* Server status indicator (live player count is shown in-game after joining) */}
        <div
          style={{
            marginTop: 24,
            fontSize: 13,
            color: "#aac",
            display: "flex",
            alignItems: "center",
            gap: 8,
            textShadow: "0 2px 8px rgba(0,0,0,0.8)",
          }}
          data-testid="text-server-status"
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#2ecc71",
              boxShadow: "0 0 8px #2ecc71",
            }}
          />
          Server online — join to see other players
        </div>

        {/* Controls info */}
        <div
          style={{
            marginTop: 40,
            fontSize: 11,
            color: "#99a",
            textAlign: "center",
            lineHeight: 2,
            textShadow: "0 2px 8px rgba(0,0,0,0.85)",
          }}
        >
          WASD — Move &nbsp;|&nbsp; Shift — Run &nbsp;|&nbsp; Space — Jump
          <br />
          E — Enter/Exit Vehicle &nbsp;|&nbsp; Click — Capture Mouse
          <br />
          Drive through checkpoints to start a race
        </div>
      </div>
    </div>
  );
}
