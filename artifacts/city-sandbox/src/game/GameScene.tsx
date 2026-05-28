import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import { configureWorldRenderer } from "./rendererConfig";
import type { VehicleState } from "../shared/types";
import type { NpcStumbleMap } from "../shared/collision";
import type { RpProfile, RpToast, RpPendingFine, RpFactionMessage, FactionSummary, OnlinePlayerFactionSummary, GangStatus, GangPresenceEvent } from "../shared/rpTypes";
import { POLICE_WARRANT_RADIUS, POLICE_ARREST_RADIUS, POLICE_CUFF_RADIUS, POLICE_BOOKING_DESK_POS, POLICE_BOOKING_RADIUS, POLICE_FINE_RADIUS, GROVE_STREET_HANGOUT_POS, GROVE_STREET_HANGOUT_RADIUS, GROVE_STREET_TURF_CENTER, GROVE_STREET_TURF_RADIUS } from "../shared/rpTypes";
import CityMap from "./CityMap";
import LocalPlayer, { Controls } from "./LocalPlayer";
import LicenseTestHUD from "./LicenseTestHUD";
import JobHUD from "./JobHUD";
import VehicleShopHUD from "./VehicleShopHUD";
import ATMHUD from "./ATMHUD";
import { IssueFinePanel, PendingFineOverlay } from "./FineHUD";
import FactionChatHUD from "./FactionChatHUD";
import FactionAdminHUD from "./FactionAdminHUD";
import GangHUD from "./GangHUD";
import RemotePlayer from "./RemotePlayer";
import VehicleObject from "./VehicleObject";
import CheckpointRace from "./CheckpointRace";
import HUD from "./HUD";
import RPMarkers from "./RPMarkers";
import RPHud from "./RPHud";
import NPCs from "./NPCs";
import AmbientTraffic from "./AmbientTraffic";
import BiomeRender from "./BiomeRender";
import DayNightController from "./DayNightController";
import { PerfMonitor, PerfOverlay } from "./PerfHUD";
import { dayNightRuntime, type DayPhase } from "../shared/timeOfDay";

const KEY_MAP = [
  { name: Controls.forward,      keys: ["ArrowUp",    "KeyW"] },
  { name: Controls.back,         keys: ["ArrowDown",  "KeyS"] },
  { name: Controls.left,         keys: ["ArrowLeft",  "KeyA"] },
  { name: Controls.right,        keys: ["ArrowRight", "KeyD"] },
  { name: Controls.jump,         keys: ["Space"] },
  { name: Controls.run,          keys: ["ShiftLeft", "ShiftRight"] },
  { name: Controls.interact,     keys: ["KeyE"] },
  // Combat. KeyboardControls only handles keys; mouse buttons (Mouse0
  // for light, Mouse2 for heavy) are listened to separately inside
  // LocalPlayer's pointer-lock effect.
  { name: Controls.attackLight,  keys: ["KeyF"] },
  { name: Controls.attackHeavy,  keys: ["KeyR"] },
  { name: Controls.lockVehicle,  keys: ["KeyL"] },
];

