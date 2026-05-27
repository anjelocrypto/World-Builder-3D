/**
 * Vehicle Ownership Service — Phase 3.
 *
 * Handles:
 *   buyVehicle()                — validate + charge + insert DB row + spawn
 *   loadAndSpawnOwnedVehicles() — load from DB on join, spawn each in-world
 *   despawnOwnedVehicles()      — remove in-world vehicles on disconnect
 *   toggleLock()                — flip locked flag in DB + cache + emit update
 *
 * Server-authoritative rules (enforced here and in gameServer vehicleUpdate):
 *   - Client never sends price, ownerId, plate, or locked.
 *   - Server validates model/variant against VEHICLE_SHOP_CATALOG allowlist.
 *   - Plate is generated server-side (NEM-XXXX); retried on UNIQUE conflict.
 *   - Owned+locked vehicle may only be unlocked by its ownerId.
 *   - Licensed player required to buy AND to drive.
 */

import { db, rpOwnedVehicles } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Server, Socket } from "socket.io";
import { logger } from "../lib/logger";
import type { RpCacheEntry, OwnedVehicleSummary } from "./rpCache";
import { walletTransfer, RpError } from "./rpWalletService";
import {
  DEALERSHIP_POS,
  DEALERSHIP_INTERACT_RADIUS,
  DEALERSHIP_DELIVERY_PAD,
  VEHICLE_SHOP_CATALOG,
} from "../socket/cityData";

// ── Minimal structural types (mirror gameServer's local VehicleState) ─────

interface VehicleState {
  id:       string;
  x:        number;
  y:        number;
  z:        number;
  rotY:     number;
  speed:    number;
  driverId: string | null;
  color:    string;
  variant?: string;
  ownerId?: string;
  plate?:   string;
  locked?:  boolean;
  owned?:   boolean;
}

interface PlayerState {
  x: number;
  y: number;
  z: number;
}

// ── Context (shared with LicenseContext in setupRpHandlers) ───────────────

