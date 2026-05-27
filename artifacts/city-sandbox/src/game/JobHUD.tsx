/**
 * JobHUD — Phase 4/5A/5B/5C overlay shown during an active job route.
 *
 * Phase 4:  City Worker — progress bar of 4 walk checkpoints.
 * Phase 5A: Taxi Driver — two-stage HUD (pickup → dropoff) with fare display.
 * Phase 5B: Delivery Driver — pickup + ordered stop segments.
 * Phase 5C: Mechanic — travel to target + repair countdown.
 *
 * Branches on activeJob.job (or activeJob.mode) to render the correct layout.
 * Rendered outside the Canvas (plain React) so it sits above the 3D scene.
 */

import { useEffect, useState } from "react";
import type { ActiveJob } from "../shared/rpTypes";
import { MECHANIC_REPAIR_DURATION_MS } from "../shared/rpTypes";

interface JobHUDProps {
  activeJob: ActiveJob | null;
}

const PANEL_BG     = "rgba(8, 14, 28, 0.82)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)";

// ── City Worker HUD ────────────────────────────────────────────────────────────

function CityWorkerHUD({ activeJob }: { activeJob: ActiveJob }) {
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
        border:          "1px solid rgba(255,165,0,0.55)",
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
      <div style={{ fontSize: 10, color: "#ffa500", letterSpacing: 3, fontWeight: "bold", textTransform: "uppercase" }}>
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

      <div style={{ fontSize: 12, color: done ? "#2ee07a" : "#fff", letterSpacing: 0.5 }}>
        {done
          ? "Route complete!"
          : `Checkpoint ${current + 1} / ${total}`}{" "}
        <span style={{ color: "#9bb", fontSize: 11 }}>· ${activeJob.pay} pay</span>
      </div>
    </div>
  );
}

// ── Taxi Driver HUD ────────────────────────────────────────────────────────────

const TAXI_YELLOW = "#f5c518";
const TAXI_BLUE   = "#4488ff";

