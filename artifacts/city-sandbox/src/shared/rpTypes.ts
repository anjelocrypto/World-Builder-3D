/**
 * Shared RP types — consumed by client UI and used as the shape of server
 * socket payloads. The api-server NEVER imports from city-sandbox; it emits
 * plain objects that conform to these interfaces.
 */

// ── Profile types ──────────────────────────────────────────────────────────

export interface ActiveTest {
  vehicleId:   string;
  checkpoints: [number, number, number][];
  nextCp:      number;
}

/** Phase 3: one player-owned vehicle as returned by the server. */
export interface OwnedVehicleSummary {
  dbId:      string;
  vehicleId: string;
  model:     string;
  variant:   string;
  color:     string;
  plate:     string;
  locked:    boolean;
}

/** Phase 3: one entry in the dealership catalog as used by the shop UI. */
export interface VehicleShopItem {
  model:   string;
  variant: string;
  price:   number;
  colors:  readonly string[];
}

/** Phase 4+: active job route payload. Phase 5A adds label + mode. */
export interface ActiveJob {
  job:         string;
  /** Human-readable name for HUD display (e.g. "City Worker", "Taxi Driver"). */
  label:       string;
  /** "walk" = on-foot route; "vehicle" = must be driving. */
  mode:        "walk" | "vehicle";
  checkpoints: [number, number, number][];
  nextCp:      number;
  pay:         number;
  /**
   * Phase 5C: Unix ms when the mechanic repair started (set when nextCp advances
   * to 1). Null / undefined for all other jobs.
   */
  repairStartedAt?: number | null;
  /**
   * Phase 5D: Unix ms when the paramedic started treating the patient (set when
   * nextCp advances to 1). Null / undefined for all other jobs.
   */
  treatmentStartedAt?: number | null;
}

export interface RpProfile {
  playerId:      string;
  cash:          number;
  bank:          number;
  driverLicense: boolean;
  weaponLicense: boolean;
  /** Unix ms timestamp; null means the player is not jailed. */
  jailUntil:     number | null;
  /** Reason for current jail sentence; null when not jailed. */
  jailReason:    string | null;
  factionId:     string | null;
  /** Denormalised from rp_factions.slug for fast HUD render. */
  factionSlug:   string | null;
  /** Denormalised from rp_factions.name — null when player has no faction. */
  factionName:   string | null;
  /** Denormalised from rp_factions.type — null when player has no faction. */
  factionType:   string | null;
  /** Denormalised from rp_factions.color — null when player has no faction. */
  factionColor:  string | null;
  factionRank:   number;
  currentJob:    string | null;
  onDuty:        boolean;
  wantedStars:   number;
  /**
   * Phase 6C: socket.id of the officer who cuffed this player, or null.
   * In-memory on server; cleared on disconnect, arrest, release, or timeout.
   */
  cuffedBy:      string | null;
  /** Phase 6C: Unix ms when the cuff auto-expires; null when not cuffed. */
  cuffedUntil:   number | null;
  /** Non-null only while a driver-license test is in progress. */
  activeTest:    ActiveTest | null;
  /** Phase 3: vehicles owned by this player. Empty until server sends them. */
  ownedVehicles: OwnedVehicleSummary[];
  /** Phase 4: non-null while a City Worker route is active. */
  activeJob:     ActiveJob | null;
}

export interface RpToast {
  id:        number;   // client-assigned monotonic id for keying
  msg:       string;
  color:     "red" | "green" | "yellow" | "blue" | string;
  duration?: number;   // ms; default 3000
}

// ── Phase 7C: Faction management types ────────────────────────────────────

/**
 * Phase 7C: One faction row returned by rp:listFactions / rp:factionsListed.
 * Read-only — no DB UUIDs, just the public slug/name/type/color.
 */
export interface FactionSummary {
  slug:  string;
  name:  string;
  type:  string;
  color: string;
}

/**
 * Phase 7C: One online player's faction metadata returned by rp:listOnlinePlayers.
 * Read-only — no wallet, no location, no DB IDs.
 */
export interface OnlinePlayerFactionSummary {
  socketId:    string;
  username:    string;
  factionSlug: string | null;
  factionName: string | null;
  factionType: string | null;
  factionRank: number;
}

