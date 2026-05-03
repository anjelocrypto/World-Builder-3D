import type { PlayerAnimState } from "../../shared/types";

export type { PlayerAnimState };

// =============================================================
// Tunables (shared by client state machine + visual placeholder)
// =============================================================

// Speed thresholds (m/s). Tuned to match LocalPlayer's WALK_SPEED=5,
// RUN_SPEED=10. Anything below WALK_THRESH is idle; above RUN_THRESH
// is run; in between is walk. Slightly lower than the input speeds
// so the visual animation triggers crisply on key-down, not after
// the movement vector has fully settled.
export const WALK_THRESH = 0.5;
export const RUN_THRESH = 7.0;

// Attack timing windows (ms). The duration drives both the
// placeholder punch animation length and the state-machine window
// during which animState is "attack_light" / "attack_heavy". The
// cooldown gates how soon a new attack of the same kind may start;
// it equals duration for light (no attack-cancel) and is slightly
// longer for heavy.
export const ATTACK_LIGHT_DURATION_MS = 450;
export const ATTACK_LIGHT_COOLDOWN_MS = 450;
export const ATTACK_HEAVY_DURATION_MS = 750;
export const ATTACK_HEAVY_COOLDOWN_MS = 800;

export interface AnimResolveInput {
  inVehicle: boolean;
  /** Wall-clock now in ms (Date.now()). Compared to attackStartedAt. */
  now: number;
  /** ms timestamp of last attack trigger, or null if never attacked. */
  attackStartedAt: number | null;
  /** Which attack kind is currently active (decides which clip plays). */
  attackKind: "light" | "heavy" | null;
  grounded: boolean;
  /** Vertical velocity in m/s. Positive = rising. */
  velY: number;
  /** Horizontal speed magnitude in m/s. */
  horizSpeed: number;
}

/**
 * Pure state-machine resolver: decides which animation a character
 * should be playing this frame based on physics + intent. Intentionally
 * free of three.js / React imports so future GLB clip-mapping logic and
 * the placeholder renderer can both consume it.
 *
 * Priority (highest first):
 *   1. inVehicle           → "driving"
 *   2. attack window open  → "attack_light" | "attack_heavy"
 *   3. airborne            → "jump" (rising) or "fall"
 *   4. ground horiz speed  → "run" | "walk" | "idle"
 */
export function resolveAnimState(i: AnimResolveInput): PlayerAnimState {
  if (i.inVehicle) return "driving";
  if (i.attackStartedAt !== null && i.attackKind !== null) {
    const dur =
      i.attackKind === "heavy"
        ? ATTACK_HEAVY_DURATION_MS
        : ATTACK_LIGHT_DURATION_MS;
    if (i.now - i.attackStartedAt < dur) {
      return i.attackKind === "heavy" ? "attack_heavy" : "attack_light";
    }
  }
  if (!i.grounded) return i.velY > 0 ? "jump" : "fall";
  if (i.horizSpeed > RUN_THRESH) return "run";
  if (i.horizSpeed > WALK_THRESH) return "walk";
  return "idle";
}

/** Set of valid PlayerAnimState values for runtime / network validation. */
export const ANIM_STATES: readonly PlayerAnimState[] = [
  "idle",
  "walk",
  "run",
  "jump",
  "fall",
  "attack_light",
  "attack_heavy",
  "driving",
];
