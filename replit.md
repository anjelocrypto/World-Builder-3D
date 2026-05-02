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