/** Phase 7A: one faction chat message received from server via rp:factionChat. */
export interface RpFactionMessage {
  /** client-assigned monotonic id for React keying */
  id:           number;
  fromId:       string;
  fromName:     string;
  factionSlug:  string;
  factionName:  string;
  factionColor: string;
  msg:          string;
  /** Unix ms — server createdAt */
  createdAt:    number;
}

// ── Phase 7D: Gang types ──────────────────────────────────────────────────

/**
 * Phase 7D: Server emits this via rp:gangStatus in response to rp:gangStatus request.
 * Non-gang players receive isMember=false (all other fields are null/0).
 */
export interface GangStatus {
  isMember:           boolean;
  isGroveStreet:      boolean;
  factionSlug:        string | null;
  factionName:        string | null;
  factionColor:       string | null;
  factionRank:        number;
  /** P2: human-readable turf name (e.g. "Grove Street"); null for non-members. */
  turfName:           string | null;
  /** P2: count of online players in the same faction. */
  memberCountOnline:  number;
  /** Turf geometry as reported by server (allows future server-driven turf changes). */
  hangoutPos:    [number, number, number];
  hangoutRadius: number;
  turfCenter:    [number, number, number];
  turfRadius:    number;
}

/**
 * Phase 7D: Broadcast by server to faction members when a member claims presence
 * in the turf zone via rp:gangAction { action: "claim_presence" }.
 * Safe payload — no coordinates exposed.
 */
export interface GangPresenceEvent {
  /** Socket ID of the broadcasting member. */
  fromId:      string;
  /** Display name of the broadcasting member. */
  fromName:    string;
  factionSlug: string;
  /** Human-readable turf name, e.g. "Grove Street". */
  turfName:    string;
  /** Server Unix ms timestamp. */
  createdAt:   number;
}

/**
 * Phase 7E: An inbound gang join request as received by a leader via rp:gangJoinRequests.
 * Safe — no position data, no sensitive fields.
 */
export interface GangJoinRequest {
  fromId:      string;
  fromName:    string;
  factionSlug: string;
  ts:          number;
}

/**
 * Phase 7E: Result emitted to the requesting player via rp:gangJoinResult.
 */
export interface GangJoinResult {
  accepted:     boolean;
  factionSlug:  string;
  factionName?: string;
  factionColor?: string;
}

/**
 * Phase 7E: Confirmation emitted to the requester via rp:gangJoinRequestSent.
 */
export interface GangJoinRequestSent {
  factionSlug: string;
  factionName: string;
}

// ── Phase 7F: Gang Roster types ───────────────────────────────────────────────

/**
 * A single row in the gang roster returned by rp:gangRoster.
 * Safe fields only — no token, cash, bank, position, or socket IDs.
 * playerId is the DB UUID; needed for rp:gangSetRank / rp:gangRemoveMember.
 */
export interface GangRosterMember {
  playerId:    string;
  username:    string;
  factionRank: number;
  rankLabel:   string;
  isOnline:    boolean;
}

// ── World coordinate constants ─────────────────────────────────────────────
// All positions are [x, y, z] in world-space. rotY convention: 0 = front
// toward −Z (matches vehicleObb + LocalPlayer updateVehicle forward axis).

/** Platform center of Central Loop Station exterior (ground level). */
export const STATION_MARKER_POS: [number, number, number] = [132, 0, -65];

/**
 * Primary player spawn — ground-level exterior east of the Central Loop
 * Station stair foot (x=122). Validated against all buildings, roads, parked
 * cars, and static obstacles. See NEMOVERSE_RP_PLAN.md §5.3 + §5.4.
 */
export const STATION_SPAWN: [number, number, number] = [128, 1, -65];

/** Random jitter applied per-spawn: X ∈ [−JITTER_X, +JITTER_X]. */
export const STATION_SPAWN_JITTER_X = 4;
/** Random jitter applied per-spawn: Z ∈ [−JITTER_Z, +JITTER_Z]. */
export const STATION_SPAWN_JITTER_Z = 3;

/** Licensing Office (DMV / auto school) — S-center inner block.
 *  Phase 9B-3: moved (14,−30)→(17,−29). Must mirror server cityData.ts. */
