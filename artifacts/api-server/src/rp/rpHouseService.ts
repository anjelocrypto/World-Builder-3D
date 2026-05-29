/**
 * Phase 12A: starter player housing — buy + owner-only entry.
 *
 * Security model (all server-authoritative):
 *   - House slug, label, PRICE, footprint, door, and interior coordinates come
 *     from the static RP_HOUSES table in ../socket/cityData. The client never
 *     sends a price and cannot define a house.
 *   - Ownership lives only in rp_houses. A buy claims the house atomically with
 *     a conditional UPDATE (… WHERE slug = ? AND owner_id IS NULL RETURNING *)
 *     inside a transaction, so two players cannot buy the same house.
 *   - Money is deducted (cash) inside the SAME transaction with a row-locked
 *     wallet, mirroring buyVehicle. Cache + client are synced only after commit.
 *   - Entry is owner-only: the server checks rp_houses.owner_id === playerId and
 *     proximity to the door, then teleports via the jail-release pattern.
 *   - Payloads expose only { slug, label, price, owned, ownedByMe } — never the
 *     owner's DB UUID, the row id, or socket ids. Logs carry no player/socket id.
 */

import type { Socket } from "socket.io";
import type { LicenseContext } from "./rpLicenseService";
import { db, rpHouses, rpWallets, rpTransactionLog } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { RpError } from "./rpWalletService";
import {
  RP_HOUSES,
  rpHouseBySlug,
  isInsideHouseFootprint,
  HOUSE_INTERACT_RADIUS,
  type RpHouseDef,
} from "../socket/cityData";
import { logger } from "../lib/logger";

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Safe per-house client payload — ownership flags only, never an owner UUID. */
interface HouseInfoPayload {
  slug:      string;
  label:     string;
  price:     number;
  owned:     boolean;
  ownedByMe: boolean;
}

/**
 * Seed the rp_houses ownership rows (one per static house) idempotently.
 * Safe to call on every boot; ON CONFLICT DO NOTHING prevents duplicates.
 * Never throws — a seed failure must not crash startup.
 */
export async function ensureHousesSeeded(): Promise<void> {
  try {
    await db
      .insert(rpHouses)
      .values(RP_HOUSES.map((h) => ({ slug: h.slug })))
      .onConflictDoNothing();
  } catch (err) {
    logger.error({ err }, "[rpHouse] seed failed");
  }
}

/** Build the safe ownership payload for the requesting player. */
async function buildHousePayload(playerId: string): Promise<HouseInfoPayload[]> {
  // Map slug → ownerId from the DB (single small query).
  const ownerBySlug = new Map<string, string | null>();
  try {
    const rows = await db
      .select({ slug: rpHouses.slug, ownerId: rpHouses.ownerId })
      .from(rpHouses);
    for (const r of rows) ownerBySlug.set(r.slug, r.ownerId);
  } catch (err) {
    logger.error({ err }, "[rpHouse] list query failed");
  }
  return RP_HOUSES.map((h) => {
    const ownerId = ownerBySlug.get(h.slug) ?? null;
    return {
      slug:      h.slug,
      label:     h.label,
      price:     h.price,
      owned:     ownerId !== null,
      ownedByMe: ownerId !== null && ownerId === playerId,
    };
  });
}

/** rp:getHouses — send the requesting player the safe house list. */
export async function handleGetHouses(socket: Socket, ctx: LicenseContext): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;
  const houses = await buildHousePayload(entry.playerId);
  socket.emit("rp:houses", { houses });
}

/**
 * rp:buyHouse — atomic, server-authoritative purchase.
 * Validates identity, the static slug, proximity to the door, then claims the
 * house + deducts cash in one transaction. Price comes from the server def.
 */
