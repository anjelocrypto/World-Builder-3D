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

export interface VehicleState {
  id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  speed: number;
  driverId: string | null;
  color: string;
}

export interface GameState {
  players: Record<string, PlayerState>;
  vehicles: Record<string, VehicleState>;
}

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
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
