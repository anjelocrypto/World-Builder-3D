import type { Building, RampData, CheckpointData, VehicleState } from "./types";

function seededRandom(seed: number) {
  let s = seed | 0;
  return function (): number {
    s = Math.imul(s, 1664525) + 1013904223;
    return ((s >>> 0) / 0x100000000);
  };
}

const rng = seededRandom(42);

const COLORS = [
  "#5d6d7e", "#7f8c8d", "#626567", "#717d7e",
  "#808b96", "#4d5656", "#616a6b", "#515a5a",
  "#6e2f1a", "#1a3a2a", "#1a2a3a", "#2a1a3a",
];

// City grid: N-S roads at x=-45, 0, 45; E-W roads at z=-45, 0, 45
// Road width = 10 units each side (total 20), so clear zone: x in [-50,-40], [-5,5], [40,50]
// Block centers (between roads):
//   x: -67.5, -22.5, 22.5, 67.5  (but we clamp map to ~120 so outermost = ~60)
//   z: same

interface BlockDef {
  cx: number;
  cz: number;
  bw: number;
  bd: number;
  count: number;
}

const blockDefs: BlockDef[] = [
  { cx: -65, cz: -65, bw: 30, bd: 30, count: 4 },
  { cx: 0, cz: -65, bw: 30, bd: 30, count: 4 },
  { cx: 65, cz: -65, bw: 30, bd: 30, count: 4 },
  { cx: -65, cz: 0, bw: 30, bd: 30, count: 4 },
  // Center block (cx=0, cz=0) is intentionally omitted. The road grid runs
  // through this area (N-S road at x=0, E-W road at z=0), so any building
  // placed here would clip the road AND the spawn plaza. Keeping it empty
  // guarantees every spawn point in SPAWN_POINTS lands on clear ground.
  { cx: 65, cz: 0, bw: 30, bd: 30, count: 4 },
  { cx: -65, cz: 65, bw: 30, bd: 30, count: 4 },
  { cx: 0, cz: 65, bw: 30, bd: 30, count: 4 },
  { cx: 65, cz: 65, bw: 30, bd: 30, count: 4 },
];

function genBuilding(cx: number, cz: number, bw: number, bd: number): Building {
  const padding = 4;
  const maxW = Math.max(5, bw - padding * 2);
  const maxD = Math.max(5, bd - padding * 2);
  const w = 4 + rng() * maxW * 0.6;
  const d = 4 + rng() * maxD * 0.6;
  const h = 5 + rng() * 22;
  const ox = (rng() - 0.5) * (bw - w - padding * 2);
  const oz = (rng() - 0.5) * (bd - d - padding * 2);
  const color = COLORS[Math.floor(rng() * COLORS.length)];
  return { x: cx + ox, z: cz + oz, w, d, h, color };
}

export const BUILDINGS: Building[] = blockDefs.flatMap(({ cx, cz, bw, bd, count }) =>
  Array.from({ length: count }, () => genBuilding(cx, cz, bw, bd))
);

export const INITIAL_VEHICLES: VehicleState[] = [
  { id: "car-0", x: 22, y: 0.6, z: -22, rotY: 0,           speed: 0, driverId: null, color: "#e74c3c" },
  { id: "car-1", x: -22, y: 0.6, z: 22,  rotY: Math.PI,    speed: 0, driverId: null, color: "#3498db" },
  { id: "car-2", x: 55,  y: 0.6, z: 8,   rotY: Math.PI / 2, speed: 0, driverId: null, color: "#2ecc71" },
  { id: "car-3", x: -55, y: 0.6, z: -8,  rotY: -Math.PI / 2, speed: 0, driverId: null, color: "#f39c12" },
];

// Spawn points placed inside the central plaza (cx=0, cz=0 block is empty
// — see blockDefs above). The four cardinal positions sit on the sidewalk
// edge of the central road cross, and the four diagonals sit in the
// guaranteed-empty quadrants. Distance from origin is at least 12u, which
// is well clear of the road carriageway (roads span ±10 around x=0/z=0).
export const SPAWN_POINTS: [number, number, number][] = [
  [0,   1, -12],
  [12,  1,  0 ],
  [-12, 1,  0 ],
  [0,   1,  12],
  [15,  1,  15],
  [-15, 1,  15],
  [15,  1, -15],
  [-15, 1, -15],
];

export const CHECKPOINTS: CheckpointData[] = [
  { id: 0, x: 0,   z: -42 },
  { id: 1, x: 55,  z: 0   },
  { id: 2, x: 0,   z: 55  },
  { id: 3, x: -55, z: 0   },
  { id: 4, x: 0,   z: -42 },
];

export const RAMPS: RampData[] = [
  { x: 30,  z: -30, rotY: Math.PI / 4 },
  { x: -30, z: 30,  rotY: -Math.PI * 3 / 4 },
];

export const PLAYER_RADIUS = 0.5;

export function checkBuildingCollision(px: number, pz: number): boolean {
  for (const b of BUILDINGS) {
    const hw = b.w / 2 + PLAYER_RADIUS;
    const hd = b.d / 2 + PLAYER_RADIUS;
    if (Math.abs(px - b.x) < hw && Math.abs(pz - b.z) < hd) {
      return true;
    }
  }
  return false;
}

// Dev-only sanity check: if any spawn point lands inside a generated
// building, the player would freeze in place. We log a loud warning in
// development so the configuration can be fixed before it ships.
if (import.meta.env.DEV) {
  const bad = SPAWN_POINTS.filter(([x, , z]) => checkBuildingCollision(x, z));
  if (bad.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[city-sandbox] ${bad.length} of ${SPAWN_POINTS.length} spawn ` +
        `point(s) overlap a generated building. Move them or adjust ` +
        `blockDefs in cityData.ts. Offending points:`,
      bad
    );
  }
}
