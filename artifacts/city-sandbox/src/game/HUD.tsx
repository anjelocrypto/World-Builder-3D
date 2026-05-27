import { useEffect, useRef, useState } from "react";
import {
  Wifi,
  WifiOff,
  Users,
  Heart,
  Gauge,
  Car,
  Flag,
  Compass,
} from "lucide-react";
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
  /** "HH:MM" world clock; DayNightController updates ~1 Hz. */
  clockLabel: string;
  /** "DAWN" | "DAY" | "SUNSET" | "NIGHT" — drives the chip color. */
  clockPhase: string;
  // ── RP wallet / license (Phase 1B) ─────────────────────────────────────
  /** Cash on hand (server-authoritative). Omitted until rp:profile arrives. */
  cash?: number;
  /** Bank balance (server-authoritative). */
  bank?: number;
  /** True once the player has passed the driver license test. */
  driverLicense?: boolean;
  /**
   * True when the walking player is within 6m of the Licensing Office entrance.
   * Shows an office-specific interact prompt distinct from the vehicle prompt.
   */
  nearOffice?: boolean;
  /**
   * Phase 3: True when walking player is within 8m of the Dealership entrance.
   */
  nearDealership?: boolean;
  /**
   * Phase 3: vehicleId of the nearest owned vehicle within 6m, or null.
   * Shows a lock/unlock prompt.
   */
  nearOwnedVehicleId?: string | null;
  /**
   * Phase 4: true when walking player is within depot radius.
   * Shows an E — Clock In/Out prompt.
   */
  nearDepot?: boolean;
  /**
   * Phase 5A: true when walking player is within Taxi Depot radius.
   * Shows an E — Clock In/Out · Taxi Driver prompt.
   */
  nearTaxiDepot?: boolean;
  /**
   * Phase 5B: true when walking player is within Delivery Hub radius.
   * Shows an E — Clock In/Out · Delivery Driver prompt.
   */
  nearDeliveryHub?: boolean;
  /**
   * Phase 5C: true when walking player is within Mechanic Garage radius.
   * Shows an E — Clock In/Out · Mechanic prompt.
   */
  nearMechanicGarage?: boolean;
  /**
   * Phase 5D: true when walking player is within Medical Center radius.
   * Shows an E — Clock In/Out · Paramedic prompt.
   */
  nearMedicCenter?: boolean;
  /**
   * Phase 5E: true when walking player is within Police Station radius.
   * Shows an E — Clock In/Out · Police Patrol prompt.
   */
  nearPoliceStation?: boolean;
  /**
   * Phase 5F: true when walking player is within ATM_INTERACT_RADIUS of any ATM.
   * Shows an E — Open ATM prompt.
   */
  nearATM?: boolean;
  /**
   * Phase 6A: current wanted stars count (0 = clean). Shown in wallet panel.
   */
  wantedStars?: number;
  /** Phase 6A: Unix ms when jail sentence expires; null = not jailed. */
  jailUntil?: number | null;
  /** Phase 6A: reason string shown in jail overlay. */
  jailReason?: string | null;
  /**
   * Phase 6A: true when this player is on duty as police_patrol.
   * Shows J / K action prompts.
   */
  isOfficerOnDuty?: boolean;
  /**
   * Phase 6A: true when a non-jailed player is within POLICE_WARRANT_RADIUS.
   * Shows J — Issue Warrant prompt.
   */
  nearPoliceTarget?: boolean;
  /**
   * Phase 6A: true when a wanted player is within POLICE_ARREST_RADIUS.
   * Shows K — Arrest prompt.
   */
  nearArrestTarget?: boolean;
}

// Phase accent colors. Used both by the clock chip and by the
// minimap frame so the whole HUD picks up subtle time-of-day cues.
const PHASE_COLOR: Record<string, string> = {
  DAWN: "#ff9c5a",
  DAY: "#ffd55c",
  SUNSET: "#ff7a4f",
  NIGHT: "#7d9cff",
};

// Single source of truth for the HUD accent palette so panels feel
// like they're part of the same chassis instead of a debug stack.
const ACCENT = "#00e5ff";
const PANEL_BG = "rgba(8, 14, 28, 0.72)";
const PANEL_BORDER = "rgba(0, 229, 255, 0.28)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 24px rgba(0,0,0,0.45), 0 0 1px rgba(0,229,255,0.25), inset 0 1px 0 rgba(255,255,255,0.04)";

const MINIMAP_PX = 200;

// ── Phase 6A: JailOverlay ────────────────────────────────────────────────────

/**
 * Full-screen dimmed overlay shown while the player is jailed.
 * Displays a countdown timer that ticks in real time.
 */
