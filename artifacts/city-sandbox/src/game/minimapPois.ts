// =============================================================
// Minimap POI / blip layer — GTA-style map markers.
// -------------------------------------------------------------
// CLIENT-ONLY, fully data-driven. Every marker's world position is
// READ from the existing authoritative shared constants (RP_BUILDINGS,
// RP_HOUSES, ATM_LOCATIONS, TRAIN_STATIONS, EVENT_HALL, gang turf) — we
// never hardcode a coordinate here. Move a building in rpTypes.ts and its
// blip moves automatically; the minimap can't drift from the world.
//
// This module adds ONLY presentation metadata (icon glyph, color, draw
// size, overlap priority) keyed by the source id, and projects each source
// to a flat { x, z } the canvas Minimap consumes via its toMapX/toMapZ.
// No gameplay, collision, server, or coordinate changes.
// =============================================================

import {
  RP_BUILDINGS,
  RP_HOUSES,
  ATM_LOCATIONS,
  GROVE_STREET_HANGOUT_POS,
} from "../shared/rpTypes";
import { TRAIN_STATIONS } from "../shared/cityData";
import { EVENT_HALL } from "../shared/eventHall";
import { NEMO_HOOD_HANGOUT_POS } from "../shared/nemoHood";

export type MinimapPoi = {
  id: string;
  label: string;
  x: number;
  z: number;
  /** Emoji glyph drawn centered on the blip. */
  icon: string;
  /** Blip disc fill (category color). */
  color: string;
  /** Blip outline; defaults to a soft white at draw time when omitted. */
  stroke?: string;
  /** Blip disc diameter in canvas px. */
  size: number;
  /** Higher = more important: drawn LAST so it wins overlap in the dense
   *  downtown cluster (1px ≈ 5m, so civic blips pack tightly). */
  priority: number;
};

// Per-building presentation, keyed by RP_BUILDINGS id. Coordinates come from
// the building def itself — only the look lives here.
const BUILDING_STYLE: Record<
  string,
  { icon: string; color: string; size: number; priority: number }
> = {
  police_station:    { icon: "🚓", color: "#3a7bff", size: 13, priority: 10 },
  medic_center:      { icon: "🏥", color: "#ff4d4d", size: 13, priority: 9 },
  government_office: { icon: "🏛️", color: "#ffd23f", size: 13, priority: 9 },
  licensing_office:  { icon: "🪪", color: "#36c275", size: 12, priority: 8 },
  dealership:        { icon: "🚗", color: "#4ab3ff", size: 12, priority: 7 },
  mechanic_garage:   { icon: "🔧", color: "#ff9f1c", size: 11, priority: 7 },
  taxi_depot:        { icon: "🚕", color: "#ffd23f", size: 11, priority: 7 },
  delivery_hub:      { icon: "📦", color: "#c98a5e", size: 11, priority: 6 },
  city_worker_depot: { icon: "🏗️", color: "#e0892b", size: 11, priority: 5 },
};
const BUILDING_FALLBACK = { icon: "📍", color: "#9bb1c9", size: 10, priority: 4 };

function buildPois(): MinimapPoi[] {
  const out: MinimapPoi[] = [];

  // 1. Civic service buildings (City Hall, police, medic, DMV, dealership,
  //    mechanic, taxi, delivery, public works) — from RP_BUILDINGS.
  for (const b of RP_BUILDINGS) {
    const s = BUILDING_STYLE[b.id] ?? BUILDING_FALLBACK;
    out.push({ id: `bld-${b.id}`, label: b.label, x: b.x, z: b.z, ...s });
  }

  // 2. Train stations — from TRAIN_STATIONS (cx/cz centerline).
  for (const st of TRAIN_STATIONS) {
    out.push({
      id: `station-${st.id}`,
      label: st.signText,
      x: st.cx,
      z: st.cz,
      icon: "🚉",
      color: "#00e5ff",
      size: 12,
      priority: 8,
    });
  }

  // 3. Grand Plaza Hall — from EVENT_HALL footprint center.
  out.push({
    id: `hall-${EVENT_HALL.id}`,
    label: "Grand Plaza Hall",
    x: EVENT_HALL.x,
    z: EVENT_HALL.z,
    icon: "🎭",
    color: "#b06fff",
    size: 12,
    priority: 8,
  });

  // 4. Starter houses — from RP_HOUSES.
  for (const h of RP_HOUSES) {
    out.push({
      id: `house-${h.slug}`,
      label: h.label,
      x: h.x,
      z: h.z,
      icon: "🏠",
      color: "#9b7b50",
      size: 9,
      priority: 4,
    });
  }

  // 5. Gang turf landmarks — Grove Street + Nemo Gang hood hangouts.
  out.push({
    id: "turf-grove-street",
    label: "Grove Street",
    x: GROVE_STREET_HANGOUT_POS[0],
    z: GROVE_STREET_HANGOUT_POS[2],
    icon: "🚩",
    color: "#58d68d",
    size: 9,
    priority: 4,
  });
  out.push({
    id: "turf-nemo-hood",
    label: "Nemo Gang",
    x: NEMO_HOOD_HANGOUT_POS[0],
    z: NEMO_HOOD_HANGOUT_POS[2],
    icon: "🐾",
    color: "#b06fff",
    size: 10,
    priority: 5,
  });

  // 6. ATMs — from ATM_LOCATIONS ([x,y,z] pos; no label of their own).
  for (const a of ATM_LOCATIONS) {
    out.push({
      id: a.id,
      label: "ATM",
      x: a.pos[0],
      z: a.pos[2],
      icon: "🏧",
      color: "#2ecc71",
      size: 8,
      priority: 3,
    });
  }

  // Stable ascending sort so high-priority blips paint LAST (on top) when
  // downtown markers overlap.
  return out.sort((p, q) => p.priority - q.priority);
}

/** All minimap blips, pre-sorted by ascending priority. Module-constant so the
 *  HUD never rebuilds it per frame. */
export const MINIMAP_POIS: ReadonlyArray<MinimapPoi> = buildPois();