export const LICENSING_OFFICE_POS: [number, number, number] = [17, 0, -29];

/** Vehicle dealership entrance — NE outer district. */
export const DEALERSHIP_POS: [number, number, number] = [68, 0, -72];

/**
 * Dealership catalog — mirrors server VEHICLE_SHOP_CATALOG in cityData.ts.
 * Must stay in sync; the server allowlist is authoritative.
 */
export const VEHICLE_SHOP_CATALOG: VehicleShopItem[] = [
  { model: "compact", variant: "compact", price: 300, colors: ["#e84141", "#4169e1", "#f5f5f5", "#2d2d2d"] },
  { model: "sedan",   variant: "sedan",   price: 700, colors: ["#e84141", "#4169e1", "#f5f5f5", "#2d2d2d", "#1a5c1a"] },
  { model: "taxi",    variant: "taxi",    price: 900, colors: ["#f5c518"] },
  { model: "van",     variant: "van",     price: 1200, colors: ["#e84141", "#f5f5f5", "#1a5c1a", "#2d2d2d"] },
];

/**
 * Test vehicle starting position. Phase 9B-3: (13,−30)→(11,−30); OBB-verified
 * clear of all road carriageways and outside the relocated DMV footprint.
 * Must mirror server cityData.ts.
 */
export const TEST_VEHICLE_SPAWN: [number, number, number] = [11, 0.6, -30];

/** Cash cost to attempt the driver license test (Phase 2). */
export const TEST_FEE = 200;

// ── Phase 4: City Worker job constants ────────────────────────────────────
// These MUST stay in sync with CITY_WORKER_* in api-server/src/socket/cityData.ts.

/** City Worker depot position [x, y, z].
 *  Phase 9A: moved (30,28)→(24,24). Must mirror server cityData.ts. */
export const CITY_WORKER_DEPOT: [number, number, number] = [24, 0, 24];

/** Radius (m) within which the player can clock in/out at the depot. */
export const CITY_WORKER_DEPOT_RADIUS = 6;

/** Walking patrol checkpoints around the central plaza (server-authoritative order). */
export const CITY_WORKER_CHECKPOINTS: [number, number, number][] = [
  [ 22, 0.5, -18],  // CP0 — E side, south half
  [ 22, 0.5,  18],  // CP1 — E side, north half
  [-22, 0.5,  18],  // CP2 — W side, north half
  [-22, 0.5, -18],  // CP3 — W side, south half
];

/** Pay for completing a full City Worker route. */
export const JOB_CITY_WORKER_PAY = 120;

/** Acceptance radius (m) for each job checkpoint. */
export const JOB_CP_ACCEPT_RADIUS = 8;

/**
 * License-test checkpoint route (Phase 2).
 * South on x=0 road → east on z=−45 → north on x=45 → finish at office.
 */
export const LICENSE_TEST_CHECKPOINTS: [number, number, number][] = [
  [  2, 0.5, -40],   // CP0 — south on x=0 road, approaching z=−45 intersection
  [ 42, 0.5, -44],   // CP1 — east on z=−45 road, at x=45 intersection
  [ 42, 0.5, -14],   // CP2 — north on x=45 road, mid-block
  [ 17, 0.5, -23.5], // CP3 — Phase 9B-3: finish at the relocated DMV door (off-road)
];

// ── Phase 5A: Taxi Driver job constants ───────────────────────────────────
// These MUST stay in sync with TAXI_* in api-server/src/socket/cityData.ts.

/** Taxi Depot position [x, y, z].
 *  Phase 9B-1: moved (−30,−15)→(−28,16). Must mirror server cityData.ts. */
export const TAXI_DEPOT: [number, number, number] = [-28, 0, 16];

/** Radius (m) within which the player can clock in/out at the Taxi Depot. */
export const TAXI_DEPOT_RADIUS = 6;

/** Acceptance radius (m) for taxi pickup/dropoff stages. */
export const TAXI_CP_ACCEPT_RADIUS = 12;

// ── Phase 5B: Delivery Driver job constants ───────────────────────────────
// These MUST stay in sync with DELIVERY_* in api-server/src/socket/cityData.ts.

