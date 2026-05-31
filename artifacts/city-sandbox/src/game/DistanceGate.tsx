import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";

// =============================================================
// DistanceGate — mounts its children ONLY while the camera is within `radius`
// (horizontal X/Z) of `center`. Used to bound the cost of fixed-site real
// lights (Event Hall, landmark accents): Three.js uploads every mounted light
// into every lit material's shader, so a light at a far-away landmark still
// costs frame time everywhere. Gating the JSX means those lights are not in the
// scene graph at all when you're nowhere near them.
//
// Hysteresis (enter < exit) prevents mount/unmount thrash when the player walks
// the threshold. The distance test runs in useFrame but only calls setState on
// a threshold CROSSING, so steady-state cost is a couple of subtractions.
//
// VISUAL-ONLY: no gameplay, collision, coordinates, or networking touched.
// =============================================================
export function DistanceGate({
  center,
  radius = 55,
  hysteresis = 8,
  children,
}: {
  center: readonly [number, number, number];
  radius?: number;
  hysteresis?: number;
  children: ReactNode;
}) {
  const { camera } = useThree();
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);
  const enter2 = radius * radius;
  const exit2 = (radius + hysteresis) * (radius + hysteresis);

  useFrame(() => {
    const dx = camera.position.x - center[0];
    const dz = camera.position.z - center[2];
    const d2 = dx * dx + dz * dz;
    if (!nearRef.current && d2 < enter2) {
      nearRef.current = true;
      setNear(true);
    } else if (nearRef.current && d2 > exit2) {
      nearRef.current = false;
      setNear(false);
    }
  });

  return near ? <>{children}</> : null;
}