export async function handleBuyHouse(socket: Socket, ctx: LicenseContext, rawSlug: unknown): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  if (entry.jailUntil !== null && entry.jailUntil > new Date()) {
    socket.emit("rp:toast", { msg: "You cannot buy property while jailed.", color: "yellow", duration: 3000 });
    return;
  }

  const slug = typeof rawSlug === "string" ? rawSlug : "";
  const house = rpHouseBySlug(slug);
  if (!house) {
    socket.emit("rp:toast", { msg: "Unknown property.", color: "red", duration: 3000 });
    return;
  }

  const player = ctx.players.get(socket.id);
  if (!player) return;
  if (dist2d(player.x, player.z, house.door[0], house.door[2]) > HOUSE_INTERACT_RADIUS) {
    socket.emit("rp:toast", { msg: "Stand at the front door to buy this house.", color: "yellow", duration: 3000 });
    return;
  }

  // Optimistic cash check (server re-validates inside the transaction).
  if (entry.cash < house.price) {
    socket.emit("rp:toast", {
      msg: `Need $${house.price.toLocaleString()} cash to buy ${house.label}. You have $${entry.cash.toLocaleString()}.`,
      color: "red", duration: 4500,
    });
    return;
  }

  let newCash: number | null = null;
  try {
    newCash = await db.transaction(async (tx) => {
      // 1. Atomic claim — only succeeds while the house is unowned.
      const claimed = await tx
        .update(rpHouses)
        .set({ ownerId: entry.playerId, purchasedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(rpHouses.slug, house.slug), isNull(rpHouses.ownerId)))
        .returning({ id: rpHouses.id });
      if (claimed.length === 0) {
        throw new RpError("already_owned", "House already owned");
      }

      // 2. Lock wallet, validate funds, deduct cash (price from server def only).
      const [wallet] = await tx
        .select()
        .from(rpWallets)
        .where(eq(rpWallets.playerId, entry.playerId))
        .for("update");
      if (!wallet) throw new Error(`[rpHouse] no wallet for playerId`);

      const updated = wallet.cash - house.price;
      if (updated < 0) throw new RpError("insufficient_cash", "Insufficient cash");

      await tx
        .update(rpWallets)
        .set({ cash: updated, updatedAt: new Date() })
        .where(eq(rpWallets.playerId, entry.playerId));

      // 3. Audit log.
      await tx.insert(rpTransactionLog).values({
        playerId:  entry.playerId,
        kind:      "house_purchase",
        cashDelta: -house.price,
        bankDelta: 0,
        cashAfter: updated,
        bankAfter: wallet.bank,
        note:      `Bought house ${house.slug}`,
      });

      return updated;
    });
  } catch (err) {
    if (err instanceof RpError && err.code === "already_owned") {
      socket.emit("rp:toast", { msg: "Someone already owns this house.", color: "red", duration: 4000 });
    } else if (err instanceof RpError && err.code === "insufficient_cash") {
      socket.emit("rp:toast", { msg: `Need $${house.price.toLocaleString()} cash.`, color: "red", duration: 4000 });
    } else {
      logger.error({ err }, "[rpHouse] buy transaction failed");
      socket.emit("rp:toast", { msg: "Server error — purchase failed. Try again.", color: "red", duration: 4000 });
    }
    return;
  }

  // Committed — sync cache + client.
  entry.cash = newCash;
  socket.emit("rp:profileUpdate", { cash: newCash });
  const houses = await buildHousePayload(entry.playerId);
  socket.emit("rp:houses", { houses });
  socket.emit("rp:toast", { msg: `🏠 You bought ${house.label}! Press E at the door to enter.`, color: "green", duration: 6000 });
  logger.info("[rpHouse] house purchased");
}

/** Read the current owner of a house slug from the DB. */
async function houseOwner(slug: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ ownerId: rpHouses.ownerId })
      .from(rpHouses)
      .where(eq(rpHouses.slug, slug));
    return row?.ownerId ?? null;
  } catch (err) {
    logger.error({ err }, "[rpHouse] owner query failed");
    return null;
  }
}

/** Server-authoritative teleport (jail-release pattern): move + broadcast + client snap. */
function teleportPlayer(socket: Socket, ctx: LicenseContext, pos: [number, number, number]): void {
  const player = ctx.players.get(socket.id);
  if (!player) return;
  const moved = { ...player, x: pos[0], y: pos[1], z: pos[2], isInVehicle: false, vehicleId: null, speed: 0 };
  ctx.players.set(socket.id, moved);
  ctx.io.emit("playerMoved", moved);
  socket.emit("rp:houseTeleport", { pos });
}

/**
 * rp:enterHouse — owner-only entry. Validates ownership (DB) + proximity to the
 * door, then teleports the owner inside the sealed shell. Non-owners are locked.
 */
export async function handleEnterHouse(socket: Socket, ctx: LicenseContext, rawSlug: unknown): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  const slug = typeof rawSlug === "string" ? rawSlug : "";
  const house = rpHouseBySlug(slug);
  if (!house) return;

  const player = ctx.players.get(socket.id);
  if (!player) return;
  if (dist2d(player.x, player.z, house.door[0], house.door[2]) > HOUSE_INTERACT_RADIUS) {
    socket.emit("rp:toast", { msg: "Stand at the front door to enter.", color: "yellow", duration: 3000 });
    return;
  }

  const ownerId = await houseOwner(house.slug);
  if (ownerId !== entry.playerId) {
    socket.emit("rp:toast", { msg: "This house is locked.", color: "yellow", duration: 3000 });
    return;
  }

  teleportPlayer(socket, ctx, house.interior);
}

/**
 * rp:exitHouse — leave the house the player is currently inside. Validates the
 * player is within a house footprint and owns it, then teleports to the door.
 */
export async function handleExitHouse(socket: Socket, ctx: LicenseContext): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;
  const player = ctx.players.get(socket.id);
  if (!player) return;

  const house: RpHouseDef | undefined = RP_HOUSES.find((h) =>
    isInsideHouseFootprint(h, player.x, player.z),
  );
  if (!house) return; // not inside any house — nothing to do

  const ownerId = await houseOwner(house.slug);
  if (ownerId !== entry.playerId) {
    // Shouldn't happen (only the owner is ever teleported in), but never trap.
    teleportPlayer(socket, ctx, house.door);
    return;
  }

  teleportPlayer(socket, ctx, house.door);
}
