import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import { configureWorldRenderer } from "./rendererConfig";
import type { VehicleState } from "../shared/types";
import type { NpcStumbleMap } from "../shared/collision";
import type { RpProfile, RpToast, RpPendingFine, RpFactionMessage, FactionSummary, OnlinePlayerFactionSummary, GangStatus, GangPresenceEvent, ActiveGangMission, GangTerritoryStatus, CityAnnouncement, CityConfig, ActiveCityProject, CityDashboard, CityLedger, ReceivedIDCard, PlayerInventory } from "../shared/rpTypes";
import { POLICE_WARRANT_RADIUS, POLICE_ARREST_RADIUS, POLICE_CUFF_RADIUS, POLICE_BOOKING_DESK_POS, POLICE_BOOKING_RADIUS, POLICE_FINE_RADIUS, GROVE_STREET_HANGOUT_POS, GROVE_STREET_HANGOUT_RADIUS, GROVE_STREET_TURF_CENTER, GROVE_STREET_TURF_RADIUS, GOVERNMENT_OFFICE_DOOR, GOVERNMENT_OFFICE_RADIUS, MAYOR_MIN_RANK, ID_SHARE_RADIUS, RP_HOUSES, HOUSE_INTERACT_RADIUS, isInsideHouseFootprint } from "../shared/rpTypes";
import type { HouseInfo } from "../shared/rpTypes";
import CityMap from "./CityMap";
import LocalPlayer, { Controls } from "./LocalPlayer";
import LicenseTestHUD from "./LicenseTestHUD";
import JobHUD from "./JobHUD";
import VehicleShopHUD from "./VehicleShopHUD";
import ATMHUD from "./ATMHUD";
import { IssueFinePanel, PendingFineOverlay } from "./FineHUD";
import FactionChatHUD from "./FactionChatHUD";
import GlobalChatHUD from "./GlobalChatHUD";
import FactionAdminHUD from "./FactionAdminHUD";
import GangHUD from "./GangHUD";
import { GangMissionHUD } from "./GangMissionHUD";
import CityAnnouncementHUD from "./CityAnnouncementHUD";
import CityTaxHUD from "./CityTaxHUD";
import CityBudgetHUD, { type GrantablePlayer } from "./CityBudgetHUD";
import CityProjectsHUD from "./CityProjectsHUD";
import CityDashboardHUD from "./CityDashboardHUD";
import CityLedgerHUD from "./CityLedgerHUD";
import IDCardHUD from "./IDCardHUD";
import ReceivedIDHUD from "./ReceivedIDHUD";
import InventoryHUD from "./InventoryHUD";
import RPBuildings from "./RPBuildings";
import RPHouses from "./RPHouses";
import NemoHood from "./NemoHood";
import EventHall from "./EventHall";
import EventHallHUD from "./EventHallHUD";
import { useHallScreenShare } from "../hooks/useHallScreenShare";
import HouseBuyModal from "./HouseBuyModal";
import RemotePlayer from "./RemotePlayer";
import VehicleObject from "./VehicleObject";
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
  /** Selectable character chosen in the lobby. */
  character?: import("./character/characterCatalog").CharacterId;
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
  /** Phase 7F: Current faction roster (safe fields only). */
  gangRoster: import("../shared/rpTypes").GangRosterMember[];
  /** Phase 7F: Request updated roster from server. */
  emitGangRoster: () => void;
  /** Phase 7F: Promote or demote a member by DB playerId. */
  emitGangSetRank: (targetPlayerId: string, rank: number) => void;
  /** Phase 7F: Remove a member from the faction by DB playerId. */
  emitGangRemoveMember: (targetPlayerId: string) => void;
  /** Phase 7G: Active gang Tag Turf mission state (from useRpSocket). */
  activeGangMission: ActiveGangMission | null;
  /** Phase 7G: Cooldown timestamp for Tag Turf mission; 0 = no cooldown. */
  missionCooldownUntil: number;
  /** Phase 7G: Emit rp:gangMissionStart. */
  emitGangMissionStart: () => void;
  /** Phase 7G: Emit rp:gangMissionCheckpoint. */
  emitGangMissionCheckpoint: (idx: number) => void;
  /** Phase 7H: Current territory status (Grove Street only for now). */
  gangTerritoryStatus:     GangTerritoryStatus | null;
  /** Phase 7H: Request territory status from server. */
  emitGangTerritoryStatus: () => void;
  /** Phase 7H: Emit a territory presence pulse. */
  emitGangTerritoryPulse:  (territoryId: string) => void;
  /** Phase 8A: City announcement history (from useRpSocket). */
  cityAnnouncements: CityAnnouncement[];
  /** Phase 8A: Emit rp:cityAnnounce to broadcast a mayor announcement. */
  emitCityAnnounce: (msg: string) => void;
  /** Phase 8B: Current city tax config from useRpSocket. */
  cityConfig: CityConfig;
  /** Phase 8B: Emit rp:setTaxRate — Mayor sets a new city tax rate. */
  emitSetTaxRate: (rate: number) => void;
  /** Phase 8E: Emit rp:cityGrant — Mayor sends a cash grant to an online player. */
  emitCityGrant: (targetSocketId: string, amount: number, note: string) => void;
  /** Phase 8F: Active city projects from useRpSocket. */
  cityProjects: ActiveCityProject[];
  /** Phase 8F: Emit rp:cityProjectFund — Mayor activates a city project. */
  emitCityProjectFund: (projectId: string) => void;
  /** Phase 8H: Read-only city dashboard snapshot from useRpSocket. */
  cityDashboard: CityDashboard | null;
  /** Phase 8H: Emit rp:getCityDashboard — Mayor requests a fresh snapshot. */
  emitGetCityDashboard: () => void;
  /** Phase 8I: Read-only city ledger snapshot from useRpSocket. */
  cityLedger: CityLedger | null;
  /** Phase 8I: Emit rp:getCityLedger — Mayor requests a fresh ledger. */
  emitGetCityLedger: () => void;
  /** Phase 11B: An ID shown to you, or a police inspection result (from useRpSocket). */
  receivedID: ReceivedIDCard | null;
  /** Phase 11B: Emit rp:showID — show your own public ID to a nearby player. */
  emitShowID: (targetId: string) => void;
  /** Phase 11B: Emit rp:policeInspectID — on-duty officer inspects a nearby ID. */
  emitPoliceInspectID: (targetId: string) => void;
  /** Phase 11B: Dismiss the received-ID panel. */
  dismissReceivedID: () => void;
  /** Phase 11C: The local player's own inventory (read-only, from useRpSocket). */
  playerInventory: PlayerInventory | null;
  /** Phase 11C: Emit rp:getInventory — request the player's own inventory. */
  emitGetInventory: () => void;
  /** Phase 12A: house ownership list (safe payload — no owner UUIDs). */
  houses: HouseInfo[];
  /** Batch B: server-authoritative Nemo Gang membership for this session. */
  nemoGang: { isMember: boolean; gangName: string } | null;
  /** Phase 12A: pending house teleport target for the local player (snap ref). */
  houseTeleportRef: React.MutableRefObject<[number, number, number] | null>;
  /** Phase 12A: Emit rp:getHouses. */
  emitGetHouses: () => void;
  /** Phase 12A: Emit rp:buyHouse — server validates funds + proximity + ownership. */
  emitBuyHouse: (slug: string) => void;
  /** Phase 12A: Emit rp:enterHouse — owner-only entry (server-gated teleport). */
  emitEnterHouse: (slug: string) => void;
  /** Phase 12A: Emit rp:exitHouse — leave the house the player is inside. */
  emitExitHouse: () => void;
  /** Phase comms: rolling global chat messages (from useRpSocket). */
  globalMessages: import("../shared/rpTypes").RpGlobalMessage[];
  /** Phase comms: emit rp:globalChat — send to everyone online. */
  emitGlobalChat: (msg: string) => void;
  /** Phase comms: whether the local mic is currently live. */
  micOn: boolean;
  /** Phase comms: toggle mic on/off (requests permission on first enable). */
  toggleMic: () => void;
  /** Phase comms: true while the local mic is carrying speech (drives Simple talk anim). */
  voiceSpeaking: boolean;
}