function JailOverlay({
  jailUntil,
  jailReason,
}: {
  jailUntil:  number;
  jailReason: string | null | undefined;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, jailUntil - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, jailUntil - Date.now()));
    }, 500);
    return () => clearInterval(id);
  }, [jailUntil]);

  const secs = Math.ceil(remaining / 1000);
  const mins  = Math.floor(secs / 60);
  const s     = secs % 60;
  const timeStr = `${mins}:${String(s).padStart(2, "0")}`;

  return (
    <div
      style={{
        position:        "fixed",
        inset:           0,
        background:      "rgba(0, 0, 0, 0.72)",
        zIndex:          2500,
        display:         "flex",
        flexDirection:   "column",
        alignItems:      "center",
        justifyContent:  "center",
        gap:             12,
        pointerEvents:   "none",
        fontFamily:      "monospace",
        userSelect:      "none",
      }}
    >
      <div style={{ fontSize: 48 }}>🚔</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#ff4444", letterSpacing: 2 }}>
        IN JAIL
      </div>
      <div style={{ fontSize: 40, fontWeight: 700, color: "#fff", letterSpacing: 4 }}>
        {timeStr}
      </div>
      {jailReason && (
        <div style={{ fontSize: 13, color: "#aaa", maxWidth: 320, textAlign: "center" }}>
          {jailReason}
        </div>
      )}
      <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>
        Serve your sentence and be released automatically
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function Minimap({
  px,
  pz,
  heading,
  phaseColor,
}: {
  px: number;
  pz: number;
  heading: number; // radians, 0 = looking +X (east) on the minimap
  phaseColor: string;
}) {
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
    ctx.fillStyle = "rgba(2, 6, 18, 0.92)";
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

    // Checkpoints — slightly larger now that the canvas is bigger
    ctx.fillStyle = "#f39c12";
    for (const cp of CHECKPOINTS) {
      ctx.beginPath();
      ctx.arc(toMapX(cp.x), toMapZ(cp.z), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player — directional arrow (rotated triangle) when we have a
    // recent heading, otherwise a centered dot. Halo always drawn
    // for visibility against busy biome tints.
    const cx = Math.max(8, Math.min(W - 8, toMapX(px)));
    const cz = Math.max(8, Math.min(H - 8, toMapZ(pz)));

    // Halo
    ctx.strokeStyle = "rgba(0,229,255,0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cz, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Arrow body
    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate(heading);
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, -7); // tip
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Phase-tinted inner border so the frame feels alive with the day cycle
    ctx.strokeStyle = phaseColor + "55";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }, [px, pz, heading, phaseColor]);

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_PX}
      height={MINIMAP_PX}
      style={{ display: "block" }}
    />
  );
}

