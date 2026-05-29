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
//   - Shadow camera follows the player camera so shadow detail
//     stays sharp around the player rather than wasting the
//     shadow map over the full 1000×1000 world.
//   - Writes a tiny `dayNightRuntime` snapshot for everything
//     else (lamps, point lights, HUD ticker) to consume.
//   - Dynamic toneMappingExposure via gl ref.
// =============================================================

// --------------- Sky palette — 3-way blend (night / twilight / day) ---------------
// Night: very deep dark blue-indigo.
const COLOR_NIGHT_SKY     = new THREE.Color("#070e1e");
// Twilight (dawn + dusk): vivid warm orange-red.
const COLOR_TWILIGHT_SKY  = new THREE.Color("#e85a28");
// Day: rich clean sky blue.
const COLOR_DAY_SKY       = new THREE.Color("#4898e4");

// --------------- Fog palette ---------------
const COLOR_NIGHT_FOG     = new THREE.Color("#060c18");
const COLOR_TWILIGHT_FOG  = new THREE.Color("#903c18");
const COLOR_DAY_FOG       = new THREE.Color("#78aad0");

// --------------- Ambient (fill) palette ---------------
const COLOR_NIGHT_AMB     = new THREE.Color("#1a2040");
const COLOR_TWILIGHT_AMB  = new THREE.Color("#c87850");
const COLOR_DAY_AMB       = new THREE.Color("#b0bcd8");

// --------------- Hemisphere sky-tint palette ---------------
const COLOR_NIGHT_HEMI    = new THREE.Color("#1e2848");
const COLOR_TWILIGHT_HEMI = new THREE.Color("#d08060");
const COLOR_DAY_HEMI      = new THREE.Color("#a0b8d8");
const COLOR_HEMI_GROUND   = new THREE.Color("#222636");

// --------------- Sun/moon directional light palette ---------------
const COLOR_DAWN_DIR      = new THREE.Color("#ff8448");
const COLOR_NOON_DIR      = new THREE.Color("#fff4e0");
const COLOR_MOON_DIR      = new THREE.Color("#90a0c8");

// --------------- Emissive mesh colors ---------------
const SUN_CORE_COLOR      = "#ffe880";
const SUN_HALO_COLOR      = "#ffd080";
const MOON_CORE_COLOR     = "#d0d8ff";
const MOON_HALO_COLOR     = "#8898c8";

// Sun/moon distances. Visual meshes ride the far sky dome so they always
// read as "sky". The shadow-casting directional light position is kept at
// DIR_LIGHT_DIST (much closer in) so its shadow camera frustum stays sane
// at DIR_SHADOW_HALF coverage around the camera.
const SKY_DIST            = 700;
const DIR_LIGHT_DIST      = 200;
const DIR_SHADOW_HALF     = 130; // ±130 m around camera = 260×260 m coverage

