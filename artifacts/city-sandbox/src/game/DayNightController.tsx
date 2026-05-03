import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  DAY_LENGTH_MS,
  computeTimeOfDay,
  dayNightRuntime,
} from "../shared/timeOfDay";

// =============================================================
// DayNightController
// -------------------------------------------------------------
// Owns ALL global lighting + sky + fog + sun/moon meshes and
// updates them every frame from the synced world clock. Mounts
// inside the R3F <Canvas>. Replaces the static hemi/dir/ambient
// lights and the static skybox/fog that used to live in
// GameScene.tsx + CityMap.tsx.
//
// Performance contract:
//   - Exactly one shadow-casting directional light.
//   - Allocations only at mount; useFrame uses pre-built
//     scratch THREE.Color buffers and ref mutations only.
//   - Writes a tiny `dayNightRuntime` snapshot for everything
//     else (lamps, point lights, HUD ticker) to consume.
// =============================================================

// Sky / atmosphere palette — 3-way blend (night / twilight / day).
const COLOR_NIGHT_SKY = new THREE.Color("#0b1530");
const COLOR_TWILIGHT_SKY = new THREE.Color("#ff8a55");
const COLOR_DAY_SKY = new THREE.Color("#87b6e8");

// Ambient (fill) palette.
const COLOR_NIGHT_AMB = new THREE.Color("#1a2240");
const COLOR_TWILIGHT_AMB = new THREE.Color("#c8966a");
const COLOR_DAY_AMB = new THREE.Color("#b8c4dc");

// Hemisphere sky-tint palette. Ground tint stays constant — it's just
// the dark planet under us and shouldn't shift hue with the sky.
const COLOR_NIGHT_HEMI_SKY = new THREE.Color("#243050");
const COLOR_TWILIGHT_HEMI_SKY = new THREE.Color("#d6936a");
const COLOR_DAY_HEMI_SKY = new THREE.Color("#aabbdd");
const COLOR_HEMI_GROUND = new THREE.Color("#242838");

// Sun/moon lighting palette.
const COLOR_DAWN_SUN = new THREE.Color("#ff9060");
const COLOR_NOON_SUN = new THREE.Color("#fff0d0");
const COLOR_MOON = new THREE.Color("#a8b8ff");

// Sun/moon mesh self-emissive colors (toneMapped: false so they pop
// against the dynamic sky regardless of exposure).
const SUN_MESH_COLOR = "#ffeac0";
const MOON_MESH_COLOR = "#dde6ff";

// Sun mesh sits on a far sphere so it always reads as "sky". The
// directional light position is independent (closer in) so its shadow
// camera frustum stays sane.
const SKY_DIST = 700;
const DIR_LIGHT_DIST = 100;