export default function GameScene({
  myId,
  username,
  character,
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
  gangRoster,
  emitGangRoster,
  emitGangSetRank,
  emitGangRemoveMember,
  activeGangMission,
  missionCooldownUntil,
  emitGangMissionStart,
  emitGangMissionCheckpoint,
  gangTerritoryStatus,
  emitGangTerritoryStatus,
  emitGangTerritoryPulse,
  cityAnnouncements,
  emitCityAnnounce,
  cityConfig,
  emitSetTaxRate,
  emitCityGrant,
  cityProjects,
  emitCityProjectFund,
  cityDashboard,
  emitGetCityDashboard,
  cityLedger,
  emitGetCityLedger,
  receivedID,
  emitShowID,
  emitPoliceInspectID,
  dismissReceivedID,
  playerInventory,
  emitGetInventory,
  houses,
  nemoGang,
  houseTeleportRef,
  emitGetHouses,
  emitBuyHouse,
  emitEnterHouse,
  emitExitHouse,
  globalMessages,
  emitGlobalChat,
  micOn,
  toggleMic,
  voiceSpeaking,
}: GameSceneProps) {
  const [uiState, setUIState] = useState({
    health: 100,
    speed: 0,
    inVehicle: false,
    showInteract: false,
    vehicleLabel: "",
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
    nearEventHall: false,
    nearSitChair: false,
    isSitting: false,
    nearBoardTrain: false,
    inTrain: false,
    trainCanExit: false,
  });

  // Phase 3: dealership shop panel visibility
  const [showShop, setShowShop] = useState(false);
  // Phase 5F: ATM panel visibility
  const [showATM, setShowATM] = useState(false);
  const [showEventHall, setShowEventHall] = useState(false);
  // Phase 14B: local presenter screen-share onto the hall's giant screen.
  const hallShare = useHallScreenShare();
  // Phase 6E: Issue Fine panel visibility (officer side)
  const [showFinePanel, setShowFinePanel] = useState(false);

  // Stable refs for modal state — read inside the J/K keydown handler
  // (registered once with empty deps) without stale closure issues.
  const showShopRef = useRef(showShop);
  showShopRef.current = showShop;
  const showATMRef = useRef(showATM);
  showATMRef.current = showATM;
  const showEventHallRef = useRef(showEventHall);
  showEventHallRef.current = showEventHall;
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
  // Phase 8A: City Announcement HUD visibility + Mayor/gov-office proximity refs.
  const [showCityAnnouncementHUD, setShowCityAnnouncementHUD] = useState(false);
  const showCityAnnouncementHUDRef = useRef(showCityAnnouncementHUD);
  showCityAnnouncementHUDRef.current = showCityAnnouncementHUD;
  const isMayorRef      = useRef(false);
  const nearGovOfficeRef = useRef(false);
  // Phase 8A: visible announcement banner (shown for 8 s then auto-cleared).
  const [visibleAnnouncement, setVisibleAnnouncement] = useState<CityAnnouncement | null>(null);
  // Phase 8B: City Tax HUD visibility (T key at Government Office, Mayor only).
  const [showCityTaxHUD, setShowCityTaxHUD] = useState(false);
  const showCityTaxHUDRef = useRef(showCityTaxHUD);
  showCityTaxHUDRef.current = showCityTaxHUD;
  // Phase 8E: City Budget / Grant HUD visibility (B key at Government Office, Mayor only).
  const [showCityBudgetHUD, setShowCityBudgetHUD] = useState(false);
  const showCityBudgetHUDRef = useRef(showCityBudgetHUD);
  showCityBudgetHUDRef.current = showCityBudgetHUD;
  // Phase 8F: City Projects HUD visibility (P key at Government Office, Mayor only).
  const [showCityProjectsHUD, setShowCityProjectsHUD] = useState(false);
  const showCityProjectsHUDRef = useRef(showCityProjectsHUD);
  showCityProjectsHUDRef.current = showCityProjectsHUD;
  // Phase 8H: City Dashboard HUD visibility (D key at Government Office, Mayor only).
  const [showCityDashboardHUD, setShowCityDashboardHUD] = useState(false);
  const showCityDashboardHUDRef = useRef(showCityDashboardHUD);
  showCityDashboardHUDRef.current = showCityDashboardHUD;
  // Phase 8I: City Ledger HUD visibility (L key at Government Office, Mayor only).
  const [showCityLedgerHUD, setShowCityLedgerHUD] = useState(false);
  const showCityLedgerHUDRef = useRef(showCityLedgerHUD);
  showCityLedgerHUDRef.current = showCityLedgerHUD;
  // Phase 11A: ID/wallet card HUD visibility (C key, anywhere).
  const [showIDCard, setShowIDCard] = useState(false);
  const showIDCardRef = useRef(showIDCard);
  showIDCardRef.current = showIDCard;
  // Phase comms: global chat panel visibility (T key, anywhere).
  const [showGlobalChat, setShowGlobalChat] = useState(false);
  const showGlobalChatRef = useRef(showGlobalChat);
  showGlobalChatRef.current = showGlobalChat;
  // Phase comms: stable ref for the mic toggle (read inside the empty-deps handler).
  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;
  // Phase 11C: inventory HUD visibility (O key, anywhere).
  const [showInventory, setShowInventory] = useState(false);
  const showInventoryRef = useRef(showInventory);
  showInventoryRef.current = showInventory;
  // Phase 11C: stable ref for the inventory fetch emitter (used in keydown handler).
  const emitGetInventoryRef = useRef(emitGetInventory);
  emitGetInventoryRef.current = emitGetInventory;
  // Phase 11B/11C: track whether the received-ID / police-inspection panel is
  // visible so the keydown guard can block opening other modals over it.
  const receivedIDOpenRef = useRef(receivedID !== null);
  receivedIDOpenRef.current = receivedID !== null;

  // Phase 12A: house purchase confirmation modal.
  const [showHouseBuy, setShowHouseBuy] = useState(false);
  const showHouseBuyRef = useRef(showHouseBuy);
  showHouseBuyRef.current = showHouseBuy;
  const [houseBuyTarget, setHouseBuyTarget] = useState<HouseInfo | null>(null);
  // Stable refs read inside the empty-deps keydown handler.
  const housesRef = useRef(houses);
  housesRef.current = houses;
  const emitEnterHouseRef = useRef(emitEnterHouse);
  emitEnterHouseRef.current = emitEnterHouse;
  const emitExitHouseRef = useRef(emitExitHouse);
  emitExitHouseRef.current = emitExitHouse;
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;
  // Phase 12A: track vehicle state for the on-foot house gate (server also enforces).
  const inVehicleRef = useRef(false);
  inVehicleRef.current = uiState.inVehicle;

  // Phase 12A: fetch the house ownership list once on mount (server also pushes
  // it on join; this covers hot-reload / late mounts).
  useEffect(() => {
    emitGetHouses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Phase 11B: stable ref for V-key officer ID inspection emit.
  const emitPoliceInspectIDRef = useRef(emitPoliceInspectID);
  emitPoliceInspectIDRef.current = emitPoliceInspectID;

  // Phase 6A/6B + comms: J/K/T/Y action keys.
  // J       = Issue 1★ warrant against the nearest player within POLICE_WARRANT_RADIUS.
  // K       = Toggle the proximity-voice MIC (universal). SHIFT+K = police arrest.
  // T       = Toggle the GLOBAL chat panel (universal). SHIFT+T = Mayor tax panel.
  // Y       = Faction chat (unchanged).
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
        e.code !== "KeyE" &&  // Phase 8A: E at Gov Office for Mayor city announcement
        e.code !== "KeyT" &&  // Phase 8B: T at Gov Office for Mayor tax rate
        e.code !== "KeyB" &&  // Phase 8E: B at Gov Office for Mayor city grant
        e.code !== "KeyP" &&  // Phase 8F: P at Gov Office for Mayor city project
        e.code !== "KeyD" &&  // Phase 8H: D at Gov Office for Mayor city dashboard
        e.code !== "KeyL" &&  // Phase 8I: L at Gov Office for Mayor city ledger
        e.code !== "KeyC" &&  // Phase 11A: C opens the ID/wallet card (anywhere)
        e.code !== "KeyV" &&  // Phase 11B: V = on-duty officer inspects nearest ID
        e.code !== "KeyO" &&  // Phase 11C: O opens the inventory (anywhere)
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
        showGangHUDRef.current ||
        showCityAnnouncementHUDRef.current ||
        showCityTaxHUDRef.current     ||
        showCityBudgetHUDRef.current  ||
        showCityProjectsHUDRef.current ||
        showCityDashboardHUDRef.current ||
        showCityLedgerHUDRef.current ||
        showIDCardRef.current ||
        showInventoryRef.current ||
        receivedIDOpenRef.current ||
        showHouseBuyRef.current ||
        showGlobalChatRef.current ||
        showEventHallRef.current;

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

      // Phase 11A: C toggles the local ID/wallet card.
      // Close is always allowed; open only when no other modal is blocking.
      if (e.code === "KeyC") {
        if (showIDCardRef.current) {
          setShowIDCard(false);
        } else if (!anyModalOpen) {
          setShowIDCard(true);
        }
        return;
      }

      // Phase 11C: O toggles the inventory panel. Close is always allowed; open
      // only when no other modal is blocking, and fetches a fresh snapshot.
      if (e.code === "KeyO") {
        if (showInventoryRef.current) {
          setShowInventory(false);
        } else if (!anyModalOpen) {
          emitGetInventoryRef.current();
          setShowInventory(true);
        }
        return;
      }

      // Phase comms: plain K toggles the proximity-voice MIC (universal, any
      // player). Shift+K is reserved for the police arrest below, so plain-K
      // returns here and Shift+K falls through. The mic permission prompt is
      // triggered from this keypress (a user gesture) inside toggleMic().
      if (e.code === "KeyK" && !e.shiftKey) {
        toggleMicRef.current();
        return;
      }

      // Phase comms: plain T toggles the GLOBAL chat panel (universal). Close is
      // always allowed; open only when no other modal is blocking. Shift+T is
      // reserved for the Mayor tax panel below, so plain-T returns here and
      // Shift+T falls through.
      if (e.code === "KeyT" && !e.shiftKey) {
        if (showGlobalChatRef.current) {
          setShowGlobalChat(false);
        } else if (!anyModalOpen) {
          setShowGlobalChat(true);
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

      // Phase 12A: E for player housing. Handled first; if the player is at a
      // house door or inside a house, this consumes E and returns. Otherwise it
      // falls through to the Mayor/other E interactions below. Houses are far
      // from City Hall, so the two never overlap.
      if (e.code === "KeyE" && !anyModalOpen && !inVehicleRef.current) {
        const px = playerPosRef.current.x;
        const pz = playerPosRef.current.z;
        const insideHouse = RP_HOUSES.find((h) => isInsideHouseFootprint(h, px, pz));
        if (insideHouse) {
          emitExitHouseRef.current();
          return;
        }
        const nearDoor = RP_HOUSES.find(
          (h) => Math.hypot(px - h.door[0], pz - h.door[2]) <= HOUSE_INTERACT_RADIUS,
        );
        if (nearDoor) {
          const info = housesRef.current.find((x) => x.slug === nearDoor.slug);
          if (info?.ownedByMe) {
            emitEnterHouseRef.current(nearDoor.slug);
          } else if (info?.owned) {
            pushToastRef.current?.("This house is locked.", "yellow", 3000);
          } else {
            setHouseBuyTarget(
              info ?? { slug: nearDoor.slug, label: nearDoor.label, price: nearDoor.price, owned: false, ownedByMe: false },
            );
            setShowHouseBuy(true);
          }
          return;
        }
      }

      // Phase 8A: E at Government Office — Mayor opens City Announcement panel.
      // Close is always allowed; open requires Mayor + near gov office + no other modal.
      if (e.code === "KeyE") {
        if (showCityAnnouncementHUDRef.current) {
          setShowCityAnnouncementHUD(false);
          return;
        }
        if (!anyModalOpen && isMayorRef.current && nearGovOfficeRef.current) {
          setShowCityAnnouncementHUD(true);
          return;
        }
        // fall through — let LocalPlayer handle E for other interactions.
      }

      // Phase 8B: SHIFT+T at Government Office — Mayor opens City Tax Rate panel.
      // (Plain T is the global chat toggle, handled above.) Close is always
      // allowed; open requires Mayor + near gov office + no other modal.
      if (e.code === "KeyT" && e.shiftKey) {
        if (showCityTaxHUDRef.current) {
          setShowCityTaxHUD(false);
          return;
        }
        if (!anyModalOpen && isMayorRef.current && nearGovOfficeRef.current) {
          setShowCityTaxHUD(true);
          return;
        }
        return;
      }

      // Phase 8E: B at Government Office — Mayor opens City Grant panel.
      if (e.code === "KeyB") {
        if (showCityBudgetHUDRef.current) {
          setShowCityBudgetHUD(false);
          return;
        }
        if (!anyModalOpen && isMayorRef.current && nearGovOfficeRef.current) {
          setShowCityBudgetHUD(true);
          return;
        }
        return;
      }

      // Phase 8F: P at Government Office — Mayor opens City Project Funding panel.
      if (e.code === "KeyP") {
        if (showCityProjectsHUDRef.current) {
          setShowCityProjectsHUD(false);
          return;
        }
        if (!anyModalOpen && isMayorRef.current && nearGovOfficeRef.current) {
          setShowCityProjectsHUD(true);
          return;
        }
        return;
      }

      // Phase 8H: D at Government Office — Mayor opens read-only City Dashboard.
      // KeyD is also strafe-right movement, so we only intercept it when the
      // dashboard is open (to close) or when the Mayor is eligible to open it;
      // otherwise we fall through and let movement handle the keypress normally.
      if (e.code === "KeyD") {
        if (showCityDashboardHUDRef.current) {
          setShowCityDashboardHUD(false);
          return;
        }
        if (!anyModalOpen && isMayorRef.current && nearGovOfficeRef.current) {
          setShowCityDashboardHUD(true);
          return;
        }
        // fall through — let KeyboardControls handle D for strafing.
      }

      // Phase 8I: L at Government Office — Mayor opens read-only City Ledger.
      // KeyL is also the vehicle lock/unlock key (handled in LocalPlayer's frame
      // loop). We only intercept it to close an open ledger, or to open it when
      // the Mayor is eligible at City Hall; otherwise we fall through so the
      // existing lock/unlock behavior continues to work everywhere else.
      if (e.code === "KeyL") {
        if (showCityLedgerHUDRef.current) {
          setShowCityLedgerHUD(false);
          return;
        }
        if (!anyModalOpen && isMayorRef.current && nearGovOfficeRef.current) {
          setShowCityLedgerHUD(true);
          return;
        }
        // fall through — let LocalPlayer handle L for vehicle lock/unlock.
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

      // SHIFT+K — police arrest of the nearest wanted player. (Plain K is the
      // mic toggle, handled universally above before the on-duty gate.)
      if (e.code === "KeyK" && e.shiftKey) {
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

      if (e.code === "KeyV") {
        // V = On-duty officer inspects the nearest player's ID within ID_SHARE_RADIUS.
        // The server re-validates officer status, range, and rate limit; the client
        // only nominates a target socket id.
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        for (const p of players) {
          const dx = p.x - pos.x;
          const dz = p.z - pos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= ID_SHARE_RADIUS && dist < nearestDist) {
            nearestDist = dist;
            nearestId   = p.id;
          }
        }
        if (nearestId) emitPoliceInspectIDRef.current(nearestId);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty — all state accessed via refs above.

  // Phase 8A: Show the newest announcement in a banner for 8 seconds.
  // Re-runs each time a new announcement arrives (keyed by createdAt).
  useEffect(() => {
    const ann = cityAnnouncements[0];
    if (!ann) return;
    setVisibleAnnouncement(ann);
    const t = setTimeout(() => setVisibleAnnouncement(null), 8_000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityAnnouncements[0]?.createdAt]);

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

  // Phase 11B: nearest player within ID_SHARE_RADIUS (any player), for the
  // "Show My ID" button in the ID card. On foot only.
  const nearIdShareTarget: { id: string; name: string } | null = (() => {
    if (uiState.inVehicle) return null;
    let best: { id: string; name: string; dist: number } | null = null;
    for (const p of remotePlayers) {
      const dx = p.x - playerPosRef.current.x;
      const dz = p.z - playerPosRef.current.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= ID_SHARE_RADIUS && (!best || dist < best.dist)) {
        best = { id: p.id, name: (p as { username?: string }).username ?? p.id, dist };
      }
    }
    return best ? { id: best.id, name: best.name } : null;
  })();

  // Phase 12A: house HUD prompt — inside a house, at a door, or none. On foot only.
  const housePrompt: string | null = (() => {
    if (uiState.inVehicle) return null;
    const px = playerPosRef.current.x;
    const pz = playerPosRef.current.z;
    const inside = RP_HOUSES.find((h) => isInsideHouseFootprint(h, px, pz));
    if (inside) return "E — Exit Home";
    const nearDoor = RP_HOUSES.find(
      (h) => Math.hypot(px - h.door[0], pz - h.door[2]) <= HOUSE_INTERACT_RADIUS,
    );
    if (!nearDoor) return null;
    const info = houses.find((x) => x.slug === nearDoor.slug);
    if (info?.ownedByMe) return "E — Enter Home";
    if (info?.owned) return "Locked";
    const price = info?.price ?? nearDoor.price;
    return `E — Buy ${nearDoor.label} $${price.toLocaleString()}`;
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

  // Phase 8A: Government Office proximity + Mayor status refs.
  // Phase 9A Batch E: proximity is measured to the City Hall door so it matches
  // the server gate (rpGovernmentService now checks GOVERNMENT_OFFICE_DOOR).
  const nearGovernmentOffice = (() => {
    const pos = playerPosRef.current;
    const [gx, , gz] = GOVERNMENT_OFFICE_DOOR;
    const dx = pos.x - gx;
    const dz = pos.z - gz;
    return Math.sqrt(dx * dx + dz * dz) <= GOVERNMENT_OFFICE_RADIUS;
  })();
  nearGovOfficeRef.current = nearGovernmentOffice;
  isMayorRef.current =
    rpProfile?.factionType === "government" &&
    (rpProfile?.factionRank ?? 0) >= MAYOR_MIN_RANK;

  // Phase 8I: Suppress LocalPlayer's KeyL vehicle lock toggle when L is acting
  // as the City Ledger key — i.e. the ledger is open, or the Mayor is standing
  // at City Hall where pressing L opens it. UI-only; server lock authority is
  // unchanged. Lock/unlock still works for everyone else everywhere else.
  const isMayorNow =
    rpProfile?.factionType === "government" &&
    (rpProfile?.factionRank ?? 0) >= MAYOR_MIN_RANK;
  const suppressVehicleLockKey =
    showCityLedgerHUD || (isMayorNow && nearGovernmentOffice);

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

          {/* Phase 9A Batch C: civic RP buildings (visual-only shells from RP_BUILDINGS). */}
          <RPBuildings />

          {/* Phase 12A: starter player houses (sealed shells + door markers). */}
          <RPHouses />

          {/* Nemo Gang hood — static SW-forest neighborhood (Batch A: visuals
              + collision only; gang membership/spawn arrive in Batch B). */}
          <NemoHood />

          {/* Phase 14A: Grand Plaza Hall event venue (SE peri-city).
              Phase 14B: live presenter screen-share maps onto the giant screen. */}
          <EventHall
            screenVideoTexture={hallShare.videoTexture}
            screenVideoAspect={hallShare.videoAspect}
          />

          {/* RP world markers — station platform, licensing office, checkpoint rings, depot */}
          <RPMarkers
            activeTest={rpProfile?.activeTest ?? null}
            activeJob={rpProfile?.activeJob ?? null}
            activeGangMission={activeGangMission}
            gangTerritoryStatus={gangTerritoryStatus}
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
            onOpenEventHall={() => setShowEventHall(true)}
            activeJob={rpProfile?.activeJob ?? null}
            emitToggleDuty={emitToggleDuty}
            emitJobCheckpoint={emitJobCheckpoint}
            activeGangMission={activeGangMission}
            emitGangMissionCheckpoint={emitGangMissionCheckpoint}
            suppressVehicleLockKey={suppressVehicleLockKey}
            houseTeleportRef={houseTeleportRef}
            characterId={character}
            voiceSpeaking={voiceSpeaking}
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

      {/* Batch B: Nemo Gang membership badge (display only; spawn authority is
          server-side). Shown for verified members; the hood is their spawn. */}
      {nemoGang?.isMember && (
        <div
          style={{
            position: "fixed",
            top: 64,
            left: 18,
            zIndex: 1400,
            pointerEvents: "none",
            background: "rgba(40, 18, 64, 0.78)",
            border: "1px solid rgba(176,111,255,0.55)",
            borderRadius: 8,
            padding: "5px 10px",
            fontFamily: "'Courier New', monospace",
            fontSize: 12,
            letterSpacing: 1,
            color: "#d9c2ff",
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
          }}
          data-testid="hud-nemo-gang-badge"
        >
          🐾 {nemoGang.gangName} · spawn: hood
        </div>
      )}

      {/* Phase 14A: Grand Plaza Hall event-screen panel */}
      {showEventHall && (
        <EventHallHUD
          onClose={() => setShowEventHall(false)}
          onShare={hallShare.startShare}
          onStopShare={hallShare.stopShare}
          sharing={hallShare.sharing}
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
        nearEventHall={uiState.nearEventHall}
        nearSitChair={uiState.nearSitChair}
        isSitting={uiState.isSitting}
        nearBoardTrain={uiState.nearBoardTrain}
        inTrain={uiState.inTrain}
        trainCanExit={uiState.trainCanExit}
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
        nearGovernmentOffice={nearGovernmentOffice}
        cityTaxRate={cityConfig.taxRate}
        cityBudget={cityConfig.cityBudget}
        cityProjects={cityProjects}
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

      {/* Phase comms: Global chat panel (bottom-left). Toggle with plain T. */}
      {showGlobalChat && (
        <GlobalChatHUD
          messages={globalMessages}
          onSend={(msg) => emitGlobalChat(msg)}
          onClose={() => setShowGlobalChat(false)}
        />
      )}

      {/* Phase comms: proximity-voice mic indicator. Shown only while the mic is
          live (toggled with plain K). Purely a status badge — no ids/peers. */}
      {micOn && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2300,
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "5px 12px",
            borderRadius: 999,
            background: "rgba(8, 14, 28, 0.92)",
            border: "1px solid rgba(76, 217, 100, 0.5)",
            boxShadow: "0 4px 14px rgba(0,0,0,0.5), 0 0 10px rgba(76,217,100,0.25)",
            fontFamily: "'Courier New', monospace",
            fontSize: 11,
            fontWeight: "bold",
            letterSpacing: 1,
            color: "#4cd964",
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "#4cd964",
              boxShadow: "0 0 8px #4cd964",
              animation: "micPulse 1.2s ease-in-out infinite",
            }}
          />
          🎙 MIC LIVE · K to mute
          <style>{`@keyframes micPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }`}</style>
        </div>
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
          gangRoster={gangRoster}
          myPlayerId={rpProfile?.playerId ?? ""}
          nearHangout={nearGangHangout}
          nearTurf={nearGangTurf}
          emitGangStatus={emitGangStatus}
          emitGangAction={emitGangAction}
          emitGangJoinRequest={emitGangJoinRequest}
          emitGangJoinResponse={emitGangJoinResponse}
          dismissGangJoinResult={dismissGangJoinResult}
          emitGangRoster={emitGangRoster}
          emitGangSetRank={emitGangSetRank}
          emitGangRemoveMember={emitGangRemoveMember}
          activeGangMission={activeGangMission}
          missionCooldownUntil={missionCooldownUntil}
          emitGangMissionStart={emitGangMissionStart}
          gangTerritoryStatus={gangTerritoryStatus}
          emitGangTerritoryStatus={emitGangTerritoryStatus}
          emitGangTerritoryPulse={emitGangTerritoryPulse}
          onClose={() => setShowGangHUD(false)}
        />
      )}

      {/* Phase 7G: Gang mission HUD — always visible during an active Tag Turf mission */}
      <GangMissionHUD
        activeGangMission={activeGangMission}
        localPos={[playerPosRef.current.x, playerPosRef.current.y, playerPosRef.current.z]}
        factionColor={rpProfile?.factionColor ?? null}
      />

      {/* Phase 8A: City Announcement compose panel (Mayor only, near Gov Office) */}
      {showCityAnnouncementHUD && (
        <CityAnnouncementHUD
          onSend={emitCityAnnounce}
          onClose={() => setShowCityAnnouncementHUD(false)}
        />
      )}

      {/* Phase 8F: City Projects panel (Mayor only, near Gov Office, P key) */}
      {showCityProjectsHUD && (
        <CityProjectsHUD
          currentBudget={cityConfig.cityBudget}
          activeProjects={cityProjects}
          onFund={emitCityProjectFund}
          onClose={() => setShowCityProjectsHUD(false)}
        />
      )}

      {/* Phase 8H: City Dashboard panel (Mayor only, near Gov Office, D key) */}
      {showCityDashboardHUD && (
        <CityDashboardHUD
          dashboard={cityDashboard}
          onRequest={emitGetCityDashboard}
          onClose={() => setShowCityDashboardHUD(false)}
        />
      )}

      {/* Phase 8I: City Ledger panel (Mayor only, near Gov Office, L key) */}
      {showCityLedgerHUD && (
        <CityLedgerHUD
          ledger={cityLedger}
          onRequest={emitGetCityLedger}
          onClose={() => setShowCityLedgerHUD(false)}
        />
      )}

      {/* Phase 11A: local ID / wallet card (C key, anywhere) */}
      {showIDCard && (
        <IDCardHUD
          username={username}
          profile={rpProfile}
          onClose={() => setShowIDCard(false)}
          nearestName={nearIdShareTarget?.name ?? null}
          onShowNearest={
            nearIdShareTarget
              ? () => { emitShowID(nearIdShareTarget.id); setShowIDCard(false); }
              : null
          }
        />
      )}

      {/* Phase 11B: an ID shown to you, or a police inspection result */}
      {receivedID && (
        <ReceivedIDHUD card={receivedID} onClose={dismissReceivedID} />
      )}

      {/* Phase 11C: read-only personal inventory (O key, anywhere) */}
      {showInventory && (
        <InventoryHUD inventory={playerInventory} onClose={() => setShowInventory(false)} />
      )}

      {/* Phase 12A: house purchase confirmation modal */}
      {showHouseBuy && houseBuyTarget && (
        <HouseBuyModal
          label={houseBuyTarget.label}
          price={houseBuyTarget.price}
          canAfford={(rpProfile?.cash ?? 0) >= houseBuyTarget.price}
          onConfirm={() => { emitBuyHouse(houseBuyTarget.slug); setShowHouseBuy(false); }}
          onCancel={() => setShowHouseBuy(false)}
        />
      )}

      {/* Phase 12A: house interaction prompt (E — Buy / Enter / Exit, or Locked) */}
      {housePrompt && !showHouseBuy && !showShop && !showATM && !showIDCard && !showInventory && !receivedID && (
        <div
          style={{
            position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)",
            zIndex: 3500, pointerEvents: "none",
            background: "rgba(4,10,28,0.9)", border: "1px solid rgba(85,119,238,0.5)",
            borderRadius: 8, padding: "8px 16px", color: "#dde", fontSize: 14, fontWeight: 700,
            letterSpacing: 0.3, boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
          }}
        >
          {housePrompt}
        </div>
      )}

      {/* Phase 8B/8D: City Tax Rate panel (Mayor only, near Gov Office, T key) */}
      {showCityTaxHUD && (
        <CityTaxHUD
          currentRate={cityConfig.taxRate}
          cityBudget={cityConfig.cityBudget}
          onApply={emitSetTaxRate}
          onClose={() => setShowCityTaxHUD(false)}
        />
      )}

      {/* Phase 8E: City Grant panel (Mayor only, near Gov Office, B key) */}
      {showCityBudgetHUD && (() => {
        const grantable: GrantablePlayer[] = remotePlayers.map((p) => ({
          id:       p.id,
          username: (p as { username?: string }).username ?? p.id,
        }));
        return (
          <CityBudgetHUD
            currentBudget={cityConfig.cityBudget}
            myId={myId}
            onlinePlayers={grantable}
            onGrant={emitCityGrant}
            onClose={() => setShowCityBudgetHUD(false)}
          />
        );
      })()}

      {/* Phase 8A: City Announcement banner — shown to ALL players for 8 s after broadcast */}
      {visibleAnnouncement && (
        <div
          key={visibleAnnouncement.createdAt}
          style={{
            position:             "absolute",
            top:                  60,
            left:                 "50%",
            transform:            "translateX(-50%)",
            background:           "rgba(4, 10, 28, 0.92)",
            border:               "1px solid rgba(51, 85, 204, 0.55)",
            borderRadius:         8,
            padding:              "10px 18px",
            maxWidth:             520,
            width:                "80vw",
            zIndex:               3500,
            textAlign:            "center",
            backdropFilter:       "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            boxShadow:            "0 4px 20px rgba(0,0,0,0.7), 0 0 20px rgba(51,85,204,0.2)",
            pointerEvents:        "none",
          }}
        >
          <div
            style={{
              fontSize:      10,
              color:         "#5577ee",
              letterSpacing: 1,
              marginBottom:  4,
              textTransform: "uppercase",
            }}
          >
            🏛️ City Announcement · {visibleAnnouncement.fromName}
          </div>
          <div style={{ fontSize: 14, color: "#dde", lineHeight: 1.4 }}>
            {visibleAnnouncement.msg}
          </div>
        </div>
      )}
    </div>
  );
}
