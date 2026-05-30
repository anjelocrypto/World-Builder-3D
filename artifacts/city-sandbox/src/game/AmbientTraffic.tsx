import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { TRAFFIC_ROUTES, VARIANT_DIMENSIONS } from "../shared/cityData";
import { getVehicleGroundFrame } from "../shared/elevation";
import { ambientCarStateAt } from "../shared/collision";
import type { TrafficCarSeed, TrafficRoute } from "../shared/types";
import { CarVisual } from "./VehicleObject";

const VEHICLE_BODY_LIFT = 0.6;

interface CarEntry {
  route: TrafficRoute;
  seed: TrafficCarSeed;
  group: THREE.Group | null;
  pitch: number;
  roll: number;
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
  const refs = useRef<CarEntry[]>(
    data.map((d) => ({ ...d, group: null, pitch: 0, roll: 0 })),
  );

  useFrame(() => {
    const tMs = Date.now();
    const arr = refs.current;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      const g = e.group;
      if (!g) continue;
      const route = e.route;
      const seed = e.seed;
      // Phase 15B: position + heading come from the SHARED helper so the visual
      // car and the player's collision/damage box agree exactly. Heading is the
      // current segment tangent (no sideways drift on straights).
      const { x, z, rotY } = ambientCarStateAt(route, seed, tMs);
      // 4-wheel ground frame: places the car center on the average of
      // the four tire-contact ground samples and tilts it to match
      // mountain road slope (pitch on climbs, roll on switchbacks).
      const dim =
        (seed.variant && VARIANT_DIMENSIONS[seed.variant]) ??
        VARIANT_DIMENSIONS.sedan;
      const wheelbase = dim.bodyD - 2.0;
      const trackWidth = dim.bodyW + 0.04;
      const frame = getVehicleGroundFrame(x, z, rotY, wheelbase, trackWidth);
      g.position.set(x, frame.centerY + VEHICLE_BODY_LIFT, z);
      g.rotation.y = rotY;
      // Smooth pitch/roll so micro-jitter on coarse heightfield samples
      // doesn't make ambient cars vibrate.
      e.pitch += (frame.pitch - e.pitch) * 0.2;
      e.roll += (frame.roll - e.roll) * 0.2;
      g.rotation.x = e.pitch;
      g.rotation.z = e.roll;
    }
  });

  return (
    <group>
      {data.map((d, i) => (
        <group
          key={d.seed.id}
          // YXZ rotation order so per-frame yaw + pitch + roll compose
          // in the order a real vehicle experiences them (heading, then
          // climb, then bank). Required for the slope visuals on the
          // mountain switchbacks; default XYZ would shear the body.
          rotation={new THREE.Euler(0, 0, 0, "YXZ")}
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