function TaxiHUD({ activeJob }: { activeJob: ActiveJob }) {
  const stage = activeJob.nextCp; // 0 = go to pickup, 1 = go to dropoff, 2 = complete
  const done  = stage >= 2;

  const pickupDone  = stage >= 1;
  const dropoffDone = done;

  const stageLabel = done
    ? "Fare complete!"
    : stage === 0
    ? "Pick up passenger"
    : "Drop off passenger";

  const stageColor = done ? "#2ee07a" : stage === 0 ? TAXI_YELLOW : TAXI_BLUE;

  return (
    <div
      style={{
        position:        "fixed",
        top:             64,
        left:            "50%",
        transform:       "translateX(-50%)",
        background:      PANEL_BG,
        border:          `1px solid rgba(245,197,24,0.6)`,
        borderRadius:    PANEL_RADIUS,
        padding:         "10px 24px",
        display:         "flex",
        flexDirection:   "column",
        alignItems:      "center",
        gap:             6,
        boxShadow:       PANEL_SHADOW,
        backdropFilter:  "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        pointerEvents:   "none",
        minWidth:        220,
        fontFamily:      "'Courier New', monospace",
        userSelect:      "none",
        zIndex:          50,
      }}
    >
      {/* Job label */}
      <div style={{ fontSize: 10, color: TAXI_YELLOW, letterSpacing: 3, fontWeight: "bold", textTransform: "uppercase" }}>
        🚕 Taxi Driver
      </div>

      {/* Two-stage progress row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        {/* Pickup */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div
            style={{
              width:        48,
              height:       8,
              borderRadius: 3,
              background:   pickupDone
                ? TAXI_YELLOW
                : stage === 0
                ? "rgba(245,197,24,0.5)"
                : "rgba(255,255,255,0.1)",
              boxShadow:    pickupDone ? `0 0 6px rgba(245,197,24,0.6)` : "none",
              transition:   "background 0.25s",
            }}
          />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>PICKUP</span>
        </div>

        {/* Arrow */}
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>→</span>

        {/* Dropoff */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div
            style={{
              width:        48,
              height:       8,
              borderRadius: 3,
              background:   dropoffDone
                ? TAXI_BLUE
                : stage === 1
                ? "rgba(68,136,255,0.5)"
                : "rgba(255,255,255,0.1)",
              boxShadow:    dropoffDone ? `0 0 6px rgba(68,136,255,0.6)` : "none",
              transition:   "background 0.25s",
            }}
          />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>DROPOFF</span>
        </div>
      </div>

      {/* Status line */}
      <div style={{ fontSize: 12, color: stageColor, letterSpacing: 0.5 }}>
        {stageLabel}{" "}
        <span style={{ color: "#9bb", fontSize: 11 }}>· ${activeJob.pay} fare</span>
      </div>
    </div>
  );
}

// ── Delivery Driver HUD ───────────────────────────────────────────────────────

const DELIVERY_BROWN  = "#c8884a";
const DELIVERY_ORANGE = "#ff9944";

function DeliveryHUD({ activeJob }: { activeJob: ActiveJob }) {
  const total = activeJob.checkpoints.length; // pickup(0) + dropoffs(1..N)
  const stage = activeJob.nextCp;             // 0=pickup, 1..N=dropoffs, N+1=done
  const done  = stage >= total;

  // stage 0 = load cargo at hub; stage 1..N-1 = deliver stop
  const stageLabel = done
    ? "Delivery complete!"
    : stage === 0
    ? "Load cargo at hub"
    : `Deliver stop ${stage} / ${total - 1}`;

  const stageColor = done ? "#2ee07a" : stage === 0 ? DELIVERY_BROWN : DELIVERY_ORANGE;

  return (
    <div
      style={{
        position:             "fixed",
        top:                  64,
        left:                 "50%",
        transform:            "translateX(-50%)",
        background:           PANEL_BG,
        border:               `1px solid rgba(200,136,74,0.6)`,
        borderRadius:         PANEL_RADIUS,
        padding:              "10px 24px",
        display:              "flex",
        flexDirection:        "column",
        alignItems:           "center",
        gap:                  6,
        boxShadow:            PANEL_SHADOW,
        backdropFilter:       "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        pointerEvents:        "none",
        minWidth:             240,
        fontFamily:           "'Courier New', monospace",
        userSelect:           "none",
        zIndex:               50,
      }}
    >
      {/* Job label */}
      <div style={{ fontSize: 10, color: DELIVERY_BROWN, letterSpacing: 3, fontWeight: "bold", textTransform: "uppercase" }}>
        📦 Delivery Driver
      </div>

      {/* Stop progress row — pickup + delivery stops */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
        {Array.from({ length: total }).map((_, i) => {
          const isPassed = i < stage;
          const isNext   = i === stage && !done;
          const isPickup = i === 0;
          const color    = isPickup ? DELIVERY_BROWN : DELIVERY_ORANGE;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div
                style={{
                  width:        i === 0 ? 40 : 28,
                  height:       8,
                  borderRadius: 3,
                  background:   isPassed
                    ? color
                    : isNext
                    ? color + "66"
                    : "rgba(255,255,255,0.1)",
                  boxShadow:    isPassed ? `0 0 6px ${color}88` : "none",
                  transition:   "background 0.25s",
                }}
              />
              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", letterSpacing: 1 }}>
                {isPickup ? "LOAD" : `S${i}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Status line */}
      <div style={{ fontSize: 12, color: stageColor, letterSpacing: 0.5 }}>
        {stageLabel}{" "}
        <span style={{ color: "#9bb", fontSize: 11 }}>· ${activeJob.pay} pay</span>
      </div>
    </div>
  );
}

// ── Mechanic HUD ─────────────────────────────────────────────────────────────

const MECHANIC_STEEL  = "#8899bb";
const MECHANIC_RED    = "#ff4422";
const MECHANIC_ORANGE = "#ff9944";

function MechanicHUD({ activeJob }: { activeJob: ActiveJob }) {
  const isRepairing = activeJob.nextCp === 1;

  // Countdown — ticks every 100 ms while repairing
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!isRepairing || !activeJob.repairStartedAt) {
      setTimeLeft(null);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - (activeJob.repairStartedAt as number);
      const remaining = Math.max(0, MECHANIC_REPAIR_DURATION_MS - elapsed);
      setTimeLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [isRepairing, activeJob.repairStartedAt]);

  const done = activeJob.nextCp >= 2;

  const stageLabel = done
    ? "Repair complete!"
    : isRepairing
    ? timeLeft !== null && timeLeft > 0
      ? `Repairing… ${(timeLeft / 1000).toFixed(1)}s`
      : "Repair done — collecting pay…"
    : "Drive to broken vehicle";

  const stageColor = done ? "#2ee07a" : isRepairing ? MECHANIC_RED : MECHANIC_ORANGE;
  const borderColor = isRepairing ? "rgba(255,68,34,0.6)" : "rgba(136,153,187,0.55)";

  // Progress bar: stage 0 = travel, stage 1 = repair
  const travelDone  = activeJob.nextCp >= 1;
  const repairDone  = done;

  return (
    <div
      style={{
        position:             "fixed",
        top:                  64,
        left:                 "50%",
        transform:            "translateX(-50%)",
        background:           PANEL_BG,
        border:               `1px solid ${borderColor}`,
        borderRadius:         PANEL_RADIUS,
        padding:              "10px 24px",
        display:              "flex",
        flexDirection:        "column",
        alignItems:           "center",
        gap:                  6,
        boxShadow:            PANEL_SHADOW,
        backdropFilter:       "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        pointerEvents:        "none",
        minWidth:             220,
        fontFamily:           "'Courier New', monospace",
        userSelect:           "none",
        zIndex:               50,
      }}
    >
      {/* Job label */}
      <div style={{ fontSize: 10, color: MECHANIC_STEEL, letterSpacing: 3, fontWeight: "bold", textTransform: "uppercase" }}>
        🔧 Mechanic
      </div>

      {/* Two-stage progress row: TRAVEL → REPAIR */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        {/* Travel */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div
            style={{
              width:        48,
              height:       8,
              borderRadius: 3,
              background:   travelDone
                ? MECHANIC_ORANGE
                : !isRepairing
                ? "rgba(255,153,68,0.5)"
                : "rgba(255,255,255,0.1)",
              boxShadow:    travelDone ? `0 0 6px rgba(255,153,68,0.6)` : "none",
              transition:   "background 0.25s",
            }}
          />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>TRAVEL</span>
        </div>

        {/* Arrow */}
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>→</span>

        {/* Repair */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div
            style={{
              width:        48,
              height:       8,
              borderRadius: 3,
              background:   repairDone
                ? MECHANIC_RED
                : isRepairing
                ? "rgba(255,68,34,0.5)"
                : "rgba(255,255,255,0.1)",
              boxShadow:    repairDone ? `0 0 6px rgba(255,68,34,0.6)` : "none",
              transition:   "background 0.25s",
            }}
          />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>REPAIR</span>
        </div>
      </div>

      {/* Status line */}
      <div style={{ fontSize: 12, color: stageColor, letterSpacing: 0.5 }}>
        {stageLabel}{" "}
        <span style={{ color: "#9bb", fontSize: 11 }}>· ${activeJob.pay} pay</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function JobHUD({ activeJob }: JobHUDProps) {
  if (!activeJob) return null;

  if (activeJob.job === "taxi_driver") {
    return <TaxiHUD activeJob={activeJob} />;
  }

  if (activeJob.job === "delivery_driver") {
    return <DeliveryHUD activeJob={activeJob} />;
  }

  if (activeJob.job === "mechanic") {
    return <MechanicHUD activeJob={activeJob} />;
  }

  // Default: city_worker (or any future walk job)
  return <CityWorkerHUD activeJob={activeJob} />;
}
