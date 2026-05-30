/**
 * Phase 15B — ambient traffic heading validator (read-only).
 *
 * For every TRAFFIC_ROUTES segment, samples several t values and asserts that
 * the ambient car's heading (ambientCarStateAt().rotY) faces the actual movement
 * direction — i.e. the segment tangent — so cars never drive sideways:
 *   - rotY differs from the segment tangent by < 5°,
 *   - rotY differs from the ACTUAL sampled movement direction by < 5°,
 *   - (therefore) rotY is never ~45/90/135° off the movement direction,
 *   - sampled positions are finite and within world bounds.
 *
 * Run standalone: `node <jiti> src/shared/trafficValidator.ts`.
 */

import { TRAFFIC_ROUTES, WORLD_HALF } from "./cityData";
import { ambientCarStateAt } from "./collision";
import type { TrafficCarSeed } from "./types";

const DEG = 180 / Math.PI;
const MAX_HEADING_ERR_DEG = 5;

function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export interface TrafficHeadingReport {
  routes: number;
  segmentsChecked: number;
  samples: number;
  maxTangentErrDeg: number;
  maxMotionErrDeg: number;
}

export function validateTrafficHeadings(): TrafficHeadingReport {
  const fail = (m: string): never => { throw new Error(`[traffic] ${m}`); };
  const probe: TrafficCarSeed = { id: "_validator", variant: "sedan", phase: 0, color: "#000" };

  let segmentsChecked = 0;
  let samples = 0;
  let maxTangentErrDeg = 0;
  let maxMotionErrDeg = 0;

  for (const route of TRAFFIC_ROUTES) {
    const segCount = route.waypoints.length;
    const dur = route.cycleSeconds;
    for (let k = 0; k < segCount; k++) {
      const a = route.waypoints[k];
      const b = route.waypoints[(k + 1) % segCount];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segLen < 1e-6) continue; // degenerate (duplicate vertex) — no heading
      segmentsChecked++;
      const tangent = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));

      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const progress = (k + t) / segCount;
        const tMs = progress * dur * 1000;
        const s = ambientCarStateAt(route, probe, tMs);
        samples++;

        // Finite + in-bounds position.
        if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || Math.abs(s.x) > WORLD_HALF || Math.abs(s.z) > WORLD_HALF) {
          fail(`route ${route.id} seg ${k} t=${t}: position out of bounds [${s.x}, ${s.z}]`);
        }

        // (1) heading vs the segment tangent.
        const tangentErr = Math.abs(angleDelta(s.rotY, tangent)) * DEG;
        if (tangentErr > maxTangentErrDeg) maxTangentErrDeg = tangentErr;
        if (tangentErr > MAX_HEADING_ERR_DEG) {
          fail(`route ${route.id} seg ${k} t=${t}: heading ${(s.rotY * DEG).toFixed(0)}° vs tangent ${(tangent * DEG).toFixed(0)}° (err ${tangentErr.toFixed(0)}°)`);
        }

        // (2) heading vs the ACTUAL sampled motion direction (finite-difference).
        const dtMs = (dur / segCount) * 1000 * 0.02; // 2% of a segment
        const s2 = ambientCarStateAt(route, probe, tMs + dtMs);
        const mx = s2.x - s.x;
        const mz = s2.z - s.z;
        if (Math.hypot(mx, mz) > 1e-6) {
          const motionDir = Math.atan2(-mx, -mz);
          const motionErr = Math.abs(angleDelta(s.rotY, motionDir)) * DEG;
          if (motionErr > maxMotionErrDeg) maxMotionErrDeg = motionErr;
          if (motionErr > MAX_HEADING_ERR_DEG) {
            fail(`route ${route.id} seg ${k} t=${t}: heading is ${motionErr.toFixed(0)}° off the actual movement direction (sideways)`);
          }
        }
      }
    }
  }

  return { routes: TRAFFIC_ROUTES.length, segmentsChecked, samples, maxTangentErrDeg, maxMotionErrDeg };
}

const isMain = typeof process !== "undefined" && process.argv?.[1]?.includes("trafficValidator");
if (isMain) {
  const r = validateTrafficHeadings();
  console.info(
    `[traffic] PASS — ${r.routes} routes, ${r.segmentsChecked} segments, ${r.samples} samples; ` +
    `max heading err: tangent ${r.maxTangentErrDeg.toFixed(2)}°, motion ${r.maxMotionErrDeg.toFixed(2)}°`,
  );
}
