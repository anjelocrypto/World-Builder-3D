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
import type { RpProfile, RpToast, RpPendingFine, RpFactionMessage } from "../shared/rpTypes";
import { canDriveVehicleClient } from "../shared/rpTypes";
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

  useEffect(() => {
    if (!socket) return;

    const onProfile = (data: RpProfile) => {
      setRpProfile({ ...data, ownedVehicles: data.ownedVehicles ?? [] });
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

    socket.on("rp:profile",            onProfile);
    socket.on("rp:profileUpdate",      onProfileUpdate);
    socket.on("rp:toast",              onToast);
    socket.on("rp:licenseTestActive",  onLicenseTestActive);
    socket.on("rp:wantedUpdate",       onWantedUpdate);
    socket.on("rp:jailStatus",         onJailStatus);
    socket.on("rp:cuffedUpdate",       onCuffedUpdate);
    socket.on("rp:fineIssued",         onFineIssued);
    socket.on("rp:fineResolved",       onFineResolved);
    socket.on("rp:fineExpired",        onFineExpired);
    socket.on("rp:factionChat",        onFactionChat);

    return () => {
      socket.off("rp:profile",            onProfile);
      socket.off("rp:profileUpdate",      onProfileUpdate);
      socket.off("rp:toast",              onToast);
      socket.off("rp:licenseTestActive",  onLicenseTestActive);
      socket.off("rp:wantedUpdate",       onWantedUpdate);
      socket.off("rp:jailStatus",         onJailStatus);
      socket.off("rp:cuffedUpdate",       onCuffedUpdate);
      socket.off("rp:fineIssued",         onFineIssued);
      socket.off("rp:fineResolved",       onFineResolved);
      socket.off("rp:fineExpired",        onFineExpired);
      socket.off("rp:factionChat",        onFactionChat);
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
  };
}
