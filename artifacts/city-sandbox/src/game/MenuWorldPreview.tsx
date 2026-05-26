import { Component, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { configureWorldRenderer } from "./rendererConfig";
import CityMap from "./CityMap";
import BiomeRender from "./BiomeRender";
import AmbientTraffic from "./AmbientTraffic";
import NPCs from "./NPCs";
import DayNightController from "./DayNightController";
import type { NpcStumbleMap } from "../shared/collision";

// =============================================================
// MenuWorldPreview — cinematic 3D background for the lobby.
// -------------------------------------------------------------
// Renders the SAME world the game uses (CityMap + BiomeRender +
// AmbientTraffic + DayNightController + NPCs) but WITHOUT any
// multiplayer surface area:
//   - No socket connection (no useSocket here).
//   - No LocalPlayer / RemotePlayer (so no character-GLB load on
//     the menu, which keeps first-paint fast).
//   - No HUD / KeyboardControls / pointer lock.
// A purely time-driven MenuCameraRig pans the camera through five
// designed shots on a smoothstep ease loop so the lobby feels alive.
// =============================================================

// Cinematic shots. Each shot has the desired camera position and the
// point the camera is looking at. The rig blends between shots with
// smoothstep easing so transitions feel filmic rather than linear.
type Shot = { pos: [number, number, number]; lookAt: [number, number, number] };
const SHOTS: Shot[] = [
  { pos: [130, 55, 160], lookAt: [0, 25, 0] }, // SE skyline approach
  { pos: [-180, 70, 80], lookAt: [0, 20, -20] }, // NW high-angle skyline
  { pos: [40, 35, 260], lookAt: [0, 10, 150] }, // looking down south arterial
  { pos: [120, 85, -360], lookAt: [0, 18, -300] }, // northern mountain pass
  { pos: [300, 60, 40], lookAt: [100, 12, 0] }, // east ridge → city return
];
const SHOT_HOLD = 7.0; // seconds the camera lingers near each shot
const SHOT_BLEND = 3.0; // seconds of crossfade into the next shot
const SHOT_CYCLE = SHOT_HOLD + SHOT_BLEND; // 10s per shot → 50s loop

function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function MenuCameraRig() {
  const { camera } = useThree();
  // Smoothed look target — separate from the desired shot lookAt so
  // the aim never snaps when shots change.
  const smoothedLook = useRef(new THREE.Vector3(SHOTS[0].lookAt[0], SHOTS[0].lookAt[1], SHOTS[0].lookAt[2]));
  const smoothedPos = useRef(new THREE.Vector3(SHOTS[0].pos[0], SHOTS[0].pos[1], SHOTS[0].pos[2]));
  const elapsed = useRef(0);
  const desiredPos = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    elapsed.current += delta;
    const total = SHOT_CYCLE * SHOTS.length;
    const t = elapsed.current % total;
    const shotIdx = Math.floor(t / SHOT_CYCLE);
    const localT = t - shotIdx * SHOT_CYCLE;

    const a = SHOTS[shotIdx];
    const b = SHOTS[(shotIdx + 1) % SHOTS.length];

    // Within each cycle: hold A for SHOT_HOLD, then smoothstep to B
    // over SHOT_BLEND. This gives the camera a moment to "rest" on
    // each composition before drifting into the next one.
    let blend: number;
    if (localT < SHOT_HOLD) {
      blend = 0;
    } else {
      blend = smoothstep01((localT - SHOT_HOLD) / SHOT_BLEND);
    }

    desiredPos.current.set(
      a.pos[0] + (b.pos[0] - a.pos[0]) * blend,
      a.pos[1] + (b.pos[1] - a.pos[1]) * blend,
      a.pos[2] + (b.pos[2] - a.pos[2]) * blend,
    );
    desiredLook.current.set(
      a.lookAt[0] + (b.lookAt[0] - a.lookAt[0]) * blend,
      a.lookAt[1] + (b.lookAt[1] - a.lookAt[1]) * blend,
      a.lookAt[2] + (b.lookAt[2] - a.lookAt[2]) * blend,
    );

    // Frame-rate-independent exponential damping (same pattern the
    // driving camera uses — see LocalPlayer.updateCamera). Light
    // smoothing on top of the already-smoothed shot interpolation
    // takes any micro-jitter out of the result.
    const posAlpha = 1 - Math.exp(-delta * 2.5);
    const lookAlpha = 1 - Math.exp(-delta * 3.0);
    smoothedPos.current.lerp(desiredPos.current, posAlpha);
    smoothedLook.current.lerp(desiredLook.current, lookAlpha);

    camera.position.copy(smoothedPos.current);
    camera.lookAt(smoothedLook.current);
  });

  return null;
}

// Some environments (CI, sandboxed iframes, headless test browsers
// without GPU acceleration) cannot allocate a WebGL context at all,
// in which case three's WebGLRenderer constructor throws synchronously
// during the Canvas mount. Rather than letting that crash the entire
// Lobby, we catch it here and fall back to a transparent placeholder
// so the username form and JOIN WORLD button remain usable. The real
// game Canvas (mounted after JOIN WORLD) will hit the same condition
// if the browser truly has no WebGL — that's a separate, expected
// failure surface for gameplay.
class CanvasErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[MenuWorldPreview] Canvas mount failed; falling back to plain lobby background.", err);
    }
  }
  render() {
    if (this.state.failed) {
      // Match the Lobby's solid background so the form stays legible.
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at center, #0f1530 0%, #06081a 70%, #03040d 100%)",
          }}
        />
      );
    }
    return this.props.children;
  }
}

export default function MenuWorldPreview() {
  // NPCs expects a stumbleRef but only writes to it when the local
  // player's car hits a pedestrian. The menu has no LocalPlayer, so
  // this map will simply stay empty; passing a sacrificial ref keeps
  // the component's interface unchanged.
  const stumbleRef = useRef<NpcStumbleMap>(new Map());

  return (
    <CanvasErrorBoundary>
    <Canvas
      shadows
      dpr={[1, 1.5]}
      gl={{
        powerPreference: "high-performance",
        antialias: false,
        stencil: false,
        // Some headless / software-renderer chromiums (e.g. CI, the
        // Replit preview iframe under heavy WebGL-context pressure)
        // refuse to allocate a "high-performance" context and return
        // null from canvas.getContext, which makes three's
        // WebGLRenderer constructor throw. Allowing the major-perf
        // caveat lets the browser fall back to a software context
        // instead of failing the entire menu preview.
        failIfMajorPerformanceCaveat: false,
      }}
      onCreated={({ gl }) => configureWorldRenderer(gl)}
      camera={{ fov: 60, near: 0.1, far: 1500, position: SHOTS[0].pos }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }}
    >
      {/* Same global lighting / sky / fog / sun-moon controller the
          gameplay scene uses so the menu inherits the live day-night
          cycle for free. */}
      <DayNightController />

      <CityMap />
      <BiomeRender />

      {/* Ambient AI traffic — pure client-side, deterministic from
          Date.now(), no socket. NPCs render simple geometry (no GLB)
          so they're free to include. */}
      <NPCs stumbleRef={stumbleRef} />
      <AmbientTraffic />

      <MenuCameraRig />
    </Canvas>
    </CanvasErrorBoundary>
  );
}
