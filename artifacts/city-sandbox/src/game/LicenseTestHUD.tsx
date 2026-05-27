/**
 * LicenseTestHUD — Phase 2 overlay shown during an active driver license test.
 *
 * Displayed as a top-center panel when rpProfile.activeTest is non-null.
 * Shows: checkpoint progress, elapsed time, next-checkpoint label.
 * Disappears the moment activeTest becomes null (pass or fail).
 */

import { useEffect, useRef, useState } from "react";
import type { ActiveTest } from "../shared/rpTypes";

interface LicenseTestHUDProps {
  activeTest: ActiveTest | null;
}

const PANEL_BG       = "rgba(8, 14, 28, 0.82)";
const PANEL_RADIUS   = 10;
const PANEL_BORDER   = "rgba(0, 229, 255, 0.3)";
const PANEL_SHADOW   =
  "0 8px 24px rgba(0,0,0,0.5), 0 0 1px rgba(0,229,255,0.3)";

const CP_LABELS = ["South Road", "East Junction", "North Road", "Finish"];

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

export default function LicenseTestHUD({ activeTest }: LicenseTestHUDProps) {
  const startRef   = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // Reset start clock whenever a new test begins.
  useEffect(() => {
    if (!activeTest) return;
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 500);
    return () => clearInterval(id);
  }, [activeTest !== null]); // only re-run when test starts/ends

  if (!activeTest) return null;

  const total   = activeTest.checkpoints.length;
  const passed  = activeTest.nextCp;            // nextCp = how many passed so far
  const nextLabel = passed < total ? (CP_LABELS[passed] ?? `CP ${passed + 1}`) : "—";
  const pct     = total > 0 ? (passed / total) * 100 : 0;

  return (
    <div
      style={{
        position:    "absolute",
        top:         16,
        left:        "50%",
        transform:   "translateX(-50%)",
        background:  PANEL_BG,
        border:      `1px solid ${PANEL_BORDER}`,
        borderRadius: PANEL_RADIUS,
        padding:     "10px 18px",
        minWidth:    260,
        boxShadow:   PANEL_SHADOW,
        backdropFilter:       "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        pointerEvents: "none",
        userSelect: "none",
        fontFamily: "'Courier New', monospace",
        zIndex: 150,
      }}
    >
      {/* Header */}
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
          marginBottom:   8,
        }}
      >
        <span
          style={{
            fontSize:     10,
            letterSpacing: 3,
            color:        "#00e5ff",
            textTransform: "uppercase",
          }}
        >
          🚗 License Test
        </span>
        <span style={{ fontSize: 11, color: "#ffcc00", letterSpacing: 1 }}>
          {formatElapsed(elapsed)}
        </span>
      </div>

      {/* Checkpoint progress bar */}
      <div
        style={{
          background:   "rgba(255,255,255,0.06)",
          borderRadius: 4,
          height:       6,
          marginBottom: 8,
          overflow:     "hidden",
        }}
      >
        <div
          style={{
            width:        `${pct}%`,
            height:       "100%",
            background:   "linear-gradient(90deg, #00e676, #00e5ff)",
            borderRadius: 4,
            transition:   "width 0.4s ease",
          }}
        />
      </div>

      {/* Status line */}
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          fontSize:       11,
          color:          "#aac",
          letterSpacing:  1,
        }}
      >
        <span>
          {passed < total
            ? `Next: ${nextLabel}`
            : "Heading to finish…"}
        </span>
        <span style={{ color: "#00e676" }}>
          {passed}/{total} ✓
        </span>
      </div>
    </div>
  );
}
