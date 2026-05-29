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
export type CharacterId = "classic" | "simple";

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
  /** One-shot attack clip keys (triggered by attackSeq, not animState). */
  attackLightKey: string;
  attackHeavyKey: string;
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
  scale: 1,
};

// ── Simple (9 GLBs, one shared 24-joint rig) ─────────────────────────────
// Clip durations (measured): idle 10.0s, run 0.5s, jump 1.93s,
// punch-combo 5.70s, leg-kick 2.73s, block 2.57s, die 2.27s,
// gethit 1.27s, talk 4.0s. There is no dedicated walk clip, so walk
// reuses the run clip (AnimatedCharacter time-scales nothing; run reads
// fine at walking pace). block/die/gethit/talk are LOADED (so they're
// ready) but intentionally left unbound — there is no block / death /
// hit-reaction / talk game mechanic yet, so nothing triggers them.
const SIMPLE: CharacterDef = {
  id: "simple",
  label: "Simple",
  baseUrl: `${BASE}models/simple-idle.glb`,
  baseClipKey: "idle",
  extraClips: [
    { url: `${BASE}models/simple-run.glb`, clipKey: "run" },
    { url: `${BASE}models/simple-jump.glb`, clipKey: "jump" },
    { url: `${BASE}models/simple-punch-combo-1.glb`, clipKey: "punch" },
    { url: `${BASE}models/simple-leg-kick.glb`, clipKey: "kick" },
    // Loaded + ready, but unbound (no matching game mechanic yet):
    { url: `${BASE}models/simple-block.glb`, clipKey: "block" },
    { url: `${BASE}models/simple-die.glb`, clipKey: "die" },
    { url: `${BASE}models/simple-gethit.glb`, clipKey: "gethit" },
    { url: `${BASE}models/simple-talk.glb`, clipKey: "talk" },
  ],
  locomotion: { idle: "idle", walk: "run", run: "run" },
  airborneKey: "jump",
  attackLightKey: "punch",
  attackHeavyKey: "kick",
  scale: 1,
};

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  classic: CLASSIC,
  simple: SIMPLE,
};

/** Ordered list for the lobby picker. */
export const CHARACTER_LIST: ReadonlyArray<CharacterDef> = [CLASSIC, SIMPLE];

/** Server/client allowlist of valid ids (mirror the server guard). */
export const CHARACTER_IDS: ReadonlyArray<CharacterId> = ["classic", "simple"];

/** Coerce any incoming value to a valid CharacterId (defaults to classic). */
export function normalizeCharacterId(v: unknown): CharacterId {
  return v === "simple" || v === "classic" ? v : DEFAULT_CHARACTER;
}

/** Which looping clip key a locomotion state maps to for a character. */
export function locomotionClipKey(def: CharacterDef, anim: PlayerAnimState): string {
  if (anim === "run") return def.locomotion.run;
  if (anim === "walk") return def.locomotion.walk;
  // Airborne: use the jump/fall clip when the character defines one, else the
  // idle base pose (Classic has no jump clip → unchanged idle fallback).
  if ((anim === "jump" || anim === "fall") && def.airborneKey) return def.airborneKey;
  return def.locomotion.idle; // idle / driving / attack_* / airborne-without-clip
}
