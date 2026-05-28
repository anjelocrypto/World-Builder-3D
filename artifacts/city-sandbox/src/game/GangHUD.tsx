/**
 * Phase 7D: GangHUD — Grove Street Families gang panel.
 * Phase 7E: Added join request button for non-members + leader request queue.
 *
 * - Opened with G key when the player is a gang member OR near GROVE_STREET_HANGOUT_POS.
 * - Gang members see their faction info, rank, and a "Claim Presence" action.
 * - Leaders additionally see pending join requests with Accept/Reject buttons.
 * - Non-gang players near the hangout see a "Request to Join" button.
 * - ESC / G closes the panel.
 */

import { useEffect, useRef, useState } from "react";
import type { GangStatus, GangPresenceEvent, GangJoinRequest, GangJoinResult, GangJoinRequestSent } from "../shared/rpTypes";
import { GANG_LEADER_MIN_RANK } from "../shared/rpTypes";

// ── Styling constants ─────────────────────────────────────────────────────────
const PANEL_BG       = "rgba(6, 18, 8, 0.97)";
const PANEL_BORDER   = "rgba(46, 125, 50, 0.45)";
const PANEL_RADIUS   = 10;
const PANEL_SHADOW   = "0 8px 28px rgba(0,0,0,0.8), 0 0 1px rgba(46,125,50,0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
const GANG_GREEN     = "#4caf50";
const GANG_GREEN_DIM = "#2e7d32";
const GANG_LIGHT     = "#81c784";

interface GangHUDProps {
  gangStatus:              GangStatus | null;
  gangPresenceEvents:      GangPresenceEvent[];
  gangJoinRequests:        GangJoinRequest[];
  gangJoinResult:          GangJoinResult | null;
  gangJoinRequestSent:     GangJoinRequestSent | null;
  nearHangout:             boolean;
  nearTurf:                boolean;
  emitGangStatus:          () => void;
  emitGangAction:          (action: string) => void;
  emitGangJoinRequest:     (factionSlug: string) => void;
  emitGangJoinResponse:    (targetSocketId: string, accept: boolean) => void;
  dismissGangJoinResult:   () => void;
  onClose:                 () => void;
}

