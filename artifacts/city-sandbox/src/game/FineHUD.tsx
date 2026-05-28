/**
 * Phase 6E: FineHUD — two components:
 *
 * 1. IssueFinePanel — officer overlay opened with H key when a player is in
 *    POLICE_FINE_RADIUS. Shows preset amounts + reason + Issue button.
 *    Closes on Escape or after emitting the fine.
 *
 * 2. PendingFineOverlay — target overlay shown when rp:fineIssued arrives.
 *    Shows officer name, amount, reason, 60s countdown, and Accept / Reject buttons.
 *    Clears on rp:fineResolved or rp:fineExpired.
 */

import { useEffect, useRef, useState } from "react";
import type { RpPendingFine } from "../shared/rpTypes";

// ── Styling constants (same palette as HUD.tsx) ───────────────────────────────
const PANEL_BG     = "rgba(8, 14, 28, 0.92)";
const PANEL_BORDER = "rgba(0, 229, 255, 0.28)";
const PANEL_RADIUS = 10;
const PANEL_SHADOW =
  "0 8px 24px rgba(0,0,0,0.55), 0 0 1px rgba(0,229,255,0.25), inset 0 1px 0 rgba(255,255,255,0.04)";

const PRESETS = [
  { label: "Reckless driving",   amount: 150 },
  { label: "Illegal parking",    amount: 75  },
  { label: "Disturbing peace",   amount: 100 },
  { label: "Failure to comply",  amount: 200 },
] as const;

// ── IssueFinePanel ─────────────────────────────────────────────────────────────

interface IssueFineProps {
  targetId:     string;
  targetName:   string;
  /** Called when the officer confirms a fine (server emit happens in GameScene). */
  onIssue:      (targetId: string, amount: number, reason: string) => void;
  onClose:      () => void;
}

