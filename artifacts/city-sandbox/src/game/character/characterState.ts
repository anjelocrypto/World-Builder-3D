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

// Attack timing windows (ms). Must match the actual GLB clip
// durations so the combo lock/release fires when each fight
// animation truly ends — not before (cuts off the swing) and not
// after (lets the next click slip in mid-swing).
//   fight1.glb = 2.50s  → ATTACK_LIGHT_DURATION_MS = 2500
//   fight2.glb = 6.87s  → ATTACK_HEAVY_DURATION_MS = 6870
// Cooldowns equal duration so a new attack of the same kind cannot
// start until the previous one has fully finished playing.
export const ATTACK_LIGHT_DURATION_MS = 2500;
export const ATTACK_LIGHT_COOLDOWN_MS = 2500;
export const ATTACK_HEAVY_DURATION_MS = 6870;
export const ATTACK_HEAVY_COOLDOWN_MS = 6870;

/**
 * Minimum time (ms) an attack pose is held before MOVEMENT is allowed to
 * cancel it. Keeps a quick click readable as a real swing, but lets the
 * player walk/run out of a long attack clip almost immediately instead of
 * staying visually locked for the whole clip. Short enough to feel
 * responsive; long enough that the swing actually shows.
 */
export const ATTACK_MIN_DISPLAY_MS = 250;

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
  /**
   * Character-specific attack clip duration (ms) for the active attackKind.
   * MUST match the real GLB clip length (Classic light=2500, Simple
   * light=5700, etc.). When omitted, falls back to the Classic globals for
   * back-compat. Pass `attackDurationMs(def, kind)` from the catalog.
   */
  attackDurationMs?: number;
}

/**
 * Pure state-machine resolver: decides which animation a character
 * should be playing this frame based on physics + intent. Intentionally
 * free of three.js / React imports so future GLB clip-mapping logic and
 * the placeholder renderer can both consume it.
 *
 * Priority (highest first):
 *   1. inVehicle           → "driving"
 *   2. attack window open AND (not yet past the min display window OR the
 *      player is standing still) → "attack_light" | "attack_heavy".
 *      Once past ATTACK_MIN_DISPLAY_MS, MOVEMENT cancels the attack so
 *      walk/run takes over smoothly instead of the character staying stuck
 *      in the attack pose for the whole (possibly multi-second) clip.
 *   3. airborne            → "jump" (rising) or "fall"
 *   4. ground horiz speed  → "run" | "walk" | "idle"
 */
export function resolveAnimState(i: AnimResolveInput): PlayerAnimState {
  if (i.inVehicle) return "driving";
  if (i.attackStartedAt !== null && i.attackKind !== null) {
    const dur =
      i.attackDurationMs ??
      (i.attackKind === "heavy"
        ? ATTACK_HEAVY_DURATION_MS
        : ATTACK_LIGHT_DURATION_MS);
    const elapsed = i.now - i.attackStartedAt;
    if (elapsed < dur) {
      const moving = i.horizSpeed > WALK_THRESH;
      // Hold the attack pose if: still within the minimum display window, OR
      // the player isn't actually moving. As soon as the player moves (after
      // the brief min window) we drop the attack so locomotion can blend in.
      if (elapsed < ATTACK_MIN_DISPLAY_MS || !moving) {
        return i.attackKind === "heavy" ? "attack_heavy" : "attack_light";
      }
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
