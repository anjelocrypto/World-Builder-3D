import * as THREE from "three";

/**
 * Shared renderer settings applied to every R3F Canvas that renders the
 * game world (GameScene + MenuWorldPreview). Keeping them in one place
 * ensures the lobby preview and the in-game scene always use an identical
 * colour pipeline, tone-mapping curve, and shadow filter.
 *
 * Usage:
 *   <Canvas onCreated={({ gl }) => configureWorldRenderer(gl)} …>
 *
 * Note: callers may add their own extra options (e.g. the menu's
 * failIfMajorPerformanceCaveat: false) before or after this call.
 * toneMappingExposure is set to 1.0 as the starting value; DayNightController
 * overwrites it every frame via gl.toneMappingExposure.
 */
export function configureWorldRenderer(gl: THREE.WebGLRenderer): void {
  // Physically-correct sRGB output pipeline.
  gl.outputColorSpace = THREE.SRGBColorSpace;
  // ACES filmic — rich contrast without harsh highlight clipping.
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  // Starting exposure; DayNightController overrides this per frame.
  gl.toneMappingExposure = 1.0;
  // Soft shadow edges — significantly less aliasing than the default PCF.
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
}