export function IssueFinePanel({ targetId, targetName, onIssue, onClose }: IssueFineProps) {
  const [selectedAmount, setSelectedAmount] = useState<number>(150);
  const [selectedReason, setSelectedReason] = useState<string>("Reckless driving");

  // Close on Escape key.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleIssue = () => {
    onIssue(targetId, selectedAmount, selectedReason);
    onClose();
  };

  return (
    <div
      style={{
        position:        "fixed",
        inset:           0,
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        zIndex:          3000,
        background:      "rgba(0,0,0,0.45)",
        fontFamily:      "'Courier New', monospace",
        userSelect:      "none",
      }}
    >
      <div
        style={{
          background:    PANEL_BG,
          border:        `1px solid rgba(255, 180, 0, 0.65)`,
          borderRadius:  PANEL_RADIUS + 2,
          padding:       "20px 24px 24px",
          boxShadow:     `${PANEL_SHADOW}, 0 0 36px rgba(255,180,0,0.2)`,
          backdropFilter: "blur(10px)",
          minWidth:      340,
          maxWidth:      420,
          pointerEvents: "auto",
        }}
      >
        {/* Header */}
        <div style={{
          display:       "flex",
          alignItems:    "center",
          gap:           10,
          marginBottom:  16,
        }}>
          <div style={{ fontSize: 24 }}>🏛</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: "bold", color: "#ffcc44", letterSpacing: 1 }}>
              Issue Fine
            </div>
            <div style={{ fontSize: 12, color: "#9bb", marginTop: 2 }}>
              to <span style={{ color: "#fff", fontWeight: "bold" }}>{targetName}</span>
            </div>
          </div>
        </div>

        {/* Preset amounts */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#7899aa", letterSpacing: 2, marginBottom: 8 }}>
            SELECT VIOLATION
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {PRESETS.map((p) => {
              const active = selectedAmount === p.amount && selectedReason === p.label;
              return (
                <button
                  key={p.label}
                  onClick={() => { setSelectedAmount(p.amount); setSelectedReason(p.label); }}
                  style={{
                    display:        "flex",
                    justifyContent: "space-between",
                    alignItems:     "center",
                    padding:        "8px 12px",
                    borderRadius:   8,
                    border:         active
                      ? "1px solid rgba(255,200,50,0.9)"
                      : "1px solid rgba(255,200,50,0.25)",
                    background:     active
                      ? "rgba(255,200,50,0.15)"
                      : "rgba(255,255,255,0.04)",
                    cursor:         "pointer",
                    color:          active ? "#ffcc44" : "#cde",
                    fontFamily:     "'Courier New', monospace",
                    fontSize:       13,
                    fontWeight:     active ? "bold" : "normal",
                    transition:     "all 0.15s",
                  }}
                >
                  <span>{p.label}</span>
                  <span style={{ color: active ? "#ffcc44" : "#7899aa", fontWeight: "bold" }}>
                    ${p.amount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            onClick={handleIssue}
            style={{
              flex:          1,
              padding:       "10px 0",
              borderRadius:  8,
              border:        "1px solid rgba(255,200,50,0.85)",
              background:    "rgba(255,200,50,0.18)",
              color:         "#ffcc44",
              fontFamily:    "'Courier New', monospace",
              fontWeight:    "bold",
              fontSize:      13,
              cursor:        "pointer",
              letterSpacing: 1,
            }}
          >
            Issue Fine · ${selectedAmount}
          </button>
          <button
            onClick={onClose}
            style={{
              padding:       "10px 16px",
              borderRadius:  8,
              border:        `1px solid ${PANEL_BORDER}`,
              background:    "transparent",
              color:         "#778",
              fontFamily:    "'Courier New', monospace",
              fontSize:      13,
              cursor:        "pointer",
            }}
          >
            Cancel
          </button>
        </div>

        <div style={{ fontSize: 10, color: "#445", marginTop: 10, textAlign: "center" }}>
          ESC to cancel
        </div>
      </div>
    </div>
  );
}

// ── PendingFineOverlay ────────────────────────────────────────────────────────

interface PendingFineProps {
  fine:       RpPendingFine;
  onAccept:   () => void;
  onReject:   () => void;
}

export function PendingFineOverlay({ fine, onAccept, onReject }: PendingFineProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, fine.expiresAt - Date.now()),
  );

  // Tick countdown every 500ms.
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, fine.expiresAt - Date.now()));
    }, 500);
    return () => clearInterval(id);
  }, [fine.expiresAt]);

  const secs = Math.ceil(remaining / 1000);

  // Colour shifts red as it approaches zero.
  const timerColor =
    secs > 30 ? "#00e5ff" : secs > 10 ? "#ffb547" : "#ff4444";

  // Prevent click-through to the game world.
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  // Block WASD while overlay is open — attach inside the overlay itself via
  // a dummy focused div; real prevention is the pointerEvents + focus trap.
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      onClick={stopProp}
      style={{
        position:        "fixed",
        inset:           0,
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        zIndex:          2600,
        background:      "rgba(0, 0, 0, 0.55)",
        fontFamily:      "'Courier New', monospace",
        userSelect:      "none",
        outline:         "none",
      }}
    >
      <div
        style={{
          background:     PANEL_BG,
          border:         "1px solid rgba(255, 68, 68, 0.55)",
          borderRadius:   PANEL_RADIUS + 2,
          padding:        "20px 24px 24px",
          boxShadow:      `${PANEL_SHADOW}, 0 0 36px rgba(255,68,68,0.18)`,
          backdropFilter: "blur(10px)",
          minWidth:       340,
          maxWidth:       420,
          pointerEvents:  "auto",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 32, marginBottom: 6 }}>🚔</div>
          <div style={{ fontSize: 16, fontWeight: "bold", color: "#ff6666", letterSpacing: 2 }}>
            FINE NOTICE
          </div>
          <div style={{ fontSize: 12, color: "#9bb", marginTop: 4 }}>
            Issued by{" "}
            <span style={{ color: "#fff", fontWeight: "bold" }}>{fine.officerName}</span>
          </div>
        </div>

        {/* Amount */}
        <div style={{
          textAlign:    "center",
          fontSize:     40,
          fontWeight:   "bold",
          color:        "#ff4444",
          textShadow:   "0 0 16px rgba(255,68,68,0.6)",
          marginBottom: 8,
          letterSpacing: 2,
        }}>
          ${fine.amount.toLocaleString()}
        </div>

        {/* Reason */}
        <div style={{
          textAlign:     "center",
          fontSize:      13,
          color:         "#bbb",
          marginBottom:  16,
          padding:       "4px 10px",
          background:    "rgba(255,255,255,0.04)",
          borderRadius:  6,
          border:        "1px solid rgba(255,255,255,0.06)",
        }}>
          {fine.reason}
        </div>

        {/* Countdown */}
        <div style={{
          textAlign:    "center",
          fontSize:     13,
          color:        timerColor,
          marginBottom: 20,
          fontWeight:   "bold",
          letterSpacing: 1,
          transition:   "color 0.3s",
        }}>
          ⏱ {secs}s to respond
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onAccept}
            style={{
              flex:          1,
              padding:       "10px 0",
              borderRadius:  8,
              border:        "1px solid rgba(46, 224, 122, 0.7)",
              background:    "rgba(46, 224, 122, 0.14)",
              color:         "#2ee07a",
              fontFamily:    "'Courier New', monospace",
              fontWeight:    "bold",
              fontSize:      13,
              cursor:        "pointer",
              letterSpacing: 0.5,
            }}
          >
            ✓ Pay ${fine.amount}
          </button>
          <button
            onClick={onReject}
            style={{
              flex:          1,
              padding:       "10px 0",
              borderRadius:  8,
              border:        "1px solid rgba(255, 68, 68, 0.7)",
              background:    "rgba(255, 68, 68, 0.10)",
              color:         "#ff6666",
              fontFamily:    "'Courier New', monospace",
              fontWeight:    "bold",
              fontSize:      13,
              cursor:        "pointer",
              letterSpacing: 0.5,
            }}
          >
            ✗ Reject
          </button>
        </div>

        <div style={{ fontSize: 10, color: "#445", marginTop: 12, textAlign: "center" }}>
          Rejecting may result in a warrant being issued.
        </div>
      </div>
    </div>
  );
}
