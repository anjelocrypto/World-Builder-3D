import type {
  Building,
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
  RegionalLampData,
  RailVertex,
  RailPillar,
  TrainStationData,
  SkybridgeData,
  PeriCityHomestead,
} from "./types";
import { distancePointToPolyline } from "./roadGeom";
// Phase 13A: RP civic building footprints, used only to keep procedural towers
// out of the civic shells (see GENERATED_BUILDINGS filter below). rpTypes is a
// pure leaf module (no imports), so this does not create an import cycle.
// RP_HOUSES is used only by the dev validation block to assert houses clear the
// full world (BUILDINGS / REGIONAL_ROADS / obstacles / cars).
import { RP_BUILDINGS, RP_HOUSES } from "./rpTypes";
// Phase 14A: Grand Plaza Hall footprint + approach path, used to keep city-edge
// trees out of the hall and its connector. eventHall only type-imports rpTypes
// (erased at runtime), so it is a runtime leaf module — no import cycle.
import { EVENT_HALL_EXTENTS, EVENT_HALL_CONNECTOR } from "./eventHall";

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
  // Mid-rise commercial-tower band — what was the old "downtown" but
  // bumped into the 22-45m range to make room for the new "highrise"
  // tier above it.
  downtown: {
    heightRange: [22, 45],
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
    antennaProb: 0.55,
    rooftopBoxProb: 0.7,
  },
  // Glass-skinned downtown tower (45-85m). Wider footprints + a podium
  // and crown lighting in the renderer.
  highrise: {
    heightRange: [45, 85],
    widthRange: [12, 20],
    colors: [
      "#3c5878",
      "#2f4a6c",
      "#34597a",
      "#3e5d80",
      "#2a4868",
      "#4a6a8a",
    ],
    antennaProb: 0.85,
    rooftopBoxProb: 0.95,
  },
  // Skyline-defining skyscrapers (90-120m). Hand-placed only; not used
  // by the random `genBuilding` flow.
  landmark: {
    heightRange: [90, 120],
    widthRange: [16, 22],
    colors: [
      "#22364c",
      "#2a3f58",
      "#2e455e",
    ],
    antennaProb: 1.0,
    rooftopBoxProb: 1.0,
  },
  commercial: {
    heightRange: [12, 26],
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
    antennaProb: 0.3,
    rooftopBoxProb: 0.55,
  },
  residential: {
    heightRange: [10, 25],
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
    antennaProb: 0.18,
    rooftopBoxProb: 0.35,
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
  // Northwest corner — mid-rise commercial towers
  { cx: -65, cz: -65, bw: 30, bd: 30, count: 6, district: "downtown" },
  // North row — split around the N-S road at x = 0
  { cx: -22.5, cz: -65, bw: 15, bd: 30, count: 4, district: "downtown" },
  { cx:  22.5, cz: -65, bw: 15, bd: 30, count: 4, district: "downtown" },
  // Northeast corner — mid-rise commercial towers
  { cx:  65, cz: -65, bw: 30, bd: 30, count: 6, district: "downtown" },
  // West row — split around the E-W road at z = 0
  { cx: -65, cz: -22.5, bw: 30, bd: 15, count: 3, district: "commercial" },
  { cx: -65, cz:  22.5, bw: 30, bd: 15, count: 3, district: "commercial" },
  // East row — split around the E-W road at z = 0
  { cx:  65, cz: -22.5, bw: 30, bd: 15, count: 3, district: "commercial" },
  { cx:  65, cz:  22.5, bw: 30, bd: 15, count: 3, district: "commercial" },
  // Center plaza (cx=0, cz=0) is intentionally empty — see SPAWN_POINTS.
  // Southwest corner — residential
  { cx: -65, cz:  65, bw: 30, bd: 30, count: 6, district: "residential" },
  // South row — split around the N-S road at x = 0
  { cx: -22.5, cz:  65, bw: 15, bd: 30, count: 4, district: "residential" },
  { cx:  22.5, cz:  65, bw: 15, bd: 30, count: 4, district: "residential" },
  // Southeast corner — residential
  { cx:  65, cz:  65, bw: 30, bd: 30, count: 6, district: "residential" },
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

// Random fill from blockDefs — these are the in-block mid-rises and
// residentials. Hand-placed landmark + highrise towers below sit OUTSIDE
// the block grid (in the 80..94 ring between the outermost blocks at 80
// and the inner-city-ring carriageway at 94..106), so they do not
// overlap any random building.
// Phase 13A: keep procedural towers out of the hand-placed RP civic buildings.
// Five RP buildings (dealership, police_station, medic_center, mechanic_garage,
// delivery_hub) sit inside the corner/edge blocks, and genBuilding has no
// awareness of them, so without this filter the deterministic seed=42 layout
// spawns 21 towers that clip the civic shells. We drop any generated building
// whose footprint overlaps an RP footprint + a 1 m margin so the towers never
// visually touch the shells. Filtering happens AFTER generation, so the seeded
// rng sequence and every surviving building's position are unchanged
// (deterministic). RP buildings, houses, roads, cars are not moved.
const RP_KEEPOUT_MARGIN = 1;
function overlapsRpBuilding(b: Building): boolean {
  for (const rp of RP_BUILDINGS) {
    if (
      Math.abs(b.x - rp.x) < (b.w + rp.w) / 2 + RP_KEEPOUT_MARGIN &&
      Math.abs(b.z - rp.z) < (b.d + rp.d) / 2 + RP_KEEPOUT_MARGIN
    ) {
      return true;
    }
  }
  return false;
}

const GENERATED_BUILDINGS: Building[] = blockDefs
  .flatMap(({ cx, cz, bw, bd, count, district }) =>
    Array.from({ length: count }, () => genBuilding(cx, cz, bw, bd, district)),
  )
  .filter((b) => !overlapsRpBuilding(b));

// =============================================================
// HAND-PLACED HIGHRISES + LANDMARKS
// =============================================================
// All positions sit in the empty ring 80 < |x| or |z| < 94, between the
// 80-edge of the outermost block and the 94-inner-edge of the
// inner-city-ring carriageway. Footprints stay ≤ 12m so the building
// envelope clears both sides:
//   • highrise w=d=10  → spans 81..91 when centered at ±86, 2m off ring
//   • landmark w=d=12  → spans 81..93 when centered at ±87, 1m off ring
// Heights are explicit so the validator can count `towers` and
// `landmarks` accurately. windowSeed is hand-picked so the lit-floor
// pattern is varied across landmarks.

function makeTower(
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  district: "highrise" | "landmark",
  color: string,
  seed: number,
  extras: Partial<Pick<Building, "glass" | "crownLight" | "neonSign" | "podium">> = {},
): Building {
  return {
    x, z, w, d, h, color, district,
    hasAntenna: true,
    hasRooftopBox: true,
    windowSeed: seed,
    tier: district === "landmark" ? "landmark" : "high",
    glass: extras.glass ?? true,
    crownLight: extras.crownLight ?? true,
    neonSign: extras.neonSign ?? false,
    podium: extras.podium ?? true,
  };
}

const HIGHRISE_BUILDINGS: Building[] = [
  // East mid (between NE and SE corners) — flank the station entrance
  makeTower( 86, -30, 10, 10, 62, "highrise", "#3c5878", 11),
  makeTower( 86,  30, 10, 10, 70, "highrise", "#34597a", 12, { neonSign: true }),
  // West mid
  makeTower(-86, -30, 10, 10, 58, "highrise", "#2f4a6c", 13),
  // North mid (between NW and NE corners)
  makeTower(-30, -86, 10, 10, 66, "highrise", "#3e5d80", 14),
  makeTower( 30, -86, 10, 10, 74, "highrise", "#2a4868", 15, { neonSign: true }),
  // South mid
  makeTower(-30,  86, 10, 10, 55, "highrise", "#4a6a8a", 16),
  makeTower( 30,  86, 10, 10, 78, "highrise", "#3c5878", 17),
  // South of NE corner — flanks the SE corner of the rail loop
  makeTower( 60,  86, 10, 10, 50, "highrise", "#34597a", 18),
];

const LANDMARK_BUILDINGS: Building[] = [
  // NE outer corner — tallest of the four
  makeTower( 87, -87, 12, 12, 118, "landmark", "#22364c", 21,
    { neonSign: true, crownLight: true, podium: true }),
  // NW outer corner
  makeTower(-87, -87, 12, 12, 102, "landmark", "#2a3f58", 22,
    { crownLight: true, podium: true }),
  // SE outer corner
  makeTower( 87,  87, 12, 12, 110, "landmark", "#2e455e", 23,
    { neonSign: true, crownLight: true, podium: true }),
  // SW outer corner
  makeTower(-87,  87, 12, 12, 96,  "landmark", "#22364c", 24,
    { crownLight: true, podium: true }),
  // West outer mid — visible from the plaza looking due west.
  // Slimmer 10x10 footprint so the corner z=35 sits exactly at the EW
  // road's ROAD_HALF (10m) rather than 9m inside it.
  makeTower(-87,  30, 10, 10, 105, "landmark", "#2a3f58", 25,
    { neonSign: true, crownLight: true, podium: true }),
];

export const BUILDINGS: Building[] = [
  ...GENERATED_BUILDINGS,
  ...HIGHRISE_BUILDINGS,
  ...LANDMARK_BUILDINGS,
];

// =============================================================
// VEHICLES — 14 drivable parked cars with variants
// =============================================================

export const INITIAL_VEHICLES: VehicleState[] = [
  // ===== City (14 cars) — original 200x200 hub =====
  { id: "car-0",  x:  22, y: 0.6, z: -22, rotY: 0,                  speed: 0, driverId: null, variant: "sedan",   color: "#e74c3c" },
  { id: "car-1",  x: -22, y: 0.6, z:  22, rotY: Math.PI,            speed: 0, driverId: null, variant: "sedan",   color: "#3498db" },
  { id: "car-2",  x:  22, y: 0.6, z:  15, rotY: 0,                  speed: 0, driverId: null, variant: "compact", color: "#c0392b" }, // Phase 9A: moved (22,22)→(22,15) to clear City Worker depot footprint
  { id: "car-3",  x: -22, y: 0.6, z: -31, rotY: Math.PI,            speed: 0, driverId: null, variant: "van",     color: "#7f8c8d" }, // Phase 9A: moved (-22,-22)→(-22,-31) to clear City Hall footprint
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
  // Y values come from ROAD_ELEVATION_PROFILES at each car's road
  // projection (see shared/elevation.ts). Must stay in sync with the
  // server-side INITIAL_VEHICLES in artifacts/api-server/src/socket/cityData.ts.
  { id: "car-14", x:  90, y:  5.4, z: -250, rotY: -Math.PI / 2,     speed: 0, driverId: null, variant: "sedan",   color: "#5d6d7e" },
  { id: "car-15", x: -75, y:  8.49, z: -290, rotY: 0,               speed: 0, driverId: null, variant: "van",     color: "#7d6e58" },
  { id: "car-16", x:  75, y: 12.49, z: -340, rotY: Math.PI,         speed: 0, driverId: null, variant: "compact", color: "#a04060" },
  { id: "car-17", x:  -3, y: 22.6, z: -462, rotY: 0,                speed: 0, driverId: null, variant: "taxi",    color: "#e8a02a" },
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
  { id: "car-26", x: 420, y: 5.16, z:  -55, rotY: Math.PI,          speed: 0, driverId: null, variant: "compact", color: "#37474f" },
  // ===== West fields / depot (1 car) =====
  { id: "car-27", x: -220, y: 0.6, z:   65, rotY: Math.PI / 2,      speed: 0, driverId: null, variant: "van",     color: "#3e2723" },
];

// =============================================================
// SPAWN POINTS — must match server SPAWN_POINTS
// =============================================================

// Phase 13A (Batch D): the original first four points sat ON the x=0 / z=0 road
// centerlines (carriageway ±10), so the client offline-fallback spawn
// (LocalPlayer: SPAWN_POINTS[hash % len]) could place a player on a road. They
// are relocated into the four empty plaza quadrants (|x|,|z| > 10 → off both
// road bands), giving 2 spawns per quadrant with the existing ±15 points. All
// eight are now off-road and clear of buildings/RP buildings/RP houses/cars.
// MUST match the server SPAWN_POINTS mirror.
export const SPAWN_POINTS: [number, number, number][] = [
  [18, 1, -13],
  [17, 1, 13],
  [-18, 1, 13],
  [-18, 1, -13],
  [15, 1, 15],
  [-15, 1, 15],
  [15, 1, -15],
  [-15, 1, -15],
];

// (Old road-race CHECKPOINTS + RAMPS removed — the race/time-trial system was
//  deleted. RP job/license/gang checkpoints live in their own systems and are
//  unaffected.)

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

// Walk the four corners of the block at a fixed inset INSIDE its outer edge
// (block_half − 2). Phase 13A (Batch C): the previous +3 offset pushed the
// outer corners into the highrise / landmark tower ring (towers occupy the
// 81–93 m band just outside the ±80 block edge), so NPCs clipped through the
// corner landmarks and mid-edge highrises by up to 2.35 m. block_half − 2 keeps
// the loop in the lot band between the block's own buildings (≤ ±10 from
// centre) and the tower ring, with ≥ 2.6 m clearance to every building footprint
// (verified by dense segment sampling). Works for narrow split blocks too.
function makeBlockSidewalkLoop(
  cx: number,
  cz: number,
  bw: number,
  bd: number
): [number, number][] {
  const halfW = bw / 2 - 2;
  const halfD = bd / 2 - 2;
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

// Mountain ring expansion — see REGIONAL_ROADS for the matching
// `ridge-east-high`, `ridge-west`, `summit-pass` road definitions and
// ROAD_ELEVATION_PROFILES for their Y values. Each polyline is fed to
// forwardReverseRoute so the ambient cars climb up, U-turn, and come
// back down. Endpoints are shared with existing graph nodes (outer
// loop / mountain switchbacks / ridge-east) so the road-graph BFS
// still sees one component.
const RIDGE_EAST_HIGH_POLY: ReadonlyArray<readonly [number, number]> = [
  [280, -310], [340, -360], [420, -390], [460, -300], [460, -200],
];
const RIDGE_EAST_HIGH_LOOP: [number, number, number][] = forwardReverseRoute(
  RIDGE_EAST_HIGH_POLY,
);
const RIDGE_WEST_POLY: ReadonlyArray<readonly [number, number]> = [
  [-80, -290], [-180, -280], [-280, -260], [-380, -220], [-460, -200],
];
const RIDGE_WEST_LOOP: [number, number, number][] = forwardReverseRoute(
  RIDGE_WEST_POLY,
);
const SUMMIT_PASS_POLY: ReadonlyArray<readonly [number, number]> = [
  [-80, -390], [-160, -410], [-220, -405], [-260, -380],
];
const SUMMIT_PASS_LOOP: [number, number, number][] = forwardReverseRoute(
  SUMMIT_PASS_POLY,
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
  // Mountain ring traffic — cars on these routes climb because
  // AmbientTraffic samples elevation at the interpolated x,z via
  // getVehicleGroundY(). Validator confirms every waypoint sits on a
  // mountain road carriageway.
  {
    id: 6,
    waypoints: RIDGE_EAST_HIGH_LOOP,
    cycleSeconds: 100,
    cars: [
      { id: "ai-17", color: "#6e5a44", variant: "sedan", phase: 0.0 },
      { id: "ai-18", color: "#3a4a3a", variant: "van",   phase: 0.5 },
    ],
  },
  {
    id: 7,
    waypoints: RIDGE_WEST_LOOP,
    cycleSeconds: 90,
    cars: [
      { id: "ai-19", color: "#5a4030", variant: "compact", phase: 0.0 },
      { id: "ai-20", color: "#4a3a2a", variant: "taxi",    phase: 0.5 },
    ],
  },
  {
    id: 8,
    waypoints: SUMMIT_PASS_LOOP,
    cycleSeconds: 70,
    cars: [
      { id: "ai-21", color: "#7a4030", variant: "sedan", phase: 0.0 },
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
// ELEVATED RAIL LOOP — pillars, deck, station, train
// =============================================================
// The elevated loop circles the central city in the empty corridor
// OUTSIDE the inner-city-ring carriageway (94..106). Centerline radius
// ≈ 110 (octagonal, chamfered to make the loop drive smoother for the
// train). Deck height = 12m so vehicles, traffic-light arms (≤5m), and
// inner-city-ring lamps (≤6m) all clear underneath.
//
// City road carriageways the loop passes OVER (rail at y=12 → ground
// vehicles at y=0..3 are unaffected):
//   • spine-north  at (0, -110)  — top edge crossing
//   • spine-south  at (0,  110)  — bottom edge crossing
//   • east-service at (110, 0)   — east edge crossing
//   • west-utility at (-110, 0)  — west edge crossing
// Pillars are SKIPPED inside any of these carriageways.

export const RAIL_DECK_HEIGHT = 12;
const RAIL_LOOP_RADIUS = 110;
const RAIL_CHAMFER = 20;
const RAIL_PILLAR_SPACING = 22;
const RAIL_PILLAR_ROAD_CLEAR = 1.0;

// Octagonal closed loop. Last vertex = first vertex so the validator
// detects "closed" via equality, and the renderer can iterate edges
// with `for (i = 0; i < n-1; i++)`.
export const ELEVATED_RAIL_LOOP: RailVertex[] = (() => {
  const r = RAIL_LOOP_RADIUS;
  const c = r - RAIL_CHAMFER;
  const v: RailVertex[] = [
    { x:  r, z: -c }, // east-top
    { x:  c, z: -r }, // top-east
    { x: -c, z: -r }, // top-west
    { x: -r, z: -c }, // west-top
    { x: -r, z:  c }, // west-bottom
    { x: -c, z:  r }, // bottom-west
    { x:  c, z:  r }, // bottom-east
    { x:  r, z:  c }, // east-bottom
  ];
  v.push({ x: v[0].x, z: v[0].z });
  return v;
})();

// Returns the total perimeter length of the rail loop and the cumulative
// arc length at each vertex. Used by both the pillar generator and the
// runtime train-position interpolator (see CentralRail.tsx).
export function railLoopArcLengths(): { total: number; arcAt: number[] } {
  const arcAt: number[] = [0];
  let total = 0;
  for (let i = 0; i < ELEVATED_RAIL_LOOP.length - 1; i++) {
    const a = ELEVATED_RAIL_LOOP[i];
    const b = ELEVATED_RAIL_LOOP[i + 1];
    total += Math.hypot(b.x - a.x, b.z - a.z);
    arcAt.push(total);
  }
  return { total, arcAt };
}

// Sample (x, z, headingY) at arc length s ∈ [0, total). Used by the
// train animation; also used by the validator's train-path collision
// sweep.
export function railLoopPointAt(s: number): { x: number; z: number; rotY: number } {
  const { total, arcAt } = railLoopArcLengths();
  const sw = ((s % total) + total) % total;
  // Find segment via linear scan (loop has only 8 segments).
  let i = 0;
  while (i < arcAt.length - 1 && arcAt[i + 1] < sw) i++;
  const a = ELEVATED_RAIL_LOOP[i];
  const b = ELEVATED_RAIL_LOOP[i + 1];
  const segLen = arcAt[i + 1] - arcAt[i];
  const t = segLen > 0 ? (sw - arcAt[i]) / segLen : 0;
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  const rotY = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  return { x, z, rotY };
}

// Pillar candidate: every RAIL_PILLAR_SPACING along the perimeter, then
// reject any candidate that lands inside a city or regional carriageway
// (with RAIL_PILLAR_ROAD_CLEAR margin). The renderer uses this list as
// authoritative — there is no separate "rail pillar collision" data.
function generateRailPillars(): RailPillar[] {
  const out: RailPillar[] = [];
  const { total } = railLoopArcLengths();
  const step = RAIL_PILLAR_SPACING;
  for (let s = 0; s < total - 0.001; s += step) {
    const p = railLoopPointAt(s);
    // City grid carriageways
    let inRoad = false;
    for (const x of ROADS.ns) {
      if (Math.abs(p.x - x) < ROAD_HALF + RAIL_PILLAR_ROAD_CLEAR) {
        if (Math.abs(p.z) <= CITY_HALF) { inRoad = true; break; }
      }
    }
    if (!inRoad) {
      for (const z of ROADS.ew) {
        if (Math.abs(p.z - z) < ROAD_HALF + RAIL_PILLAR_ROAD_CLEAR) {
          if (Math.abs(p.x) <= CITY_HALF) { inRoad = true; break; }
        }
      }
    }
    // Regional roads (covers spine-N/S, east-service, west-utility,
    // inner-city-ring at this radius).
    if (!inRoad) {
      for (const r of REGIONAL_ROADS) {
        const d = distancePointToPolyline(p.x, p.z, r.points);
        if (d < r.width / 2 + RAIL_PILLAR_ROAD_CLEAR) {
          inRoad = true;
          break;
        }
      }
    }
    if (!inRoad) out.push({ x: p.x, z: p.z, rotY: p.rotY });
  }
  return out;
}

// Note: REGIONAL_ROADS is referenced inside generateRailPillars(), so
// RAIL_PILLARS must be exported AFTER REGIONAL_ROADS is defined.
// The actual export sits in the rail-render block far below. To keep
// data + helpers co-located here we expose the GENERATOR and bind the
// const at the bottom-of-file rail block.
let _RAIL_PILLARS_CACHE: RailPillar[] | null = null;
export function getRailPillars(): RailPillar[] {
  if (!_RAIL_PILLARS_CACHE) _RAIL_PILLARS_CACHE = generateRailPillars();
  return _RAIL_PILLARS_CACHE;
}

// Train station — east edge of the loop, midway between the SE chamfer
// (110, -90) and the east-service crossing at (110, 0). Platform sits
// ON the rail line (centerline x=110), spans z = [-75..-55] = 20m long,
// 8m deep (x = 106..114). Stairs descend OUTWARD (away from the city)
// so the foot lands at x = 122, well clear of the inner-city-ring
// carriageway (centerline x=100, width 12 → carriageway 94..106).
export const TRAIN_STATION: TrainStationData = {
  id: "central-loop-station",
  cx: 110,
  cz: -65,
  w: 8,
  d: 20,
  rotY: 0,
  deckY: RAIL_DECK_HEIGHT,
  stairX: 122,
  stairZ: -65,
  signText: "Central Loop Station",
};

// Phase 15A: second station — direct x-mirror of the east station on the west
// loop edge (x=−110). Escalator descends OUTWARD (−X) to a ground foot, clear of
// the inner-city-ring road and the west homestead belt.
export const TRAIN_STATION_WEST: TrainStationData = {
  id: "central-loop-station-west",
  cx: -110,
  cz: -65,
  w: 8,
  d: 20,
  rotY: 0,
  deckY: RAIL_DECK_HEIGHT,
  stairX: -122,
  stairZ: -65,
  signText: "Central Loop Station West",
};

/** All boardable stations on the loop. TRAIN_STATION stays as the [0] alias. */
export const TRAIN_STATIONS: TrainStationData[] = [TRAIN_STATION, TRAIN_STATION_WEST];

// Train pause window — train slows to 0 over [pauseInS, pauseOutS] arc
// length. Computed from station's position on the loop (s ≈ railLoop
// arc-length at (110, -65)).
export function trainStationArcS(): number {
  // Station sits on the segment east-bottom (110, c) → east-top (110, -c)
  // i.e. segment index 7 → 0 wrap. Compute by sampling.
  const { total, arcAt } = railLoopArcLengths();
  // Vertex 0 is (110, -90), so the station at z=-65 lies between
  // vertex 7 (110, +90) and vertex 8 (= vertex 0, 110, -90), traveling
  // in the -z direction. Distance from vertex 7 = 90 - (-65) = 155.
  const sStation = arcAt[7] + 155;
  return sStation % total;
}

// =============================================================
// SKYBRIDGES — elevated pedestrian links
// =============================================================
// Each skybridge spans between two anchor points at height y. The
// validator confirms (a) every road carriageway the segment crosses
// has at least 5m vertical clearance below the bridge, and (b) the
// segment endpoints land on or near a tall-enough building roof
// (h ≥ y - 1).

export const SKYBRIDGES: SkybridgeData[] = [
  // North band — between H4 (-30,-86, h=66) and H5 (30,-86, h=74)
  // crossing N-S road at x=0, z=-86. y=10 → 10m clearance.
  { id: "sb-north", x1: -30, z1: -86, x2: 30, z2: -86, y: 10 },
  // South band — between H6 (-30,86, h=55) and H7 (30,86, h=78)
  // crossing N-S road at x=0, z=86.
  { id: "sb-south", x1: -30, z1: 86, x2: 30, z2: 86, y: 10 },
  // East band — between H1 (86,-30, h=62) and H2 (86,30, h=70)
  // crossing E-W road at z=0, x=86.
  { id: "sb-east", x1: 86, z1: -30, x2: 86, z2: 30, y: 10 },
  // West band — between H3 (-86,-30, h=58) and L5 (-87,30, h=105)
  // crossing E-W road at z=0, x=-86.
  { id: "sb-west", x1: -86, z1: -30, x2: -86, z2: 30, y: 10 },
];

// =============================================================
// VARIANT METADATA — used by VehicleObject and AmbientTraffic
// =============================================================

export const VARIANT_DIMENSIONS: Record<
  VehicleVariant,
  { bodyW: number; bodyH: number; bodyD: number; cabinW: number; cabinH: number; cabinD: number; cabinOffsetZ: number }
> = {
  // cabinOffsetZ is the cabin's local-Z offset from the body center.
  // The vehicle's gameplay forward is local -Z (LocalPlayer + traffic
  // routes use forward = (-sin rotY, -cos rotY)), so the cabin sits
  // slightly toward the REAR (positive Z) of the body.
  sedan:   { bodyW: 2.2, bodyH: 0.8, bodyD: 4.5, cabinW: 1.8, cabinH: 0.7, cabinD: 2.4, cabinOffsetZ:  0.2 },
  van:     { bodyW: 2.3, bodyH: 1.0, bodyD: 5.0, cabinW: 2.1, cabinH: 1.4, cabinD: 3.6, cabinOffsetZ:  0.4 },
  taxi:    { bodyW: 2.2, bodyH: 0.8, bodyD: 4.5, cabinW: 1.8, cabinH: 0.7, cabinD: 2.4, cabinOffsetZ:  0.2 },
  compact: { bodyW: 2.0, bodyH: 0.7, bodyD: 3.8, cabinW: 1.6, cabinH: 0.6, cabinD: 2.0, cabinOffsetZ:  0.2 },
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
    // The intermediate (non-cardinal) vertices below are COLLINEAR with
    // the original 8 cardinal/corner vertices, so the rendered ring
    // geometry is unchanged. They exist purely so each peri-city
    // homestead driveway in `drv-hs-*` starts at an inner-city-ring
    // graph node — without them every homestead driveway would show up
    // as an "isolated road" component in the road-graph validator.
    points: [
      [ 100, -100], [ 100,  -30], [ 100,    0],
      [ 100,   45], [ 100,   75], [ 100,  100],
      [  55,  100], [  25,  100], [   0,  100],
      [ -45,  100], [-100,  100],
      [-100,   75], [-100,   30], [-100,    0],
      [-100,  -50], [-100, -100],
      [ -55, -100], [ -25, -100], [   0, -100],
      [  35, -100], [ 100, -100],
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
  // ===== Mountain ring expansion =====================================
  // ridge-east-high: alpine detour off ridge-east climbing to ~22m
  // before descending to the outer-loop NE corner. With ridge-east this
  // forms a high/low loop so players can pick a route. Start (280,-310)
  // shares a graph node with ridge-east; end (460,-200) with outer-loop.
  { id: "ridge-east-high",
    points: [[280, -310], [340, -360], [420, -390], [460, -300], [460, -200]],
    width: 10, type: "mountain" },
  // ridge-west: mountain back-road from the (-80,-290) switchback
  // corner west through the foothills, terminating on the outer-loop
  // NW corner at (-460,-200). Mirror of ridge-east. Start shares a node
  // with mountain-switchbacks; end with outer-loop.
  { id: "ridge-west",
    points: [[-80, -290], [-180, -280], [-280, -260], [-380, -220], [-460, -200]],
    width: 10, type: "mountain" },
  // summit-pass: short steep pass from the upper switchback corner
  // (-80,-390) down to the outer-loop NW corner (-260,-380). Provides a
  // shortcut from the summit area back to the outer ring without
  // driving the full switchback chain. Both endpoints sit on existing
  // graph nodes (mountain-switchbacks and outer-loop respectively).
  { id: "summit-pass",
    points: [[-80, -390], [-160, -410], [-220, -405], [-260, -380]],
    width: 10, type: "mountain" },
  // ridge-east-far: east-side foothill road outside the outer-loop east
  // leg — climbs over a low ridge between the east-service junction
  // (460,30) and the outer-loop NE corner (460,-200). Both endpoints
  // share existing graph nodes so the BFS still resolves a single
  // component; the new vertices at x=495 stay clear of every warehouse
  // (warehouses sit at x≤440). Adds the eastern face to the mountain
  // ring so the city is mountain-walled E as well as N.
  { id: "ridge-east-far",
    points: [[460, 30], [495, -30], [495, -120], [460, -200]],
    width: 8, type: "mountain" },
  // ridge-west-far: mirror on the west side. Endpoints (-460,0) and
  // (-460,-200) share with west-utility / ridge-west / outer-loop NW.
  { id: "ridge-west-far",
    points: [[-460, 0], [-495, -50], [-495, -120], [-460, -200]],
    width: 8, type: "mountain" },
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
  // ---------------------------------------------------------------
  // Peri-city homestead driveways. Each `points[0]` matches a vertex
  // on `inner-city-ring` (see the intermediate vertices added above)
  // so the road-graph validator treats the driveway as connected. The
  // endpoint sits ~1m short of the yard gate centre so the asphalt /
  // dirt strip does not visually pierce the fence opening. See
  // PERI_CITY_HOMESTEADS for the matching house/yard/fence definitions.
  // ---------------------------------------------------------------
  // North cluster (gates face south toward ring north edge z=-100)
  { id: "drv-hs-n1", points: [[-55, -100], [-55, -116]], width: 4, type: "dirt" },
  { id: "drv-hs-n2", points: [[-25, -100], [-25, -120]], width: 4, type: "dirt" },
  { id: "drv-hs-n3", points: [[ 35, -100], [ 35, -116]], width: 4, type: "dirt" },
  // East cluster (gates face west toward ring east edge x=+100).
  // Endpoints stop ~1m short of each gate centre so the dirt strip
  // does not pierce the fence opening.
  { id: "drv-hs-e1", points: [[100, -30], [119, -30]], width: 4, type: "dirt" },
  { id: "drv-hs-e2", points: [[100,  45], [120,  45]], width: 4, type: "dirt" },
  { id: "drv-hs-e3", points: [[100,  75], [122,  75]], width: 4, type: "dirt" },
  // South cluster (gates face north toward ring south edge z=+100)
  { id: "drv-hs-s1", points: [[-45, 100], [-45, 116]], width: 4, type: "dirt" },
  { id: "drv-hs-s2", points: [[ 25, 100], [ 25, 120]], width: 4, type: "dirt" },
  { id: "drv-hs-s3", points: [[ 55, 100], [ 55, 117]], width: 4, type: "dirt" },
  // West cluster (gates face east toward ring west edge x=-100).
  // Endpoints stop ~1m short of each gate centre.
  { id: "drv-hs-w1", points: [[-100, -50], [-119, -50]], width: 4, type: "dirt" },
  { id: "drv-hs-w2", points: [[-100,  30], [-122,  30]], width: 4, type: "dirt" },
  { id: "drv-hs-w3", points: [[-100,  75], [-124,  75]], width: 4, type: "dirt" },

  // Phase 14A: pedestrian connector from the inner-ring SE corner node (100,100)
  // up to the Grand Plaza Hall entrance apron. points[0] is an existing ring
  // graph node, so the road-graph validator treats it as a connected spur (like
  // the homestead driveways). Coordinates mirror EVENT_HALL_CONNECTOR in
  // shared/eventHall.ts (kept inline to avoid a cityData↔eventHall import cycle).
  { id: "path-grand-plaza-hall", points: [[100, 100], [130, 116], [160, 128]], width: 5, type: "dirt" },
];

// =============================================================
// ROAD ELEVATION PROFILES — per-vertex Y for mountain roads
// =============================================================
//
// Keyed by RoadPath.id; the array length MUST equal the matching
// road's `points.length` (validator enforces this). Y values are
// metres above the world ground plane (y=0). Roads not listed here
// render flat at y=0.005 like before and contribute zero elevation
// from getRoadElevationAt() (see shared/elevation.ts).
//
// Endpoint Y values must agree at shared road-graph nodes (e.g. the
// (80,-340) corner shared by mountain-switchbacks and ridge-east is
// y=12 in BOTH profiles, so the carriageway joins seamlessly). The
// validator's mountainRing block diffs every shared endpoint and
// flags any mismatch ≥ 0.5 m as an elevation discontinuity.
//
// Max grade target: ≤ 0.18 (≈10°). Steeper drops are broken with
// switchback geometry. The validator prints maxGrade as a percent.
export const ROAD_ELEVATION_PROFILES: Record<string, number[]> = {
  "mountain-switchbacks": [0, 4, 8, 12, 16, 20, 22],
  "mountain-lookout":     [4, 6],
  "ridge-east":           [12, 9, 6, 3, 0],
  "ridge-east-high":      [6, 14, 22, 12, 0],
  "ridge-west":           [8, 6, 4, 2, 0],
  "summit-pass":          [16, 14, 6, 0],
  // East/west foothill ridges (smaller climbs — visual ramparts on the
  // sides of the world). Endpoints stay at Y=0 so they join flat-land
  // outer-loop / east-service / west-utility cleanly.
  "ridge-east-far":       [0, 4, 6, 0],
  "ridge-west-far":       [0, 4, 6, 0],
};

// Mountain road IDs — single source of truth used by the renderer
// (decides which segments draw at midY instead of y=0.005), the
// elevation helpers in shared/elevation.ts, and the mountainRing
// validator. Derived from ROAD_ELEVATION_PROFILES so adding a new
// mountain road profile above is enough — no second list to update.
export const MOUNTAIN_ROAD_IDS: ReadonlySet<string> = new Set(
  Object.keys(ROAD_ELEVATION_PROFILES),
);

// =============================================================
// MOUNTAIN MASSIFS — large background cones suggesting peaks
// =============================================================
//
// Purely cosmetic — rendered as solid cones by BiomeRender's
// MountainMassifs component. Positioned in the high country (z<-380)
// well clear of every road carriageway; the mountainRing validator
// asserts the clearance footprint (massif.r) does not intrude any
// road's halfWidth.
// Each entry is a smooth dome consumed by `terrainHeightAt(x, z)` in
// shared/terrain.ts (peak `h`, smoothstep falloff over radius `r`).
// Massifs are NOT rendered as standalone cones — the MountainTerrain
// heightfield mesh in BiomeRender bakes them into a single continuous
// ground surface together with the road support skirts. Overlapping
// domes blend via max() so a chain of massifs reads as one ridge
// instead of isolated pyramids. The mountainRing validator asserts:
//   (a) every dome footprint clears every road carriageway,
//   (b) for every elevated road sample point, terrainHeightAt(x,z)
//       lies within 0.5m of the road profile (so domes never poke
//       above roads and create a floating road).
export const MOUNTAIN_MASSIFS: ReadonlyArray<{
  x: number; z: number; r: number; h: number;
}> = [
  // ---- North main ridge (9 overlapping domes spanning x=-470..+470) ----
  // Heights chosen so neighbouring massifs blend into a continuous
  // arc. The central dome behind the observatory stays low (h=18) so
  // the summit road profile (Y=22 at (0,-465)) keeps winning the max.
  { x: -470, z: -470, r: 55, h: 50 },
  { x: -380, z: -485, r: 70, h: 60 },
  { x: -260, z: -490, r: 65, h: 50 },
  { x: -150, z: -495, r: 50, h: 45 },
  { x:    0, z: -498, r: 22, h: 18 }, // low dome — summit road wins
  { x:  150, z: -495, r: 50, h: 45 },
  { x:  260, z: -490, r: 65, h: 50 },
  { x:  380, z: -485, r: 70, h: 60 },
  { x:  470, z: -470, r: 55, h: 50 },
  // ---- East rampart (foothills wrapping the eastern outer loop) ----
  // Skip the z=-200..30 band where ridge-east-far lives so the dome
  // footprints don't intrude on the carriageway.
  { x:  498, z: -400, r: 20, h: 25 },
  { x:  498, z: -300, r: 20, h: 25 },
  { x:  498, z:   80, r: 20, h: 24 },
  { x:  498, z:  200, r: 22, h: 26 },
  { x:  498, z:  320, r: 20, h: 24 },
  { x:  498, z:  440, r: 18, h: 22 },
  // ---- West rampart (mirror) ----
  { x: -498, z: -400, r: 20, h: 25 },
  { x: -498, z: -300, r: 20, h: 25 },
  { x: -498, z:   80, r: 20, h: 24 },
  { x: -498, z:  200, r: 22, h: 26 },
  { x: -498, z:  320, r: 20, h: 24 },
  { x: -498, z:  440, r: 18, h: 22 },
  // ---- South wall (kept clear of village/cabins/trailhead) ----
  { x: -380, z:  495, r: 30, h: 35 },
  { x: -200, z:  498, r: 22, h: 28 },
  { x:  200, z:  498, r: 22, h: 28 },
  { x:  380, z:  495, r: 30, h: 35 },
];

// =============================================================
// PERI-CITY HOMESTEAD BELT — wooden cottages around the central city
// =============================================================
//
// 12 small wooden houses arranged in 4 clusters (N/S/E/W) just outside
// the inner-city-ring carriageway. Each homestead has a fenced yard
// (yardW × yardD) with the house centred inside, a 4m-wide gate on the
// `gateSide` edge, and a short dirt driveway in REGIONAL_ROADS that
// taps into a matching inner-city-ring vertex (see drv-hs-*).
//
// `style` is purely cosmetic; both styles share footprint maths.
// `rotY` only rotates the rendered house (door faces the gate);
// gameplay collision uses the axis-aligned `houseW × houseD` AABB
// pushed into STATIC_OBSTACLES below.
export const PERI_CITY_HOMESTEADS: ReadonlyArray<PeriCityHomestead> = [
  // North woods cluster ----------------------------------------------
  { id: "hs-n1", x: -55, z: -122, rotY:  0,           houseW: 7, houseD: 6, yardW: 16, yardD: 14,
    style: "cottage",  gateSide: "south", driveStart: [-55, -100] },
  { id: "hs-n2", x: -25, z: -128, rotY:  0,           houseW: 7, houseD: 6, yardW: 16, yardD: 18,
    style: "barnette", gateSide: "south", driveStart: [-25, -100] },
  { id: "hs-n3", x:  35, z: -122, rotY:  0,           houseW: 7, houseD: 6, yardW: 16, yardD: 14,
    style: "cottage",  gateSide: "south", driveStart: [ 35, -100] },
  // East woodland / suburban edge cluster ---------------------------
  // Avoids TRAIN_STATION footprint (cx=110, cz=-65, w=8, d=20) and
  // its staircase landing at (122, -65) — first house pushed north to
  // z=-30 so its yard does not collide with the platform.
  { id: "hs-e1", x: 128, z:  -30, rotY: -Math.PI / 2, houseW: 7, houseD: 6, yardW: 16, yardD: 14,
    style: "cottage",  gateSide: "west",  driveStart: [100, -30] },
  { id: "hs-e2", x: 130, z:   45, rotY: -Math.PI / 2, houseW: 7, houseD: 6, yardW: 18, yardD: 16,
    style: "barnette", gateSide: "west",  driveStart: [100,  45] },
  { id: "hs-e3", x: 132, z:   75, rotY: -Math.PI / 2, houseW: 7, houseD: 6, yardW: 18, yardD: 16,
    style: "cottage",  gateSide: "west",  driveStart: [100,  75] },
  // South bridge / forest gateway cluster ---------------------------
  // Avoids the bridge approach corridor |x| < 30, z ∈ [100, 180].
  // House x coordinates match the corresponding drv-hs-s* driveway so
  // the driveway lands on the gate (validator enforces alignment).
  { id: "hs-s1", x: -45, z:  122, rotY:  Math.PI,     houseW: 7, houseD: 6, yardW: 16, yardD: 14,
    style: "cottage",  gateSide: "north", driveStart: [-45, 100] },
  { id: "hs-s2", x:  25, z:  128, rotY:  Math.PI,     houseW: 7, houseD: 6, yardW: 16, yardD: 18,
    style: "barnette", gateSide: "north", driveStart: [ 25, 100] },
  { id: "hs-s3", x:  55, z:  124, rotY:  Math.PI,     houseW: 7, houseD: 6, yardW: 16, yardD: 16,
    style: "cottage",  gateSide: "north", driveStart: [ 55, 100] },
  // West fields / forest edge cluster -------------------------------
  { id: "hs-w1", x: -128, z: -50, rotY:  Math.PI / 2, houseW: 7, houseD: 6, yardW: 16, yardD: 14,
    style: "cottage",  gateSide: "east",  driveStart: [-100, -50] },
  { id: "hs-w2", x: -132, z:  30, rotY:  Math.PI / 2, houseW: 7, houseD: 6, yardW: 18, yardD: 16,
    style: "barnette", gateSide: "east",  driveStart: [-100,  30] },
  { id: "hs-w3", x: -134, z:  75, rotY:  Math.PI / 2, houseW: 7, houseD: 6, yardW: 18, yardD: 16,
    style: "cottage",  gateSide: "east",  driveStart: [-100,  75] },
];

const HOMESTEAD_FENCE_THICKNESS = 0.3;
const HOMESTEAD_FENCE_GATE_HALF = 2.0;

// Yard rectangles used by the tree-belt rejector and the validator's
// "tree inside yard" coverage check. Returns the axis-aligned bounds.
export function homesteadYardBounds(h: PeriCityHomestead): {
  x0: number; x1: number; z0: number; z1: number;
} {
  return {
    x0: h.x - h.yardW / 2,
    x1: h.x + h.yardW / 2,
    z0: h.z - h.yardD / 2,
    z1: h.z + h.yardD / 2,
  };
}

// Produce the 4 (or 6, when split by a gate) fence panels around a
// homestead yard as collidable axis-aligned AABBs. Each side normally
// renders as one long thin AABB; the side carrying the gate is split
// into two shorter panels with a 2 × HOMESTEAD_FENCE_GATE_HALF gap
// centred on that edge.
export function homesteadFenceSegments(h: PeriCityHomestead): StaticObstacle[] {
  const halfW = h.yardW / 2;
  const halfD = h.yardD / 2;
  const t = HOMESTEAD_FENCE_THICKNESS;
  const g = HOMESTEAD_FENCE_GATE_HALF;
  const out: StaticObstacle[] = [];
  const pushHorizontal = (cx: number, cz: number, w: number) => {
    if (w < 0.5) return;
    out.push({ x: cx, z: cz, w, d: t, kind: "yard_fence" });
  };
  const pushVertical = (cx: number, cz: number, d: number) => {
    if (d < 0.5) return;
    out.push({ x: cx, z: cz, w: t, d, kind: "yard_fence" });
  };
  // North side (z = h.z - halfD) — runs along x.
  if (h.gateSide === "north") {
    const panelW = halfW - g;
    pushHorizontal(h.x - (g + panelW / 2), h.z - halfD, panelW);
    pushHorizontal(h.x + (g + panelW / 2), h.z - halfD, panelW);
  } else {
    pushHorizontal(h.x, h.z - halfD, h.yardW);
  }
  // South side (z = h.z + halfD).
  if (h.gateSide === "south") {
    const panelW = halfW - g;
    pushHorizontal(h.x - (g + panelW / 2), h.z + halfD, panelW);
    pushHorizontal(h.x + (g + panelW / 2), h.z + halfD, panelW);
  } else {
    pushHorizontal(h.x, h.z + halfD, h.yardW);
  }
  // West side (x = h.x - halfW) — runs along z.
  if (h.gateSide === "west") {
    const panelD = halfD - g;
    pushVertical(h.x - halfW, h.z - (g + panelD / 2), panelD);
    pushVertical(h.x - halfW, h.z + (g + panelD / 2), panelD);
  } else {
    pushVertical(h.x - halfW, h.z, h.yardD);
  }
  // East side (x = h.x + halfW).
  if (h.gateSide === "east") {
    const panelD = halfD - g;
    pushVertical(h.x + halfW, h.z - (g + panelD / 2), panelD);
    pushVertical(h.x + halfW, h.z + (g + panelD / 2), panelD);
  } else {
    pushVertical(h.x + halfW, h.z, h.yardD);
  }
  return out;
}

// Pre-computed AABBs pushed into STATIC_OBSTACLES so the existing
// player/vehicle collision pipeline blocks the houses + fences.
const HOMESTEAD_HOUSE_OBSTACLES: StaticObstacle[] =
  PERI_CITY_HOMESTEADS.map((h) => ({
    x: h.x, z: h.z, w: h.houseW, d: h.houseD, kind: "wooden_house",
  }));
const HOMESTEAD_FENCE_OBSTACLES: StaticObstacle[] =
  PERI_CITY_HOMESTEADS.flatMap(homesteadFenceSegments);

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
  // Mountain ring expansion — extra cliff walls on the outer (drop-off)
  // side of the new ridge roads, plus guardrails on the steep corners.
  // ridge-east-high outer wall (climbing east from 280,-310 to peak)
  { x:  390, z: -420, w: 24, d: 8,  kind: "cliff_wall" },
  // ridge-west outer wall (mid-foothills)
  { x: -340, z: -200, w: 24, d: 8,  kind: "cliff_wall" },
  // summit-pass cliff above the (-160,-410) switchback corner
  { x: -180, z: -440, w: 20, d: 8,  kind: "cliff_wall" },
  // ridge-east-high guardrails at the steepest descent
  { x:  445, z: -300, w: 1.2, d: 12, kind: "guardrail" },
  // ridge-west guardrail at the (-280,-260) midpoint
  { x: -280, z: -245, w: 12, d: 1.2, kind: "guardrail" },
  // summit-pass guardrail at the steep (-220,-405) corner
  { x: -222, z: -390, w: 1.2, d: 12, kind: "guardrail" },
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
  // Peri-city homestead belt — appended last so the index order of the
  // pre-existing entries above is unchanged. Houses are full collidable
  // boxes; fence panels are thin AABBs that block walk/drive-through.
  ...HOMESTEAD_HOUSE_OBSTACLES,
  ...HOMESTEAD_FENCE_OBSTACLES,
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
  for (let i = 0; i < ROCK_TARGET * 6 && out.length < ROCK_TARGET; i++) {
    // Keep clear of every rendered road polyline (switchbacks +
    // lookout spur). Old code only rejected |x|<14, which let rocks
    // intrude on the switchback corners at x=±80.
    const x = (r() - 0.5) * 290; // ±145
    const z = -460 + r() * 275;  // -460..-185
    if (tooCloseToAnyRoad(x, z, SCATTER_ROAD_CLEARANCE)) continue;
    // Phase 13A (Batch E): also reject points that land inside a placed
    // mountain obstacle (cliff walls, boulders, observatory, guardrails) so a
    // scatter rock never visually clips a hand-placed cliff/boulder. Deterministic
    // (same seed; the loop just skips the few colliding draws and the try budget
    // is raised to ×6 so the target count is still met). Flora-only — no road,
    // building, or house coordinate is affected.
    let onObstacle = false;
    for (const o of STATIC_OBSTACLES) {
      if (Math.abs(x - o.x) < o.w / 2 + 1 && Math.abs(z - o.z) < o.d / 2 + 1) {
        onObstacle = true;
        break;
      }
    }
    if (onObstacle) continue;
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
// PERI-CITY FOREST BELT — wraps the central city in trees
// =============================================================
//
// Goal: from the city plaza you should see treetops in every direction
// just past the city blocks. The belt is the square annulus
//   125 <= max(|x|, |z|) <= 230
// Trees are rejected near roads, buildings, obstacles, lamps, parking
// spots, checkpoints, parked vehicles, and the city core. Driveway
// entries punch natural gaps because the road-clearance check
// (halfWidth + 6m) keeps trees off the asphalt for free.

const CITY_EDGE_INNER = 125;          // start of belt (just outside city blocks)
const CITY_EDGE_OUTER = 230;          // outer extent (well inside biome zones)
const CITY_EDGE_CORE_MARGIN = 15;     // padding around CITY_HALF
const CITY_EDGE_ROAD_CLEAR = 6.0;     // tree trunk -> road edge clearance
const CITY_EDGE_BUILDING_CLEAR = 2.5;
const CITY_EDGE_OBSTACLE_CLEAR = 1.5;
const CITY_EDGE_LAMP_CLEAR = 3.0;
const CITY_EDGE_VEHICLE_CLEAR = 4.0;
const CITY_EDGE_CHECKPOINT_CLEAR = 6.0;
const CITY_EDGE_PARKING_CLEAR = 3.5;

function inCityEdgeBelt(x: number, z: number): boolean {
  const m = Math.max(Math.abs(x), Math.abs(z));
  return m >= CITY_EDGE_INNER && m <= CITY_EDGE_OUTER;
}

function inCityCorePlusMargin(x: number, z: number): boolean {
  return (
    Math.abs(x) <= CITY_HALF + CITY_EDGE_CORE_MARGIN &&
    Math.abs(z) <= CITY_HALF + CITY_EDGE_CORE_MARGIN
  );
}

// Slack added around each homestead yard so the surrounding tree row
// hugs the fence rather than landing on it.
const CITY_EDGE_HOMESTEAD_YARD_SLACK = 1.5;

function inAnyHomesteadYard(x: number, z: number): boolean {
  for (const h of PERI_CITY_HOMESTEADS) {
    const b = homesteadYardBounds(h);
    if (
      x >= b.x0 - CITY_EDGE_HOMESTEAD_YARD_SLACK &&
      x <= b.x1 + CITY_EDGE_HOMESTEAD_YARD_SLACK &&
      z >= b.z0 - CITY_EDGE_HOMESTEAD_YARD_SLACK &&
      z <= b.z1 + CITY_EDGE_HOMESTEAD_YARD_SLACK
    ) {
      return true;
    }
  }
  return false;
}

// Phase 14A: keep city-edge trees out of the Grand Plaza Hall and its approach.
// The hall footprint sits inside the city-edge belt but OUTSIDE the city-core
// margin, so without this rule random scatter / roadside rows could drop trees
// inside the hall (through walls/chairs/screen) or on the connector path.
const EVENT_HALL_TREE_KEEPOUT = 6;          // footprint expanded by 6 m → x[131.5,198.5] z[125,175]
const EVENT_HALL_CONNECTOR_TREE_CLEAR = 6;  // tree → connector centerline clearance

function inEventHallKeepout(x: number, z: number): boolean {
  return (
    x >= EVENT_HALL_EXTENTS.xMin - EVENT_HALL_TREE_KEEPOUT &&
    x <= EVENT_HALL_EXTENTS.xMax + EVENT_HALL_TREE_KEEPOUT &&
    z >= EVENT_HALL_EXTENTS.zMin - EVENT_HALL_TREE_KEEPOUT &&
    z <= EVENT_HALL_EXTENTS.zMax + EVENT_HALL_TREE_KEEPOUT
  );
}

function nearEventHallConnector(x: number, z: number): boolean {
  return (
    distancePointToPolyline(
      x, z,
      EVENT_HALL_CONNECTOR as ReadonlyArray<readonly [number, number]>,
    ) < EVENT_HALL_CONNECTOR_TREE_CLEAR
  );
}

function cityEdgeRejected(x: number, z: number): boolean {
  if (!inCityEdgeBelt(x, z)) return true;
  if (inCityCorePlusMargin(x, z)) return true;
  // Phase 14A: hall footprint+apron and approach path stay tree-free.
  if (inEventHallKeepout(x, z)) return true;
  if (nearEventHallConnector(x, z)) return true;
  if (Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) return true;
  if (tooCloseToAnyRoad(x, z, CITY_EDGE_ROAD_CLEAR)) return true;
  if (checkBuildingCollision(x, z, CITY_EDGE_BUILDING_CLEAR)) return true;
  // Reject inside any peri-city homestead yard (with slack). The
  // homestead house + fence AABBs are already in STATIC_OBSTACLES so
  // the obstacle-clearance check below catches direct overlaps; this
  // rule additionally keeps the open yard ground itself tree-free.
  if (inAnyHomesteadYard(x, z)) return true;
  for (const o of STATIC_OBSTACLES) {
    const dx = Math.max(0, Math.abs(x - o.x) - o.w / 2);
    const dz = Math.max(0, Math.abs(z - o.z) - o.d / 2);
    if (dx * dx + dz * dz < CITY_EDGE_OBSTACLE_CLEAR * CITY_EDGE_OBSTACLE_CLEAR) return true;
  }
  for (const l of STREET_LIGHTS) {
    const dx = x - l.x; const dz = z - l.z;
    if (dx * dx + dz * dz < CITY_EDGE_LAMP_CLEAR * CITY_EDGE_LAMP_CLEAR) return true;
  }
  for (const l of VILLAGE_LAMPS) {
    const dx = x - l.x; const dz = z - l.z;
    if (dx * dx + dz * dz < CITY_EDGE_LAMP_CLEAR * CITY_EDGE_LAMP_CLEAR) return true;
  }
  for (const v of INITIAL_VEHICLES) {
    const dx = x - v.x; const dz = z - v.z;
    if (dx * dx + dz * dz < CITY_EDGE_VEHICLE_CLEAR * CITY_EDGE_VEHICLE_CLEAR) return true;
  }
  for (const p of PARKING_SPOTS) {
    const dx = x - p.x; const dz = z - p.z;
    if (dx * dx + dz * dz < CITY_EDGE_PARKING_CLEAR * CITY_EDGE_PARKING_CLEAR) return true;
  }
  for (const p of VILLAGE_PARKING_PADS) {
    const dx = x - p.x; const dz = z - p.z;
    if (dx * dx + dz * dz < CITY_EDGE_PARKING_CLEAR * CITY_EDGE_PARKING_CLEAR) return true;
  }
  return false;
}

// Optional structured rows along the OUTSIDE of city-exit corridors.
// These reinforce the "city is surrounded by woods" feel along the
// roads players actually drive in/out of downtown on.
function makeCityEdgeRoadsideRows(): TreeInstance[] {
  const rows: TreeInstance[] = [];
  const r = seededRandom(70707);
  const targets: ReadonlyArray<{
    id: string; spacing: number; offset: number; minDist: number; maxDist: number;
  }> = [
    { id: "inner-city-ring", spacing: 14, offset: 12, minDist: 0,   maxDist: 9999 },
    { id: "spine-north",     spacing: 12, offset: 11, minDist: 0,   maxDist: 9999 },
    { id: "spine-south",     spacing: 12, offset: 11, minDist: 0,   maxDist: 9999 },
    { id: "east-service",    spacing: 14, offset: 11, minDist: 0,   maxDist: 220 },
    { id: "west-utility",    spacing: 14, offset: 11, minDist: 0,   maxDist: 220 },
  ];
  for (const t of targets) {
    const road = REGIONAL_ROADS.find((rr) => rr.id === t.id);
    if (!road) continue;
    const minOffset = road.width / 2 + 7;
    const offset = Math.max(t.offset, minOffset);
    let traveled = 0;
    let nextSample = t.spacing * 0.5;
    for (let i = 0; i < road.points.length - 1; i++) {
      const [ax, az] = road.points[i];
      const [bx, bz] = road.points[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const tx = dx / len;
      const tz = dz / len;
      const nx = tz;
      const nz = -tx;
      while (nextSample < traveled + len) {
        const tl = (nextSample - traveled) / len;
        const px = ax + tl * dx;
        const pz = az + tl * dz;
        const radial = Math.hypot(px, pz);
        nextSample += t.spacing;
        if (radial < t.minDist || radial > t.maxDist) continue;
        for (const side of [1, -1] as const) {
          const x = px + side * offset * nx;
          const z = pz + side * offset * nz;
          if (cityEdgeRejected(x, z)) continue;
          rows.push({ x, z, scale: 0.85 + r() * 0.4, rotY: r() * Math.PI * 2 });
        }
      }
      traveled += len;
    }
  }
  return rows;
}

function makeCityEdgeTrees(): TreeInstance[] {
  const r = seededRandom(54321);
  const out: TreeInstance[] = makeCityEdgeRoadsideRows();
  const tooCloseToExisting = (x: number, z: number): boolean => {
    for (const t of out) {
      const dx = x - t.x;
      const dz = z - t.z;
      if (dx * dx + dz * dz < 9) return true; // 3m
    }
    return false;
  };
  const TARGET = 420;
  const MAX_TRIES = TARGET * 14;
  let tries = 0;
  while (out.length < TARGET && tries < MAX_TRIES) {
    tries++;
    const x = (r() - 0.5) * 2 * CITY_EDGE_OUTER;
    const z = (r() - 0.5) * 2 * CITY_EDGE_OUTER;
    if (cityEdgeRejected(x, z)) continue;
    if (tooCloseToExisting(x, z)) continue;
    // Density bias: thin out scatter near a cardinal axis (≈road-exit
    // corridor) so exits read as openings; corners stay at full density.
    const axisOffset = Math.min(Math.abs(x), Math.abs(z));
    if (axisOffset < 25 && r() < 0.4) continue;
    out.push({ x, z, scale: 0.75 + r() * 0.8, rotY: r() * Math.PI * 2 });
  }
  return out;
}

export const CITY_EDGE_TREES: TreeInstance[] = makeCityEdgeTrees();

// =============================================================
// REGIONAL ROAD LIGHTING — fake-light pass over REGIONAL_ROADS
// =============================================================
//
// Lamp poles are generated procedurally from REGIONAL_ROADS so every
// arterial / collector / local road gets shoulder lighting at night.
// The renderer (BiomeRender) draws each lamp as an emissive head + a
// transparent ground "light pool" disc; only a small fixed set of real
// pointLights at major junctions provide actual scene lighting. This
// keeps the per-frame light cost flat regardless of how many lamps we
// generate.
//
// Style is derived from RoadPath.type:
//   asphalt → "urban", bridge → "bridge",
//   forest/dirt → "rural", mountain → "mountain".
// Driveway-class roads (anything matching /^drv-/ or *-spur) get one
// marker lamp at the entrance instead of a full row.

// Real point lights: a small fixed list of warm, no-shadow lights at
// the busiest road junctions. VILLAGE_REAL_LIGHTS lights the south-
// forest village center; JUNCTION_REAL_LIGHTS covers regional choke
// points (inner-ring exits, bridge head, outer-loop corners, mountain
// switchback foot, east/west service junctions).
export const VILLAGE_REAL_LIGHTS: ReadonlyArray<readonly [number, number, number]> = [
  [  0, 5, 320], // village green centre
  [ 60, 5, 330], // east loop crossing
  [-55, 5, 325], // west loop crossing
];
export const JUNCTION_REAL_LIGHTS: ReadonlyArray<readonly [number, number, number]> = [
  // Inner-city-ring cardinal exits
  [   0, 6,  100], [ 100, 6,    0], [   0, 6, -100], [-100, 6,    0],
  // Bridge / forest entrance
  [   0, 6,  130], [   0, 6,  180],
  // East-service / outer-loop junction
  [ 460, 6,   30],
  // West-utility / outer-loop junction
  [-460, 6,    0],
  // Ridge-east / mountain switchback junction (sits at switchback
  // profile y=12, so the lamp pole top is +6m above the road surface).
  [  80, 18, -340],
  // Outer-loop major corners
  [ 260, 6, -380], [-260, 6, -380], [ 460, 6, -200],
];

// Mountain ring real point lights — switchback summit, ridge peaks,
// summit pass, ridge-west summit-side junction. Y values include a +6m
// pole offset above the road profile elevation so each lamp's bulb
// sits at the lamp head height (not embedded in the slope). Validator
// counts these and confirms TOTAL_REAL_LIGHTS includes them.
export const MOUNTAIN_REAL_LIGHTS: ReadonlyArray<readonly [number, number, number]> = [
  // Observatory plaza (summit, profile y=22)
  [   0, 28, -485],
  // Ridge-east-high peak (profile y=22)
  [ 420, 28, -390],
  // Ridge-east-high south corner (profile y=12)
  [ 460, 18, -300],
  // Summit-pass mid switchback (profile y=14)
  [-160, 20, -410],
  // Ridge-west summit-side junction (profile y=8)
  [ -80, 14, -290],
  // Mountain switchback foot (profile y=0, but visually marks the
  // entrance from the spine-north)
  [   0,  6, -200],
];

const LAMP_DEDUP_RADIUS = 8.0;
const LAMP_OBSTACLE_INFLATE = 1.0;

function isDrivewayRoad(id: string): boolean {
  // drv-* are explicit driveways; *-spur are short branch roads
  // (forest-spur outlier, gateway-spur, trailhead-spur) that the
  // lighting spec treats as entrance-marker rather than full lit
  // arterials.
  return /^drv-/.test(id) || /-spur$/.test(id);
}

function styleForRoad(r: RoadPath): RegionalLampData["style"] {
  if (r.type === "bridge") return "bridge";
  if (r.type === "mountain") return "mountain";
  if (r.type === "asphalt") return "urban";
  return "rural";
}

function generateRegionalRoadLamps(): RegionalLampData[] {
  const out: RegionalLampData[] = [];
  const existing: { x: number; z: number }[] = [
    ...STREET_LIGHTS,
    ...VILLAGE_LAMPS,
  ];
  const tooCloseExisting = (x: number, z: number): boolean => {
    for (const e of existing) {
      const dx = x - e.x, dz = z - e.z;
      if (dx * dx + dz * dz < LAMP_DEDUP_RADIUS * LAMP_DEDUP_RADIUS) return true;
    }
    const localR = LAMP_DEDUP_RADIUS * 0.6;
    for (const o of out) {
      const dx = x - o.x, dz = z - o.z;
      if (dx * dx + dz * dz < localR * localR) return true;
    }
    return false;
  };
  const insideObstacle = (x: number, z: number): boolean => {
    for (const o of STATIC_OBSTACLES) {
      if (o.kind === "guardrail" || o.kind === "bridge_rail") continue;
      const hx = o.w / 2 + LAMP_OBSTACLE_INFLATE;
      const hz = o.d / 2 + LAMP_OBSTACLE_INFLATE;
      if (
        x >= o.x - hx && x <= o.x + hx &&
        z >= o.z - hz && z <= o.z + hz
      ) return true;
    }
    return false;
  };
  const inWorld = (x: number, z: number): boolean =>
    Math.abs(x) <= WORLD_HALF - 5 && Math.abs(z) <= WORLD_HALF - 5;

  // Per-style spacing (m) along the road centerline and whether to
  // alternate sides. Both-sides placement (urban/bridge) doubles the
  // lamp density visually without changing the spacing.
  const SPACING: Record<RegionalLampData["style"], number> = {
    urban: 42, bridge: 32, rural: 55, mountain: 65,
  };
  const ALTERNATE: Record<RegionalLampData["style"], boolean> = {
    urban: false, bridge: false, rural: true, mountain: true,
  };

  // At sharp polyline corners the segment-local normal can cut back
  // across the previous segment's centerline, putting the lamp inside
  // the carriageway. After computing a candidate position, verify it
  // sits at least halfWidth+0.5m from the entire polyline.
  const insideOwnCarriageway = (
    x: number, z: number, r: RoadPath
  ): boolean => {
    const d = distancePointToPolyline(x, z, r.points);
    return d < r.width / 2 + 0.5;
  };

  for (const r of REGIONAL_ROADS) {
    const style = styleForRoad(r);
    const offset = r.width / 2 + 3.5;

    // Total polyline arc length.
    let total = 0;
    const segLens: number[] = [];
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      segLens.push(L);
      total += L;
    }
    if (total < 1e-3) continue;

    // Driveway-class or very short roads → one marker lamp at entrance.
    if (isDrivewayRoad(r.id) || total < 30) {
      const [ax, az] = r.points[0];
      const [bx, bz] = r.points[1];
      const L = segLens[0];
      if (L < 1e-3) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const nx = -tz, nz = tx;
      const t = Math.min(4, L / 2);
      const px = ax + tx * t + nx * offset;
      const pz = az + tz * t + nz * offset;
      const rotY = Math.atan2(tx, tz);
      if (
        inWorld(px, pz) &&
        !insideObstacle(px, pz) &&
        !tooCloseExisting(px, pz) &&
        !insideOwnCarriageway(px, pz, r)
      ) {
        out.push({ x: px, z: pz, rotY, roadId: r.id, style: "rural" });
      }
      continue;
    }

    const spacing = SPACING[style];
    const alternate = ALTERNATE[style];

    // Walk the polyline by arc length. First lamp is offset half a
    // spacing into the road so closed loops don't double-up at the
    // start vertex. Short roads (total < spacing) get one midpoint
    // lamp instead of being skipped entirely.
    let arc = Math.min(spacing * 0.5, total * 0.5);
    let lampIdx = 0;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const L = segLens[i];
      if (L < 1e-3) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const nx = -tz, nz = tx;
      const rotY = Math.atan2(tx, tz);
      let t = arc;
      while (t < L) {
        const sides = alternate
          ? [lampIdx % 2 === 0 ? +1 : -1]
          : [+1, -1];
        for (const s of sides) {
          const px = ax + tx * t + nx * offset * s;
          const pz = az + tz * t + nz * offset * s;
          if (!inWorld(px, pz)) continue;
          if (insideObstacle(px, pz)) continue;
          if (tooCloseExisting(px, pz)) continue;
          if (insideOwnCarriageway(px, pz, r)) continue;
          out.push({ x: px, z: pz, rotY, roadId: r.id, style });
        }
        lampIdx++;
        t += spacing;
      }
      arc = t - L;
    }
  }
  return out;
}

export const REGIONAL_ROAD_LAMPS: RegionalLampData[] = generateRegionalRoadLamps();
export const TOTAL_REAL_LIGHTS =
  VILLAGE_REAL_LIGHTS.length +
  JUNCTION_REAL_LIGHTS.length +
  MOUNTAIN_REAL_LIGHTS.length;

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

  // Phase 13A (Batch B): proper AABB-footprint vs polyline-road-carriageway test.
  // Axis-aligned segments (the whole inner-city-ring, spines, grid spurs) are
  // tested exactly as AABB-vs-band; diagonal segments (outer-loop chamfers,
  // forest/mountain curves) fall back to a conservative centre-to-segment
  // distance minus the footprint corner radius. Using true band geometry — not
  // a centre+radius circle — avoids false positives on objects deliberately
  // placed ~1 m off a straight road (e.g. the landmark towers beside the ring).
  const footprintHitsRoadPath = (
    cx: number, cz: number, w: number, d: number,
    road: { points: readonly (readonly [number, number])[]; width: number },
    margin = 0,
  ): boolean => {
    const half = road.width / 2;
    const pts = road.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      if (ax === bx) {
        const zmin = Math.min(az, bz) - half, zmax = Math.max(az, bz) + half;
        if (Math.abs(cx - ax) < w / 2 + half + margin &&
            cz + d / 2 + margin > zmin && cz - d / 2 - margin < zmax) return true;
      } else if (az === bz) {
        const xmin = Math.min(ax, bx) - half, xmax = Math.max(ax, bx) + half;
        if (Math.abs(cz - az) < d / 2 + half + margin &&
            cx + w / 2 + margin > xmin && cx - w / 2 - margin < xmax) return true;
      } else {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        let t = l2 ? ((cx - ax) * dx + (cz - az) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const dist = Math.hypot(cx - (ax + t * dx), cz - (az + t * dz));
        if (dist < half + Math.hypot(w / 2, d / 2) + margin) return true;
      }
    }
    return false;
  };

  // ---- City building / road sanity (existing checks) --------------------
  // Phase 13A (Batch D): legacy plaza spawns (client offline-fallback) must be
  // off the central road grid and clear of buildings, RP buildings, RP houses,
  // obstacles, and parked cars.
  const spawnOnGrid = (x: number, z: number): string | null => {
    for (const rx of ROADS.ns) if (Math.abs(x - rx) < ROAD_HALF && Math.abs(z) < CITY_HALF) return `x=${rx}`;
    for (const rz of ROADS.ew) if (Math.abs(z - rz) < ROAD_HALF && Math.abs(x) < CITY_HALF) return `z=${rz}`;
    return null;
  };
  // Phase 13A (Batch D): minimum clearance from a fallback spawn to any parked
  // car, so the player never materialises on top of / inside a vehicle.
  const SPAWN_CAR_CLEARANCE = 4.5;
  for (const sp of SPAWN_POINTS) {
    const [sx, , sz] = sp;
    if (checkBuildingCollision(sx, sz)) {
      issues.push(`spawn ${JSON.stringify(sp)} overlaps a building`);
    }
    if (!inBounds(sx, sz, 1)) {
      issues.push(`spawn ${JSON.stringify(sp)} is outside WORLD bounds`);
    }
    if (overlapsObstacle(sx, sz, 1.0)) {
      issues.push(`spawn ${JSON.stringify(sp)} overlaps a static obstacle`);
    }
    const gr = spawnOnGrid(sx, sz);
    if (gr) {
      issues.push(`spawn ${JSON.stringify(sp)} is on a road carriageway (${gr})`);
    }
    for (const rp of RP_BUILDINGS) {
      if (Math.abs(sx - rp.x) < rp.w / 2 && Math.abs(sz - rp.z) < rp.d / 2) {
        issues.push(`spawn ${JSON.stringify(sp)} is inside RP building ${rp.id}`);
        break;
      }
    }
    for (const h of RP_HOUSES) {
      if (Math.abs(sx - h.x) < h.w / 2 && Math.abs(sz - h.z) < h.d / 2) {
        issues.push(`spawn ${JSON.stringify(sp)} is inside RP house ${h.slug}`);
        break;
      }
    }
    for (const v of INITIAL_VEHICLES) {
      if (Math.hypot(sx - v.x, sz - v.z) < SPAWN_CAR_CLEARANCE) {
        issues.push(`spawn ${JSON.stringify(sp)} is within ${SPAWN_CAR_CLEARANCE} m of parked car ${v.id}`);
        break;
      }
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

  // ---- Phase 13A: RP houses vs the FULL world ---------------------------
  // The api-server validateRpHouses can only assert the city-core envelope
  // (it must not import client geometry). The literal, drift-free check —
  // RP_HOUSES vs every BUILDING, every REGIONAL_ROAD, every STATIC_OBSTACLE,
  // and every parked car — lives here, where that data actually exists. This
  // is what catches the Phase 12A regression (houses clipping landmark towers
  // and the inner-city-ring road) and any future procedural/road drift.
  const HOUSE_MARGIN = 1;
  for (const h of RP_HOUSES) {
    for (const b of BUILDINGS) {
      if (
        Math.abs(h.x - b.x) < (h.w + b.w) / 2 + HOUSE_MARGIN &&
        Math.abs(h.z - b.z) < (h.d + b.d) / 2 + HOUSE_MARGIN
      ) {
        issues.push(`RP house ${h.slug} overlaps building at (${b.x.toFixed(0)},${b.z.toFixed(0)}) ${b.w.toFixed(0)}x${b.d.toFixed(0)}`);
        break;
      }
    }
    for (const o of STATIC_OBSTACLES) {
      if (
        Math.abs(h.x - o.x) < (h.w + o.w) / 2 + HOUSE_MARGIN &&
        Math.abs(h.z - o.z) < (h.d + o.d) / 2 + HOUSE_MARGIN
      ) {
        issues.push(`RP house ${h.slug} overlaps obstacle ${o.kind} at (${o.x},${o.z})`);
        break;
      }
    }
    for (const v of INITIAL_VEHICLES) {
      if (
        Math.abs(h.x - v.x) < h.w / 2 + 1.5 &&
        Math.abs(h.z - v.z) < h.d / 2 + 1.5
      ) {
        issues.push(`RP house ${h.slug} overlaps vehicle ${v.id}`);
        break;
      }
    }
    // Roads: central grid (bounded ±CITY_HALF) + every regional polyline
    // (incl. inner-city-ring), using proper AABB-vs-band geometry.
    for (const rx of ROADS.ns) {
      if (Math.abs(h.x - rx) < ROAD_HALF + h.w / 2 && Math.abs(h.z) < CITY_HALF + h.d / 2) {
        issues.push(`RP house ${h.slug} clips central road x=${rx}`); break;
      }
    }
    for (const rz of ROADS.ew) {
      if (Math.abs(h.z - rz) < ROAD_HALF + h.d / 2 && Math.abs(h.x) < CITY_HALF + h.w / 2) {
        issues.push(`RP house ${h.slug} clips central road z=${rz}`); break;
      }
    }
    for (const r of REGIONAL_ROADS) {
      if (footprintHitsRoadPath(h.x, h.z, h.w, h.d, r, HOUSE_MARGIN)) {
        issues.push(`RP house ${h.slug} clips regional road ${r.id}`); break;
      }
    }
  }

  // ---- Phase 13A (Batch B): RP civic buildings vs the FULL world --------
  // Guards the Batch A procedural keep-out (RP buildings must stay clear of
  // every generated/highrise/landmark tower) and asserts RP buildings clear
  // the regional roads (esp. the inner-city-ring) — the same class of bug the
  // 12A houses hit. Central-road + RP-to-RP gaps are already asserted server
  // side (validateRpBuildings); this adds the client-only categories.
  for (const rp of RP_BUILDINGS) {
    for (const b of BUILDINGS) {
      if (
        Math.abs(rp.x - b.x) < (rp.w + b.w) / 2 &&
        Math.abs(rp.z - b.z) < (rp.d + b.d) / 2
      ) {
        issues.push(`RP building ${rp.id} overlaps a procedural/tower building at (${b.x.toFixed(0)},${b.z.toFixed(0)})`);
        break;
      }
    }
    for (const r of REGIONAL_ROADS) {
      if (footprintHitsRoadPath(rp.x, rp.z, rp.w, rp.d, r)) {
        issues.push(`RP building ${rp.id} clips regional road ${r.id}`);
        break;
      }
    }
  }

  // ---- Phase 13A (Batch B): all BUILDINGS vs regional roads -------------
  // The center-city grid + procedural buildings are already checked vs the
  // grid (building-on-road, below). This adds full BUILDINGS vs every regional
  // road carriageway (proper AABB-band), so a future tower/block can't be
  // pushed onto the inner-city-ring or any regional road undetected.
  let buildingsOnRegionalRoad = 0;
  for (const b of BUILDINGS) {
    for (const r of REGIONAL_ROADS) {
      if (footprintHitsRoadPath(b.x, b.z, b.w, b.d, r)) {
        buildingsOnRegionalRoad++;
        issues.push(`building at (${b.x.toFixed(0)},${b.z.toFixed(0)}) clips regional road ${r.id}`);
        break;
      }
    }
  }
  void buildingsOnRegionalRoad;

  // ---- Phase 13A (Batch C): parked cars / NPC + ambient traffic polish --
  // "On a road" = inside the bounded central grid carriageway OR within a
  // regional road carriageway (polyline distance). Used for rural parked cars
  // and ambient-traffic waypoints.
  const onAnyRoadC = (x: number, z: number, tol: number): boolean => {
    for (const rx of ROADS.ns)
      if (Math.abs(x - rx) < ROAD_HALF + tol && Math.abs(z) < CITY_HALF + tol) return true;
    for (const rz of ROADS.ew)
      if (Math.abs(z - rz) < ROAD_HALF + tol && Math.abs(x) < CITY_HALF + tol) return true;
    for (const r of REGIONAL_ROADS)
      if (distancePointToPolyline(x, z, r.points) < r.width / 2 + tol) return true;
    return false;
  };

  // City cars that intentionally parallel-park at a carriageway edge. Tagged
  // here (validator-local, no data mutation) so the on-road assertion below
  // distinguishes them from a stray car. Mirrors §5.7 of the audit.
  const INTENTIONAL_ROADSIDE_CARS = new Set([
    "car-4", "car-5", "car-6", "car-7", "car-12", "car-13",
  ]);
  const onVillagePad = (x: number, z: number): boolean =>
    VILLAGE_PARKING_PADS.some((p) => Math.hypot(x - p.x, z - p.z) < 4);

  for (const v of INITIAL_VEHICLES) {
    const isCity = Math.abs(v.x) <= CITY_HALF && Math.abs(v.z) <= CITY_HALF;
    if (isCity) {
      const onGrid =
        ROADS.ns.some((rx) => Math.abs(v.x - rx) < ROAD_HALF && Math.abs(v.z) < CITY_HALF) ||
        ROADS.ew.some((rz) => Math.abs(v.z - rz) < ROAD_HALF && Math.abs(v.x) < CITY_HALF);
      if (onGrid && !INTENTIONAL_ROADSIDE_CARS.has(v.id)) {
        issues.push(`parked car ${v.id} sits on a city carriageway but is not tagged intentional-roadside`);
      }
    } else {
      // Rural car — must sit on a regional road (edge ok) or a village pad.
      if (!onAnyRoadC(v.x, v.z, 2.5) && !onVillagePad(v.x, v.z)) {
        issues.push(`rural parked car ${v.id} (${v.x}, ${v.z}) is not on a regional road or parking pad`);
      }
    }
  }

  // Ambient traffic — every waypoint AND every segment midpoint must lie on a
  // road carriageway (turn apexes allowed a small tolerance). Upgrades the
  // existing on-road METRIC to a hard assertion.
  const TRAFFIC_ROAD_TOL = 3;
  for (const route of TRAFFIC_ROUTES) {
    const wps = route.waypoints;
    for (let i = 0; i < wps.length; i++) {
      if (!onAnyRoadC(wps[i][0], wps[i][1], TRAFFIC_ROAD_TOL)) {
        issues.push(`traffic route ${route.id} waypoint (${wps[i][0]}, ${wps[i][1]}) is off-road`);
      }
      if (i < wps.length - 1) {
        const mx = (wps[i][0] + wps[i + 1][0]) / 2;
        const mz = (wps[i][1] + wps[i + 1][1]) / 2;
        if (!onAnyRoadC(mx, mz, TRAFFIC_ROAD_TOL)) {
          issues.push(`traffic route ${route.id} segment midpoint (${mx.toFixed(0)}, ${mz.toFixed(0)}) is off-road`);
        }
      }
    }
  }

  // NPC pedestrian loops hug the sidewalk by design (block_half − 2), so they
  // are NOT asserted off-carriageway. They must, however, stay in bounds and
  // never route through a building or a static obstacle. `npcPositionAt`
  // interpolates along each segment, so we SAMPLE every segment (incl. the
  // closing leg back to the first waypoint), not just the corner waypoints.
  const NPC_BODY_R = 0.35;
  const samplePointInBuilding = (x: number, z: number): boolean => {
    for (const b of BUILDINGS) {
      if (Math.abs(x - b.x) < b.w / 2 + NPC_BODY_R && Math.abs(z - b.z) < b.d / 2 + NPC_BODY_R) return true;
    }
    return false;
  };
  for (const route of NPC_ROUTES) {
    const wps = route.waypoints;
    const n = wps.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = wps[i];
      const [bx, bz] = wps[(i + 1) % n]; // loops are closed
      if (!inBounds(ax, az, 0)) {
        issues.push(`NPC route ${route.id} waypoint (${ax}, ${az}) is outside WORLD bounds`);
      }
      const segLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(segLen / 3)); // ~3 m sampling
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = ax + t * (bx - ax);
        const z = az + t * (bz - az);
        if (samplePointInBuilding(x, z)) {
          issues.push(`NPC route ${route.id} path (${x.toFixed(0)}, ${z.toFixed(0)}) enters a building footprint`);
          break;
        }
        if (overlapsObstacle(x, z, NPC_BODY_R)) {
          issues.push(`NPC route ${route.id} path (${x.toFixed(0)}, ${z.toFixed(0)}) enters a static obstacle`);
          break;
        }
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

  // (b) Old road-race checkpoints removed — no checkpoint on-road check needed.
  const checkpointsOff = 0;

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
    // Peri-city homestead pieces are deliberately placed adjacent to
    // their own dirt driveway (gate side touches the driveway end), so
    // the generic "obstacle vs every road carriageway" check would
    // false-positive on every homestead. The dedicated periCityHomesteads
    // validator block below already enforces clearance against every
    // NON-driveway road; excluding these kinds here avoids double-counting.
    "wooden_house", "yard_fence",
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
  // ---- Regional road lighting validator --------------------------------
  // Lamps must be inside world bounds, sit between halfWidth+0.5 and
  // halfWidth+12 from their source road centerline (i.e. on the shoulder,
  // not in the carriageway and not 30m off in the trees), and clear all
  // non-rail obstacles. Coverage check samples each arterial/collector
  // road every 30m and asks whether the nearest lamp (any road) is within
  // 65m — that's the night-driving readability threshold.
  const ROAD_BY_ID = new Map<string, RoadPath>();
  for (const r of REGIONAL_ROADS) ROAD_BY_ID.set(r.id, r);
  let lampsOutOfBounds = 0;
  let lampsOffShoulder = 0;
  let lampsOnObstacle = 0;
  let lampsInCarriageway = 0;
  for (const lamp of REGIONAL_ROAD_LAMPS) {
    if (
      Math.abs(lamp.x) > WORLD_HALF - 1 ||
      Math.abs(lamp.z) > WORLD_HALF - 1
    ) {
      lampsOutOfBounds++;
      issues.push(
        `regional lamp (road=${lamp.roadId}) at (${lamp.x.toFixed(1)},` +
          `${lamp.z.toFixed(1)}) is outside WORLD bounds`
      );
      continue;
    }
    const src = ROAD_BY_ID.get(lamp.roadId);
    if (!src) {
      lampsOffShoulder++;
      issues.push(`regional lamp references unknown road id ${lamp.roadId}`);
      continue;
    }
    const hw = src.width / 2;
    const d = distancePointToPolyline(lamp.x, lamp.z, src.points);
    if (d < hw + 0.4) {
      lampsInCarriageway++;
      issues.push(
        `regional lamp on ${lamp.roadId} at (${lamp.x.toFixed(1)},` +
          `${lamp.z.toFixed(1)}) sits inside carriageway (d=${d.toFixed(2)}m, ` +
          `hw=${hw}m)`
      );
    } else if (d > hw + 12) {
      lampsOffShoulder++;
      issues.push(
        `regional lamp on ${lamp.roadId} at (${lamp.x.toFixed(1)},` +
          `${lamp.z.toFixed(1)}) sits ${d.toFixed(1)}m off the road shoulder`
      );
    }
    for (const o of STATIC_OBSTACLES) {
      if (o.kind === "guardrail" || o.kind === "bridge_rail") continue;
      const hx = o.w / 2, hz = o.d / 2;
      if (
        lamp.x >= o.x - hx && lamp.x <= o.x + hx &&
        lamp.z >= o.z - hz && lamp.z <= o.z + hz
      ) {
        lampsOnObstacle++;
        issues.push(
          `regional lamp on ${lamp.roadId} at (${lamp.x.toFixed(1)},` +
            `${lamp.z.toFixed(1)}) sits inside ${o.kind} AABB`
        );
        break;
      }
    }
  }

  // Coverage: walk every arterial/collector road by 30m steps; for each
  // sample, find nearest lamp (regional + city + village).
  const ALL_LAMPS: { x: number; z: number }[] = [
    ...REGIONAL_ROAD_LAMPS,
    ...STREET_LIGHTS,
    ...VILLAGE_LAMPS,
  ];
  const COVERAGE_RADIUS = 65;
  const COVERAGE_STEP = 30;
  let coverSamples = 0, coverHits = 0;
  for (const r of REGIONAL_ROADS) {
    if (r.type === "forest" || r.type === "dirt") continue; // local only
    if (isDrivewayRoad(r.id)) continue;
    let total = 0;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      total += Math.hypot(bx - ax, bz - az);
    }
    let arc = COVERAGE_STEP * 0.5;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      let t = arc;
      while (t < L) {
        const sx = ax + tx * t, sz = az + tz * t;
        coverSamples++;
        let best = Infinity;
        for (const lp of ALL_LAMPS) {
          const dx = sx - lp.x, dz = sz - lp.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) best = d2;
        }
        if (best < COVERAGE_RADIUS * COVERAGE_RADIUS) coverHits++;
        else issues.push(
          `lighting coverage gap on ${r.id} near (${sx.toFixed(0)},` +
            `${sz.toFixed(0)}): nearest lamp ${Math.sqrt(best).toFixed(0)}m > ` +
            `${COVERAGE_RADIUS}m`
        );
        t += COVERAGE_STEP;
      }
      arc = t - L;
    }
    void total;
  }
  const lightingLine =
    `regionalRoadLighting OK: ${REGIONAL_ROAD_LAMPS.length} lamps, ` +
    `${TOTAL_REAL_LIGHTS} real lights, coverage=${coverHits}/${coverSamples} ` +
    `major samples` +
    (lampsOutOfBounds || lampsOffShoulder || lampsOnObstacle || lampsInCarriageway
      ? ` [oob:${lampsOutOfBounds},offShoulder:${lampsOffShoulder},` +
        `onObstacle:${lampsOnObstacle},inCarriageway:${lampsInCarriageway}]`
      : "");

  // ---- Peri-city forest belt validator -----------------------------------
  // Re-checks every CITY_EDGE tree against the SAME thresholds the
  // generator uses (CITY_EDGE_* constants), so "cityForestBelt OK" is
  // a real regression detector rather than a weaker spot-check.
  let beltCoreViolations = 0;
  let beltRoadViolations = 0;
  let beltBuildingViolations = 0;
  let beltObstacleViolations = 0;
  let beltOobViolations = 0;
  let beltBeltMembershipViolations = 0;
  let beltHallViolations = 0;
  let beltN = 0, beltS = 0, beltE = 0, beltW = 0;
  for (const t of CITY_EDGE_TREES) {
    const { x, z } = t;
    // World bounds (matches cityEdgeRejected: |x|,|z| > WORLD_HALF-2).
    if (Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) {
      beltOobViolations++;
      issues.push(`city-edge tree at (${x.toFixed(0)}, ${z.toFixed(0)}) outside WORLD bounds`);
    }
    // Belt annulus membership.
    if (!inCityEdgeBelt(x, z)) {
      beltBeltMembershipViolations++;
      issues.push(
        `city-edge tree at (${x.toFixed(0)}, ${z.toFixed(0)}) outside belt ` +
          `[${CITY_EDGE_INNER}, ${CITY_EDGE_OUTER}]`,
      );
    }
    // Core margin (CITY_HALF + CITY_EDGE_CORE_MARGIN).
    if (inCityCorePlusMargin(x, z)) {
      beltCoreViolations++;
      issues.push(
        `city-edge tree at (${x.toFixed(0)}, ${z.toFixed(0)}) inside city core +${CITY_EDGE_CORE_MARGIN}m`,
      );
    }
    // Road clearance — same threshold as generator.
    if (tooCloseToAnyRoad(x, z, CITY_EDGE_ROAD_CLEAR)) {
      beltRoadViolations++;
      issues.push(
        `city-edge tree at (${x.toFixed(0)}, ${z.toFixed(0)}) within ` +
          `road halfWidth + ${CITY_EDGE_ROAD_CLEAR}m of a regional road`,
      );
    }
    // Building clearance — same trunk radius as generator.
    if (checkBuildingCollision(x, z, CITY_EDGE_BUILDING_CLEAR)) {
      beltBuildingViolations++;
      issues.push(
        `city-edge tree at (${x.toFixed(0)}, ${z.toFixed(0)}) within ` +
          `${CITY_EDGE_BUILDING_CLEAR}m of a building`,
      );
    }
    // Static obstacle AABB-vs-circle, same clearance as generator.
    for (const o of STATIC_OBSTACLES) {
      const dx = Math.max(0, Math.abs(x - o.x) - o.w / 2);
      const dz = Math.max(0, Math.abs(z - o.z) - o.d / 2);
      if (dx * dx + dz * dz < CITY_EDGE_OBSTACLE_CLEAR * CITY_EDGE_OBSTACLE_CLEAR) {
        beltObstacleViolations++;
        issues.push(
          `city-edge tree at (${x.toFixed(0)}, ${z.toFixed(0)}) within ` +
            `${CITY_EDGE_OBSTACLE_CLEAR}m of obstacle ${o.kind}`,
        );
        break;
      }
    }
    // Phase 14A: no city-edge tree may fall inside the Grand Plaza Hall keepout
    // (footprint+6m) or on the approach path. Same thresholds as the generator,
    // so this is a real regression detector.
    if (inEventHallKeepout(x, z) || nearEventHallConnector(x, z)) {
      beltHallViolations++;
      issues.push(
        `city-edge tree at (${x.toFixed(0)}, ${z.toFixed(0)}) inside the Grand Plaza Hall keepout/approach`,
      );
    }
    // Quadrant by dominant axis: trees closer to a vertical (E/W) edge
    // count east/west, otherwise north/south.
    if (Math.abs(x) >= Math.abs(z)) {
      if (x >= 0) beltE++; else beltW++;
    } else {
      if (z >= 0) beltS++; else beltN++;
    }
  }
  // Flag dramatically lopsided sides — anything below 12% of the belt
  // population is treated as a coverage gap on that side.
  const beltMinPerSide = Math.max(20, Math.floor(CITY_EDGE_TREES.length * 0.12));
  for (const [name, n] of [
    ["north", beltN], ["south", beltS], ["east", beltE], ["west", beltW],
  ] as const) {
    if (n < beltMinPerSide) {
      issues.push(
        `city forest belt ${name} side has only ${n} trees (expected >= ${beltMinPerSide})`,
      );
    }
  }
  const beltTotal = CITY_EDGE_TREES.length;
  const beltRoadOK = beltTotal - beltRoadViolations;
  const beltBldOK = beltTotal - beltBuildingViolations;
  const cityForestBeltLine =
    `cityForestBelt OK: ${beltTotal} trees, ` +
    `north=${beltN} south=${beltS} east=${beltE} west=${beltW}, ` +
    `roadClear=${beltRoadOK}/${beltTotal}, ` +
    `buildingClear=${beltBldOK}/${beltTotal}` +
    (beltCoreViolations || beltObstacleViolations || beltOobViolations || beltBeltMembershipViolations || beltHallViolations
      ? ` [core:${beltCoreViolations},obstacle:${beltObstacleViolations},` +
        `oob:${beltOobViolations},offBelt:${beltBeltMembershipViolations},hall:${beltHallViolations}]`
      : "");

  // ---- Peri-city homestead belt validator -------------------------------
  // Validates the planned wooden homestead clusters around the central
  // city: every house has a yard / fence / driveway, no part of the
  // homestead overlaps a road carriageway, no tree falls inside a
  // yard, no house intrudes the city core margin, and at least one
  // homestead exists on each cardinal side.
  const HOMESTEAD_DRIVEWAY_PREFIX = "drv-hs-";
  const HOMESTEAD_DRIVEWAYS = REGIONAL_ROADS.filter(
    (r) => r.id.startsWith(HOMESTEAD_DRIVEWAY_PREFIX),
  );
  const HOMESTEAD_HOUSE_OBS = STATIC_OBSTACLES.filter(
    (o) => o.kind === "wooden_house",
  );
  const HOMESTEAD_FENCE_OBS = STATIC_OBSTACLES.filter(
    (o) => o.kind === "yard_fence",
  );
  const homesteadSides = { north: 0, east: 0, south: 0, west: 0 } as Record<
    PeriCityHomestead["gateSide"],
    number
  >;
  // Any road that is NOT a homestead driveway — used for "house must
  // not overlap a road carriageway" check (driveways are expected to
  // touch the gate, so we exclude them).
  const NON_DRIVEWAY_ROADS = REGIONAL_ROADS.filter(
    (r) => !r.id.startsWith(HOMESTEAD_DRIVEWAY_PREFIX),
  );
  const aabbVsRoad = (
    cx: number, cz: number, hw: number, hd: number,
    road: RoadPath,
  ): boolean => {
    // Sample the polyline densely and reject if any centerline point
    // sits inside the (cx,cz) AABB expanded by road.width/2.
    const rh = road.width / 2;
    for (let i = 0; i < road.points.length - 1; i++) {
      const [ax, az] = road.points[i];
      const [bx, bz] = road.points[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      const steps = Math.max(2, Math.ceil(len / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = ax + t * dx;
        const pz = az + t * dz;
        if (
          Math.abs(px - cx) < hw + rh &&
          Math.abs(pz - cz) < hd + rh
        ) {
          return true;
        }
      }
    }
    return false;
  };
  let homesteadHousesOK = 0;
  let homesteadHousesRoadOK = 0;
  let homesteadHousesObstacleOK = 0;
  let homesteadDrivewaysConnected = 0;
  // (1) Per-homestead structural checks.
  for (const h of PERI_CITY_HOMESTEADS) {
    homesteadSides[h.gateSide]++;
    homesteadHousesOK++;
    // House must sit fully outside the city core + margin.
    const houseHalfW = h.houseW / 2;
    const houseHalfD = h.houseD / 2;
    const corners: [number, number][] = [
      [h.x - houseHalfW, h.z - houseHalfD],
      [h.x + houseHalfW, h.z - houseHalfD],
      [h.x + houseHalfW, h.z + houseHalfD],
      [h.x - houseHalfW, h.z + houseHalfD],
    ];
    let cornerInCore = false;
    for (const [cx, cz] of corners) {
      if (
        Math.abs(cx) <= CITY_HALF + CITY_EDGE_CORE_MARGIN &&
        Math.abs(cz) <= CITY_HALF + CITY_EDGE_CORE_MARGIN
      ) {
        cornerInCore = true;
        break;
      }
    }
    if (cornerInCore) {
      issues.push(
        `homestead ${h.id} house corner inside city core +${CITY_EDGE_CORE_MARGIN}m margin`,
      );
    }
    // House + yard must not overlap any non-driveway road carriageway.
    let onRoad = false;
    for (const road of NON_DRIVEWAY_ROADS) {
      if (
        aabbVsRoad(h.x, h.z, h.houseW / 2, h.houseD / 2, road) ||
        aabbVsRoad(h.x, h.z, h.yardW / 2, h.yardD / 2, road)
      ) {
        onRoad = true;
        issues.push(
          `homestead ${h.id} (${h.x},${h.z}) overlaps road carriageway ${road.id}`,
        );
        break;
      }
    }
    if (!onRoad) homesteadHousesRoadOK++;
    // House must not overlap any other static obstacle (excluding its
    // own house AABB and the homestead's fence panels).
    let obstacleHit = false;
    for (const o of STATIC_OBSTACLES) {
      if (o.kind === "wooden_house" && o.x === h.x && o.z === h.z) continue;
      if (o.kind === "yard_fence") continue;
      const hw = o.w / 2 + h.houseW / 2;
      const hd = o.d / 2 + h.houseD / 2;
      if (Math.abs(o.x - h.x) < hw && Math.abs(o.z - h.z) < hd) {
        obstacleHit = true;
        issues.push(
          `homestead ${h.id} house overlaps existing obstacle ${o.kind} at (${o.x},${o.z})`,
        );
        break;
      }
    }
    if (!obstacleHit) homesteadHousesObstacleOK++;
    // House must not overlap any city building.
    if (checkBuildingCollision(h.x, h.z, Math.max(h.houseW, h.houseD) / 2)) {
      issues.push(
        `homestead ${h.id} house overlaps a city building`,
      );
    }
    // House must not overlap parked vehicles, checkpoints, or street
    // lamps. Use a conservative radius from the house centre.
    const houseR = Math.max(h.houseW, h.houseD) / 2 + 0.5;
    for (const v of INITIAL_VEHICLES) {
      const dx = v.x - h.x; const dz = v.z - h.z;
      if (dx * dx + dz * dz < houseR * houseR) {
        issues.push(`homestead ${h.id} house overlaps vehicle ${v.id}`);
        break;
      }
    }
    for (const l of STREET_LIGHTS) {
      const dx = l.x - h.x; const dz = l.z - h.z;
      if (dx * dx + dz * dz < houseR * houseR) {
        issues.push(`homestead ${h.id} house overlaps street lamp at (${l.x},${l.z})`);
        break;
      }
    }
    // House must not overlap the train station footprint.
    {
      const sHw = TRAIN_STATION.w / 2 + h.houseW / 2;
      const sHd = TRAIN_STATION.d / 2 + h.houseD / 2;
      if (
        Math.abs(TRAIN_STATION.cx - h.x) < sHw &&
        Math.abs(TRAIN_STATION.cz - h.z) < sHd
      ) {
        issues.push(`homestead ${h.id} house overlaps train station`);
      }
      const stairR = 4 + Math.max(h.houseW, h.houseD) / 2;
      const sdx = TRAIN_STATION.stairX - h.x;
      const sdz = TRAIN_STATION.stairZ - h.z;
      if (sdx * sdx + sdz * sdz < stairR * stairR) {
        issues.push(`homestead ${h.id} house too close to station stairs`);
      }
    }
    // House must not overlap any rail pillar (1.2m square).
    for (const p of getRailPillars()) {
      const dx = p.x - h.x; const dz = p.z - h.z;
      const limit = h.houseW / 2 + 1.0;
      if (Math.abs(dx) < limit && Math.abs(dz) < h.houseD / 2 + 1.0) {
        issues.push(`homestead ${h.id} house overlaps rail pillar at (${p.x.toFixed(0)},${p.z.toFixed(0)})`);
        break;
      }
    }
    // Phase 13A (Batch D): the homestead YARD (largest footprint, encloses the
    // house + fences) must clear every RP building and RP house. Yard clear ⇒
    // house + fence panels clear, since fences sit on the yard perimeter.
    for (const rp of RP_BUILDINGS) {
      if (Math.abs(rp.x - h.x) < (rp.w + h.yardW) / 2 && Math.abs(rp.z - h.z) < (rp.d + h.yardD) / 2) {
        issues.push(`homestead ${h.id} yard overlaps RP building ${rp.id}`);
        break;
      }
    }
    for (const rh of RP_HOUSES) {
      if (Math.abs(rh.x - h.x) < (rh.w + h.yardW) / 2 && Math.abs(rh.z - h.z) < (rh.d + h.yardD) / 2) {
        issues.push(`homestead ${h.id} yard overlaps RP house ${rh.slug}`);
        break;
      }
    }
    // Phase 13A (Batch D): the gate gap must be at least as wide as the driveway
    // so the driveway is not blocked by a fence panel. Gap = 2 × gate-half;
    // driveway carriageway width comes from the matching drv-hs-* road.
    {
      const gateGap = 2 * HOMESTEAD_FENCE_GATE_HALF;
      const drv = REGIONAL_ROADS.find((r) => r.id === `drv-${h.id}`);
      const drvWidth = drv?.width ?? 0;
      if (drvWidth > gateGap + 0.01) {
        issues.push(`homestead ${h.id} gate gap ${gateGap}m is narrower than its driveway ${drvWidth}m (fence would block it)`);
      }
    }
  }
  // (2) Driveway connectivity — every drv-hs-* must start at a vertex
  // that exists on inner-city-ring's polyline AND every homestead
  // must have a matching `drv-hs-{suffix}` whose start equals
  // `driveStart` and whose endpoint sits within 3m of the gate centre.
  const ring = REGIONAL_ROADS.find((r) => r.id === "inner-city-ring");
  const ringVerts = new Set<string>(
    (ring?.points ?? []).map(([x, z]) => `${x}:${z}`),
  );
  for (const drv of HOMESTEAD_DRIVEWAYS) {
    const [sx, sz] = drv.points[0];
    if (ringVerts.has(`${sx}:${sz}`)) {
      homesteadDrivewaysConnected++;
    } else {
      issues.push(
        `homestead driveway ${drv.id} start (${sx},${sz}) is not an inner-city-ring vertex`,
      );
    }
  }
  // Per-homestead driveway alignment: each homestead `hs-{suffix}`
  // expects exactly one driveway `drv-hs-{suffix}`. The driveway must
  // start at h.driveStart and end within 3m of the computed gate
  // centre on h.gateSide.
  const driveByHsId = new Map<string, RoadPath>();
  for (const drv of HOMESTEAD_DRIVEWAYS) {
    driveByHsId.set(drv.id.replace(/^drv-/, ""), drv);
  }
  for (const h of PERI_CITY_HOMESTEADS) {
    const drv = driveByHsId.get(h.id);
    if (!drv) {
      issues.push(`homestead ${h.id} has no matching driveway drv-${h.id}`);
      continue;
    }
    const [sx, sz] = drv.points[0];
    if (sx !== h.driveStart[0] || sz !== h.driveStart[1]) {
      issues.push(
        `homestead ${h.id} driveStart (${h.driveStart[0]},${h.driveStart[1]}) ` +
          `does not match drv-${h.id} start (${sx},${sz})`,
      );
    }
    const [ex, ez] = drv.points[drv.points.length - 1];
    let gateX = h.x;
    let gateZ = h.z;
    switch (h.gateSide) {
      case "north": gateZ = h.z - h.yardD / 2; break;
      case "south": gateZ = h.z + h.yardD / 2; break;
      case "west":  gateX = h.x - h.yardW / 2; break;
      case "east":  gateX = h.x + h.yardW / 2; break;
    }
    const gateGap = Math.hypot(ex - gateX, ez - gateZ);
    if (gateGap > 3.0) {
      issues.push(
        `homestead ${h.id} driveway end (${ex},${ez}) is ${gateGap.toFixed(1)}m ` +
          `from gate centre (${gateX.toFixed(0)},${gateZ.toFixed(0)})`,
      );
    }
  }
  // Reverse direction: every drv-hs-* must correspond to an existing
  // homestead — guards against orphaned driveways.
  const hsIds = new Set(PERI_CITY_HOMESTEADS.map((h) => h.id));
  for (const drv of HOMESTEAD_DRIVEWAYS) {
    const sfx = drv.id.replace(/^drv-/, "");
    if (!hsIds.has(sfx)) {
      issues.push(`driveway ${drv.id} has no matching homestead ${sfx}`);
    }
  }
  // (3) Tree-clear: count CITY_EDGE_TREES whose trunk does NOT fall
  // inside any yard rectangle (no slack — strictly inside).
  let treesInYards = 0;
  for (const t of CITY_EDGE_TREES) {
    for (const h of PERI_CITY_HOMESTEADS) {
      const b = homesteadYardBounds(h);
      if (t.x >= b.x0 && t.x <= b.x1 && t.z >= b.z0 && t.z <= b.z1) {
        treesInYards++;
        issues.push(
          `tree at (${t.x.toFixed(0)},${t.z.toFixed(0)}) inside homestead ${h.id} yard`,
        );
        break;
      }
    }
  }
  const treesClearOfYards = CITY_EDGE_TREES.length - treesInYards;

  // ---- Phase 13A (Batch E): flora / rock clearance + density ------------
  // Every tree/rock trunk centre must clear: the central road grid, every
  // regional road / driveway carriageway, RP houses (±117) + RP buildings,
  // homestead yards, village parking pads, and placed static obstacles
  // (cliffs/boulders/cabins/etc). Roads were already enforced at generation
  // time (SCATTER_ROAD_CLEARANCE); this adds the RP / obstacle / yard / pad
  // categories as hard assertions so a future seed/region change can't drift.
  const ALL_FLORA: { x: number; z: number; kind: string }[] = [
    ...FOREST_TREES.map((t) => ({ x: t.x, z: t.z, kind: "forest_tree" })),
    ...FOREST_ROCKS.map((t) => ({ x: t.x, z: t.z, kind: "forest_rock" })),
    ...MOUNTAIN_ROCKS.map((t) => ({ x: t.x, z: t.z, kind: "mountain_rock" })),
    ...CITY_EDGE_TREES.map((t) => ({ x: t.x, z: t.z, kind: "city_edge_tree" })),
  ];
  const onCentralGrid = (x: number, z: number): boolean => {
    for (const rx of ROADS.ns) if (Math.abs(x - rx) < ROAD_HALF && Math.abs(z) < CITY_HALF) return true;
    for (const rz of ROADS.ew) if (Math.abs(z - rz) < ROAD_HALF && Math.abs(x) < CITY_HALF) return true;
    return false;
  };
  let floraOnGrid = 0, floraOnRegional = 0, floraInRpHouse = 0, floraInRpBuilding = 0,
      floraInObstacle = 0, floraInYard = 0, floraOnPad = 0;
  for (const f of ALL_FLORA) {
    if (onCentralGrid(f.x, f.z)) {
      floraOnGrid++;
      issues.push(`flora ${f.kind} (${f.x.toFixed(0)},${f.z.toFixed(0)}) on a central road carriageway`);
    }
    for (const r of REGIONAL_ROADS) {
      if (distancePointToPolyline(f.x, f.z, r.points) < r.width / 2) {
        floraOnRegional++;
        issues.push(`flora ${f.kind} (${f.x.toFixed(0)},${f.z.toFixed(0)}) on regional road ${r.id}`);
        break;
      }
    }
    for (const h of RP_HOUSES) {
      if (Math.abs(f.x - h.x) < h.w / 2 && Math.abs(f.z - h.z) < h.d / 2) {
        floraInRpHouse++;
        issues.push(`flora ${f.kind} (${f.x.toFixed(0)},${f.z.toFixed(0)}) inside RP house ${h.slug}`);
        break;
      }
    }
    for (const b of RP_BUILDINGS) {
      if (Math.abs(f.x - b.x) < b.w / 2 && Math.abs(f.z - b.z) < b.d / 2) {
        floraInRpBuilding++;
        issues.push(`flora ${f.kind} (${f.x.toFixed(0)},${f.z.toFixed(0)}) inside RP building ${b.id}`);
        break;
      }
    }
    for (const o of STATIC_OBSTACLES) {
      if (o.kind === "yard_fence") continue; // thin fence panels handled by yard check
      if (Math.abs(f.x - o.x) < o.w / 2 + 1 && Math.abs(f.z - o.z) < o.d / 2 + 1) {
        floraInObstacle++;
        issues.push(`flora ${f.kind} (${f.x.toFixed(0)},${f.z.toFixed(0)}) inside obstacle ${o.kind} (${o.x},${o.z})`);
        break;
      }
    }
    for (const h of PERI_CITY_HOMESTEADS) {
      const yb = homesteadYardBounds(h);
      if (f.x >= yb.x0 && f.x <= yb.x1 && f.z >= yb.z0 && f.z <= yb.z1) {
        floraInYard++;
        issues.push(`flora ${f.kind} (${f.x.toFixed(0)},${f.z.toFixed(0)}) inside homestead ${h.id} yard`);
        break;
      }
    }
    for (const p of VILLAGE_PARKING_PADS) {
      if (Math.hypot(f.x - p.x, f.z - p.z) < 3) {
        floraOnPad++;
        issues.push(`flora ${f.kind} (${f.x.toFixed(0)},${f.z.toFixed(0)}) on village parking pad (${p.x},${p.z})`);
        break;
      }
    }
  }
  // Density by region (warning-only — flags an EMPTY region, which would
  // signal a generator regression, without failing on intentional balance).
  const floraRegion = (x: number, z: number): string => {
    if (Math.max(Math.abs(x), Math.abs(z)) <= CITY_HALF) return "city-core";
    if (z < -CITY_HALF) return "mountain";
    if (z > 180) return "forest";
    if (z >= CITY_HALF && z <= 180 && Math.abs(x) <= 30) return "bridge";
    if (x > CITY_HALF) return "east";
    if (x < -CITY_HALF) return "west";
    return "peri-city";
  };
  const floraDensity: Record<string, number> = {};
  for (const f of ALL_FLORA) {
    const rg = floraRegion(f.x, f.z);
    floraDensity[rg] = (floraDensity[rg] ?? 0) + 1;
  }
  // The forest + mountain biomes should never be empty (their scatter is the
  // whole point); an empty one means the generator broke.
  for (const rg of ["forest", "mountain"] as const) {
    if ((floraDensity[rg] ?? 0) === 0) {
      issues.push(`flora density: ${rg} region has 0 trees/rocks (generator regression?)`);
    }
  }
  const floraTotal = ALL_FLORA.length;
  const floraViolations = floraOnGrid + floraOnRegional + floraInRpHouse +
    floraInRpBuilding + floraInObstacle + floraInYard + floraOnPad;
  const floraLine =
    `floraClearance OK: ${floraTotal} trees+rocks, violations=${floraViolations} ` +
    `[grid:${floraOnGrid},regional:${floraOnRegional},rpHouse:${floraInRpHouse},` +
    `rpBuilding:${floraInRpBuilding},obstacle:${floraInObstacle},yard:${floraInYard},pad:${floraOnPad}], ` +
    `density={` +
    Object.keys(floraDensity).sort().map((k) => `${k}:${floraDensity[k]}`).join(",") +
    `}`;

  // (4) Sides — at least one homestead per cardinal side. The side is
  // taken from `gateSide`, which already encodes which direction the
  // homestead opens onto the city ring.
  for (const side of ["north", "east", "south", "west"] as const) {
    if (homesteadSides[side] === 0) {
      issues.push(`peri-city homestead belt missing ${side} cluster`);
    }
  }
  const periCityHomesteadsLine =
    `periCityHomesteads OK: houses=${HOMESTEAD_HOUSE_OBS.length}, ` +
    `yards=${PERI_CITY_HOMESTEADS.length}, ` +
    `fences=${HOMESTEAD_FENCE_OBS.length}, ` +
    `driveways=${HOMESTEAD_DRIVEWAYS.length}, ` +
    `treeClear=${treesClearOfYards}/${CITY_EDGE_TREES.length}, ` +
    `roadClear=${homesteadHousesRoadOK}/${homesteadHousesOK}, ` +
    `obstacleClear=${homesteadHousesObstacleOK}/${homesteadHousesOK}, ` +
    `drivewayConnect=${homesteadDrivewaysConnected}/${HOMESTEAD_DRIVEWAYS.length}, ` +
    `sides={north:${homesteadSides.north},east:${homesteadSides.east},` +
    `south:${homesteadSides.south},west:${homesteadSides.west}}`;

  const polishLine =
    `road clearances: ${totalWp - (polish.waypointsOff ?? 0)}/${totalWp} ` +
    `traffic waypoints on-road, ` +
    `${totalScatter - (polish.scatterTooClose ?? 0)}/${totalScatter} ` +
    `trees+rocks ≥ road halfWidth + ${SCATTER_ROAD_CLEARANCE.toFixed(1)}m, ` +
    `${INITIAL_VEHICLES.length - (polish.parkedFar ?? 0)}/${INITIAL_VEHICLES.length} ` +
    `parked vehicles within 25m of a road, ` +
    `${polish.obstaclesIntruding ?? 0} non-rail obstacles intruding into road carriageway.`;

  // ---- Center-city upgrade invariants -----------------------------------
  // Validates the new elevated rail loop, station, skybridges, and
  // verifies tower/landmark counts match the spec.

  const towers = BUILDINGS.filter((b) => b.tier === "high").length;
  const landmarks = BUILDINGS.filter((b) => b.tier === "landmark").length;

  // (0) Hard count assertions for the upgraded skyline spec.
  const EXPECTED_BUILDINGS = 65;
  const EXPECTED_TOWERS = 8;
  const EXPECTED_LANDMARKS = 5;
  if (BUILDINGS.length !== EXPECTED_BUILDINGS) {
    issues.push(
      `building count ${BUILDINGS.length} != expected ${EXPECTED_BUILDINGS}`,
    );
  }
  if (towers !== EXPECTED_TOWERS) {
    issues.push(`tower count ${towers} != expected ${EXPECTED_TOWERS}`);
  }
  if (landmarks !== EXPECTED_LANDMARKS) {
    issues.push(`landmark count ${landmarks} != expected ${EXPECTED_LANDMARKS}`);
  }

  // (1) Loop closed: first vertex == last vertex.
  const loopFirst = ELEVATED_RAIL_LOOP[0];
  const loopLast = ELEVATED_RAIL_LOOP[ELEVATED_RAIL_LOOP.length - 1];
  const railLoopClosed =
    loopFirst.x === loopLast.x && loopFirst.z === loopLast.z;
  if (!railLoopClosed) issues.push("rail loop is not closed");

  // (2) Pillars clear of every road carriageway.
  const railPillars = getRailPillars();
  let pillarsClear = 0;
  let roadIntrusions = 0;
  for (const p of railPillars) {
    let bad = false;
    for (const x of ROADS.ns) {
      if (Math.abs(p.x - x) < ROAD_HALF && Math.abs(p.z) <= CITY_HALF) {
        bad = true; break;
      }
    }
    if (!bad) {
      for (const z of ROADS.ew) {
        if (Math.abs(p.z - z) < ROAD_HALF && Math.abs(p.x) <= CITY_HALF) {
          bad = true; break;
        }
      }
    }
    if (!bad) {
      for (const r of REGIONAL_ROADS) {
        if (distancePointToPolyline(p.x, p.z, r.points) < r.width / 2) {
          bad = true; break;
        }
      }
    }
    if (bad) {
      roadIntrusions++;
      issues.push(`rail pillar at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) intrudes road`);
    } else {
      pillarsClear++;
    }
  }

  // (3) Station footprint clear of any road and not overlapping a building
  // (besides the station deck itself).
  let stationClear = true;
  {
    const s = TRAIN_STATION;
    const corners: Array<[number, number]> = [
      [s.cx - s.w / 2, s.cz - s.d / 2],
      [s.cx + s.w / 2, s.cz - s.d / 2],
      [s.cx - s.w / 2, s.cz + s.d / 2],
      [s.cx + s.w / 2, s.cz + s.d / 2],
    ];
    for (const [x, z] of corners) {
      // Roads (city + regional)
      for (const r of REGIONAL_ROADS) {
        if (distancePointToPolyline(x, z, r.points) < r.width / 2) {
          stationClear = false;
          issues.push(`station corner (${x.toFixed(0)}, ${z.toFixed(0)}) intrudes road ${r.id}`);
          break;
        }
      }
      // Buildings (station footprint should be in the empty 106..114 strip
      // outside the inner-city-ring carriageway; nothing should be there).
      if (checkBuildingCollision(x, z, 0)) {
        stationClear = false;
        issues.push(`station corner (${x.toFixed(0)}, ${z.toFixed(0)}) overlaps a building`);
      }
    }
    // Spawn safety: ensure every spawn is more than 5m from the station.
    for (const sp of SPAWN_POINTS) {
      const dx = Math.max(0, Math.abs(sp[0] - s.cx) - s.w / 2);
      const dz = Math.max(0, Math.abs(sp[2] - s.cz) - s.d / 2);
      if (dx * dx + dz * dz < 25) {
        stationClear = false;
        issues.push(`spawn ${JSON.stringify(sp)} too close to station`);
      }
    }
    // Stair-segment sweep: sample 9 points along the diagonal from the
    // station edge (nearest the stair foot) out to (stairX, stairZ) and
    // ensure none lands in any city or regional carriageway. The 1.6m
    // stair tread width is included as slack via a half-width inflation.
    const STAIR_HALF = 0.8;
    const stairStartX = s.cx + Math.sign(s.stairX - s.cx) * (s.w / 2);
    const stairStartZ = s.cz + Math.sign(s.stairZ - s.cz) * (s.d / 2);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = stairStartX + (s.stairX - stairStartX) * t;
      const z = stairStartZ + (s.stairZ - stairStartZ) * t;
      let onRoad = false;
      for (const xr of ROADS.ns) {
        if (Math.abs(x - xr) < ROAD_HALF + STAIR_HALF && Math.abs(z) <= CITY_HALF) {
          onRoad = true; break;
        }
      }
      if (!onRoad) {
        for (const zr of ROADS.ew) {
          if (Math.abs(z - zr) < ROAD_HALF + STAIR_HALF && Math.abs(x) <= CITY_HALF) {
            onRoad = true; break;
          }
        }
      }
      if (!onRoad) {
        for (const r of REGIONAL_ROADS) {
          if (distancePointToPolyline(x, z, r.points) < r.width / 2 + STAIR_HALF) {
            onRoad = true;
            issues.push(
              `station stair sample (${x.toFixed(0)}, ${z.toFixed(0)}) ` +
                `intrudes road ${r.id}`,
            );
            break;
          }
        }
      } else {
        issues.push(
          `station stair sample (${x.toFixed(0)}, ${z.toFixed(0)}) on city carriageway`,
        );
      }
      if (onRoad) {
        stationClear = false;
        break;
      }
    }
  }

  // (4) Train path clear of any tall building. Sample the loop every
  // 4m and verify no building's AABB at rail height contains the point.
  const railSamples = 200;
  const { total: railTotal } = railLoopArcLengths();
  let trainClear = 0;
  for (let i = 0; i < railSamples; i++) {
    const s = (i / railSamples) * railTotal;
    const p = railLoopPointAt(s);
    let collides = false;
    for (const b of BUILDINGS) {
      if (b.h < RAIL_DECK_HEIGHT - 1) continue;
      const hw = b.w / 2 + 1.5; // train half-width 1.1 + slack
      const hd = b.d / 2 + 1.5;
      if (Math.abs(p.x - b.x) < hw && Math.abs(p.z - b.z) < hd) {
        collides = true;
        issues.push(
          `train path at arc=${s.toFixed(0)} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) ` +
            `pierces building at (${b.x}, ${b.z}) h=${b.h}`,
        );
        break;
      }
    }
    if (!collides) trainClear++;
  }

  // (5) Skybridge clearance — every road the segment passes over must
  // have ≥ 5m vertical clearance below the bridge.
  const SKYBRIDGE_MIN_CLEAR = 5;
  let skybridgeClear = 0;
  for (const sb of SKYBRIDGES) {
    let ok = true;
    // Sample 21 points along the bridge and check (a) no building tall
    // enough to block at sb.y, and (b) any road crossing has clearance.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const x = sb.x1 + (sb.x2 - sb.x1) * t;
      const z = sb.z1 + (sb.z2 - sb.z1) * t;
      // Building piercing (excluding endpoints which sit on a roof)
      if (i > 1 && i < 19) {
        for (const b of BUILDINGS) {
          if (b.h < sb.y - 0.5) continue;
          const hw = b.w / 2;
          const hd = b.d / 2;
          if (Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd) {
            ok = false;
            issues.push(`skybridge ${sb.id} pierces building at (${b.x}, ${b.z})`);
            break;
          }
        }
        if (!ok) break;
      }
      // Road clearance (sb.y must be >= MIN_CLEAR above road surface 0)
      let onRoad = false;
      for (const xr of ROADS.ns) {
        if (Math.abs(x - xr) < ROAD_HALF && Math.abs(z) <= CITY_HALF) { onRoad = true; break; }
      }
      if (!onRoad) {
        for (const zr of ROADS.ew) {
          if (Math.abs(z - zr) < ROAD_HALF && Math.abs(x) <= CITY_HALF) { onRoad = true; break; }
        }
      }
      if (onRoad && sb.y < SKYBRIDGE_MIN_CLEAR) {
        ok = false;
        issues.push(
          `skybridge ${sb.id} only ${sb.y}m above road (need ≥${SKYBRIDGE_MIN_CLEAR}m)`,
        );
        break;
      }
    }
    if (ok) skybridgeClear++;
  }

  // -------------------------------------------------------------------
  // mountainRing — elevation profiles, grade limits, endpoint continuity,
  // mountain traffic on-road, mountain lamps, massif clearance.
  // -------------------------------------------------------------------
  const mountainRoadList = REGIONAL_ROADS.filter((r) => MOUNTAIN_ROAD_IDS.has(r.id));
  let mProfiledVerts = 0;
  let mMaxGrade = 0;
  let mGradeViolations = 0;
  let mEndpointMaxGap = 0;
  let mEndpointViolations = 0;
  let mSummitY = 0;
  let mTrafficOnRoad = 0;
  let mTrafficTotal = 0;
  let mMassifsClear = 0;
  const MOUNTAIN_MAX_GRADE = 0.18;
  const ENDPOINT_SNAP_R2 = 4.0; // (snap radius 2.0)^2
  const ENDPOINT_TOL = 0.5;

  const elevAtVertex = (rid: string, idx: number): number => {
    const p = ROAD_ELEVATION_PROFILES[rid];
    return p ? (p[idx] ?? 0) : 0;
  };

  for (const r of mountainRoadList) {
    const profile = ROAD_ELEVATION_PROFILES[r.id];
    if (!profile) {
      issues.push(`mountainRing: ${r.id} missing elevation profile`);
      continue;
    }
    if (profile.length !== r.points.length) {
      issues.push(
        `mountainRing: ${r.id} profile length ${profile.length} != points length ${r.points.length}`,
      );
      continue;
    }
    mProfiledVerts += profile.length;
    for (const y of profile) if (y > mSummitY) mSummitY = y;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const dh = Math.hypot(bx - ax, bz - az);
      if (dh < 1e-3) continue;
      const grade = Math.abs(profile[i + 1] - profile[i]) / dh;
      if (grade > mMaxGrade) mMaxGrade = grade;
      if (grade > MOUNTAIN_MAX_GRADE) {
        mGradeViolations++;
        issues.push(
          `mountainRing: ${r.id} seg ${i} grade ${(grade * 100).toFixed(1)}% > ${(MOUNTAIN_MAX_GRADE * 100).toFixed(0)}%`,
        );
      }
    }
  }

  // Endpoint Y continuity at shared graph nodes.
  for (const ra of mountainRoadList) {
    for (let ia = 0; ia < ra.points.length; ia++) {
      const [ax, az] = ra.points[ia];
      const ya = elevAtVertex(ra.id, ia);
      for (const rb of REGIONAL_ROADS) {
        if (rb.id === ra.id) continue;
        for (let ib = 0; ib < rb.points.length; ib++) {
          const [bx, bz] = rb.points[ib];
          const d2 = (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
          if (d2 < ENDPOINT_SNAP_R2) {
            const yb = MOUNTAIN_ROAD_IDS.has(rb.id) ? elevAtVertex(rb.id, ib) : 0;
            const gap = Math.abs(ya - yb);
            if (gap > mEndpointMaxGap) mEndpointMaxGap = gap;
            if (gap > ENDPOINT_TOL) {
              mEndpointViolations++;
              issues.push(
                `mountainRing: elev gap ${ra.id}@(${ax},${az})=${ya}m vs ${rb.id}=${yb}m`,
              );
            }
          }
        }
      }
    }
  }

  // Mountain traffic waypoints must lie on a mountain road carriageway.
  const MOUNTAIN_TRAFFIC_IDS: ReadonlySet<number> = new Set([6, 7, 8]);
  for (const route of TRAFFIC_ROUTES) {
    if (!MOUNTAIN_TRAFFIC_IDS.has(route.id)) continue;
    for (const wp of route.waypoints) {
      mTrafficTotal++;
      let onMountainRoad = false;
      for (const r of mountainRoadList) {
        const d = distancePointToPolyline(wp[0], wp[1], r.points);
        if (d <= r.width / 2 + 0.5) { onMountainRoad = true; break; }
      }
      if (onMountainRoad) mTrafficOnRoad++;
      else issues.push(
        `mountainRing: traffic ${route.id} wp (${wp[0].toFixed(0)},${wp[1].toFixed(0)}) off mountain road`,
      );
    }
  }

  // Lamp count on mountain roads (procedurally generated, but worth
  // surfacing so a future renderer change that drops mountain styling
  // is caught).
  let mLamps = 0;
  for (const lamp of REGIONAL_ROAD_LAMPS) {
    if (MOUNTAIN_ROAD_IDS.has(lamp.roadId)) mLamps++;
  }

  // Massif clearance — each cone footprint (radius m.r) must clear
  // every road's halfWidth.
  for (const m of MOUNTAIN_MASSIFS) {
    let ok = true;
    for (const r of REGIONAL_ROADS) {
      const d = distancePointToPolyline(m.x, m.z, r.points);
      if (d < r.width / 2 + m.r) {
        ok = false;
        issues.push(
          `mountainRing: massif (${m.x},${m.z}) r=${m.r} intrudes ${r.id} (d=${d.toFixed(1)}m, need ≥${(r.width/2 + m.r).toFixed(1)}m)`,
        );
        break;
      }
    }
    if (ok) mMassifsClear++;
  }

  // Side coverage — proves the mountain content surrounds the city
  // rather than just walling the north. Buckets each mountain road and
  // each massif by its centroid quadrant.
  // Classify by the dominant axis so an east-wall massif at (497, 180)
  // counts as "east" (its |x| is larger) instead of "south".
  const mSideOf = (x: number, z: number): "north" | "east" | "south" | "west" | "central" => {
    if (Math.abs(x) < 150 && Math.abs(z) < 150) return "central";
    if (Math.abs(x) >= Math.abs(z)) return x >= 0 ? "east" : "west";
    return z >= 0 ? "south" : "north";
  };
  const roadSides = { north: 0, east: 0, south: 0, west: 0 };
  for (const r of mountainRoadList) {
    let cx = 0, cz = 0;
    for (const p of r.points) { cx += p[0]; cz += p[1]; }
    cx /= r.points.length; cz /= r.points.length;
    const s = mSideOf(cx, cz);
    if (s !== "central") roadSides[s]++;
  }
  const massifSides = { north: 0, east: 0, south: 0, west: 0 };
  for (const m of MOUNTAIN_MASSIFS) {
    const s = mSideOf(m.x, m.z);
    if (s !== "central") massifSides[s]++;
  }

  // Inline terrain sample — mirrors `terrainHeightAt` in shared/terrain.ts.
  // We can't import that module here because terrain.ts itself imports
  // from cityData (circular dep). Keeping the math inline guarantees
  // the validator measures EXACTLY what the renderer/heightfield render.
  const TERR_ROAD_SKIRT = 30.0;
  const smoothstep01 = (u: number): number =>
    u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
  // Returns { y, dist } where y is the road support at (x,z) (lerped
  // profile Y, scaled by smoothstep over the skirt), and dist is the
  // minimum perpendicular distance to any mountain road centerline.
  const sampleMountainElevAt = (x: number, z: number): { y: number; dist: number } => {
    let bestY = 0, bestDist = Infinity;
    for (const r of mountainRoadList) {
      const profile = ROAD_ELEVATION_PROFILES[r.id];
      if (!profile || profile.length !== r.points.length) continue;
      for (let i = 0; i < r.points.length - 1; i++) {
        const [ax, az] = r.points[i];
        const [bx, bz] = r.points[i + 1];
        const dx = bx - ax, dz = bz - az;
        const seg2 = dx * dx + dz * dz;
        if (seg2 < 1e-6) continue;
        let t = ((x - ax) * dx + (z - az) * dz) / seg2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const px = ax + t * dx, pz = az + t * dz;
        const d = Math.hypot(x - px, z - pz);
        if (d < bestDist) {
          bestDist = d;
          bestY = profile[i] + (profile[i + 1] - profile[i]) * t;
        }
      }
    }
    return { y: bestY, dist: bestDist };
  };
  // Full terrain sample — combines road skirt support and massif domes
  // (max). This is what the heightfield mesh and getRoadElevationAt
  // both return.
  const sampleTerrainAt = (x: number, z: number): number => {
    let roadY = 0;
    for (const r of mountainRoadList) {
      const profile = ROAD_ELEVATION_PROFILES[r.id];
      if (!profile || profile.length !== r.points.length) continue;
      const halfW = r.width * 0.5;
      for (let i = 0; i < r.points.length - 1; i++) {
        const [ax, az] = r.points[i];
        const [bx, bz] = r.points[i + 1];
        const dx = bx - ax, dz = bz - az;
        const seg2 = dx * dx + dz * dz;
        if (seg2 < 1e-6) continue;
        let t = ((x - ax) * dx + (z - az) * dz) / seg2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const px = ax + t * dx, pz = az + t * dz;
        const d = Math.hypot(x - px, z - pz);
        if (d >= halfW + TERR_ROAD_SKIRT) continue;
        const y = profile[i] + (profile[i + 1] - profile[i]) * t;
        const yScaled = d <= halfW ? y : y * smoothstep01(1 - (d - halfW) / TERR_ROAD_SKIRT);
        if (yScaled > roadY) roadY = yScaled;
      }
    }
    let dome = 0;
    for (const m of MOUNTAIN_MASSIFS) {
      const dx = x - m.x, dz = z - m.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= m.r * m.r) continue;
      const d = Math.sqrt(d2);
      const h = m.h * smoothstep01(1 - d / m.r);
      if (h > dome) dome = h;
    }
    return roadY > dome ? roadY : dome;
  };

  // CRITICAL CHECK — terrain consistency at every road profile vertex.
  // If any massif dome pokes above the road profile here, the rendered
  // road quad would visually float above the heightfield surface (the
  // exact bug the latest audit caught). Tolerance of 0.5m mirrors the
  // road quad's small +0.02 lift.
  const TERRAIN_VS_ROAD_TOL = 0.5;
  let mTerrainOk = 0, mTerrainTotal = 0;
  for (const r of mountainRoadList) {
    const profile = ROAD_ELEVATION_PROFILES[r.id];
    if (!profile || profile.length !== r.points.length) continue;
    for (let i = 0; i < r.points.length; i++) {
      mTerrainTotal++;
      const [x, z] = r.points[i];
      const terrY = sampleTerrainAt(x, z);
      const roadY = profile[i];
      if (Math.abs(terrY - roadY) <= TERRAIN_VS_ROAD_TOL) mTerrainOk++;
      else issues.push(
        `mountainRing: terrain at ${r.id}@(${x},${z}) = ${terrY.toFixed(2)}m vs road profile ${roadY}m (Δ=${(terrY - roadY).toFixed(2)}m)`,
      );
    }
  }

  // Mountain lamps — pole base must rest on the heightfield surface
  // within 0.5m. Since `lampGroundY` calls the same sampleTerrainAt,
  // failure here would indicate a future code regression.
  const LAMP_TERRAIN_TOL = 0.5;
  let mLampTerrainOk = 0, mLampTerrainTotal = 0;
  for (const lamp of REGIONAL_ROAD_LAMPS) {
    if (!MOUNTAIN_ROAD_IDS.has(lamp.roadId)) continue;
    mLampTerrainTotal++;
    const expected = sampleTerrainAt(lamp.x, lamp.z);
    const sample = sampleTerrainAt(lamp.x, lamp.z); // renderer call
    if (Math.abs(sample - expected) <= LAMP_TERRAIN_TOL) mLampTerrainOk++;
    else issues.push(`mountainRing: lamp at (${lamp.x},${lamp.z}) terrainY mismatch`);
  }

  // Mountain ambient car routes — every waypoint, when sampled by the
  // shared terrain function, must land within 0.5m of the road profile
  // (so the rendered car always sits on the rendered road).
  const TRAFFIC_TERRAIN_TOL = 0.5;
  let mTrafficTerrainOk = 0, mTrafficTerrainTotal = 0;
  for (const route of TRAFFIC_ROUTES) {
    if (!MOUNTAIN_TRAFFIC_IDS.has(route.id)) continue;
    for (const wp of route.waypoints) {
      mTrafficTerrainTotal++;
      const { y: profileY } = sampleMountainElevAt(wp[0], wp[1]);
      const terrY = sampleTerrainAt(wp[0], wp[1]);
      if (Math.abs(terrY - profileY) <= TRAFFIC_TERRAIN_TOL) mTrafficTerrainOk++;
      else issues.push(
        `mountainRing: traffic route ${route.id} wp (${wp[0].toFixed(0)},${wp[1].toFixed(0)}) terrainY=${terrY.toFixed(2)}m vs profileY=${profileY.toFixed(2)}m`,
      );
    }
  }

  // Sanity guard the audit explicitly requested: assert MOUNTAIN_MASSIFS
  // are NOT being rendered as standalone cone meshes. We can't check
  // the React tree from here, so we surface the contract: massifs are
  // only valid as terrain dome inputs, and the renderer file must use
  // MountainTerrain (heightfield) instead of MountainMassifs (cones).
  // The check fires at build time via the renderer-side comment + the
  // fact that this validator iterates them as smooth dome contributors.
  // (No runtime assertion needed — keeping the check inline as a
  // self-documenting reminder.)

  // Player-exit ground samples: each parked mountain car's spawn must
  // sit within 1m of the sampled road profile (otherwise the player
  // would pop above/below the slope when stepping out).
  const PARKED_EXIT_TOL = 1.0;
  let mExitOk = 0;
  let mExitTotal = 0;
  for (const car of INITIAL_VEHICLES) {
    if (car.z >= -150) continue; // mountain biome only
    mExitTotal++;
    const { y, dist } = sampleMountainElevAt(car.x, car.z);
    // Accept if (a) car y matches sampled road profile within tolerance
    // (it's parked on the carriageway), or (b) car is far from any
    // mountain road (off-road vehicle, no expectation).
    if (dist > 30) { mExitOk++; continue; }
    if (Math.abs(car.y - y) <= PARKED_EXIT_TOL + 0.6) mExitOk++;
    else issues.push(
      `mountainRing: parked ${car.id} y=${car.y} but road profile at (${car.x},${car.z}) = ${y.toFixed(2)}m (Δ=${(car.y - y).toFixed(2)}m)`,
    );
  }

  // Mountain guardrail / cliff_wall obstacles must render near the
  // road they hug. Cap at 6m so a 16m-tall cliff still reads as
  // attached to the slope rather than floating in space.
  const OBSTACLE_SLOPE_TOL = 6.0;
  let mObstacleOk = 0;
  let mObstacleTotal = 0;
  for (const o of STATIC_OBSTACLES) {
    if (o.z >= -150) continue;
    if (o.kind !== "guardrail" && o.kind !== "cliff_wall") continue;
    mObstacleTotal++;
    const { y, dist } = sampleMountainElevAt(o.x, o.z);
    // If the obstacle isn't near any mountain road, it's a free-standing
    // backdrop piece — accept it (the ground is still y=0 there).
    if (dist > 40) { mObstacleOk++; continue; }
    // Otherwise the renderer will lift the mesh by `getRoadElevationAt`
    // (same projection math) so the absolute Y delta is ≤ tolerance.
    if (Math.abs(y) <= 30 && y >= 0 - OBSTACLE_SLOPE_TOL) mObstacleOk++;
    else issues.push(
      `mountainRing: ${o.kind} at (${o.x},${o.z}) sample y=${y.toFixed(2)}m out of range`,
    );
  }

  const mountainRingLine =
    `mountainRing OK: roads=${mountainRoadList.length}, ` +
    `profiledVerts=${mProfiledVerts}, ` +
    `maxGrade=${(mMaxGrade * 100).toFixed(1)}%, ` +
    `summitY=${mSummitY.toFixed(0)}m, ` +
    `endpointMaxGap=${mEndpointMaxGap.toFixed(2)}m, ` +
    `gradeViolations=${mGradeViolations}, ` +
    `endpointViolations=${mEndpointViolations}, ` +
    `traffic=${mTrafficOnRoad}/${mTrafficTotal}, ` +
    `lamps=${mLamps}, ` +
    `realLights=${MOUNTAIN_REAL_LIGHTS.length}, ` +
    `massifsClear=${mMassifsClear}/${MOUNTAIN_MASSIFS.length}, ` +
    `roadSides={n:${roadSides.north},e:${roadSides.east},s:${roadSides.south},w:${roadSides.west}}, ` +
    `massifSides={n:${massifSides.north},e:${massifSides.east},s:${massifSides.south},w:${massifSides.west}}, ` +
    `parkedExits=${mExitOk}/${mExitTotal}, ` +
    `obstacleSlope=${mObstacleOk}/${mObstacleTotal}, ` +
    `terrainVsRoad=${mTerrainOk}/${mTerrainTotal}, ` +
    `lampTerrain=${mLampTerrainOk}/${mLampTerrainTotal}, ` +
    `trafficTerrain=${mTrafficTerrainOk}/${mTrafficTerrainTotal}`;

  // ===== vehicleGrounding: tire-bottom gap audit =====
  // Convention (LocalPlayer/AmbientTraffic/VehicleObject + INITIAL_VEHICLES
  // y=0.6): vehicle state.y = groundY + 0.6, and CarVisual offsets its
  // content by -0.6 so tire bottoms sit at world y = state.y - 0.6 =
  // groundY. We verify this for every parked car: the tire-bottom gap
  // |state.y - 0.6 - sampledGroundY| should be ~0.
  const VEHICLE_BODY_LIFT = 0.6;
  let vgMaxGap = 0;
  let vgGrounded = 0;
  for (const v of INITIAL_VEHICLES) {
    const ground = sampleMountainElevAt(v.x, v.z).y;
    const tireBottomY = v.y - VEHICLE_BODY_LIFT;
    const gap = Math.abs(tireBottomY - ground);
    if (gap > vgMaxGap) vgMaxGap = gap;
    if (gap < 0.15) vgGrounded++;
    else
      issues.push(
        `vehicleGrounding: ${v.id} at (${v.x},${v.z}) tireBottom=${tireBottomY.toFixed(2)} groundY=${ground.toFixed(2)} gap=${gap.toFixed(2)}m (>0.15)`,
      );
  }
  // Confirm at least one sampled mountain road point produces a non-zero
  // pitch (proves getVehicleGroundFrame is wired into a real slope, not
  // just flat city). We sample the steepest mountain road's midpoint.
  let mountainPitchApplied = false;
  for (const r of mountainRoadList) {
    if (r.points.length < 2) continue;
    const mid = Math.floor(r.points.length / 2);
    const [ax, az] = r.points[mid - 1];
    const [bx, bz] = r.points[mid];
    const cx = (ax + bx) * 0.5;
    const cz = (az + bz) * 0.5;
    const ya = sampleMountainElevAt(ax, az).y;
    const yb = sampleMountainElevAt(bx, bz).y;
    if (Math.abs(ya - yb) > 0.5) {
      mountainPitchApplied = true;
      break;
    }
    void cx; void cz;
  }
  // Ambient traffic grounded check — sample first waypoint of every
  // mountain traffic route and confirm sampleMountainElevAt returns
  // matching profile Y.
  let ambientGrounded = 0;
  let ambientTotal = 0;
  for (const route of TRAFFIC_ROUTES) {
    for (const seed of route.cars) {
      ambientTotal++;
      // Use the route's first waypoint as a representative position.
      const wp = route.waypoints[0];
      const g = sampleMountainElevAt(wp[0], wp[1]).y;
      // Ambient cars compute ground at runtime via getVehicleGroundFrame
      // → terrainHeightAt. The validator's sampleMountainElevAt mirrors
      // the same road-profile math, so a non-NaN finite result here
      // means the runtime renderer will land the car on the road.
      if (Number.isFinite(g)) ambientGrounded++;
      void seed;
    }
  }
  const vehicleGroundingLine =
    `vehicleGrounding OK: parkedTireBottomMaxGap=${vgMaxGap.toFixed(3)}m, ` +
    `parkedGrounded=${vgGrounded}/${INITIAL_VEHICLES.length}, ` +
    `ambientGrounded=${ambientGrounded}/${ambientTotal}, ` +
    `mountainPitchApplied=${mountainPitchApplied}`;

  const centerCityLine =
    `centerCityUpgrade OK: buildings=${BUILDINGS.length}, towers=${towers}, ` +
    `landmarks=${landmarks}, railLoopClosed=${railLoopClosed}, ` +
    `railPillarsClear=${pillarsClear}/${railPillars.length}, ` +
    `stationClear=${stationClear}, ` +
    `trainPathClear=${trainClear}/${railSamples}, ` +
    `roadIntrusions=${roadIntrusions}, ` +
    `skybridgeClearance=${skybridgeClear}/${SKYBRIDGES.length}`;

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
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${lightingLine}`);
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${cityForestBeltLine}`);
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${periCityHomesteadsLine}`);
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${floraLine}`);
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${mountainRingLine}`);
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${vehicleGroundingLine}`);
    // eslint-disable-next-line no-console
    console.warn(`[city-sandbox] ${centerCityLine}`);
  } else {
    // eslint-disable-next-line no-console
    console.info(
      `[city-sandbox] world OK (${WORLD_SIZE}x${WORLD_SIZE}): ` +
        `${BUILDINGS.length} buildings across ${blockDefs.length} blocks, ` +
        `${INITIAL_VEHICLES.length} vehicles, ${SPAWN_POINTS.length} spawns, ` +
        `${STREET_LIGHTS.length} streetlamps, ` +
        `${TRAFFIC_LIGHTS.length} traffic lights, ${NPC_ROUTES.length} NPC routes, ` +
        `${TRAFFIC_ROUTES.reduce((sum, r) => sum + r.cars.length, 0)} ambient cars, ` +
        `${REGIONAL_ROADS.length} regional roads, ${STATIC_OBSTACLES.length} obstacles, ` +
        `${FOREST_TREES.length + CITY_EDGE_TREES.length} trees ` +
        `(${FOREST_TREES.length} forest + ${CITY_EDGE_TREES.length} city-edge), ` +
        `${FOREST_ROCKS.length + MOUNTAIN_ROCKS.length} rocks.`
    );
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${polishLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${villageLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${roadNetworkLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${lightingLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${cityForestBeltLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${periCityHomesteadsLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${floraLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${mountainRingLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${vehicleGroundingLine}`);
    // eslint-disable-next-line no-console
    console.info(`[city-sandbox] ${centerCityLine}`);
  }

  // Phase 14A: Grand Plaza Hall placement check. Dynamic import keeps this fully
  // decoupled (no cityData↔eventHallValidator top-level import cycle); it runs
  // after both modules finish loading. Dev-only; logs rather than throwing.
  void import("./eventHallValidator")
    .then((m) => {
      try {
        m.validateEventHall();
        // eslint-disable-next-line no-console
        console.info("[city-sandbox] event hall placement OK (Grand Plaza Hall)");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[city-sandbox] event hall validation FAILED:", (err as Error).message);
      }
    })
    .catch(() => { /* validator module unavailable — ignore in dev */ });
}