/** Delivery Hub position [x, y, z]. */
export const DELIVERY_HUB: [number, number, number] = [58, 0, -28];

/** Radius (m) within which the player can clock in/out at the Delivery Hub. */
export const DELIVERY_HUB_RADIUS = 6;

/** Acceptance radius (m) for delivery pickup/dropoff stages. */
export const DELIVERY_CP_ACCEPT_RADIUS = 12;

// ── Phase 5C: Mechanic job constants ──────────────────────────────────────
// These MUST stay in sync with MECHANIC_* in api-server/src/socket/cityData.ts.

/** Mechanic Garage position [x, y, z]. */
export const MECHANIC_GARAGE: [number, number, number] = [-68, 0, -28];

/** Radius (m) within which the player can clock in/out at the Mechanic Garage. */
export const MECHANIC_GARAGE_RADIUS = 6;

/** Acceptance radius (m) for mechanic service call targets. */
export const MECHANIC_SERVICE_RADIUS = 12;

/** Duration (ms) the player must stay near the broken vehicle for repair. */
export const MECHANIC_REPAIR_DURATION_MS = 8_000;

// ── Phase 5D: Medic / Paramedic job constants ─────────────────────────────
// These MUST stay in sync with MEDIC_* in api-server/src/socket/cityData.ts.

/** Medical Center position [x, y, z]. */
export const MEDIC_CENTER: [number, number, number] = [-68, 0, 28];

/** Radius (m) within which the player can clock in/out at the Medical Center. */
export const MEDIC_CENTER_RADIUS = 6;

/** Emergency Room drop-off bay [x, y, z]. */
export const MEDIC_ER_BAY: [number, number, number] = [-45, 0.5, 28];

/** Acceptance radius (m) for patient and ER bay checkpoints. */
export const MEDIC_SERVICE_RADIUS = 12;

/** Duration (ms) the paramedic must stay on scene for treatment. */
export const MEDIC_TREATMENT_DURATION_MS = 6_000;

// ── Phase 5E: Police Patrol job constants ──────────────────────────────────
// These MUST stay in sync with POLICE_* in api-server/src/socket/cityData.ts.

/** Police Station position [x, y, z].
 *  Phase 9B-4: cluster relocated (0,+50) to (−68,64). Must mirror server cityData.ts. */
export const POLICE_STATION: [number, number, number] = [-68, 0, 64];

/** Radius (m) within which the player can clock in/out at the Police Station. */
export const POLICE_STATION_RADIUS = 6;

/** Acceptance radius (m) for patrol checkpoint stages. */
export const POLICE_PATROL_ACCEPT_RADIUS = 12;

// ── Phase 6A: Police Wanted + Arrest constants ────────────────────────────
// These MUST stay in sync with POLICE_JAIL_* / POLICE_ARREST_* in api-server/src/socket/cityData.ts.

/**
 * Jail cell world position — inside the Police Station compound.
 * Server uses this to clamp jailed player positions.
 */
export const POLICE_JAIL_CELL: [number, number, number] = [-68, 1, 64];

/**
 * Release position — where the player is teleported when jail expires.
 * Phase 9B-4: (−68,22) → (−68,72) (station offset +8 z).
 */
export const POLICE_RELEASE_POS: [number, number, number] = [-68, 1, 72];

/** Radius (m) for warrant issuance — how close the officer must be to the suspect. */
export const POLICE_WARRANT_RADIUS = 14;

/** Radius (m) for arrest — how close the officer must be to the suspect. */
export const POLICE_ARREST_RADIUS = 4;

/** Phase 6C: Radius (m) within which an officer can cuff a suspect. */
export const POLICE_CUFF_RADIUS = 4;

/** Phase 6D: Booking Desk world position — inside police station.
 *  Phase 9B-4: (−62,14) → (−62,64) (station offset +6 x). */
export const POLICE_BOOKING_DESK_POS: [number, number, number] = [-62, 0, 64];

/** Phase 6D: Radius (m) of the Booking Desk interaction zone. */
export const POLICE_BOOKING_RADIUS = 4;

/** Phase 6D: Radius (m) of the Release Exit trigger zone. */
export const POLICE_RELEASE_RADIUS = 4;