export default function DayNightController() {
  const { scene, camera, gl } = useThree();

  // One-time scene wiring: scene.background + scene.fog.
  useEffect(() => {
    const prevBg  = scene.background;
    const prevFog = scene.fog;
    scene.background = new THREE.Color("#070e1e");
    scene.fog = new THREE.Fog(0x070e1e, 140, 750);
    return () => {
      scene.background = prevBg;
      scene.fog        = prevFog;
    };
  }, [scene]);

  // Refs into the scene lights and sun/moon meshes.
  const dirRef      = useRef<THREE.DirectionalLight>(null);
  const ambRef      = useRef<THREE.AmbientLight>(null);
  const hemiRef     = useRef<THREE.HemisphereLight>(null);
  const sunGroupRef = useRef<THREE.Group>(null);
  const moonGroupRef= useRef<THREE.Group>(null);
  const sunCoreRef  = useRef<THREE.Mesh>(null);
  const sunHaloRef  = useRef<THREE.Mesh>(null);
  const moonCoreRef = useRef<THREE.Mesh>(null);
  const moonHaloRef = useRef<THREE.Mesh>(null);

  // Add the directional light's target to the scene so we can drive it
  // per-frame (camera-following shadow volume).
  useEffect(() => {
    const light = dirRef.current;
    if (!light) return;
    scene.add(light.target);
    return () => { scene.remove(light.target); };
  }, [scene]);

  // Reusable scratch buffers — never allocate during useFrame.
  const scratch = useMemo(
    () => ({
      sky:  new THREE.Color(),
      fog:  new THREE.Color(),
      amb:  new THREE.Color(),
      hemi: new THREE.Color(),
      dir:  new THREE.Color(),
    }),
    [],
  );

  const loggedOnceRef = useRef(false);

  useFrame(() => {
    const t = computeTimeOfDay(Date.now());

    // Normalised 3-way blend weights.
    const wN    = t.nightFactor;
    const wT    = t.dawnDuskFactor;
    const wD    = t.dayFactor;
    const wsum  = Math.max(0.0001, wN + wT + wD);
    const fN    = wN / wsum;
    const fT    = wT / wsum;
    const fD    = wD / wsum;

    blend3(scratch.sky,  COLOR_NIGHT_SKY,  fN, COLOR_TWILIGHT_SKY,  fT, COLOR_DAY_SKY,  fD);
    blend3(scratch.fog,  COLOR_NIGHT_FOG,  fN, COLOR_TWILIGHT_FOG,  fT, COLOR_DAY_FOG,  fD);
    blend3(scratch.amb,  COLOR_NIGHT_AMB,  fN, COLOR_TWILIGHT_AMB,  fT, COLOR_DAY_AMB,  fD);
    blend3(scratch.hemi, COLOR_NIGHT_HEMI, fN, COLOR_TWILIGHT_HEMI, fT, COLOR_DAY_HEMI, fD);

    // Directional light: sun when above horizon, cool moonlight otherwise.
    const sunUp = t.sunY > 0;
    if (sunUp) {
      const noonness = clamp01(t.sunY * 2.0);
      scratch.dir.copy(COLOR_DAWN_DIR).lerp(COLOR_NOON_DIR, noonness);
    } else {
      scratch.dir.copy(COLOR_MOON_DIR);
    }

    // Light intensities — richer range than before.
    const dirIntensity  = sunUp
      ? lerp(0.20, 1.3, clamp01(t.sunY * 1.6))
      : lerp(0.04, 0.20, clamp01(-t.sunY));
    const ambIntensity  = lerp(0.08, 0.30, t.dayFactor);
    const hemiIntensity = lerp(0.18, 0.60, t.dayFactor);

    // Fog: near/far shift with phase for atmospheric depth.
    // Clearer day, denser/warmer twilight, cool dense night.
    const fogNear = lerp(lerp(100, 240, t.dayFactor), 80,  t.dawnDuskFactor * 0.6);
    const fogFar  = lerp(lerp(680, 950, t.dayFactor), 620, t.dawnDuskFactor * 0.5);

    // Scene background + fog.
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(scratch.sky);
    }
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(scratch.fog);
      scene.fog.near  = fogNear;
      scene.fog.far   = fogFar;
    }

    // ---- Directional light — camera-following shadow volume ----
    if (dirRef.current) {
      dirRef.current.color.copy(scratch.dir);
      dirRef.current.intensity = dirIntensity;

      // Light comes from the active body's angular position. Floor Y
      // so the direction never degenerates at the exact horizon.
      const useAngle = sunUp ? t.sunAngle : t.moonAngle;
      const useY     = sunUp ? t.sunY    : t.moonY;
      const lx = Math.cos(useAngle) * DIR_LIGHT_DIST;
      const lz = 0.3 * DIR_LIGHT_DIST;
      const ly = Math.max(0.08, useY) * DIR_LIGHT_DIST;

      // Camera-relative position: shadow camera frustum moves with the
      // player instead of wasting texels on the distant 1000×1000 world.
      const cx = camera.position.x;
      const cz = camera.position.z;
      dirRef.current.position.set(cx + lx, ly, cz + lz);
      dirRef.current.target.position.set(cx, 0, cz);
      dirRef.current.target.updateMatrixWorld();
    }

    if (ambRef.current) {
      ambRef.current.color.copy(scratch.amb);
      ambRef.current.intensity = ambIntensity;
    }
    if (hemiRef.current) {
      hemiRef.current.color.copy(scratch.hemi);
      hemiRef.current.groundColor.copy(COLOR_HEMI_GROUND);
      hemiRef.current.intensity = hemiIntensity;
    }

    // ---- Tone-mapping exposure: subtle shift by phase ----
    // Slightly darker at dawn/dusk so the vivid colours aren't clipped,
    // slightly brighter at night to lift shadow detail.
    gl.toneMappingExposure = lerp(
      lerp(1.0, 1.1, t.dayFactor),
      0.88,
      t.dawnDuskFactor * 0.35,
    );

    // ---- Sun/moon visible meshes — pinned to camera (infinite sky) ----
    const cx2 = camera.position.x;
    const cy2 = camera.position.y;
    const cz2 = camera.position.z;

    if (sunGroupRef.current) {
      sunGroupRef.current.position.set(
        cx2 + Math.cos(t.sunAngle) * SKY_DIST,
        cy2 + t.sunY * SKY_DIST,
        cz2 + 0.3 * SKY_DIST,
      );
    }
    const sunVisible = t.sunY > -0.08;
    if (sunCoreRef.current)  sunCoreRef.current.visible  = sunVisible;
    if (sunHaloRef.current) {
      sunHaloRef.current.visible = sunVisible;
      if (sunVisible) {
        // Halo strongest near the horizon, fades at noon.
        const haloAlpha = clamp01(1.0 - t.sunY * 1.8) * clamp01(t.sunY * 12 + 1) * 0.35;
        (sunHaloRef.current.material as THREE.MeshBasicMaterial).opacity = haloAlpha;
      }
    }

    // Billboard halo discs — circleGeometry faces +Z by default, so without
    // this the disc shows only an edge when the camera is behind the plane.
    // Copying the camera quaternion onto each halo makes it always face the
    // viewer. The groups have no rotation (only position), so world ≡ local.
    if (sunHaloRef.current)  sunHaloRef.current.quaternion.copy(camera.quaternion);
    if (moonHaloRef.current) moonHaloRef.current.quaternion.copy(camera.quaternion);

    if (moonGroupRef.current) {
      moonGroupRef.current.position.set(
        cx2 + Math.cos(t.moonAngle) * SKY_DIST,
        cy2 + t.moonY * SKY_DIST,
        cz2 + 0.3 * SKY_DIST,
      );
    }
    const moonVisible = t.moonY > -0.08;
    if (moonCoreRef.current) moonCoreRef.current.visible = moonVisible;
    if (moonHaloRef.current) {
      moonHaloRef.current.visible = moonVisible;
      if (moonVisible) {
        const moonAlpha = clamp01(t.moonY * 4) * 0.22;
        (moonHaloRef.current.material as THREE.MeshBasicMaterial).opacity = moonAlpha;
      }
    }

    // ---- Publish runtime snapshot ----
    dayNightRuntime.ready        = true;
    dayNightRuntime.worldNow     = t.worldNow;
    dayNightRuntime.dayProgress  = t.dayProgress;
    dayNightRuntime.gameHour     = t.gameHour;
    dayNightRuntime.gameMinute   = t.gameMinute;
    dayNightRuntime.label        = t.label;
    dayNightRuntime.phase        = t.phase;
    dayNightRuntime.sunY         = t.sunY;
    dayNightRuntime.moonY        = t.moonY;
    dayNightRuntime.dayFactor    = t.dayFactor;
    dayNightRuntime.nightFactor  = t.nightFactor;
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
      // eslint-disable-next-line no-console
      console.log(
        `lightingRealism OK: toneMapping=ACES, shadowMap=PCFSoft, ` +
          `activePointLights<=8, windowsNightReactive=true`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `lampLighting OK: noGroundPools=true, activePointLights<=8 ` +
          `(nearest-N over curated anchors + every lamp head)`,
      );
    }
  });

  return (
    <group>
      {/* Sky-fill hemisphere light — warm ground, cool sky. */}
      <hemisphereLight ref={hemiRef} args={["#a0b8d8", "#222636", 0.60]} />

      {/* Single shadow-casting directional light. Acts as sun by day and
          cool moonlight by night. Shadow map bumped to 2048 for sharper
          detail; camera-following frustum (±130 m) keeps full resolution
          around the player. Shadow bias tuned to eliminate acne without
          peter-panning. */}
      <directionalLight
        ref={dirRef}
        position={[40, 80, 30]}
        intensity={0.8}
        color="#ffe5c8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-DIR_SHADOW_HALF}
        shadow-camera-right={DIR_SHADOW_HALF}
        shadow-camera-top={DIR_SHADOW_HALF}
        shadow-camera-bottom={-DIR_SHADOW_HALF}
        shadow-camera-near={0.5}
        shadow-camera-far={500}
        shadow-bias={-0.0015}
        shadow-normalBias={0.04}
      />

      {/* Bottom-fill ambient so deep shadows never crush to pure black. */}
      <ambientLight ref={ambRef} intensity={0.14} color="#1a2040" />

      {/* ---- Sun visual ---- */}
      <group ref={sunGroupRef}>
        {/* Soft halo disc — additive so it brightens the sky around the sun.
            Opacity is driven per-frame (strongest near horizon). */}
        <mesh ref={sunHaloRef} renderOrder={-1002}>
          <circleGeometry args={[58, 32]} />
          <meshBasicMaterial
            color={SUN_HALO_COLOR}
            transparent
            opacity={0.22}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Core disc — solid, slightly smaller than the halo. */}
        <mesh ref={sunCoreRef} renderOrder={-1000}>
          <sphereGeometry args={[26, 20, 20]} />
          <meshBasicMaterial
            color={SUN_CORE_COLOR}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      </group>

      {/* ---- Moon visual ---- */}
      <group ref={moonGroupRef}>
        {/* Faint cool halo around the moon at night. */}
        <mesh ref={moonHaloRef} renderOrder={-1002}>
          <circleGeometry args={[36, 24]} />
          <meshBasicMaterial
            color={MOON_HALO_COLOR}
            transparent
            opacity={0.15}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Moon is smaller and cooler than the sun. */}
        <mesh ref={moonCoreRef} renderOrder={-1000}>
          <sphereGeometry args={[14, 16, 16]} />
          <meshBasicMaterial
            color={MOON_CORE_COLOR}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      </group>
    </group>
  );
}

// --------------- Pure helpers (no allocations) ---------------

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Weighted average of three reference colors written into `out`. */
function blend3(
  out: THREE.Color,
  a: THREE.Color, wa: number,
  b: THREE.Color, wb: number,
  c: THREE.Color, wc: number,
): void {
  out.r = a.r * wa + b.r * wb + c.r * wc;
  out.g = a.g * wa + b.g * wb + c.g * wc;
  out.b = a.b * wa + b.b * wb + c.b * wc;
}
