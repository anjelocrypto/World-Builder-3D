/**
 * Phase 14A — Grand Plaza Hall (visual component).
 *
 * A detailed indoor event venue: shell walls (matching the collision wall
 * boxes), a high ceiling with beams + skylight, a raised stage, a giant
 * branded event screen (static placeholder — NO live video this phase), red
 * curtains, side banners, and instanced rows of audience chairs facing the
 * screen. Geometry is data-driven from src/shared/eventHall.ts so the visuals
 * and the collision/validator agree exactly.
 *
 * Performance: chairs use two InstancedMesh (seats + backs); shared
 * geometries/materials; a conservative real-light budget (2 stage accents +
 * ambient), the rest faked with emissive materials. No live VideoTexture.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  EVENT_HALL,
  EVENT_HALL_EXTENTS,
  EVENT_HALL_WALL_BOXES,
  eventHallChairPositions,
} from "../shared/eventHall";

// ── Shared palette ──────────────────────────────────────────────────────────
const SHELL_COLOR = "#2b3140";
const TRIM_COLOR = "#c9a14a";   // warm gold trim/sign accent
const FLOOR_COLOR = "#15181f";
const STAGE_COLOR = "#1b1410";
const CURTAIN_COLOR = "#7a1020";
const SCREEN_FRAME = "#0a0c12";
const CLEAR_BLUE = "#2bd4ff";

/** Build a canvas-texture with centered text (no font asset dependency). */
function useTextTexture(
  lines: string[],
  opts: { w?: number; h?: number; bg?: string; fg?: string; accent?: string } = {},
): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const w = opts.w ?? 1024;
    const h = opts.h ?? 512;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Background gradient
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, opts.bg ?? "#0b1020");
    g.addColorStop(1, "#05070e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Accent border
    ctx.strokeStyle = opts.accent ?? TRIM_COLOR;
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    // Text
    ctx.fillStyle = opts.fg ?? "#f4ecd2";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = Math.floor(h / (lines.length + 1.5));
    ctx.font = `bold ${fontSize}px 'Arial Black', Arial, sans-serif`;
    const step = h / (lines.length + 1);
    lines.forEach((ln, i) => {
      ctx.fillText(ln, w / 2, step * (i + 1));
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.join("|"), opts.w, opts.h, opts.bg, opts.fg, opts.accent]);
}

interface EventHallProps {
  /** Phase 14B: live presenter screen-share texture, or null for the static screen. */
  screenVideoTexture?: THREE.VideoTexture | null;
  /** Captured video aspect (w/h) used to letterbox/pillarbox onto the 24×7 screen. */
  screenVideoAspect?: number;
}

