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

export type DistrictType = "downtown" | "commercial" | "residential" | "plaza";

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
