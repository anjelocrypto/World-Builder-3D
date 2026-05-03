import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  ATTACK_LIGHT_DURATION_MS,
  ATTACK_HEAVY_DURATION_MS,
} from "./characterState";
import type { CharacterRuntime } from "./CharacterAvatar";

// =============================================================
// Module-level shared geometries + materials.
// -------------------------------------------------------------
// We render up to ~16 of these characters at once (1 local + many
// remote). Per-instance allocation of box geometries / materials
// would create 100+ extra GL buffers and material upload churn,
// so every character shares one set defined here at module scope.
// =============================================================
const ARM_GEOM = new THREE.BoxGeometry(0.12, 0.5, 0.12);
const LEG_GEOM = new THREE.BoxGeometry(0.16, 0.45, 0.16);
const BODY_GEOM = new THREE.BoxGeometry(0.5, 0.6, 0.3);
const HEAD_GEOM = new THREE.BoxGeometry(0.4, 0.4, 0.4);

const SHIRT_LOCAL_MAT = new THREE.MeshLambertMaterial({ color: "#3498db" });
const SHIRT_REMOTE_MAT = new THREE.MeshLambertMaterial({ color: "#e74c3c" });
const SKIN_MAT = new THREE.MeshLambertMaterial({ color: "#f5cba7" });
const PANTS_MAT = new THREE.MeshLambertMaterial({ color: "#2c3e50" });

interface PlaceholderCharacterProps {
  runtimeRef: React.MutableRefObject<CharacterRuntime>;
  /** Local player gets a different shirt color for self-identification. */
  isLocal?: boolean;
}

/**
 * Procedural placeholder character. Six static boxes (body, head, two
 * arms, two legs) parented to the avatar root, with per-frame pose
 * applied to limb meshes. Zero allocations in useFrame.
 *
 * When GLB assets arrive, swap this component for a useGLTF-based one
 * inside CharacterAvatar — the runtimeRef contract stays the same.
 */