export default function EventHall({ screenVideoTexture = null, screenVideoAspect = 16 / 9 }: EventHallProps) {
  const cx = EVENT_HALL.x;
  const cz = EVENT_HALL.z;
  const { xMin, xMax, zMin, zMax } = EVENT_HALL_EXTENTS;
  const H = EVENT_HALL.wallHeight;
  const zBack = zMax; // south / stage wall
  const zFront = zMin; // north / entrance wall

  const screenTex = useTextTexture(["GRAND PLAZA HALL", "· EVENT SCREEN ·"], {
    w: 1024, h: 576, bg: "#0a1830", fg: "#e9f6ff", accent: CLEAR_BLUE,
  });
  const signTex = useTextTexture(["GRAND PLAZA HALL"], {
    w: 1024, h: 256, bg: "#101522", fg: "#f4ecd2", accent: TRIM_COLOR,
  });

  // ── Chair instancing ──
  const chairs = useMemo(() => eventHallChairPositions(), []);
  const seatRef = useRef<THREE.InstancedMesh>(null);
  const backRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    chairs.forEach(([x, z], i) => {
      // Seat pad
      dummy.position.set(x, 0.45, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      seatRef.current?.setMatrixAt(i, dummy.matrix);
      // Backrest — on the north (−Z) side of the seat so the sitter faces +Z (screen)
      dummy.position.set(x, 0.85, z - 0.5);
      dummy.updateMatrix();
      backRef.current?.setMatrixAt(i, dummy.matrix);
    });
    if (seatRef.current) seatRef.current.instanceMatrix.needsUpdate = true;
    if (backRef.current) backRef.current.instanceMatrix.needsUpdate = true;
  }, [chairs]);

  // ── Ceiling beams (a few boxes spanning the width) ──
  const beams = useMemo(() => {
    const out: number[] = [];
    for (let z = zFront + 4; z <= zBack - 4; z += 6) out.push(z);
    return out;
  }, [zFront, zBack]);

  return (
    <group>
      {/* ── Floor ── */}
      <mesh position={[cx, 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[EVENT_HALL.w - 0.4, EVENT_HALL.d - 0.4]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={0.5} metalness={0.3} />
      </mesh>

      {/* ── Shell walls (rendered from the exact collision boxes) ── */}
      {EVENT_HALL_WALL_BOXES.map((w, i) => (
        <mesh key={`wall-${i}`} position={[w.x, H / 2, w.z]} castShadow receiveShadow>
          <boxGeometry args={[Math.max(w.w, 0.2), H, Math.max(w.d, 0.2)]} />
          <meshStandardMaterial color={SHELL_COLOR} roughness={0.8} metalness={0.1} />
        </mesh>
      ))}

      {/* Clerestory glass band (emissive strip) on the side walls, high up */}
      {[xMin + 0.4, xMax - 0.4].map((x, i) => (
        <mesh key={`glass-${i}`} position={[x, H - 1.4, cz]}>
          <boxGeometry args={[0.15, 1.6, EVENT_HALL.d - 4]} />
          <meshStandardMaterial color={CLEAR_BLUE} emissive={CLEAR_BLUE} emissiveIntensity={0.5} transparent opacity={0.55} />
        </mesh>
      ))}

      {/* ── Roof slab + skylight ── */}
      <mesh position={[cx, H + 0.3, cz]} castShadow>
        <boxGeometry args={[EVENT_HALL.w + 1, 0.6, EVENT_HALL.d + 1]} />
        <meshStandardMaterial color="#23262f" roughness={0.9} />
      </mesh>
      <mesh position={[cx, H - 0.05, cz]}>
        <boxGeometry args={[6, 0.1, EVENT_HALL.d - 10]} />
        <meshStandardMaterial color={CLEAR_BLUE} emissive={CLEAR_BLUE} emissiveIntensity={0.35} transparent opacity={0.4} />
      </mesh>

      {/* ── Ceiling beams ── */}
      {beams.map((z, i) => (
        <mesh key={`beam-${i}`} position={[cx, H - 0.5, z]}>
          <boxGeometry args={[EVENT_HALL.w - 1, 0.3, 0.4]} />
          <meshStandardMaterial color="#1a1d25" roughness={1} />
        </mesh>
      ))}

      {/* ── Entrance lintel + exterior sign (faces north/−Z toward arrivals) ── */}
      <mesh position={[cx, H - 0.8, zFront]}>
        <boxGeometry args={[EVENT_HALL.entranceGapWidth + 2, 1.6, 0.8]} />
        <meshStandardMaterial color={SHELL_COLOR} roughness={0.8} />
      </mesh>
      {signTex && (
        <mesh position={[cx, H - 0.8, zFront - 0.45]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[EVENT_HALL.entranceGapWidth + 1, 1.4]} />
          <meshBasicMaterial map={signTex} toneMapped={false} />
        </mesh>
      )}
      {/* Entrance side pylons with gold trim */}
      {[cx - EVENT_HALL.entranceGapWidth / 2 - 0.6, cx + EVENT_HALL.entranceGapWidth / 2 + 0.6].map((x, i) => (
        <mesh key={`pylon-${i}`} position={[x, H / 2, zFront - 0.3]}>
          <boxGeometry args={[0.8, H, 0.8]} />
          <meshStandardMaterial color={TRIM_COLOR} emissive={TRIM_COLOR} emissiveIntensity={0.18} roughness={0.4} metalness={0.5} />
        </mesh>
      ))}

      {/* ── Stage (raised platform at the south end) ── */}
      <mesh position={[EVENT_HALL.stage[0], 0.5, EVENT_HALL.stage[1]]} castShadow receiveShadow>
        <boxGeometry args={[32, 1, 9]} />
        <meshStandardMaterial color={STAGE_COLOR} roughness={0.6} metalness={0.2} />
      </mesh>
      {/* Stage gold lip */}
      <mesh position={[EVENT_HALL.stage[0], 1.0, EVENT_HALL.stage[1] - 4.4]}>
        <boxGeometry args={[32, 0.12, 0.3]} />
        <meshStandardMaterial color={TRIM_COLOR} emissive={TRIM_COLOR} emissiveIntensity={0.3} metalness={0.6} roughness={0.3} />
      </mesh>

      {/* ── Giant event screen (static branded placeholder) ──
          The 24×7 plane sits PROUD of the wall toward the audience (smaller z,
          facing −Z). The frame is FOUR bars sitting just behind the plane's
          edges (slightly larger z), so they border the screen without ever
          covering its content. Z-offsets are spaced ≥0.15 m apart to avoid
          z-fighting (wall face ≈ zBack−0.3; frame at zBack−0.55; plane at
          zBack−0.75). */}
      {(() => {
        const screenZ = zBack - 0.75; // proud, audience-facing
        const frameZ = zBack - 0.55;  // just behind the plane edges
        const halfW = 12;             // 24/2
        const halfH = 3.5;            // 7/2
        const bar = 0.5;              // frame bar thickness
        const yc = 5.4;
        // Phase 14B: when a screen-share is active, show the live video on a
        // sub-plane sized to PRESERVE the captured aspect ratio (contain →
        // letterbox/pillarbox) within the 24×7 screen, over a dark backing.
        // Otherwise show the static branded canvas texture full-bleed.
        const SCREEN_W = 24, SCREEN_H = 7;
        const aspect = screenVideoAspect > 0 ? screenVideoAspect : 16 / 9;
        let vidW = Math.min(SCREEN_W, SCREEN_H * aspect);
        let vidH = vidW / aspect;
        if (vidH > SCREEN_H) { vidH = SCREEN_H; vidW = vidH * aspect; }
        return (
          <group>
            {/* Screen content */}
            {screenVideoTexture ? (
              <>
                {/* Dark backing fills the screen behind the letterboxed video */}
                <mesh position={[cx, yc, screenZ]} rotation={[0, Math.PI, 0]}>
                  <planeGeometry args={[SCREEN_W, SCREEN_H]} />
                  <meshBasicMaterial color="#000000" toneMapped={false} />
                </mesh>
                {/* Live capture, aspect-preserved, slightly proud of the backing */}
                <mesh position={[cx, yc, screenZ - 0.02]} rotation={[0, Math.PI, 0]}>
                  <planeGeometry args={[vidW, vidH]} />
                  <meshBasicMaterial map={screenVideoTexture} toneMapped={false} />
                </mesh>
              </>
            ) : (
              <mesh position={[cx, yc, screenZ]} rotation={[0, Math.PI, 0]}>
                <planeGeometry args={[SCREEN_W, SCREEN_H]} />
                {screenTex
                  ? <meshBasicMaterial map={screenTex} toneMapped={false} />
                  : <meshBasicMaterial color="#0a1830" toneMapped={false} />}
              </mesh>
            )}
            {/* Four-piece border frame (top / bottom / left / right) */}
            <mesh position={[cx, yc + halfH + bar / 2, frameZ]}>
              <boxGeometry args={[24 + bar * 2, bar, 0.4]} />
              <meshStandardMaterial color={SCREEN_FRAME} roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[cx, yc - halfH - bar / 2, frameZ]}>
              <boxGeometry args={[24 + bar * 2, bar, 0.4]} />
              <meshStandardMaterial color={SCREEN_FRAME} roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[cx - halfW - bar / 2, yc, frameZ]}>
              <boxGeometry args={[bar, 7, 0.4]} />
              <meshStandardMaterial color={SCREEN_FRAME} roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[cx + halfW + bar / 2, yc, frameZ]}>
              <boxGeometry args={[bar, 7, 0.4]} />
              <meshStandardMaterial color={SCREEN_FRAME} roughness={0.5} metalness={0.4} />
            </mesh>
          </group>
        );
      })()}

      {/* ── Red curtains flanking the screen ── */}
      {[cx - 14, cx + 14].map((x, i) => (
        <mesh key={`curtain-${i}`} position={[x, 4.6, zBack - 0.7]}>
          <boxGeometry args={[4, 8.4, 0.5]} />
          <meshStandardMaterial color={CURTAIN_COLOR} roughness={0.95} />
        </mesh>
      ))}

      {/* ── Side wall banners ── */}
      {[xMin + 0.5, xMax - 0.5].flatMap((x, wi) =>
        [cz - 8, cz + 4].map((z, bi) => (
          <mesh key={`banner-${wi}-${bi}`} position={[x + (wi === 0 ? 0.2 : -0.2), 5.5, z]} rotation={[0, wi === 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
            <planeGeometry args={[3, 5]} />
            <meshStandardMaterial color={bi === 0 ? "#1d3a6b" : CURTAIN_COLOR} emissive={bi === 0 ? "#16305c" : "#3a0810"} emissiveIntensity={0.25} side={THREE.DoubleSide} />
          </mesh>
        )),
      )}

      {/* ── Chair rows (instanced) ── */}
      <instancedMesh ref={seatRef} args={[undefined, undefined, chairs.length]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.12, 0.9]} />
        <meshStandardMaterial color="#3a4256" roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={backRef} args={[undefined, undefined, chairs.length]} castShadow>
        <boxGeometry args={[0.9, 0.8, 0.14]} />
        <meshStandardMaterial color="#2f3647" roughness={0.7} />
      </instancedMesh>

      {/* ── Interior lighting (night-readable) ──
          Real-light budget = 8 short-range point lights: 2 coloured stage
          accents + 3 warm "house" lights down the central aisle + 2 side-wall
          sconce lights + 1 warm stage wash. Each uses distance/decay to stay
          cheap. Decorative fixtures below are emissive meshes (zero light cost).
          NOTE: the screen is a meshBasicMaterial (unlit), so no light can
          overexpose it regardless of the stage wash. */}
      {/* Coloured stage accents */}
      <pointLight position={[cx - 10, 7, zBack - 6]} color="#ff3a55" intensity={13} distance={30} decay={2} />
      <pointLight position={[cx + 10, 7, zBack - 6]} color="#3a7bff" intensity={13} distance={30} decay={2} />
      {/* Warm house lights down the central aisle (light chairs + aisles) */}
      {[zFront + 8, cz, zBack - 13].map((z, i) => (
        <pointLight key={`house-${i}`} position={[cx, 6.5, z]} color="#ffe3b0" intensity={16} distance={26} decay={2} />
      ))}
      {/* Side-wall sconce lights */}
      <pointLight position={[xMin + 2, 5, cz - 6]} color="#ffd6a0" intensity={9} distance={20} decay={2} />
      <pointLight position={[xMax - 2, 5, cz + 4]} color="#ffd6a0" intensity={9} distance={20} decay={2} />
      {/* Warm stage wash from the audience side (lights performers, not the screen) */}
      <pointLight position={[cx, 6.5, zBack - 13]} color="#fff0d8" intensity={12} distance={26} decay={2} />

      {/* ── Emissive fixtures (decorative light sources, no real lights) ── */}
      {/* Ceiling light bars spanning the width */}
      {[zFront + 6, zFront + 14, cz + 4, zBack - 8].map((z, i) => (
        <mesh key={`ceilbar-${i}`} position={[cx, H - 0.55, z]}>
          <boxGeometry args={[EVENT_HALL.w - 6, 0.18, 0.7]} />
          <meshStandardMaterial color="#1a1c22" emissive="#ffe6c0" emissiveIntensity={0.9} />
        </mesh>
      ))}
      {/* Aisle floor guide strips (center + two side aisles) */}
      {[cx, xMin + 4, xMax - 4].map((x, i) => (
        <mesh key={`aisle-${i}`} position={[x, 0.06, (zFront + zBack) / 2 - 4]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.6, 26]} />
          <meshStandardMaterial color="#0a0c12" emissive={i === 0 ? "#ffd27a" : "#2bd4ff"} emissiveIntensity={0.7} />
        </mesh>
      ))}
      {/* Wall sconces along both side walls */}
      {[xMin + 0.6, xMax - 0.6].flatMap((x, wi) =>
        [zFront + 9, cz, zBack - 11].map((z, si) => (
          <mesh key={`sconce-${wi}-${si}`} position={[x, 5.5, z]}>
            <boxGeometry args={[0.25, 0.9, 0.5]} />
            <meshStandardMaterial color="#15171d" emissive="#ffcf8a" emissiveIntensity={0.85} />
          </mesh>
        )),
      )}
      {/* Faux spotlight cans on the ceiling over the stage (emissive, no real light) */}
      {[cx - 8, cx, cx + 8].map((x, i) => (
        <mesh key={`spot-${i}`} position={[x, H - 0.9, zBack - 7]} rotation={[Math.PI / 5, 0, 0]}>
          <cylinderGeometry args={[0.35, 0.5, 0.7, 10]} />
          <meshStandardMaterial color="#0c0e14" emissive="#fff0c0" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}
