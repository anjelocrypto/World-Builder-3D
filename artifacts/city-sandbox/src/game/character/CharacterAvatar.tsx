import { Html } from "@react-three/drei";
import PlaceholderCharacter from "./PlaceholderCharacter";
import type { PlayerAnimState } from "./characterState";

/**
 * Per-frame mutable state read by the visual character renderer.
 * The owning component (LocalPlayer or RemotePlayer) updates these
 * fields each frame; CharacterAvatar / PlaceholderCharacter never
 * mutate them. This keeps animation reactive without forcing React
 * re-renders 60 times per second.
 */
export interface CharacterRuntime {
  animState: PlayerAnimState;
  /** Horizontal speed in m/s. Reserved for GLB blend trees. */
  speed: number;
  /** Monotonic counter; bump triggers a one-shot attack replay. */
  attackSeq: number;
  /**
   * Which attack kind the most recent seq increment represents.
   * PlaceholderCharacter uses this (not animState) to choose the
   * punch duration, so a heavy swing replays as heavy even if the
   * animState packet that carried "attack_heavy" arrived late.
   */
  attackKind: "light" | "heavy" | null;
  /** ms timestamp of the last attack (server-authoritative). */
  attackStartedAt: number | null;
}

interface CharacterAvatarProps {
  runtimeRef: React.MutableRefObject<CharacterRuntime>;
  /** Floating name label; shown only for non-local players. */
  username?: string;
  /** Local player gets a different shirt color. */
  isLocal?: boolean;
}

// =============================================================
// CharacterAvatar — visual wrapper around PlaceholderCharacter.
// -------------------------------------------------------------
// Rendering and per-frame pose updates live in PlaceholderCharacter.
// CharacterAvatar's responsibility is to (a) own the swap point
// for placeholder vs GLB-driven character, and (b) attach the
// in-world name label for remote players.
//
// === Future GLB integration plan ===
// When /characters/player.glb (and animation clips) are added to
// the project's public/ folder, this component should grow:
//
//   import { useGLTF, useAnimations } from "@react-three/drei";
//   const USE_GLB = true; // toggle once /characters/player.glb exists
//   if (USE_GLB) {
//     const { scene, animations } = useGLTF("/characters/player.glb");
//     const { actions } = useAnimations(animations, scene);
//     // Clip name → PlayerAnimState mapping (configure to match your rig):
//     //   idle, walk, run, jump, fall, attack_light, attack_heavy, driving
//     // useFrame: crossfade actions[runtimeRef.current.animState] in,
//     //   fade previous out over ~0.15s. Trigger one-shot replays of
//     //   attack_* clips when runtimeRef.current.attackSeq changes.
//     return <primitive object={scene} />;
//   }
//
// We intentionally do NOT import useGLTF until a GLB exists — calling
// useGLTF on a missing path throws during render. The placeholder must
// run by itself today.
// =============================================================
export default function CharacterAvatar({
  runtimeRef,
  username,
  isLocal = false,
}: CharacterAvatarProps) {
  return (
    <group>
      <PlaceholderCharacter runtimeRef={runtimeRef} isLocal={isLocal} />
      {username && !isLocal && (
        <Html position={[0, 1.85, 0]} center distanceFactor={10}>
          <div
            style={{
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "12px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              fontFamily: "monospace",
            }}
          >
            {username}
          </div>
        </Html>
      )}
    </group>
  );
}
