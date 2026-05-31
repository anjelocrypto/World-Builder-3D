import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { VehicleState, VehicleVariant } from "../shared/types";
import { VARIANT_DIMENSIONS } from "../shared/cityData";
import { getVehicleGroundFrame } from "../shared/elevation";

interface VehicleObjectProps {
  state: VehicleState;
  isLocalDriverVehicle: boolean;
}

// Module-level scratch — one Vector3 reused across every remote
// vehicle's per-frame lerp instead of allocating a new instance every
// frame for every car (was ~20 allocs/frame with 20 remotes).
const _lerpTarget = new THREE.Vector3();

// Body-root height above the wheel-contact plane. State.y semantics
// stay "ground + VEHICLE_BODY_LIFT" (matches LocalPlayer +
// AmbientTraffic + INITIAL_VEHICLES y=0.6), and CarVisual internally
// shifts its content down by this amount so tire bottoms land exactly
// on the ground. See CarVisual below.
const VEHICLE_BODY_LIFT = 0.6;

export default function VehicleObject({
  state,
  isLocalDriverVehicle,
}: VehicleObjectProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const pitchRef = useRef(0);
  const rollRef = useRef(0);

  useFrame(() => {
    const g = groupRef.current;
    if (!g || isLocalDriverVehicle) return;

    // Recompute the ground frame from x/z/rotY each frame. y is
    // deterministic from x/z (terrainHeightAt is pure), so this never
    // disagrees with what the authoritative driver computed.
    const dim =
      (state.variant && VARIANT_DIMENSIONS[state.variant]) ??
      VARIANT_DIMENSIONS.sedan;
    const wheelbase = dim.bodyD - 2.0; // CarVisual: wheelOffsetZ = bodyD/2 - 1
    const trackWidth = dim.bodyW + 0.04; // CarVisual: wheelOffsetX = bodyW/2 + 0.02
    const frame = getVehicleGroundFrame(
      state.x,
      state.z,
      state.rotY,
      wheelbase,
      trackWidth,
    );
    _lerpTarget.set(state.x, frame.centerY + VEHICLE_BODY_LIFT, state.z);
    g.position.lerp(_lerpTarget, 0.15);
    g.rotation.y += (state.rotY - g.rotation.y) * 0.15;
    pitchRef.current += (frame.pitch - pitchRef.current) * 0.2;
    rollRef.current += (frame.roll - rollRef.current) * 0.2;
    g.rotation.x = pitchRef.current;
    g.rotation.z = rollRef.current;
  });

  return (
    <group
      ref={groupRef}
      position={[state.x, state.y, state.z]}
      // YXZ order so yaw is applied first, then pitch around the
      // vehicle's lateral axis, then roll around its forward axis.
      // Default 'XYZ' would mix the axes when both pitch and roll are
      // non-zero on a switchback corner.
      rotation={new THREE.Euler(0, state.rotY, 0, "YXZ")}
    >
      <CarVisual variant={state.variant} color={state.color} />
    </group>
  );
}

interface CarVisualProps {
  // Accept any string (or undefined) so an unexpected value coming from
  // the network can't crash rendering. We narrow defensively below.
  variant: string | undefined;
  color: string;
  // Whether this car body / cabin should cast shadows. Drivable + remote
  // player cars stay true; cosmetic ambient traffic passes false to drop
  // ~22 shadow casters from the scene without changing what the player sees.
  castShadow?: boolean;
}

// =============================================================
// Module-level shared materials & geometries.
// -------------------------------------------------------------
// Every car shares these — there is exactly one tire material, one
// glass material, one wheel cylinder, etc., regardless of how many
// cars are on screen. Colored body paint is cached per color string
// because there are only a handful of distinct car colors in cityData.
// =============================================================

const _paintCache = new Map<string, THREE.MeshStandardMaterial>();
function getPaint(color: string): THREE.MeshStandardMaterial {
  let m = _paintCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.55,
    });
    _paintCache.set(color, m);
  }
  return m;
}