/** Phase 6E: Radius (m) within which an officer may issue a fine. */
export const POLICE_FINE_RADIUS = 8;

/** Phase 6E: Minimum fine amount. */
export const POLICE_MIN_FINE = 10;

// ── Phase 7D: Gang / turf constants (client-side) ────────────────────────────
// MUST stay in sync with GROVE_STREET_* in api-server/src/socket/cityData.ts.

/** World centre of the Grove Street gang hangout. */
export const GROVE_STREET_HANGOUT_POS: [number, number, number] = [95, 0, 65];

/** Interaction radius (m) — G opens gang HUD when player is this close. */
export const GROVE_STREET_HANGOUT_RADIUS = 8;

/** World centre of the turf territory ring. */
export const GROVE_STREET_TURF_CENTER: [number, number, number] = [95, 0, 65];

/** Visual radius (m) of the turf territory ring. */
export const GROVE_STREET_TURF_RADIUS = 30;

/** Phase 7D/7E: Minimum rank to perform any gang action (claim_presence, etc.). */
export const GANG_ACTION_MIN_RANK = 0;
/** Phase 7E: Minimum rank to accept/reject gang join requests. */
export const GANG_LEADER_MIN_RANK = 4;

// ── Phase 8A: Government Office / Mayor constants ─────────────────────────────
// MUST stay in sync with the corresponding exports in
// artifacts/api-server/src/socket/cityData.ts.

/** Government Office (City Hall) entrance position.
 *  Phase 9A: moved (−22,−32)→(−22,−22). Must mirror server cityData.ts. */
export const GOVERNMENT_OFFICE_POS: [number, number, number] = [-22, 0, -22];

/** Interaction radius (m) for the Government Office. */
export const GOVERNMENT_OFFICE_RADIUS = 8;

/** Maximum characters a mayor may send in one city announcement. */
export const MAYOR_ANNOUNCE_MAX_CHARS = 200;

/** Minimum rank required to be a Mayor and broadcast city announcements. */
export const MAYOR_MIN_RANK = 4;

/**
 * A city-wide announcement broadcast by the Mayor via rp:cityAnnounce.
 * Safe payload: no faction slug, no socketId, no playerId, no coordinates.
 */
export interface CityAnnouncement {
  /** Trimmed announcement text (1–MAYOR_ANNOUNCE_MAX_CHARS chars). */
  msg:       string;
  /** Server-authoritative display name of the Mayor who sent it. */
  fromName:  string;
  /** Unix ms when the server accepted and broadcast the announcement. */
  createdAt: number;
}

// ── Phase 8F: City Projects ────────────────────────────────────────────────────
// MUST stay in sync with CITY_PROJECT_DEFS in api-server/src/socket/cityData.ts.

/** One active city project as emitted in rp:cityProjects. */
export interface ActiveCityProject {
  projectId: string;
  label:     string;
  expiresAt: number; // Unix ms — client computes remainingMs = expiresAt - Date.now()
}

/**
 * Client-side project catalogue (mirrors server CITY_PROJECT_DEFS).
 *
 * `effect` is a short display-only summary of the active gameplay effects.
 * Phase 8F added the +10% payout boost; Phase 8G added the 50% cooldown cut.
 * These values are authoritative on the server — this is purely for UI.
 */
export const CITY_PROJECT_DEFS_CLIENT = [
  {
    id:     "public_works",
    label:  "Public Works Boost",
    cost:   500,
    desc:   "City Worker & Delivery Driver: +10% payout and 50% shorter route cooldown for 10 min",
    effect: "+10% payout · 50% cooldown",
  },
  {
    id:     "transit_subsidy",
    label:  "Transit Subsidy",
    cost:   400,
    desc:   "Taxi Driver: +10% payout and 50% shorter route cooldown for 10 min",
    effect: "+10% payout · 50% cooldown",
  },
  {
    id:     "emergency_funding",
    label:  "Emergency Services Funding",
    cost:   600,
    desc:   "Medic, Mechanic & Police Patrol: +10% payout and 50% shorter cooldown for 10 min",
    effect: "+10% payout · 50% cooldown",
  },
] as const;

export type CityProjectId = typeof CITY_PROJECT_DEFS_CLIENT[number]["id"];

