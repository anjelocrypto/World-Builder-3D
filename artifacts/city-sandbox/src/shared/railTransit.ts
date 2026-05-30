/**
 * Phase 15A — shared rail-transit layer (single source of truth).
 *
 * Loop GEOMETRY (ELEVATED_RAIL_LOOP, railLoopArcLengths, railLoopPointAt) stays
 * in cityData. This module owns the TRANSIT layer used by CentralRail.tsx,
 * LocalPlayer.tsx, collision.ts and the validator:
 *   - train constants + multi-station stop schedule + timing,
 *   - walkable station platform + escalator-ramp surfaces (player ground height),
 *   - station guard-rail collider boxes (height-gated so ground walking is free),
 *   - boarding/door geometry (used by the ride state in a later sub-phase).
 *
 * 15A-1 scope: data + walkable surfaces + colliders + validator. The board/ride/
 * exit state machine and train-camera live in 15A-2 and consume these helpers.
 */

import type { TrainStationData } from "./types";
import {
  RAIL_DECK_HEIGHT,
  ELEVATED_RAIL_LOOP,
  TRAIN_STATIONS,
  railLoopArcLengths,
  railLoopPointAt,
} from "./cityData";

// ── Train constants ─────────────────────────────────────────────────────────
export const TRAIN = {
  speed: 14,      // m/s along the loop
  dwell: 3.0,     // seconds paused at each station
  carLen: 11.5,
  carWidth: 2.2,
  carHeight: 2.6,
  carGap: 0.8,
  cars: 3,
} as const;

// ── Station / escalator geometry constants ──────────────────────────────────
/** Walkable platform top height (deck slab + platform slab). */
export const PLATFORM_TOP_Y = RAIL_DECK_HEIGHT + 0.6;
/** Horizontal run of each escalator ramp (gives a ~32° walkable grade for 12.6 m). */
export const ESC_RUN = 20;
/** Half-width of the escalator ramp band along the platform's long axis (Z). */
export const ESC_HALF_BAND = 2.7;
/** Height above the player's feet at which station guard-rails engage (ground walking stays free). */
export const STATION_RAIL_FEET_GATE = 1.5;

// ── Arc-length helpers (multi-station) ──────────────────────────────────────
/** Cumulative loop arc length nearest to (x,z) — assumes the point lies on an edge. */
export function arcAtPoint(x: number, z: number): number {
  const { arcAt } = railLoopArcLengths();
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ELEVATED_RAIL_LOOP.length - 1; i++) {
    const a = ELEVATED_RAIL_LOOP[i];
    const b = ELEVATED_RAIL_LOOP[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segLen2 = dx * dx + dz * dz;
    const t = segLen2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / segLen2)) : 0;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bestD) { bestD = d; best = arcAt[i] + Math.hypot(px - a.x, pz - a.z); }
  }
  return best;
}

/** Arc length of each station, in TRAIN_STATIONS order. */
export function stationArcs(): number[] {
  return TRAIN_STATIONS.map((s) => arcAtPoint(s.cx, s.cz));
}

// ── Train timing (stops + dwell at every station) ───────────────────────────
/** Deterministic train head arc length at wall-clock seconds `tSec`. */
export function trainHeadArcAtTime(tSec: number): number {
  const { total } = railLoopArcLengths();
  const stops = stationArcs().slice().sort((a, b) => a - b);
  const lapTime = total / TRAIN.speed + stops.length * TRAIN.dwell;
  let tt = ((tSec % lapTime) + lapTime) % lapTime;
  let arc = 0;
  let time = 0;
  for (const stop of stops) {
    const moveTime = (stop - arc) / TRAIN.speed;
    if (tt < time + moveTime) return arc + (tt - time) * TRAIN.speed;
    time += moveTime;
    arc = stop;
    if (tt < time + TRAIN.dwell) return arc; // dwelling at this station
    time += TRAIN.dwell;
  }
  return arc + (tt - time) * TRAIN.speed; // final leg back toward arc=total (wraps to 0)
}

/** Index into TRAIN_STATIONS of the station currently dwelling, or null if moving. */
export function trainStoppedStationIndex(tSec: number): number | null {
  const { total } = railLoopArcLengths();
  const arcs = stationArcs();
  const order = arcs.map((a, i) => ({ a, i })).sort((p, q) => p.a - q.a);
  const lapTime = total / TRAIN.speed + arcs.length * TRAIN.dwell;
  const tt = ((tSec % lapTime) + lapTime) % lapTime;
  let arc = 0;
  let time = 0;
  for (const { a, i } of order) {
    time += (a - arc) / TRAIN.speed;
    arc = a;
    if (tt >= time && tt < time + TRAIN.dwell) return i;
    time += TRAIN.dwell;
  }
  return null;
}

