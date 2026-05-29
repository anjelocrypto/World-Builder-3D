/**
 * Phase 11C: RP personal inventory foundation — read-only.
 *
 * Security model (all server-authoritative):
 *   - A player may fetch ONLY their own inventory. The server derives identity
 *     from rpCache[socket.id].playerId; the client sends no playerId and cannot
 *     request another player's inventory.
 *   - Display strings (name / category / description) come from a static
 *     server-side catalog keyed by itemSlug — never from the client and never
 *     from free-text DB columns. The DB stores only itemSlug + quantity.
 *   - Payloads never include playerId (UUID), the DB row id, socket ids,
 *     coordinates, tokens, cash, or bank.
 *   - Rate limited per player (in-memory, keyed by DB playerId).
 *   - Read-only: no item use, transfer, drop, trade, shop, or economy mutation.
 */

import type { Socket } from "socket.io";
import type { LicenseContext } from "./rpLicenseService";
import { db, rpInventoryItems } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

/** Per-player inventory-fetch cooldown, keyed by DB playerId. In-memory only. */
const inventoryFetchCooldown = new Map<string, number>();
const INVENTORY_FETCH_COOLDOWN_MS = 1000;

/**
 * Static, server-controlled item catalog. itemSlug → display + rules.
 * Foundation phase: all items are non-usable and non-economic (no effects, no
 * value). `stackLimit` is reserved for server-side enforcement once item
 * mutations are added in a later phase. Unknown slugs fall back to a safe
 * generic rendering so the client never sees raw/unknown data unfiltered.
 */
interface CatalogEntry {
  name:        string;
  category:    string;
  description: string;
  stackLimit:  number;
}

const ITEM_CATALOG: Record<string, CatalogEntry> = {
  phone: {
    name:        "Phone",
    category:    "Personal",
    description: "A basic mobile phone. No functionality yet.",
    stackLimit:  1,
  },
  keys: {
    name:        "Keys",
    category:    "Personal",
    description: "A small ring of keys.",
    stackLimit:  1,
  },
  water_bottle: {
    name:        "Water Bottle",
    category:    "Consumable",
    description: "A sealed bottle of water. Cannot be used yet.",
    stackLimit:  12,
  },
  notebook: {
    name:        "Notebook",
    category:    "Personal",
    description: "A pocket notebook for jotting things down.",
    stackLimit:  5,
  },
};

/**
 * Phase 11D: starter items every player should carry. All slugs MUST exist in
 * ITEM_CATALOG and remain non-usable / non-economic (no effects, no value).
 * Seeding is idempotent at the DB level via the UNIQUE(player_id, item_slug)
 * index, so re-running on reconnect can never duplicate a stack.
 */
const STARTER_ITEMS: ReadonlyArray<{ slug: string; quantity: number }> = [
  { slug: "phone",        quantity: 1 },
  { slug: "keys",         quantity: 1 },
  { slug: "notebook",     quantity: 1 },
  { slug: "water_bottle", quantity: 1 },
];

/** A single inventory line as sent to the client. No ids, no secrets. */
interface InventoryItemPayload {
  slug:        string;
  name:        string;
  category:    string;
  description: string;
  quantity:    number;
}

/** Resolve a DB row into a safe, catalog-derived client payload line. */
function resolveItem(itemSlug: string, quantity: number): InventoryItemPayload {
  const entry = ITEM_CATALOG[itemSlug];
  // Clamp quantity to a sane, non-negative integer for display.
  const qty = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
  if (entry) {
    return {
      slug:        itemSlug,
      name:        entry.name,
      category:    entry.category,
      description: entry.description,
      quantity:    qty,
    };
  }
  // Unknown slug — render generically; do not surface the raw slug as a name.
  // The slug is retained only as a stable React key on the client.
  return {
    slug:        itemSlug,
    name:        "Unknown Item",
    category:    "Misc",
    description: "",
    quantity:    qty,
  };
}

/**
 * rp:getInventory — the player requests THEIR OWN inventory. The server derives
 * the playerId from the socket's cache entry; the client provides nothing.
 * Emits rp:inventory only to the requesting socket. On any DB error the player
 * receives an empty inventory (a valid, expected state) rather than an error.
 */
export async function handleGetInventory(socket: Socket, ctx: LicenseContext): Promise<void> {
  const entry = ctx.rpCache.get(socket.id);
  if (!entry) return;

  // Rate limit (keyed by DB playerId so reconnects don't reset it within window).
  const now  = Date.now();
  const last = inventoryFetchCooldown.get(entry.playerId) ?? 0;
  if (now - last < INVENTORY_FETCH_COOLDOWN_MS) return;
  inventoryFetchCooldown.set(entry.playerId, now);

  let items: InventoryItemPayload[] = [];
  try {
    const rows = await db
      .select({
        itemSlug: rpInventoryItems.itemSlug,
        quantity: rpInventoryItems.quantity,
      })
      .from(rpInventoryItems)
      .where(eq(rpInventoryItems.playerId, entry.playerId))
      .orderBy(rpInventoryItems.itemSlug);

    items = rows
      .map((r) => resolveItem(r.itemSlug, r.quantity))
      .filter((it) => it.quantity > 0);
  } catch (err) {
    // Table may not exist yet (pre-migration) or DB is unreachable — log and
    // return an empty inventory. Empty is a valid state for this feature.
    logger.error({ err }, "[rpInventory] fetch failed; returning empty inventory");
    items = [];
  }

  socket.emit("rp:inventory", { items });
}

/** Clear a disconnecting player's fetch-cooldown entry. */
export function clearInventoryFetchForPlayer(playerId: string): void {
  inventoryFetchCooldown.delete(playerId);
}

/**
 * Phase 11D: ensure a player has the safe starter inventory items.
 *
 * Server-only. The playerId is supplied by the trusted player-load path
 * (never from the client). All rows insert with ON CONFLICT DO NOTHING against
 * the UNIQUE(player_id, item_slug) index, so this is fully idempotent: calling
 * it on every reconnect/respawn/refresh inserts each missing starter item
 * exactly once and never duplicates or overwrites existing quantities. Existing
 * players who predate this phase receive any missing starter items on next join.
 *
 * Read-only foundation: this only inserts inventory rows. It touches no wallet,
 * bank, license, job, faction, vehicle, or city-budget state. Failures are
 * logged (without player or socket ids) and swallowed so login never blocks.
 */
export async function ensureStarterInventoryForPlayer(playerId: string): Promise<void> {
  if (!playerId) return;
  try {
    await db
      .insert(rpInventoryItems)
      .values(
        STARTER_ITEMS.map((s) => ({
          playerId,
          itemSlug: s.slug,
          quantity: s.quantity,
        })),
      )
      .onConflictDoNothing();
  } catch (err) {
    // Table may not exist yet (pre-migration) or DB unreachable — never fatal.
    logger.error({ err }, "[rpInventory] starter seed failed");
  }
}
