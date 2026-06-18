import type { PlayerAnimState } from "../../shared/types";

// =============================================================
// Character catalog — selectable player characters.
// -------------------------------------------------------------
// Each character is a set of GLB models that share ONE skeleton, plus
// a mapping from the game's animation states (PlayerAnimState) to the
// clip that should play. AnimatedCharacter loads the "base" model (the
// idle pose) once, clones its skinned mesh, and re-targets every other
// clip onto that clone (Mixamo-style rigs share bone names, so this is
// clean). This file is the SINGLE SOURCE OF TRUTH for which GLBs each
// character uses and how clips map to states.
// =============================================================

const BASE = import.meta.env.BASE_URL;

/** Stable id sent over the wire + persisted in the lobby choice. */
export type CharacterId = "classic";

/** Default character when none is chosen / an unknown id arrives. */
export const DEFAULT_CHARACTER: CharacterId = "classic";

/** One source GLB: its URL and which embedded clip (the first) we extract. */
export interface CharacterClipSource {
  /** Public URL of the GLB (under BASE_URL). */
  url: string;
  /**
   * Semantic key this clip is exposed under after renaming. The state→clip
   * map below references these keys. The GLB's own internal clip name is
   * ignored (we always take the first/only animation in the file).
   */
  clipKey: string;
}

export interface CharacterDef {
  id: CharacterId;
  label: string;
  /**
   * The model whose mesh + skeleton is cloned to render this character.
   * Its clip is also extracted under `baseClipKey`.
   */
  baseUrl: string;
  baseClipKey: string;
  /** Additional source GLBs whose clips are retargeted onto the base mesh. */
  extraClips: CharacterClipSource[];
  /**
   * Map a looping locomotion state to a clip key. Only idle/walk/run are
   * looped; everything else (jump/fall/driving/attack_*) falls through to the
   * airborne clip (when defined) or the idle base pose.
   */
  locomotion: { idle: string; walk: string; run: string };
  /**
   * Optional looping clip played while airborne (animState "jump" or "fall").
   * Omit for characters without a jump animation — they fall back to the idle
   * pose, preserving the original Classic behavior.
   */
  airborneKey?: string;
  /**
   * Optional looping clip played while the player is speaking into the mic
   * (animState "talk"). Omit for characters without a talk animation (Classic)
   * — they fall back to the idle pose, so "talk" is a no-op for them.
   */
  talkKey?: string;
  /**
   * Optional looping clip played while the player is seated on a chair
   * (animState "sit", Phase 14C). Omit for characters without a sitting
   * animation (Classic) — the sit action is only offered to characters that
   * define this key.
   */
  sitKey?: string;
  /**
   * Optional one-shot clip played when the player takes a hit and survives
   * (animState "gethit", Phase 16). Bound to the local car-collision damage in
   * LocalPlayer. Omit for characters without a hit-reaction clip (Classic,
   * Simple) — the reaction is only triggered for characters that define it, so
   * their behavior is unchanged.
   */
  gethitKey?: string;
  /** gethit clip duration (ms) — MUST match the GLB so the reaction window
   * and the visual one-shot agree. Required iff gethitKey is set. */
  gethitMs?: number;
  /**
   * Optional one-shot clip played when the player's health reaches 0
   * (animState "die", Phase 16). Triggers a brief death lock + respawn in
   * LocalPlayer. Omit for characters without a death clip (Classic, Simple) —
   * those characters have no death sequence, preserving the original behavior
   * where reaching 0 HP did nothing.
   */
  dieKey?: string;
  /** die clip duration (ms) — also the death-lock window before respawn.
   * Required iff dieKey is set. */
  dieMs?: number;
  /** One-shot attack clip keys (triggered by attackSeq, not animState). */
  attackLightKey: string;
  attackHeavyKey: string;
  /**
   * Per-character attack clip durations (ms) — MUST match the real GLB clip
   * lengths so the animation-state window and the visual one-shot agree. Used
   * for the attack display window, the combo timing, and the queued-heavy
   * release. (Classic light=fight1 2.50s / heavy=fight2 6.87s; Simple
   * light=punch-combo 5.70s / heavy=leg-kick 2.73s.)
   */
  attackLightMs: number;
  attackHeavyMs: number;
  /**
   * Optional playback rate for the walk locomotion clip. When a character has
   * no dedicated walk clip and reuses a fast run clip for walking (Simple),
   * this slows it so walking doesn't look twitchy. Omit → 1 (Classic has a
   * real walk clip and needs no rescale).
   */
  walkTimeScale?: number;
  /** Uniform scale applied to the rendered group (rig sizing). */
  scale: number;
}

// ── Classic (the original 5-model hero) ──────────────────────────────────
// Unchanged behavior: standing/walking/running + fight1/fight2.
const CLASSIC: CharacterDef = {
  id: "classic",
  label: "Classic",
  baseUrl: `${BASE}models/standing.glb`,
  baseClipKey: "idle",
  extraClips: [
    { url: `${BASE}models/walking.glb`, clipKey: "walk" },
    { url: `${BASE}models/running.glb`, clipKey: "run" },
    { url: `${BASE}models/fight1.glb`, clipKey: "fight1" },
    { url: `${BASE}models/fight2.glb`, clipKey: "fight2" },
  ],
  locomotion: { idle: "idle", walk: "walk", run: "run" },
  attackLightKey: "fight1",
  attackHeavyKey: "fight2",
  attackLightMs: 2500, // fight1.glb = 2.50s
  attackHeavyMs: 6870, // fight2.glb = 6.87s
  scale: 1,
};

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  classic: CLASSIC,
};

/** Ordered list for the lobby picker. */
export const CHARACTER_LIST: ReadonlyArray<CharacterDef> = [CLASSIC];

/** Server/client allowlist of valid ids (mirror the server guard). */
export const CHARACTER_IDS: ReadonlyArray<CharacterId> = ["classic"];

/** Coerce any incoming value to a valid CharacterId (defaults to classic). */
export function normalizeCharacterId(v: unknown): CharacterId {
  return v === "classic" ? v : DEFAULT_CHARACTER;
}

/** Per-character attack clip duration (ms) for a given kind. */
export function attackDurationMs(def: CharacterDef, kind: "light" | "heavy"): number {
  return kind === "heavy" ? def.attackHeavyMs : def.attackLightMs;
}

/** Which looping clip key a locomotion state maps to for a character. */
export function locomotionClipKey(def: CharacterDef, anim: PlayerAnimState): string {
  if (anim === "run") return def.locomotion.run;
  if (anim === "walk") return def.locomotion.walk;
  // Airborne: use the jump/fall clip when the character defines one, else the
  // idle base pose (Classic has no jump clip → unchanged idle fallback).
  if ((anim === "jump" || anim === "fall") && def.airborneKey) return def.airborneKey;
  // Talk: use the talk clip when the character defines one (Simple), else fall
  // back to idle (Classic has no talk clip → renders idle, so talk is a no-op).
  if (anim === "talk" && def.talkKey) return def.talkKey;
  // Sit: use the sitting clip when the character defines one (Simple). The sit
  // action is only offered to characters with a sitKey, so this never falls back.
  if (anim === "sit" && def.sitKey) return def.sitKey;
  return def.locomotion.idle; // idle / driving / attack_* / talk|sit-without-clip
}