export default function PlaceholderCharacter({
  runtimeRef,
  isLocal = false,
}: PlaceholderCharacterProps) {
  const leftArmRef = useRef<THREE.Mesh>(null!);
  const rightArmRef = useRef<THREE.Mesh>(null!);
  const leftLegRef = useRef<THREE.Mesh>(null!);
  const rightLegRef = useRef<THREE.Mesh>(null!);
  const bodyRef = useRef<THREE.Mesh>(null!);
  const headRef = useRef<THREE.Mesh>(null!);

  // Latch state for one-shot attack replay. When attackSeq STRICTLY
  // INCREMENTS we capture local performance.now() and use it to drive
  // the punch arc — independent of wall-clock, so remote machines with
  // clock skew still play a clean swing. lastSeqRef is initialised
  // from the runtime's current seq so a remote player who has already
  // attacked N times before we joined doesn't false-trigger a punch
  // on first frame. punchKindRef freezes the kind at trigger time so
  // a late-arriving animState change can't reclassify mid-swing.
  const lastSeqRef = useRef(runtimeRef.current.attackSeq);
  const punchStartRef = useRef<number | null>(null);
  const punchKindRef = useRef<"light" | "heavy">("light");

  // Animation phase accumulator (radians). We integrate locally with
  // delta * cycleSpeed instead of multiplying performance.now() so a
  // pause / tab blur doesn't snap the swing to a random phase.
  const phaseRef = useRef(0);

  useFrame((_, delta) => {
    const r = runtimeRef.current;
    const s = r.animState;

    // --- Trigger punch latch on attackSeq strict-increment ---
    // Only `>` (not `!==`) so a server replay that resets seq cannot
    // re-fire the punch, and so the mount-time alignment we did via
    // useRef(runtimeRef.current.attackSeq) is the only source of truth
    // for "what was the last seq we played".
    if (r.attackSeq > lastSeqRef.current) {
      lastSeqRef.current = r.attackSeq;
      punchStartRef.current = performance.now();
      punchKindRef.current = r.attackKind === "heavy" ? "heavy" : "light";
    }

    // --- Phase advance (walk / run / idle bob) ---
    const cycleSpeed =
      s === "run" ? 10 : s === "walk" ? 6 : s === "idle" ? 1.5 : 0;
    phaseRef.current += delta * cycleSpeed;
    const ph = phaseRef.current;

    // --- Default neutral pose, then per-state overrides ---
    let leftLegX = 0;
    let rightLegX = 0;
    let leftArmX = 0;
    let rightArmX = 0;
    let bodyY = 0.7;
    let headY = 1.2;

    if (s === "walk" || s === "run") {
      const amp = s === "run" ? 0.9 : 0.55;
      leftLegX = Math.sin(ph) * amp;
      rightLegX = -Math.sin(ph) * amp;
      leftArmX = -Math.sin(ph) * amp * 0.9;
      rightArmX = Math.sin(ph) * amp * 0.9;
      bodyY = 0.7 + Math.abs(Math.sin(ph * 2)) * 0.03;
      headY = bodyY + 0.5;
    } else if (s === "jump") {
      // Tucked legs, arms slightly back.
      leftLegX = -0.6;
      rightLegX = -0.6;
      leftArmX = -0.4;
      rightArmX = -0.4;
    } else if (s === "fall") {
      // Legs forward, arms out for balance.
      leftLegX = 0.4;
      rightLegX = 0.4;
      leftArmX = 0.5;
      rightArmX = 0.5;
    } else if (s === "idle") {
      // Subtle breathing.
      bodyY = 0.7 + Math.sin(ph) * 0.012;
      headY = bodyY + 0.5;
    }
    // "driving" state is handled by parent visibility toggle; we
    // still pose to neutral so seated body looks sane if shown.

    // --- Punch arc overlay (right arm) ---
    let punchRotX = 0;
    if (punchStartRef.current !== null) {
      const isHeavy = punchKindRef.current === "heavy";
      const dur = isHeavy
        ? ATTACK_HEAVY_DURATION_MS
        : ATTACK_LIGHT_DURATION_MS;
      const t = (performance.now() - punchStartRef.current) / dur;
      if (t >= 1) {
        punchStartRef.current = null;
      } else {
        // Three-stage swing: wind up (-1), snap forward (+1), recover (0).
        let tri: number;
        if (t < 0.4) {
          tri = -t / 0.4; // 0 → -1 wind up
        } else if (t < 0.7) {
          tri = ((t - 0.4) / 0.3) * 2 - 1; // -1 → +1 snap
        } else {
          tri = 1 - (t - 0.7) / 0.3; // +1 → 0 recover
        }
        punchRotX = -Math.PI * 0.5 * tri;
      }
      // While punching, keep legs/left arm steady so the swing reads.
      if (s === "attack_light" || s === "attack_heavy") {
        leftLegX = 0;
        rightLegX = 0;
        leftArmX = 0;
        rightArmX = 0;
      }
    }

    // --- Apply ---
    if (leftLegRef.current) leftLegRef.current.rotation.x = leftLegX;
    if (rightLegRef.current) rightLegRef.current.rotation.x = rightLegX;
    if (leftArmRef.current) leftArmRef.current.rotation.x = leftArmX;
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = rightArmX + punchRotX;
    }
    if (bodyRef.current) bodyRef.current.position.y = bodyY;
    if (headRef.current) headRef.current.position.y = headY;
  });

  const shirt = isLocal ? SHIRT_LOCAL_MAT : SHIRT_REMOTE_MAT;

  return (
    <group>
      {/* Body (torso) */}
      <mesh
        ref={bodyRef}
        geometry={BODY_GEOM}
        material={shirt}
        position={[0, 0.7, 0]}
        castShadow
      />
      {/* Head */}
      <mesh
        ref={headRef}
        geometry={HEAD_GEOM}
        material={SKIN_MAT}
        position={[0, 1.2, 0]}
      />
      {/* Right arm */}
      <mesh
        ref={rightArmRef}
        geometry={ARM_GEOM}
        material={shirt}
        position={[0.31, 0.95, 0]}
      />
      {/* Left arm */}
      <mesh
        ref={leftArmRef}
        geometry={ARM_GEOM}
        material={shirt}
        position={[-0.31, 0.95, 0]}
      />
      {/* Right leg */}
      <mesh
        ref={rightLegRef}
        geometry={LEG_GEOM}
        material={PANTS_MAT}
        position={[0.1, 0.225, 0]}
      />
      {/* Left leg */}
      <mesh
        ref={leftLegRef}
        geometry={LEG_GEOM}
        material={PANTS_MAT}
        position={[-0.1, 0.225, 0]}
      />
    </group>
  );
}