interface GameSceneProps {
  myId: string;
  username: string;
  playerCount: number;
  connected: boolean;
  gameState: { players: Record<string, import("../shared/types").PlayerState>; vehicles: Record<string, VehicleState> };
  setGameState: React.Dispatch<React.SetStateAction<{ players: Record<string, import("../shared/types").PlayerState>; vehicles: Record<string, VehicleState> }>>;
  emitPlayerUpdate: (data: object) => void;
  emitVehicleUpdate: (data: object) => void;
  // RP layer — provided by Game.tsx via useRpSocket, which attaches listeners
  // before the myId/ready guard so rp:profile is never missed on join.
  rpProfile:       RpProfile | null;
  rpToasts:        RpToast[];
  dismissToast:    (id: number) => void;
  /** Push a local toast without a server round-trip (e.g. blocked vehicle entry). */
  pushToast:       (msg: string, color: string, duration?: number) => void;
  canDriveVehicle: (vehicleId: string) => boolean;
  /** Emit rp:interact (e.g. start_driver_test). From useRpSocket. */
  emitRpInteract:  (building: string, action: string) => void;
  /** Emit rp:licenseTestCheckpoint. From useRpSocket. */
  emitLicenseCheckpoint: (idx: number) => void;
  /** Phase 3: Emit rp:buyVehicle. From useRpSocket. */
  emitBuyVehicle:  (model: string, variant: string, color: string) => void;
  /** Phase 3: Emit rp:toggleLock. From useRpSocket. */
  emitToggleLock:  (vehicleId: string) => void;
  /** Phase 4: Emit rp:toggleDuty. From useRpSocket. */
  emitToggleDuty:  (job: string) => void;
  /** Phase 4: Emit rp:jobCheckpoint. From useRpSocket. */
  emitJobCheckpoint: (idx: number) => void;
  /** Phase 5F: Emit rp:bankDeposit. From useRpSocket. */
  emitBankDeposit: (amount: number) => void;
  /** Phase 5F: Emit rp:bankWithdraw. From useRpSocket. */
  emitBankWithdraw: (amount: number) => void;
  /** Phase 6A: Emit rp:issueWarrant — officer issues a warrant. */
  emitIssueWarrant: (targetId: string, stars: number, reason: string) => void;
  /** Phase 6A: Emit rp:arrest — officer arrests a wanted player. */
  emitArrest: (targetId: string) => void;
  /** Phase 6B: map of socketId → wantedStars for all players. */
  wantedByPlayerId: Record<string, number>;
  /**
   * Phase 6C: map of socketId → { cuffedBy, cuffedUntil } for all cuffed players.
   * Used to render cuff indicators and gate I-key uncuff.
   */
  cuffedPlayers: Record<string, { cuffedBy: string; cuffedUntil: number | null }>;
  /** Phase 6C: Emit rp:cuff — officer cuffs a nearby wanted player. */
  emitCuff: (targetId: string) => void;
  /** Phase 6C: Emit rp:uncuff — officer releases a cuffed player. */
  emitUncuff: (targetId: string) => void;
  /** Phase 6E: Pending fine issued by an officer to this player (from useRpSocket). */
  pendingFine: RpPendingFine | null;
  /** Phase 6E: Emit rp:issueFine — officer issues a fine to a nearby player. */
  emitIssueFine: (targetId: string, amount: number, reason: string) => void;
  /** Phase 6E: Emit rp:respondFine — target accepts or rejects a pending fine. */
  emitRespondFine: (accept: boolean) => void;
  /** Phase 7A: Faction chat history (max 20), from useRpSocket. */
  factionMessages: RpFactionMessage[];
  /** Phase 7A: Emit rp:factionChat — sends a message to faction members. */
  emitFactionChat: (msg: string) => void;
  /** Phase 7C: Full list of seeded factions (for FactionAdminHUD). */
  factions: FactionSummary[];
  /** Phase 7C: Online player faction summaries (for FactionAdminHUD). */
  onlineFactionPlayers: OnlinePlayerFactionSummary[];
  /** Phase 7C: Emit rp:listFactions. */
  emitListFactions: () => void;
  /** Phase 7C: Emit rp:listOnlinePlayers. */
  emitListOnlinePlayers: () => void;
  /** Phase 7C: Emit rp:adminSetFaction — DEV-ONLY. */
  emitAdminSetFaction: (targetId: string, factionSlug: string, rank: number) => void;
  /** Phase 7D: Gang status for the local player. */
  gangStatus: GangStatus | null;
  /** Phase 7D: Rolling log of presence events from gang members. */
  gangPresenceEvents: GangPresenceEvent[];
  /** Phase 7D: Request gang status from server. */
  emitGangStatus: () => void;
  /** Phase 7D: Emit a gang action (e.g. "claim_presence") for server validation. */
  emitGangAction: (action: string) => void;
  /** Phase 7E: Pending join requests visible to gang leaders. */
  gangJoinRequests: import("../shared/rpTypes").GangJoinRequest[];
  /** Phase 7E: Result of a join request (accepted / rejected). */
  gangJoinResult: import("../shared/rpTypes").GangJoinResult | null;
  /** Phase 7E: Confirmation that a join request was sent. */
  gangJoinRequestSent: import("../shared/rpTypes").GangJoinRequestSent | null;
  /** Phase 7E: Emit rp:gangJoinRequest for a given faction slug. */
  emitGangJoinRequest: (factionSlug: string) => void;
  /** Phase 7E: Emit rp:gangJoinResponse (leader accept/reject). */
  emitGangJoinResponse: (targetSocketId: string, accept: boolean) => void;
  /** Phase 7E: Clear the gangJoinResult toast. */
  dismissGangJoinResult: () => void;
}