/** Arc length of each train car at time `tSec` (head first, trailing cars behind). */
export function trainCarArcs(tSec: number): number[] {
  const head = trainHeadArcAtTime(tSec);
  const out: number[] = [];
  for (let i = 0; i < TRAIN.cars; i++) out.push(head - i * (TRAIN.carLen + TRAIN.carGap));
  return out;
}

// ── Station + escalator surfaces ────────────────────────────────────────────
export interface StationGeom {
  station: TrainStationData;
  /** Outward sign in X (+1 east, −1 west): the side the escalator descends toward. */
  out: number;
  /** Platform outer edge X (top of the escalator). */
  edgeX: number;
  /** Escalator ground-foot X. */
  footX: number;
}

export function stationGeoms(): StationGeom[] {
  return TRAIN_STATIONS.map((s) => {
    const out = Math.sign(s.stairX - s.cx) || 1;
    return { station: s, out, edgeX: s.cx + out * (s.w / 2), footX: s.cx + out * (s.w / 2 + ESC_RUN) };
  });
}

/**
 * Player-walkable rail surface height at (x,z): the platform deck when standing
 * on a platform, the linearly-interpolated ramp height when on an escalator, or
 * null when not on any station structure. LocalPlayer uses max(terrain, this).
 */
export function railSurfaceY(x: number, z: number): number | null {
  for (const g of stationGeoms()) {
    const s = g.station;
    if (Math.abs(x - s.cx) <= s.w / 2 && Math.abs(z - s.cz) <= s.d / 2) {
      return PLATFORM_TOP_Y; // on the platform deck
    }
    if (Math.abs(z - s.cz) <= ESC_HALF_BAND) {
      const d = g.out * (x - g.edgeX); // 0 at the platform edge, +ESC_RUN at the foot
      if (d >= 0 && d <= ESC_RUN) return PLATFORM_TOP_Y * (1 - d / ESC_RUN);
    }
  }
  return null;
}

/**
 * Guard-rail collider boxes (XZ AABBs): platform perimeter (minus the escalator
 * opening + the rail-side boarding edge handled in 15A-2) and the escalator side
 * rails. Collision.ts iterates these gated by STATION_RAIL_FEET_GATE so they only
 * block once the player is elevated on the structure — ground walking is free.
 */
export function stationRailBoxes(): { x: number; z: number; w: number; d: number }[] {
  const t = 0.16;
  const boxes: { x: number; z: number; w: number; d: number }[] = [];
  for (const g of stationGeoms()) {
    const s = g.station;
    const hw = s.w / 2;
    const hd = s.d / 2;
    // Platform short ends (full width).
    boxes.push({ x: s.cx, z: s.cz - hd, w: s.w, d: t });
    boxes.push({ x: s.cx, z: s.cz + hd, w: s.w, d: t });
    // Inner (rail-side) long edge — a guard for 15A-1; boarding opens it in 15A-2.
    boxes.push({ x: s.cx - g.out * hw, z: s.cz, w: t, d: s.d });
    // Outer long edge segments either side of the escalator opening.
    const segLen = hd - ESC_HALF_BAND;
    if (segLen > 0.05) {
      boxes.push({ x: g.edgeX, z: s.cz - (ESC_HALF_BAND + segLen / 2), w: t, d: segLen });
      boxes.push({ x: g.edgeX, z: s.cz + (ESC_HALF_BAND + segLen / 2), w: t, d: segLen });
    }
    // Escalator side rails (both long sides of the ramp band), edge → foot.
    const midX = (g.edgeX + g.footX) / 2;
    boxes.push({ x: midX, z: s.cz - ESC_HALF_BAND, w: ESC_RUN, d: t });
    boxes.push({ x: midX, z: s.cz + ESC_HALF_BAND, w: ESC_RUN, d: t });
  }
  return boxes;
}

/** Platform-centre boarding/exit point for a station (used by the ride state in 15A-2). */
export function stationBoardPoint(stationIndex: number): { x: number; y: number; z: number } | null {
  const s = TRAIN_STATIONS[stationIndex];
  if (!s) return null;
  const g = stationGeoms()[stationIndex];
  // Stand a little in from the rail-side edge so exit never drops a player off it.
  const x = s.cx - g.out * (s.w / 2 - 1.5);
  return { x, y: PLATFORM_TOP_Y, z: s.cz };
}

/** World position + heading of the train car at arc length `s`. */
export function trainCarPose(s: number): { x: number; y: number; z: number; rotY: number } {
  const { total } = railLoopArcLengths();
  const p = railLoopPointAt(((s % total) + total) % total);
  return { x: p.x, y: RAIL_DECK_HEIGHT + 0.2 + TRAIN.carHeight / 2, z: p.z, rotY: p.rotY };
}
