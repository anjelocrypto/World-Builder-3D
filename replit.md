# Workspace

## Overview

This project is a pnpm workspace monorepo using TypeScript, designed for a browser-based 3D multiplayer open-world sandbox game called "City Sandbox". The game features a large, detailed 3D world with a central city, various biomes (mountain, forest, suburban/industrial, fields), and a complex road network. Players can explore the world, drive cars, and interact with a multiplayer environment. The project aims to deliver a rich, immersive, and performant multiplayer experience.

The system includes a robust API server with real-time capabilities via Socket.io, a PostgreSQL database with Drizzle ORM, and a client-side built with React, Three.js, and React Three Fiber. The core vision is to create a dynamic and expansive virtual world where players can engage in various activities within a meticulously crafted environment.

## User Preferences

- I prefer simple language.
- I like functional programming.
- I want iterative development.
- Ask before making major changes.
- Provide detailed explanations for complex features.
- Do not make changes to folder `artifacts/city-sandbox/public/models/`.
- Do not make changes to file `artifacts/city-sandbox/src/shared/cityData.ts` without explicit confirmation.
- Ensure all new features are accompanied by comprehensive validation logic.

## System Architecture

The project is structured as a pnpm workspace monorepo.

**Core Technologies:**
- **Monorepo:** pnpm workspaces
- **Node.js:** v24
- **TypeScript:** v5.9
- **API Framework:** Express 5
- **Realtime:** Socket.io (for multiplayer game server)
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** Zod (`zod/v4`), `drizzle-zod`
- **API Codegen:** Orval (from OpenAPI spec)
- **Build Tool:** esbuild (CJS bundle)
- **Frontend:** React, Vite, Three.js, @react-three/fiber, @react-three/drei, Socket.io client

**UI/UX and Design:**
- **World Layout:** A 1000x1000 unit world with five distinct biomes: central city, mountain, bridge/forest, east (suburban/industrial), and west (fields/depots).
- **Road Network:** Hierarchical road system (arterial, collector, local) with 43 `REGIONAL_ROADS` polylines, validated for connectivity and integrity.
- **City Core:** Features 65 buildings (random, hand-placed highrises, landmarks), sidewalks, crosswalks, streetlamps, traffic lights, and props.
- **Peri-city Homesteads:** 12 wooden homesteads with yards, fences, and driveways, integrated with collision detection.
- **Terrain:** Dynamic mountain terrain rendered using `PlaneGeometry` with vertex displacement based on `terrainHeightAt(x, z)` for realistic elevation, ensuring road profiles and objects are correctly grounded.
- **Lighting:** Dynamic day/night cycle (`DAY_LENGTH_MS = 7_200_000`) influencing scene background, fog, and light intensity. Includes `hemisphereLight`, shadow-casting `directionalLight`, ambient light, and numerous instanced road lamps (`RegionalRoadLamps`) and real `pointLight`s at junctions and villages.
- **Minimap:** Canvas-based world-scale minimap in HUD showing biomes, roads, city grid, checkpoints, and player position.
- **Cinematic Menu:** A self-contained R3F `Canvas` in the lobby (`MenuWorldPreview.tsx`) provides a 3D world preview with a `MenuCameraRig` cycling through 5 pre-defined shots on a ~50s smoothstep-eased loop. Reuses `DayNightController`, `CityMap`, `BiomeRender`, `AmbientTraffic`, `NPCs`. Deliberately omits all multiplayer surface area (no `useSocket`, no `LocalPlayer`/`RemotePlayer`/`HUD`, no character GLBs). `App.tsx` lazy-loads `Game` via `React.lazy` so the gameplay module graph — and `AnimatedCharacter`'s module-scope `useGLTF.preload(...)` calls — never evaluate until JOIN WORLD is clicked. Menu Canvas passes `failIfMajorPerformanceCaveat: false` so headless / software-rendering chromiums fall back gracefully instead of throwing `Error creating WebGL context`. Lobby UI (`data-testid="input-username"`, `data-testid="button-join"`, `onJoin` validation) is unchanged; the form card sits over the canvas with a translucent blurred background and a dark radial vignette for legibility.

