/**
 * Vehicle Ownership Service — Phase 3.
 *
 * Handles:
 *   buyVehicle()                — atomic DB transaction: lock wallet → validate
 *                                 cash → plate insert (SAVEPOINT retry) → deduct
 *                                 → log → spawn → emit
 *   loadAndSpawnOwnedVehicles() — load from DB on join, spawn into free delivery
 *                                 slots; skip vehicles already present in-world
 *   toggleLock()                — flip locked flag in DB + cache + emit update
 *
 * Server-authoritative rules (enforced here and in gameServer vehicleUpdate):
 *   - Client never sends price, ownerId, plate, or locked.
 *   - Server validates model/variant against VEHICLE_SHOP_CATALOG allowlist.
 *   - Plate is generated server-side (NEM-XXXX); retried via SAVEPOINT on
 *     UNIQUE conflict — all within a single DB transaction so no partial
 *     state is ever committed.
 *   - Owned+locked vehicle may only be entered/unlocked by its ownerId.
 *   - Driver License required to buy and to drive.
 *
 * Disconnect policy (Phase 3 simplest-acceptable):
 *   Owned vehicles are NOT despawned on disconnect. They remain in the world
 *   so other clients keep seeing them. On reconnect, loadAndSpawnOwnedVehicles
 *   skips vehicles whose id is already in the vehicles map.
 */