// Slightly darker, matte paint used for low-detail trim pieces (bumper
// caps that take the body color, etc.) so the silhouette has a touch
// of tonal break-up instead of a single flat hue.
const _trimPaintCache = new Map<string, THREE.MeshStandardMaterial>();
function getTrimPaint(color: string): THREE.MeshStandardMaterial {
  let m = _trimPaintCache.get(color);
  if (!m) {
    const c = new THREE.Color(color).multiplyScalar(0.85);
    m = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.7,
      metalness: 0.2,
    });
    _trimPaintCache.set(color, m);
  }
  return m;
}

const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: "#1a2433",
  roughness: 0.15,
  metalness: 0.4,
  transparent: true,
  opacity: 0.65,
});
const TIRE_MAT = new THREE.MeshStandardMaterial({
  color: "#0d0d0d",
  roughness: 0.95,
  metalness: 0.0,
});
const RIM_MAT = new THREE.MeshStandardMaterial({
  color: "#cccccc",
  roughness: 0.3,
  metalness: 0.85,
});
const HUB_MAT = new THREE.MeshStandardMaterial({
  color: "#444444",
  roughness: 0.5,
  metalness: 0.6,
});
const PLASTIC_MAT = new THREE.MeshStandardMaterial({
  color: "#1a1a1a",
  roughness: 0.85,
  metalness: 0.05,
});
const SEAM_MAT = new THREE.MeshBasicMaterial({ color: "#0a0a0a" });
const HEADLIGHT_MAT = new THREE.MeshStandardMaterial({
  color: "#fff5d0",
  emissive: "#fff5d0",
  emissiveIntensity: 1.15, // brighter for night presence (Phase-1 car polish)
  roughness: 0.3,
});
const TAILLIGHT_MAT = new THREE.MeshStandardMaterial({
  color: "#e74c3c",
  emissive: "#c0392b",
  emissiveIntensity: 0.9, // brighter for night presence (Phase-1 car polish)
  roughness: 0.4,
});
// Cool-white daytime-running-light accent strip under each headlight.
const DRL_MAT = new THREE.MeshStandardMaterial({
  color: "#eaf2ff",
  emissive: "#cfe0ff",
  emissiveIntensity: 1.1,
  roughness: 0.4,
});
// Dark housing that sits just behind the emissive headlight lens so the lit
// element reads as set into a cluster instead of floating on the bumper.
// (Reuses PLASTIC_MAT — no new material needed.)

