import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PlayerState } from "../shared/types";
import CharacterAvatar, {
  type CharacterRuntime,
} from "./character/CharacterAvatar";

interface RemotePlayerProps {
  state: PlayerState;
  /** Phase 6C: true while this remote player is cuffed. Shows a red ring indicator. */
  isCuffed?: boolean;
}

// Remote player root sits at FEET level (state.y is the player body
// center, matching LocalPlayer's pos.y convention). The avatar is
// authored with feet at local-y=0, so we offset the root down by half
// the player height (0.6) when placing it in world space.
const HALF_HEIGHT = 0.6;

export default function RemotePlayer({ state, isCuffed = false }: RemotePlayerProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const targetPos = useRef(
    new THREE.Vector3(state.x, state.y - HALF_HEIGHT, state.z),
  );
  const lastSnapPos = useRef(new THREE.Vector3(state.x, state.y, state.z));
  const lastSnapTime = useRef(performance.now());
  const lastSpeedEst = useRef(0);

  const runtimeRef = useRef<CharacterRuntime>({
    animState: state.animState ?? "idle",
    speed: state.moveSpeed ?? 0,
    attackSeq: state.attackSeq ?? 0,
    attackKind: state.attackKind ?? null,
    attackStartedAt: state.attackStartedAt ?? null,
  });

  useFrame(() => {
    if (!groupRef.current) return;

    // Smoothly chase the latest server snapshot.
    targetPos.current.set(state.x, state.y - HALF_HEIGHT, state.z);
    groupRef.current.position.lerp(targetPos.current, 0.15);
    groupRef.current.rotation.y +=
      (state.rotY - groupRef.current.rotation.y) * 0.15;
    groupRef.current.visible = !state.isInVehicle;

    // Speed: prefer server-provided moveSpeed; else estimate from
    // snapshot deltas (back-compat with older clients that don't
    // report moveSpeed). Snapshot-derived speed only refreshes when
    // a new snapshot arrives, so we cache the last estimate between
    // updates instead of letting it drift to 0 mid-tick.
    let speed = state.moveSpeed;
    if (typeof speed !== "number") {
      if (
        state.x !== lastSnapPos.current.x ||
        state.z !== lastSnapPos.current.z
      ) {
        const tNow = performance.now();
        const dt = Math.max(0.001, (tNow - lastSnapTime.current) / 1000);
        const dx = state.x - lastSnapPos.current.x;
        const dz = state.z - lastSnapPos.current.z;
        lastSpeedEst.current = Math.hypot(dx, dz) / dt;
        lastSnapPos.current.set(state.x, state.y, state.z);
        lastSnapTime.current = tNow;
      }
      speed = lastSpeedEst.current;
    }

    runtimeRef.current.animState = state.animState ?? "idle";
    runtimeRef.current.speed = speed;
    runtimeRef.current.attackSeq = state.attackSeq ?? 0;
    runtimeRef.current.attackKind = state.attackKind ?? null;
    runtimeRef.current.attackStartedAt = state.attackStartedAt ?? null;
  });

  return (
    <group
      ref={groupRef}
      position={[state.x, state.y - HALF_HEIGHT, state.z]}
    >
      <CharacterAvatar
        runtimeRef={runtimeRef}
        username={state.username}
        isLocal={false}
      />
      {/* Phase 6C: cuff indicator — small red torus ring above the player's head */}
      {isCuffed && (
        <mesh position={[0, 2.4, 0]}>
          <torusGeometry args={[0.28, 0.045, 8, 24]} />
          <meshStandardMaterial color="#ff2222" emissive="#ff0000" emissiveIntensity={1.2} />
        </mesh>
      )}
    </group>
  );
}
