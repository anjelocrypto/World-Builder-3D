import { useEffect, useRef } from "react";
import {
  CHECKPOINTS,
  REGIONAL_ROADS,
  ROADS,
  BIOME_BOUNDS,
  WORLD_HALF,
  WORLD_SIZE,
} from "../shared/cityData";

interface HUDProps {
  health: number;
  speed: number;
  inVehicle: boolean;
  showInteract: boolean;
  vehicleLabel: string;
  playerCount: number;
  myId: string;
  username: string;
  raceActive: boolean;
  raceTime: number;
  racePassed: number[];
  playerPositionX: number;
  playerPositionZ: number;
  connected: boolean;
}

function Minimap({ px, pz }: { px: number; pz: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    // 1000-unit map covers the canvas; world x/z [-500..500] → [0..W].
    const SCALE = W / WORLD_SIZE;
    const toMapX = (wx: number) => (wx + WORLD_HALF) * SCALE;
    const toMapZ = (wz: number) => (wz + WORLD_HALF) * SCALE;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, W, H);

    // Per-biome tints (drawn under everything)
    const tints: Array<[keyof typeof BIOME_BOUNDS, string]> = [
      ["mountain", "rgba(120,120,140,0.30)"],
      ["forest",   "rgba(60,140,70,0.30)"],
      ["bridge",   "rgba(120,100,80,0.40)"],
      ["east",     "rgba(110,110,90,0.25)"],
      ["west",     "rgba(140,130,90,0.20)"],
      ["city",     "rgba(80,90,120,0.45)"],
    ];
    for (const [name, color] of tints) {
      const b = BIOME_BOUNDS[name];
      ctx.fillStyle = color;
      ctx.fillRect(
        toMapX(b.x0),
        toMapZ(b.z0),
        (b.x1 - b.x0) * SCALE,
        (b.z1 - b.z0) * SCALE,
      );
    }

    // Central city road grid
    ctx.fillStyle = "#1d1d22";
    const roadW = 20 * SCALE;
    for (const x of ROADS.ns) {
      ctx.fillRect(toMapX(x) - roadW / 2, toMapZ(-100), roadW, 200 * SCALE);
    }
    for (const z of ROADS.ew) {
      ctx.fillRect(toMapX(-100), toMapZ(z) - roadW / 2, 200 * SCALE, roadW);
    }

    // Regional road polylines
    ctx.strokeStyle = "#2a2418";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const r of REGIONAL_ROADS) {
      ctx.lineWidth = Math.max(1.5, r.width * SCALE * 0.5);
      ctx.beginPath();
      const [x0, z0] = r.points[0];
      ctx.moveTo(toMapX(x0), toMapZ(z0));
      for (let i = 1; i < r.points.length; i++) {
        const [x, z] = r.points[i];
        ctx.lineTo(toMapX(x), toMapZ(z));
      }
      ctx.stroke();
    }

    // Checkpoints
    ctx.fillStyle = "#f39c12";
    for (const cp of CHECKPOINTS) {
      ctx.beginPath();
      ctx.arc(toMapX(cp.x), toMapZ(cp.z), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player dot (clamped so it stays on screen even at edges)
    const cx = Math.max(4, Math.min(W - 4, toMapX(px)));
    const cz = Math.max(4, Math.min(H - 4, toMapZ(pz)));
    ctx.fillStyle = "#00e5ff";
    ctx.beginPath();
    ctx.arc(cx, cz, 4, 0, Math.PI * 2);
    ctx.fill();
    // Halo
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cz, 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, W, H);
  }, [px, pz]);

  return (
    <canvas
      ref={canvasRef}
      width={150}
      height={150}
      style={{ display: "block" }}
    />
  );
}

