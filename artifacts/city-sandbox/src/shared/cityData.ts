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
  RoadPath,
  StaticObstacle,
  StaticObstacleKind,
  TreeInstance,
  RockInstance,
} from "./types";
import { distancePointToPolyline } from "./roadGeom";

// =============================================================
// WORLD BOUNDS
// =============================================================
// The full playable map is 1000x1000 (WORLD_HALF=500). The original
// 200x200 city sits at the centre inside |x|,|z| ≤ CITY_HALF=100, and
// new biomes occupy the surrounding ring: mountain (north), bridge +
// forest (south), suburban/industrial (east), fields/depot (west).

export const WORLD_HALF = 500;
export const WORLD_SIZE = 1000;
export const CITY_HALF = 100;

// Per-biome rectangular bounds, used by the minimap tints and the
// dev-time validator. Any point outside every biome rect is "wilderness"
// (open ground with no road or obstacle).
export const BIOME_BOUNDS = {
  city:     { x0: -CITY_HALF, x1: CITY_HALF,  z0: -CITY_HALF, z1: CITY_HALF },
  mountain: { x0: -300,        x1: 300,        z0: -WORLD_HALF, z1: -CITY_HALF },
  bridge:   { x0: -30,         x1:  30,        z0:  CITY_HALF,  z1:  180 },
  forest:   { x0: -300,        x1: 300,        z0:  180,        z1:  WORLD_HALF },
  east:     { x0:  CITY_HALF,  x1:  WORLD_HALF, z0: -200,       z1:  200 },
  west:     { x0: -WORLD_HALF, x1: -CITY_HALF, z0: -200,        z1:  200 },
} as const;

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
  // ===== City (14 cars) — original 200x200 hub =====
  { id: "car-0",  x:  22, y: 0.6, z: -22, rotY: 0,                  speed: 0, driverId: null, variant: "sedan",   color: "#e74c3c" },
  { id: "car-1",  x: -22, y: 0.6, z:  22, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#3498db" },
  { id: "car-2",  x:  22, y: 0.6, z:  22, rotY: 0,                  speed: 0, driverId: null, variant: "compact", color: "#c0392b" },
  { id: "car-3",  x: -22, y: 0.6, z: -22, rotY: Math.PI,            speed: 0, driverId: null, variant: "van",     color: "#7f8c8d" },
  { id: "car-4",  x:  55, y: 0.6, z:   8, rotY: Math.PI / 2,        speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" },
  { id: "car-5",  x: -55, y: 0.6, z:  -8, rotY: -Math.PI / 2,       speed: 0, driverId: null, variant: "compact", color: "#f39c12" },
  { id: "car-6",  x:   8, y: 0.6, z:  55, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#9b59b6" },
  { id: "car-7",  x:  -8, y: 0.6, z: -49, rotY: 0,                  speed: 0, driverId: null, variant: "van",     color: "#16a085" },
  { id: "car-8",  x:  35, y: 0.6, z:  35, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#e67e22" },
  { id: "car-9",  x: -35, y: 0.6, z: -35, rotY: 0,                  speed: 0, driverId: null, variant: "van",     color: "#34495e" },
  { id: "car-10", x:  35, y: 0.6, z: -35, rotY: -Math.PI / 2,       speed: 0, driverId: null, variant: "compact", color: "#1abc9c" },
  { id: "car-11", x: -35, y: 0.6, z:  35, rotY: Math.PI / 2,        speed: 0, driverId: null, variant: "sedan",   color: "#d35400" },
  { id: "car-12", x:  41, y: 0.6, z: -70, rotY: 0,                  speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" },
  { id: "car-13", x: -41, y: 0.6, z:  70, rotY: Math.PI,            speed: 0, driverId: null, variant: "compact", color: "#27ae60" },
  // ===== Mountain biome (4 cars) — switchbacks + lookout + observatory =====
  { id: "car-14", x:  90, y: 0.6, z: -250, rotY: -Math.PI / 2,      speed: 0, driverId: null, variant: "sedan",   color: "#5d6d7e" },
  { id: "car-15", x: -75, y: 0.6, z: -290, rotY: 0,                 speed: 0, driverId: null, variant: "van",     color: "#7d6e58" },
  { id: "car-16", x:  75, y: 0.6, z: -340, rotY: Math.PI,           speed: 0, driverId: null, variant: "compact", color: "#a04060" },
  { id: "car-17", x: -10, y: 0.6, z: -465, rotY: 0,                 speed: 0, driverId: null, variant: "taxi",    color: "#e8a02a" },
  // ===== Forest biome (6 cars) — South Forest Village =====
  // Each car parks on a pad/spur/driveway (validator enforces this).
  { id: "car-18", x:  15, y: 0.6, z:  213, rotY: Math.PI,           speed: 0, driverId: null, variant: "compact", color: "#2e7d32" }, // gateway-spur
  { id: "car-19", x: -58, y: 0.6, z:  320, rotY: Math.PI / 2,       speed: 0, driverId: null, variant: "sedan",   color: "#558b2f" }, // village loop W
  { id: "car-20", x:  60, y: 0.6, z:  340, rotY: -Math.PI / 2,      speed: 0, driverId: null, variant: "van",     color: "#6d4c41" }, // village loop E
  { id: "car-21", x: -37, y: 0.6, z:  418, rotY: -Math.PI / 2,      speed: 0, driverId: null, variant: "sedan",   color: "#8d6e63" }, // cabin-W1 driveway
  { id: "car-22", x:  47, y: 0.6, z:  376, rotY: Math.atan2(10, 12), speed: 0, driverId: null, variant: "compact", color: "#33691e" }, // cabin-E1 driveway
  { id: "car-23", x: -15, y: 0.6, z:  482, rotY: Math.PI / 2,       speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" }, // trailhead-spur
  // ===== East suburban / industrial (3 cars) =====
  { id: "car-24", x: 235, y: 0.6, z:  -30, rotY: 0,                 speed: 0, driverId: null, variant: "van",     color: "#455a64" },
  { id: "car-25", x: 310, y: 0.6, z:   80, rotY: -Math.PI / 2,      speed: 0, driverId: null, variant: "sedan",   color: "#5d4037" },
  { id: "car-26", x: 420, y: 0.6, z:  -55, rotY: Math.PI,           speed: 0, driverId: null, variant: "compact", color: "#37474f" },
  // ===== West fields / depot (1 car) =====
  { id: "car-27", x: -220, y: 0.6, z:   65, rotY: Math.PI / 2,      speed: 0, driverId: null, variant: "van",     color: "#3e2723" },
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
// below checks this). Three race routes are stitched together into one
// flat array so the existing race UI can drive any of them in sequence.
//
// Forest-run gates 6–9 trace the curved forest-main polyline at its
// vertices: bridge end (0,180), forest apex (-30,290), the segment foot
// (50,360)→(-40,430) at z≈380, and the (-40,430) vertex. Final gate sits
// on the spine end. Mountain-run gates 10–13 step from the spine top at
// (0,-200) through switchback vertices (80,-240), (-80,-390), (0,-465).
export const CHECKPOINTS: CheckpointData[] = [
  // City race (5 gates)
  { id: 0,  x:  0,   z: -45 },
  { id: 1,  x:  45,  z:   0 },
  { id: 2,  x:  0,   z:  45 },
  { id: 3,  x: -45,  z:   0 },
  { id: 4,  x:  0,   z: -45 },
  // Forest run — city, bridge, forest spine (all on road centerlines)
  { id: 5,  x:  0,   z: 130 }, // spine-south vertex
  { id: 6,  x:  0,   z: 180 }, // bridge / forest-main junction
  { id: 7,  x: -30,  z: 290 }, // forest-main vertex (apex)
  { id: 8,  x:  25,  z: 380 }, // foot of perpendicular on (50,360)→(-40,430)
  { id: 9,  x: -40,  z: 430 }, // forest-main vertex
  // Mountain run — switchback vertices
  { id: 10, x:  0,   z: -200 }, // spine-north / switchback junction
  { id: 11, x:  80,  z: -240 }, // first switchback corner
  { id: 12, x: -80,  z: -390 }, // mid-switchback corner
  { id: 13, x:  0,   z: -465 }, // switchback exit
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

// =============================================================
// Traffic-loop helpers
// =============================================================
//
// `closedLoopRoute` walks a closed polyline once and assigns each
// waypoint a heading aimed at the next waypoint (with wrap-around).
// `forwardReverseRoute` turns a one-way polyline (e.g. a switchback or
// a service spur) into a closed round-trip: forward leg, then the same
// vertices in reverse, excluding endpoints to avoid duplicate stops.
// At the two endpoints there is a hard 180° heading flip; the ambient
// traffic interpolator (collision.ts → ambientCarStateAt) smooths the
// rotation over the following segment via shortestAngleDelta.

function closedLoopRoute(
  poly: ReadonlyArray<readonly [number, number]>,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % n];
    const dx = nxt[0] - cur[0];
    const dz = nxt[1] - cur[1];
    out.push([cur[0], cur[1], Math.atan2(-dx, -dz)]);
  }
  return out;
}

function forwardReverseRoute(
  poly: ReadonlyArray<readonly [number, number]>,
): [number, number, number][] {
  const n = poly.length;
  if (n < 2) return [];
  const path: [number, number][] = [];
  for (let i = 0; i < n; i++) path.push([poly[i][0], poly[i][1]]);
  for (let i = n - 2; i >= 1; i--) path.push([poly[i][0], poly[i][1]]);
  return closedLoopRoute(path);
}

// City outer perimeter loop (counter-clockwise, original).
// Hand-tuned so each waypoint sits on the city carriageway with a
// readable lane offset; closedLoopRoute would also work but the
// hand-tuned headings give nicer corner pivots.
const OUTER_LOOP: [number, number, number][] = [
  [ 45, -41, Math.PI / 2],
  [-45, -41, Math.PI / 2],
  [-49, -45, Math.PI],
  [-49,  45, Math.PI],
  [-45,  41, -Math.PI / 2],
  [ 45,  41, -Math.PI / 2],
  [ 49,  45, 0],
  [ 49, -45, 0],
];

// Mountain switchback round-trip — follows the rendered
// `mountain-switchbacks` polyline forward (top → summit) and back.
const MOUNTAIN_SWITCHBACK_POLY: ReadonlyArray<readonly [number, number]> = [
  [  0, -200], [ 80, -240], [-80, -290], [ 80, -340],
  [-80, -390], [ 80, -430], [  0, -465],
];
const MOUNTAIN_LOOP: [number, number, number][] = forwardReverseRoute(
  MOUNTAIN_SWITCHBACK_POLY,
);

// Bridge / forest round-trip — follows spine-south (0,100→0,130),
// bridge (0,130→0,180), and the curved forest-main polyline up to its
// north endpoint. All coordinates match REGIONAL_ROADS centerlines.
// (0,200) inserted to match the forest-main vertex that stitches into
// the outer-loop south leg.
const BRIDGE_FOREST_POLY: ReadonlyArray<readonly [number, number]> = [
  [  0, 100], [  0, 130], [  0, 180], [  0, 200], [ 40, 230],
  [-30, 290], [ 50, 360], [-40, 430], [  0, 482],
];
const BRIDGE_FOREST_LOOP: [number, number, number][] = forwardReverseRoute(
  BRIDGE_FOREST_POLY,
);

// East service-road round-trip — follows `east-service` end-to-end.
// Extended to (460,30) to match the new east-service terminus on the
// outer-loop east leg.
const EAST_SERVICE_POLY: ReadonlyArray<readonly [number, number]> = [
  [100, 0], [200, 0], [300, 30], [430, 30], [460, 30],
];
const EAST_LOOP: [number, number, number][] = forwardReverseRoute(
  EAST_SERVICE_POLY,
);

// Inner-city-ring closed loop — drives the eight cardinal/corner
// vertices of inner-city-ring counter-clockwise starting from the SE
// corner. closedLoopRoute supplies headings aimed at the next vertex.
const INNER_RING_POLY: ReadonlyArray<readonly [number, number]> = [
  [ 100, -100], [ 100,    0], [ 100,  100], [   0,  100],
  [-100,  100], [-100,    0], [-100, -100], [   0, -100],
];
const INNER_CITY_RING_LOOP: [number, number, number][] = closedLoopRoute(
  INNER_RING_POLY,
);

// Outer regional loop — drives the eleven outer-loop vertices counter-
// clockwise starting from the SE corner.
const OUTER_LOOP_POLY: ReadonlyArray<readonly [number, number]> = [
  [ 460,  200], [ 460,   30], [ 460, -200],
  [ 260, -380], [-260, -380],
  [-460, -200], [-460,    0], [-460,  200],
  [-220,  200], [   0,  200], [ 220,  200],
];
const OUTER_REGIONAL_LOOP: [number, number, number][] = closedLoopRoute(
  OUTER_LOOP_POLY,
);

// Legacy unused names (kept zeroed-out so any stale import would fail
// loudly). The original `EAST_LOOP` rectangle was off-road; replaced.
const _LEGACY_EAST_LOOP_UNUSED: [number, number, number][] = [
  [200, -30, -Math.PI / 2],
  [470, -30, -Math.PI / 2],
  [470, -30,  Math.PI],
  [470,  60,  Math.PI],
  [470,  60,  Math.PI / 2],
  [200,  60,  Math.PI / 2],
  [200,  60,  0],
  [200, -30,  0],
];

export const TRAFFIC_ROUTES: TrafficRoute[] = [
  {
    id: 0,
    waypoints: OUTER_LOOP,
    cycleSeconds: 70,
    cars: [
      { id: "ai-0", color: "#5d6d7e", variant: "sedan",   phase: 0.0  },
      { id: "ai-1", color: "#6e2f1a", variant: "van",     phase: 0.25 },
      { id: "ai-2", color: "#1a3a2a", variant: "compact", phase: 0.5  },
      { id: "ai-3", color: "#34495e", variant: "taxi",    phase: 0.75 },
    ],
  },
  {
    id: 1,
    waypoints: MOUNTAIN_LOOP,
    cycleSeconds: 110,
    cars: [
      { id: "ai-4", color: "#7d6e58", variant: "sedan", phase: 0.0 },
      { id: "ai-5", color: "#5a4a3a", variant: "van",   phase: 0.5 },
    ],
  },
  {
    id: 2,
    waypoints: BRIDGE_FOREST_LOOP,
    cycleSeconds: 90,
    cars: [
      { id: "ai-6", color: "#2e5934", variant: "compact", phase: 0.0 },
      { id: "ai-7", color: "#506e3a", variant: "sedan",   phase: 0.5 },
    ],
  },
  {
    id: 3,
    waypoints: EAST_LOOP,
    cycleSeconds: 80,
    cars: [
      { id: "ai-8", color: "#455a64", variant: "van",     phase: 0.0 },
      { id: "ai-9", color: "#37474f", variant: "compact", phase: 0.5 },
    ],
  },
  {
    id: 4,
    waypoints: INNER_CITY_RING_LOOP,
    cycleSeconds: 95,
    cars: [
      { id: "ai-10", color: "#4a5b6b", variant: "sedan",   phase: 0.0  },
      { id: "ai-11", color: "#7a5a3a", variant: "taxi",    phase: 0.33 },
      { id: "ai-12", color: "#3a3a4a", variant: "compact", phase: 0.66 },
    ],
  },
  {
    id: 5,
    waypoints: OUTER_REGIONAL_LOOP,
    cycleSeconds: 220,
    cars: [
      { id: "ai-13", color: "#2d3a4a", variant: "sedan",   phase: 0.0  },
      { id: "ai-14", color: "#5a4030", variant: "van",     phase: 0.25 },
      { id: "ai-15", color: "#3a2a1a", variant: "compact", phase: 0.5  },
      { id: "ai-16", color: "#404848", variant: "taxi",    phase: 0.75 },
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
// REGIONAL ROADS — polylines outside the central city grid
// =============================================================
// Each entry is rendered by BiomeRender as a chain of road quads
// (one per segment), with width and surface type controlling colour
// and lane markings. The minimap also draws every polyline.

export const REGIONAL_ROADS: RoadPath[] = [
  // North spine + mountain switchbacks
  { id: "spine-north",
    points: [[0, -100], [0, -150], [0, -200]],
    width: 14, type: "asphalt" },
  { id: "mountain-switchbacks",
    points: [[0, -200], [80, -240], [-80, -290], [80, -340], [-80, -390], [80, -430], [0, -465]],
    width: 12, type: "mountain" },
  { id: "mountain-lookout",
    points: [[80, -240], [110, -250]],
    width: 10, type: "mountain" },
  // South spine, bridge, forest
  { id: "spine-south",
    points: [[0, 100], [0, 130]],
    width: 14, type: "asphalt" },
  { id: "bridge",
    points: [[0, 130], [0, 180]],
    width: 14, type: "bridge" },
  { id: "forest-main",
    // (0,200) shares a node with outer-loop south leg so the road graph
    // stitches the city/bridge spine into the regional outer loop. The
    // intermediate vertices (10,391),(-30,422),(-6,473) are collinear on
    // the original (50,360)→(-40,430) and (-40,430)→(0,482) segments;
    // adding them does NOT change the rendered geometry — they exist
    // purely so each cabin driveway start coincides with a graph node
    // (i.e. drv-cabin-e2 starts at (10,391), drv-cabin-w1 at (-30,422),
    // drv-cabin-e3 at (-6,473)). Without these, every cabin driveway
    // shows up as an "isolated road" component in the road-graph
    // validator even though it visibly hugs forest-main.
    points: [[0, 180], [0, 200], [40, 230], [-30, 290], [50, 360],
             [10, 391], [-30, 422], [-40, 430], [-6, 473], [0, 482]],
    width: 12, type: "forest" },
  { id: "forest-spur",
    points: [[40, 230], [120, 240]],
    width: 8, type: "dirt" }, // outlier fishing cabin
  // -----------------------------------------------------------------
  // South Forest Village — gateway / village center / cabin row /
  // trailhead. All branch off forest-main. Loop is closed by repeating
  // first point at end so the rendered chain draws every edge.
  // -----------------------------------------------------------------
  { id: "gateway-spur",
    // Prepended (0,200) so the spur shares a graph node with forest-main
    // and outer-loop. The (0,200)→(6,213) segment is a short stub from
    // the gateway intersection up to the original parking spur.
    points: [[0, 200], [6, 213], [24, 213]],
    width: 6, type: "dirt" },
  { id: "village-loop",
    points: [[5, 285], [55, 295], [65, 325], [60, 355], [25, 365],
             [-30, 365], [-55, 345], [-60, 315], [-30, 290], [5, 285]],
    width: 10, type: "dirt" },
  // drv-cabin-* — each driveway starts at a graph node on either the
  // village-loop or forest-main polyline, so the road-graph validator
  // sees it as connected to the main component.
  { id: "drv-cabin-e1",
    points: [[25, 365], [40, 368], [50, 380]], // start = village-loop vertex
    width: 6, type: "dirt" },
  { id: "drv-cabin-e2",
    // End nudged from (20,405) → (16,405) so the carriageway clears the
    // cabin-E2 AABB at (28,399) by ~4m (was sitting at exactly 1.0m, the
    // polish threshold). Driveway is purely cosmetic — no parked car
    // depends on this exact endpoint.
    points: [[10, 391], [16, 405]],            // start = forest-main vertex
    width: 6, type: "dirt" },
  { id: "drv-cabin-e3",
    points: [[-6, 473], [10, 460]],            // start = forest-main vertex
    width: 6, type: "dirt" },
  { id: "drv-cabin-w1",
    points: [[-30, 422], [-40, 410]],          // start = forest-main vertex
    width: 6, type: "dirt" },
  { id: "drv-cabin-w2",
    points: [[-40, 430], [-55, 440]],          // start = forest-main vertex
    width: 6, type: "dirt" },
  { id: "trailhead-spur",
    // (0,482) inserted so the spur shares a node with forest-main's end.
    points: [[-25, 482], [0, 482], [25, 482]],
    width: 10, type: "dirt" },
  // East service road — extended to (460,30) so it terminates on the
  // outer-loop east leg (which has a vertex at (460,30)).
  { id: "east-service",
    points: [[100, 0], [200, 0], [300, 30], [430, 30], [460, 30]],
    width: 12, type: "asphalt" },
  // West utility road — terminus (-460, 0) shares a node with the
  // outer-loop west leg vertex at (-460, 0).
  { id: "west-utility",
    points: [[-100, 0], [-220, -20], [-360, -20], [-460, 0]],
    width: 10, type: "dirt" },
  // -----------------------------------------------------------------
  // ROAD-NETWORK MASTER PLAN
  // -----------------------------------------------------------------
  // inner-city-ring: a closed asphalt quad at |x|=|z|=100 that wraps the
  // 200×200 city core. Cardinal vertices at (0,±100) and (±100,0) share
  // graph nodes with spine-north / spine-south / east-service / west-
  // utility, so the city-core grid + ring + four spokes are all one
  // connected component.
  { id: "inner-city-ring",
    points: [
      [ 100, -100], [ 100,    0], [ 100,  100], [   0,  100],
      [-100,  100], [-100,    0], [-100, -100], [   0, -100],
      [ 100, -100],
    ],
    width: 12, type: "asphalt" },
  // outer-loop: a closed regional ring at radius ~ ±460 (east/west) and
  // z = ±200/±380 (north/south corners chamfered). Vertices at (460,30)
  // and (-460,0) share nodes with east-service / west-utility ends, and
  // (0,200), (±220,200) share nodes with forest-main / forest-{east,
  // west}-connector entries. Width 14 marks it as the primary
  // regional arterial.
  { id: "outer-loop",
    points: [
      [ 460,  200], [ 460,   30], [ 460, -200],
      [ 260, -380], [-260, -380],
      [-460, -200], [-460,    0], [-460,  200],
      [-220,  200], [   0,  200], [ 220,  200],
      [ 460,  200],
    ],
    width: 14, type: "asphalt" },
  // ridge-east: mountain back-road from the (80,-340) switchback corner
  // east through the foothills, terminating on the outer-loop NE corner
  // at (460,-200). Without it the mountain switchbacks dead-end at the
  // observatory; with it, the mountain joins the outer ring.
  { id: "ridge-east",
    points: [[80, -340], [180, -330], [280, -310], [380, -290], [460, -200]],
    width: 10, type: "mountain" },
  // forest-{east,west}-connector: dirt collectors that drop south from
  // the village-loop frontage into the outer-loop south leg, giving the
  // forest village two extra exits (east via (220,200) and west via
  // (-220,200)) on top of the existing bridge spine. (65,325) and
  // (-60,315) match village-loop vertices for graph stitching.
  { id: "forest-east-connector",
    // Routed east of the outlier fishing cabin at (120,260) — the original
    // (100,280)→(160,240) middle leg passed within 5.5m of the cabin and
    // intruded its AABB. Swung through (115,290)→(170,260)→(200,230) so
    // the connector hugs the east edge of the village clearing.
    points: [[65, 325], [115, 290], [170, 260], [200, 230], [220, 210], [220, 200]],
    width: 10, type: "dirt" },
  { id: "forest-west-connector",
    points: [[-60, 315], [-100, 280], [-160, 240], [-220, 210], [-220, 200]],
    width: 10, type: "dirt" },
  // -----------------------------------------------------------------
  // Driveways / parking spurs — connect outlier parked vehicles to
  // their nearest carriageway. Width 12 so the parked car visibly sits
  // on a service apron, not a shoulder.
  // -----------------------------------------------------------------
  // East-warehouse driveways — each starts at an existing east-service
  // vertex so the road graph treats them as connected, not isolated.
  { id: "drv-east-warehouse-a",
    points: [[200, 0], [235, -30]],
    width: 12, type: "dirt" }, // start = east-service vertex (200,0); serves car-24
  { id: "drv-east-warehouse-b",
    points: [[300, 30], [310, 80]],
    width: 12, type: "dirt" }, // start = east-service vertex (300,30); serves car-25
  { id: "drv-east-loading",
    points: [[430, 30], [420, -55]],
    width: 12, type: "dirt" }, // start = east-service vertex (430,30); serves car-26
  { id: "drv-west-depot",
    points: [[-220, -20], [-220, 65]],
    width: 12, type: "dirt" }, // serves car-27 at (-220, 65)
];

// =============================================================
// STATIC OBSTACLES — collidable AABBs in non-city biomes
// =============================================================
// Bridge rails, large rocks, big tree trunks, mountain cliff walls,
// warehouses, water-tower base, cabins, ranger station, gas stop,
// observatory, depots. The collision module iterates STATIC_OBSTACLES
// in addition to BUILDINGS, and the safe-exit search rejects any
// vehicle exit that would clip one.

const _bridgeRails: StaticObstacle[] = [];
for (let i = 0; i < 4; i++) {
  _bridgeRails.push({ x:  9, z: 137 + i * 12, w: 0.8, d: 11.5, kind: "bridge_rail" });
  _bridgeRails.push({ x: -9, z: 137 + i * 12, w: 0.8, d: 11.5, kind: "bridge_rail" });
}

export const STATIC_OBSTACLES: StaticObstacle[] = [
  ..._bridgeRails,
  // Mountain — cliff walls hugging outer edge of switchbacks
  { x:  110, z: -260, w: 28, d: 10, kind: "cliff_wall" },
  { x: -110, z: -315, w: 28, d: 10, kind: "cliff_wall" },
  { x:  110, z: -360, w: 28, d: 10, kind: "cliff_wall" },
  { x: -110, z: -415, w: 28, d: 10, kind: "cliff_wall" },
  // Mountain — collidable boulders near the road
  { x:  -50, z: -180, w: 6,  d: 6,  kind: "large_rock" },
  { x:  140, z: -260, w: 8,  d: 6,  kind: "large_rock" },
  { x: -140, z: -340, w: 7,  d: 7,  kind: "large_rock" },
  { x:  130, z: -440, w: 6,  d: 6,  kind: "large_rock" },
  // Mountain — guardrails on the outside of switchback corners (kind
  // "guardrail" is excluded from the obstacle/road clearance check
  // because they are explicitly placed at the edge of the carriageway).
  { x:   95, z: -240, w: 12, d: 1.2, kind: "guardrail" },
  { x:  -95, z: -290, w: 12, d: 1.2, kind: "guardrail" },
  { x:   95, z: -340, w: 12, d: 1.2, kind: "guardrail" },
  { x:  -95, z: -390, w: 12, d: 1.2, kind: "guardrail" },
  { x:   95, z: -430, w: 12, d: 1.2, kind: "guardrail" },
  // Mountain — observatory at the summit
  { x:    0, z: -485, w: 16, d: 10, kind: "observatory" },
  // ---- South Forest Village -----------------------------------------
  // Gateway (z≈215..235) — gas stop anchors the village entry. Moved
  // north from z=205 to z=225 so the outer-loop south leg (centerline
  // z=200, carriageway z=193..207) clears the gas-stop AABB.
  { x:    0, z:  225, w: 12, d:  8, kind: "gas_stop" },
  // Outlier "fishing cabin" off forest-spur (not part of village).
  { x:  120, z:  260, w: 12, d:  9, kind: "cabin" },
  // Village center (x=-70..80, z=285..365) — buildings inside loop,
  // facing the village green at the centre. Lodge + Inn are offset from
  // the forest-main diagonal that cuts through the village.
  { x:  -10, z:  332, w: 18, d: 12, kind: "cabin" },          // Lodge
  { x:  -45, z:  320, w: 12, d: 10, kind: "cabin" },          // General store
  { x:   50, z:  330, w: 12, d: 10, kind: "cabin" },          // Inn
  { x:  -10, z:  350, w:  8, d:  6, kind: "ranger_station" }, // Info booth
  // Cabin / residential edge (z=380..455) — 5 cabins, each set ~10m
  // perpendicular off its driveway endpoint so the driveway clears the
  // building footprint cleanly.
  { x:   58, z:  374, w: 12, d: 10, kind: "cabin" },          // E1 ← drv (40,368)→(50,380)
  { x:   28, z:  399, w: 12, d: 10, kind: "cabin" },          // E2 ← drv (10,392)→(20,405)
  { x:    4, z:  452, w: 12, d: 10, kind: "cabin" },          // E3 ← drv (-6,473)→(10,460)
  { x:  -48, z:  416, w: 12, d: 10, kind: "cabin" },          // W1 ← drv (-30,422)→(-40,410)
  { x:  -50, z:  449, w: 12, d: 10, kind: "cabin" },          // W2 ← drv (-40,430)→(-55,440)
  // Trailhead (z=460..495) — ranger station behind trailhead-spur pad.
  { x:    0, z:  495, w: 10, d:  8, kind: "ranger_station" },
  // Forest — collidable boulders + thick tree trunks (kept clear of all
  // village/cabin/trailhead clearings; see FOREST_CLEARINGS).
  { x:   90, z:  270, w: 5,   d: 5,   kind: "large_rock" },
  { x:  120, z:  460, w: 5,   d: 6,   kind: "large_rock" },
  { x:  -90, z:  250, w: 5,   d: 5,   kind: "large_rock" },
  { x:   20, z:  230, w: 1.6, d: 1.6, kind: "tree_trunk" },
  { x:  -25, z:  260, w: 1.6, d: 1.6, kind: "tree_trunk" },
  { x:  -45, z:  380, w: 1.6, d: 1.6, kind: "tree_trunk" },
  { x:   35, z:  460, w: 1.6, d: 1.6, kind: "tree_trunk" },
  // East — warehouses + water tower base
  { x:  200, z:  -55, w: 30, d: 24, kind: "warehouse" },
  { x:  290, z:   95, w: 28, d: 26, kind: "warehouse" },
  { x:  390, z:  -50, w: 32, d: 25, kind: "warehouse" },
  { x:  440, z:  100, w: 24, d: 22, kind: "warehouse" },
  { x:  250, z:  140, w:  6, d:  6, kind: "water_tower_base" },
  // West — depots
  { x: -250, z:   65, w: 26, d: 18, kind: "depot" },
  { x: -380, z:  -60, w: 22, d: 18, kind: "depot" },
];

// =============================================================
// INSTANCED FLORA — trees + rocks scattered procedurally
// =============================================================
// Two seeded PRNGs keep distribution deterministic across reloads and
// across clients, so every player sees the same forest / mountain.
// Anything inside the road corridor (|x| < 14) is rejected to avoid
// visually obstructing the spine road.

// Reject scatter points within (road halfWidth + clearance) of any
// regional road polyline. Iterating REGIONAL_ROADS rather than
// hard-coding |x|<14 means new roads (driveways, future spurs) keep
// the scatter clear automatically.
const SCATTER_ROAD_CLEARANCE = 2.0;
function tooCloseToAnyRoad(x: number, z: number, clearance: number): boolean {
  for (const road of REGIONAL_ROADS) {
    const d = distancePointToPolyline(x, z, road.points);
    if (d < road.width / 2 + clearance) return true;
  }
  return false;
}

// South Forest Village clearings — rectangles where tree/rock scatter is
// excluded so the village reads cleanly. Roads alone are not enough — the
// village green and cabin plots need open ground around the buildings.
export const FOREST_CLEARINGS: ReadonlyArray<{
  x0: number; x1: number; z0: number; z1: number;
}> = [
  { x0:  -10, x1:  30, z0: 215, z1: 235 }, // Gateway / gas stop (post outer-loop move)
  { x0:  100, x1: 145, z0: 245, z1: 280 }, // Outlier fishing cabin
  { x0:  -70, x1:  80, z0: 285, z1: 365 }, // Village center (loop interior + frontage)
  { x0:   38, x1:  70, z0: 363, z1: 386 }, // cabin-E1 plot (centre 58,374)
  { x0:   18, x1:  40, z0: 388, z1: 410 }, // cabin-E2 plot (centre 28,399)
  { x0:   -6, x1:  16, z0: 442, z1: 463 }, // cabin-E3 plot (centre  4,452)
  { x0:  -56, x1: -38, z0: 408, z1: 425 }, // cabin-W1 plot (centre -48,416)
  { x0:  -60, x1: -38, z0: 440, z1: 460 }, // cabin-W2 plot (centre -50,449)
  { x0:  -30, x1:  30, z0: 470, z1: 500 }, // Trailhead
];

function inAnyClearing(x: number, z: number): boolean {
  for (const c of FOREST_CLEARINGS) {
    if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return true;
  }
  return false;
}

// Walk forest-main and place trees deterministically every 12m, alternating
// sides at offset 10 (halfwidth 6 + 4m clearance). This gives the road a
// readable lined-with-trees look without relying on random scatter.
function makeRoadsideRows(): TreeInstance[] {
  const out: TreeInstance[] = [];
  const fm = REGIONAL_ROADS.find((r) => r.id === "forest-main");
  if (!fm) return out;
  const SPACING = 12;
  const OFFSET = 10;
  const r = seededRandom(31415);
  let traveled = 0;
  let nextSample = 6;
  let sampleIdx = 0;
  for (let i = 0; i < fm.points.length - 1; i++) {
    const [ax, az] = fm.points[i];
    const [bx, bz] = fm.points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const tx = dx / len;
    const tz = dz / len;
    // Right-hand normal (rotated +90° in 2D). Both sides used via `side`.
    const nx = tz;
    const nz = -tx;
    while (nextSample < traveled + len) {
      const t = (nextSample - traveled) / len;
      const px = ax + t * dx;
      const pz = az + t * dz;
      const side = sampleIdx % 2 === 0 ? 1 : -1;
      const x = px + side * OFFSET * nx;
      const z = pz + side * OFFSET * nz;
      sampleIdx++;
      nextSample += SPACING;
      if (inAnyClearing(x, z)) continue;
      if (tooCloseToAnyRoad(x, z, SCATTER_ROAD_CLEARANCE)) continue;
      out.push({ x, z, scale: 0.9 + r() * 0.5, rotY: r() * Math.PI * 2 });
    }
    traveled += len;
  }
  return out;
}

function makeForestScatter(
  initialTrees: TreeInstance[],
): { trees: TreeInstance[]; rocks: RockInstance[] } {
  const r = seededRandom(12345);
  const trees: TreeInstance[] = [...initialTrees];
  const rocks: RockInstance[] = [];
  const z0 = 195;
  const z1 = 495;
  const xMag = 285;
  // Total target includes the roadside rows already in `trees`. Scatter
  // tops the array up to TREE_TARGET so the visual density stays steady.
  const TREE_TARGET = 220;
  const ROCK_TARGET = 60;
  for (let i = 0; i < TREE_TARGET * 4 && trees.length < TREE_TARGET; i++) {
    const x = (r() - 0.5) * 2 * xMag;
    const z = z0 + r() * (z1 - z0);
    if (inAnyClearing(x, z)) continue;
    if (tooCloseToAnyRoad(x, z, SCATTER_ROAD_CLEARANCE)) continue;
    trees.push({ x, z, scale: 0.7 + r() * 0.9, rotY: r() * Math.PI * 2 });
  }
  for (let i = 0; i < ROCK_TARGET * 4 && rocks.length < ROCK_TARGET; i++) {
    const x = (r() - 0.5) * 2 * xMag;
    const z = z0 + r() * (z1 - z0);
    if (inAnyClearing(x, z)) continue;
    if (tooCloseToAnyRoad(x, z, SCATTER_ROAD_CLEARANCE)) continue;
    rocks.push({ x, z, scale: 0.6 + r() * 1.1, rotY: r() * Math.PI * 2 });
  }
  return { trees, rocks };
}

function makeMountainRocks(): RockInstance[] {
  const r = seededRandom(99999);
  const out: RockInstance[] = [];
  const ROCK_TARGET = 120;
  for (let i = 0; i < ROCK_TARGET * 4 && out.length < ROCK_TARGET; i++) {
    // Keep clear of every rendered road polyline (switchbacks +
    // lookout spur). Old code only rejected |x|<14, which let rocks
    // intrude on the switchback corners at x=±80.
    const x = (r() - 0.5) * 290; // ±145
    const z = -460 + r() * 275;  // -460..-185
    if (tooCloseToAnyRoad(x, z, SCATTER_ROAD_CLEARANCE)) continue;
    out.push({ x, z, scale: 1.0 + r() * 2.5, rotY: r() * Math.PI * 2 });
  }
  return out;
}

const _roadsideTrees = makeRoadsideRows();
const _forest = makeForestScatter(_roadsideTrees);
export const FOREST_TREES: TreeInstance[] = _forest.trees;
export const FOREST_ROCKS: RockInstance[] = _forest.rocks;
export const MOUNTAIN_ROCKS: RockInstance[] = makeMountainRocks();
// Counts kept for the South Forest Village validator line.
export const FOREST_ROADSIDE_COUNT = _roadsideTrees.length;
export const FOREST_SCATTER_TREE_COUNT = FOREST_TREES.length - FOREST_ROADSIDE_COUNT;

// =============================================================
// SOUTH FOREST VILLAGE — lamps + parking pads
// =============================================================
//
// Lamps reuse StreetLightData (only x/z). The renderer (BiomeRender)
// draws a cheap emissive head + transparent ground "light pool"; a few
// real point lights are added at the village center to anchor the scene
// without breaking the per-frame budget.
export const VILLAGE_LAMPS: StreetLightData[] = [
  // Gateway (z≈213)
  { x:  -8, z: 213 },
  { x:   8, z: 213 },
  // Forest-main spine between gateway and village
  { x:  28, z: 250 },
  { x: -28, z: 285 },
  // Village loop perimeter
  { x:  60, z: 320 },
  { x:  25, z: 365 },
  { x: -55, z: 345 },
  { x: -55, z: 305 },
  // Forest-main spine through cabin row
  { x:  30, z: 380 },
  { x: -25, z: 415 },
  { x:   7, z: 456 }, // near drv-cabin-e3 endpoint (lights cabin-row + drv-e3)
  // Trailhead
  { x: -10, z: 482 },
  { x:  10, z: 482 },
  { x:   0, z: 470 },
];

// Village center parking pads (rendered by BiomeRender as dirt rectangles).
// Cars park on a few of these; the rest stand empty for visual density.
export const VILLAGE_PARKING_PADS: ParkingSpot[] = [
  // East loop edge (parallel parking, facing N/S)
  { x:  60, z: 320, rotY: Math.PI / 2 },
  { x:  60, z: 340, rotY: Math.PI / 2 }, // car-20
  // West loop edge
  { x: -58, z: 320, rotY: Math.PI / 2 }, // car-19
  { x: -58, z: 340, rotY: Math.PI / 2 },
  // Interior frontage near the village green
  { x:  25, z: 295, rotY: 0 },
  { x: -25, z: 295, rotY: 0 },
  { x:  25, z: 358, rotY: 0 },
  { x: -25, z: 358, rotY: 0 },
];

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

  // ---- Bounds + obstacle-overlap helpers ---------------------------------
  const inBounds = (x: number, z: number, margin = 0): boolean =>
    x >= -WORLD_HALF + margin && x <= WORLD_HALF - margin &&
    z >= -WORLD_HALF + margin && z <= WORLD_HALF - margin;

  const overlapsObstacle = (x: number, z: number, r: number): boolean => {
    for (const o of STATIC_OBSTACLES) {
      const dx = Math.max(0, Math.abs(x - o.x) - o.w / 2);
      const dz = Math.max(0, Math.abs(z - o.z) - o.d / 2);
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };

  // ---- City building / road sanity (existing checks) --------------------
  for (const sp of SPAWN_POINTS) {
    if (checkBuildingCollision(sp[0], sp[2])) {
      issues.push(`spawn ${JSON.stringify(sp)} overlaps a building`);
    }
    if (!inBounds(sp[0], sp[2], 1)) {
      issues.push(`spawn ${JSON.stringify(sp)} is outside WORLD bounds`);
    }
    if (overlapsObstacle(sp[0], sp[2], 1.0)) {
      issues.push(`spawn ${JSON.stringify(sp)} overlaps a static obstacle`);
    }
  }
  for (const v of INITIAL_VEHICLES) {
    if (checkBuildingCollision(v.x, v.z, 1.5)) {
      issues.push(`vehicle ${v.id} at (${v.x}, ${v.z}) overlaps a building`);
    }
    if (!inBounds(v.x, v.z, 7)) {
      issues.push(`vehicle ${v.id} at (${v.x}, ${v.z}) is outside WORLD bounds`);
    }
    if (overlapsObstacle(v.x, v.z, 2.0)) {
      issues.push(`vehicle ${v.id} at (${v.x}, ${v.z}) overlaps a static obstacle`);
    }
  }
  for (const cp of CHECKPOINTS) {
    if (checkBuildingCollision(cp.x, cp.z, 4)) {
      issues.push(`checkpoint ${cp.id} at (${cp.x}, ${cp.z}) overlaps a building`);
    }
    if (!inBounds(cp.x, cp.z, 4)) {
      issues.push(`checkpoint ${cp.id} at (${cp.x}, ${cp.z}) is outside WORLD bounds`);
    }
    if (overlapsObstacle(cp.x, cp.z, 4.0)) {
      issues.push(`checkpoint ${cp.id} at (${cp.x}, ${cp.z}) overlaps a static obstacle`);
    }
  }

  // ---- Traffic + regional road waypoint bounds ---------------------------
  for (const route of TRAFFIC_ROUTES) {
    for (const wp of route.waypoints) {
      if (!inBounds(wp[0], wp[1], 3)) {
        issues.push(`traffic route ${route.id} waypoint (${wp[0]}, ${wp[1]}) is outside WORLD bounds`);
        break;
      }
    }
  }
  for (const r of REGIONAL_ROADS) {
    for (const [x, z] of r.points) {
      if (!inBounds(x, z, 0)) {
        issues.push(`regional road ${r.id} point (${x}, ${z}) is outside WORLD bounds`);
        break;
      }
    }
  }

  // ---- Forest / mountain instance bounds ---------------------------------
  for (const t of FOREST_TREES) {
    if (!inBounds(t.x, t.z, 0)) {
      issues.push(`forest tree at (${t.x}, ${t.z}) is outside WORLD bounds`);
      break;
    }
  }
  for (const r of [...FOREST_ROCKS, ...MOUNTAIN_ROCKS]) {
    if (!inBounds(r.x, r.z, 0)) {
      issues.push(`rock at (${r.x}, ${r.z}) is outside WORLD bounds`);
      break;
    }
  }

  // ---- Polish-pass invariants -------------------------------------------
  //
  // Build a single list of road centerlines (regional polylines + city
  // grid). For each (x, z) we want the nearest road, its half-width,
  // and the signed clearance (positive = outside carriageway).

  type RoadCorridor = {
    id: string;
    points: ReadonlyArray<readonly [number, number]>;
    halfWidth: number;
  };
  const corridors: RoadCorridor[] = [];
  for (const r of REGIONAL_ROADS) {
    corridors.push({ id: r.id, points: r.points, halfWidth: r.width / 2 });
  }
  const cityHalf = ROADS.width / 2;
  for (const x of ROADS.ns) {
    corridors.push({
      id: `city-ns-${x}`,
      points: [[x, -CITY_HALF], [x, CITY_HALF]],
      halfWidth: cityHalf,
    });
  }
  for (const z of ROADS.ew) {
    corridors.push({
      id: `city-ew-${z}`,
      points: [[-CITY_HALF, z], [CITY_HALF, z]],
      halfWidth: cityHalf,
    });
  }

  function nearestRoadDist(px: number, pz: number): {
    id: string; dist: number; halfWidth: number;
  } {
    let bestId = "<none>", bestDist = Infinity, bestHw = 0;
    for (const c of corridors) {
      const d = distancePointToPolyline(px, pz, c.points);
      if (d < bestDist) {
        bestDist = d; bestId = c.id; bestHw = c.halfWidth;
      }
    }
    return { id: bestId, dist: bestDist, halfWidth: bestHw };
  }

  // (a) Every traffic waypoint must be inside a carriageway.
  // 0.5m of slack absorbs the lane offset used by OUTER_LOOP.
  let waypointsOff = 0;
  for (const route of TRAFFIC_ROUTES) {
    for (const wp of route.waypoints) {
      const nr = nearestRoadDist(wp[0], wp[1]);
      if (nr.dist > nr.halfWidth + 0.5) {
        waypointsOff++;
        issues.push(
          `traffic ${route.id} waypoint (${wp[0]}, ${wp[1]}) ` +
            `${(nr.dist - nr.halfWidth).toFixed(1)}m off road ${nr.id} ` +
            `(hw=${nr.halfWidth})`,
        );
      }
    }
  }

  // (b) Every checkpoint must be on a road carriageway.
  let checkpointsOff = 0;
  for (const cp of CHECKPOINTS) {
    const nr = nearestRoadDist(cp.x, cp.z);
    if (nr.dist > nr.halfWidth + 0.5) {
      checkpointsOff++;
      issues.push(
        `checkpoint ${cp.id} (${cp.x}, ${cp.z}) ` +
          `${(nr.dist - nr.halfWidth).toFixed(1)}m off road ${nr.id}`,
      );
    }
  }

  // (c) Trees and rocks must clear the carriageway by ≥ SCATTER_ROAD_CLEARANCE.
  // This mirrors the generation-time rejection so we catch any drift if
  // a road moves in the future.
  let scatterTooClose = 0;
  const checkScatter = (x: number, z: number): boolean => {
    for (const r of REGIONAL_ROADS) {
      const d = distancePointToPolyline(x, z, r.points);
      if (d < r.width / 2 + SCATTER_ROAD_CLEARANCE) return true;
    }
    return false;
  };
  for (const t of FOREST_TREES) if (checkScatter(t.x, t.z)) scatterTooClose++;
  for (const rk of FOREST_ROCKS) if (checkScatter(rk.x, rk.z)) scatterTooClose++;
  for (const rk of MOUNTAIN_ROCKS) if (checkScatter(rk.x, rk.z)) scatterTooClose++;
  if (scatterTooClose > 0) {
    issues.push(
      `${scatterTooClose} trees/rocks within road halfWidth + ` +
        `${SCATTER_ROAD_CLEARANCE} of a regional road`,
    );
  }

  // (d) Every parked vehicle must be within 25m of a road centerline.
  // Driveway entries in REGIONAL_ROADS exist precisely to satisfy this
  // for warehouse / depot cars that are far from the through-roads.
  let parkedFar = 0;
  for (const v of INITIAL_VEHICLES) {
    const nr = nearestRoadDist(v.x, v.z);
    if (nr.dist > 25) {
      parkedFar++;
      issues.push(
        `vehicle ${v.id} at (${v.x}, ${v.z}) is ${nr.dist.toFixed(1)}m ` +
          `from nearest road (${nr.id}) — needs driveway/parking pad`,
      );
    }
  }

  // (d.2) South Forest Village parked cars (z ≥ 180) must sit ON a road
  // strip (within road halfWidth + 1.0m of the centerline) OR inside a
  // village parking pad (within 4.0m of pad center, covering the 3x6
  // pad rect at any rotation). This is stricter than the 25m generic
  // check above so the forest village reads as "cars on pads/driveways"
  // rather than "cars roughly near a road".
  const PAD_RADIUS = 4.0;
  let forestParkedOff = 0;
  for (const v of INITIAL_VEHICLES) {
    if (v.z < 180) continue;
    const nr = nearestRoadDist(v.x, v.z);
    const onStrip = nr.dist <= nr.halfWidth + 1.0;
    let onPad = false;
    for (const p of VILLAGE_PARKING_PADS) {
      const dx = v.x - p.x;
      const dz = v.z - p.z;
      if (dx * dx + dz * dz <= PAD_RADIUS * PAD_RADIUS) { onPad = true; break; }
    }
    if (!onStrip && !onPad) {
      forestParkedOff++;
      issues.push(
        `forest vehicle ${v.id} at (${v.x.toFixed(0)}, ${v.z.toFixed(0)}) ` +
          `is ${(nr.dist - nr.halfWidth).toFixed(1)}m off road ${nr.id} ` +
          `and not on any parking pad — must sit on a road/driveway strip ` +
          `or a village parking pad`,
      );
    }
  }

  // (e) Static obstacles other than rails / cliffs / guardrails must
  // clear the road carriageway by ≥1.0m. The conservative AABB-edge
  // estimate uses max(w, d)/2 as the obstacle's half extent toward the
  // road; this slightly over-estimates clearance violation for long
  // narrow obstacles oriented along the road, which is the safe side.
  const ROAD_KIND_OBSTACLES = new Set<StaticObstacleKind>([
    "bridge_rail", "cliff_wall", "guardrail",
  ]);
  let obstaclesIntruding = 0;
  for (const o of STATIC_OBSTACLES) {
    if (ROAD_KIND_OBSTACLES.has(o.kind)) continue;
    const nr = nearestRoadDist(o.x, o.z);
    const aabbHalf = Math.max(o.w, o.d) / 2;
    const clearance = nr.dist - nr.halfWidth - aabbHalf;
    if (clearance < 1.0) {
      obstaclesIntruding++;
      issues.push(
        `obstacle ${o.kind} at (${o.x.toFixed(0)}, ${o.z.toFixed(0)}) ` +
          `clearance ${clearance.toFixed(1)}m to road ${nr.id}`,
      );
    }
  }

  // Stash counts on a side-channel for the summary print below.
  (issues as unknown as { _polish?: Record<string, number> })._polish = {
    waypointsOff,
    checkpointsOff,
    scatterTooClose,
    parkedFar,
    forestParkedOff,
    obstaclesIntruding,
  };

  // ---- Existing building-on-road check ----------------------------------
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

  const polish = (issues as unknown as { _polish?: Record<string, number> })
    ._polish ?? {};
  const totalWp = TRAFFIC_ROUTES.reduce((s, r) => s + r.waypoints.length, 0);
  const totalScatter = FOREST_TREES.length + FOREST_ROCKS.length + MOUNTAIN_ROCKS.length;

  // ---- Road-graph component analysis ------------------------------------
  // Build a true road graph from REGIONAL_ROADS and the city N-S / E-W
  // grid that respects interior segment-segment intersections. The
  // builder runs in three phases:
  //   1) Collect every polyline vertex as a graph node (snap-merged
  //      within SNAP_RADIUS so coincident endpoints from different
  //      polylines share a single node).
  //   2) Add explicit junction nodes at city-grid crossings (x,z) for
  //      every (x,z) ∈ ROADS.ns × ROADS.ew. Without this, a city N-S
  //      line and a city E-W line that visibly cross at the centre of
  //      the city would each be a single edge endpoint→endpoint and
  //      remain in separate components.
  //   3) For each polyline segment, find every graph node that lies on
  //      it (perpendicular distance < SNAP_RADIUS, parameter t ∈ [0,1])
  //      sort by t, dedupe by node index, then emit sub-edges between
  //      consecutive nodes. This automatically subdivides a long edge
  //      whenever another polyline's endpoint sits on its interior —
  //      e.g. city-grid endpoints at (±45,±100) split the inner-city-
  //      ring north/south edges into thirds, which is exactly how the
  //      rendered geometry behaves on the ground.
  type RoadType_ = RoadPath["type"];
  type GraphPolyline = {
    id: string;
    points: ReadonlyArray<readonly [number, number]>;
    type: RoadType_;
    width: number;
  };
  type GraphEdge = {
    a: number; b: number; len: number;
    roadId: string; type: RoadType_; width: number;
  };
  const SNAP_RADIUS = 2.0;
  const polylines: GraphPolyline[] = [];
  for (const rd of REGIONAL_ROADS) {
    polylines.push({ id: rd.id, points: rd.points, type: rd.type, width: rd.width });
  }
  for (const x of ROADS.ns) {
    polylines.push({
      id: `city-ns-${x}`,
      points: [[x, -CITY_HALF], [x, CITY_HALF]],
      type: "asphalt", width: ROADS.width,
    });
  }
  for (const z of ROADS.ew) {
    polylines.push({
      id: `city-ew-${z}`,
      points: [[-CITY_HALF, z], [CITY_HALF, z]],
      type: "asphalt", width: ROADS.width,
    });
  }

  const gNodes: { x: number; z: number }[] = [];
  const findOrAddNode = (x: number, z: number): number => {
    for (let i = 0; i < gNodes.length; i++) {
      const dx = x - gNodes[i].x;
      const dz = z - gNodes[i].z;
      if (dx * dx + dz * dz < SNAP_RADIUS * SNAP_RADIUS) return i;
    }
    gNodes.push({ x, z });
    return gNodes.length - 1;
  };
  // Phase 1: register every polyline vertex.
  for (const pl of polylines) {
    for (const [x, z] of pl.points) findOrAddNode(x, z);
  }
  // Phase 2: register city-grid interior crossings.
  for (const x of ROADS.ns) {
    for (const z of ROADS.ew) findOrAddNode(x, z);
  }

  // Phase 3: split each segment at every node lying on it.
  const gEdges: GraphEdge[] = [];
  for (const pl of polylines) {
    for (let i = 0; i < pl.points.length - 1; i++) {
      const [ax, az] = pl.points[i];
      const [bx, bz] = pl.points[i + 1];
      const dx = bx - ax, dz = bz - az;
      const seg2 = dx * dx + dz * dz;
      if (seg2 < 1e-6) continue;
      const hits: { idx: number; t: number }[] = [];
      for (let n = 0; n < gNodes.length; n++) {
        const px = gNodes[n].x, pz = gNodes[n].z;
        let t = ((px - ax) * dx + (pz - az) * dz) / seg2;
        if (t < -1e-3 || t > 1 + 1e-3) continue;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        const fx = ax + t * dx, fz = az + t * dz;
        const ex = px - fx, ez = pz - fz;
        if (ex * ex + ez * ez < SNAP_RADIUS * SNAP_RADIUS) {
          hits.push({ idx: n, t });
        }
      }
      hits.sort((u, v) => u.t - v.t);
      // Dedupe by node idx — keep the earliest t per node so each
      // distinct node appears at most once on this segment.
      const seen = new Set<number>();
      const ordered = hits.filter((h) =>
        seen.has(h.idx) ? false : (seen.add(h.idx), true)
      );
      for (let k = 0; k < ordered.length - 1; k++) {
        const a = ordered[k].idx, b = ordered[k + 1].idx;
        if (a === b) continue;
        const len = Math.hypot(
          gNodes[b].x - gNodes[a].x,
          gNodes[b].z - gNodes[a].z,
        );
        gEdges.push({ a, b, len, roadId: pl.id, type: pl.type, width: pl.width });
      }
    }
  }

  // Adjacency.
  const adj: number[][] = gNodes.map(() => []);
  for (const e of gEdges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }

  // Connected components via BFS.
  const compOf = new Array<number>(gNodes.length).fill(-1);
  const compSizes: number[] = [];
  for (let i = 0; i < gNodes.length; i++) {
    if (compOf[i] >= 0) continue;
    const cid = compSizes.length;
    let size = 0;
    const q: number[] = [i];
    compOf[i] = cid;
    while (q.length > 0) {
      const u = q.shift()!;
      size++;
      for (const v of adj[u]) {
        if (compOf[v] < 0) { compOf[v] = cid; q.push(v); }
      }
    }
    compSizes.push(size);
  }
  const nComponents = compSizes.length;
  let mainCompId = 0;
  for (let i = 1; i < compSizes.length; i++) {
    if (compSizes[i] > compSizes[mainCompId]) mainCompId = i;
  }
  const mainCompSize = compSizes[mainCompId] ?? 0;

  // Dead-ends per kind (node degree = 1, classified by the road type of
  // the single incident edge).
  const deadEndsByKind: Record<RoadType_, number> = {
    asphalt: 0, bridge: 0, forest: 0, mountain: 0, dirt: 0,
  };
  for (let i = 0; i < gNodes.length; i++) {
    if (adj[i].length !== 1) continue;
    const incident = gEdges.find((e) => e.a === i || e.b === i);
    if (incident) deadEndsByKind[incident.type]++;
  }

  // Lengths classified into arterial / collector / local. Arterial is
  // wide asphalt (≥12) and bridges; collector is mountain + narrower
  // asphalt; local is dirt + forest surface.
  let arterialLen = 0, collectorLen = 0, localLen = 0;
  for (const e of gEdges) {
    if ((e.type === "asphalt" && e.width >= 12) || e.type === "bridge") {
      arterialLen += e.len;
    } else if (e.type === "mountain" || (e.type === "asphalt" && e.width < 12)) {
      collectorLen += e.len;
    } else {
      localLen += e.len;
    }
  }

  // Isolated roads — a regional road is isolated if NONE of its vertices
  // lie in the main connected component.
  const isolatedRoads: string[] = [];
  for (const rd of REGIONAL_ROADS) {
    let connectedToMain = false;
    for (const [x, z] of rd.points) {
      const idx = findOrAddNode(x, z); // existing vertex — no-op insert
      if (compOf[idx] === mainCompId) { connectedToMain = true; break; }
    }
    if (!connectedToMain) isolatedRoads.push(rd.id);
  }

  // Landmark existence checks — these are the two structural roads the
  // master-plan adds. Their absence is a hard regression.
  const cityRingExists = REGIONAL_ROADS.some((r) => r.id === "inner-city-ring");
  const outerLoopExists = REGIONAL_ROADS.some((r) => r.id === "outer-loop");
  if (!cityRingExists) issues.push("inner-city-ring road missing");
  if (!outerLoopExists) issues.push("outer-loop road missing");
  if (isolatedRoads.length > 0) {
    issues.push(`${isolatedRoads.length} isolated road(s): ${isolatedRoads.join(", ")}`);
  }

  const trafficOnRoad = totalWp - (polish.waypointsOff ?? 0);
  const deadEndStr =
    `{asphalt:${deadEndsByKind.asphalt},bridge:${deadEndsByKind.bridge},` +
    `mountain:${deadEndsByKind.mountain},forest:${deadEndsByKind.forest},` +
    `dirt:${deadEndsByKind.dirt}}`;
  const roadNetworkLine =
    `roadNetwork OK: components=${nComponents} ` +
    `(main=${mainCompSize}/${gNodes.length} nodes), ` +
    `deadEndsByKind=${deadEndStr}, ` +
    `arterial=${arterialLen.toFixed(0)}m, ` +
    `collector=${collectorLen.toFixed(0)}m, ` +
    `local=${localLen.toFixed(0)}m, ` +
    `trafficWaypointsOnRoad=${trafficOnRoad}/${totalWp}, ` +
    `isolatedRoads=${isolatedRoads.length}` +
    (isolatedRoads.length > 0 ? ` [${isolatedRoads.join(",")}]` : "") + `, ` +
    `outerLoopExists=${outerLoopExists}, cityRingExists=${cityRingExists}`;

  // ---- South Forest Village summary -------------------------------------
  // Counts cabin-row buildings (z≈370..455 — cabins are offset off their
  // driveway endpoints so a few sit slightly upstream of the nominal band),
  // village forest cars (z=190..495), trailhead entities, etc., so a
  // regression in the village structure is loud in the console.
  let cabinRowCount = 0;
  for (const o of STATIC_OBSTACLES) {
    if (o.kind === "cabin" && o.z >= 370 && o.z <= 455) cabinRowCount++;
  }
  let villageCars = 0;
  for (const v of INITIAL_VEHICLES) {
    if (v.z >= 190 && v.z <= 495 && Math.abs(v.x) <= 150) villageCars++;
  }
  let trailheadEntities = 0;
  for (const o of STATIC_OBSTACLES) {
    if (o.z >= 460 && o.z <= 498) trailheadEntities++;
  }
  const forestCarsOnStripOrPad = villageCars - (polish.forestParkedOff ?? 0);
  const villageLine =
    `South Forest Village: ${VILLAGE_PARKING_PADS.length} pads, ` +
    `${VILLAGE_LAMPS.length} lamps, ${cabinRowCount} cabins, ` +
    `${forestCarsOnStripOrPad}/${villageCars} forest cars on strip/pad, ` +
    `${FOREST_CLEARINGS.length} clearings, ` +
    `${FOREST_ROADSIDE_COUNT} roadside-row trees + ` +
    `${FOREST_SCATTER_TREE_COUNT} scatter trees, ` +
    `${trailheadEntities} trailhead entities.`;
  const polishLine =
    `road clearances: ${totalWp - (polish.waypointsOff ?? 0)}/${totalWp} ` +
    `traffic waypoints on-road, ${CHECKPOINTS.length - (polish.checkpointsOff ?? 0)}/` +
    `${CHECKPOINTS.length} checkpoints on-road, ` +
    `${totalScatter - (polish.scatterTooClose ?? 0)}/${totalScatter} ` +
    `trees+rocks ≥ road halfWidth + ${SCATTER_ROAD_CLEARANCE.toFixed(1)}m, ` +
    `${INITIAL_VEHICLES.length - (polish.parkedFar ?? 0)}/${INITIAL_VEHICLES.length} ` +
    `parked vehicles within 25m of a road, ` +
    `${polish.obstaclesIntruding ?? 0} non-rail obstacles intruding into road carriageway.`;

  if (issues.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${issues.length} city validation issue(s):`);
    for (const m of issues) {
      // eslint-disable-next-line no-console
      console.warn("  -", m);
    }
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${polishLine}`);
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${villageLine}`);
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${roadNetworkLine}`);
  } else {
    // eslint-disable-next-line no-console
    console.info(
      `[city-sandbox] world OK (${WORLD_SIZE}x${WORLD_SIZE}): ` +
        `${BUILDINGS.length} buildings across ${blockDefs.length} blocks, ` +
        `${INITIAL_VEHICLES.length} vehicles, ${SPAWN_POINTS.length} spawns, ` +
        `${CHECKPOINTS.length} checkpoints, ${STREET_LIGHTS.length} streetlamps, ` +
        `${TRAFFIC_LIGHTS.length} traffic lights, ${NPC_ROUTES.length} NPC routes, ` +
        `${TRAFFIC_ROUTES.reduce((sum, r) => sum + r.cars.length, 0)} ambient cars, ` +
        `${REGIONAL_ROADS.length} regional roads, ${STATIC_OBSTACLES.length} obstacles, ` +
        `${FOREST_TREES.length} trees, ${FOREST_ROCKS.length + MOUNTAIN_ROCKS.length} rocks.`
    );
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${polishLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${villageLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${roadNetworkLine}`);
  }
}
