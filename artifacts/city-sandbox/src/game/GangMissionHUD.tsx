/**
 * GangMissionHUD — compact overlay shown during an active Tag Turf gang mission.
 *
 * Displays:
 *   - Mission name + faction colour badge
 *   - "1 / 3  2 / 3  3 / 3" progress dots
 *   - Distance to the current tag point (client-side estimate, server validates)
 *   - Payout amount
 *
 * Phase 7G constraint: client is UX-only. Never declares completion or
 * sends payout — those are server-authoritative.
 */

import React, { useMemo } from "react";
import type { ActiveGangMission } from "../shared/rpTypes";

interface GangMissionHUDProps {
  activeGangMission: ActiveGangMission | null;
  /** Local player world position [x, y, z] for distance display. */
  localPos:          [number, number, number] | null;
  /** Faction colour hex string for badge tint. */
  factionColor:      string | null;
}

export function GangMissionHUD({
  activeGangMission,
  localPos,
  factionColor,
}: GangMissionHUDProps) {
  if (!activeGangMission) return null;

  const { points, nextIdx, pay } = activeGangMission;
  const total = points.length;

  // Client-side distance estimate to the current tag point (cosmetic only).
  const distM = useMemo(() => {
    if (!localPos || nextIdx >= points.length) return null;
    const [tx, ty, tz] = points[nextIdx]!;
    const dx = localPos[0] - tx;
    const dy = localPos[1] - ty;
    const dz = localPos[2] - tz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }, [localPos, points, nextIdx]);

  const badgeColor = factionColor ?? "#22c55e";

  return (
    <div
      style={{
        position:        "fixed",
        top:             "50%",
        right:           20,
        transform:       "translateY(-50%)",
        background:      "rgba(0,0,0,0.72)",
        border:          `2px solid ${badgeColor}`,
        borderRadius:    10,
        padding:         "12px 18px",
        color:           "#fff",
        fontFamily:      "monospace",
        fontSize:        13,
        minWidth:        160,
        pointerEvents:   "none",
        userSelect:      "none",
        zIndex:          2100,
      }}
    >
      {/* Mission title */}
      <div style={{ fontSize: 11, color: badgeColor, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
        TAG TURF MISSION
      </div>

      {/* Progress dots */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        {Array.from({ length: total }, (_, i) => {
          const done    = i < nextIdx;
          const current = i === nextIdx;
          return (
            <div
              key={i}
              style={{
                width:        current ? 14 : 10,
                height:       current ? 14 : 10,
                borderRadius: "50%",
                background:   done    ? badgeColor :
                              current ? "#fff"     : "rgba(255,255,255,0.2)",
                border:       current ? `2px solid ${badgeColor}` : "none",
                transition:   "all 0.2s",
              }}
            />
          );
        })}
        <span style={{ marginLeft: 4, fontSize: 12, color: "#aaa" }}>
          {nextIdx < total ? `${nextIdx + 1} / ${total}` : "Done"}
        </span>
      </div>

      {/* Distance to current tag point */}
      {distM !== null && nextIdx < total && (
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: "#aaa" }}>Distance: </span>
          <span style={{ color: distM <= 8 ? "#4ade80" : "#fff", fontWeight: 600 }}>
            {distM < 1 ? "<1" : Math.round(distM)}m
          </span>
        </div>
      )}

      {/* Payout */}
      <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600 }}>
        Payout: ${pay}
      </div>
    </div>
  );
}