export default function GangHUD({
  gangStatus,
  gangPresenceEvents,
  gangJoinRequests,
  gangJoinResult,
  gangJoinRequestSent,
  nearHangout,
  nearTurf,
  emitGangStatus,
  emitGangAction,
  emitGangJoinRequest,
  emitGangJoinResponse,
  dismissGangJoinResult,
  onClose,
}: GangHUDProps) {
  const [lastAction, setLastAction] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch gang status when first opened.
  useEffect(() => {
    emitGangStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyG") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const stopProp = (e: React.KeyboardEvent) => e.stopPropagation();

  const handleClaimPresence = () => {
    if (!nearTurf) {
      setLastAction("⚠ You must be inside the turf zone.");
      return;
    }
    emitGangAction("claim_presence");
    setLastAction("✓ Presence claimed — server is broadcasting to crew.");
  };

  // Rank label map
  const rankLabel = (rank: number): string => {
    if (rank >= 8) return "OG";
    if (rank >= 6) return "Shot Caller";
    if (rank >= 4) return "Lieutenant";
    if (rank >= 2) return "Soldier";
    return "Associate";
  };

  const isMember  = gangStatus?.isMember === true;
  const isLeader  = isMember && (gangStatus?.factionRank ?? 0) >= GANG_LEADER_MIN_RANK;
  const hasPending = gangJoinRequests.length > 0;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding:      "6px 14px",
    borderRadius: 5,
    border:       `1px solid ${active ? GANG_GREEN : "rgba(255,255,255,0.10)"}`,
    background:   active ? `${GANG_GREEN}22` : "rgba(255,255,255,0.04)",
    color:        active ? GANG_GREEN : "#445",
    fontFamily:   "'Courier New', monospace",
    fontSize:     11,
    cursor:       active ? "pointer" : "default",
    fontWeight:   "bold",
    transition:   "all 0.12s",
    whiteSpace:   "nowrap",
  });

  return (
    <div
      ref={containerRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position:   "fixed",
        top:        60,
        right:      16,
        width:      320,
        zIndex:     2500,
        fontFamily: "'Courier New', monospace",
        userSelect: "none",
      }}
    >
      <div
        style={{
          background:     PANEL_BG,
          border:         `1px solid ${PANEL_BORDER}`,
          borderRadius:   PANEL_RADIUS,
          boxShadow:      PANEL_SHADOW,
          backdropFilter: "blur(14px)",
          overflow:       "hidden",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            padding:        "9px 12px 8px",
            borderBottom:   `1px solid ${GANG_GREEN_DIM}55`,
            background:     `${GANG_GREEN}11`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 14 }}>🟢</span>
            <span
              style={{
                fontSize:      11,
                fontWeight:    "bold",
                color:         GANG_GREEN,
                letterSpacing: 1.5,
              }}
            >
              {isMember
                ? (gangStatus?.factionName ?? "GROVE STREET")
                : "GROVE STREET FAMILIES"}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border:     "none",
              color:      "#445",
              fontSize:   14,
              cursor:     "pointer",
              lineHeight: 1,
              padding:    "0 2px",
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* ── Join result toast (shown for both members + non-members) ──── */}
          {gangJoinResult && (
            <div
              style={{
                padding:      "10px 12px",
                borderRadius: 6,
                border:       `1px solid ${gangJoinResult.accepted ? "rgba(76,175,80,0.4)" : "rgba(255,82,82,0.3)"}`,
                background:   gangJoinResult.accepted ? "rgba(76,175,80,0.10)" : "rgba(255,82,82,0.08)",
                display:      "flex",
                flexDirection: "column",
                gap:          6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: "bold", color: gangJoinResult.accepted ? GANG_GREEN : "#ef5350" }}>
                {gangJoinResult.accepted ? "✓ Welcome to the crew" : "✗ Request declined"}
              </div>
              {gangJoinResult.accepted && gangJoinResult.factionName && (
                <div style={{ fontSize: 10, color: GANG_LIGHT }}>
                  You are now a member of {gangJoinResult.factionName}.
                </div>
              )}
              <button
                onClick={dismissGangJoinResult}
                onKeyDown={stopProp}
                style={{ ...btnStyle(true), alignSelf: "flex-start", fontSize: 10, padding: "4px 10px" }}
              >
                Dismiss
              </button>
            </div>
          )}

          {isMember ? (
            <>
              {/* Member info row */}
              <div
                style={{
                  display:      "flex",
                  gap:          10,
                  alignItems:   "center",
                  padding:      "8px 10px",
                  background:   "rgba(76,175,80,0.07)",
                  borderRadius: 6,
                  border:       "1px solid rgba(76,175,80,0.15)",
                }}
              >
                <div
                  style={{
                    width:        36,
                    height:       36,
                    borderRadius: "50%",
                    background:   `${gangStatus?.factionColor ?? GANG_GREEN_DIM}33`,
                    border:       `2px solid ${gangStatus?.factionColor ?? GANG_GREEN}`,
                    display:      "flex",
                    alignItems:   "center",
                    justifyContent: "center",
                    fontSize:     16,
                    flexShrink:   0,
                  }}
                >
                  🏠
                </div>
                <div>
                  <div style={{ fontSize: 11, color: GANG_LIGHT, fontWeight: "bold" }}>
                    {rankLabel(gangStatus?.factionRank ?? 0)}
                  </div>
                  <div style={{ fontSize: 10, color: "#668", marginTop: 1 }}>
                    Rank {gangStatus?.factionRank ?? 0} · {gangStatus?.factionSlug ?? "grove_street"}
                  </div>
                  {/* P2: turf name + online count */}
                  {gangStatus?.turfName && (
                    <div style={{ fontSize: 10, color: "#556", marginTop: 2 }}>
                      {gangStatus.turfName} · {gangStatus.memberCountOnline} online
                    </div>
                  )}
                </div>
              </div>

              {/* Turf / hangout status */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize:     9,
                    letterSpacing: 0.8,
                    padding:      "2px 7px",
                    borderRadius: 4,
                    background:   nearHangout ? `${GANG_GREEN}22` : "rgba(255,255,255,0.04)",
                    border:       `1px solid ${nearHangout ? GANG_GREEN : "rgba(255,255,255,0.10)"}`,
                    color:        nearHangout ? GANG_LIGHT : "#445",
                  }}
                >
                  {nearHangout ? "● AT HANGOUT" : "○ AWAY FROM HANGOUT"}
                </span>
                <span
                  style={{
                    fontSize:     9,
                    letterSpacing: 0.8,
                    padding:      "2px 7px",
                    borderRadius: 4,
                    background:   nearTurf ? `${GANG_GREEN}22` : "rgba(255,255,255,0.04)",
                    border:       `1px solid ${nearTurf ? GANG_GREEN : "rgba(255,255,255,0.10)"}`,
                    color:        nearTurf ? GANG_LIGHT : "#445",
                  }}
                >
                  {nearTurf ? "● IN TURF" : "○ OUT OF TURF"}
                </span>
              </div>

              {/* Claim presence button */}
              <div>
                <div style={{ fontSize: 10, color: "#556", letterSpacing: 1, marginBottom: 5 }}>
                  GANG ACTIONS
                </div>
                <button
                  onClick={handleClaimPresence}
                  onKeyDown={stopProp}
                  style={btnStyle(nearTurf)}
                  disabled={!nearTurf}
                  title={nearTurf ? "Broadcast your presence in the turf to your crew" : "Must be inside the turf zone"}
                >
                  Claim Presence
                </button>
                {lastAction && (
                  <div style={{ fontSize: 10, color: "#8ab", marginTop: 6 }}>
                    {lastAction}
                  </div>
                )}
              </div>

              {/* Presence log */}
              {gangPresenceEvents.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "#556", letterSpacing: 1, marginBottom: 4 }}>
                    CREW PRESENCE LOG
                  </div>
                  <div
                    style={{
                      maxHeight:    110,
                      overflowY:    "auto",
                      border:       "1px solid rgba(76,175,80,0.12)",
                      borderRadius: 5,
                    }}
                  >
                    {gangPresenceEvents
                      .slice()
                      .reverse()
                      .map((evt, i) => (
                        <div
                          key={`${evt.fromId}-${evt.createdAt}-${i}`}
                          style={{
                            display:       "flex",
                            justifyContent: "space-between",
                            alignItems:    "center",
                            padding:       "3px 7px",
                            borderBottom:  "1px solid rgba(76,175,80,0.06)",
                          }}
                        >
                          <span style={{ fontSize: 10, color: "#cdd" }}>{evt.fromName}</span>
                          <span style={{ fontSize: 9, color: "#4a7a4e", letterSpacing: 0.5 }}>
                            {evt.turfName} · {new Date(evt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* ── Leader: pending join requests ─────────────────────────── */}
              {isLeader && hasPending && (
                <div>
                  <div
                    style={{
                      fontSize:      10,
                      color:         GANG_LIGHT,
                      letterSpacing: 1,
                      marginBottom:  4,
                      display:       "flex",
                      alignItems:    "center",
                      gap:           5,
                    }}
                  >
                    JOIN REQUESTS
                    <span
                      style={{
                        background:   GANG_GREEN,
                        color:        "#0a1a0a",
                        borderRadius: "50%",
                        width:        14,
                        height:       14,
                        display:      "inline-flex",
                        alignItems:   "center",
                        justifyContent: "center",
                        fontSize:     9,
                        fontWeight:   "bold",
                      }}
                    >
                      {gangJoinRequests.length}
                    </span>
                  </div>
                  <div
                    style={{
                      display:       "flex",
                      flexDirection: "column",
                      gap:           4,
                      maxHeight:     130,
                      overflowY:     "auto",
                    }}
                  >
                    {gangJoinRequests.map((req) => (
                      <div
                        key={req.fromId}
                        style={{
                          display:      "flex",
                          alignItems:   "center",
                          justifyContent: "space-between",
                          padding:      "5px 8px",
                          borderRadius: 5,
                          border:       "1px solid rgba(76,175,80,0.18)",
                          background:   "rgba(76,175,80,0.05)",
                          gap:          6,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: "#cdd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {req.fromName}
                          </div>
                          <div style={{ fontSize: 9, color: "#4a7a4e" }}>
                            {new Date(req.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button
                            onClick={() => emitGangJoinResponse(req.fromId, true)}
                            onKeyDown={stopProp}
                            style={{
                              padding:      "3px 9px",
                              borderRadius: 4,
                              border:       `1px solid ${GANG_GREEN}`,
                              background:   `${GANG_GREEN}22`,
                              color:        GANG_GREEN,
                              fontFamily:   "'Courier New', monospace",
                              fontSize:     10,
                              cursor:       "pointer",
                              fontWeight:   "bold",
                            }}
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => emitGangJoinResponse(req.fromId, false)}
                            onKeyDown={stopProp}
                            style={{
                              padding:      "3px 9px",
                              borderRadius: 4,
                              border:       "1px solid rgba(255,82,82,0.4)",
                              background:   "rgba(255,82,82,0.08)",
                              color:        "#ef5350",
                              fontFamily:   "'Courier New', monospace",
                              fontSize:     10,
                              cursor:       "pointer",
                              fontWeight:   "bold",
                            }}
                          >
                            ✗
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Non-member view: join button / pending state */
            <div
              style={{
                padding:      "14px 12px",
                textAlign:    "center",
                borderRadius: 6,
                border:       "1px solid rgba(76,175,80,0.12)",
                background:   "rgba(76,175,80,0.03)",
              }}
            >
              <div style={{ fontSize: 18, marginBottom: 8 }}>
                {gangJoinRequestSent ? "⏳" : nearHangout ? "🏠" : "🔒"}
              </div>
              <div style={{ fontSize: 11, color: "#667", lineHeight: 1.6 }}>
                Grove Street Families
              </div>

              {gangJoinRequestSent ? (
                /* Request already sent — show pending state */
                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      padding:      "6px 10px",
                      borderRadius: 5,
                      border:       "1px solid rgba(76,175,80,0.25)",
                      background:   "rgba(76,175,80,0.07)",
                      fontSize:     10,
                      color:        GANG_LIGHT,
                    }}
                  >
                    Request sent to {gangJoinRequestSent.factionName}.<br />
                    <span style={{ color: "#4a7a4e" }}>Waiting for a leader to respond…</span>
                  </div>
                </div>
              ) : nearHangout ? (
                /* Near hangout — show join button */
                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={() => emitGangJoinRequest("grove_street")}
                    onKeyDown={stopProp}
                    style={{
                      padding:      "7px 16px",
                      borderRadius: 5,
                      border:       `1px solid ${GANG_GREEN}`,
                      background:   `${GANG_GREEN}22`,
                      color:        GANG_GREEN,
                      fontFamily:   "'Courier New', monospace",
                      fontSize:     11,
                      cursor:       "pointer",
                      fontWeight:   "bold",
                      letterSpacing: 0.5,
                    }}
                  >
                    Request to Join Grove Street
                  </button>
                  <div style={{ fontSize: 9, color: "#334", marginTop: 6 }}>
                    A leader must accept your request.
                  </div>
                </div>
              ) : (
                /* Not near hangout — show locked state */
                <div>
                  <div style={{ fontSize: 10, color: "#334", marginTop: 8 }}>
                    Visit the Grove Street hangout to request membership.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hint footer */}
          <div style={{ fontSize: 9, color: "#334", textAlign: "center", paddingTop: 2 }}>
            ESC / G to close
          </div>
        </div>
      </div>
    </div>
  );
}
