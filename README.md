# City Sandbox

A browser-based 3D multiplayer open-world city sandbox prototype. Walk around a procedurally generated city, drive vehicles, run a checkpoint race, and play with friends in real time.

Built with **React + Vite + TypeScript**, **Three.js / @react-three/fiber / @react-three/drei**, **Socket.io**, and **Express 5**.

> All assets, geometry, names, and code are original. The project does not use, reference, or imitate any GTA, Rockstar, Los Santos / Liberty City / Vice City content, logos, music, or maps.

---

## Features

- 3D procedural city — grid roads, sidewalks, ~30 buildings of varying heights, lit windows, street lights, ramps, atmospheric fog
- Third-person player controller with WASD movement, run (Shift), jump (Space), pointer-lock camera, and AABB building collision
- 4 drivable vehicles — walk up and press **E** to enter, **WASD** to accelerate / brake / steer, **E** to exit; speedometer in the HUD
- Real-time multiplayer over Socket.io — synced positions, rotations, movement state, and vehicle ownership; remote players appear with name tags
- Checkpoint race — 5 glowing gates, drive through them in order to start a timed run
- HUD — health bar, minimap, speedometer, interaction prompt, online player count

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, Three.js, @react-three/fiber, @react-three/drei, Tailwind |
| Realtime | Socket.io client + server |
| Backend | Node.js 24, Express 5, Pino logger |
| Monorepo | pnpm workspaces |

---

## Project Structure

```
.
├── artifacts/
│   ├── api-server/         # Express + Socket.io game server
│   └── city-sandbox/       # React + Three.js game client
├── lib/                    # Shared libraries (api types, db, etc.)
├── package.json            # Root scripts (dev, build, typecheck)
└── pnpm-workspace.yaml     # Workspace config
```

---

## Prerequisites

- **Node.js** ≥ 20 (Node 24 recommended)
- **pnpm** ≥ 9 — install with `npm install -g pnpm`

> This is a pnpm workspace. Running `npm install` will fail with a clear error message asking you to use pnpm. This is intentional — npm does not fully support the `workspace:*` cross-package imports used by this monorepo.

---

## Setup

```bash
# 1. Clone
git clone <your-repo-url> city-sandbox
cd city-sandbox

# 2. Install dependencies
pnpm install

# 3. Run both servers (frontend + backend)
pnpm dev
```

Then open **http://localhost:5173** in two browser tabs (or two browsers) to test multiplayer. Enter different usernames in each tab and join — you'll see the other player as a labeled figure.

---

## Run Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the API server (port 8080) **and** the Vite frontend (port 5173) together. The frontend proxies `/api/*` (including the Socket.io websocket) to the backend. |
| `pnpm dev:api` | Run only the API + Socket.io server (port 8080). |
| `pnpm dev:web` | Run only the frontend (port 5173). Requires the API to be running on port 8080 (or set `API_PROXY_TARGET`). |
| `pnpm build` | Typecheck the whole monorepo, then build the frontend bundle (`artifacts/city-sandbox/dist/public`) and the API server bundle (`artifacts/api-server/dist`). |
| `pnpm start` | Builds the project, then runs both production servers (frontend via `vite preview`, API via the compiled bundle). Equivalent to `pnpm build && pnpm start:prod`. |
| `pnpm start:prod` | Start both production servers without rebuilding (use after `pnpm build`). |
| `pnpm typecheck` | Run TypeScript across all packages. |

---

## Ports

| Service | Default port | Override with |
| --- | --- | --- |
| Frontend (Vite dev server) | `5173` | `PORT` env var (set by root `dev:web` script) |
| API + Socket.io server | `8080` | `PORT` env var (set by root `dev:api` script) |

When running with `pnpm dev`, the Vite server proxies `/api/*` (HTTP and WebSocket) to `http://localhost:8080`, so the browser only ever talks to one origin (port 5173).

---

## Environment Variables

The game itself **does not require any environment variables to run**. The root `pnpm dev` and `pnpm start` scripts set everything needed automatically.

If you run individual packages directly, you need:

| Variable | Used by | Required? | Purpose |
| --- | --- | --- | --- |
| `PORT` | api-server, city-sandbox | Yes (when running individually) | Port to listen on |
| `BASE_PATH` | city-sandbox | Yes (when running individually) | Vite `base` path. Use `/` for standalone. |
| `API_PROXY_TARGET` | city-sandbox (dev only) | No | If set, Vite dev server proxies `/api/*` to this URL. The root `dev:web` script sets it to `http://localhost:8080`. |
| `NODE_ENV` | both | No | `development` or `production`. |
| `DATABASE_URL` | (lib/db only) | **No** for the game | The game does not touch the database. Only set this if you extend the project to use Postgres. |

Create a `.env` file at the root if you want to override any of these, then load it with your shell or with a tool like `dotenv-cli`.

---

## Multiplayer Test

1. Run `pnpm dev`.
2. Open `http://localhost:5173` in **two** browser tabs (or two different browsers).
3. Enter different usernames and click **Join World** in each.
4. Move with WASD in one tab — you'll see the other player move in the other tab in real time. Press **E** near a parked car to drive; remote players see your vehicle move.

---

## Controls

| Key | Action |
| --- | --- |
| **W / A / S / D** | Move (on foot) or drive (in vehicle) |
| **Shift** | Run |
| **Space** | Jump |
| **E** | Enter / exit vehicle |
| **Mouse** | Look around (click canvas first to capture pointer) |
| **Esc** | Release mouse capture |

Drive through the **5 glowing checkpoint gates** in order to start a timed race.

---

## Deploying on Replit

This project is built to run on Replit out of the box.

### Quick path (recommended)

1. Import this repository into a new Replit project (Replit auto-detects the `pnpm` workspace).
2. Click **Run**. Replit will start both workflows defined in `.replit`:
   - `artifacts/api-server: API Server`
   - `artifacts/city-sandbox: web`
3. Click **Publish** in the top-right of the Replit workspace. Replit will build and deploy the project as an autoscale deployment using the configuration in `.replit` and each artifact's `.replit-artifact/artifact.toml`.

### How routing works on Replit

Replit's edge proxy routes by path according to each artifact's `artifact.toml`:

- `artifacts/api-server/.replit-artifact/artifact.toml` claims `/api` → API + Socket.io server
- `artifacts/city-sandbox/.replit-artifact/artifact.toml` claims `/` → frontend

This means in production on Replit, the browser hits a single origin and Replit's proxy splits traffic. No Vite proxy is needed in this mode.

### Environment variables on Replit

None are required for the game. If you ever add database-backed features, add `DATABASE_URL` via the Secrets tab.

---

## Deploying anywhere else

You need to host two services and route `/api` to the API server:

1. **API server** — run `pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start` with `PORT` set. Expose port `8080` (or whatever `PORT` you set).
2. **Frontend** — run `pnpm --filter @workspace/city-sandbox run build` to produce static files in `artifacts/city-sandbox/dist/public/`. Serve these with any static host (Nginx, Caddy, S3 + CloudFront, Vercel static, etc.).
3. **Reverse proxy** — route `/api/*` (HTTP + WebSocket) to the API server, and everything else to the static frontend.

Example minimal Nginx config:

```nginx
server {
  listen 80;

  location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }

  location / {
    root /var/www/city-sandbox;
    try_files $uri /index.html;
  }
}
```

---

## License

MIT — see [LICENSE](./LICENSE).

All in-game geometry, layouts, and code are original. No third-party copyrighted content (logos, music, maps, character likenesses, brand names) is included.
