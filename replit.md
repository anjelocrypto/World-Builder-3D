# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Realtime**: Socket.io (multiplayer game server at `/api/socket.io`)
- **Database**: PostgreSQL + Drizzle ORM (provisioned, schema empty for now)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### City Sandbox (`artifacts/city-sandbox`) — Preview path: `/`
Browser-based 3D multiplayer open-world city sandbox game.

**Tech:** React + Vite + TypeScript + Three.js + @react-three/fiber + @react-three/drei + Socket.io client

**Features:**
- 3D procedural city with **3 districts** (downtown / commercial / residential), each with its own height, width, and color palette
- 12 city blocks (4 corners + 8 narrow halves split around the central N-S and E-W roads so no block crosses a carriageway)
- District-aware buildings: multi-side emissive window strips, antennas with red emissive tip, rooftop boxes, doors
- Sidewalks with raised curbs, painted crosswalks at every intersection, lane markings
- 90 streetlamps (emissive head + transparent ground "light pool" disc — no real lights per lamp)
- 36 traffic light boxes at intersection corners, parking-spot markings, props (benches, planters, trashcans, hydrants)
- 14 parked vehicles in 4 visual variants (sedan, van, taxi w/ rooftop sign, compact) — `VARIANT_DIMENSIONS` in `cityData.ts` drives geometry
- 12 ambient NPC pedestrians walking sidewalk loops (deterministic, `Date.now()`-driven, client-only)
- 4 ambient AI cars looping the outer perimeter (deterministic, client-only — no Socket.io traffic)
- Third-person player controller with WASD movement, Shift (run), Space (jump)
- Pointer-lock mouse camera orbit (click canvas to capture mouse)
- Drivable vehicles (E to enter/exit, WASD to drive, speedometer HUD)
- Socket.io multiplayer: sync position, rotation, movement state, vehicle state
- Building AABB collision detection
- Checkpoint race system (5 gates placed on road centerlines)
- HUD: health bar, minimap, speedometer, interaction prompt, player count
- Simple lobby: username input + join world

**Lighting (performance-conscious):**
- One `hemisphereLight` (sky/ground fill) + ONE shadow-casting `directionalLight` + dim `ambientLight`, all in `GameScene.tsx`.
- 4 real `pointLight`s at the central plaza corners — every other "light" in the scene is just an emissive material plus a transparent disc on the ground.
- Fog `["#1a2440", 90, 260]` and skybox `#1a2440` so the city reads at distance without losing its evening mood.

**Data layout (`src/shared/cityData.ts`):**
- Sectioned: `ROADS`, `DISTRICTS`, `blockDefs`, `BUILDINGS`, `INITIAL_VEHICLES`, `SPAWN_POINTS`, `CHECKPOINTS`, `RAMPS`, `STREET_LIGHTS`, `TRAFFIC_LIGHTS`, `PARKING_SPOTS`, `NPC_ROUTES`, `TRAFFIC_ROUTES`, `PROPS`, `VARIANT_DIMENSIONS`.
- `genBuilding` clamps width/depth to `block_dim - 2 * padding` (padding=5), guaranteeing every building footprint stays inside its block.
- A dev-only validator runs on import and prints a single `city OK: …` info line; any spawn/vehicle/checkpoint inside a building, or any building corner inside a road carriageway, becomes a console warning.

**Spawn handling (important):**
- The central plaza around (0, 0) is intentionally building-free (the `cx=0,cz=0` block is omitted from `blockDefs`).
- `SPAWN_POINTS` in `src/shared/cityData.ts` and `artifacts/api-server/src/socket/cityData.ts` MUST stay in sync — the server picks one for each joining player and sends it back in the `gameState` payload.
- `INITIAL_VEHICLES` is also mirrored: the server is authoritative over each car's position/driver, but `variant` and `color` are visual fields that flow through to the client unchanged. `VehicleState.variant` is optional on both sides for back-compat.
- `LocalPlayer` uses the server's authoritative position (`initialSpawn` prop derived from `gameState.players[myId]`) as its initial spawn. The deterministic `charCodeAt` fallback is only used if the server didn't supply one.
- `GameScene` wraps the canvas in a `tabIndex=0` div and focuses the wrapper + window on mount/click so the Replit preview iframe reliably receives keyboard events (drei's `useKeyboardControls` listens on `window`).

**File map (city-sandbox `src/game/`):**
- `CityMap.tsx` — static world: skybox, ground, roads, crosswalks, sidewalks, buildings, streetlamps, traffic lights, parking markings, props, ramps, fog, plaza point lights.
- `VehicleObject.tsx` — drivable car geometry. Exports `CarVisual` (a variant-driven car body) so `AmbientTraffic` can reuse the same look.
- `NPCs.tsx` — one ambient pedestrian per `NPC_ROUTES` entry, deterministic from `Date.now()`.
- `AmbientTraffic.tsx` — one cosmetic AI car per `TrafficRoute.cars` entry, deterministic from `Date.now()` + per-car phase.
- `GameScene.tsx` — Canvas, lighting, mounts everything plus remote players, vehicles, checkpoint race, HUD.

### API Server (`artifacts/api-server`) — Preview path: `/api`
Express 5 REST API + Socket.io game server.

**Socket.io game server** (`src/socket/gameServer.ts`):
- Players: join, move, leave
- Vehicles: 4 cars with driver state
- Server-side sanity check (anti-teleport)
- Player count broadcast

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Game Controls

- **WASD** — Move / Drive
- **Shift** — Run
- **Space** — Jump
- **E** — Enter/Exit vehicle
- **Click canvas** — Capture mouse for camera look
- **Mouse** — Rotate camera

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
