import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";

// Module-level perf snapshot. Written by <PerfMonitor/> inside the
// Canvas, polled by <PerfOverlay/> in the wrapper DOM.
const perfState = { fps: 0 };

/**
 * Lives inside the R3F <Canvas>. Tracks rolling FPS each frame and,
 * exactly once at ~5 seconds after mount, prints the standard
 *   `renderPerf OK: fps=..., drawCalls=..., triangles=..., pointLights=..., shadowCasters=...`
 * line to the browser console so the perf pass has a checkable
 * artefact in workflow logs.
 */
export function PerfMonitor() {
  const { gl, scene } = useThree();
  const frames = useRef(0);
  const lastT = useRef(performance.now());
  const startT = useRef(performance.now());
  const logged = useRef(false);

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    const dt = now - lastT.current;
    if (dt >= 500) {
      perfState.fps = Math.round((frames.current * 1000) / dt);
      frames.current = 0;
      lastT.current = now;
    }
    if (!logged.current && now - startT.current > 5000) {
      logged.current = true;
      let pointLights = 0;
      let shadowCasters = 0;
      scene.traverse((o) => {
        const any = o as unknown as { isLight?: boolean; type?: string; isMesh?: boolean; castShadow?: boolean };
        if (any.isLight && any.type === "PointLight") pointLights++;
        if (any.isMesh && any.castShadow) shadowCasters++;
      });
      const info = gl.info.render;
      // eslint-disable-next-line no-console
      console.log(
        `renderPerf OK: fps=${perfState.fps}, drawCalls=${info.calls}, triangles=${info.triangles}, pointLights=${pointLights}, shadowCasters=${shadowCasters}`
      );
    }
  });
  return null;
}

/**
 * DOM overlay toggled by F3. Shows current FPS in the top-right.
 * Lives outside the Canvas so it doesn't add a render frame cost.
 */
export function PerfOverlay() {
  const [show, setShow] = useState(false);
  const [fps, setFps] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "F3") {
        e.preventDefault();
        setShow((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => setFps(perfState.fps), 250);
    return () => clearInterval(id);
  }, [show]);
  if (!show) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        padding: "4px 8px",
        background: "rgba(0,0,0,0.6)",
        color: "#0f0",
        fontFamily: "monospace",
        fontSize: 14,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      FPS: {fps}
    </div>
  );
}
