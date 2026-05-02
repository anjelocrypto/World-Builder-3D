export const INITIAL_VEHICLES = [
  { id: "car-0", x: 22, y: 0.6, z: -22, rotY: 0,              speed: 0, driverId: null, color: "#e74c3c" },
  { id: "car-1", x: -22, y: 0.6, z: 22,  rotY: Math.PI,       speed: 0, driverId: null, color: "#3498db" },
  { id: "car-2", x: 55,  y: 0.6, z: 8,   rotY: Math.PI / 2,   speed: 0, driverId: null, color: "#2ecc71" },
  { id: "car-3", x: -55, y: 0.6, z: -8,  rotY: -Math.PI / 2,  speed: 0, driverId: null, color: "#f39c12" },
];

export const SPAWN_POINTS: [number, number, number][] = [
  [4, 1, 4],
  [-4, 1, 4],
  [4, 1, -4],
  [-4, 1, -4],
  [8, 1, 0],
  [-8, 1, 0],
  [0, 1, 8],
  [0, 1, -8],
];
