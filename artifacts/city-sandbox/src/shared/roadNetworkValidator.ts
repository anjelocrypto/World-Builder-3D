/**
 * Road-network validator (READ-ONLY, client-only).
 *
 * Locks the car-road baseline numerically so future edits can't silently break
 * it. Changes NOTHING — pure analysis over the existing data exports
 * (REGIONAL_ROADS, ROADS, TRAFFIC_ROUTES, elevation profiles, building/obstacle
 * footprints). It does not touch coordinates, routes, collision, or gameplay.
 *
 * Checks:
 *   1. Inventory — every REGIONAL_ROADS entry has >=2 points and width>0; every
 *      ROAD_ELEVATION_PROFILES key is a real road with a matching-length
 *      profile; every MOUNTAIN_ROAD_ID is a real road. Nemo Hood loop is
 *      asserted cosmetic (no road id mentions it); train stations are asserted
 *      rail (their ids are not car roads).
 *   2. Connectivity — endpoint/intersection graph WITH mid-segment T-junction
 *      splicing (so the city-grid ends that land on the inner-city-ring
 *      centerline count as connected). Dead-ends are classified
 *      (driveway/spur, pedestrian, scenic/summit, suspicious). FAILS only on a
 *      suspicious dead-end or a near-miss gap on a non-intentional end.
 *   3. Traffic — every TRAFFIC_ROUTES segment is sampled: each sample must sit
 *      inside the nearest carriageway (signedClearance <= tol), its heading must
 *      match the segment tangent (<5 deg), and it must not fall inside any
 *      building / RP building / house / hall / hood house / station / obstacle
 *      footprint.
 *   4. Coverage — the canonical car-road set is exactly the city grid + every
 *      REGIONAL_ROADS entry, which is precisely what BiomeRender and the minimap
 *      iterate; the cosmetic Nemo Hood loop and rail platforms are explicitly
 *      excluded. (Structural guarantee asserted on the data the renderers read.)
 *   5. Overlap — no road CENTERLINE passes through any building/structure/
 *      obstacle footprint; no NON-exempt (i.e. non-driveway/-connector) road's
 *      carriageway deeply overlaps a structure.
 *
 * Run standalone:  pnpm exec tsx src/shared/roadNetworkValidator.ts
 *           (or)  node <jiti> src/shared/roadNetworkValidator.ts
 */

import {
  ROADS,
  CITY_HALF,
  REGIONAL_ROADS,
  ROAD_ELEVATION_PROFILES,
  MOUNTAIN_ROAD_IDS,
  TRAFFIC_ROUTES,
  BUILDINGS,
  STATIC_OBSTACLES,
  SPAWN_POINTS,
  TRAIN_STATIONS,
  WORLD_HALF,
} from "./cityData";
import { RP_BUILDINGS, RP_HOUSES } from "./rpTypes";
import { EVENT_HALL } from "./eventHall";
import { NEMO_HOOD_HOUSES } from "./nemoHood";
import { nearestRoad, ambientCarStateAt } from "./collision";
import { distancePointToSegment } from "./roadGeom";
import type { TrafficCarSeed } from "./types";

const DEG = 180 / Math.PI;

// ── Tunables ──────────────────────────────────────────────────────────────────
const NODE_TOL = 2.0;          // m — endpoints within this fuse into one node
const GAP_WARN = 6.0;          // m — a non-intentional end this close to another road = near-miss
const ONROAD_TOL = 1.0;        // m — traffic sample must be <= this signedClearance (<=0 = on road)
const HEADING_TOL_DEG = 5;     // deg — heading vs segment tangent
const CENTERLINE_SAMPLE = 2.0; // m — spacing for centerline overlap sampling
const STRUCT_DEEP_OVERLAP = 2.0; // m — carriageway intruding a structure by more than this = fail

// ── Canonical car-road set: city grid corridors + every REGIONAL_ROADS entry ──
type Poly = readonly (readonly [number, number])[];
interface CarRoad { id: string; points: Poly; width: number }

function buildCarRoads(): CarRoad[] {
  const out: CarRoad[] = [];
  for (const x of ROADS.ns) {
    out.push({ id: `city-ns-${x}`, points: [[x, -CITY_HALF], [x, CITY_HALF]], width: ROADS.width });
  }
  for (const z of ROADS.ew) {
    out.push({ id: `city-ew-${z}`, points: [[-CITY_HALF, z], [CITY_HALF, z]], width: ROADS.width });
  }
  for (const r of REGIONAL_ROADS) out.push({ id: r.id, points: r.points, width: r.width });
  return out;
}

