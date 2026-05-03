import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { TRAFFIC_ROUTES } from "../shared/cityData";
import { getVehicleGroundY } from "../shared/elevation";
import type { TrafficCarSeed, TrafficRoute } from "../shared/types";
import { CarVisual } from "./VehicleObject";

/**
 * Smallest signed angle from a → b on a circle. Used to interpolate
 * heading across waypoints without spinning the wrong way around.
 */
function shortestAngleDelta(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

interface CarEntry {
  route: TrafficRoute;
  seed: TrafficCarSeed;
  group: THREE.Group | null;
}

/**
 * One useFrame for ALL ambient cars (was one-per-car, ~22 R3F frame
 * subscriptions). Position and heading are still derived from
 * Date.now() + seed.phase per car, so visuals are unchanged; we just
 * pay the scheduler overhead once per frame.
 *
 * Cars also opt OUT of shadow casting via CarVisual castShadow={false}
 * — they're cosmetic and the directional light only renders one
 * shadow map, so removing 22 cars from the caster set is a noticeable
 * win.
 */
export default function AmbientTraffic() {
  const data = useMemo(() => {
    const out: { route: TrafficRoute; seed: TrafficCarSeed }[] = [];
    for (const route of TRAFFIC_ROUTES) {
      for (const seed of route.cars) out.push({ route, seed });
    }
    return out;
  }, []);
  const refs = useRef<CarEntry[]>(data.map((d) => ({ ...d, group: null })));

  useFrame(() => {
    const tMs = Date.now();
    const arr = refs.current;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      const g = e.group;
      if (!g) continue;
      const route = e.route;
      const seed = e.seed;
      const progress = ((tMs / 1000) / route.cycleSeconds + seed.phase) % 1;
      const segCount = route.waypoints.length;
      const segProgress = progress * segCount;
      const segIdx = Math.floor(segProgress) % segCount;
      const segT = segProgress - Math.floor(segProgress);
      const a = route.waypoints[segIdx];
      const b = route.waypoints[(segIdx + 1) % segCount];
      const x = a[0] + (b[0] - a[0]) * segT;
      const z = a[1] + (b[1] - a[1]) * segT;
      const rotY = a[2] + shortestAngleDelta(a[2], b[2]) * segT;
      g.position.set(x, 0.6 + getVehicleGroundY(x, z), z);
      g.rotation.y = rotY;
    }
  });

  return (
    <group>
      {data.map((d, i) => (
        <group
          key={d.seed.id}
          ref={(g) => {
            const e = refs.current[i];
            if (e) e.group = g;
          }}
        >
          <CarVisual
            variant={d.seed.variant}
            color={d.seed.color}
            castShadow={false}
          />
        </group>
      ))}
    </group>
  );
}
