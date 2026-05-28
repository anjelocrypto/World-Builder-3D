/**
 * useRpSocket — React hook for RP-layer socket events.
 *
 * Attaches listeners for rp:profile, rp:profileUpdate, and rp:toast on the
 * socket returned by useSocket. The socket is passed as a reactive value so
 * the useEffect re-runs the moment the connection is established (socket goes
 * from null → Socket instance).
 *
 * Returns:
 *   rpProfile      — current authoritative RP profile (null before first join)
 *   rpToasts       — stack of pending toast notifications (max 5)
 *   dismissToast   — remove one toast by id
 *   canDriveVehicle — optimistic client check (server enforces independently)
 */

import { useEffect, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import type { RpProfile, RpToast, RpPendingFine, RpFactionMessage, FactionSummary, OnlinePlayerFactionSummary, GangStatus, GangPresenceEvent, GangJoinRequest, GangJoinResult, GangJoinRequestSent, GangRosterMember, ActiveGangMission, GangTerritoryStatus, CityAnnouncement, CityConfig } from "../shared/rpTypes";
import { canDriveVehicleClient, GROVE_TAG_COOLDOWN_MS, CITY_TAX_DEFAULT } from "../shared/rpTypes";
import type { VehicleState } from "../shared/types";

export function useRpSocket(socket: Socket | null) {
  const [rpProfile, setRpProfile] = useState<RpProfile | null>(null);
  const [rpToasts, setRpToasts] = useState<RpToast[]>([]);
  /** Map of socketId → wantedStars for all players on the server. */
  const [wantedByPlayerId, setWantedByPlayerId] = useState<Record<string, number>>({});
  /**
   * Phase 6C: Map of socketId → cuff state for all players.
   * Populated by rp:cuffedUpdate broadcasts from the server.
   * Used to render cuff indicators on remote players and to gate I-key uncuff.
   */
  const [cuffedPlayers, setCuffedPlayers] = useState<
    Record<string, { cuffedBy: string; cuffedUntil: number | null }>
  >({});

  /**
   * Phase 6E: Pending fine issued by an officer to THIS player.
   * Null = no active fine. Set by rp:fineIssued; cleared by rp:fineResolved or rp:fineExpired.
   */
  const [pendingFine, setPendingFine] = useState<RpPendingFine | null>(null);

  /**
   * Phase 7A: Last 20 faction chat messages received via rp:factionChat.
   * Transient client state — not persisted across reconnects.
   */
  const [factionMessages, setFactionMessages] = useState<RpFactionMessage[]>([]);

  /**
   * Phase 7C: List of all seeded factions, populated by rp:factionsListed.
   * Empty until emitListFactions() is called.
   */
  const [factions, setFactions] = useState<FactionSummary[]>([]);

  /**
   * Phase 7C: Online player faction summaries, populated by rp:onlinePlayersListed.
   * Empty until emitListOnlinePlayers() is called.
   */
  const [onlineFactionPlayers, setOnlineFactionPlayers] = useState<OnlinePlayerFactionSummary[]>([]);

  /**
   * Phase 7D: Gang status for the local player, populated by rp:gangStatus.
   * Null until emitGangStatus() is called (or server auto-sends after join).
   */
  const [gangStatus, setGangStatus] = useState<GangStatus | null>(null);

  /**
   * Phase 7D: Rolling log of gang presence events received via rp:gangPresence.
   * Server broadcasts these only to faction members after a validate claim_presence action.
   * Kept to last 10 entries (per spec).
   */
  const [gangPresenceEvents, setGangPresenceEvents] = useState<GangPresenceEvent[]>([]);

  /**
   * Phase 7E: Pending gang join requests received by this leader.
   * Updated by rp:gangJoinRequests (server pushes full list on any change).
   */
  const [gangJoinRequests, setGangJoinRequests] = useState<GangJoinRequest[]>([]);

  /**
   * Phase 7E: Result of this player's own join request. Set by rp:gangJoinResult.
   * Null when no request is in flight or after dismissal.
   */
  const [gangJoinResult, setGangJoinResult] = useState<GangJoinResult | null>(null);

  /**
   * Phase 7E: Confirmation that a join request was successfully sent.
   * Cleared when gangJoinResult arrives.
   */
  const [gangJoinRequestSent, setGangJoinRequestSent] = useState<GangJoinRequestSent | null>(null);

  /**
   * Phase 7F: Faction roster as returned by rp:gangRoster.
   * Refreshed on open and after any rank/remove action.
   */
  const [gangRoster, setGangRoster] = useState<GangRosterMember[]>([]);

  /**
   * Phase 7G: Active Tag Turf gang mission, or null when not in a mission.
   * Populated by rp:gangMissionActive, updated by rp:gangMissionProgress,
   * cleared by rp:gangMissionComplete / rp:gangMissionFailed.
   */
  const [activeGangMission, setActiveGangMission] = useState<ActiveGangMission | null>(null);
  /**
   * Phase 7G: ms timestamp after which a new Tag Turf mission can be started.
   * 0 = no cooldown. Set when rp:gangMissionComplete is received.
   */
  const [missionCooldownUntil, setMissionCooldownUntil] = useState<number>(0);

  /**
   * Phase 7H: Current territory status snapshot, populated by rp:gangTerritoryStatus.
   * Null until emitGangTerritoryStatus() is called or server broadcasts after a pulse.
   * Updated in-place on every rp:gangTerritoryStatus event (last write wins — we only
   * track Grove Street for now).
   */
  const [gangTerritoryStatus, setGangTerritoryStatus] = useState<GangTerritoryStatus | null>(null);

  /**
   * Phase 8A: Rolling log of city announcements from the Mayor.
   * Capped at 5 (most recent first). Each entry has msg, fromName, createdAt.
   */
  const [cityAnnouncements, setCityAnnouncements] = useState<CityAnnouncement[]>([]);

  /**
   * Phase 8B: Current city tax config.
   * Initialised to CITY_TAX_DEFAULT; updated whenever rp:cityConfig is received.
   * The server is authoritative — this is only used for display.
   */
  const [cityConfig, setCityConfig] = useState<CityConfig>({
    taxRate:       CITY_TAX_DEFAULT,
    updatedAt:     0,
    updatedByName: null,
  });

  useEffect(() => {
    if (!socket) return;

    const onProfile = (data: RpProfile) => {
      setRpProfile({ ...data, ownedVehicles: data.ownedVehicles ?? [] });
      // Phase 8B: Request city config after the RP join path is ready.
      // Emitting here (rather than at listener-attach time) guarantees that
      // setupRpHandlers has already registered rp:getCityConfig on the server
      // and that the server-side RP cache entry exists, so late-joining
      // players always receive the current tax rate, not just the default.
      socket.emit("rp:getCityConfig");
    };

    const onProfileUpdate = (data: Partial<RpProfile>) => {
      setRpProfile((prev) => (prev ? { ...prev, ...data } : null));
    };

    const onToast = (data: { msg: string; color: string; duration?: number }) => {
      setRpToasts((prev) => [
        // Keep at most 5 toasts in the stack so the HUD never overflows.
        ...prev.slice(-4),
        { ...data, id: Date.now() },
      ]);
    };

    // rp:licenseTestActive is a lightweight acknowledgment signal.
    // The profile update carrying activeTest arrives via rp:profileUpdate,
    // so no additional state mutation is needed here.
    const onLicenseTestActive = () => {};

    // Phase 6B: rp:wantedUpdate — server broadcasts a new wantedStars count for
    // a specific player. Update the global map only; own wantedStars flows via
    // rp:profileUpdate which already handles it through onProfileUpdate.
    const onWantedUpdate = (data: { playerId: string; wantedStars: number }) => {
      setWantedByPlayerId((prev) => ({ ...prev, [data.playerId]: data.wantedStars }));
    };

    // Phase 6A: rp:jailStatus — player jailed or released.
    const onJailStatus = (data: {
      jailed: boolean;
      jailUntil?: number;
      jailReason?: string;
      jailCell?: [number, number, number];
      releasePos?: [number, number, number];
    }) => {
      setRpProfile((prev) => {
        if (!prev) return null;
        if (data.jailed) {
          return {
            ...prev,
            jailUntil:  data.jailUntil  ?? prev.jailUntil,
            jailReason: data.jailReason ?? prev.jailReason ?? null,
          };
        } else {
          return { ...prev, jailUntil: null, jailReason: null, wantedStars: 0 };
        }
      });
    };

    // Phase 6C: rp:cuffedUpdate — server broadcasts cuff state for a player.
    // cuffedBy: null means the player was uncuffed (remove from map).
    const onCuffedUpdate = (data: {
      targetId:   string;
      cuffedBy:   string | null;
      cuffedUntil: number | null;
    }) => {
      setCuffedPlayers((prev) => {
        if (!data.cuffedBy) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [data.targetId]: _removed, ...rest } = prev;
          return rest;
        }
        return {
          ...prev,
          [data.targetId]: { cuffedBy: data.cuffedBy, cuffedUntil: data.cuffedUntil },
        };
      });
    };

    // Phase 6E: rp:fineIssued — an officer has issued a fine to THIS player.
    const onFineIssued = (data: {
      officerId:   string;
      officerName: string;
      amount:      number;
      reason:      string;
      expiresAt:   number;
    }) => {
      setPendingFine({
        officerId:   data.officerId,
        officerName: data.officerName,
        amount:      data.amount,
        reason:      data.reason,
        expiresAt:   data.expiresAt,
      });
    };

    // Phase 6E: rp:fineResolved — fine was accepted or rejected; clear overlay.
    const onFineResolved = (_data: { accepted: boolean; amount: number }) => {
      setPendingFine(null);
    };

    // Phase 6E: rp:fineExpired — fine timed out; clear overlay.
    const onFineExpired = () => {
      setPendingFine(null);
    };

    // Phase 7C: rp:factionsListed — response to rp:listFactions.
    const onFactionsListed = (data: { factions: FactionSummary[] }) => {
      setFactions(data.factions ?? []);
    };

    // Phase 7C: rp:onlinePlayersListed — response to rp:listOnlinePlayers.
    const onOnlinePlayersListed = (data: { players: OnlinePlayerFactionSummary[] }) => {
      setOnlineFactionPlayers(data.players ?? []);
    };

    // Phase 7C: rp:factionAssigned — emitted to the requesting dev socket after
    // a successful rp:adminSetFaction (assign or clear). Refresh online list.
    const onFactionAssigned = (_data: {
      targetId:     string;
      factionSlug:  string | null;
      factionName:  string | null;
      factionType:  string | null;
      factionColor: string | null;
      factionRank:  number;
    }) => {
      // Re-fetch the online list so the admin panel reflects the change.
      socket.emit("rp:listOnlinePlayers");
    };

    // Phase 7D: rp:gangStatus — server response to rp:gangStatus request.
    const onGangStatus = (data: GangStatus) => {
      setGangStatus(data);
    };

    // Phase 7D: rp:gangPresence — a faction member claimed presence in the turf.
    // Server validates position before broadcasting; we just store it.
    const onGangPresence = (data: GangPresenceEvent) => {
      // P3: keep last 10 per spec.
      setGangPresenceEvents((prev) => [...prev.slice(-9), data]);
    };

    // Phase 7E: rp:gangJoinRequests — server pushes full pending list to leaders.
    const onGangJoinRequests = (data: GangJoinRequest[]) => {
      setGangJoinRequests(data);
    };

    // Phase 7E: rp:gangJoinResult — outcome of this player's own join request.
    const onGangJoinResult = (data: GangJoinResult) => {
      setGangJoinResult(data);
      setGangJoinRequestSent(null);
    };

    // Phase 7E: rp:gangJoinRequestSent — queued confirmation, or null when an
    // expired request is cleared server-side so the join button reappears.
    const onGangJoinRequestSent = (data: GangJoinRequestSent | null) => {
      setGangJoinRequestSent(data ?? null);
    };

    // Phase 7F: rp:gangRoster — full faction roster (safe fields only).
    const onGangRoster = (data: GangRosterMember[]) => {
      setGangRoster(Array.isArray(data) ? data : []);
    };

    // Phase 7G: Tag Turf mission lifecycle events.
    const onGangMissionActive = (data: ActiveGangMission) => {
      setActiveGangMission(data);
    };
    const onGangMissionProgress = (data: { nextIdx: number }) => {
      setActiveGangMission((prev) =>
        prev ? { ...prev, nextIdx: data.nextIdx } : prev,
      );
    };
    const onGangMissionComplete = () => {
      setActiveGangMission(null);
      setMissionCooldownUntil(Date.now() + GROVE_TAG_COOLDOWN_MS);
    };
    const onGangMissionFailed = () => {
      setActiveGangMission(null);
    };

    // Phase 7H: rp:gangTerritoryStatus — territory snapshot (any update, any cause).
    const onGangTerritoryStatus = (data: GangTerritoryStatus) => {
      setGangTerritoryStatus(data);
    };

    // Phase 8A: rp:cityAnnounce — Mayor broadcasts a city-wide announcement.
    const onCityAnnounce = (data: CityAnnouncement) => {
      setCityAnnouncements((prev) => [data, ...prev].slice(0, 5));
    };

    // Phase 8B: rp:cityConfig — server pushes the current tax config on request
    // or whenever the Mayor changes the rate.
    const onCityConfig = (data: CityConfig) => {
      setCityConfig(data);
    };

    // Phase 7A: rp:factionChat — a faction member sent a message.
    const onFactionChat = (data: {
      fromId:       string;
      fromName:     string;
      factionSlug:  string;
      factionName:  string;
      factionColor: string;
      msg:          string;
      createdAt:    number;
    }) => {
      setFactionMessages((prev) => [
        // Keep at most 20 messages; drop the oldest if needed.
        ...prev.slice(-19),
        { ...data, id: Date.now() + Math.random() },
      ]);
    };

    socket.on("rp:profile",              onProfile);
    socket.on("rp:profileUpdate",        onProfileUpdate);
    socket.on("rp:toast",                onToast);
    socket.on("rp:licenseTestActive",    onLicenseTestActive);
    socket.on("rp:wantedUpdate",         onWantedUpdate);
    socket.on("rp:jailStatus",           onJailStatus);
    socket.on("rp:cuffedUpdate",         onCuffedUpdate);
    socket.on("rp:fineIssued",           onFineIssued);
    socket.on("rp:fineResolved",         onFineResolved);
    socket.on("rp:fineExpired",          onFineExpired);
    socket.on("rp:factionChat",          onFactionChat);
    socket.on("rp:factionsListed",       onFactionsListed);
    socket.on("rp:onlinePlayersListed",  onOnlinePlayersListed);
    socket.on("rp:factionAssigned",      onFactionAssigned);
    socket.on("rp:gangStatus",           onGangStatus);
    socket.on("rp:gangPresence",         onGangPresence);
    socket.on("rp:gangJoinRequests",     onGangJoinRequests);
    socket.on("rp:gangJoinResult",       onGangJoinResult);
    socket.on("rp:gangJoinRequestSent",  onGangJoinRequestSent);
    socket.on("rp:gangRoster",           onGangRoster);
    socket.on("rp:gangMissionActive",    onGangMissionActive);
    socket.on("rp:gangMissionProgress",  onGangMissionProgress);
    socket.on("rp:gangMissionComplete",  onGangMissionComplete);
    socket.on("rp:gangMissionFailed",    onGangMissionFailed);
    socket.on("rp:gangTerritoryStatus",  onGangTerritoryStatus);
    socket.on("rp:cityAnnounce",         onCityAnnounce);
    socket.on("rp:cityConfig",           onCityConfig);

    return () => {
      socket.off("rp:profile",              onProfile);
      socket.off("rp:profileUpdate",        onProfileUpdate);
      socket.off("rp:toast",                onToast);
      socket.off("rp:licenseTestActive",    onLicenseTestActive);
      socket.off("rp:wantedUpdate",         onWantedUpdate);
      socket.off("rp:jailStatus",           onJailStatus);
      socket.off("rp:cuffedUpdate",         onCuffedUpdate);
      socket.off("rp:fineIssued",           onFineIssued);
      socket.off("rp:fineResolved",         onFineResolved);
      socket.off("rp:fineExpired",          onFineExpired);
      socket.off("rp:factionChat",          onFactionChat);
      socket.off("rp:factionsListed",       onFactionsListed);
      socket.off("rp:onlinePlayersListed",  onOnlinePlayersListed);
      socket.off("rp:factionAssigned",      onFactionAssigned);
      socket.off("rp:gangStatus",           onGangStatus);
      socket.off("rp:gangPresence",         onGangPresence);
      socket.off("rp:gangJoinRequests",     onGangJoinRequests);
      socket.off("rp:gangJoinResult",       onGangJoinResult);
      socket.off("rp:gangJoinRequestSent",  onGangJoinRequestSent);
      socket.off("rp:gangRoster",           onGangRoster);
      socket.off("rp:gangMissionActive",    onGangMissionActive);
      socket.off("rp:gangMissionProgress",  onGangMissionProgress);
      socket.off("rp:gangMissionComplete",  onGangMissionComplete);
      socket.off("rp:gangMissionFailed",    onGangMissionFailed);
      socket.off("rp:gangTerritoryStatus",  onGangTerritoryStatus);
      socket.off("rp:cityAnnounce",         onCityAnnounce);
      socket.off("rp:cityConfig",           onCityConfig);
    };
  }, [socket]);

  const dismissToast = useCallback((id: number) => {
    setRpToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Push a locally-generated toast (e.g. blocked vehicle entry) without
   * waiting for a server rp:toast event. Uses the same stack cap as the
   * server-driven path (max 5 items).
   */
  const pushToast = useCallback(
    (msg: string, color: string, duration = 3000) => {
      setRpToasts((prev) => [
        ...prev.slice(-4),
        { msg, color, duration, id: Date.now() },
      ]);
    },
    [],
  );

  /**
   * Returns true if the local player is allowed to drive `vehicleId`.
   * Accepts the full vehicle state so lock + ownership can be checked optimistically.
   * This is an OPTIMISTIC check — the server enforces it in vehicleUpdate.
   * Use this to skip the emitVehicleUpdate call and avoid a brief visual glitch.
   */
  const canDriveVehicle = useCallback(
    (vehicleId: string, vehicle?: Partial<VehicleState>): boolean =>
      canDriveVehicleClient(
        vehicleId,
        rpProfile,
        vehicle?.owned,
        vehicle?.locked,
        vehicle?.ownerId,
      ),
    [rpProfile],
  );

  /** Emit rp:interact to the server (e.g. start_driver_test at licensing_office). */
  const emitInteract = useCallback(
    (building: string, action: string) => {
      socket?.emit("rp:interact", { building, action });
    },
    [socket],
  );

  /**
   * Emit rp:licenseTestCheckpoint when the client detects proximity to a
   * checkpoint.  Server validates against its own vehicle position.
   */
  const emitLicenseCheckpoint = useCallback(
    (idx: number) => {
      socket?.emit("rp:licenseTestCheckpoint", { idx });
    },
    [socket],
  );

  /** Phase 3: emit rp:buyVehicle to purchase a vehicle at the dealership. */
  const emitBuyVehicle = useCallback(
    (model: string, variant: string, color: string) => {
      socket?.emit("rp:buyVehicle", { model, variant, color });
    },
    [socket],
  );

  /** Phase 3: emit rp:toggleLock to lock/unlock an owned vehicle. */
  const emitToggleLock = useCallback(
    (vehicleId: string) => {
      socket?.emit("rp:toggleLock", { vehicleId });
    },
    [socket],
  );

  /** Phase 4: emit rp:toggleDuty to clock in/out at the City Worker depot. */
  const emitToggleDuty = useCallback(
    (job: string) => {
      socket?.emit("rp:toggleDuty", { job });
    },
    [socket],
  );

  /** Phase 4: emit rp:jobCheckpoint when within range of the next checkpoint. */
  const emitJobCheckpoint = useCallback(
    (idx: number) => {
      socket?.emit("rp:jobCheckpoint", { idx });
    },
    [socket],
  );

  /** Phase 5F: emit rp:bankDeposit to move cash → bank at an ATM. */
  const emitBankDeposit = useCallback(
    (amount: number) => {
      socket?.emit("rp:bankDeposit", { amount });
    },
    [socket],
  );

  /** Phase 5F: emit rp:bankWithdraw to move bank → cash at an ATM. */
  const emitBankWithdraw = useCallback(
    (amount: number) => {
      socket?.emit("rp:bankWithdraw", { amount });
    },
    [socket],
  );

  /** Phase 6A: emit rp:issueWarrant — officer issues a warrant against a nearby player. */
  const emitIssueWarrant = useCallback(
    (targetId: string, stars: number, reason: string) => {
      socket?.emit("rp:issueWarrant", { targetId, stars, reason });
    },
    [socket],
  );

  /** Phase 6A: emit rp:arrest — officer arrests a nearby wanted player. */
  const emitArrest = useCallback(
    (targetId: string) => {
      socket?.emit("rp:arrest", { targetId });
    },
    [socket],
  );

  /** Phase 6C: emit rp:cuff — officer cuffs a nearby wanted player. */
  const emitCuff = useCallback(
    (targetId: string) => {
      socket?.emit("rp:cuff", { targetId });
    },
    [socket],
  );

  /** Phase 6C: emit rp:uncuff — officer releases a cuffed player. */
  const emitUncuff = useCallback(
    (targetId: string) => {
      socket?.emit("rp:uncuff", { targetId });
    },
    [socket],
  );

  /** Phase 6E: emit rp:issueFine — officer issues a fine to a nearby player. */
  const emitIssueFine = useCallback(
    (targetId: string, amount: number, reason: string) => {
      socket?.emit("rp:issueFine", { targetId, amount, reason });
    },
    [socket],
  );

  /** Phase 6E: emit rp:respondFine — target accepts or rejects a pending fine. */
  const emitRespondFine = useCallback(
    (accept: boolean) => {
      socket?.emit("rp:respondFine", { accept });
    },
    [socket],
  );

  /** Phase 7A: emit rp:factionChat — sends a message to faction members. */
  const emitFactionChat = useCallback(
    (msg: string) => {
      socket?.emit("rp:factionChat", { msg });
    },
    [socket],
  );

  /** Phase 7C: emit rp:listFactions — requests the full faction list from the server. */
  const emitListFactions = useCallback(() => {
    socket?.emit("rp:listFactions");
  }, [socket]);

  /** Phase 7C: emit rp:listOnlinePlayers — requests online player faction summaries. */
  const emitListOnlinePlayers = useCallback(() => {
    socket?.emit("rp:listOnlinePlayers");
  }, [socket]);

  /**
   * Phase 7C: emit rp:adminSetFaction — DEV-ONLY.
   * No-op at the call site if the event is not registered on the server
   * (i.e. in production). The server additionally rejects it even if emitted.
   */
  const emitAdminSetFaction = useCallback(
    (targetId: string, factionSlug: string, rank: number) => {
      socket?.emit("rp:adminSetFaction", { targetId, factionSlug, rank });
    },
    [socket],
  );

  /**
   * Phase 7D: emit rp:gangStatus — request the caller's gang status from the server.
   * Server responds with rp:gangStatus (which sets gangStatus state).
   */
  const emitGangStatus = useCallback(() => {
    socket?.emit("rp:gangStatus");
  }, [socket]);

  /**
   * Phase 7D: emit rp:gangAction — send a gang action to the server for validation.
   * Server validates position and rank before broadcasting.
   */
  const emitGangAction = useCallback(
    (action: string) => {
      socket?.emit("rp:gangAction", { action });
    },
    [socket],
  );

  return {
    rpProfile,
    rpToasts,
    dismissToast,
    pushToast,
    canDriveVehicle,
    wantedByPlayerId,
    cuffedPlayers,
    pendingFine,
    factionMessages,
    factions,
    onlineFactionPlayers,
    emitInteract,
    emitLicenseCheckpoint,
    emitBuyVehicle,
    emitToggleLock,
    emitToggleDuty,
    emitJobCheckpoint,
    emitBankDeposit,
    emitBankWithdraw,
    emitIssueWarrant,
    emitArrest,
    emitCuff,
    emitUncuff,
    emitIssueFine,
    emitRespondFine,
    emitFactionChat,
    emitListFactions,
    emitListOnlinePlayers,
    emitAdminSetFaction,
    gangStatus,
    gangPresenceEvents,
    emitGangStatus,
    emitGangAction,
    // Phase 7E: recruitment
    gangJoinRequests,
    gangJoinResult,
    gangJoinRequestSent,
    emitGangJoinRequest: useCallback(
      (factionSlug: string) => { socket?.emit("rp:gangJoinRequest", { factionSlug }); },
      [socket],
    ),
    emitGangJoinResponse: useCallback(
      (targetSocketId: string, accept: boolean) => { socket?.emit("rp:gangJoinResponse", { targetSocketId, accept }); },
      [socket],
    ),
    dismissGangJoinResult: useCallback(() => { setGangJoinResult(null); }, []),
    // Phase 7F: roster
    gangRoster,
    emitGangRoster: useCallback(
      () => { socket?.emit("rp:gangRoster"); },
      [socket],
    ),
    emitGangSetRank: useCallback(
      (targetPlayerId: string, rank: number) => { socket?.emit("rp:gangSetRank", { targetPlayerId, rank }); },
      [socket],
    ),
    emitGangRemoveMember: useCallback(
      (targetPlayerId: string) => { socket?.emit("rp:gangRemoveMember", { targetPlayerId }); },
      [socket],
    ),
    // Phase 7G: Tag Turf mission
    activeGangMission,
    missionCooldownUntil,
    emitGangMissionStart: useCallback(
      () => { socket?.emit("rp:gangMissionStart"); },
      [socket],
    ),
    emitGangMissionCheckpoint: useCallback(
      (idx: number) => { socket?.emit("rp:gangMissionCheckpoint", { idx }); },
      [socket],
    ),
    // Phase 7H: Gang Territory Control
    gangTerritoryStatus,
    emitGangTerritoryStatus: useCallback(
      () => { socket?.emit("rp:gangTerritoryStatus"); },
      [socket],
    ),
    emitGangTerritoryPulse: useCallback(
      (territoryId: string) => { socket?.emit("rp:gangTerritoryPulse", { territoryId }); },
      [socket],
    ),
    // Phase 8A: Mayor city announcements
    cityAnnouncements,
    emitCityAnnounce: useCallback(
      (msg: string) => { socket?.emit("rp:cityAnnounce", { msg }); },
      [socket],
    ),
    // Phase 8B: City tax config
    cityConfig,
    emitGetCityConfig: useCallback(
      () => { socket?.emit("rp:getCityConfig"); },
      [socket],
    ),
    emitSetTaxRate: useCallback(
      (rate: number) => { socket?.emit("rp:setTaxRate", { rate }); },
      [socket],
    ),
  };
}