export default function HUD({
  health,
  speed,
  inVehicle,
  showInteract,
  vehicleLabel,
  playerCount,
  username,
  raceActive,
  raceTime,
  racePassed,
  playerPositionX,
  playerPositionZ,
  connected,
}: HUDProps) {
  const healthPct = Math.max(0, Math.min(100, health));
  const healthColor =
    healthPct > 60 ? "#2ecc71" : healthPct > 30 ? "#f39c12" : "#e74c3c";
  const kph = Math.abs(speed * 3.6).toFixed(0);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        fontFamily: "'Courier New', monospace",
        color: "#fff",
        userSelect: "none",
      }}
    >
      {/* Health bar - bottom left */}
      <div style={{ position: "absolute", bottom: 24, left: 24 }}>
        <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>HEALTH</div>
        <div
          style={{
            width: 150,
            height: 12,
            background: "rgba(0,0,0,0.6)",
            border: "1px solid #444",
            borderRadius: 2,
          }}
        >
          <div
            style={{
              width: `${healthPct}%`,
              height: "100%",
              background: healthColor,
              transition: "width 0.2s, background 0.3s",
              borderRadius: 2,
            }}
          />
        </div>
        <div style={{ fontSize: 12, marginTop: 2, color: healthColor }}>
          {healthPct} / 100
        </div>
      </div>

      {/* Speedometer - bottom right */}
      {inVehicle && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            right: 24,
            textAlign: "center",
            background: "rgba(0,0,0,0.6)",
            border: "1px solid #444",
            padding: "8px 16px",
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#00e5ff" }}>
            {kph}
          </div>
          <div style={{ fontSize: 11, color: "#aaa" }}>KM/H</div>
        </div>
      )}

      {/* Minimap - top right */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          border: "1px solid #444",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <Minimap px={playerPositionX} pz={playerPositionZ} />
      </div>

      {/* Player info + count - top left */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          background: "rgba(0,0,0,0.6)",
          border: "1px solid #444",
          padding: "8px 12px",
          borderRadius: 4,
          fontSize: 13,
        }}
      >
        <div style={{ color: "#00e5ff", fontWeight: "bold" }}>{username}</div>
        <div style={{ color: "#aaa", marginTop: 2 }}>
          {connected ? "🟢" : "🔴"} {playerCount} player{playerCount !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Controls hint - top center */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.5)",
          border: "1px solid #333",
          padding: "4px 10px",
          borderRadius: 4,
          fontSize: 11,
          color: "#888",
          textAlign: "center",
        }}
      >
        {inVehicle
          ? "WASD — Drive  |  E — Exit  |  Click — Look"
          : "WASD — Move  |  Shift — Run  |  Space — Jump  |  E — Enter Car  |  Click — Look"}
      </div>

      {/* Interact prompt - center */}
      {showInteract && !inVehicle && (
        <div
          style={{
            position: "absolute",
            bottom: 120,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)",
            border: "1px solid #f39c12",
            padding: "8px 20px",
            borderRadius: 4,
            fontSize: 14,
            color: "#f39c12",
            textAlign: "center",
          }}
          data-testid="interact-prompt"
        >
          [E] Enter {vehicleLabel}
        </div>
      )}

      {/* Crosshair */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 20,
          height: 20,
          opacity: 0.5,
        }}
      >
        <div style={{ position: "absolute", top: 9, left: 0, right: 0, height: 2, background: "#fff" }} />
        <div style={{ position: "absolute", left: 9, top: 0, bottom: 0, width: 2, background: "#fff" }} />
      </div>

      {/* Race UI - center top area */}
      {(raceActive || racePassed.length > 0) && (
        <div
          style={{
            position: "absolute",
            top: 70,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)",
            border: "1px solid #f39c12",
            padding: "10px 20px",
            borderRadius: 4,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 11, color: "#f39c12", marginBottom: 4 }}>CHECKPOINT RACE</div>
          <div style={{ fontSize: 22, color: "#fff" }}>
            {raceActive ? formatTime(raceTime) : "FINISHED!"}
          </div>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
            {racePassed.length} / {CHECKPOINTS.length} checkpoints
          </div>
        </div>
      )}

      {/* Pointer lock hint */}
      <div
        style={{
          position: "absolute",
          bottom: "50%",
          left: "50%",
          transform: "translate(-50%, 50%)",
          fontSize: 13,
          color: "rgba(255,255,255,0.4)",
          pointerEvents: "none",
          textAlign: "center",
          display: "none",
        }}
        id="pointer-hint"
      >
        Click to capture mouse
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = Math.floor((ms % 1000) / 10);
  return `${m}:${String(sec).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}