export default function DayNightController() {
  const { scene } = useThree();

  // --- One-time scene wiring: scene.background + scene.fog ---
  // We own these for the lifetime of the controller. CityMap used
  // to declare a static <fog> and a Skybox sphere; both are removed
  // there now so the only writer of background/fog color is us.
  useEffect(() => {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const bg = new THREE.Color("#0b1530");
    scene.background = bg;
    scene.fog = new THREE.Fog(0x0b1530, 200, 800);
    return () => {
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  }, [scene]);

  // --- Refs into the lights + sun/moon meshes ---
  const dirRef = useRef<THREE.DirectionalLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const sunGroupRef = useRef<THREE.Group>(null);
  const moonGroupRef = useRef<THREE.Group>(null);
  const sunMeshRef = useRef<THREE.Mesh>(null);
  const moonMeshRef = useRef<THREE.Mesh>(null);

  // Reusable scratch buffers — never allocate during useFrame.
  const scratch = useMemo(
    () => ({
      sky: new THREE.Color(),
      amb: new THREE.Color(),
      hemiSky: new THREE.Color(),
      dir: new THREE.Color(),
    }),
    [],
  );

  const loggedOnceRef = useRef(false);

  useFrame(() => {
    const t = computeTimeOfDay(Date.now());

    // 3-way color weights, normalized so the sky never goes black.
    const wN = t.nightFactor;
    const wT = t.dawnDuskFactor;
    const wD = t.dayFactor;
    const wsum = Math.max(0.0001, wN + wT + wD);
    const fN = wN / wsum;
    const fT = wT / wsum;
    const fD = wD / wsum;

    blend3(scratch.sky, COLOR_NIGHT_SKY, fN, COLOR_TWILIGHT_SKY, fT, COLOR_DAY_SKY, fD);
    blend3(scratch.amb, COLOR_NIGHT_AMB, fN, COLOR_TWILIGHT_AMB, fT, COLOR_DAY_AMB, fD);
    blend3(scratch.hemiSky, COLOR_NIGHT_HEMI_SKY, fN, COLOR_TWILIGHT_HEMI_SKY, fT, COLOR_DAY_HEMI_SKY, fD);

    // Directional light: sun if above the horizon, moon otherwise.
    // Exactly one shadow-casting light at any time (we just retint
    // the existing one — no light add/remove churn).
    const sunUp = t.sunY > 0;
    if (sunUp) {
      // Warm low sun → neutral noon sun.
      const noonness = clamp01(t.sunY * 1.8);
      scratch.dir.copy(COLOR_DAWN_SUN).lerp(COLOR_NOON_SUN, noonness);
    } else {
      scratch.dir.copy(COLOR_MOON);
    }
    const dirIntensity = sunUp
      ? lerp(0.25, 1.1, clamp01(t.sunY * 1.5))
      : lerp(0.05, 0.22, clamp01(-t.sunY));
    const ambIntensity = lerp(0.10, 0.32, t.dayFactor);
    const hemiIntensity = lerp(0.20, 0.55, t.dayFactor);

    // Mutate scene.background + fog (refs survive re-mounts because
    // the cleanup in useEffect restores the previous values only on
    // unmount).
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(scratch.sky);
    }
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(scratch.sky);
    }

    if (dirRef.current) {
      dirRef.current.color.copy(scratch.dir);
      dirRef.current.intensity = dirIntensity;
      // Aim the light from whichever body is currently above. Floor
      // the y position so the light direction never becomes parallel
      // to the ground (degenerate shadows at the exact horizon).
      const useAngle = sunUp ? t.sunAngle : t.moonAngle;
      const useY = sunUp ? t.sunY : t.moonY;
      dirRef.current.position.set(
        Math.cos(useAngle) * DIR_LIGHT_DIST,
        Math.max(0.08, useY) * DIR_LIGHT_DIST,
        0.3 * DIR_LIGHT_DIST,
      );
    }
    if (ambRef.current) {
      ambRef.current.color.copy(scratch.amb);
      ambRef.current.intensity = ambIntensity;
    }
    if (hemiRef.current) {
      hemiRef.current.color.copy(scratch.hemiSky);
      hemiRef.current.groundColor.copy(COLOR_HEMI_GROUND);
      hemiRef.current.intensity = hemiIntensity;
    }

    // Sun + moon visible meshes. Each rides the sky dome at SKY_DIST
    // and is hidden when below the horizon (no need to render a sphere
    // we can't see).
    if (sunGroupRef.current) {
      sunGroupRef.current.position.set(
        Math.cos(t.sunAngle) * SKY_DIST,
        t.sunY * SKY_DIST,
        0.3 * SKY_DIST,
      );
    }
    if (sunMeshRef.current) {
      sunMeshRef.current.visible = t.sunY > -0.05;
    }
    if (moonGroupRef.current) {
      moonGroupRef.current.position.set(
        Math.cos(t.moonAngle) * SKY_DIST,
        t.moonY * SKY_DIST,
        0.3 * SKY_DIST,
      );
    }
    if (moonMeshRef.current) {
      moonMeshRef.current.visible = t.moonY > -0.05;
    }

    // Publish runtime snapshot for lamps / point-lights / HUD ticker.
    dayNightRuntime.ready = true;
    dayNightRuntime.worldNow = t.worldNow;
    dayNightRuntime.dayProgress = t.dayProgress;
    dayNightRuntime.gameHour = t.gameHour;
    dayNightRuntime.gameMinute = t.gameMinute;
    dayNightRuntime.label = t.label;
    dayNightRuntime.phase = t.phase;
    dayNightRuntime.sunY = t.sunY;
    dayNightRuntime.moonY = t.moonY;
    dayNightRuntime.dayFactor = t.dayFactor;
    dayNightRuntime.nightFactor = t.nightFactor;
    dayNightRuntime.dawnDuskFactor = t.dawnDuskFactor;

    if (!loggedOnceRef.current) {
      loggedOnceRef.current = true;
      // eslint-disable-next-line no-console
      console.log(
        `dayNight OK: cycleMs=${DAY_LENGTH_MS}, clock=${t.label}, ` +
          `phase=${t.phase}, sunY=${t.sunY.toFixed(2)}, ` +
          `moonY=${t.moonY.toFixed(2)}, ` +
          `nightFactor=${t.nightFactor.toFixed(2)}, ` +
          `activePointLights<=8`,
      );
    }
  });

  return (
    <group>
      {/* Sky-fill light — colors swap with phase; never casts shadow. */}
      <hemisphereLight ref={hemiRef} args={["#aabbdd", "#242838", 0.55]} />

      {/* The single shadow-casting light. Acts as sun by day, moon by
          night. Shadow camera bounds match the previous fixed setup so
          the central city + immediate biome ring keep their shadows. */}
      <directionalLight
        ref={dirRef}
        position={[40, 60, 30]}
        intensity={0.55}
        color="#ffe5c8"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-300}
        shadow-camera-right={300}
        shadow-camera-top={300}
        shadow-camera-bottom={-300}
        shadow-camera-near={0.5}
        shadow-camera-far={500}
      />

      {/* Bottom-end fill so deep shadows never crush to pure black. */}
      <ambientLight ref={ambRef} intensity={0.18} color="#1a2240" />

      {/* Visible sun + moon meshes. toneMapped:false keeps them
          punchy against the bright daytime sky. */}
      <group ref={sunGroupRef}>
        <mesh ref={sunMeshRef}>
          <sphereGeometry args={[28, 16, 16]} />
          <meshBasicMaterial color={SUN_MESH_COLOR} toneMapped={false} />
        </mesh>
      </group>
      <group ref={moonGroupRef}>
        <mesh ref={moonMeshRef}>
          <sphereGeometry args={[20, 16, 16]} />
          <meshBasicMaterial color={MOON_MESH_COLOR} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Weighted average of three reference colors written into `out`. */
function blend3(
  out: THREE.Color,
  a: THREE.Color,
  wa: number,
  b: THREE.Color,
  wb: number,
  c: THREE.Color,
  wc: number,
): void {
  out.r = a.r * wa + b.r * wb + c.r * wc;
  out.g = a.g * wa + b.g * wb + c.g * wc;
  out.b = a.b * wa + b.b * wb + c.b * wc;
}
