// IMPORTANT: must stay in sync with the client INITIAL_VEHICLES and
// SPAWN_POINTS in artifacts/city-sandbox/src/shared/cityData.ts. The
// server is authoritative — it owns each vehicle's position/driverId
// and broadcasts state to all clients. The client reads `variant` for
// purely visual rendering (sedan/van/taxi/compact body shape).

export const INITIAL_VEHICLES = [
  // Inner ring — near plaza
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
  // Outer ring
  { id: "car-12", x:  41, y: 0.6, z: -70, rotY: 0,                  speed: 0, driverId: null, variant: "taxi",    color: "#f1c40f" },
  { id: "car-13", x: -41, y: 0.6, z:  70, rotY: Math.PI,            speed: 0, driverId: null, variant: "compact", color: "#27ae60" },
];

// Spawn points placed inside the central plaza (cx=0, cz=0 block has no
// generated buildings). Must match the client SPAWN_POINTS array.
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
