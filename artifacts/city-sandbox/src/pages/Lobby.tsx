import { useState } from "react";

interface LobbyProps {
  onJoin: (username: string) => void;
  playerCount: number;
}

export default function Lobby({ onJoin, playerCount }: LobbyProps) {
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
        width: "100vw",
        height: "100vh",
        background: "#0a0a1a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Courier New', monospace",
        color: "#e0e0e0",
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
            textShadow: "0 0 30px rgba(0,229,255,0.5)",
            marginBottom: 8,
          }}
        >
          CITY SANDBOX
        </div>
        <div style={{ fontSize: 14, color: "#556", letterSpacing: 3 }}>
          OPEN WORLD MULTIPLAYER
        </div>
      </div>

      {/* Card */}
      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(0,229,255,0.2)",
          borderRadius: 8,
          padding: "40px 48px",
          minWidth: 340,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 13, color: "#aaa", marginBottom: 4 }}>
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
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(0,229,255,0.3)",
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
          }}
        >
          JOIN WORLD
        </button>
      </div>

      {/* Player count */}
      <div
        style={{
          marginTop: 24,
          fontSize: 13,
          color: "#556",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
        data-testid="text-playercount"
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
        {playerCount} player{playerCount !== 1 ? "s" : ""} online
      </div>

      {/* Controls info */}
      <div
        style={{
          marginTop: 40,
          fontSize: 11,
          color: "#445",
          textAlign: "center",
          lineHeight: 2,
        }}
      >
        WASD — Move &nbsp;|&nbsp; Shift — Run &nbsp;|&nbsp; Space — Jump
        <br />
        E — Enter/Exit Vehicle &nbsp;|&nbsp; Click — Capture Mouse
        <br />
        Drive through checkpoints to start a race
      </div>
    </div>
  );
}
