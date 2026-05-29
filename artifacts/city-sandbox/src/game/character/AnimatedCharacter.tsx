import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import type { CharacterRuntime } from "./CharacterAvatar";
import {
  CHARACTERS,
  CHARACTER_LIST,
  DEFAULT_CHARACTER,
  locomotionClipKey,
  type CharacterId,
} from "./characterCatalog";

// Preload every GLB for every character at module load (after the Game
// chunk is lazy-imported, i.e. only once the user has joined). useGLTF
// caches by URL, so the per-character useGLTF(...) calls below are cheap
// cache hits.
for (const def of CHARACTER_LIST) {
  useGLTF.preload(def.baseUrl);
  for (const e of def.extraClips) useGLTF.preload(e.url);
}

const FADE = 0.18;

interface AnimatedCharacterProps {
  runtimeRef: React.MutableRefObject<CharacterRuntime>;
  isLocal?: boolean;
  /** Which character to render. Defaults to the classic hero. */
  characterId?: CharacterId;
}

/**
 * GLB-driven character, configured by the character catalog.
 *
 * For the selected character it loads the base model (idle pose) + every
 * extra clip GLB, clones the base skinned mesh, and binds all clips to one
 * mixer (the rigs within a character share a skeleton, so the clips
 * re-target cleanly). State → clip mapping comes from the catalog:
 *   idle/walk/run → looped locomotion clip (walk may be time-scaled, e.g.
 *                   Simple reuses its run clip slowed for walking)
 *   jump/fall     → the character's airborneKey clip when defined (Simple),
 *                   else fall back to the idle pose (Classic)
 *   driving       → idle pose
 *   attack_light/attack_heavy → one-shot clip played over the locomotion loop
 *
 * One-shot attacks are triggered by attackSeq strict-increment (NOT by
 * animState) so a queued second attack fires the moment its seq bump arrives.
 * They are faded out as soon as animState leaves the attack window, so the
 * character returns to walk/run smoothly instead of holding the swing pose.
 *
 * NOTE: hooks must run unconditionally, so this component is keyed by
 * characterId at the call site (CharacterAvatar) — a character change
 * remounts it with a fresh, correctly-sized set of useGLTF calls.
 */
export default function AnimatedCharacter({
  runtimeRef,
  isLocal = false,
  characterId = DEFAULT_CHARACTER,
}: AnimatedCharacterProps) {
  const def = CHARACTERS[characterId] ?? CHARACTERS[DEFAULT_CHARACTER];

  // Load the base model + every extra clip GLB for THIS character. The URL
  // list is fixed for a given characterId (the component is remounted via
  // key when the id changes), so the hook order stays stable per mount.
  const base = useGLTF(def.baseUrl);
  const extras = def.extraClips.map((e) => useGLTF(e.url));

  // Per-instance skinned-mesh clone so the mixer drives it independently.
  const cloned = useMemo(
    () => SkeletonUtils.clone(base.scene),
    [base.scene],
  );

  useEffect(() => {
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [cloned, isLocal]);

  // Extract the first clip from each source GLB and rename it to its catalog
  // clipKey, so useAnimations exposes stable keys regardless of the artist's
  // Blender/Mixamo take names.
  const clips = useMemo(() => {
    const named: THREE.AnimationClip[] = [];
    const pickFirst = (arr: THREE.AnimationClip[], name: string) => {
      const first = arr[0];
      if (!first) return;
      const c = first.clone();
      c.name = name;
      named.push(c);
    };
    pickFirst(base.animations, def.baseClipKey);
    def.extraClips.forEach((e, i) => pickFirst(extras[i]?.animations ?? [], e.clipKey));
    return named;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.animations, ...extras.map((x) => x.animations), def]);

  const groupRef = useRef<THREE.Group>(null);
  const { actions, mixer } = useAnimations(clips, groupRef);

  const currentLocoRef = useRef<string | null>(null);
  const lastSeqRef = useRef(runtimeRef.current.attackSeq);
  const activeAttackRef = useRef<THREE.AnimationAction | null>(null);

  // Start idle loop; configure the two attack clips as one-shot.
  useEffect(() => {
    const idle = actions[def.locomotion.idle];
    if (idle) {
      idle.reset().fadeIn(FADE).play();
      currentLocoRef.current = def.locomotion.idle;
    }
    for (const key of [def.attackLightKey, def.attackHeavyKey]) {
      const a = actions[key];
      if (a) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = false;
      }
    }
    return () => {
      for (const a of Object.values(actions)) a?.stop();
    };
  }, [actions, def]);

  // Clear the active-attack ref when its clip finishes.
  useEffect(() => {
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (activeAttackRef.current === e.action) {
        e.action.fadeOut(FADE);
        activeAttackRef.current = null;
      }
    };
    mixer.addEventListener("finished", onFinished);
    return () => mixer.removeEventListener("finished", onFinished);
  }, [mixer]);

  useFrame(() => {
    const r = runtimeRef.current;

    // --- One-shot attack on attackSeq strict-increment ---
    if (r.attackSeq > lastSeqRef.current) {
      lastSeqRef.current = r.attackSeq;
      const which = r.attackKind === "heavy" ? def.attackHeavyKey : def.attackLightKey;
      const next = actions[which];
      if (next) {
        if (activeAttackRef.current && activeAttackRef.current !== next) {
          activeAttackRef.current.fadeOut(FADE * 0.5);
        }
        next.reset().setLoop(THREE.LoopOnce, 1).fadeIn(FADE * 0.5).play();
        activeAttackRef.current = next;
      }
    }

    // --- Cancel a still-playing attack as soon as the STATE leaves the attack
    // window. The state machine (resolveAnimState) drops attack_* the moment
    // the player moves past the min display window; without this the one-shot
    // attack action would keep playing (and dominate) until the clip's own
    // `finished` event, leaving the character visually stuck mid-swing while
    // walking. Fading it here hands locomotion back cleanly.
    if (
      activeAttackRef.current &&
      r.animState !== "attack_light" &&
      r.animState !== "attack_heavy"
    ) {
      activeAttackRef.current.fadeOut(FADE);
      activeAttackRef.current = null;
    }

    // --- Locomotion loop selection ---
    const target = locomotionClipKey(def, r.animState);
    if (currentLocoRef.current !== target) {
      const next = actions[target];
      const prev = currentLocoRef.current ? actions[currentLocoRef.current] : null;
      if (next) {
        next.reset();
        // Simple has no walk clip and reuses the fast run clip for walking;
        // slow it via the per-character walkTimeScale so walking doesn't look
        // sprinty. All other states play at native rate.
        next.timeScale =
          r.animState === "walk" && def.walkTimeScale ? def.walkTimeScale : 1;
        next.fadeIn(FADE).play();
      }
      if (prev && prev !== next) prev.fadeOut(FADE);
      currentLocoRef.current = target;
    }
  });

  return (
    <group ref={groupRef} scale={[def.scale, def.scale, def.scale]}>
      <primitive object={cloned} />
    </group>
  );
}
