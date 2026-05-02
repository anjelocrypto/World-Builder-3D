// =============================================================
// Pure 2D road geometry helpers
// =============================================================
//
// Lives in its own module so both cityData (which defines roads and
// runs the dev-mode validator) and collision (which exposes
// nearestRoad to gameplay code) can use it without forming an import
// cycle. No imports from cityData here — keep this file dependency-
// free and side-effect-free.

export type Point2 = readonly [number, number];

// Shortest distance from point P to the line segment A–B in the X/Z
// plane. Standard "project P onto AB, clamp the parameter to [0,1],
// then take Euclidean distance to that foot point" technique.
export function distancePointToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) {
    return Math.hypot(px - ax, pz - az);
  }
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

// Shortest distance from point P to the polyline (chain of N-1
// segments). Returns Infinity for an empty list, the point distance
// for a single-vertex list.
export function distancePointToPolyline(
  px: number,
  pz: number,
  points: readonly Point2[],
): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) {
    return Math.hypot(px - points[0][0], pz - points[0][1]);
  }
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const d = distancePointToSegment(px, pz, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}
