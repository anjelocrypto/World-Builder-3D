// =============================================================
// Synchronized day/night cycle — pure time math.
// -------------------------------------------------------------
// One in-game day = 2 real hours. All clients agree on the
// current world time via `setServerTimeOffset` (called once
// from useSocket when the initial `gameState` packet arrives,
// using the server-provided `serverNow`). Until that fires we
// fall back to local Date.now(), so a brand-new client still
// renders a sane sky during the connect handshake.
//
// This file is intentionally pure (no THREE.js, no React) so
// it can be unit-tested and reused server-side later. Visual
// mapping (sky color, light intensities, sun/moon mesh
// positions) lives in `game/DayNightController.tsx`.
// =============================================================

export const DAY_LENGTH_MS = 2 * 60 * 60 * 1000; // 2h real = 24h game

export type DayPhase = "DAWN" | "DAY" | "SUNSET" | "NIGHT";

let serverOffsetMs = 0;

/**
 * Capture the offset between the server's wall clock and the
 * local clock. Called from `useSocket` on the first `gameState`
 * payload (data.serverNow - Date.now()).
 */
export function setServerTimeOffset(offsetMs: number): void {
  serverOffsetMs = offsetMs;
}

export function getServerTimeOffset(): number {
  return serverOffsetMs;
}

/** ms since epoch in the *world's* clock (server-aligned). */
export function getWorldNow(): number {
  return Date.now() + serverOffsetMs;
}

export interface TimeOfDay {
  /** Server-aligned ms since epoch. */
  worldNow: number;
  /** 0..1 fractional progress through the 2-hour day. 0 = midnight. */
  dayProgress: number;
  /** Sun's orbital angle. 0 = sunrise (east), π/2 = noon, π = sunset. */
  sunAngle: number;
  /** sin(sunAngle). +1 overhead, 0 at horizon, -1 below. */
  sunY: number;
  /** Moon is always 12 game-hours offset from the sun. */
  moonAngle: number;
  moonY: number;
  /** Game-clock readout. */
  gameHour: number;   // 0..23
  gameMinute: number; // 0..59
  label: string;      // "HH:MM"
  phase: DayPhase;
  /**
   * 0..1 weights summing roughly to 1 across the cycle. Used as
   * blend weights for sky/light colors and as an opacity multiplier
   * for fake lamp pools.
   */
  dayFactor: number;
  nightFactor: number;
  dawnDuskFactor: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Pure function: compute the full time-of-day snapshot for the
 * given local clock reading. Caller MUST pass `Date.now()` (or
 * the equivalent) — we do *not* implicitly read the clock so
 * tests can drive deterministic times.
 */
export function computeTimeOfDay(nowMs: number): TimeOfDay {
  const worldNow = nowMs + serverOffsetMs;
  // Positive modulo so negative offsets (clock skew) still give 0..1.
  const dayProgress =
    (((worldNow % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS) /
    DAY_LENGTH_MS;

  // dayProgress: 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset.
  // sunAngle measured from sunrise so sin gives elevation.
  const sunAngle = (dayProgress - 0.25) * Math.PI * 2;
  const sunY = Math.sin(sunAngle);
  const moonAngle = sunAngle + Math.PI;
  const moonY = Math.sin(moonAngle);

  // Phase factors — clamped lerps of sun elevation. Slight floor so
  // ambient lighting never collapses to zero.
  const dayFactor = clamp01(sunY * 1.5 + 0.05);
  const nightFactor = clamp01(-sunY * 1.5 + 0.05);
  // Dawn/dusk peaks when the sun is right at the horizon. Width is
  // ~2 game hours either side of sunrise/sunset.
  const dawnDuskFactor = clamp01(1 - Math.abs(sunY) * 3.5);

  // Game clock
  const totalMin = dayProgress * 24 * 60;
  const gameHour = Math.floor(totalMin / 60) % 24;
  const gameMinute = Math.floor(totalMin % 60) % 60;
  const label = `${pad2(gameHour)}:${pad2(gameMinute)}`;

  let phase: DayPhase;
  if (gameHour >= 5 && gameHour < 7) phase = "DAWN";
  else if (gameHour >= 7 && gameHour < 17) phase = "DAY";
  else if (gameHour >= 17 && gameHour < 19) phase = "SUNSET";
  else phase = "NIGHT";

  return {
    worldNow,
    dayProgress,
    sunAngle,
    sunY,
    moonAngle,
    moonY,
    gameHour,
    gameMinute,
    label,
    phase,
    dayFactor,
    nightFactor,
    dawnDuskFactor,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// =============================================================
// Mutable runtime snapshot.
// -------------------------------------------------------------
// Updated once per frame by DayNightController. Read (no React
// re-render) by:
//   - DynamicPointLights (intensity *= nightFactor)
//   - Lamp head/pool materials (color/opacity *= nightFactor)
//   - HUD ticker (1 Hz polling → React state for the clock chip)
//   - The `dayNight OK: …` validator log emitted on first ready.
// =============================================================
export const dayNightRuntime = {
  /** Set true on the first useFrame after mount. */
  ready: false,
  worldNow: 0,
  dayProgress: 0,
  gameHour: 0,
  gameMinute: 0,
  label: "00:00",
  phase: "NIGHT" as DayPhase,
  sunY: 0,
  moonY: 0,
  dayFactor: 0,
  nightFactor: 1,
  dawnDuskFactor: 0,
};
