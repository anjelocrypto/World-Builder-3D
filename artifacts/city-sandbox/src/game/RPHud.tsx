/**
 * RPHud — ephemeral RP notification overlay (toast stack).
 *
 * Mounted outside the Canvas as a DOM overlay in GameScene. Renders rp:toast
 * messages received from the server. Cash / bank / license status is rendered
 * in the main HUD component (HUD.tsx) as persistent chrome, not here.
 *
 * Toasts auto-dismiss after their `duration` ms (default 3 s). The stack is
 * capped at 5 items by useRpSocket; new arrivals push older ones off the top.
 */

import { useEffect } from "react";
import type { RpToast } from "../shared/rpTypes";

interface RPHudProps {
  toasts:          RpToast[];
  onDismissToast:  (id: number) => void;
}

/** Map a color string to a CSS border + text colour pair. */
function toastColors(color: string): { border: string; text: string } {
  switch (color) {
    case "red":    return { border: "#ff4444", text: "#ffaaaa" };
    case "green":  return { border: "#44dd88", text: "#aaffcc" };
    case "blue":   return { border: "#4488ff", text: "#aaccff" };
    case "yellow": return { border: "#ffcc33", text: "#ffeeaa" };
    default:       return { border: color,     text: "#ffffff" };
  }
}

export default function RPHud({ toasts, onDismissToast }: RPHudProps) {
  // Auto-dismiss each toast after its duration. We watch the toast array and
  // schedule a timeout for the most recently added entry.
  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    const timer = setTimeout(
      () => onDismissToast(latest.id),
      latest.duration ?? 3000,
    );
    return () => clearTimeout(timer);
  }, [toasts, onDismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position:      "absolute",
        top:           80,
        left:          "50%",
        transform:     "translateX(-50%)",
        display:       "flex",
        flexDirection: "column",
        alignItems:    "center",
        gap:           8,
        pointerEvents: "none",
        userSelect:    "none",
        zIndex:        200,
      }}
    >
      {toasts.map((toast) => {
        const { border, text } = toastColors(toast.color);
        return (
          <div
            key={toast.id}
            style={{
              padding:         "8px 20px",
              borderRadius:    8,
              fontSize:        14,
              fontFamily:      "'Courier New', monospace",
              backgroundColor: "rgba(0, 0, 0, 0.80)",
              border:          `1px solid ${border}`,
              color:           text,
              textShadow:      "0 0 4px #000",
              maxWidth:        420,
              textAlign:       "center",
              lineHeight:      1.4,
            }}
          >
            {toast.msg}
          </div>
        );
      })}
    </div>
  );
}
