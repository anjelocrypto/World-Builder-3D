import { Suspense } from "react";
import { Html } from "@react-three/drei";
import PlaceholderCharacter from "./PlaceholderCharacter";
import AnimatedCharacter from "./AnimatedCharacter";
import type { PlayerAnimState } from "./characterState";
import { DEFAULT_CHARACTER, type CharacterId } from "./characterCatalog";

/**
 * Per-frame mutable state read by the visual character renderer.
 * The owning component (LocalPlayer or RemotePlayer) updates these
 * fields each frame; CharacterAvatar / AnimatedCharacter never mutate
 * them. This keeps animation reactive without forcing React re-renders
 * 60 times per second.
 */
export interface CharacterRuntime {
  animState: PlayerAnimState;
  /** Horizontal speed in m/s. Reserved for GLB blend trees. */
  speed: number;
  /** Monotonic counter; bump triggers a one-shot attack replay. */
  attackSeq: number;
  /**
   * Which attack kind the most recent seq increment represents.
   * AnimatedCharacter uses this (not animState) to choose which fight
   * clip to play — a heavy/fight2 swing replays as fight2 even if the
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
  /** Which selectable character model to render. */
  characterId?: CharacterId;
}

// =============================================================
// CharacterAvatar — visual wrapper around the active character
// renderer.
// -------------------------------------------------------------
// Today we render AnimatedCharacter (GLB-driven idle/walk/run +
// fight1/fight2). PlaceholderCharacter is kept as the Suspense
// fallback so a slow GLB fetch never leaves the player invisible.
// =============================================================
export default function CharacterAvatar({
  runtimeRef,
  username,
  isLocal = false,
  characterId = DEFAULT_CHARACTER,
}: CharacterAvatarProps) {
  return (
    <group>
      <Suspense
        fallback={
          <PlaceholderCharacter runtimeRef={runtimeRef} isLocal={isLocal} />
        }
      >
        {/* Keyed by characterId so switching characters remounts the GLB
            loader with the correct (fixed) set of useGLTF calls. */}
        <AnimatedCharacter
          key={characterId}
          runtimeRef={runtimeRef}
          isLocal={isLocal}
          characterId={characterId}
        />
      </Suspense>
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