// ── Soft contact shadow (grounding) ──────────────────────────────────────────
// A single radial-gradient canvas texture shared by every car. Drawn as one
// flat quad under the body so cars read as planted on the road instead of
// floating. Pure visual: no light, no collision, scaled to each car footprint.
let _shadowTex: THREE.Texture | null = null;
function getShadowTexture(): THREE.Texture {
  if (_shadowTex) return _shadowTex;
  const SZ = 64;
  const c = document.createElement("canvas");
  c.width = SZ;
  c.height = SZ;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(SZ / 2, SZ / 2, 2, SZ / 2, SZ / 2, SZ / 2);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.6, "rgba(0,0,0,0.26)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SZ, SZ);
  }
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}
let _shadowMat: THREE.MeshBasicMaterial | null = null;
function getShadowMat(): THREE.MeshBasicMaterial {
  if (_shadowMat) return _shadowMat;
  _shadowMat = new THREE.MeshBasicMaterial({
    map: getShadowTexture(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  return _shadowMat;
}
const TURNSIGNAL_MAT = new THREE.MeshStandardMaterial({
  color: "#ffaa33",
  emissive: "#ff8800",
  emissiveIntensity: 0.4,
  roughness: 0.5,
});
const REVERSE_MAT = new THREE.MeshStandardMaterial({
  color: "#f5f5f5",
  emissive: "#ffffff",
  emissiveIntensity: 0.25,
  roughness: 0.5,
});
const PLATE_MAT = new THREE.MeshStandardMaterial({
  color: "#f0e8c8",
  roughness: 0.6,
  metalness: 0.05,
});
const TAXI_BLACK_MAT = new THREE.MeshStandardMaterial({
  color: "#0d0d0d",
  roughness: 0.6,
  metalness: 0.2,
});
const TAXI_SIGN_MAT = new THREE.MeshStandardMaterial({
  color: "#ffd000",
  emissive: "#ffaa00",
  emissiveIntensity: 0.5,
  roughness: 0.4,
});

// Shared geometries (size-agnostic). Variant-sized geometries (body /
// cabin / hood) are built per-variant via useMemo below, but the
// resulting BufferGeometry is also cached at module level, keyed by
// variant — so 50 sedans share the same hood geometry instance.
const TIRE_GEO = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 16);
const RIM_GEO = new THREE.CylinderGeometry(0.22, 0.22, 0.34, 12);
const HUB_GEO = new THREE.CylinderGeometry(0.08, 0.08, 0.36, 8);
const HEADLIGHT_GEO = new THREE.BoxGeometry(0.42, 0.18, 0.08);
const TAILLIGHT_GEO = new THREE.BoxGeometry(0.42, 0.18, 0.08);
const TURNSIGNAL_GEO = new THREE.BoxGeometry(0.18, 0.12, 0.06);
const REVERSE_GEO = new THREE.BoxGeometry(0.16, 0.1, 0.06);
const PLATE_GEO = new THREE.BoxGeometry(0.8, 0.22, 0.04);
const HANDLE_GEO = new THREE.BoxGeometry(0.18, 0.05, 0.04);
const MIRROR_GEO = new THREE.BoxGeometry(0.12, 0.12, 0.22);
const SEAM_VERT_GEO = new THREE.PlaneGeometry(0.02, 0.7); // door seam
const SEAM_HORIZ_GEO = new THREE.PlaneGeometry(0.7, 0.02);
const GRILLE_BAR_GEO = new THREE.BoxGeometry(0.9, 0.04, 0.04);
const CONTACT_SHADOW_GEO = new THREE.PlaneGeometry(1, 1); // scaled per car footprint
const HL_HOUSING_GEO = new THREE.BoxGeometry(0.5, 0.26, 0.05); // dark cluster behind lens
const DRL_GEO = new THREE.BoxGeometry(0.34, 0.04, 0.05); // running-light accent strip

// =============================================================
// Per-variant geometry builder.
// -------------------------------------------------------------
// Returns rounded body shells and cabin pieces for a given variant.
// Cached at module scope keyed by variant so sedans, vans, taxis,
// compacts each build their geometry exactly once across the whole
// session.
// =============================================================

interface VariantGeo {
  bodyMain: THREE.BufferGeometry;
  bodyTop: THREE.BufferGeometry; // beveled top layer
  hood: THREE.BufferGeometry;
  trunk: THREE.BufferGeometry | null; // null for van
  cabin: THREE.BufferGeometry;
  cabinTop: THREE.BufferGeometry; // beveled roof
  bumperFront: THREE.BufferGeometry;
  bumperRear: THREE.BufferGeometry;
  archFL: THREE.BufferGeometry;
  rocker: THREE.BufferGeometry;   // lower side sill cladding (one per side)
  beltline: THREE.BufferGeometry; // chrome trim strip at the window base
}

const _variantGeoCache = new Map<VehicleVariant, VariantGeo>();
function getVariantGeo(v: VehicleVariant): VariantGeo {
  let g = _variantGeoCache.get(v);
  if (g) return g;
  const dim = VARIANT_DIMENSIONS[v];
  // Main body: slightly beveled by stacking a wider bottom + narrower
  // upper layer instead of a single box.
  const bodyMain = new THREE.BoxGeometry(dim.bodyW, dim.bodyH * 0.7, dim.bodyD);
  const bodyTop = new THREE.BoxGeometry(
    dim.bodyW * 0.96,
    dim.bodyH * 0.35,
    dim.bodyD * 0.98,
  );
  // Hood: front quarter of the body, lower than cabin.
  const hoodLen = v === "van" ? dim.bodyD * 0.18 : dim.bodyD * 0.28;
  const hood = new THREE.BoxGeometry(dim.bodyW * 0.92, dim.bodyH * 0.5, hoodLen);
  // Trunk: rear quarter; vans have no trunk (cargo box covers it).
  const trunk =
    v === "van"
      ? null
      : new THREE.BoxGeometry(
          dim.bodyW * 0.92,
          dim.bodyH * 0.5,
          dim.bodyD * 0.22,
        );
  const cabin = new THREE.BoxGeometry(dim.cabinW, dim.cabinH, dim.cabinD);
  // Roof bevel: a slightly smaller box on top so the cabin doesn't read
  // as a single flat brick.
  const cabinTop = new THREE.BoxGeometry(
    dim.cabinW * 0.85,
    dim.cabinH * 0.25,
    dim.cabinD * 0.9,
  );
  const bumperFront = new THREE.BoxGeometry(
    dim.bodyW * 0.98,
    dim.bodyH * 0.35,
    0.18,
  );
  const bumperRear = new THREE.BoxGeometry(
    dim.bodyW * 0.98,
    dim.bodyH * 0.35,
    0.18,
  );
  const archFL = new THREE.BoxGeometry(0.55, 0.45, 0.55);
  // Lower side sill: thin, runs most of the body length along local Z.
  const rocker = new THREE.BoxGeometry(0.07, dim.bodyH * 0.32, dim.bodyD * 0.82);
  // Chrome beltline strip at the base of the greenhouse, along the cabin length.
  const beltline = new THREE.BoxGeometry(0.04, 0.06, dim.cabinD * 0.94);
  g = {
    bodyMain,
    bodyTop,
    hood,
    trunk,
    cabin,
    cabinTop,
    bumperFront,
    bumperRear,
    archFL,
    rocker,
    beltline,
  };
  _variantGeoCache.set(v, g);
  return g;
}

// =============================================================
// CarVisual — shared upgraded car renderer.
// -------------------------------------------------------------
// Used by:
//   • Parked + remote vehicles (VehicleObject above)
//   • LocalPlayer driven vehicle
//   • Cosmetic ambient AI traffic (castShadow={false})
//
// IMPORTANT — vehicle facing convention:
//   The gameplay convention (LocalPlayer.updateVehicle, traffic-route
//   atan2(-dx,-dz), collision.ts) is that a vehicle's FORWARD direction
//   is local -Z. Therefore in this visual:
//     • headlights / front bumper / grille / front plate → local -Z side
//     • taillights / rear bumper / rear plate            → local +Z side
//     • cabin sits slightly toward the REAR (+Z), so cabinOffsetZ > 0
//   Do NOT reintroduce +Z-as-front assumptions here.
//
// Performance notes:
//   • All paint, glass, tire, rim, plastic, light, plate, taxi-trim
//     materials are module-level singletons (paint/trim are cached
//     by color key, not per-instance).
//   • Shared geometries (wheel, headlight, plate, mirror, handle,
//     seams, grille bars) are module-level singletons.
//   • Variant-specific geometries (body, cabin, hood, trunk, bumpers,
//     wheel arch) are cached per variant the first time that variant
//     is rendered — every later instance reuses them.
//   • No new Object3D / Material allocations happen per frame; the
//     useMemo here just picks references out of the caches.
// =============================================================
export function CarVisual({ variant, color, castShadow = true }: CarVisualProps) {
  const safeVariant: VehicleVariant =
    variant && Object.hasOwn(VARIANT_DIMENSIONS, variant)
      ? (variant as VehicleVariant)
      : "sedan";
  const dim = VARIANT_DIMENSIONS[safeVariant];

  const paint = useMemo(() => getPaint(color), [color]);
  const trimPaint = useMemo(() => getTrimPaint(color), [color]);
  const geo = useMemo(() => getVariantGeo(safeVariant), [safeVariant]);

  const wheelOffsetZ = dim.bodyD / 2 - 1.0;
  const wheelOffsetX = dim.bodyW / 2 + 0.02;
  const bodyMidY = dim.bodyH * 0.35; // center of bodyMain (height = bodyH*0.7)
  const bodyTopY = dim.bodyH * 0.7 + dim.bodyH * 0.175; // center of bodyTop
  const cabinY = dim.bodyH + dim.cabinH / 2;
  const cabinTopY = dim.bodyH + dim.cabinH + dim.cabinH * 0.125;
  const halfD = dim.bodyD / 2;
  const halfW = dim.bodyW / 2;

  // Hood / trunk longitudinal placement (local-Z). Front = -Z.
  const hoodLen = safeVariant === "van" ? dim.bodyD * 0.18 : dim.bodyD * 0.28;
  const hoodCenterZ = -halfD + hoodLen / 2;
  const trunkLen = dim.bodyD * 0.22;
  const trunkCenterZ = halfD - trunkLen / 2;

  const isTaxi = safeVariant === "taxi";
  const isVan = safeVariant === "van";

  return (
    <group position={[0, -VEHICLE_BODY_LIFT, 0]}>
      {/* ^^^^ Tire-grounding offset.
          CarVisual is authored with tire-center at local y=0.4 and tire
          radius 0.4, so tire bottoms naturally sit at local y=0. The
          gameplay convention (LocalPlayer + AmbientTraffic + INITIAL_VEHICLES)
          is that vehicle state.y = groundY + VEHICLE_BODY_LIFT (0.6),
          i.e. the *body root* — NOT the tire contact line. So we shift
          all CarVisual content down by VEHICLE_BODY_LIFT here. With
          state.y = groundY + 0.6 and content shifted by -0.6, the tire
          bottoms render at world y = groundY exactly. The driving
          headlight (defined as a sibling of CarVisual in LocalPlayer)
          stays at its old world height since IT is not wrapped. */}
      {/* ----- Soft contact shadow — a single radial-gradient quad scaled to the
                car footprint so the body reads as planted on the road. Sits just
                above the ground plane; no light, no collision. Cheap enough that
                even ambient traffic gets it. ----- */}
      <mesh
        geometry={CONTACT_SHADOW_GEO}
        material={getShadowMat()}
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[dim.bodyW * 1.35, dim.bodyD * 1.12, 1]}
        renderOrder={-1}
      />

      {/* ----- Bumpers (dark plastic, sit slightly forward/back of body) ----- */}
      <mesh
        geometry={geo.bumperFront}
        material={PLASTIC_MAT}
        position={[0, dim.bodyH * 0.35, -halfD - 0.05]}
        castShadow={castShadow}
      />
      <mesh
        geometry={geo.bumperRear}
        material={PLASTIC_MAT}
        position={[0, dim.bodyH * 0.35, halfD + 0.05]}
        castShadow={castShadow}
      />

      {/* ----- Body main lower (full size) + body top (slightly bevelled) ----- */}
      <mesh
        geometry={geo.bodyMain}
        material={paint}
        position={[0, bodyMidY, 0]}
        castShadow={castShadow}
      />
      <mesh
        geometry={geo.bodyTop}
        material={paint}
        position={[0, bodyTopY, 0]}
        castShadow={castShadow}
      />

      {/* ----- Hood (front, lower than cabin) ----- */}
      <mesh
        geometry={geo.hood}
        material={paint}
        position={[0, dim.bodyH * 0.85, hoodCenterZ]}
        castShadow={castShadow}
      />

      {/* ----- Trunk (rear, lower than cabin) — sedans/taxis/compacts only ----- */}
      {geo.trunk && (
        <mesh
          geometry={geo.trunk}
          material={paint}
          position={[0, dim.bodyH * 0.85, trunkCenterZ]}
          castShadow={castShadow}
        />
      )}

      {/* ----- Cabin + roof bevel ----- */}
      <mesh
        geometry={geo.cabin}
        material={isTaxi ? TAXI_SIGN_MAT : paint}
        position={[0, cabinY, dim.cabinOffsetZ]}
        castShadow={castShadow}
      />
      <mesh
        geometry={geo.cabinTop}
        material={isTaxi ? TAXI_BLACK_MAT : trimPaint}
        position={[0, cabinTopY, dim.cabinOffsetZ]}
        castShadow={castShadow}
      />

      {/* ----- Windshield (FRONT — local -Z side of cabin) ----- */}
      <mesh
        position={[
          0,
          dim.bodyH + dim.cabinH * 0.55,
          dim.cabinOffsetZ - dim.cabinD / 2 - 0.02,
        ]}
        rotation={[0.4, 0, 0]}
        material={GLASS_MAT}
      >
        <planeGeometry args={[dim.cabinW * 0.95, dim.cabinH * 0.95]} />
      </mesh>
      {/* Rear glass (REAR — local +Z) */}
      <mesh
        position={[
          0,
          dim.bodyH + dim.cabinH * 0.55,
          dim.cabinOffsetZ + dim.cabinD / 2 + 0.02,
        ]}
        rotation={[-0.4, 0, 0]}
        material={GLASS_MAT}
      >
        <planeGeometry args={[dim.cabinW * 0.95, dim.cabinH * 0.95]} />
      </mesh>
      {/* Side windows (left + right faces of cabin) */}
      <mesh
        position={[
          -dim.cabinW / 2 - 0.005,
          dim.bodyH + dim.cabinH * 0.6,
          dim.cabinOffsetZ,
        ]}
        rotation={[0, -Math.PI / 2, 0]}
        material={GLASS_MAT}
      >
        <planeGeometry args={[dim.cabinD * 0.92, dim.cabinH * 0.7]} />
      </mesh>
      <mesh
        position={[
          dim.cabinW / 2 + 0.005,
          dim.bodyH + dim.cabinH * 0.6,
          dim.cabinOffsetZ,
        ]}
        rotation={[0, Math.PI / 2, 0]}
        material={GLASS_MAT}
      >
        <planeGeometry args={[dim.cabinD * 0.92, dim.cabinH * 0.7]} />
      </mesh>

      {/* ----- Wheels: tire + rim + hub. Rims/hubs are decorative,
                shadow-casting only on the body to keep the budget. ----- */}
      {[
        [-wheelOffsetX, 0.4, wheelOffsetZ],
        [wheelOffsetX, 0.4, wheelOffsetZ],
        [-wheelOffsetX, 0.4, -wheelOffsetZ],
        [wheelOffsetX, 0.4, -wheelOffsetZ],
      ].map(([wx, wy, wz], i) => (
        <group
          key={i}
          position={[wx, wy, wz]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <mesh geometry={TIRE_GEO} material={TIRE_MAT} />
          <mesh geometry={RIM_GEO} material={RIM_MAT} />
          <mesh geometry={HUB_GEO} material={HUB_MAT} />
        </group>
      ))}

      {/* ----- Wheel arches: small dark plastic boxes wrapped over each wheel ----- */}
      {[
        [-wheelOffsetX, 0.45, wheelOffsetZ],
        [wheelOffsetX, 0.45, wheelOffsetZ],
        [-wheelOffsetX, 0.45, -wheelOffsetZ],
        [wheelOffsetX, 0.45, -wheelOffsetZ],
      ].map(([ax, ay, az], i) => (
        <mesh
          key={i}
          geometry={geo.archFL}
          material={PLASTIC_MAT}
          position={[ax, ay, az]}
        />
      ))}

      {/* ----- Side mirrors (just behind the front of the cabin) ----- */}
      <mesh
        geometry={MIRROR_GEO}
        material={PLASTIC_MAT}
        position={[
          -dim.cabinW / 2 - 0.1,
          dim.bodyH + dim.cabinH * 0.65,
          dim.cabinOffsetZ - dim.cabinD / 2 + 0.1,
        ]}
      />
      <mesh
        geometry={MIRROR_GEO}
        material={PLASTIC_MAT}
        position={[
          dim.cabinW / 2 + 0.1,
          dim.bodyH + dim.cabinH * 0.65,
          dim.cabinOffsetZ - dim.cabinD / 2 + 0.1,
        ]}
      />

      {/* ----- Door handles (one per side, mid-cabin height) ----- */}
      <mesh
        geometry={HANDLE_GEO}
        material={RIM_MAT}
        position={[
          -dim.cabinW / 2 - 0.02,
          dim.bodyH + dim.cabinH * 0.35,
          dim.cabinOffsetZ,
        ]}
      />
      <mesh
        geometry={HANDLE_GEO}
        material={RIM_MAT}
        position={[
          dim.cabinW / 2 + 0.02,
          dim.bodyH + dim.cabinH * 0.35,
          dim.cabinOffsetZ,
        ]}
      />

      {/* ----- Door seams: thin black planes on each side, splitting
                the cabin into front + rear doors ----- */}
      <mesh
        geometry={SEAM_VERT_GEO}
        material={SEAM_MAT}
        position={[
          -dim.cabinW / 2 - 0.01,
          dim.bodyH + dim.cabinH * 0.45,
          dim.cabinOffsetZ,
        ]}
        rotation={[0, -Math.PI / 2, 0]}
      />
      <mesh
        geometry={SEAM_VERT_GEO}
        material={SEAM_MAT}
        position={[
          dim.cabinW / 2 + 0.01,
          dim.bodyH + dim.cabinH * 0.45,
          dim.cabinOffsetZ,
        ]}
        rotation={[0, Math.PI / 2, 0]}
      />
      {/* Hood seam (front, where hood meets cabin) */}
      <mesh
        geometry={SEAM_HORIZ_GEO}
        material={SEAM_MAT}
        position={[0, dim.bodyH * 0.7 + 0.01, hoodCenterZ + hoodLen / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      />

      {/* ----- Headlights + headlight cluster: emissive boxes + small
                turn-signal accent on the outboard edge ----- */}
      <mesh
        geometry={HEADLIGHT_GEO}
        material={HEADLIGHT_MAT}
        position={[-0.55, dim.bodyH * 0.55, -halfD - 0.1]}
      />
      <mesh
        geometry={HEADLIGHT_GEO}
        material={HEADLIGHT_MAT}
        position={[0.55, dim.bodyH * 0.55, -halfD - 0.1]}
      />
      <mesh
        geometry={TURNSIGNAL_GEO}
        material={TURNSIGNAL_MAT}
        position={[-halfW + 0.15, dim.bodyH * 0.55, -halfD - 0.1]}
      />
      <mesh
        geometry={TURNSIGNAL_GEO}
        material={TURNSIGNAL_MAT}
        position={[halfW - 0.15, dim.bodyH * 0.55, -halfD - 0.1]}
      />

      {/* ----- Grille: short stack of horizontal bars on the front face ----- */}
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          geometry={GRILLE_BAR_GEO}
          material={PLASTIC_MAT}
          position={[0, dim.bodyH * 0.45 - i * 0.07, -halfD - 0.06]}
        />
      ))}

      {/* ----- Taillights, brake strip, reverse pads ----- */}
      <mesh
        geometry={TAILLIGHT_GEO}
        material={TAILLIGHT_MAT}
        position={[-0.55, dim.bodyH * 0.55, halfD + 0.1]}
      />
      <mesh
        geometry={TAILLIGHT_GEO}
        material={TAILLIGHT_MAT}
        position={[0.55, dim.bodyH * 0.55, halfD + 0.1]}
      />
      {/* Center brake strip */}
      <mesh
        position={[0, dim.bodyH * 0.55, halfD + 0.1]}
        material={TAILLIGHT_MAT}
      >
        <boxGeometry args={[0.5, 0.1, 0.05]} />
      </mesh>
      {/* Reverse light pads inboard of taillights */}
      <mesh
        geometry={REVERSE_GEO}
        material={REVERSE_MAT}
        position={[-0.28, dim.bodyH * 0.55, halfD + 0.1]}
      />
      <mesh
        geometry={REVERSE_GEO}
        material={REVERSE_MAT}
        position={[0.28, dim.bodyH * 0.55, halfD + 0.1]}
      />

      {/* ----- License plates ----- */}
      <mesh
        geometry={PLATE_GEO}
        material={PLATE_MAT}
        position={[0, dim.bodyH * 0.25, -halfD - 0.16]}
      />
      <mesh
        geometry={PLATE_GEO}
        material={PLATE_MAT}
        position={[0, dim.bodyH * 0.25, halfD + 0.16]}
      />

      {/* ----- Extra premium detail — only on "hero" cars (castShadow=true:
                player / remote / parked). Skipped on cosmetic ambient traffic to
                keep its per-car mesh count down. Shared/cached geometry +
                module-level materials only; all within the body envelope. ----- */}
      {castShadow && (
        <>
          {/* Lower rocker sills (dark cladding) — tonal break along the bottom */}
          <mesh
            geometry={geo.rocker}
            material={PLASTIC_MAT}
            position={[-halfW, dim.bodyH * 0.16, 0]}
          />
          <mesh
            geometry={geo.rocker}
            material={PLASTIC_MAT}
            position={[halfW, dim.bodyH * 0.16, 0]}
          />
          {/* Chrome beltline trim at the base of the windows */}
          <mesh
            geometry={geo.beltline}
            material={RIM_MAT}
            position={[-dim.cabinW / 2 - 0.012, dim.bodyH + 0.02, dim.cabinOffsetZ]}
          />
          <mesh
            geometry={geo.beltline}
            material={RIM_MAT}
            position={[dim.cabinW / 2 + 0.012, dim.bodyH + 0.02, dim.cabinOffsetZ]}
          />
          {/* Headlight chrome/dark housings behind the emissive lenses */}
          <mesh
            geometry={HL_HOUSING_GEO}
            material={PLASTIC_MAT}
            position={[-0.55, dim.bodyH * 0.55, -halfD - 0.07]}
          />
          <mesh
            geometry={HL_HOUSING_GEO}
            material={PLASTIC_MAT}
            position={[0.55, dim.bodyH * 0.55, -halfD - 0.07]}
          />
          {/* Cool-white DRL accent strip under each headlight */}
          <mesh
            geometry={DRL_GEO}
            material={DRL_MAT}
            position={[-0.55, dim.bodyH * 0.42, -halfD - 0.1]}
          />
          <mesh
            geometry={DRL_GEO}
            material={DRL_MAT}
            position={[0.55, dim.bodyH * 0.42, -halfD - 0.1]}
          />
        </>
      )}

      {/* ----- Variant-specific extras ----- */}

      {/* Taxi: realistic rooftop sign + black hood/trunk trim stripe */}
      {isTaxi && (
        <>
          {/* Rooftop sign block (yellow body, black base, side checker bars) */}
          <group
            position={[0, dim.bodyH + dim.cabinH + 0.28, dim.cabinOffsetZ]}
          >
            <mesh material={TAXI_BLACK_MAT}>
              <boxGeometry args={[1.0, 0.08, 0.5]} />
            </mesh>
            <mesh material={TAXI_SIGN_MAT} position={[0, 0.18, 0]} castShadow={castShadow}>
              <boxGeometry args={[0.95, 0.28, 0.45]} />
            </mesh>
            {/* Checker stripes on each side of sign */}
            <mesh material={TAXI_BLACK_MAT} position={[0, 0.18, 0.23]}>
              <boxGeometry args={[0.95, 0.08, 0.02]} />
            </mesh>
            <mesh material={TAXI_BLACK_MAT} position={[0, 0.18, -0.23]}>
              <boxGeometry args={[0.95, 0.08, 0.02]} />
            </mesh>
          </group>
          {/* Black side stripe across both doors */}
          <mesh
            material={TAXI_BLACK_MAT}
            position={[
              -dim.cabinW / 2 - 0.012,
              dim.bodyH * 0.55,
              dim.cabinOffsetZ,
            ]}
          >
            <boxGeometry args={[0.02, 0.18, dim.cabinD * 0.95]} />
          </mesh>
          <mesh
            material={TAXI_BLACK_MAT}
            position={[
              dim.cabinW / 2 + 0.012,
              dim.bodyH * 0.55,
              dim.cabinOffsetZ,
            ]}
          >
            <boxGeometry args={[0.02, 0.18, dim.cabinD * 0.95]} />
          </mesh>
        </>
      )}

      {/* Van: tall rear cargo box + side sliding-door seam + rear double-door split */}
      {isVan && (
        <>
          {/* Rear cargo box raises the silhouette behind the cabin */}
          <mesh
            material={paint}
            position={[
              0,
              dim.bodyH + dim.cabinH * 0.5,
              dim.cabinOffsetZ + dim.cabinD / 2 + 0.05,
            ]}
            castShadow={castShadow}
          >
            <boxGeometry
              args={[dim.cabinW * 0.98, dim.cabinH * 1.0, 0.25]}
            />
          </mesh>
          {/* Side sliding-door vertical seam on each side */}
          <mesh
            geometry={SEAM_VERT_GEO}
            material={SEAM_MAT}
            position={[
              -dim.cabinW / 2 - 0.011,
              dim.bodyH + dim.cabinH * 0.5,
              dim.cabinOffsetZ + dim.cabinD * 0.25,
            ]}
            rotation={[0, -Math.PI / 2, 0]}
          />
          <mesh
            geometry={SEAM_VERT_GEO}
            material={SEAM_MAT}
            position={[
              dim.cabinW / 2 + 0.011,
              dim.bodyH + dim.cabinH * 0.5,
              dim.cabinOffsetZ + dim.cabinD * 0.25,
            ]}
            rotation={[0, Math.PI / 2, 0]}
          />
          {/* Vertical seam down the middle of the rear (double doors) */}
          <mesh
            material={SEAM_MAT}
            position={[0, dim.bodyH + dim.cabinH * 0.4, halfD + 0.18]}
          >
            <boxGeometry args={[0.02, dim.cabinH * 0.85, 0.01]} />
          </mesh>
        </>
      )}
    </group>
  );
}
