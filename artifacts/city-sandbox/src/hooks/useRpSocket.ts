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
import type { RpProfile, RpToast } from "../shared/rpTypes";
import { canDriveVehicleClient } from "../shared/rpTypes";

export function useRpSocket(socket: Socket | null) {
  const [rpProfile, setRpProfile] = useState<RpProfile | null>(null);
  const [rpToasts, setRpToasts] = useState<RpToast[]>([]);

  useEffect(() => {
    if (!socket) return;

    const onProfile = (data: RpProfile) => {
      setRpProfile(data);
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

    socket.on("rp:profile",       onProfile);
    socket.on("rp:profileUpdate", onProfileUpdate);
    socket.on("rp:toast",         onToast);

    return () => {
      socket.off("rp:profile",       onProfile);
      socket.off("rp:profileUpdate", onProfileUpdate);
      socket.off("rp:toast",         onToast);
    };
  }, [socket]);

  const dismissToast = useCallback((id: number) => {
    setRpToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Returns true if the local player is allowed to drive `vehicleId`.
   * This is an OPTIMISTIC check — the server enforces it in vehicleUpdate.
   * Use this to skip the emitVehicleUpdate call and avoid a brief visual glitch.
   */
  const canDriveVehicle = useCallback(
    (vehicleId: string): boolean => canDriveVehicleClient(vehicleId, rpProfile),
    [rpProfile],
  );

  return { rpProfile, rpToasts, dismissToast, canDriveVehicle };
}