// ── Phase 8H: City Dashboard ────────────────────────────────────────────────────

/**
 * Read-only government dashboard snapshot emitted in rp:cityDashboard.
 *
 * Built entirely from aggregated server state. Contains NO per-player
 * identifiers, coordinates, wallet values, tokens, or usernames — only
 * counts and values the server already exposes (taxRate, cityBudget, project
 * labels). Display-only on the client.
 */
export interface CityDashboard {
  taxRate:    number;
  cityBudget: number;
  /** Active projects (same label + expiry shape as ActiveCityProject). */
  projects:   ActiveCityProject[];
  onlinePlayers: number;
  /** On-duty player counts keyed by job slug. */
  onDutyByJob:   Record<string, number>;
  /** Faction member counts keyed by faction type. */
  factionCounts: Record<string, number>;
  wantedPlayers: number;
  jailedPlayers: number;
  cuffedPlayers: number;
}

// ── Phase 8I: City Ledger ───────────────────────────────────────────────────────

/**
 * One read-only city budget ledger entry emitted in rp:cityLedger.
 * Privacy-safe: no per-player identifiers, coordinates, tokens, or balances.
 */
export interface CityLedgerEntry {
  id:        string;
  type:      "tax_revenue" | "government_grant" | "city_project_funded";
  amount:    number;
  label:     string;
  createdAt: number; // Unix ms
  note?:     string;
}

/** Read-only city ledger snapshot (most recent first, max 25 entries). */
export interface CityLedger {
  entries: CityLedgerEntry[];
}

// ── Phase 8E: City Grant constants ────────────────────────────────────────────
// MUST stay in sync with CITY_GRANT_* in api-server/src/socket/cityData.ts.

export const CITY_GRANT_MIN            = 50;
export const CITY_GRANT_MAX            = 1_000;
export const CITY_GRANT_NOTE_MAX_CHARS = 120;

// ── Phase 8B: City Tax Rate constants ─────────────────────────────────────────
// MUST stay in sync with CITY_TAX_* in api-server/src/socket/cityData.ts.

/** Minimum city tax rate (0 = no tax). */
export const CITY_TAX_MIN = 0;

/** Maximum city tax rate (0.15 = 15%). */
export const CITY_TAX_MAX = 0.15;

/** Default city tax rate on server start (5%). */
export const CITY_TAX_DEFAULT = 0.05;

/**
 * City config payload broadcast by the server via rp:cityConfig.
 * Emitted on initial request (rp:getCityConfig) and whenever the Mayor
 * changes the rate (rp:setTaxRate).
 * Safe payload: no socketId, no playerId, no faction, no coordinates.
 */
export interface CityConfig {
  /** Current server-authoritative tax rate (e.g. 0.05 for 5%). */
  taxRate:       number;
  /** Unix ms when the tax rate was last updated. */
  updatedAt:     number;
  /** Display name of the Mayor who last changed the rate; null if never changed. */
  updatedByName: string | null;
  /**
   * Phase 8D: Accumulated city budget from job tax revenue.
   * Server-authoritative; never set by the client.
   */
  cityBudget:    number;
}

// ── Phase 7H: Gang Territory Control types ───────────────────────────────────

/**
 * Safe territory snapshot emitted by the server via rp:gangTerritoryStatus.
 * No world coordinates, no socket IDs — server-derived counts only.
 */
export interface GangTerritoryStatus {
  territoryId:            string;
  name:                   string;
  controllingFactionSlug: string;
  contestedByFactionSlug: string | null;
  /** Defence / control progress for the controlling faction (0..100). */
  progress:               number;
  /** Unix ms when the state last changed. */
  lastUpdatedAt:          number;
  /** Count of controlling-faction players inside the territory right now. */
  friendlyCount:          number;
  /** Count of rival gang players inside the territory right now. */
  rivalCount:             number;
}

// ── Phase 7G: Tag Turf mission ─────────────────────────────────────────────
// MUST stay in sync with GROVE_TAG_* in api-server/src/socket/cityData.ts.

