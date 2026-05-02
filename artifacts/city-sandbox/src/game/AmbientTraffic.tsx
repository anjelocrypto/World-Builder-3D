import * as THREE from "three";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { TRAFFIC_ROUTES } from "../shared/cityData";
import type { TrafficCarSeed, TrafficRoute, VehicleVariant } from "../shared/types";
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

interface TrafficCarProps {
  route: TrafficRoute;
  seed: TrafficCarSeed;
}

/**
 * A single AI car looping a TrafficRoute. Position is fully deterministic
 * from `Date.now()` + seed.phase, so all clients see roughly the same
 * traffic without any network sync. Non-enterable, no collision — purely
 * cosmetic life.
 */
function TrafficCar({ route, seed }: TrafficCarProps) {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!groupRef.current) return;
    const tMs = Date.now();
    const progress = ((tMs / 1000) / route.cycleSeconds + seed.phase) % 1;
    const segCount = route.waypoints.length;
    const segProgress = progress * segCount;
    const segIdx = Math.floor(segProgress) % segCount;
    const segT = segProgress - Math.floor(segProgress);

    const a = route.waypoints[segIdx];
    const b = route.waypoints[(segIdx + 1) % segCount];
    const x = a[0] + (b[0] - a[0]) * segT;
    const z = a[1] + (b[1] - a[1]) * segT;

    const rotA = a[2];
    const rotB = b[2];
    const rotY = rotA + shortestAngleDelta(rotA, rotB) * segT;

    groupRef.current.position.set(x, 0.6, z);
    groupRef.current.rotation.y = rotY;
  });

  const variant: VehicleVariant = seed.variant;

  return (
    <group ref={groupRef}>
      <CarVisual variant={variant} color={seed.color} />
    </group>
  );
}

/**
 * Spawns one TrafficCar for each car-seed in TRAFFIC_ROUTES. Renders
 * 4 ambient cars total looping the outer perimeter. Client-only.
 */
export default function AmbientTraffic() {
  return (
    <group>
      {TRAFFIC_ROUTES.flatMap((route) =>
        route.cars.map((seed) => (
          <TrafficCar key={seed.id} route={route} seed={seed} />
        ))
      )}
    </group>
  );
}