function HealthBar({ health }: { health: number }) {
  const SEGMENTS = 10;
  const healthPct = Math.max(0, Math.min(100, health));
  const filledSegments = Math.round((healthPct / 100) * SEGMENTS);
  const color =
    healthPct > 50 ? "#2ee07a" : healthPct > 25 ? "#ffb547" : "#ff5560";
  const glow =
    healthPct > 50 ? "rgba(46,224,122,0.5)"
    : healthPct > 25 ? "rgba(255,181,71,0.55)"
    : "rgba(255,85,96,0.65)";

  return (
    <div
      style={{
        background: PANEL_BG,
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: PANEL_RADIUS,
        padding: "10px 14px 12px",
        boxShadow: PANEL_SHADOW,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        minWidth: 220,
      }}
      data-testid="hud-health"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 10,
          letterSpacing: 2,
          color: "#9bb",
          marginBottom: 6,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Heart size={12} color={color} fill={color} />
          HEALTH
        </span>
        <span style={{ color, fontWeight: "bold", letterSpacing: 1 }}>
          {healthPct}<span style={{ color: "#556", fontWeight: "normal" }}>/100</span>
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 3,
          height: 14,
        }}
      >
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const filled = i < filledSegments;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                background: filled ? color : "rgba(255,255,255,0.06)",
                boxShadow: filled ? `0 0 6px ${glow}` : "none",
                borderRadius: 2,
                transition: "background 0.2s, box-shadow 0.2s",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function Speedometer({ speed, vehicleLabel }: { speed: number; vehicleLabel: string }) {
  // Convert m/s → km/h. Speedometer caps at 240 km/h for the gauge ring.
  const kph = Math.abs(speed * 3.6);
  const MAX = 240;
  const pct = Math.max(0, Math.min(1, kph / MAX));

  // SVG ring math — 270° sweep starting at 135° (lower-left) and ending at 45° (lower-right)
  const SIZE = 130;
  const STROKE = 9;
  const r = (SIZE - STROKE) / 2;
  const c = SIZE / 2;
  const sweepRad = (270 * Math.PI) / 180;
  const startAngle = (135 * Math.PI) / 180;
  // Background arc
  const bgPath = describeArc(c, c, r, 135, 135 + 270);
  // Foreground arc length proportional to pct
  const fgPath = describeArc(c, c, r, 135, 135 + 270 * pct);

  const tickColor =
    kph < 60 ? "#2ee07a" : kph < 140 ? "#00e5ff" : kph < 200 ? "#ffb547" : "#ff5560";

  // Suppress unused warning while keeping the math available for future tuning
  void sweepRad;
  void startAngle;

  return (
    <div
      style={{
        background: PANEL_BG,
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: PANEL_RADIUS,
        padding: "12px 16px",
        boxShadow: PANEL_SHADOW,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        minWidth: SIZE + 32,
      }}
      data-testid="hud-speedometer"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          letterSpacing: 2,
          color: "#9bb",
          alignSelf: "stretch",
          justifyContent: "space-between",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Car size={12} color={ACCENT} />
          {vehicleLabel ? vehicleLabel.toUpperCase() : "VEHICLE"}
        </span>
        <Gauge size={12} color={tickColor} />
      </div>
      <div style={{ position: "relative", width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} style={{ display: "block" }}>
          <path d={bgPath} stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} fill="none" strokeLinecap="round" />
          <path
            d={fgPath}
            stroke={tickColor}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            style={{
              filter: `drop-shadow(0 0 6px ${tickColor})`,
              transition: "stroke 0.3s",
            }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 32,
              fontWeight: "bold",
              color: "#fff",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {kph.toFixed(0)}
          </div>
          <div style={{ fontSize: 10, color: "#9bb", letterSpacing: 2, marginTop: 2 }}>KM/H</div>
        </div>
      </div>
    </div>
  );
}

// Standard SVG arc-path builder (degrees, clockwise sweep)
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const start = polar(startDeg);
  const end = polar(endDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
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
  clockLabel,
  clockPhase,
  cash,
  bank,
  driverLicense,
  nearOffice,
  nearDealership,
  nearOwnedVehicleId,
  nearDepot,
  nearTaxiDepot,
  nearDeliveryHub,
  nearMechanicGarage,
  nearMedicCenter,
  nearPoliceStation,
  nearATM,
  wantedStars,
  jailUntil,
  jailReason,
  isOfficerOnDuty,
  nearPoliceTarget,
  nearArrestTarget,
}: HUDProps) {
  const phaseColor = PHASE_COLOR[clockPhase] ?? "#ffd55c";

  // Player heading for the minimap arrow. Derived from successive
  // position deltas in a ref so we don't store it in React state
  // (the parent already updates px/pz at HUD-throttle rate). Heading
  // sticks while the player is stationary so the arrow doesn't flick
  // back to north every time they stop moving.
  const lastPos = useRef({ x: playerPositionX, z: playerPositionZ });
  const headingRef = useRef(0);
  const dx = playerPositionX - lastPos.current.x;
  const dz = playerPositionZ - lastPos.current.z;
  const distSq = dx * dx + dz * dz;
  if (distSq > 0.04) {
    // atan2(dz, dx) gives an angle where 0 = +X axis on the minimap;
    // we render the triangle with its tip at -y, so subtract 90°.
    headingRef.current = Math.atan2(dz, dx) - Math.PI / 2;
    lastPos.current = { x: playerPositionX, z: playerPositionZ };
  }

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
      {/* ============================================================
          TOP-LEFT — player / connection / count / clock cluster
          ============================================================ */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minWidth: 220,
        }}
      >
        <div
          style={{
            background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: PANEL_RADIUS,
            padding: "10px 14px",
            boxShadow: PANEL_SHADOW,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
          data-testid="hud-player"
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: "bold",
              color: ACCENT,
              letterSpacing: 1.5,
              textShadow: "0 0 12px rgba(0,229,255,0.45)",
              lineHeight: 1.1,
              marginBottom: 6,
            }}
          >
            {username}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 11,
              color: "#9bb",
            }}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              data-testid="hud-connection"
            >
              {connected ? (
                <>
                  <Wifi size={12} color="#2ee07a" />
                  <span style={{ color: "#2ee07a" }}>ONLINE</span>
                </>
              ) : (
                <>
                  <WifiOff size={12} color="#ff5560" />
                  <span style={{ color: "#ff5560" }}>OFFLINE</span>
                </>
              )}
            </span>
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              data-testid="hud-player-count"
            >
              <Users size={12} color={ACCENT} />
              <span style={{ color: "#cde" }}>{playerCount}</span>
            </span>
          </div>
        </div>

        {/* Clock — same chassis, accented by phase color */}
        <div
          style={{
            background: PANEL_BG,
            border: `1px solid ${phaseColor}55`,
            borderRadius: PANEL_RADIUS,
            padding: "8px 12px",
            boxShadow: PANEL_SHADOW,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
          data-testid="hud-clock"
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: phaseColor,
              boxShadow: `0 0 10px ${phaseColor}`,
              flexShrink: 0,
            }}
          />
          <div
            style={{
              fontSize: 15,
              fontWeight: "bold",
              color: "#fff",
              letterSpacing: 2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {clockLabel}
          </div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: phaseColor,
              letterSpacing: 2,
              fontWeight: "bold",
            }}
          >
            {clockPhase}
          </div>
        </div>
      </div>

      {/* ============================================================
          TOP-RIGHT — minimap with phase-tinted frame + compass labels
          ============================================================ */}
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          background: PANEL_BG,
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: PANEL_RADIUS,
          padding: 8,
          boxShadow: `${PANEL_SHADOW}, 0 0 24px ${phaseColor}22`,
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
        data-testid="hud-minimap"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 10,
            color: "#9bb",
            letterSpacing: 2,
            padding: "0 4px 6px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Compass size={12} color={ACCENT} />
            MAP
          </span>
          <span style={{ color: "#556", fontVariantNumeric: "tabular-nums" }}>
            {Math.round(playerPositionX)}, {Math.round(playerPositionZ)}
          </span>
        </div>
        <div
          style={{
            position: "relative",
            width: MINIMAP_PX,
            height: MINIMAP_PX,
            borderRadius: 6,
            overflow: "hidden",
            border: `1px solid ${phaseColor}44`,
          }}
        >
          <Minimap
            px={playerPositionX}
            pz={playerPositionZ}
            heading={headingRef.current}
            phaseColor={phaseColor}
          />
          {/* Compass labels — N/E/S/W around the minimap edge */}
          {compassLabels.map(({ label, style }) => (
            <div
              key={label}
              style={{
                position: "absolute",
                fontSize: 9,
                fontWeight: "bold",
                color: "#cde",
                letterSpacing: 1,
                textShadow: "0 0 4px rgba(0,0,0,0.9)",
                pointerEvents: "none",
                ...style,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* ============================================================
          BOTTOM-LEFT — health
          ============================================================ */}
      <div style={{ position: "absolute", bottom: 22, left: 22 }}>
        <HealthBar health={health} />
      </div>

      {/* ============================================================
          BOTTOM-RIGHT — speedometer (vehicle only)
          ============================================================ */}
      {inVehicle && (
        <div style={{ position: "absolute", bottom: 22, right: 22 }}>
          <Speedometer speed={speed} vehicleLabel={vehicleLabel} />
        </div>
      )}

      {/* ============================================================
          TOP-CENTER — subtle controls hint
          ============================================================ */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(8,14,28,0.45)",
          border: "1px solid rgba(255,255,255,0.06)",
          padding: "5px 12px",
          borderRadius: 999,
          fontSize: 10,
          color: "rgba(255,255,255,0.55)",
          letterSpacing: 1.5,
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          whiteSpace: "nowrap",
        }}
      >
        {inVehicle
          ? "WASD DRIVE  ·  E EXIT  ·  CLICK LOOK"
          : "WASD MOVE  ·  SHIFT RUN  ·  SPACE JUMP  ·  E ENTER  ·  CLICK LOOK"}
      </div>

      {/* ============================================================
          RACE — top-center under the controls hint
          ============================================================ */}
      {(raceActive || racePassed.length > 0) && (
        <div
          style={{
            position: "absolute",
            top: 64,
            left: "50%",
            transform: "translateX(-50%)",
            background: PANEL_BG,
            border: "1px solid rgba(243, 156, 18, 0.55)",
            borderRadius: PANEL_RADIUS,
            padding: "10px 22px",
            textAlign: "center",
            boxShadow: PANEL_SHADOW,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            minWidth: 180,
          }}
          data-testid="hud-race"
        >
          <div
            style={{
              fontSize: 10,
              color: "#f39c12",
              letterSpacing: 3,
              marginBottom: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Flag size={11} color="#f39c12" />
            CHECKPOINT RACE
          </div>
          <div
            style={{
              fontSize: 24,
              color: "#fff",
              fontWeight: "bold",
              letterSpacing: 2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {raceActive ? formatTime(raceTime) : "FINISHED"}
          </div>
          <div style={{ fontSize: 11, color: "#9bb", marginTop: 2, letterSpacing: 1 }}>
            {racePassed.length} / {CHECKPOINTS.length} CHECKPOINTS
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — interaction prompt (E key card)
          ============================================================ */}
      {showInteract && !inVehicle && (
        <div
          style={{
            position: "absolute",
            bottom: 130,
            left: "50%",
            transform: "translateX(-50%)",
            background: PANEL_BG,
            border: "1px solid rgba(243, 156, 18, 0.65)",
            borderRadius: PANEL_RADIUS,
            padding: "8px 14px 8px 8px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: `${PANEL_SHADOW}, 0 0 24px rgba(243,156,18,0.25)`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
          data-testid="interact-prompt"
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(243, 156, 18, 0.15)",
              border: "1px solid rgba(243, 156, 18, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: "bold",
              color: "#f39c12",
              boxShadow: "inset 0 -2px 0 rgba(243,156,18,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            Enter <span style={{ color: "#f39c12", fontWeight: "bold" }}>{vehicleLabel}</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Licensing Office interact prompt (Phase 2)
          Shown when nearOffice && no vehicle is close enough to enter.
          ============================================================ */}
      {nearOffice && !inVehicle && !showInteract && (
        <div
          style={{
            position: "absolute",
            bottom: 130,
            left: "50%",
            transform: "translateX(-50%)",
            background: PANEL_BG,
            border: "1px solid rgba(255, 170, 0, 0.65)",
            borderRadius: PANEL_RADIUS,
            padding: "8px 14px 8px 8px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: `${PANEL_SHADOW}, 0 0 24px rgba(255,170,0,0.25)`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
          data-testid="interact-office-prompt"
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(255, 170, 0, 0.15)",
              border: "1px solid rgba(255, 170, 0, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: "bold",
              color: "#ffaa00",
              boxShadow: "inset 0 -2px 0 rgba(255,170,0,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            Apply for{" "}
            <span style={{ color: "#ffaa00", fontWeight: "bold" }}>
              Driver License
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· $200</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Dealership interact prompt (Phase 3)
          ============================================================ */}
      {nearDealership && !inVehicle && !showInteract && !nearOffice && (
        <div
          style={{
            position: "absolute",
            bottom: 130,
            left: "50%",
            transform: "translateX(-50%)",
            background: PANEL_BG,
            border: "1px solid rgba(102, 204, 34, 0.65)",
            borderRadius: PANEL_RADIUS,
            padding: "8px 14px 8px 8px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: `${PANEL_SHADOW}, 0 0 24px rgba(102,204,34,0.2)`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(102, 204, 34, 0.15)",
              border: "1px solid rgba(102, 204, 34, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: "bold",
              color: "#66cc22",
              boxShadow: "inset 0 -2px 0 rgba(102,204,34,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            Browse{" "}
            <span style={{ color: "#66cc22", fontWeight: "bold" }}>
              Dealership
            </span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — City Worker Depot clock-in/out prompt (Phase 4)
          ============================================================ */}
      {nearDepot && !inVehicle && !showInteract && !nearOffice && !nearDealership && (
        <div
          style={{
            position: "absolute",
            bottom: 130,
            left: "50%",
            transform: "translateX(-50%)",
            background: PANEL_BG,
            border: "1px solid rgba(255, 120, 0, 0.65)",
            borderRadius: PANEL_RADIUS,
            padding: "8px 14px 8px 8px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: `${PANEL_SHADOW}, 0 0 24px rgba(255,120,0,0.22)`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(255, 120, 0, 0.15)",
              border: "1px solid rgba(255, 120, 0, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: "bold",
              color: "#ff7800",
              boxShadow: "inset 0 -2px 0 rgba(255,120,0,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            🏗{" "}
            <span style={{ color: "#ff7800", fontWeight: "bold" }}>
              Clock In / Out
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· City Worker</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Taxi Depot clock-in/out prompt (Phase 5A)
          ============================================================ */}
      {nearTaxiDepot && !inVehicle && !showInteract && !nearOffice && !nearDealership && !nearDepot && (
        <div
          style={{
            position: "absolute",
            bottom: 130,
            left: "50%",
            transform: "translateX(-50%)",
            background: PANEL_BG,
            border: "1px solid rgba(245, 197, 24, 0.65)",
            borderRadius: PANEL_RADIUS,
            padding: "8px 14px 8px 8px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: `${PANEL_SHADOW}, 0 0 24px rgba(245,197,24,0.22)`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(245, 197, 24, 0.15)",
              border: "1px solid rgba(245, 197, 24, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: "bold",
              color: "#f5c518",
              boxShadow: "inset 0 -2px 0 rgba(245,197,24,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            🚕{" "}
            <span style={{ color: "#f5c518", fontWeight: "bold" }}>
              Clock In / Out
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· Taxi Driver</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Delivery Hub clock-in/out prompt (Phase 5B)
          ============================================================ */}
      {nearDeliveryHub && !inVehicle && !showInteract && !nearOffice && !nearDealership && !nearDepot && !nearTaxiDepot && (
        <div
          style={{
            position:             "absolute",
            bottom:               130,
            left:                 "50%",
            transform:            "translateX(-50%)",
            background:           PANEL_BG,
            border:               "1px solid rgba(200, 136, 74, 0.65)",
            borderRadius:         PANEL_RADIUS,
            padding:              "8px 14px 8px 8px",
            display:              "flex",
            alignItems:           "center",
            gap:                  12,
            boxShadow:            `${PANEL_SHADOW}, 0 0 24px rgba(200,136,74,0.22)`,
            backdropFilter:       "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width:        28,
              height:       28,
              borderRadius: 6,
              background:   "rgba(200, 136, 74, 0.15)",
              border:       "1px solid rgba(200, 136, 74, 0.7)",
              display:      "flex",
              alignItems:   "center",
              justifyContent: "center",
              fontSize:     13,
              fontWeight:   "bold",
              color:        "#c8884a",
              boxShadow:    "inset 0 -2px 0 rgba(200,136,74,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            📦{" "}
            <span style={{ color: "#c8884a", fontWeight: "bold" }}>
              Clock In / Out
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· Delivery Driver</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Mechanic Garage clock-in/out prompt (Phase 5C)
          ============================================================ */}
      {nearMechanicGarage && !inVehicle && !showInteract && !nearOffice && !nearDealership && !nearDepot && !nearTaxiDepot && !nearDeliveryHub && (
        <div
          style={{
            position:             "absolute",
            bottom:               130,
            left:                 "50%",
            transform:            "translateX(-50%)",
            background:           PANEL_BG,
            border:               "1px solid rgba(136, 153, 187, 0.65)",
            borderRadius:         PANEL_RADIUS,
            padding:              "8px 14px 8px 8px",
            display:              "flex",
            alignItems:           "center",
            gap:                  12,
            boxShadow:            `${PANEL_SHADOW}, 0 0 24px rgba(136,153,187,0.22)`,
            backdropFilter:       "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width:          28,
              height:         28,
              borderRadius:   6,
              background:     "rgba(136, 153, 187, 0.15)",
              border:         "1px solid rgba(136, 153, 187, 0.7)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       13,
              fontWeight:     "bold",
              color:          "#8899bb",
              boxShadow:      "inset 0 -2px 0 rgba(136,153,187,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            🔧{" "}
            <span style={{ color: "#8899bb", fontWeight: "bold" }}>
              Clock In / Out
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· Mechanic</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Medical Center clock-in/out prompt (Phase 5D)
          ============================================================ */}
      {nearMedicCenter && !inVehicle && !showInteract && !nearOffice && !nearDealership && !nearDepot && !nearTaxiDepot && !nearDeliveryHub && !nearMechanicGarage && (
        <div
          style={{
            position:             "absolute",
            bottom:               130,
            left:                 "50%",
            transform:            "translateX(-50%)",
            background:           PANEL_BG,
            border:               "1px solid rgba(220, 50, 50, 0.65)",
            borderRadius:         PANEL_RADIUS,
            padding:              "8px 14px 8px 8px",
            display:              "flex",
            alignItems:           "center",
            gap:                  12,
            boxShadow:            `${PANEL_SHADOW}, 0 0 24px rgba(220,50,50,0.22)`,
            backdropFilter:       "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width:          28,
              height:         28,
              borderRadius:   6,
              background:     "rgba(220, 50, 50, 0.15)",
              border:         "1px solid rgba(220, 50, 50, 0.7)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       13,
              fontWeight:     "bold",
              color:          "#dc3232",
              boxShadow:      "inset 0 -2px 0 rgba(220,50,50,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            🚑{" "}
            <span style={{ color: "#dc3232", fontWeight: "bold" }}>
              Clock In / Out
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· Paramedic</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Police Station clock-in/out prompt (Phase 5E)
          ============================================================ */}
      {nearPoliceStation && !inVehicle && !showInteract && !nearOffice && !nearDealership && !nearDepot && !nearTaxiDepot && !nearDeliveryHub && !nearMechanicGarage && !nearMedicCenter && (
        <div
          style={{
            position:             "absolute",
            bottom:               130,
            left:                 "50%",
            transform:            "translateX(-50%)",
            background:           PANEL_BG,
            border:               "1px solid rgba(34, 85, 204, 0.65)",
            borderRadius:         PANEL_RADIUS,
            padding:              "8px 14px 8px 8px",
            display:              "flex",
            alignItems:           "center",
            gap:                  12,
            boxShadow:            `${PANEL_SHADOW}, 0 0 24px rgba(34,85,204,0.22)`,
            backdropFilter:       "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width:          28,
              height:         28,
              borderRadius:   6,
              background:     "rgba(34, 85, 204, 0.15)",
              border:         "1px solid rgba(34, 85, 204, 0.7)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       13,
              fontWeight:     "bold",
              color:          "#2255cc",
              boxShadow:      "inset 0 -2px 0 rgba(34,85,204,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            🚔{" "}
            <span style={{ color: "#4488ff", fontWeight: "bold" }}>
              Clock In / Out
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· Police Patrol</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — ATM open prompt (Phase 5F)
          ============================================================ */}
      {nearATM && !inVehicle && !showInteract && !nearOffice && !nearDealership && !nearDepot && !nearTaxiDepot && !nearDeliveryHub && !nearMechanicGarage && !nearMedicCenter && !nearPoliceStation && (
        <div
          style={{
            position:             "absolute",
            bottom:               130,
            left:                 "50%",
            transform:            "translateX(-50%)",
            background:           PANEL_BG,
            border:               "1px solid rgba(0, 204, 136, 0.65)",
            borderRadius:         PANEL_RADIUS,
            padding:              "8px 14px 8px 8px",
            display:              "flex",
            alignItems:           "center",
            gap:                  12,
            boxShadow:            `${PANEL_SHADOW}, 0 0 24px rgba(0,204,136,0.22)`,
            backdropFilter:       "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width:          28,
              height:         28,
              borderRadius:   6,
              background:     "rgba(0, 204, 136, 0.15)",
              border:         "1px solid rgba(0, 204, 136, 0.7)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       13,
              fontWeight:     "bold",
              color:          "#00cc88",
              boxShadow:      "inset 0 -2px 0 rgba(0,204,136,0.35)",
            }}
          >
            E
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            ${"  "}
            <span style={{ color: "#00ff99", fontWeight: "bold" }}>
              Open ATM
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· Bank / Withdraw</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Lock/Unlock owned vehicle prompt (Phase 3)
          ============================================================ */}
      {nearOwnedVehicleId && !inVehicle && !showInteract && (
        <div
          style={{
            position: "absolute",
            bottom: 160,
            left: "50%",
            transform: "translateX(-50%)",
            background: PANEL_BG,
            border: "1px solid rgba(100, 181, 246, 0.65)",
            borderRadius: PANEL_RADIUS,
            padding: "8px 14px 8px 8px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: `${PANEL_SHADOW}, 0 0 18px rgba(100,181,246,0.2)`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(100, 181, 246, 0.15)",
              border: "1px solid rgba(100, 181, 246, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: "bold",
              color: "#64b5f6",
              boxShadow: "inset 0 -2px 0 rgba(100,181,246,0.35)",
            }}
          >
            L
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            🔑{" "}
            <span style={{ color: "#64b5f6", fontWeight: "bold" }}>
              Lock / Unlock
            </span>{" "}
            your vehicle
          </div>
        </div>
      )}

      {/* ============================================================
          CENTER — crosshair (subtle)
          ============================================================ */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 14,
          height: 14,
          opacity: 0.4,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 0,
            right: 0,
            height: 1,
            background: ACCENT,
            boxShadow: `0 0 4px ${ACCENT}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 6,
            top: 0,
            bottom: 0,
            width: 1,
            background: ACCENT,
            boxShadow: `0 0 4px ${ACCENT}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 5,
            left: 5,
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: ACCENT,
            boxShadow: `0 0 6px ${ACCENT}`,
          }}
        />
      </div>

      {/* Pointer lock hint (kept hidden by default, toggled by external code) */}
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

      {/* ============================================================
          BOTTOM-RIGHT — RP wallet panel (Phase 1B)
          Only rendered once rp:profile has been received (cash != null).
          ============================================================ */}
      {cash != null && (
        <div
          style={{
            position:       "absolute",
            bottom:         88,
            right:          16,
            display:        "flex",
            flexDirection:  "column",
            alignItems:     "flex-end",
            gap:            4,
            fontFamily:     "'Courier New', Courier, monospace",
            userSelect:     "none",
            pointerEvents:  "none",
          }}
        >
          {/* Cash on hand */}
          <div
            style={{
              background:   PANEL_BG,
              border:       "1px solid rgba(76, 255, 122, 0.35)",
              borderRadius: PANEL_RADIUS,
              padding:      "4px 10px",
              fontSize:     14,
              color:        "#4cff7a",
              textShadow:   "0 0 8px rgba(76,255,122,0.5)",
              letterSpacing: 0.5,
            }}
          >
            💵 ${(cash).toLocaleString()}
          </div>

          {/* Bank balance */}
          {bank != null && (
            <div
              style={{
                background:   PANEL_BG,
                border:       "1px solid rgba(100, 180, 255, 0.35)",
                borderRadius: PANEL_RADIUS,
                padding:      "4px 10px",
                fontSize:     14,
                color:        "#88ccff",
                textShadow:   "0 0 8px rgba(100,180,255,0.4)",
                letterSpacing: 0.5,
              }}
            >
              🏦 ${(bank).toLocaleString()}
            </div>
          )}

          {/* Wanted stars badge (Phase 6A) */}
          {wantedStars != null && wantedStars > 0 && (
            <div
              style={{
                background:    "rgba(8, 14, 28, 0.82)",
                border:        "1px solid rgba(255, 68, 68, 0.65)",
                borderRadius:  PANEL_RADIUS,
                padding:       "3px 10px",
                fontSize:      14,
                color:         "#ff4444",
                letterSpacing: 1,
                textShadow:    "0 0 8px rgba(255,68,68,0.6)",
              }}
            >
              {"⭐".repeat(wantedStars)}{" "}
              <span style={{ fontSize: 11 }}>WANTED</span>
            </div>
          )}

          {/* Driver license badge */}
          <div
            style={{
              background:    PANEL_BG,
              border:        driverLicense
                ? "1px solid rgba(170, 255, 136, 0.4)"
                : "1px solid rgba(255, 136, 68, 0.4)",
              borderRadius:  PANEL_RADIUS,
              padding:       "3px 10px",
              fontSize:      12,
              color:         driverLicense ? "#aaffaa" : "#ff8844",
              letterSpacing: 0.5,
            }}
          >
            {driverLicense ? "🪪 Licensed" : "🚫 No License"}
          </div>
        </div>
      )}

      {/* ============================================================
          FULL-SCREEN — Jail overlay (Phase 6A)
          Renders on top of everything except modals (z-index 2500).
          ============================================================ */}
      {jailUntil != null && jailUntil > Date.now() && (
        <JailOverlay jailUntil={jailUntil} jailReason={jailReason} />
      )}

      {/* ============================================================
          BOTTOM-CENTER — Officer: Issue Warrant prompt (Phase 6A)
          J key — shown when officer is on duty + non-jailed player nearby
          ============================================================ */}
      {isOfficerOnDuty && nearPoliceTarget && !inVehicle && (
        <div
          style={{
            position:             "absolute",
            bottom:               160,
            left:                 "50%",
            transform:            "translateX(-50%)",
            background:           PANEL_BG,
            border:               "1px solid rgba(255, 200, 50, 0.65)",
            borderRadius:         PANEL_RADIUS,
            padding:              "8px 14px 8px 8px",
            display:              "flex",
            alignItems:           "center",
            gap:                  12,
            boxShadow:            `${PANEL_SHADOW}, 0 0 18px rgba(255,200,50,0.18)`,
            backdropFilter:       "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width:          28,
              height:         28,
              borderRadius:   6,
              background:     "rgba(255, 200, 50, 0.15)",
              border:         "1px solid rgba(255, 200, 50, 0.7)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       13,
              fontWeight:     "bold",
              color:          "#ffc832",
              boxShadow:      "inset 0 -2px 0 rgba(255,200,50,0.35)",
            }}
          >
            J
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            ⭐{" "}
            <span style={{ color: "#ffc832", fontWeight: "bold" }}>
              Issue Warrant
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· 1★ default</span>
          </div>
        </div>
      )}

      {/* ============================================================
          BOTTOM-CENTER — Officer: Arrest prompt (Phase 6A)
          K key — shown when officer is on duty + wanted player in range
          ============================================================ */}
      {isOfficerOnDuty && nearArrestTarget && !inVehicle && (
        <div
          style={{
            position:             "absolute",
            bottom:               200,
            left:                 "50%",
            transform:            "translateX(-50%)",
            background:           PANEL_BG,
            border:               "1px solid rgba(255, 68, 68, 0.65)",
            borderRadius:         PANEL_RADIUS,
            padding:              "8px 14px 8px 8px",
            display:              "flex",
            alignItems:           "center",
            gap:                  12,
            boxShadow:            `${PANEL_SHADOW}, 0 0 18px rgba(255,68,68,0.2)`,
            backdropFilter:       "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              width:          28,
              height:         28,
              borderRadius:   6,
              background:     "rgba(255, 68, 68, 0.15)",
              border:         "1px solid rgba(255, 68, 68, 0.7)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       13,
              fontWeight:     "bold",
              color:          "#ff4444",
              boxShadow:      "inset 0 -2px 0 rgba(255,68,68,0.35)",
            }}
          >
            K
          </div>
          <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>
            🚔{" "}
            <span style={{ color: "#ff4444", fontWeight: "bold" }}>
              Arrest
            </span>{" "}
            <span style={{ color: "#9bb", fontSize: 11 }}>· Wanted suspect nearby</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Compass label positions placed around the minimap's inner border.
// Defined as a module-level constant so the HUD doesn't reallocate
// the array on every render.
const compassLabels: Array<{ label: string; style: React.CSSProperties }> = [
  { label: "N", style: { top: 4, left: "50%", transform: "translateX(-50%)" } },
  { label: "S", style: { bottom: 4, left: "50%", transform: "translateX(-50%)" } },
  { label: "W", style: { left: 4, top: "50%", transform: "translateY(-50%)" } },
  { label: "E", style: { right: 4, top: "50%", transform: "translateY(-50%)" } },
];

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = Math.floor((ms % 1000) / 10);
  return `${m}:${String(sec).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}