import { db, rpOwnedVehicles, rpWallets, rpTransactionLog } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { Server, Socket } from "socket.io";
import { logger } from "../lib/logger";
import type { RpCacheEntry, OwnedVehicleSummary } from "./rpCache";
import { RpError } from "./rpWalletService";
import {
  DEALERSHIP_POS,
  DEALERSHIP_INTERACT_RADIUS,
  DEALERSHIP_DELIVERY_PAD,
  DELIVERY_SLOT_OFFSETS,
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

// ── Context ────────────────────────────────────────────────────────────────────

export interface VehicleContext {
  players:     Map<string, PlayerState>;
  vehicles:    Map<string, VehicleState>;
  rpCache:     Map<string, RpCacheEntry>;
  io:          Server;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Module-level slot reservation set. Keys are "x,z" strings.
 *
 * A slot is reserved from the moment buyVehicle picks it (before the DB
 * transaction starts) until the transaction either fails (finally-release)
 * or the vehicle is successfully spawned. This prevents two concurrent
 * purchases from targeting the same empty slot, which would result in one
 * vehicle being charged and the slot appearing full to the other.
 *
 * Node.js is single-threaded: between two awaits nothing else can interleave,
 * so add/delete on this Set is safe without a mutex.
 */
const reservedDeliverySlots = new Set<string>();

/** Stable key for a delivery slot position. */
function slotKey(x: number, z: number): string {
  return `${x},${z}`;
}

/**
 * Generate a plate in NEM-XXXX format (4 uppercase alphanumeric chars).
 * Collision on the UNIQUE constraint is resolved via SAVEPOINT retry in the
 * caller — this function just picks a random suffix each call.
 */
function generatePlate(): string {
  const chars = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `NEM-${suffix}`;
}

/** Deterministic in-world vehicle id from the DB row id. */
function ownedVehicleId(dbId: string): string {
  return `ov-${dbId}`;
}

/** Add vehicle to server map and notify all clients. */
function spawnVehicle(v: VehicleState, ctx: VehicleContext): void {
  ctx.vehicles.set(v.id, v);
  ctx.io.emit("vehicleAdded", v);
}

/**
 * Find the first delivery slot that is neither physically occupied (within
 * 1.5 m of an existing vehicle) nor reserved by a concurrent purchase.
 * Returns null when every slot is taken or reserved — callers must not spawn.
 */
function findFreeSlot(ctx: VehicleContext): [number, number, number] | null {
  const [bx, by, bz] = DEALERSHIP_DELIVERY_PAD;
  for (const [dx, dz] of DELIVERY_SLOT_OFFSETS) {
    const sx = bx + dx;
    const sz = bz + dz;
    if (reservedDeliverySlots.has(slotKey(sx, sz))) continue;
    let occupied = false;
    for (const v of ctx.vehicles.values()) {
      if (Math.abs(v.x - sx) < 1.5 && Math.abs(v.z - sz) < 1.5) {
        occupied = true;
        break;
      }
    }
    if (!occupied) return [sx, by, sz];
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Handle `rp:buyVehicle { model, variant, color }`.
 *
 * Everything from cash deduction to DB insert happens inside a single
 * serializable transaction so no partial state can be committed:
 *
 *   BEGIN
 *     SELECT rp_wallets WHERE playerId FOR UPDATE   ← row-lock
 *     validate cash >= price
 *     SAVEPOINT plate_try
 *       INSERT rp_owned_vehicles (plate = generatePlate())
 *     RELEASE SAVEPOINT plate_try           ← or ROLLBACK on 23505 + retry
 *     UPDATE rp_wallets SET cash = cash - price
 *     INSERT rp_transaction_log
 *   COMMIT
 *
 * After commit: update in-memory cache, spawn vehicle, emit profile + toast.
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

  // ── Fast-fail pre-condition checks (outside transaction) ─────────────────
  // Phase 6D: jailed players cannot purchase vehicles.
  if (entry.jailUntil !== null) {
    socket.emit("rp:toast", {
      msg:      "You cannot buy a vehicle while in jail.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  if (!entry.driverLicense) {
    socket.emit("rp:toast", {
      msg:      "You need a Driver License to buy a vehicle.",
      color:    "red",
      duration: 4000,
    });
    return;
  }

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

  const player = ctx.players.get(socket.id);
  if (!player) {
    logger.warn({ socketId: socket.id }, "[rp] buyVehicle: player not in map");
    return;
  }
  const distToDealer = dist2d(player.x, player.z, DEALERSHIP_POS[0], DEALERSHIP_POS[2]);
  if (distToDealer > DEALERSHIP_INTERACT_RADIUS) {
    socket.emit("rp:toast", {
      msg:      "You need to be closer to the Dealership.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  // Optimistic cash check before hitting the DB (saves a round-trip on obvious failures)
  if (entry.cash < catalogEntry.price) {
    socket.emit("rp:toast", {
      msg:      `Need $${catalogEntry.price} to buy this vehicle. You have $${entry.cash}.`,
      color:    "red",
      duration: 4000,
    });
    return;
  }

  // ── Reserve delivery slot BEFORE touching the DB ──────────────────────────
  // This guarantees: if no slot is free, the player is never charged.
  // The reservation also prevents two concurrent purchases from racing to the
  // same empty slot (reservedDeliverySlots is checked by findFreeSlot).
  const preSlot = findFreeSlot(ctx);
  if (!preSlot) {
    socket.emit("rp:toast", {
      msg:      "Dealership delivery area is full. Try again later.",
      color:    "yellow",
      duration: 5000,
    });
    return;
  }
  const [rsx, , rsz] = preSlot;
  const reserved = slotKey(rsx, rsz);
  reservedDeliverySlots.add(reserved);

  // ── Single atomic transaction ─────────────────────────────────────────────
  let txResult: { ownedRow: typeof rpOwnedVehicles.$inferSelect; newCash: number } | null = null;

  try {
    txResult = await db.transaction(async (tx) => {
      // 1. Lock the wallet row — prevents concurrent purchases from racing
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");

      if (!wallet) {
        throw new Error(`[rp] buyVehicle: no wallet for playerId=${entry.playerId}`);
      }

      const newCash = wallet.cash - catalogEntry.price;
      if (newCash < 0) {
        throw new RpError(
          "insufficient_cash",
          `Need $${catalogEntry.price}, have $${wallet.cash}`,
        );
      }

      // 2. Insert owned vehicle row — retry plate on UNIQUE conflict via SAVEPOINT
      let ownedRow: typeof rpOwnedVehicles.$inferSelect | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const plate = generatePlate();
        try {
          await tx.execute(sql`SAVEPOINT plate_try`);
          const [row] = await tx
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
            .returning();
          await tx.execute(sql`RELEASE SAVEPOINT plate_try`);
          ownedRow = row;
          break;
        } catch (insertErr: unknown) {
          const pgCode =
            (insertErr as { cause?: { code?: string } })?.cause?.code ??
            (insertErr as { code?: string })?.code;
          if (pgCode === "23505") {
            // Plate collision — roll back just the insert, keep the transaction alive
            await tx.execute(sql`ROLLBACK TO SAVEPOINT plate_try`);
            logger.debug({ attempt }, "[rp] buyVehicle: plate collision, retrying in tx");
            continue;
          }
          throw insertErr;
        }
      }

      if (!ownedRow) {
        throw new Error("[rp] buyVehicle: plate_exhausted — 5 consecutive plate collisions");
      }

      // 3. Deduct cash
      await tx
        .update(rpWallets)
        .set({ cash: newCash, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      // 4. Audit log
      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "vehicle_purchase",
        cashDelta: -catalogEntry.price,
        bankDelta: 0,
        cashAfter: newCash,
        bankAfter: wallet.bank,
        note:      `Bought ${model} (${color}) plate=${ownedRow.plate}`,
      });

      return { ownedRow, newCash };
    });
  } catch (err) {
    // Release reservation on any failure — player was never charged
    reservedDeliverySlots.delete(reserved);
    if (err instanceof RpError && err.code === "insufficient_cash") {
      socket.emit("rp:toast", {
        msg:      `Insufficient cash: need $${catalogEntry.price}.`,
        color:    "red",
        duration: 4000,
      });
    } else {
      logger.error({ err, socketId: socket.id }, "[rp] buyVehicle: transaction failed");
      socket.emit("rp:toast", {
        msg:      "Server error — could not process purchase. Try again.",
        color:    "red",
        duration: 4000,
      });
    }
    return;
  }

  // Release slot reservation — transaction committed, vehicle about to spawn
  reservedDeliverySlots.delete(reserved);

  // ── Transaction committed — update cache, spawn, emit ────────────────────
  const { ownedRow, newCash } = txResult;

  const vehicleId = ownedVehicleId(ownedRow.id);
  const summary: OwnedVehicleSummary = {
    dbId:      ownedRow.id,
    vehicleId,
    model,
    variant,
    color,
    plate:  ownedRow.plate,
    locked: true,
  };

  entry.cash = newCash;
  entry.ownedVehicles.push(summary);

  // Re-confirm the pre-reserved slot is still clear (covers the extremely rare
  // case where the slot was taken between reservation-release and this line).
  // If it is taken, fall back to any remaining free slot.
  // No await between here and spawnVehicle — Node.js single-threaded, no race.
  let spawnSlot: [number, number, number] = preSlot;
  {
    const [ox, oy, oz] = preSlot;
    let stillFree = true;
    for (const v of ctx.vehicles.values()) {
      if (Math.abs(v.x - ox) < 1.5 && Math.abs(v.z - oz) < 1.5) {
        stillFree = false;
        break;
      }
    }
    if (!stillFree) {
      const fallback = findFreeSlot(ctx);
      if (fallback) {
        spawnSlot = fallback;
      } else {
        // Truly no slot — purchased but can't spawn. Extremely rare.
        logger.error({ socketId: socket.id, vehicleId }, "[rp] buyVehicle: committed but no delivery slot available");
        socket.emit("rp:profileUpdate", { cash: newCash, ownedVehicles: entry.ownedVehicles });
        socket.emit("rp:toast", {
          msg:      "Vehicle purchased but delivery is delayed — it will appear when a slot opens.",
          color:    "yellow",
          duration: 7000,
        });
        return;
      }
    }
  }

  const [sx, sy, sz] = spawnSlot;
  const v: VehicleState = {
    id:       vehicleId,
    x:        sx,
    y:        sy,
    z:        sz,
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

  socket.emit("rp:profileUpdate", {
    cash:          newCash,
    ownedVehicles: entry.ownedVehicles,
  });
  socket.emit("rp:toast", {
    msg:      `${model.charAt(0).toUpperCase() + model.slice(1)} purchased! Plate: ${ownedRow.plate}. Find it at the Dealership — unlock with L.`,
    color:    "green",
    duration: 6000,
  });

  logger.info(
    { socketId: socket.id, vehicleId, plate: ownedRow.plate },
    "[rp] vehicle PURCHASED (atomic tx)",
  );
}

/**
 * Load all owned vehicles for a player from DB, spawn into free delivery slots.
 *
 * Skips any vehicle whose id is already in `ctx.vehicles` (in-world from a
 * previous session or another concurrent socket). This ensures reconnects
 * never move or duplicate an already-parked owned vehicle.
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
  let spawned = 0;

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

    // Skip spawn if already in world (from a prior session / disconnect-without-despawn)
    if (ctx.vehicles.has(vehicleId)) {
      logger.debug({ vehicleId }, "[rp] loadAndSpawnOwnedVehicles: vehicle already in world, skipping");
      continue;
    }

    // Spawn into the first unoccupied delivery slot — skip if area is full
    const slot = findFreeSlot(ctx);
    if (!slot) {
      logger.warn({ vehicleId, socketId }, "[rp] loadAndSpawnOwnedVehicles: all delivery slots occupied, skipping spawn");
      continue;
    }
    const [sx, sy, sz] = slot;
    const v: VehicleState = {
      id:       vehicleId,
      x:        sx,
      y:        sy,
      z:        sz,
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
    spawned++;
  }

  entry.ownedVehicles = summaries;

  if (summaries.length > 0) {
    const sock = ctx.io.sockets.sockets.get(socketId);
    if (sock) {
      sock.emit("rp:profileUpdate", { ownedVehicles: summaries });
    }
  }

  logger.info(
    { socketId, total: rows.length, spawned },
    "[rp] owned vehicles loaded (skipped already-in-world)",
  );
}

/**
 * Handle `rp:toggleLock { vehicleId }`.
 *
 * Only the vehicle's ownerId may toggle the lock.
 * Player must be within 8 m of the vehicle (server-authoritative position).
 * Persists new locked state to DB, then emits vehicleMoved with updated locked field.
 */
export async function toggleLock(
  socket:    Socket,
  ctx:       VehicleContext,
  vehicleId: string,
): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // Phase 6D: jailed players cannot toggle vehicle locks.
  if (entry.jailUntil !== null) {
    socket.emit("rp:toast", {
      msg:      "You cannot interact with vehicles while in jail.",
      color:    "yellow",
      duration: 3000,
    });
    return;
  }

  const vehicle = ctx.vehicles.get(vehicleId);
  if (!vehicle || !vehicle.owned) {
    socket.emit("rp:toast", {
      msg:      "Vehicle not found.",
      color:    "yellow",
      duration: 2500,
    });
    return;
  }

  if (vehicle.ownerId !== entry.playerId) {
    socket.emit("rp:toast", {
      msg:      "That's not your vehicle.",
      color:    "red",
      duration: 3000,
    });
    return;
  }

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

  const summary = entry.ownedVehicles.find((s) => s.vehicleId === vehicleId);
  if (!summary) return;

  const newLocked = !summary.locked;

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

  summary.locked  = newLocked;
  vehicle.locked  = newLocked;
  ctx.vehicles.set(vehicleId, vehicle);

  socket.emit("rp:profileUpdate", { ownedVehicles: entry.ownedVehicles });
  ctx.io.emit("vehicleMoved", { id: vehicleId, locked: newLocked });

  socket.emit("rp:toast", {
    msg:      newLocked ? "Vehicle locked." : "Vehicle unlocked.",
    color:    "green",
    duration: 2000,
  });

  logger.info({ socketId: socket.id, vehicleId, locked: newLocked }, "[rp] vehicle lock toggled");
}
