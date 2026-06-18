import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { NPC_ROUTES } from "../shared/cityData";
import {
  npcPositionAt,
  NPC_STUMBLE_DURATION_MS,
  type NpcStumbleMap,
} from "../shared/collision";
import type { NpcRoute } from "../shared/types";
import CharacterAvatar, { type CharacterRuntime } from "./character/CharacterAvatar";
import { type CharacterId } from "./character/characterCatalog";
import { WALK_THRESH, RUN_THRESH } from "./character/characterState";

interface NPCsProps {
  stumbleRef: React.MutableRefObject<NpcStumbleMap>;
}

// Pool of selectable characters NPC pedestrians draw from. All three have
// idle/walk/run locomotion clips, so they animate correctly as walkers. GLBs
// are shared via the Drei useGLTF URL cache (AnimatedCharacter preloads every
// character once), so adding NPC instances clones meshes but never re-fetches.
const NPC_CHARACTER_POOL: CharacterId[] = ["classic"];

/**
 * Deterministic character for an NPC, chosen by its stable route id (NOT random
 * per render) so the same pedestrian always wears the same model and never
 * flickers between frames. e.g. id 0 → simple, 1 → nemo, 2 → classic, 3 → simple…
 */
export function npcCharacterFor(id: number): CharacterId {
  const n = NPC_CHARACTER_POOL.length;
  return NPC_CHARACTER_POOL[((id % n) + n) % n];
}

interface NpcEntry {
  route: NpcRoute;
  character: CharacterId;
  /** Per-NPC animation runtime read by its CharacterAvatar each frame. A plain
   *  {current} object (stable across renders) — CharacterAvatar only READS it. */
  runtimeRef: React.MutableRefObject<CharacterRuntime>;
  group: THREE.Group | null;
  lastX: number;
  lastZ: number;
  hasLast: boolean;
}

/**
 * Renders all ambient NPC pedestrians defined in cityData.NPC_ROUTES using the
 * SAME selectable character GLB system as players (Simple / Nemo / Classic),
 * assigned deterministically per route id. A SINGLE useFrame walks the array
 * (one shared subscription for positioning), computing each NPC's deterministic
 * route position + heading and a per-frame speed that drives its idle/walk/run
 * animation. Stumble/knockback (offset + tilt + lift) is preserved exactly.
 *
 * Client-only and deterministic — positions come from npcPositionAt(Date.now()),
 * no server/DB. NPCs never attack/talk/die/gethit (attackSeq stays 0, animState
 * is only ever idle/walk/run).
 */
export default function NPCs({ stumbleRef }: NPCsProps) {
  const data = useMemo<NpcEntry[]>(
    () =>
      NPC_ROUTES.map((route) => ({
        route,
        character: npcCharacterFor(route.id),
        runtimeRef: {
          current: {
            animState: "walk",
            speed: 0,
            attackSeq: 0,
            attackKind: null,
            attackStartedAt: null,
          },
        },
        group: null,
        lastX: 0,
        lastZ: 0,
        hasLast: false,
      })),
    [],
  );
  const refs = useRef<NpcEntry[]>(data);

  useFrame((_, delta) => {
    const tMs = Date.now();
    const arr = refs.current;
    const stumbles = stumbleRef.current;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      const g = e.group;
      if (!g) continue;
      const route = e.route;
      const { x, z, rotY: heading } = npcPositionAt(route, tMs);
      const bob = Math.sin(tMs / 220 + route.id) * 0.05;

      // Locomotion animation from the BASE route speed (excludes the transient
      // stumble offset so the walk/idle choice doesn't jitter on a shove).
      const moved = e.hasLast ? Math.hypot(x - e.lastX, z - e.lastZ) : 0;
      const speed = e.hasLast && delta > 0 ? moved / delta : 0;
      const rt = e.runtimeRef.current;
      rt.speed = speed;
      rt.animState =
        speed > RUN_THRESH
          ? "run"
          : speed > WALK_THRESH || !e.hasLast
            ? "walk"
            : "idle";
      e.lastX = x;
      e.lastZ = z;
      e.hasLast = true;

      let offX = 0;
      let offZ = 0;
      let tiltZ = 0;
      let yLift = 0;
      const s = stumbles.get(route.id);
      if (s && s.until > tMs) {
        const remaining = (s.until - tMs) / NPC_STUMBLE_DURATION_MS;
        offX = s.vx * remaining;
        offZ = s.vz * remaining;
        const t = 1 - remaining;
        tiltZ = Math.sin(t * Math.PI) * 0.6;
        yLift = Math.sin(t * Math.PI) * 0.25;
      } else if (s && s.until <= tMs) {
        stumbles.delete(route.id);
      }

      // GLB avatar feet sit at the group origin → y is just the bob/lift; the
      // pedestrians walk on flat city ground (y=0), so no float/sink.
      g.position.set(x + offX, bob + yLift, z + offZ);
      g.rotation.set(0, heading, tiltZ);
    }
  });

  return (
    <group>
      {data.map((e, i) => (
        <group
          key={e.route.id}
          ref={(g) => {
            const entry = refs.current[i];
            if (entry) entry.group = g;
          }}
        >
          <CharacterAvatar runtimeRef={e.runtimeRef} characterId={e.character} />
        </group>
      ))}
    </group>
  );
}