export interface VehicleContext {
  players:     Map<string, PlayerState>;
  vehicles:    Map<string, VehicleState>;
  rpCache:     Map<string, RpCacheEntry>;
  io:          Server;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Generate a plate in NEM-XXXX format where XXXX is 4 uppercase alphanumeric
 * characters. Collision is resolved by the caller (retry on UNIQUE violation).
 */
function generatePlate(): string {
  const chars = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `NEM-${suffix}`;
}

/** Unique in-world vehicle id from the DB row id. */
function ownedVehicleId(dbId: string): string {
  return `ov-${dbId}`;
}

/** Add vehicle to server map and notify all clients. */
function spawnVehicle(v: VehicleState, ctx: VehicleContext): void {
  ctx.vehicles.set(v.id, v);
  ctx.io.emit("vehicleAdded", v);
}

/** Remove vehicle from server map and notify all clients. */
function despawnVehicle(vehicleId: string, ctx: VehicleContext): void {
  ctx.vehicles.delete(vehicleId);
  ctx.io.emit("vehicleRemoved", { id: vehicleId });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Handle `rp:buyVehicle { model, variant, color }`.
 *
 * Validates: player has license, is near dealership, passes catalog allowlist,
 * has sufficient cash. Then: deducts cash, inserts DB row (retrying plate on
 * UNIQUE conflict), spawns vehicle at delivery pad, updates cache, emits events.
 */
export async function buyVehicle(
  socket:  Socket,
  ctx:     VehicleContext,
  model:   string,
  variant: string,
  color:   string,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) {
    socket.emit("rp:toast", {
      msg:      "Profile not loaded yet — wait a moment and try again.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Must have driver license
  if (!entry.driverLicense) {
    socket.emit("rp:toast", {
      msg:      "You need a Driver License to buy a vehicle.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // Validate model/variant/color against catalog
  const catalogEntry = VEHICLE_SHOP_CATALOG.find(
    (c) => c.model === model && c.variant === variant,
  );
  if (!catalogEntry) {
    logger.warn({ socketId: socket.id, model, variant }, "[rp] buyVehicle: invalid model/variant");
    return;
  }
  if (!(catalogEntry.colors as readonly string[]).includes(color)) {
    logger.warn({ socketId: socket.id, model, color }, "[rp] buyVehicle: invalid color");
    return;
  }

  // Player proximity check (server-authoritative position)
  const player = ctx.players.get(socket.id);
  if (!player) {
    logger.warn({ socketId: socket.id }, "[rp] buyVehicle: player not in map");
    return;
  }
  const distToDealer = dist2d(
    player.x, player.z,
    DEALERSHIP_POS[0], DEALERSHIP_POS[2],
  );
  if (distToDealer > DEALERSHIP_INTERACT_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You need to be closer to the Dealership.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Sufficient cash
  if (entry.cash < catalogEntry.price) {
    socket.emit("rp:toast", {
      msg:      `Need $${catalogEntry.price} to buy this vehicle. You have $${entry.cash}.`,
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // Deduct cash (with SELECT FOR UPDATE to prevent double-spend)
  let newCash: number;
  try {
    const result = await walletTransfer({
      playerId:  entry.playerId,
      cashDelta: -catalogEntry.price,
      kind:      "vehicle_purchase",
      note:      `Bought ${model} (${color})`,
    });
    newCash = result.cash;
    entry.cash = newCash;
  } catch (err) {
    if (err instanceof RpError && err.code === "insufficient_cash") {
      socket.emit("rp:toast", {
        msg:      `Insufficient cash: need $${catalogEntry.price}.`,
        color:    "red",
        duration: 4000,
      });
    } else {
      logger.error({ err, socketId: socket.id }, "[rp] walletTransfer failed in buyVehicle");
      socket.emit("rp:toast", {
        msg:      "Server error — could not process payment. Try again.",
        color:    "red",
        duration: 4000,
      });
    }
    return;
  }

  // Insert DB row (retry up to 5 times on UNIQUE plate collision)
  let dbId: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const plate = generatePlate();
    try {
      const [row] = await db
        .insert(rpOwnedVehicles)
        .values({
          ownerId:  entry.playerId,
          model,
          variant,
          color,
          plate,
          locked:   true,
          fuel:     100,
        })
        .returning({ id: rpOwnedVehicles.id });
      if (row) {
        dbId = row.id;
        break;
      }
    } catch (err: unknown) {
      // Drizzle wraps the PG unique_violation as a native error with code "23505"
      const pgCode = (err as { cause?: { code?: string } })?.cause?.code
                  ?? (err as { code?: string })?.code;
      if (pgCode === "23505") {
        logger.debug({ attempt }, "[rp] buyVehicle: plate collision, retrying");
        continue;
      }
      logger.error({ err, socketId: socket.id }, "[rp] buyVehicle: DB insert failed");
      socket.emit("rp:toast", {
        msg:      "Server error registering vehicle — contact support.",
        color:    "red",
        duration: 5000,
      });
      return;
    }
  }

  if (!dbId) {
    logger.error({ socketId: socket.id }, "[rp] buyVehicle: could not generate unique plate after 5 attempts");
    socket.emit("rp:toast", {
      msg:      "Server error — try again.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // Load the full row to get the plate we generated
  const [ownedRow] = await db
    .select()
    .from(rpOwnedVehicles)
    .where(eq(rpOwnedVehicles.id, dbId));

  if (!ownedRow) {
    logger.error({ dbId, socketId: socket.id }, "[rp] buyVehicle: could not reload owned row");
    socket.emit("rp:toast", { msg: "Server error — contact support.", color: "red", duration: 5000 });
    return;
  }

  const vehicleId = ownedVehicleId(dbId);
  const summary: OwnedVehicleSummary = {
    dbId,
    vehicleId,
    model,
    variant,
    color,
    plate: ownedRow.plate,
    locked: true,
  };

  // Update in-memory cache
  entry.ownedVehicles.push(summary);

  // Spawn vehicle at delivery pad
  const v: VehicleState = {
    id:       vehicleId,
    x:        DEALERSHIP_DELIVERY_PAD[0],
    y:        DEALERSHIP_DELIVERY_PAD[1],
    z:        DEALERSHIP_DELIVERY_PAD[2],
    rotY:     0,
    speed:    0,
    driverId: null,
    color,
    variant,
    ownerId:  entry.playerId,
    plate:    ownedRow.plate,
    locked:   true,
    owned:    true,
  };
  spawnVehicle(v, ctx);

  // Notify client
  socket.emit("rp:profileUpdate", {
    cash:          newCash,
    ownedVehicles: entry.ownedVehicles,
  });
  socket.emit("rp:toast", {
    msg:      `${model.charAt(0).toUpperCase() + model.slice(1)} purchased! Plate: ${ownedRow.plate}. It's parked at the Dealership — go unlock it.`,
    color:    "green",
    duration: 6000,
  });

  logger.info(
    { socketId: socket.id, vehicleId, plate: ownedRow.plate },
    "[rp] vehicle PURCHASED",
  );
}

/**
 * Load all owned vehicles for a player from DB, add to in-memory cache,
 * and spawn them in the world.
 *
 * Called after upsertPlayer resolves in the `join` handler.
 */
export async function loadAndSpawnOwnedVehicles(
  socketId: string,
  ctx:      VehicleContext,
): Promise<void> {
  const entry = ctx.rpCache.get(socketId);
  if (!entry) return;

  let rows: (typeof rpOwnedVehicles.$inferSelect)[];
  try {
    rows = await db
      .select()
      .from(rpOwnedVehicles)
      .where(eq(rpOwnedVehicles.ownerId, entry.playerId));
  } catch (err) {
    logger.error({ err, socketId }, "[rp] loadAndSpawnOwnedVehicles: DB error");
    return;
  }

  const summaries: OwnedVehicleSummary[] = [];
  for (const row of rows) {
    const vehicleId = ownedVehicleId(row.id);
    const summary: OwnedVehicleSummary = {
      dbId:      row.id,
      vehicleId,
      model:     row.model,
      variant:   row.variant,
      color:     row.color,
      plate:     row.plate,
      locked:    row.locked ?? true,
    };
    summaries.push(summary);

    const v: VehicleState = {
      id:       vehicleId,
      x:        DEALERSHIP_DELIVERY_PAD[0],
      y:        DEALERSHIP_DELIVERY_PAD[1],
      z:        DEALERSHIP_DELIVERY_PAD[2],
      rotY:     0,
      speed:    0,
      driverId: null,
      color:    row.color,
      variant:  row.variant,
      ownerId:  entry.playerId,
      plate:    row.plate,
      locked:   row.locked ?? true,
      owned:    true,
    };
    spawnVehicle(v, ctx);
  }

  entry.ownedVehicles = summaries;

  // Emit profile update so the client's shop/garage UI reflects owned vehicles
  if (summaries.length > 0) {
    const sock = ctx.io.sockets.sockets.get(socketId);
    if (sock) {
      sock.emit("rp:profileUpdate", { ownedVehicles: summaries });
    }
  }

  logger.info(
    { socketId, count: rows.length },
    "[rp] owned vehicles loaded + spawned",
  );
}

/**
 * Remove all owned vehicles belonging to a player from the world on disconnect.
 * Does NOT touch the DB — vehicles are re-spawned at the delivery pad on next join.
 */
export function despawnOwnedVehicles(
  socketId: string,
  ctx:      VehicleContext,
): void {
  const entry = ctx.rpCache.get(socketId);
  if (!entry || entry.ownedVehicles.length === 0) return;

  for (const summary of entry.ownedVehicles) {
    despawnVehicle(summary.vehicleId, ctx);
  }

  logger.info(
    { socketId, count: entry.ownedVehicles.length },
    "[rp] owned vehicles despawned (disconnect)",
  );
}

/**
 * Handle `rp:toggleLock { vehicleId }`.
 *
 * Only the vehicle's ownerId may toggle the lock.
 * Player must be within 6 m of the vehicle (server-authoritative position).
 * Persists new locked state to DB, then emits vehicleMoved with updated locked field.
 */
export async function toggleLock(
  socket:    Socket,
  ctx:       VehicleContext,
  vehicleId: string,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  const vehicle = ctx.vehicles.get(vehicleId);
  if (!vehicle || !vehicle.owned) {
    socket.emit("rp:toast", {
      msg:      "Vehicle not found.",
      color:    "yellow",
      duration: 2500,
    });
    return;
  }

  // Only owner may toggle
  if (vehicle.ownerId !== entry.playerId) {
    socket.emit("rp:toast", {
      msg:      "That's not your vehicle.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Proximity check (player must be near vehicle)
  const player = ctx.players.get(socket.id);
  if (!player) return;
  const distToVehicle = dist2d(player.x, player.z, vehicle.x, vehicle.z);
  if (distToVehicle > 8) {
    socket.emit("rp:toast", {
      msg:      "Get closer to your vehicle first.",
      color:    "yellow",
      duration: 2500,
    });
    return;
  }

  // Find summary in cache
  const summary = entry.ownedVehicles.find((s) => s.vehicleId === vehicleId);
  if (!summary) return;

  const newLocked = !summary.locked;

  // Persist to DB
  try {
    await db
      .update(rpOwnedVehicles)
      .set({ locked: newLocked })
      .where(eq(rpOwnedVehicles.id, summary.dbId));
  } catch (err) {
    logger.error({ err, socketId: socket.id, vehicleId }, "[rp] toggleLock: DB error");
    socket.emit("rp:toast", {
      msg:      "Server error — try again.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

  // Update cache + in-world state
  summary.locked = newLocked;
  vehicle.locked = newLocked;
  ctx.vehicles.set(vehicleId, vehicle);

  // Update owned vehicles summary in profile
  socket.emit("rp:profileUpdate", { ownedVehicles: entry.ownedVehicles });

  // Broadcast vehicle state change (locked field) to all clients
  ctx.io.emit("vehicleMoved", { id: vehicleId, locked: newLocked });

  socket.emit("rp:toast", {
    msg:      newLocked ? "Vehicle locked." : "Vehicle unlocked.",
    color:    "green",
    duration: 2000,
  });

  logger.info({ socketId: socket.id, vehicleId, locked: newLocked }, "[rp] vehicle lock toggled");
}