/** Client-side representation of an active Tag Turf gang mission. */
export interface ActiveGangMission {
  missionId:   string;
  factionSlug: string;
  /** All 3 ordered tag-point world positions [x, y, z]. */
  points:      [number, number, number][];
  /** Index of the next tag point the player must visit (0-based). */
  nextIdx:     number;
  /** Server timestamp (ms) when the mission was started. */
  startedAt:   number;
  /** Cash payout on successful completion. */
  pay:         number;
}

/**
 * Three ordered tag points for the "Tag Turf" mission.
 * Kept in sync with GROVE_TAG_POINTS on the server.
 */
export const GROVE_TAG_POINTS: [number, number, number][] = [
  [90, 0.5, 56],
  [108, 0.5, 72],
  [82, 0.5, 78],
];

/** Client-side proximity threshold for the checkpoint hit indicator (purely visual). */
export const GROVE_TAG_RADIUS = 8;

/** Cash payout displayed to the player before completion. */
export const GROVE_TAG_PAY = 150;

/** Cooldown (ms) after a completed mission before another can be started. */
export const GROVE_TAG_COOLDOWN_MS = 120_000;

/** Phase 6E: Pending fine state received from server via rp:fineIssued. */
export interface RpPendingFine {
  officerId:   string;
  officerName: string;
  amount:      number;
  reason:      string;
  expiresAt:   number; // Unix ms
}

// ── Phase 5F: Bank / ATM constants ────────────────────────────────────────
// These MUST stay in sync with ATM_* in api-server/src/socket/cityData.ts.

/**
 * ATM machine world positions — used by RPMarkers and LocalPlayer proximity.
 * Must match ATM_LOCATIONS in api-server/src/socket/cityData.ts exactly.
 */
export const ATM_LOCATIONS: { id: string; pos: [number, number, number] }[] = [
  { id: "atm-central",    pos: [  18, 0, -30] },
  { id: "atm-station",    pos: [ 132, 0, -58] },
  { id: "atm-police",     pos: [ -80, 0,  14] },
  { id: "atm-medical",    pos: [ -80, 0,  28] },
  { id: "atm-dealership", pos: [  82, 0, -78] },
];

/** Radius (m) within which a walking player can interact with an ATM. */
export const ATM_INTERACT_RADIUS = 4;

// ── Client-side optimistic license + lock check ────────────────────────────

/**
 * Returns true if a player with the given profile is allowed to drive
 * `vehicleId`. Accepts optional ownership fields so locked owned vehicles
 * are blocked optimistically before the server rejects them.
 *
 * This is an optimistic client check only — the server also enforces this in
 * vehicleUpdate. Never use the client result to unlock real game state; use it
 * only to skip the emitVehicleUpdate call and show feedback.
 */
export function canDriveVehicleClient(
  vehicleId: string,
  rp: RpProfile | null,
  vehicleOwned?: boolean,
  vehicleLocked?: boolean,
  vehicleOwnerId?: string,
): boolean {
  if (!rp) return false;
  // Phase 3: locked owned vehicle — only owner can enter
  if (vehicleOwned && vehicleLocked) {
    const isOwner = rp.ownedVehicles.some(
      (v) => v.vehicleId === vehicleId && v.dbId !== undefined,
    ) || vehicleOwnerId === rp.playerId;
    if (!isOwner) return false;
  }
  if (rp.driverLicense) return true;
  if (rp.activeTest?.vehicleId === vehicleId) return true;
  return false;
}

// ── Phase 9A Batch B: RP building footprints ──────────────────────────────────
//
// Mirror of RP_BUILDINGS in artifacts/api-server/src/socket/cityData.ts. The
// server validator asserts these footprints clear roads, cars, and each other;
// the client building renderer (later batch) reads the same table so geometry
// and validation never drift. Coordinates mirror the existing *_POS constants —
// do not edit one side without the other.

export type RpBuildingFacing = "north" | "south" | "east" | "west";

export interface RpBuildingDef {
  id:     string;
  x:      number;
  z:      number;
  w:      number;
  d:      number;
  facing: RpBuildingFacing;
  label:  string;
}

/** Metres the door/interact point sits outside the building's front wall. */
export const RP_BUILDING_DOOR_OFFSET = 1.5;

/** Minimum metres required between any two RP building footprint edges. */
export const RP_BUILDING_MIN_GAP = 6;