// ── Structure footprints (AABBs) for overlap + off-road checks ───────────────
interface Box { id: string; x: number; z: number; w: number; d: number; kind: string }
function buildStructures(): Box[] {
  const s: Box[] = [];
  for (const b of BUILDINGS) s.push({ id: `bldg`, x: b.x, z: b.z, w: b.w, d: b.d, kind: "building" });
  for (const b of RP_BUILDINGS) s.push({ id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, kind: "rp" });
  for (const h of RP_HOUSES) s.push({ id: h.slug, x: h.x, z: h.z, w: h.w, d: h.d, kind: "house" });
  for (const h of NEMO_HOOD_HOUSES) s.push({ id: h.id, x: h.x, z: h.z, w: h.w, d: h.d, kind: "hood" });
  s.push({ id: "event-hall", x: EVENT_HALL.x, z: EVENT_HALL.z, w: EVENT_HALL.w, d: EVENT_HALL.d, kind: "hall" });
  for (const t of TRAIN_STATIONS) s.push({ id: t.id, x: t.cx, z: t.cz, w: t.w, d: t.d, kind: "station" });
  return s;
}
function buildObstacles(): Box[] {
  return STATIC_OBSTACLES.map((o) => ({ id: o.kind, x: o.x, z: o.z, w: o.w, d: o.d, kind: "obstacle" }));
}

function pointInBox(px: number, pz: number, b: Box, margin = 0): boolean {
  return Math.abs(px - b.x) <= b.w / 2 + margin && Math.abs(pz - b.z) <= b.d / 2 + margin;
}
function pointToBoxDist(px: number, pz: number, b: Box): number {
  const dx = Math.max(Math.abs(px - b.x) - b.w / 2, 0);
  const dz = Math.max(Math.abs(pz - b.z) - b.d / 2, 0);
  return Math.hypot(dx, dz);
}

// Roads that are ALLOWED to approach structures closely (driveways / spurs /
// connectors / the pedestrian Event-Hall path). They still may not be drawn
// straight through a building body (centerline-inside is checked for all).
function isApproachRoad(id: string): boolean {
  return (
    id.startsWith("drv-") ||
    id.endsWith("-connector") ||
    id === "gateway-spur" ||
    id === "trailhead-spur" ||
    id === "forest-spur" ||
    id === "mountain-lookout" ||
    id === "path-grand-plaza-hall"
  );
}

// Dead-end classification by the road id that terminates at the node.
type DeadKind = "driveway/spur" | "pedestrian" | "scenic/summit" | "suspicious";
function classifyDeadEnd(ids: string[]): DeadKind {
  const has = (pred: (s: string) => boolean) => ids.some(pred);
  if (has((s) => s.startsWith("drv-") || s === "forest-spur" || s === "gateway-spur" || s === "trailhead-spur"))
    return "driveway/spur";
  if (has((s) => s === "path-grand-plaza-hall")) return "pedestrian";
  if (has((s) => s === "mountain-switchbacks" || s === "mountain-lookout")) return "scenic/summit";
  return "suspicious";
}

export interface RoadReport {
  carRoads: number;
  segments: number;
  nodes: number;
  components: number;
  deadEnds: number;
  deadEndsByKind: Record<DeadKind, number>;
  suspicious: number;
  trafficSamples: number;
  worstSignedClearance: number;
  worstStructureClearance: number;
  minSpawnRoadClearance: number;
}