**Technical Implementations & Features:**
- **Multiplayer:** Socket.io for real-time player and vehicle state synchronization (position, rotation, movement, vehicle state). Server performs sanity checks (e.g., anti-teleport).
- **Collision Detection:** AABB-based collision for walking and driving against buildings and static obstacles (`shared/collision.ts`).
- **Character System:**
    - Placeholder avatar rig with procedural geometry.
    - `resolveAnimState` state machine for `idle`, `walk`, `run`, `fight1`, `fight2` animations.
    - Networked `animState`, `attackSeq`, `attackKind`, `attackStartedAt`, `isGrounded`, `moveSpeed` for character synchronization.
    - Local cooldown timers for attack types and a fight combo system.
    - Future-proofed for GLB avatar integration.
- **Vehicles:**
    - Four drivable car variants (sedan, van, taxi, compact).
    - `getVehicleGroundFrame` for 4-wheel ground sampling, providing `centerY`, `pitch`, `roll`.
    - Slope-aware physics (`SLOPE_GRAVITY`) for realistic uphill/downhill driving.
    - Procedural `CarVisual` renderer sharing geometries and materials for performance.
    - Dedicated `CarVisual` component for rendering consistent visuals across all vehicle types (parked, remote, local, ambient).
- **Ambient Elements:**
    - 28 parked vehicles, 12 ambient NPC pedestrians, and 17 ambient AI cars following predefined routes, all deterministic from `Date.now()`.
    - Instanced rendering for trees, rocks, and various obstacles for performance optimization.
- **Elevated Rail Loop:** Octagonal rail loop circling the city with a train, station, and skybridges. Pillars are procedurally generated to avoid road intrusions.
- **Game Controls:** Standard WASD movement, Shift for run, Space for jump, E for vehicle interaction, mouse for camera, Mouse0/F for light attack, Mouse2/R for heavy attack.
- **Camera System:** Frame-rate-independent exponential damping for smooth chase/orbit camera transitions. Includes terrain clearance logic to prevent camera clipping and speed-aware framing.

**System Design Choices:**
- **Deterministic World Elements:** Many elements like tree placement, rock placement, NPC routes, and ambient traffic are generated deterministically using seeded PRNGs or `Date.now()` to ensure consistent world state across clients without server-side computation.
- **Data Synchronization:** Critical data like `SPAWN_POINTS` and `INITIAL_VEHICLES` are mirrored and kept in sync between client and server, with the server being authoritative.
- **Performance Optimization:** Extensive use of `InstancedMesh` for rendering multiple similar objects (trees, rocks, lamps, buildings) and caching of geometries/materials for vehicles to minimize draw calls and memory usage.
- **Validation:** Extensive world validation occurs on import and boot, checking for proper placement, clearance, and connectivity of roads, buildings, and environmental elements.

## External Dependencies

- **pnpm workspaces:** Monorepo management.
- **Node.js 24:** Runtime environment.
- **TypeScript 5.9:** Programming language.
- **Express 5:** Web application framework for API server.
- **Socket.io:** Real-time communication library for multiplayer.
- **PostgreSQL:** Relational database.
- **Drizzle ORM:** TypeScript ORM for PostgreSQL.
- **Zod (v4):** Schema declaration and validation library.
- **drizzle-zod:** Integration between Drizzle ORM and Zod.
- **Orval:** OpenAPI spec to TypeScript client generator.
- **esbuild:** JavaScript bundler.
- **React:** Frontend library.
- **Vite:** Frontend build tool.
- **Three.js:** 3D graphics library.
- **@react-three/fiber:** React renderer for Three.js.
- **@react-three/drei:** Collection of useful helpers and abstractions for @react-three/fiber.
- **SkeletonUtils.clone (from 'three/examples/jsm/utils/SkeletonUtils'):** For cloning GLB character rigs.