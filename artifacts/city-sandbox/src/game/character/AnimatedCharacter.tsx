import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import type { CharacterRuntime } from "./CharacterAvatar";

const BASE = import.meta.env.BASE_URL;
const MODEL_STANDING = `${BASE}models/standing.glb`;
const MODEL_WALKING = `${BASE}models/walking.glb`;
const MODEL_RUNNING = `${BASE}models/running.glb`;
const MODEL_FIGHT1 = `${BASE}models/fight1.glb`;
const MODEL_FIGHT2 = `${BASE}models/fight2.glb`;

useGLTF.preload(MODEL_STANDING);
useGLTF.preload(MODEL_WALKING);
useGLTF.preload(MODEL_RUNNING);
useGLTF.preload(MODEL_FIGHT1);
useGLTF.preload(MODEL_FIGHT2);

const FADE = 0.18;

interface AnimatedCharacterProps {
  runtimeRef: React.MutableRefObject<CharacterRuntime>;
  isLocal?: boolean;
}

/**
 * GLB-driven character. Loads 5 source models (standing / walking /
 * running / fight1 / fight2). Each ships with one embedded clip; we
 * extract those clips and bind them ALL to a single cloned standing
 * mesh's mixer (the rigs share a Mixamo-style skeleton, so the
 * fight clips re-target onto the standing skeleton cleanly).
 *
 * State → clip mapping:
 *   idle  → "idle"  (looped)
 *   walk  → "walk"  (looped)
 *   run   → "run"   (looped)
 *   jump/fall/driving → fall back to idle pose
 *   attack_light  → "fight1" one-shot, plays over current loop
 *   attack_heavy  → "fight2" one-shot, plays over current loop
 *
 * One-shot attacks are triggered by attackSeq strict-increment, NOT by
 * animState — same pattern as PlaceholderCharacter — so a second fight
 * queued by LocalPlayer fires the moment the queued attackSeq bump
 * arrives, regardless of any animState transitions in between.
 */
export default function AnimatedCharacter({
  runtimeRef,
  isLocal = false,
}: AnimatedCharacterProps) {
  const standing = useGLTF(MODEL_STANDING);
  const walking = useGLTF(MODEL_WALKING);
  const running = useGLTF(MODEL_RUNNING);
  const fight1 = useGLTF(MODEL_FIGHT1);
  const fight2 = useGLTF(MODEL_FIGHT2);

  // Per-instance skinned-mesh clone. SkeletonUtils.clone preserves
  // the bone hierarchy so the mixer can drive it independently of
  // other character instances.
  const cloned = useMemo(
    () => SkeletonUtils.clone(standing.scene),
    [standing.scene],
  );

  // Cast shadows on every mesh in the cloned hierarchy.
  useEffect(() => {
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        // Tint the shirt-ish material so the local player is visually
        // distinct from remote players, without altering the GLB asset.
        const mesh = obj as THREE.Mesh;
        if (Array.isArray(mesh.material)) return;
        // Optional: only re-tint if user opts in; left disabled to
        // preserve the artist's authored albedo.
      }
    });
  }, [cloned, isLocal]);

  // Re-name each source clip to its semantic state so useAnimations
  // exposes them under stable keys regardless of how the artist named
  // the original take in Blender / Mixamo.
  const clips = useMemo(() => {
    const named: THREE.AnimationClip[] = [];
    const pickFirst = (arr: THREE.AnimationClip[], name: string) => {
      const first = arr[0];
      if (!first) return;
      const c = first.clone();
      c.name = name;
      named.push(c);
    };
    pickFirst(standing.animations, "idle");
    pickFirst(walking.animations, "walk");
    pickFirst(running.animations, "run");
    pickFirst(fight1.animations, "fight1");
    pickFirst(fight2.animations, "fight2");
    return named;
  }, [
    standing.animations,
    walking.animations,
    running.animations,
    fight1.animations,
    fight2.animations,
  ]);

  const groupRef = useRef<THREE.Group>(null);
  const { actions, mixer } = useAnimations(clips, groupRef);

  // Currently-playing locomotion clip name. We cross-fade between
  // "idle"/"walk"/"run". Attacks (fight1/fight2) play one-shot ON TOP
  // of the locomotion clip via additive-style overlap (same mixer,
  // separate action, fade in fast / fade out fast).
  const currentLocoRef = useRef<string | null>(null);
  const lastSeqRef = useRef(runtimeRef.current.attackSeq);
  const activeAttackRef = useRef<THREE.AnimationAction | null>(null);

  // Start idle loop on mount once actions are bound.
  useEffect(() => {
    const idle = actions["idle"];
    if (idle) {
      idle.reset().fadeIn(FADE).play();
      currentLocoRef.current = "idle";
    }
    // Configure fight clips as one-shot.
    for (const name of ["fight1", "fight2"]) {
      const a = actions[name];
      if (a) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = false;
      }
    }
    return () => {
      // Stop everything on unmount so the mixer doesn't leak time
      // into a detached scene.
      for (const a of Object.values(actions)) a?.stop();
    };
  }, [actions]);

  // Clear the active-attack ref when its clip finishes so a new fight
  // can be triggered immediately by attackSeq.
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

    // --- One-shot fight trigger on attackSeq strict-increment ---
    if (r.attackSeq > lastSeqRef.current) {
      lastSeqRef.current = r.attackSeq;
      const which = r.attackKind === "heavy" ? "fight2" : "fight1";
      const next = actions[which];
      if (next) {
        // Stop any in-flight attack so a queued fight2 cleanly takes
        // over from a tail-end fight1 cross-fade.
        if (activeAttackRef.current && activeAttackRef.current !== next) {
          activeAttackRef.current.fadeOut(FADE * 0.5);
        }
        next.reset().setLoop(THREE.LoopOnce, 1).fadeIn(FADE * 0.5).play();
        activeAttackRef.current = next;
      }
    }

    // --- Locomotion loop selection ---
    let target: string;
    if (r.animState === "run") target = "run";
    else if (r.animState === "walk") target = "walk";
    else target = "idle"; // idle / jump / fall / driving / attack_*

    if (currentLocoRef.current !== target) {
      const next = actions[target];
      const prev = currentLocoRef.current
        ? actions[currentLocoRef.current]
        : null;
      if (next) next.reset().fadeIn(FADE).play();
      if (prev && prev !== next) prev.fadeOut(FADE);
      currentLocoRef.current = target;
    }
  });

  // Mixamo / generic male rigs typically export at meter scale with
  // the character ~1.8m tall, which matches our PLAYER_HEIGHT (1.2m
  // body center → ~1.8m total). Drop scale slightly so the GLB hero
  // sits roughly where the placeholder boxes did. Adjust if the rig
  // visibly clips terrain.
  return (
    <group ref={groupRef} scale={[1, 1, 1]}>
      <primitive object={cloned} />
    </group>
  );
}
