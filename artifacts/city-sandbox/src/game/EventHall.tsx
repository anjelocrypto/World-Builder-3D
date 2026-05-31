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
import { DistanceGate } from "./DistanceGate";
import {
  EVENT_HALL,
  EVENT_HALL_EXTENTS,
  EVENT_HALL_WALL_BOXES,
  EVENT_HALL_CHAIR,
  EVENT_HALL_STAGE,
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
const WARM_BULB = "#ffe6b8";    // marquee / bollard bulb glow
const GLASS_BLUE = "#1c4f96";   // translucent facade glass panels
const GRAPHITE = "#262a36";     // premium dark structural members

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
    const C = EVENT_HALL_CHAIR;
    chairs.forEach(([x, z], i) => {
      // Seat pad
      dummy.position.set(x, C.seatY, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      seatRef.current?.setMatrixAt(i, dummy.matrix);
      // Backrest — on the north (−Z) side of the seat so the sitter faces +Z (screen)
      dummy.position.set(x, C.backY, z + C.backZOffset);
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

  // ── Phase 14E: grand marquee canopy + facade detail (visual only) ──
  const marqueeTex = useTextTexture(["GRAND PLAZA HALL", "LIVE EVENTS · CONFERENCE · STREAM"], {
    w: 1024, h: 320, bg: "#0c1326", fg: "#ffe9c0", accent: CLEAR_BLUE,
  });
  const MARQUEE = useMemo(() => ({
    y: 6.7,                 // canopy slab height
    depth: 5,               // projection north over the apron
    halfW: 9,               // half-width
    thick: 0.5,
    frontZ: zFront - 5,     // front fascia line (well clear of the entrance gap below)
  }), [zFront]);
  // Marquee bulb row: front edge + the two side edges of the canopy.
  const marqueeBulbs = useMemo(() => {
    const pts: [number, number, number][] = [];
    const fz = MARQUEE.frontZ;
    const y = MARQUEE.y - 0.35;
    for (let x = cx - 8.4; x <= cx + 8.4 + 1e-6; x += 1.3) pts.push([x, y, fz - 0.05]);
    for (let z = fz + 1.2; z <= zFront - 1; z += 1.4) { pts.push([cx - 8.7, y, z]); pts.push([cx + 8.7, y, z]); }
    return pts;
  }, [cx, zFront, MARQUEE]);
  const bulbsRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const d = new THREE.Object3D();
    marqueeBulbs.forEach((p, i) => {
      d.position.set(p[0], p[1], p[2]);
      d.updateMatrix();
      bulbsRef.current?.setMatrixAt(i, d.matrix);
    });
    if (bulbsRef.current) bulbsRef.current.instanceMatrix.needsUpdate = true;
  }, [marqueeBulbs]);

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

      {/* ════════ Phase 14E — GRAND EXTERIOR FACADE (visual only) ════════
          All within the footprint/apron, north of the entrance wall, raised so
          nothing blocks the doorway. No collision is added here. */}

      {/* Gold vertical fins / pilasters flanking the entrance (facade depth) */}
      {[142, 147, 152, 178, 183, 188].map((x, i) => (
        <group key={`fin-${i}`}>
          <mesh position={[x, 4.2, zFront - 0.35]} castShadow>
            <boxGeometry args={[0.5, 8.4, 0.7]} />
            <meshStandardMaterial color="#3a3527" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[x, 4.2, zFront - 0.72]}>
            <boxGeometry args={[0.16, 7.6, 0.06]} />
            <meshStandardMaterial color={CLEAR_BLUE} emissive={CLEAR_BLUE} emissiveIntensity={0.85} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* Translucent blue glass facade panels between fin groups */}
      {[149.5, 180.5].map((x, i) => (
        <mesh key={`glassfront-${i}`} position={[x, 4.4, zFront - 0.55]}>
          <boxGeometry args={[4.4, 6.2, 0.1]} />
          <meshStandardMaterial color={GLASS_BLUE} emissive={GLASS_BLUE} emissiveIntensity={0.4} transparent opacity={0.5} metalness={0.3} roughness={0.2} />
        </mesh>
      ))}

      {/* Cyan LED outline around the entrance opening (on the wall face) */}
      {[
        { p: [cx - EVENT_HALL.entranceGapWidth / 2 - 0.5, 3.2, zFront - 0.42], s: [0.18, 6, 0.12] },
        { p: [cx + EVENT_HALL.entranceGapWidth / 2 + 0.5, 3.2, zFront - 0.42], s: [0.18, 6, 0.12] },
        { p: [cx, 6.1, zFront - 0.42], s: [EVENT_HALL.entranceGapWidth + 1.2, 0.18, 0.12] },
      ].map((b, i) => (
        <mesh key={`entryled-${i}`} position={b.p as [number, number, number]}>
          <boxGeometry args={b.s as [number, number, number]} />
          <meshStandardMaterial color={CLEAR_BLUE} emissive={CLEAR_BLUE} emissiveIntensity={1.0} toneMapped={false} />
        </mesh>
      ))}

      {/* Marquee canopy slab + warm gold underside */}
      <mesh position={[cx, MARQUEE.y, zFront - MARQUEE.depth / 2]} castShadow>
        <boxGeometry args={[MARQUEE.halfW * 2, MARQUEE.thick, MARQUEE.depth]} />
        <meshStandardMaterial color="#23262f" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[cx, MARQUEE.y - 0.29, zFront - MARQUEE.depth / 2]}>
        <boxGeometry args={[MARQUEE.halfW * 2 - 0.5, 0.08, MARQUEE.depth - 0.5]} />
        <meshStandardMaterial color={TRIM_COLOR} emissive={TRIM_COLOR} emissiveIntensity={0.3} metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Canopy front fascia carrying the big illuminated sign */}
      <mesh position={[cx, MARQUEE.y + 0.95, MARQUEE.frontZ]}>
        <boxGeometry args={[MARQUEE.halfW * 2, 2.5, 0.3]} />
        <meshStandardMaterial color="#0c1326" metalness={0.3} roughness={0.6} />
      </mesh>
      {marqueeTex && (
        <mesh position={[cx, MARQUEE.y + 0.95, MARQUEE.frontZ - 0.18]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[MARQUEE.halfW * 2 - 0.6, 2.1]} />
          <meshBasicMaterial map={marqueeTex} toneMapped={false} />
        </mesh>
      )}
      {/* Two slim diagonal support struts under the canopy front corners */}
      {[cx - MARQUEE.halfW + 0.8, cx + MARQUEE.halfW - 0.8].map((x, i) => (
        <mesh key={`strut-${i}`} position={[x, MARQUEE.y - 1.6, zFront - MARQUEE.depth + 0.6]} rotation={[Math.PI / 5, 0, 0]}>
          <boxGeometry args={[0.16, 3.6, 0.16]} />
          <meshStandardMaterial color={GRAPHITE} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* Marquee bulb row (instanced emissive — no real lights) */}
      <instancedMesh ref={bulbsRef} args={[undefined, undefined, marqueeBulbs.length]}>
        <sphereGeometry args={[0.13, 8, 8]} />
        <meshStandardMaterial color="#2a2410" emissive={WARM_BULB} emissiveIntensity={1.6} toneMapped={false} />
      </instancedMesh>

      {/* Roof crown — cyan edge trim around the roof slab perimeter */}
      {[
        { p: [cx, H + 0.66, zMin - 0.5], s: [EVENT_HALL.w + 1.6, 0.16, 0.16] },
        { p: [cx, H + 0.66, zMax + 0.5], s: [EVENT_HALL.w + 1.6, 0.16, 0.16] },
        { p: [xMin - 0.5, H + 0.66, cz], s: [0.16, 0.16, EVENT_HALL.d + 1.6] },
        { p: [xMax + 0.5, H + 0.66, cz], s: [0.16, 0.16, EVENT_HALL.d + 1.6] },
      ].map((b, i) => (
        <mesh key={`crown-${i}`} position={b.p as [number, number, number]}>
          <boxGeometry args={b.s as [number, number, number]} />
          <meshStandardMaterial color={CLEAR_BLUE} emissive={CLEAR_BLUE} emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
      ))}
      {/* Angled roof crown over the marquee (halo trim) */}
      <mesh position={[cx, H + 0.4, zFront - 1.2]} rotation={[-Math.PI / 7, 0, 0]}>
        <boxGeometry args={[EVENT_HALL.w * 0.6, 0.3, 2.4]} />
        <meshStandardMaterial color={GRAPHITE} metalness={0.5} roughness={0.5} />
      </mesh>

      {/* Arrival path guide bollards on the apron (flank the path, clear the gap) */}
      {[156, 174].flatMap((x, xi) =>
        [128, 124.5, 121.5].map((z, zi) => (
          <group key={`bollard-${xi}-${zi}`}>
            <mesh position={[x, 0.5, z]}>
              <cylinderGeometry args={[0.12, 0.16, 1, 8]} />
              <meshStandardMaterial color="#1a1d25" metalness={0.5} roughness={0.5} />
            </mesh>
            <mesh position={[x, 1.06, z]}>
              <sphereGeometry args={[0.14, 8, 8]} />
              <meshStandardMaterial color="#2a2410" emissive={WARM_BULB} emissiveIntensity={1.3} toneMapped={false} />
            </mesh>
          </group>
        )),
      )}

      {/* Exterior real lights — 4 max: 2 facade uplights + marquee wash + path wash.
          Distance-gated: these only mount (and so only cost shader time) when the
          camera is near the hall, instead of being uploaded to every material
          across the whole map. */}
      <DistanceGate center={[cx, 4, cz]} radius={80}>
        <pointLight position={[cx - 7, 0.7, zFront - 1.3]} color="#ffcaa0" intensity={9} distance={14} decay={2} />
        <pointLight position={[cx + 7, 0.7, zFront - 1.3]} color="#ffcaa0" intensity={9} distance={14} decay={2} />
        <pointLight position={[cx, 5.6, MARQUEE.frontZ - 0.6]} color="#ffe6c0" intensity={8} distance={16} decay={2} />
        <pointLight position={[cx, 1.3, zFront - 7]} color="#bfe6ff" intensity={6} distance={15} decay={2} />
      </DistanceGate>

      {/* ── Stage (raised platform at the south end) — solid sides + standable top.
            Rendered from EVENT_HALL_STAGE so visuals match the collider exactly. */}
      <mesh position={[EVENT_HALL_STAGE.x, EVENT_HALL_STAGE.h / 2, EVENT_HALL_STAGE.z]} castShadow receiveShadow>
        <boxGeometry args={[EVENT_HALL_STAGE.w, EVENT_HALL_STAGE.h, EVENT_HALL_STAGE.d]} />
        <meshStandardMaterial color={STAGE_COLOR} roughness={0.6} metalness={0.2} />
      </mesh>
      {/* Stage gold lip along the front (audience) edge */}
      <mesh position={[EVENT_HALL_STAGE.x, EVENT_HALL_STAGE.topY, EVENT_HALL_STAGE.z - EVENT_HALL_STAGE.d / 2 + 0.1]}>
        <boxGeometry args={[EVENT_HALL_STAGE.w, 0.12, 0.3]} />
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
        <boxGeometry args={[EVENT_HALL_CHAIR.seatW, EVENT_HALL_CHAIR.seatH, EVENT_HALL_CHAIR.seatD]} />
        <meshStandardMaterial color="#3a4256" roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={backRef} args={[undefined, undefined, chairs.length]} castShadow>
        <boxGeometry args={[EVENT_HALL_CHAIR.backW, EVENT_HALL_CHAIR.backH, EVENT_HALL_CHAIR.backD]} />
        <meshStandardMaterial color="#2f3647" roughness={0.7} />
      </instancedMesh>

      {/* ── Interior lighting (night-readable) ──
          Real-light budget = 8 short-range point lights: 2 coloured stage
          accents + 3 warm "house" lights down the central aisle + 2 side-wall
          sconce lights + 1 warm stage wash. Each uses distance/decay to stay
          cheap. Decorative fixtures below are emissive meshes (zero light cost).
          NOTE: the screen is a meshBasicMaterial (unlit), so no light can
          overexpose it regardless of the stage wash. */}
      {/* Interior real lights (8) — distance-gated as one group so they only enter
          the scene's light list when the player is at/near the hall. */}
      <DistanceGate center={[cx, 4, cz]} radius={80}>
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
      </DistanceGate>

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

      {/* ════════ Phase 14E — RICHER INTERIOR ARCHITECTURE (visual only) ════════ */}

      {/* Proscenium arch framing the stage/screen opening (columns + top beam).
          Sits just IN FRONT of the stage front edge (z≈157.8), clear of chairs
          (z≤156) and the screen (z≈168), with the audience walking between the
          columns to reach the stage. */}
      {[150, 180].map((x, i) => (
        <group key={`pros-${i}`}>
          <mesh position={[x, 4.2, 157.8]} castShadow>
            <boxGeometry args={[0.85, 8.4, 0.95]} />
            <meshStandardMaterial color={GRAPHITE} metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[x, 4.2, 157.3]}>
            <boxGeometry args={[0.2, 7.8, 0.08]} />
            <meshStandardMaterial color={TRIM_COLOR} emissive={TRIM_COLOR} emissiveIntensity={0.45} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh position={[cx, 8.05, 157.8]} castShadow>
        <boxGeometry args={[31, 0.95, 1.05]} />
        <meshStandardMaterial color={GRAPHITE} metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[cx, 7.55, 157.3]}>
        <boxGeometry args={[30, 0.16, 0.08]} />
        <meshStandardMaterial color={TRIM_COLOR} emissive={TRIM_COLOR} emissiveIntensity={0.45} toneMapped={false} />
      </mesh>

      {/* Premium screen bezel — cyan LED outline LARGER than the frame (sits just
          behind the frame bars, so it never covers the 24×7 content) */}
      {(() => {
        const yc = 5.4, z = zBack - 0.5, hw = 13, hh = 4.3, t = 0.14;
        const bez = (p: [number, number, number], s: [number, number, number], k: string) => (
          <mesh key={k} position={p}>
            <boxGeometry args={s} />
            <meshStandardMaterial color="#0a0c12" emissive={CLEAR_BLUE} emissiveIntensity={0.95} toneMapped={false} />
          </mesh>
        );
        return (
          <group>
            {bez([cx, yc + hh, z], [hw * 2, t, 0.1], "bz-t")}
            {bez([cx, yc - hh, z], [hw * 2, t, 0.1], "bz-b")}
            {bez([cx - hw, yc, z], [t, hh * 2, 0.1], "bz-l")}
            {bez([cx + hw, yc, z], [t, hh * 2, 0.1], "bz-r")}
          </group>
        );
      })()}

      {/* Stage truss across the front + downward emissive spot cans */}
      <mesh position={[cx, 7.4, 159.5]}>
        <boxGeometry args={[30, 0.4, 0.4]} />
        <meshStandardMaterial color="#15171d" metalness={0.6} roughness={0.4} />
      </mesh>
      {[cx - 11, cx - 5.5, cx, cx + 5.5, cx + 11].map((x, i) => (
        <mesh key={`truss-can-${i}`} position={[x, 7.05, 159.5]} rotation={[Math.PI / 4, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.26, 0.5, 8]} />
          <meshStandardMaterial color="#0c0e14" emissive="#bfe0ff" emissiveIntensity={0.7} toneMapped={false} />
        </mesh>
      ))}

      {/* Layered acoustic panels along the side walls (depth + texture) */}
      {[xMin + 0.35, xMax - 0.35].flatMap((x, wi) =>
        [138, 144, 150, 156, 162].map((z, si) => (
          <mesh key={`acou-${wi}-${si}`} position={[x + (wi === 0 ? 0.3 : -0.3), 5, z]}>
            <boxGeometry args={[0.5, 4, 1.1]} />
            <meshStandardMaterial color="#21242e" metalness={0.2} roughness={0.95} />
          </mesh>
        )),
      )}

      {/* VIP balcony illusion — a lit ledge + gold railing high on each side wall */}
      {[xMin + 0.4, xMax - 0.4].map((x, wi) => {
        const lx = x + (wi === 0 ? 0.5 : -0.5);
        const rx = x + (wi === 0 ? 0.95 : -0.95);
        return (
          <group key={`vip-${wi}`}>
            <mesh position={[lx, 4.6, cz]}>
              <boxGeometry args={[1.0, 0.3, 10]} />
              <meshStandardMaterial color={GRAPHITE} metalness={0.3} roughness={0.6} />
            </mesh>
            <mesh position={[lx, 4.42, cz]}>
              <boxGeometry args={[1.0, 0.06, 9.6]} />
              <meshStandardMaterial color="#0a0c12" emissive={CLEAR_BLUE} emissiveIntensity={0.5} toneMapped={false} />
            </mesh>
            {[-4, -2, 0, 2, 4].map((dz, pi) => (
              <mesh key={`rail-${pi}`} position={[rx, 5.1, cz + dz]}>
                <boxGeometry args={[0.06, 0.7, 0.06]} />
                <meshStandardMaterial color={TRIM_COLOR} metalness={0.6} roughness={0.4} />
              </mesh>
            ))}
            <mesh position={[rx, 5.45, cz]}>
              <boxGeometry args={[0.08, 0.08, 10]} />
              <meshStandardMaterial color={TRIM_COLOR} metalness={0.6} roughness={0.4} />
            </mesh>
          </group>
        );
      })}

      {/* Longitudinal ceiling ribs — cross the transverse beams to read as coffers */}
      {[cx - 9, cx, cx + 9].map((x, i) => (
        <mesh key={`rib-${i}`} position={[x, H - 0.5, cz]}>
          <boxGeometry args={[0.3, 0.3, EVENT_HALL.d - 6]} />
          <meshStandardMaterial color="#1a1d25" roughness={1} />
        </mesh>
      ))}

      {/* Extra transverse aisle light strips (more event atmosphere) */}
      {[zFront + 10, cz, zBack - 16].map((z, i) => (
        <mesh key={`xaisle-${i}`} position={[cx, 0.06, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[EVENT_HALL.w - 14, 0.4]} />
          <meshStandardMaterial color="#0a0c12" emissive="#ffd27a" emissiveIntensity={0.55} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