export default function GameScene({
  myId,
  username,
  playerCount,
  connected,
  gameState,
  setGameState,
  emitPlayerUpdate,
  emitVehicleUpdate,
  rpProfile,
  rpToasts,
  dismissToast,
  pushToast,
  canDriveVehicle,
  emitRpInteract,
  emitLicenseCheckpoint,
  emitBuyVehicle,
  emitToggleLock,
  emitToggleDuty,
  emitJobCheckpoint,
  emitBankDeposit,
  emitBankWithdraw,
  emitIssueWarrant,
  emitArrest,
  wantedByPlayerId,
  cuffedPlayers,
  emitCuff,
  emitUncuff,
  pendingFine,
  emitIssueFine,
  emitRespondFine,
  factionMessages,
  emitFactionChat,
  factions,
  onlineFactionPlayers,
  emitListFactions,
  emitListOnlinePlayers,
  emitAdminSetFaction,
  gangStatus,
  gangPresenceEvents,
  emitGangStatus,
  emitGangAction,
  gangJoinRequests,
  gangJoinResult,
  gangJoinRequestSent,
  emitGangJoinRequest,
  emitGangJoinResponse,
  dismissGangJoinResult,
}: GameSceneProps) {
  const [uiState, setUIState] = useState({
    health: 100,
    speed: 0,
    inVehicle: false,
    showInteract: false,
    vehicleLabel: "",
    raceActive: false,
    raceTime: 0,
    racePassed: [] as number[],
    px: 0,
    pz: 0,
    nearOffice: false,
    nearDealership: false,
    nearOwnedVehicleId: null as string | null,
    nearDepot: false,
    nearTaxiDepot: false,
    nearDeliveryHub: false,
    nearMechanicGarage: false,
    nearMedicCenter: false,
    nearPoliceStation: false,
    nearATM: false,
    nearBookingDesk: false,
  });

  // Phase 3: dealership shop panel visibility
  const [showShop, setShowShop] = useState(false);
  // Phase 5F: ATM panel visibility
  const [showATM, setShowATM] = useState(false);
  // Phase 6E: Issue Fine panel visibility (officer side)
  const [showFinePanel, setShowFinePanel] = useState(false);

  // Stable refs for modal state — read inside the J/K keydown handler
  // (registered once with empty deps) without stale closure issues.
  const showShopRef = useRef(showShop);
  showShopRef.current = showShop;
  const showATMRef = useRef(showATM);
  showATMRef.current = showATM;
  const showFinePanelRef = useRef(showFinePanel);
  showFinePanelRef.current = showFinePanel;
  // Phase 7A: faction chat panel visibility
  const [showFactionChat, setShowFactionChat] = useState(false);
  const showFactionChatRef = useRef(showFactionChat);
  showFactionChatRef.current = showFactionChat;
  // Phase 7C: faction admin panel visibility (dev-only)
  const [showFactionAdmin, setShowFactionAdmin] = useState(false);
  const showFactionAdminRef = useRef(showFactionAdmin);
  showFactionAdminRef.current = showFactionAdmin;
  // Phase 7D: gang HUD visibility
  const [showGangHUD, setShowGangHUD] = useState(false);
  const showGangHUDRef = useRef(showGangHUD);
  showGangHUDRef.current = showGangHUD;
  // P2: G key may only open when player is a gang member OR near the hangout.
  // These refs are written during render so the keydown handler (stable closure)
  // can read them without re-registering the listener.
  const isGangMemberRef      = useRef(false);
  const nearGangHangoutRef   = useRef(false);

  const playerPosRef = useRef(new THREE.Vector3(0, 1, 0));
  const wrapperRef = useRef<HTMLDivElement>(null);

  // World clock for the HUD chip. DayNightController writes to a
  // module-level runtime ref every frame; we poll it once a second
  // so the HUD only re-renders ~60 times per game-day instead of
  // 60 times per real second.
  const [clock, setClock] = useState<{ label: string; phase: DayPhase }>({
    label: "--:--",
    phase: "DAY",
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (!dayNightRuntime.ready) return;
      setClock((prev) => {
        if (
          prev.label === dayNightRuntime.label &&
          prev.phase === dayNightRuntime.phase
        ) {
          return prev;
        }
        return { label: dayNightRuntime.label, phase: dayNightRuntime.phase };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Shared map of NPC stumble entries. LocalPlayer writes when its
  // driven car hits a pedestrian; NPCs.tsx reads each frame to apply a
  // decaying lateral knockback + tilt. Local-only — never networked.
  const npcStumbleRef = useRef<NpcStumbleMap>(new Map());

  // Authoritative spawn position from the server's gameState. Computed once
  // on first mount of LocalPlayer (initialSpawn is only read in useRef
  // initializer), so this doesn't need to react to subsequent updates.
  const initialSpawn = useMemo<[number, number, number] | undefined>(() => {
    const me = gameState.players[myId];
    if (!me) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          `[city-sandbox] GameScene mounted with no server player record ` +
            `for myId=${myId}. Falling back to deterministic local spawn. ` +
            `This usually means the join order changed in useSocket.`
        );
      }
      return undefined;
    }
    return [me.x, me.y, me.z];
    // We intentionally only depend on myId — gameState.players changes
    // every frame and we only want the server's first authoritative spawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  // Make sure keyboard input reaches the iframe / window. Replit's preview
  // pane is an iframe, and key events only fire when that iframe's window
  // has focus. We focus the wrapper on mount and on every click so WASD
  // works after the user clicks the game once.
  useEffect(() => {
    wrapperRef.current?.focus();
    try {
      window.focus();
    } catch {
      // Some embedding contexts disallow programmatic window.focus(); ignore.
    }
  }, []);

  const handleWrapperPointerDown = useCallback((e: React.PointerEvent) => {
    // Don't steal focus from input fields, textareas, or contenteditable
    // elements — future overlays (chat, settings) need to receive typed
    // text without us yanking focus back to the wrapper.
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
    }
    wrapperRef.current?.focus();
    try {
      window.focus();
    } catch {
      // Ignore — see above.
    }
  }, []);

  const handleVehicleUpdate = useCallback((id: string, patch: Partial<VehicleState>) => {
    setGameState(prev => ({
      ...prev,
      vehicles: {
        ...prev.vehicles,
        [id]: { ...prev.vehicles[id], ...patch },
      },
    }));
  }, [setGameState]);

  const remotePlayers = Object.values(gameState.players).filter(
    (p) => p.id !== myId
  );

  const drivingVehicleId = uiState.inVehicle
    ? Object.values(gameState.vehicles).find(v => v.driverId === myId)?.id
    : undefined;

  // Phase 6A/6B/6C: stable refs so the J/K/U/I keydown handler always reads current
  // values without needing to be re-registered every render.
  const myIdRef = useRef(myId);
  myIdRef.current = myId;
  const remotePlayersRef = useRef(remotePlayers);
  remotePlayersRef.current = remotePlayers;
  const rpProfileRef = useRef(rpProfile);
  rpProfileRef.current = rpProfile;
  const emitIssueWarrantRef = useRef(emitIssueWarrant);
  emitIssueWarrantRef.current = emitIssueWarrant;
  const emitArrestRef = useRef(emitArrest);
  emitArrestRef.current = emitArrest;
  // Phase 6B: needed to gate K-key on actual wanted stars.
  const wantedByPlayerIdRef = useRef(wantedByPlayerId);
  wantedByPlayerIdRef.current = wantedByPlayerId;
  // Phase 6C: stable refs for U/I cuff keys.
  const cuffedPlayersRef = useRef(cuffedPlayers);
  cuffedPlayersRef.current = cuffedPlayers;
  const emitCuffRef = useRef(emitCuff);
  emitCuffRef.current = emitCuff;
  const emitUncuffRef = useRef(emitUncuff);
  emitUncuffRef.current = emitUncuff;
  // Phase 6E: stable ref for H-key fine emit.
  const emitIssueFineRef = useRef(emitIssueFine);
  emitIssueFineRef.current = emitIssueFine;

  // Phase 6A/6B: J/K police action keys.
  // J = Issue 1★ warrant against the nearest player within POLICE_WARRANT_RADIUS.
  // K = Arrest the nearest WANTED player within POLICE_ARREST_RADIUS.
  // Safety guards: ignore repeated events, ignore while typing, ignore while modal is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.code !== "KeyJ" &&
        e.code !== "KeyK" &&
        e.code !== "KeyU" &&
        e.code !== "KeyI" &&
        e.code !== "KeyH" &&
        e.code !== "KeyY" &&
        e.code !== "KeyG" &&
        e.code !== "F7"
      ) return;
      // Ignore key-repeat (held key firing continuously).
      if (e.repeat) return;
      // Ignore while the user is typing in an input/textarea/contenteditable.
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable) return;
      }
      // Ignore while any modal overlay is open.
      // F7 is exempted only when it is closing the admin panel (toggle-off path).
      const anyModalOpen =
        showShopRef.current ||
        showATMRef.current ||
        showFinePanelRef.current ||
        showFactionChatRef.current ||
        showFactionAdminRef.current ||
        showGangHUDRef.current;

      // Phase 7C: F7 toggles faction admin panel (dev-only).
      // Opens only when no other modal is open; always allowed to close itself.
      if (e.code === "F7") {
        if (import.meta.env.DEV) {
          if (showFactionAdminRef.current) {
            // Close — always allowed.
            setShowFactionAdmin(false);
          } else if (!anyModalOpen) {
            // Open — only when no other modal is blocking.
            setShowFactionAdmin(true);
          }
        }
        return;
      }

      // Phase 7D: G toggles gang HUD.
      // Close is always allowed.
      // Open: only when no modal is blocking AND (player is a gang member OR near the hangout).
      if (e.code === "KeyG") {
        if (showGangHUDRef.current) {
          setShowGangHUD(false); // close — always allowed
        } else if (!anyModalOpen && (isGangMemberRef.current || nearGangHangoutRef.current)) {
          setShowGangHUD(true);
        }
        return;
      }

      if (anyModalOpen) return;

      // Phase 7A: Y toggles faction chat regardless of job/duty status.
      if (e.code === "KeyY") {
        setShowFactionChat((prev) => !prev);
        return;
      }

      const profile = rpProfileRef.current;
      if (!profile?.onDuty || profile.currentJob !== "police_patrol") return;
      if (profile.jailUntil !== null && profile.jailUntil !== undefined) return;

      const pos     = playerPosRef.current;
      const players = remotePlayersRef.current;

      if (e.code === "KeyJ") {
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        for (const p of players) {
          const dx = p.x - pos.x;
          const dz = p.z - pos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= POLICE_WARRANT_RADIUS && dist < nearestDist) {
            nearestDist = dist;
            nearestId   = p.id;
          }
        }
        if (nearestId) emitIssueWarrantRef.current(nearestId, 1, "Failure to comply");
        return;
      }

      if (e.code === "KeyK") {
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        const wanted = wantedByPlayerIdRef.current;
        for (const p of players) {
          // Only target players with active wanted stars.
          if ((wanted[p.id] ?? 0) <= 0) continue;
          const dx = p.x - pos.x;
          const dz = p.z - pos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= POLICE_ARREST_RADIUS && dist < nearestDist) {
            nearestDist = dist;
            nearestId   = p.id;
          }
        }
        if (nearestId) emitArrestRef.current(nearestId);
        return;
      }

      if (e.code === "KeyU") {
        // U = Cuff nearest wanted (not already cuffed) player in cuff radius.
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        const wanted  = wantedByPlayerIdRef.current;
        const cuffed  = cuffedPlayersRef.current;
        for (const p of players) {
          if ((wanted[p.id] ?? 0) <= 0) continue;  // must be wanted
          if (cuffed[p.id])             continue;  // already cuffed
          const dx = p.x - pos.x;
          const dz = p.z - pos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= POLICE_CUFF_RADIUS && dist < nearestDist) {
            nearestDist = dist;
            nearestId   = p.id;
          }
        }
        if (nearestId) emitCuffRef.current(nearestId);
        return;
      }

      if (e.code === "KeyI") {
        // I = Uncuff nearest player cuffed BY THIS officer (socket.id match).
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        const cuffed    = cuffedPlayersRef.current;
        const localId   = myIdRef.current;
        for (const p of players) {
          const cuffState = cuffed[p.id];
          if (!cuffState || cuffState.cuffedBy !== localId) continue;
          const dx = p.x - pos.x;
          const dz = p.z - pos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= POLICE_CUFF_RADIUS && dist < nearestDist) {
            nearestDist = dist;
            nearestId   = p.id;
          }
        }
        if (nearestId) emitUncuffRef.current(nearestId);
        return;
      }

      if (e.code === "KeyH") {
        // H = Open Issue Fine panel for the nearest player within POLICE_FINE_RADIUS.
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        for (const p of players) {
          const dx = p.x - pos.x;
          const dz = p.z - pos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= POLICE_FINE_RADIUS && dist < nearestDist) {
            nearestDist = dist;
            nearestId   = p.id;
          }
        }
        if (nearestId) setShowFinePanel(true);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty — all state accessed via refs above.

  // Phase 6A/6B: officer state — computed each render.
  const isOfficerOnDuty =
    rpProfile?.onDuty === true &&
    rpProfile.currentJob === "police_patrol" &&
    !rpProfile.jailUntil;

  // Nearest player within warrant range (any player, regardless of wanted status).
  const nearPoliceTarget: { id: string; name: string; dist: number } | null = (() => {
    if (!isOfficerOnDuty || uiState.inVehicle) return null;
    let best: { id: string; name: string; dist: number } | null = null;
    for (const p of remotePlayers) {
      const dx = p.x - playerPosRef.current.x;
      const dz = p.z - playerPosRef.current.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= POLICE_WARRANT_RADIUS && (!best || dist < best.dist)) {
        best = { id: p.id, name: (p as { username?: string }).username ?? p.id, dist };
      }
    }
    return best;
  })();

  // Nearest WANTED player within arrest range (must have wantedStars > 0).
  const nearArrestTarget: { id: string; name: string; dist: number; stars: number } | null = (() => {
    if (!isOfficerOnDuty || uiState.inVehicle) return null;
    let best: { id: string; name: string; dist: number; stars: number } | null = null;
    for (const p of remotePlayers) {
      const stars = wantedByPlayerId[p.id] ?? 0;
      if (stars <= 0) continue;
      const dx = p.x - playerPosRef.current.x;
      const dz = p.z - playerPosRef.current.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= POLICE_ARREST_RADIUS && (!best || dist < best.dist)) {
        best = { id: p.id, name: (p as { username?: string }).username ?? p.id, dist, stars };
      }
    }
    return best;
  })();

  // Phase 6C: Nearest WANTED (not yet cuffed) player within cuff radius.
  const nearCuffTarget: { id: string; name: string; dist: number; stars: number } | null = (() => {
    if (!isOfficerOnDuty || uiState.inVehicle) return null;
    let best: { id: string; name: string; dist: number; stars: number } | null = null;
    for (const p of remotePlayers) {
      const stars = wantedByPlayerId[p.id] ?? 0;
      if (stars <= 0) continue;
      if (cuffedPlayers[p.id]) continue;  // already cuffed by someone
      const dx = p.x - playerPosRef.current.x;
      const dz = p.z - playerPosRef.current.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= POLICE_CUFF_RADIUS && (!best || dist < best.dist)) {
        best = { id: p.id, name: (p as { username?: string }).username ?? p.id, dist, stars };
      }
    }
    return best;
  })();

  // Phase 6C: Nearest player cuffed BY THIS officer within cuff radius.
  const nearUncuffTarget: { id: string; name: string; dist: number } | null = (() => {
    if (!isOfficerOnDuty || uiState.inVehicle) return null;
    let best: { id: string; name: string; dist: number } | null = null;
    for (const p of remotePlayers) {
      const cuffState = cuffedPlayers[p.id];
      if (!cuffState || cuffState.cuffedBy !== myId) continue;
      const dx = p.x - playerPosRef.current.x;
      const dz = p.z - playerPosRef.current.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= POLICE_CUFF_RADIUS && (!best || dist < best.dist)) {
        best = { id: p.id, name: (p as { username?: string }).username ?? p.id, dist };
      }
    }
    return best;
  })();

  // Phase 6D: Cuffed suspect (by this officer) near the Booking Desk.
  // Checks desk position, not officer position — confirms the suspect was
  // actually escorted there before showing the "K — Book" prompt.
  const nearBookingTarget: { id: string; name: string } | null = (() => {
    if (!isOfficerOnDuty || !uiState.nearBookingDesk || uiState.inVehicle) return null;
    const [bdX, , bdZ] = POLICE_BOOKING_DESK_POS;
    for (const p of remotePlayers) {
      const cuffState = cuffedPlayers[p.id];
      if (!cuffState || cuffState.cuffedBy !== myId) continue;
      const dx = p.x - bdX;
      const dz = p.z - bdZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= POLICE_BOOKING_RADIUS) {
        return { id: p.id, name: (p as { username?: string }).username ?? p.id };
      }
    }
    return null;
  })();

  // Phase 6E: Nearest player within POLICE_FINE_RADIUS (any player, no warrant needed).
  // Used for the H-key HUD prompt; the H-key handler also reads this to decide
  // which target to open the IssueFinePanel for.
  const nearFineTarget: { id: string; name: string; dist: number } | null = (() => {
    if (!isOfficerOnDuty || uiState.inVehicle) return null;
    let best: { id: string; name: string; dist: number } | null = null;
    for (const p of remotePlayers) {
      const dx = p.x - playerPosRef.current.x;
      const dz = p.z - playerPosRef.current.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= POLICE_FINE_RADIUS && (!best || dist < best.dist)) {
        best = { id: p.id, name: (p as { username?: string }).username ?? p.id, dist };
      }
    }
    return best;
  })();

  // Phase 7D: proximity checks for gang hangout and turf ring.
  const nearGangHangout = (() => {
    const pos = playerPosRef.current;
    const [hx, , hz] = GROVE_STREET_HANGOUT_POS;
    const dx = pos.x - hx;
    const dz = pos.z - hz;
    return Math.sqrt(dx * dx + dz * dz) <= GROVE_STREET_HANGOUT_RADIUS;
  })();
  const nearGangTurf = (() => {
    const pos = playerPosRef.current;
    const [tx, , tz] = GROVE_STREET_TURF_CENTER;
    const dx = pos.x - tx;
    const dz = pos.z - tz;
    return Math.sqrt(dx * dx + dz * dz) <= GROVE_STREET_TURF_RADIUS;
  })();
  // P2: keep refs in sync so the stable G-key handler can gate HUD open.
  nearGangHangoutRef.current  = nearGangHangout;
  isGangMemberRef.current     = rpProfile?.factionType === "gang";

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      onPointerDown={handleWrapperPointerDown}
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        background: "#0a0a1a",
        outline: "none",
      }}
    >
      <KeyboardControls map={KEY_MAP}>
        <Canvas
          shadows
          dpr={[1, 1.5]}
          gl={{ powerPreference: "high-performance", antialias: false, stencil: false }}
          camera={{ fov: 75, near: 0.1, far: 1500, position: [0, 8, 15] }}
          style={{ width: "100%", height: "100%" }}
          onCreated={({ gl }) => configureWorldRenderer(gl)}
        >
          {/* Global lighting + sky + fog + sun/moon — owned by the
              DayNightController, which keeps exactly one shadow-
              casting directional light (sun by day, moon by night)
              and writes a runtime snapshot the lamps + point lights
              + HUD ticker all read from. The previous static
              hemi/dir/ambient lights and CityMap's static skybox/
              fog have moved into this single component. */}
          <DayNightController />

          <CityMap />
          <BiomeRender />

          {/* Ambient life — pedestrians and AI traffic. Both client-only,
              deterministic from Date.now(), so no Socket.io traffic. */}
          <NPCs stumbleRef={npcStumbleRef} />
          <AmbientTraffic />

          {/* Remote players */}
          {remotePlayers.map((p) => (
            <RemotePlayer key={p.id} state={p} isCuffed={!!cuffedPlayers[p.id]} />
          ))}

          {/* Remote vehicles (not driven by local player) */}
          {Object.values(gameState.vehicles).map((v) => {
            const isLocalDriver = v.id === drivingVehicleId;
            if (isLocalDriver) return null;
            // Hide vehicle driven by a remote player (remote player component shows it)
            return (
              <VehicleObject
                key={v.id}
                state={v}
                isLocalDriverVehicle={false}
              />
            );
          })}

          {/* Checkpoint race gates */}
          <CheckpointRace
            playerPos={playerPosRef}
            onPass={() => {}}
            passedIds={uiState.racePassed}
            raceActive={uiState.raceActive}
          />

          {/* RP world markers — station platform, licensing office, checkpoint rings, depot */}
          <RPMarkers
            activeTest={rpProfile?.activeTest ?? null}
            activeJob={rpProfile?.activeJob ?? null}
          />

          {/* Local player (manages its own mesh + camera) */}
          <LocalPlayer
            myId={myId}
            username={username}
            vehicles={gameState.vehicles}
            onVehicleUpdate={handleVehicleUpdate}
            emitPlayerUpdate={emitPlayerUpdate}
            emitVehicleUpdate={emitVehicleUpdate}
            npcStumbleRef={npcStumbleRef}
            onUIUpdate={setUIState}
            playerPosRef={playerPosRef}
            initialSpawn={initialSpawn}
            canDriveVehicle={canDriveVehicle}
            pushToast={pushToast}
            emitRpInteract={emitRpInteract}
            emitLicenseCheckpoint={emitLicenseCheckpoint}
            activeTest={rpProfile?.activeTest}
            emitToggleLock={emitToggleLock}
            onOpenShop={() => setShowShop(true)}
            onOpenATM={() => setShowATM(true)}
            activeJob={rpProfile?.activeJob ?? null}
            emitToggleDuty={emitToggleDuty}
            emitJobCheckpoint={emitJobCheckpoint}
          />

          <PerfMonitor />
        </Canvas>
      </KeyboardControls>

      <PerfOverlay />

      {/* RP toast overlay — ephemeral rp:toast messages */}
      <RPHud toasts={rpToasts} onDismissToast={dismissToast} />

      {/* License test HUD — top-center overlay during an active driver test */}
      <LicenseTestHUD activeTest={rpProfile?.activeTest ?? null} />

      {/* Phase 4: Job HUD — top-center overlay during an active City Worker route */}
      <JobHUD activeJob={rpProfile?.activeJob ?? null} />

      {/* Phase 3: dealership shop panel */}
      <VehicleShopHUD
        open={showShop}
        rpProfile={rpProfile}
        onClose={() => setShowShop(false)}
        onBuy={(model, variant, color) => {
          emitBuyVehicle(model, variant, color);
          setShowShop(false);
        }}
      />

      {/* Phase 5F: ATM panel */}
      {showATM && (
        <ATMHUD
          cash={rpProfile?.cash ?? 0}
          bank={rpProfile?.bank ?? 0}
          onDeposit={(amount) => { emitBankDeposit(amount); }}
          onWithdraw={(amount) => { emitBankWithdraw(amount); }}
          onClose={() => setShowATM(false)}
        />
      )}

      {/* Phase 6E: Issue Fine panel (officer side) */}
      {showFinePanel && nearFineTarget && (
        <IssueFinePanel
          targetId={nearFineTarget.id}
          targetName={nearFineTarget.name}
          onIssue={(targetId, amount, reason) => {
            emitIssueFineRef.current(targetId, amount, reason);
          }}
          onClose={() => setShowFinePanel(false)}
        />
      )}

      {/* Phase 6E: Pending fine overlay (target side) */}
      {pendingFine && (
        <PendingFineOverlay
          fine={pendingFine}
          onAccept={() => emitRespondFine(true)}
          onReject={() => emitRespondFine(false)}
        />
      )}

      <HUD
        health={uiState.health}
        speed={uiState.speed}
        inVehicle={uiState.inVehicle}
        showInteract={uiState.showInteract}
        vehicleLabel={uiState.vehicleLabel}
        playerCount={playerCount}
        myId={myId}
        username={username}
        raceActive={uiState.raceActive}
        raceTime={uiState.raceTime}
        racePassed={uiState.racePassed}
        playerPositionX={uiState.px}
        playerPositionZ={uiState.pz}
        connected={connected}
        clockLabel={clock.label}
        clockPhase={clock.phase}
        cash={rpProfile?.cash}
        bank={rpProfile?.bank}
        driverLicense={rpProfile?.driverLicense}
        nearOffice={uiState.nearOffice}
        nearDealership={uiState.nearDealership}
        nearOwnedVehicleId={uiState.nearOwnedVehicleId}
        nearDepot={uiState.nearDepot}
        nearTaxiDepot={uiState.nearTaxiDepot}
        nearDeliveryHub={uiState.nearDeliveryHub}
        nearMechanicGarage={uiState.nearMechanicGarage}
        nearMedicCenter={uiState.nearMedicCenter}
        nearPoliceStation={uiState.nearPoliceStation}
        nearATM={uiState.nearATM}
        wantedStars={rpProfile?.wantedStars}
        jailUntil={rpProfile?.jailUntil}
        jailReason={rpProfile?.jailReason}
        isOfficerOnDuty={isOfficerOnDuty}
        nearPoliceTarget={nearPoliceTarget}
        nearArrestTarget={nearArrestTarget}
        nearCuffTarget={nearCuffTarget}
        nearUncuffTarget={nearUncuffTarget}
        cuffedUntil={rpProfile?.cuffedUntil}
        nearBookingDesk={uiState.nearBookingDesk}
        nearBookingTarget={nearBookingTarget}
        nearFineTarget={nearFineTarget}
        factionType={rpProfile?.factionType ?? null}
        factionName={rpProfile?.factionName ?? null}
        factionColor={rpProfile?.factionColor ?? null}
        factionRank={rpProfile?.factionRank ?? undefined}
        showFactionChat={showFactionChat}
        showFactionAdmin={showFactionAdmin}
        showGangHUD={showGangHUD}
      />

      {/* Phase 7A: Faction chat panel */}
      {showFactionChat && (
        <FactionChatHUD
          factionName={rpProfile?.factionName ?? null}
          factionColor={rpProfile?.factionColor ?? null}
          messages={factionMessages}
          onSend={(msg) => emitFactionChat(msg)}
          onClose={() => setShowFactionChat(false)}
        />
      )}

      {/* Phase 7C: Faction admin panel — DEV ONLY; FactionAdminHUD returns null in production */}
      {showFactionAdmin && (
        <FactionAdminHUD
          factions={factions}
          onlinePlayers={onlineFactionPlayers}
          mySocketId={myId}
          onRefreshFactions={emitListFactions}
          onRefreshPlayers={emitListOnlinePlayers}
          onSetFaction={(targetId, factionSlug, rank) => {
            emitAdminSetFaction(targetId, factionSlug, rank);
          }}
          onClose={() => setShowFactionAdmin(false)}
        />
      )}

      {/* Phase 7D: Gang HUD — visible to all players; non-members see locked view */}
      {showGangHUD && (
        <GangHUD
          gangStatus={gangStatus}
          gangPresenceEvents={gangPresenceEvents}
          gangJoinRequests={gangJoinRequests}
          gangJoinResult={gangJoinResult}
          gangJoinRequestSent={gangJoinRequestSent}
          nearHangout={nearGangHangout}
          nearTurf={nearGangTurf}
          emitGangStatus={emitGangStatus}
          emitGangAction={emitGangAction}
          emitGangJoinRequest={emitGangJoinRequest}
          emitGangJoinResponse={emitGangJoinResponse}
          dismissGangJoinResult={dismissGangJoinResult}
          onClose={() => setShowGangHUD(false)}
        />
      )}
    </div>
  );
}