export const RP_BUILDINGS: ReadonlyArray<RpBuildingDef> = [
  { id: "government_office", x: GOVERNMENT_OFFICE_POS[0], z: GOVERNMENT_OFFICE_POS[2], w: 18, d: 12, facing: "south", label: "City Hall" },
  { id: "city_worker_depot", x: CITY_WORKER_DEPOT[0],     z: CITY_WORKER_DEPOT[2],     w: 16, d: 12, facing: "south", label: "Public Works Depot" },
  { id: "medic_center",      x: MEDIC_CENTER[0],          z: MEDIC_CENTER[2],          w: 18, d: 10, facing: "east",  label: "Medical Center" },
  { id: "mechanic_garage",   x: MECHANIC_GARAGE[0],       z: MECHANIC_GARAGE[2],       w: 18, d: 10, facing: "east",  label: "Mechanic Garage" },
  { id: "dealership",        x: DEALERSHIP_POS[0],        z: DEALERSHIP_POS[2],        w: 22, d: 16, facing: "north", label: "Dealership" },
  // Phase 9B-1: Taxi Depot — relocated SW-north pocket; small 10×8 yard.
  { id: "taxi_depot",        x: TAXI_DEPOT[0],            z: TAXI_DEPOT[2],            w: 10, d:  8, facing: "south", label: "Taxi Depot" },
  // Phase 9B-2: Delivery Hub warehouse. Centre (66,−26) is distinct from
  // DELIVERY_HUB (58,−28), the unchanged delivery payout origin.
  { id: "delivery_hub",      x: 66,                       z: -26,                      w: 18, d: 14, facing: "west",  label: "Delivery Hub" },
  // Phase 9B-3: Licensing Office (DMV). South door coincides with test finish CP3.
  { id: "licensing_office",  x: LICENSING_OFFICE_POS[0],  z: LICENSING_OFFICE_POS[2],  w: 10, d:  8, facing: "south", label: "Licensing Office" },
  // Phase 9B-4: Police Station — own SW precinct block.
  { id: "police_station",    x: POLICE_STATION[0],        z: POLICE_STATION[2],        w: 20, d: 14, facing: "south", label: "Police Station" },
];

/** Door/interact point for a building: front-edge midpoint pushed outside. */
export function rpBuildingDoor(b: RpBuildingDef): [number, number] {
  const o = RP_BUILDING_DOOR_OFFSET;
  switch (b.facing) {
    case "north": return [b.x, b.z - b.d / 2 - o];
    case "south": return [b.x, b.z + b.d / 2 + o];
    case "east":  return [b.x + b.w / 2 + o, b.z];
    case "west":  return [b.x - b.w / 2 - o, b.z];
  }
}

// ── Phase 9A Batch E: building door / interact points ─────────────────────────
// Mirror of the *_DOOR constants in artifacts/api-server/src/socket/cityData.ts.
// Visual interaction rings + the player-facing proximity source for these 5
// buildings are centred on the door. Payout origins / route checkpoints still
// use the *_POS constants. Must stay in sync with the server.

function buildingDoorById(id: string): [number, number, number] {
  const b = RP_BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`[rpTypes] no RP_BUILDINGS entry for door "${id}"`);
  const [dx, dz] = rpBuildingDoor(b);
  return [dx, 0, dz];
}

export const GOVERNMENT_OFFICE_DOOR: [number, number, number] = buildingDoorById("government_office");
export const CITY_WORKER_DEPOT_DOOR: [number, number, number] = buildingDoorById("city_worker_depot");
export const MEDIC_CENTER_DOOR:      [number, number, number] = buildingDoorById("medic_center");
export const MECHANIC_GARAGE_DOOR:   [number, number, number] = buildingDoorById("mechanic_garage");
export const DEALERSHIP_DOOR:        [number, number, number] = buildingDoorById("dealership");
export const TAXI_DEPOT_DOOR:        [number, number, number] = buildingDoorById("taxi_depot");
export const DELIVERY_HUB_DOOR:      [number, number, number] = buildingDoorById("delivery_hub");
export const LICENSING_OFFICE_DOOR:  [number, number, number] = buildingDoorById("licensing_office");
export const POLICE_STATION_DOOR:    [number, number, number] = buildingDoorById("police_station");
