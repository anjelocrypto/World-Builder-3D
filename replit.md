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
- 3D procedural city with roads, buildings, sidewalks, street lights, ramps
- Third-person player controller with WASD movement, Shift (run), Space (jump)
- Pointer-lock mouse camera orbit (click canvas to capture mouse)
- 4 drivable vehicles (E to enter/exit, WASD to drive, speedometer HUD)
- Socket.io multiplayer: sync position, rotation, movement state, vehicle state
- Building AABB collision detection
- Checkpoint race system (drive through 5 gates in order)
- HUD: health bar, minimap, speedometer, interaction prompt, player count
- Simple lobby: username input + join world

**Spawn handling (important):**
- The central plaza around (0, 0) is intentionally building-free (the `cx=0,cz=0` block is omitted from `blockDefs`).
- `SPAWN_POINTS` in `src/shared/cityData.ts` and `artifacts/api-server/src/socket/cityData.ts` MUST stay in sync — the server picks one for each joining player and sends it back in the `gameState` payload.
- `LocalPlayer` uses the server's authoritative position (`initialSpawn` prop derived from `gameState.players[myId]`) as its initial spawn. The deterministic `charCodeAt` fallback is only used if the server didn't supply one.
- A dev-only assertion in `cityData.ts` warns to the console if any spawn point overlaps a generated building. Running the city-sandbox dev server is enough to surface this.
- `GameScene` wraps the canvas in a `tabIndex=0` div and focuses the wrapper + window on mount/click so the Replit preview iframe reliably receives keyboard events (drei's `useKeyboardControls` listens on `window`).

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
