import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { dayNightRuntime } from "../shared/timeOfDay";

// =============================================================
// Atmosphere — decorative sky layers driven by the DayNightController clock.
// -------------------------------------------------------------
// Two pieces, both client-visual-only (no collision, no gameplay):
//   StarField — a camera-pinned point sphere that fades in at night and out at
//               dawn/day, with a subtle global twinkle. Occluded by world
//               geometry (depthTest), so stars only show through open sky.
//   CloudLayer — a high, slowly drifting deck of soft puff billboards. Tinted
//               per frame: dim/cool at night, warm at sunset, bright by day.
//
// Performance contract: all geometry/material/texture are allocated ONCE at
// mount; useFrame only mutates refs (positions, opacity, color). No per-frame
// allocations. Read phase factors from dayNightRuntime (updated upstream each
// frame by DayNightController, which renders these as children).
// =============================================================

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ── Starfield ────────────────────────────────────────────────────────────────
export function StarField() {
  const { camera } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const tRef = useRef(0);

  const geo = useMemo(() => {
    const N = 1500;
    const R = 900;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    // Deterministic PRNG so every client sees the same sky.
    let s = 1337;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      // Bias the distribution upward so most stars sit overhead, not at feet.
      let x = r * Math.cos(th);
      let y = Math.abs(u) * 0.92 + 0.08;
      let z = r * Math.sin(th);
      const n = Math.hypot(x, y, z) || 1;
      pos[i * 3] = (x / n) * R;
      pos[i * 3 + 1] = (y / n) * R;
      pos[i * 3 + 2] = (z / n) * R;
      const tint = 0.82 + rnd() * 0.18;
      col[i * 3] = tint;
      col[i * 3 + 1] = tint;
      col[i * 3 + 2] = Math.min(1, tint + 0.07); // faint cool tint
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);

  useFrame((_, delta) => {
    const p = pointsRef.current;
    const m = matRef.current;
    if (!p || !m) return;
    // Pin to the camera so the star sphere reads as infinitely far.
    p.position.copy(camera.position);
    tRef.current += delta;
    const base = clamp01((dayNightRuntime.nightFactor - 0.04) * 1.35);
    const pulse = 0.86 + 0.14 * Math.sin(tRef.current * 0.8); // subtle, not noisy
    m.opacity = base * pulse * 0.95;
    p.visible = m.opacity > 0.012;
  });

  return (
    <points ref={pointsRef} renderOrder={-1500} frustumCulled={false}>
      <primitive object={geo} attach="geometry" />
      <pointsMaterial
        ref={matRef}
        size={1.7}
        sizeAttenuation={false}
        vertexColors
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

// ── Cloud deck ───────────────────────────────────────────────────────────────
function makePuffTexture(): THREE.Texture {
  const SZ = 128;
  const c = document.createElement("canvas");
  c.width = SZ;
  c.height = SZ;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(SZ / 2, SZ / 2, 4, SZ / 2, SZ / 2, SZ / 2);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.45, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SZ, SZ);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const CLOUD_N = 12;
const CLOUD_SPAN = 1700; // x/z extent the deck tiles across
const CLOUD_DRIFT = 1.6; // m/s — slow

const CLOUD_NIGHT = new THREE.Color("#2c3550");
const CLOUD_SUNSET = new THREE.Color("#ffb184");
const CLOUD_DAY = new THREE.Color("#e7edf6");

export function CloudLayer() {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const driftRef = useRef(0);
  const tex = useMemo(makePuffTexture, []);
  const colScratch = useMemo(() => new THREE.Color(), []);
  // ONE shared geometry + material for all puffs — allocated at mount, mutated
  // per frame (so every cloud tints together with the time of day).
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.4, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    }),
    [tex],
  );

  const puffs = useMemo(() => {
    let s = 9001;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    return Array.from({ length: CLOUD_N }, () => ({
      bx: (rnd() - 0.5) * CLOUD_SPAN,
      z: (rnd() - 0.5) * CLOUD_SPAN,
      y: 175 + rnd() * 90,
      scale: 150 + rnd() * 190,
      speed: 0.7 + rnd() * 0.6, // per-puff parallax multiplier
    }));
  }, []);

  useFrame((_, delta) => {
    driftRef.current += delta * CLOUD_DRIFT;
    for (let i = 0; i < puffs.length; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      const p = puffs[i];
      // Wrap X within [-span/2, span/2] for an endless drifting deck.
      let x = p.bx + driftRef.current * p.speed;
      x = (((x + CLOUD_SPAN / 2) % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN - CLOUD_SPAN / 2;
      mesh.position.set(x, p.y, p.z);
    }

    const fN = dayNightRuntime.nightFactor;
    const fT = dayNightRuntime.dawnDuskFactor;
    const fD = dayNightRuntime.dayFactor;
    const sum = Math.max(0.0001, fN + fT + fD);
    colScratch.setRGB(
      (CLOUD_NIGHT.r * fN + CLOUD_SUNSET.r * fT + CLOUD_DAY.r * fD) / sum,
      (CLOUD_NIGHT.g * fN + CLOUD_SUNSET.g * fT + CLOUD_DAY.g * fD) / sum,
      (CLOUD_NIGHT.b * fN + CLOUD_SUNSET.b * fT + CLOUD_DAY.b * fD) / sum,
    );
    mat.color.copy(colScratch);
    // Brighter, fuller by day; thinner and dim at night; a touch hazy at sunset.
    mat.opacity = (0.20 * fN + 0.50 * fT + 0.52 * fD) / sum;
  });

  return (
    <group renderOrder={-800}>
      {puffs.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => { meshRefs.current[i] = el; }}
          geometry={geo}
          material={mat}
          position={[p.bx, p.y, p.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={p.scale}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
