import type {
  Building,
  RampData,
  CheckpointData,
  VehicleState,
  VehicleVariant,
  DistrictType,
  StreetLightData,
  TrafficLightData,
  ParkingSpot,
  NpcRoute,
  TrafficRoute,
  PropData,
} from "./types";

function seededRandom(seed: number) {
  let s = seed | 0;
  return function (): number {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

const rng = seededRandom(42);

// =============================================================
// ROAD GRID
// =============================================================
// City is a 3x3 grid: N-S roads at x = -45, 0, 45; E-W at z = -45, 0, 45.
// Carriageway is 20 wide; sidewalks are 2 wide on each side.

export const ROADS = {
  ns: [-45, 0, 45] as const,
  ew: [-45, 0, 45] as const,
  width: 20,
  sidewalkWidth: 2,
};

const ROAD_HALF = ROADS.width / 2; // 10

// =============================================================
// DISTRICTS
// =============================================================

interface DistrictDef {
  heightRange: [number, number];
  widthRange: [number, number];
  colors: string[];
  antennaProb: number;
  rooftopBoxProb: number;
}

const DISTRICTS: Record<DistrictType, DistrictDef> = {
  downtown: {
    heightRange: [18, 38],
    widthRange: [8, 16],
    colors: [
      "#506478",
      "#5d7088",
      "#4a6080",
      "#42566a",
      "#3c5a78",
      "#52677c",
      "#4d6680",
      "#5a708c",
      "#6a8098",
      "#3a4d62",
    ],
    antennaProb: 0.6,
    rooftopBoxProb: 0.7,
  },
  commercial: {
    heightRange: [10, 22],
    widthRange: [9, 17],
    colors: [
      "#7a6850",
      "#85735c",
      "#8a7a68",
      "#7d6a52",
      "#766050",
      "#6e5d48",
      "#988572",
      "#a08c7a",
    ],
    antennaProb: 0.25,
    rooftopBoxProb: 0.5,
  },
  residential: {
    heightRange: [5, 14],
    widthRange: [7, 14],
    colors: [
      "#c89968",
      "#b8865c",
      "#a87850",
      "#8a6b48",
      "#ddd2a3",
      "#c4b394",
      "#9c8568",
      "#aa8e6e",
      "#b3a085",
    ],
    antennaProb: 0.1,
    rooftopBoxProb: 0.2,
  },
  plaza: {
    heightRange: [0, 0],
    widthRange: [0, 0],
    colors: [],
    antennaProb: 0,
    rooftopBoxProb: 0,
  },
};

// =============================================================
// BLOCKS
// =============================================================

interface BlockDef {
  cx: number;
  cz: number;
  bw: number;
  bd: number;
  count: number;
  district: DistrictType;
}

// Block layout note: the road grid runs at x = -45, 0, 45 and z = -45, 0,
// 45. Any block whose footprint crosses one of those centerlines would
// place buildings on the carriageway. To avoid that, the four cardinal
// "edge" blocks (north/south/east/west of the plaza) are SPLIT into two
// half-blocks on either side of the road that bisects them. This keeps
// every block strictly off-road while preserving the visual feel of a
// continuous street wall.
const blockDefs: BlockDef[] = [
  // Northwest corner — downtown
  { cx: -65, cz: -65, bw: 30, bd: 30, count: 4, district: "downtown" },
  // North row — split around the N-S road at x = 0
  { cx: -22.5, cz: -65, bw: 15, bd: 30, count: 2, district: "downtown" },
  { cx:  22.5, cz: -65, bw: 15, bd: 30, count: 2, district: "downtown" },
  // Northeast corner — downtown
  { cx:  65, cz: -65, bw: 30, bd: 30, count: 4, district: "downtown" },
  // West row — split around the E-W road at z = 0
  { cx: -65, cz: -22.5, bw: 30, bd: 15, count: 2, district: "commercial" },
  { cx: -65, cz:  22.5, bw: 30, bd: 15, count: 2, district: "commercial" },
  // East row — split around the E-W road at z = 0
  { cx:  65, cz: -22.5, bw: 30, bd: 15, count: 2, district: "commercial" },
  { cx:  65, cz:  22.5, bw: 30, bd: 15, count: 2, district: "commercial" },
  // Center plaza (cx=0, cz=0) is intentionally empty — see SPAWN_POINTS.
  // Southwest corner — residential
  { cx: -65, cz:  65, bw: 30, bd: 30, count: 4, district: "residential" },
  // South row — split around the N-S road at x = 0
  { cx: -22.5, cz:  65, bw: 15, bd: 30, count: 2, district: "residential" },
  { cx:  22.5, cz:  65, bw: 15, bd: 30, count: 2, district: "residential" },
  // Southeast corner — residential
  { cx:  65, cz:  65, bw: 30, bd: 30, count: 4, district: "residential" },
];

// Generate one building inside a block. Dimensions are clamped to fit
// inside `block_dim - padding * 2` so the building footprint can never
// extend past the block boundary, and `padding = 5` gives the validator's
// road check a safe 5-unit margin between every block edge and the
// nearest road carriageway.
function genBuilding(
  cx: number,
  cz: number,
  bw: number,
  bd: number,
  district: DistrictType
): Building {
  const def = DISTRICTS[district];
  const padding = 5;
  const [minW, maxW] = def.widthRange;
  // Effective dimension ranges: never larger than (bw - 2*padding) etc.
  const effMaxW = Math.max(3, Math.min(maxW, bw - padding * 2));
  const effMinW = Math.min(minW, effMaxW);
  const effMaxD = Math.max(3, Math.min(maxW, bd - padding * 2));
  const effMinD = Math.min(minW, effMaxD);
  const w = effMinW + rng() * (effMaxW - effMinW);
  const d = effMinD + rng() * (effMaxD - effMinD);
  const [minH, maxH] = def.heightRange;
  const h = minH + rng() * (maxH - minH);
  const ox = (rng() - 0.5) * Math.max(0, bw - w - padding * 2);
  const oz = (rng() - 0.5) * Math.max(0, bd - d - padding * 2);
  const color = def.colors[Math.floor(rng() * def.colors.length)] ?? "#666";
  const hasAntenna = rng() < def.antennaProb;
  const hasRooftopBox = rng() < def.rooftopBoxProb;
  const windowSeed = Math.floor(rng() * 1e6);
  return {
    x: cx + ox,
    z: cz + oz,
    w,
    d,
    h,
    color,
    district,
    hasAntenna,
    hasRooftopBox,
    windowSeed,
  };
}

export const BUILDINGS: Building[] = blockDefs.flatMap(
  ({ cx, cz, bw, bd, count, district }) =>
    Array.from({ length: count }, () => genBuilding(cx, cz, bw, bd, district))
);

// =============================================================
// VEHICLES — 14 drivable parked cars with variants
// =============================================================

export const INITIAL_VEHICLES: VehicleState[] = [
  // Inner ring — near plaza, easy to find
  { id: "car-0",  x:  22, y: 0.6, z: -22, rotY: 0,                  speed: 0, driverId: null, variant: "sedan",   color: "#e74c3c" },
  { id: "car-1",  x: -22, y: 0.6, z:  22, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#3498db" },
  { id: "car-2",  x:  22, y: 0.6, z:  22, rotY: 0,                  speed: 0, driverId: null, variant: "compact", color: "#c0392b" },
  { id: "car-3",  x: -22, y: 0.6, z: -22, rotY: Math.PI,            speed: 0, driverId: null, variant: "van",     color: "#7f8c8d" },
  // Cardinal cars at mid-radius
  { id: "car-4",  x:  55, y: 0.6, z:   8, rotY: Math.PI / 2,        speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" },
  { id: "car-5",  x: -55, y: 0.6, z:  -8, rotY: -Math.PI / 2,       speed: 0, driverId: null, variant: "compact", color: "#f39c12" },
  { id: "car-6",  x:   8, y: 0.6, z:  55, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#9b59b6" },
  { id: "car-7",  x:  -8, y: 0.6, z: -49, rotY: 0,                  speed: 0, driverId: null, variant: "van",     color: "#16a085" },
  // Mid ring
  { id: "car-8",  x:  35, y: 0.6, z:  35, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#e67e22" },
  { id: "car-9",  x: -35, y: 0.6, z: -35, rotY: 0,                  speed: 0, driverId: null, variant: "van",     color: "#34495e" },
  { id: "car-10", x:  35, y: 0.6, z: -35, rotY: -Math.PI / 2,       speed: 0, driverId: null, variant: "compact", color: "#1abc9c" },
  { id: "car-11", x: -35, y: 0.6, z:  35, rotY: Math.PI / 2,        speed: 0, driverId: null, variant: "sedan",   color: "#d35400" },
  // Outer ring — parked along outer roads, between intersections, well
  // clear of every corner block. Sit on the carriageway shoulder.
  { id: "car-12", x:  41, y: 0.6, z: -70, rotY: 0,                  speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" },
  { id: "car-13", x: -41, y: 0.6, z:  70, rotY: Math.PI,            speed: 0, driverId: null, variant: "compact", color: "#27ae60" },
];

// =============================================================
// SPAWN POINTS — must match server SPAWN_POINTS
// =============================================================

export const SPAWN_POINTS: [number, number, number][] = [
  [0, 1, -12],
  [12, 1, 0],
  [-12, 1, 0],
  [0, 1, 12],
  [15, 1, 15],
  [-15, 1, 15],
  [15, 1, -15],
  [-15, 1, -15],
];

// =============================================================
// CHECKPOINTS — drive-through race gates
// =============================================================

// Checkpoints sit on road centerlines so the racing route stays on roads
// and there is no risk of overlapping a generated building (the validator
// below checks this).
export const CHECKPOINTS: CheckpointData[] = [
  { id: 0, x: 0, z: -45 },
  { id: 1, x: 45, z: 0 },
  { id: 2, x: 0, z: 45 },
  { id: 3, x: -45, z: 0 },
  { id: 4, x: 0, z: -45 },
];

// =============================================================
// RAMPS
// =============================================================

export const RAMPS: RampData[] = [
  { x: 30, z: -30, rotY: Math.PI / 4 },
  { x: -30, z: 30, rotY: (-Math.PI * 3) / 4 },
];

// =============================================================
// STREET LIGHTS — emissive lamp heads, distributed along all roads
// =============================================================

function generateStreetLights(): StreetLightData[] {
  const lights: StreetLightData[] = [];
  const spacing = 22;
  const lampOffset = 12; // just outside the sidewalk

  // Lamps along N-S roads, on both sides every `spacing` z-units.
  for (const x of ROADS.ns) {
    for (let z = -88; z <= 88; z += spacing) {
      lights.push({ x: x - lampOffset, z });
      lights.push({ x: x + lampOffset, z });
    }
  }
  // Lamps along E-W roads, but skip positions too close to a N-S road
  // (that area already has lamps from the loop above).
  for (const z of ROADS.ew) {
    for (let x = -88; x <= 88; x += spacing) {
      const tooClose = ROADS.ns.some((nsx) => Math.abs(x - nsx) < 16);
      if (tooClose) continue;
      lights.push({ x, z: z - lampOffset });
      lights.push({ x, z: z + lampOffset });
    }
  }
  return lights;
}

export const STREET_LIGHTS: StreetLightData[] = generateStreetLights();

// =============================================================
// TRAFFIC LIGHTS — at every road intersection corner
// =============================================================

function generateTrafficLights(): TrafficLightData[] {
  const lights: TrafficLightData[] = [];
  for (const x of ROADS.ns) {
    for (const z of ROADS.ew) {
      lights.push({ x: x - 11, z: z - 11, rotY: 0 });
      lights.push({ x: x + 11, z: z - 11, rotY: -Math.PI / 2 });
      lights.push({ x: x + 11, z: z + 11, rotY: Math.PI });
      lights.push({ x: x - 11, z: z + 11, rotY: Math.PI / 2 });
    }
  }
  return lights;
}

export const TRAFFIC_LIGHTS: TrafficLightData[] = generateTrafficLights();

// =============================================================
// PARKING SPOTS — visual markings under each parked car
// =============================================================

export const PARKING_SPOTS: ParkingSpot[] = INITIAL_VEHICLES.map((v) => ({
  x: v.x,
  z: v.z,
  rotY: v.rotY,
}));

// =============================================================
// NPC ROUTES — sidewalk loops around outer blocks
// =============================================================

const NPC_PALETTE: { skin: string; shirt: string }[] = [
  { skin: "#f5cba7", shirt: "#e74c3c" },
  { skin: "#d4a373", shirt: "#3498db" },
  { skin: "#a87753", shirt: "#27ae60" },
  { skin: "#f5cba7", shirt: "#9b59b6" },
  { skin: "#c89e7a", shirt: "#f39c12" },
  { skin: "#d4a373", shirt: "#1abc9c" },
  { skin: "#f5cba7", shirt: "#e67e22" },
  { skin: "#a87753", shirt: "#34495e" },
];

// Walk the four corners of the block at a fixed offset OUTSIDE its
// footprint (block_half + 3) so the NPC always travels on or near the
// sidewalk — even for narrow split blocks where bw ≠ bd.
function makeBlockSidewalkLoop(
  cx: number,
  cz: number,
  bw: number,
  bd: number
): [number, number][] {
  const halfW = bw / 2 + 3;
  const halfD = bd / 2 + 3;
  return [
    [cx + halfW, cz - halfD],
    [cx + halfW, cz + halfD],
    [cx - halfW, cz + halfD],
    [cx - halfW, cz - halfD],
  ];
}

export const NPC_ROUTES: NpcRoute[] = blockDefs.map((b, i) => ({
  id: i,
  waypoints: makeBlockSidewalkLoop(b.cx, b.cz, b.bw, b.bd),
  cycleSeconds: 60 + (i % 3) * 8,
  skinColor: NPC_PALETTE[i % NPC_PALETTE.length].skin,
  shirtColor: NPC_PALETTE[i % NPC_PALETTE.length].shirt,
}));

// =============================================================
// TRAFFIC ROUTES — ambient AI cars on a perimeter loop
// =============================================================
// Outer perimeter loop driving counter-clockwise, in the right-hand lane.
// We use a 4-unit lane offset from each road's centerline so cars sit in the
// correct lane for their direction of travel.
//
// Convention (matches LocalPlayer): rotY=0 → -Z, π → +Z, π/2 → -X, -π/2 → +X.
//
//      (heading W along z=-45)
//   NW──────────────────────NE
//   │                         │
//   │ heading S          heading N
//   │ along x=-45        along x=+45
//   │                         │
//   SW──────────────────────SE
//      (heading E along z=+45)

const OUTER_LOOP: [number, number, number][] = [
  // Top road segment, driving WEST (rotY = π/2): lane offset z = -41 (north side of road)
  [45, -41, Math.PI / 2],
  [-45, -41, Math.PI / 2],
  // Left road segment, driving SOUTH (rotY = π): lane offset x = -49 (west side)
  [-49, -45, Math.PI],
  [-49, 45, Math.PI],
  // Bottom road segment, driving EAST (rotY = -π/2): lane offset z = 41
  [-45, 41, -Math.PI / 2],
  [45, 41, -Math.PI / 2],
  // Right road segment, driving NORTH (rotY = 0): lane offset x = 49
  [49, 45, 0],
  [49, -45, 0],
];

export const TRAFFIC_ROUTES: TrafficRoute[] = [
  {
    id: 0,
    waypoints: OUTER_LOOP,
    cycleSeconds: 70,
    cars: [
      { id: "ai-0", color: "#5d6d7e", variant: "sedan", phase: 0.0 },
      { id: "ai-1", color: "#6e2f1a", variant: "van", phase: 0.25 },
      { id: "ai-2", color: "#1a3a2a", variant: "compact", phase: 0.5 },
      { id: "ai-3", color: "#34495e", variant: "taxi", phase: 0.75 },
    ],
  },
];

// =============================================================
// PROPS — benches, planters, trashcans, hydrants
// =============================================================

export const PROPS: PropData[] = [
  // Plaza benches facing inward
  { x: 11, z: -14, rotY: -Math.PI / 2, type: "bench" },
  { x: -11, z: -14, rotY: Math.PI / 2, type: "bench" },
  { x: 11, z: 14, rotY: -Math.PI / 2, type: "bench" },
  { x: -11, z: 14, rotY: Math.PI / 2, type: "bench" },
  // Planters at plaza corners
  { x: 16, z: 16, rotY: 0, type: "planter" },
  { x: -16, z: 16, rotY: 0, type: "planter" },
  { x: 16, z: -16, rotY: 0, type: "planter" },
  { x: -16, z: -16, rotY: 0, type: "planter" },
  // Trashcans + hydrants near outer intersections
  { x: 47, z: -47, rotY: 0, type: "trashcan" },
  { x: -47, z: -47, rotY: 0, type: "trashcan" },
  { x: 47, z: 47, rotY: 0, type: "hydrant" },
  { x: -47, z: 47, rotY: 0, type: "hydrant" },
];

// =============================================================
// VARIANT METADATA — used by VehicleObject and AmbientTraffic
// =============================================================

export const VARIANT_DIMENSIONS: Record<
  VehicleVariant,
  { bodyW: number; bodyH: number; bodyD: number; cabinW: number; cabinH: number; cabinD: number; cabinOffsetZ: number }
> = {
  sedan:   { bodyW: 2.2, bodyH: 0.8, bodyD: 4.5, cabinW: 1.8, cabinH: 0.7, cabinD: 2.4, cabinOffsetZ: -0.2 },
  van:     { bodyW: 2.3, bodyH: 1.0, bodyD: 5.0, cabinW: 2.1, cabinH: 1.4, cabinD: 3.6, cabinOffsetZ: -0.4 },
  taxi:    { bodyW: 2.2, bodyH: 0.8, bodyD: 4.5, cabinW: 1.8, cabinH: 0.7, cabinD: 2.4, cabinOffsetZ: -0.2 },
  compact: { bodyW: 2.0, bodyH: 0.7, bodyD: 3.8, cabinW: 1.6, cabinH: 0.6, cabinD: 2.0, cabinOffsetZ: -0.2 },
};

// =============================================================
// COLLISION & VALIDATION HELPERS
// =============================================================

export const PLAYER_RADIUS = 0.5;

export function checkBuildingCollision(
  px: number,
  pz: number,
  radius = PLAYER_RADIUS
): boolean {
  for (const b of BUILDINGS) {
    const hw = b.w / 2 + radius;
    const hd = b.d / 2 + radius;
    if (Math.abs(px - b.x) < hw && Math.abs(pz - b.z) < hd) {
      return true;
    }
  }
  return false;
}

// True if (px, pz) sits on a road carriageway. Used by the validator to
// check that no generated building corner intrudes onto a road.
function isOnRoad(px: number, pz: number): boolean {
  for (const x of ROADS.ns) if (Math.abs(px - x) < ROAD_HALF) return true;
  for (const z of ROADS.ew) if (Math.abs(pz - z) < ROAD_HALF) return true;
  return false;
}

// =============================================================
// DEV-ONLY VALIDATION
// =============================================================
// Warns if any spawn / vehicle / checkpoint overlaps a building, or if any
// generated building corner intrudes onto a road carriageway. Runs once on
// module load in Vite dev mode. Safe-guarded so plain Node imports don't
// crash on `import.meta.env`.

const isViteDev =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env !== "undefined" &&
  import.meta.env.DEV === true;

if (isViteDev) {
  const issues: string[] = [];

  for (const sp of SPAWN_POINTS) {
    if (checkBuildingCollision(sp[0], sp[2])) {
      issues.push(`spawn ${JSON.stringify(sp)} overlaps a building`);
    }
  }
  for (const v of INITIAL_VEHICLES) {
    if (checkBuildingCollision(v.x, v.z, 1.5)) {
      issues.push(`vehicle ${v.id} at (${v.x}, ${v.z}) overlaps a building`);
    }
  }
  for (const cp of CHECKPOINTS) {
    if (checkBuildingCollision(cp.x, cp.z, 4)) {
      issues.push(`checkpoint ${cp.id} at (${cp.x}, ${cp.z}) overlaps a building`);
    }
  }
  for (const b of BUILDINGS) {
    const corners: [number, number][] = [
      [b.x - b.w / 2, b.z - b.d / 2],
      [b.x + b.w / 2, b.z - b.d / 2],
      [b.x + b.w / 2, b.z + b.d / 2],
      [b.x - b.w / 2, b.z + b.d / 2],
    ];
    if (corners.some(([cx, cz]) => isOnRoad(cx, cz))) {
      issues.push(
        `building (${b.x.toFixed(1)}, ${b.z.toFixed(1)}, ${b.district}) ` +
          `overlaps a road carriageway`
      );
    }
  }

  if (issues.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${issues.length} city validation issue(s):`);
    for (const m of issues) {
      // eslint-disable-next-line no-console
      console.warn("  -", m);
    }
  } else {
    // eslint-disable-next-line no-console
    console.info(
      `[city-sandbox] city OK: ${BUILDINGS.length} buildings across ` +
        `${blockDefs.length} blocks, ${INITIAL_VEHICLES.length} vehicles, ` +
        `${SPAWN_POINTS.length} spawns, ${CHECKPOINTS.length} checkpoints, ` +
        `${STREET_LIGHTS.length} streetlamps, ${TRAFFIC_LIGHTS.length} ` +
        `traffic lights, ${NPC_ROUTES.length} NPC routes, ` +
        `${TRAFFIC_ROUTES.reduce((sum, r) => sum + r.cars.length, 0)} ambient cars.`
    );
  }
}