export function validateRoadNetwork(): RoadReport {
  const fail = (m: string): never => { throw new Error(`[roadNet] ${m}`); };
  const roads = buildCarRoads();
  const structures = buildStructures();
  const obstacles = buildObstacles();
  const allBoxes = [...structures, ...obstacles];

  // ---------- 1. Inventory ----------
  let segments = 0;
  const roadIds = new Set<string>();
  for (const r of roads) {
    if (r.points.length < 2) fail(`road ${r.id} has <2 points`);
    if (r.width <= 0) fail(`road ${r.id} has non-positive width ${r.width}`);
    roadIds.add(r.id);
    segments += r.points.length - 1;
    for (const [x, z] of r.points) {
      if (Math.abs(x) > WORLD_HALF || Math.abs(z) > WORLD_HALF) fail(`road ${r.id} vertex (${x},${z}) outside world`);
    }
  }
  // Elevation profiles must match their road's point count.
  for (const id of Object.keys(ROAD_ELEVATION_PROFILES)) {
    const r = REGIONAL_ROADS.find((rr) => rr.id === id);
    if (!r) fail(`ROAD_ELEVATION_PROFILES has unknown road id "${id}"`);
    else if (ROAD_ELEVATION_PROFILES[id].length !== r.points.length)
      fail(`profile "${id}" length ${ROAD_ELEVATION_PROFILES[id].length} != points ${r.points.length}`);
  }
  for (const id of MOUNTAIN_ROAD_IDS) {
    if (!REGIONAL_ROADS.some((rr) => rr.id === id)) fail(`MOUNTAIN_ROAD_IDS has unknown road id "${id}"`);
  }
  // Cosmetic / rail exclusions: no car road may share an id with a station, and
  // no car-road id may reference the Nemo Hood (its loop is a decal, not a road).
  for (const t of TRAIN_STATIONS) {
    if (roadIds.has(t.id)) fail(`train station "${t.id}" is also a car road — should be rail-only`);
  }
  if ([...roadIds].some((id) => /nemo|hood/i.test(id))) fail("a car road references Nemo Hood (its loop must stay cosmetic)");

  // ---------- 2. Connectivity graph (with mid-segment T-junctions) ----------
  interface Node { x: number; z: number; ids: Set<string>; adj: Set<number> }
  const nodes: Node[] = [];
  const findNode = (x: number, z: number): number => {
    for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].x - x, nodes[i].z - z) <= NODE_TOL) return i;
    nodes.push({ x, z, ids: new Set(), adj: new Set() });
    return nodes.length - 1;
  };
  // Vertices → nodes; consecutive vertices → edges.
  const roadNodeIdx: number[][] = [];
  for (const r of roads) {
    const idxs = r.points.map(([x, z]) => { const n = findNode(x, z); nodes[n].ids.add(r.id); return n; });
    roadNodeIdx.push(idxs);
    for (let i = 0; i < idxs.length - 1; i++) {
      nodes[idxs[i]].adj.add(idxs[i + 1]);
      nodes[idxs[i + 1]].adj.add(idxs[i]);
    }
  }
  // Mid-segment incidence: a node lying ON another road's segment interior
  // splices into it (this is how the city-grid ends join the inner ring).
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    for (let ri = 0; ri < roads.length; ri++) {
      const idxs = roadNodeIdx[ri];
      for (let s = 0; s < idxs.length - 1; s++) {
        const aI = idxs[s], bI = idxs[s + 1];
        if (aI === ni || bI === ni) continue;
        const A = nodes[aI], B = nodes[bI];
        const d = distancePointToSegment(n.x, n.z, A.x, A.z, B.x, B.z);
        if (d > NODE_TOL) continue;
        const nearA = Math.hypot(n.x - A.x, n.z - A.z) <= NODE_TOL;
        const nearB = Math.hypot(n.x - B.x, n.z - B.z) <= NODE_TOL;
        if (nearA || nearB) continue; // endpoint, already handled
        n.adj.add(aI); A.adj.add(ni);
        n.adj.add(bI); B.adj.add(ni);
      }
    }
  }
  // Connected components.
  const seen = new Set<number>();
  let components = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (seen.has(i)) continue;
    components++;
    const st = [i];
    while (st.length) { const c = st.pop()!; if (seen.has(c)) continue; seen.add(c); for (const nb of nodes[c].adj) if (!seen.has(nb)) st.push(nb); }
  }
  // Dead-ends (degree 1).
  const deadEndsByKind: Record<DeadKind, number> = { "driveway/spur": 0, "pedestrian": 0, "scenic/summit": 0, "suspicious": 0 };
  const suspiciousList: string[] = [];
  let deadEnds = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].adj.size !== 1) continue;
    deadEnds++;
    const ids = [...nodes[i].ids];
    const kind = classifyDeadEnd(ids);
    deadEndsByKind[kind]++;
    if (kind === "suspicious") {
      // Near-miss check: is this loose end almost touching another road?
      let nearMiss = Infinity;
      for (let ri = 0; ri < roads.length; ri++) {
        if (ids.includes(roads[ri].id)) continue;
        const idxs = roadNodeIdx[ri];
        for (let s = 0; s < idxs.length - 1; s++) {
          const A = nodes[idxs[s]], B = nodes[idxs[s + 1]];
          const d = distancePointToSegment(nodes[i].x, nodes[i].z, A.x, A.z, B.x, B.z);
          if (d < nearMiss) nearMiss = d;
        }
      }
      const tag = `(${nodes[i].x},${nodes[i].z}) [${ids.join(",")}]` + (nearMiss <= GAP_WARN ? ` near-miss ${nearMiss.toFixed(1)}m` : "");
      suspiciousList.push(tag);
    }
  }
  if (suspiciousList.length > 0) {
    fail(`suspicious dead-end(s): ${suspiciousList.join("; ")}`);
  }

  // ---------- 5. Overlap: no centerline through any footprint ----------
  let worstStructureClearance = Infinity; // most-negative = deepest carriageway overlap of a structure (non-exempt roads)
  for (const r of roads) {
    const exempt = isApproachRoad(r.id);
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const segLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(segLen / CENTERLINE_SAMPLE));
      for (let s = 0; s <= steps; s++) {
        const px = ax + (bx - ax) * (s / steps);
        const pz = az + (bz - az) * (s / steps);
        // (a) centerline must not pass through any structure/obstacle body.
        for (const box of allBoxes) {
          if (pointInBox(px, pz, box)) {
            fail(`road ${r.id} centerline passes through ${box.kind} ${box.id} at (${px.toFixed(0)},${pz.toFixed(0)})`);
          }
        }
        // (b) non-exempt carriageway must not deeply overlap a structure.
        if (!exempt) {
          for (const box of structures) {
            const clear = pointToBoxDist(px, pz, box) - r.width / 2;
            if (clear < worstStructureClearance) worstStructureClearance = clear;
            if (clear < -STRUCT_DEEP_OVERLAP) {
              fail(`road ${r.id} carriageway overlaps ${box.kind} ${box.id} by ${(-clear).toFixed(1)}m at (${px.toFixed(0)},${pz.toFixed(0)})`);
            }
          }
        }
      }
    }
  }

  // ---------- 3. Traffic-route alignment ----------
  const probe: TrafficCarSeed = { id: "_rnv", variant: "sedan", phase: 0, color: "#000" };
  let trafficSamples = 0;
  let worstSignedClearance = -Infinity;
  for (const route of TRAFFIC_ROUTES) {
    const n = route.waypoints.length;
    for (let k = 0; k < n; k++) {
      const a = route.waypoints[k];
      const b = route.waypoints[(k + 1) % n];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segLen < 1e-6) continue;
      const tangent = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
      for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const tMs = ((k + t) / n) * route.cycleSeconds * 1000;
        const c = ambientCarStateAt(route, probe, tMs);
        trafficSamples++;
        // (a) inside a carriageway.
        const nr = nearestRoad(c.x, c.z);
        if (nr.signedClearance > worstSignedClearance) worstSignedClearance = nr.signedClearance;
        if (nr.signedClearance > ONROAD_TOL) {
          fail(`route ${route.id} seg ${k} t=${t}: off-road by ${nr.signedClearance.toFixed(1)}m at (${c.x.toFixed(0)},${c.z.toFixed(0)}) nearest=${nr.id}`);
        }
        // (b) heading vs tangent.
        let dh = tangent - c.rotY;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        if (Math.abs(dh) * DEG > HEADING_TOL_DEG) {
          fail(`route ${route.id} seg ${k} t=${t}: heading off tangent by ${(Math.abs(dh) * DEG).toFixed(0)}deg`);
        }
        // (c) not inside any structure/obstacle footprint.
        for (const box of allBoxes) {
          if (pointInBox(c.x, c.z, box)) {
            fail(`route ${route.id} seg ${k} t=${t}: car inside ${box.kind} ${box.id} at (${c.x.toFixed(0)},${c.z.toFixed(0)})`);
          }
        }
      }
    }
  }

  // ---------- 6. Spawn clearance (informational; fail only if deep in a carriageway) ----------
  let minSpawnRoadClearance = Infinity;
  for (const [sx, , sz] of SPAWN_POINTS) {
    const nr = nearestRoad(sx, sz);
    if (nr.signedClearance < minSpawnRoadClearance) minSpawnRoadClearance = nr.signedClearance;
    if (nr.signedClearance < -3) {
      fail(`spawn (${sx},${sz}) sits ${(-nr.signedClearance).toFixed(1)}m inside carriageway ${nr.id}`);
    }
  }

  return {
    carRoads: roads.length,
    segments,
    nodes: nodes.length,
    components,
    deadEnds,
    deadEndsByKind,
    suspicious: deadEndsByKind.suspicious,
    trafficSamples,
    worstSignedClearance: +worstSignedClearance.toFixed(2),
    worstStructureClearance: +worstStructureClearance.toFixed(2),
    minSpawnRoadClearance: +minSpawnRoadClearance.toFixed(2),
  };
}

const isMain = typeof process !== "undefined" && process.argv?.[1]?.includes("roadNetworkValidator");
if (isMain) {
  const r = validateRoadNetwork();
  // eslint-disable-next-line no-console
  console.info(
    `[roadNet] PASS — ${r.carRoads} car roads, ${r.segments} segments, ${r.nodes} graph nodes, ` +
    `${r.components} component(s); dead-ends ${r.deadEnds} ` +
    `(driveway/spur ${r.deadEndsByKind["driveway/spur"]}, pedestrian ${r.deadEndsByKind.pedestrian}, ` +
    `scenic/summit ${r.deadEndsByKind["scenic/summit"]}, suspicious ${r.suspicious}); ` +
    `${r.trafficSamples} traffic samples, worst on-road clearance ${r.worstSignedClearance}m, ` +
    `worst structure clearance ${r.worstStructureClearance}m, min spawn clearance ${r.minSpawnRoadClearance}m`,
  );
}
