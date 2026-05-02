export interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  isInVehicle: boolean;
  vehicleId: string | null;
  health: number;
  isRunning: boolean;
}

export type VehicleVariant = "sedan" | "van" | "taxi" | "compact";

export interface VehicleState {
  id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  speed: number;
  driverId: string | null;
  color: string;
  variant?: VehicleVariant;
}

export interface GameState {
  players: Record<string, PlayerState>;
  vehicles: Record<string, VehicleState>;
}

export type DistrictType =
  | "downtown"
  | "highrise"
  | "landmark"
  | "commercial"
  | "residential"
  | "plaza";

// Building "tier" is an optional richer-rendering hint used by the city
// renderer. Original rendering still works for entries that omit these.
//   mid       — commercial/residential/downtown mid-rise (≤45h)
//   high      — glass downtown tower (45–85h)
//   landmark  — skyline-defining skyscraper (90–120h)
export type BuildingTier = "mid" | "high" | "landmark";

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
  district: DistrictType;
  hasAntenna: boolean;
  hasRooftopBox: boolean;
  windowSeed: number;
  tier?: BuildingTier;
  glass?: boolean;
  crownLight?: boolean;
  neonSign?: boolean;
  podium?: boolean;
}

// =============================================================
// Center-city upgrade — elevated rail loop, station, skybridges
// =============================================================

// One vertex of the closed elevated rail loop polyline. Loop is closed by
// repeating the first vertex at index n; the renderer / validator both
// rely on `loop[0] == loop[loop.length-1]`.
export interface RailVertex {
  x: number;
  z: number;
}

// One support column for the elevated rail. The pillar is centered at
// (x,z), runs from y=0 up to the rail deck height, and is rotated so its
// crossbeam aligns with the local rail direction (`rotY` in radians).
export interface RailPillar {
  x: number;
  z: number;
  rotY: number;
}

// Elevated train station deck. Footprint is an AABB centered at (cx,cz).
// `deckY` is the platform top height in metres. `stairX`/`stairZ` mark the
// ground-side foot of the staircase that comes down from the platform.
export interface TrainStationData {
  id: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  rotY: number;
  deckY: number;
  stairX: number;
  stairZ: number;
  signText: string;
}

// One pedestrian skybridge between two endpoints at height y. The
// validator checks that the line segment passes entirely above any city
// road carriageway it crosses, with at least 5m vertical clearance.
export interface SkybridgeData {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  y: number;
}

export interface RampData {
  x: number;
  z: number;
  rotY: number;
}

export interface CheckpointData {
  id: number;
  x: number;
  z: number;
}

export interface StreetLightData {
  x: number;
  z: number;
}

export interface TrafficLightData {
  x: number;
  z: number;
  rotY: number;
}

export interface ParkingSpot {
  x: number;
  z: number;
  rotY: number;
}

export interface NpcRoute {
  id: number;
  waypoints: [number, number][];
  cycleSeconds: number;
  skinColor: string;
  shirtColor: string;
}

export interface TrafficCarSeed {
  id: string;
  color: string;
  variant: VehicleVariant;
  phase: number;
}

export interface TrafficRoute {
  id: number;
  waypoints: [number, number, number][];
  cycleSeconds: number;
  cars: TrafficCarSeed[];
}

export type PropType = "bench" | "planter" | "trashcan" | "hydrant";

export interface PropData {
  x: number;
  z: number;
  rotY: number;
  type: PropType;
}

// =============================================================
// Expanded world: regional roads, static obstacles, instanced props
// =============================================================

export type RoadType = "asphalt" | "bridge" | "forest" | "mountain" | "dirt";

export interface RoadPath {
  id: string;
  points: [number, number][];
  width: number;
  type: RoadType;
}

export type StaticObstacleKind =
  | "bridge_rail"
  | "large_rock"
  | "tree_trunk"
  | "cliff_wall"
  | "warehouse"
  | "water_tower_base"
  | "cabin"
  | "ranger_station"
  | "depot"
  | "gas_stop"
  | "observatory"
  | "guardrail"
  | "wooden_house"
  | "yard_fence";

export interface StaticObstacle {
  x: number;
  z: number;
  w: number;
  d: number;
  kind: StaticObstacleKind;
}

export interface TreeInstance {
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

export interface RockInstance {
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

// =============================================================
// Peri-city wooden homestead belt
// =============================================================
//
// A planned ring of small forest cottages around the central city,
// sitting OUTSIDE the inner-city-ring carriageway (|coord|=100) but
// INSIDE the city-edge tree belt (max(|x|,|z|) ∈ [125,230]). Each
// homestead is an axis-aligned yard rectangle with one wooden house
// inside, a perimeter fence broken by a single gate facing the road,
// and a short dirt driveway from the gate back to a tap-in vertex on
// the inner-city-ring. Houses + fences are pushed into STATIC_OBSTACLES
// so the existing player/vehicle collision pipeline blocks them; yards
// themselves are non-collidable cosmetic ground patches.
export interface PeriCityHomestead {
  id: string;
  // House centre (also yard centre — yard is centred on the house).
  x: number;
  z: number;
  // House facing in radians. Used by the renderer so the door/porch
  // points toward the gate; gameplay collision is axis-aligned via the
  // house's STATIC_OBSTACLES AABB.
  rotY: number;
  // Wooden-house footprint (axis-aligned AABB stored in STATIC_OBSTACLES).
  houseW: number;
  houseD: number;
  // Yard footprint enclosing the house (axis-aligned). Fence runs the
  // perimeter; one side has a 4m gate centred on it.
  yardW: number;
  yardD: number;
  // Visual variant. Both styles share the same collision footprint.
  style: "cottage" | "barnette";
  // Which yard edge has the gate. Driveway connects this edge to
  // `driveStart` on the inner-city-ring.
  gateSide: "north" | "south" | "east" | "west";
  // Tap-in vertex on inner-city-ring (must already exist on the ring
  // polyline so the road-graph validator sees the driveway as connected).
  driveStart: [number, number];
}

// Lamp poles placed along the edges of regional roads. Style controls the
// pole/head/light-pool look in the renderer (urban=metal+warm white,
// bridge=brighter warm both sides, rural=wooden+orange, mountain=short
// hazard post). The renderer fakes most of the lighting via emissive
// heads + transparent ground discs so we never need one real pointLight
// per lamp.
export interface RegionalLampData {
  x: number;
  z: number;
  rotY: number;
  roadId: string;
  style: "urban" | "rural" | "mountain" | "bridge";
}
