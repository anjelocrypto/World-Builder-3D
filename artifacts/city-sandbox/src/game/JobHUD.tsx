/**
 * JobHUD — Phase 4 overlay shown during an active City Worker route.
 *
 * Displayed top-center (below controls hint) while rpProfile.activeJob is
 * non-null. Shows the job name, current checkpoint progress X/N, and the
 * route payout.
 *
 * Rendered outside the Canvas (plain React) so it sits above the 3D scene
 * without any R3F overhead.
 */

import type { ActiveJob } from "../shared/rpTypes";

interface JobHUDProps {
  activeJob: ActiveJob | null;
}

const PANEL_BG     = "rgba(8, 14, 28, 0.82)";
const PANEL_BORDER = "rgba(255, 165, 0, 0.55)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 24px rgba(0,0,0,0.5), 0 0 1px rgba(255,165,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)";

export default function JobHUD({ activeJob }: JobHUDProps) {
  if (!activeJob) return null;

  const total   = activeJob.checkpoints.length;
  const current = Math.min(activeJob.nextCp, total);
  const done    = current >= total;

  return (
    <div
      style={{
        position:        "fixed",
        top:             64,
        left:            "50%",
        transform:       "translateX(-50%)",
        background:      PANEL_BG,
        border:          `1px solid ${PANEL_BORDER}`,
        borderRadius:    PANEL_RADIUS,
        padding:         "10px 22px",
        display:         "flex",
        flexDirection:   "column",
        alignItems:      "center",
        gap:             6,
        boxShadow:       PANEL_SHADOW,
        backdropFilter:  "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        pointerEvents:   "none",
        minWidth:        200,
        fontFamily:      "'Courier New', monospace",
        userSelect:      "none",
        zIndex:          50,
      }}
    >
      {/* Job label */}
      <div
        style={{
          fontSize:      10,
          color:         "#ffa500",
          letterSpacing: 3,
          fontWeight:    "bold",
          textTransform: "uppercase",
        }}
      >
        🏗 City Worker
      </div>

      {/* Checkpoint progress bar */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {Array.from({ length: total }).map((_, i) => {
          const isPassed = i < current;
          const isNext   = i === current && !done;
          return (
            <div
              key={i}
              style={{
                width:        24,
                height:       8,
                borderRadius: 3,
                background:   isPassed
                  ? "#ffa500"
                  : isNext
                  ? "rgba(255,165,0,0.45)"
                  : "rgba(255,255,255,0.1)",
                boxShadow:    isPassed ? "0 0 6px rgba(255,165,0,0.6)" : "none",
                transition:   "background 0.25s",
              }}
            />
          );
        })}
      </div>

      {/* Status line */}
      <div
        style={{
          fontSize:  12,
          color:     done ? "#2ee07a" : "#fff",
          letterSpacing: 0.5,
        }}
      >
        {done
          ? "Route complete!"
          : `Checkpoint ${current + 1} / ${total}`}{" "}
        <span style={{ color: "#9bb", fontSize: 11 }}>· ${activeJob.pay} pay</span>
      </div>
    </div>
  );
}
