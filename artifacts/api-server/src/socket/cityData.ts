export const INITIAL_VEHICLES = [
  { id: "car-0", x: 22, y: 0.6, z: -22, rotY: 0,              speed: 0, driverId: null, color: "#e74c3c" },
  { id: "car-1", x: -22, y: 0.6, z: 22,  rotY: Math.PI,       speed: 0, driverId: null, color: "#3498db" },
  { id: "car-2", x: 55,  y: 0.6, z: 8,   rotY: Math.PI / 2,   speed: 0, driverId: null, color: "#2ecc71" },
  { id: "car-3", x: -55, y: 0.6, z: -8,  rotY: -Math.PI / 2,  speed: 0, driverId: null, color: "#f39c12" },
];

// IMPORTANT: must stay in sync with the client SPAWN_POINTS in
// artifacts/city-sandbox/src/shared/cityData.ts. The server picks one of
// these for each joining player, sends it back in the gameState payload,
// and the client uses that authoritative position as its initial spawn.
// All positions are in the empty central plaza (cx=0, cz=0 block has no
// generated buildings), so every spawn is guaranteed not to collide.
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
