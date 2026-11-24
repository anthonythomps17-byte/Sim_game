// A* pathfinding on the lot grid, 8 directions, no corner-cutting past walls or furniture.
import { inLot, wallBetween } from './lot';
import type { Lot, Point } from './types';

export interface PathGrid { lot: Lot; occ: Int32Array; edges?: Uint8Array }

/**
 * Walls as a table instead of string keys (much faster). Stride width + 1.
 * Tile (x, z): 1 = wall on its x edge (between x-1 and x), 2 = that wall is a door,
 * 4 = wall on its z edge (between z-1 and z), 8 = that wall is a door.
 */
export function buildEdges(lot: Lot): Uint8Array {
  const s = lot.width + 1;
  const e = new Uint8Array(s * (lot.depth + 1));
  for (const key in lot.walls) {
    const [d, xs, zs] = key.split(',');
    const x = Number(xs), z = Number(zs);
    if (x < 0 || z < 0 || x > lot.width || z > lot.depth) continue;
    const door = lot.walls[key].kind === 'door';
    if (d === 'v') e[z * s + x] |= door ? 3 : 1;
    else e[z * s + x] |= door ? 12 : 4;
  }
  return e;
}

/** 0 = no wall, 1 = wall or window, 2 = door, between orthogonal neighbours. */
function edgeBetween(g: PathGrid, x: number, z: number, nx: number, nz: number): number {
  const e = g.edges;
  if (!e) {
    const w = wallBetween(g.lot, x, z, nx, nz);
    return !w ? 0 : w.kind === 'door' ? 2 : 1;
  }
  const s = g.lot.width + 1;
  let v: number;
  if (nx === x + 1) v = e[z * s + nx] & 3;
  else if (nx === x - 1) v = e[z * s + x] & 3;
  else if (nz === z + 1) v = (e[nz * s + x] >> 2) & 3;
  else if (nz === z - 1) v = (e[z * s + x] >> 2) & 3;
  else return 0;
  return v === 0 ? 0 : v === 3 ? 2 : 1;
}

function tileOpen(g: PathGrid, x: number, z: number, allow?: Point): boolean {
  if (!inLot(g.lot, x, z)) return false;
  if (allow && allow.x === x && allow.z === z) return true;
  return g.occ[z * g.lot.width + x] === -1;
}

function orthoPassable(g: PathGrid, x: number, z: number, nx: number, nz: number, allow?: Point): boolean {
  if (!tileOpen(g, nx, nz, allow)) return false;
  return edgeBetween(g, x, z, nx, nz) !== 1;
}

export function canStep(g: PathGrid, x: number, z: number, nx: number, nz: number, allow?: Point): boolean {
  const dx = nx - x, dz = nz - z;
  if (dx === 0 || dz === 0) return orthoPassable(g, x, z, nx, nz, allow);
  // Diagonal: both L-shaped routes must be clear and must not go through doors.
  const wallFree = (ax: number, az: number, bx: number, bz: number) => edgeBetween(g, ax, az, bx, bz) === 0;
  return (
    tileOpen(g, nx, nz, allow) && tileOpen(g, x + dx, z) && tileOpen(g, x, z + dz) &&
    wallFree(x, z, x + dx, z) && wallFree(x + dx, z, nx, nz) &&
    wallFree(x, z, x, z + dz) && wallFree(x, z + dz, nx, nz)
  );
}

class MinHeap {
  private items: { k: number; f: number }[] = [];
  get size() { return this.items.length; }
  push(k: number, f: number) {
    const a = this.items;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.k;
  }
}

/**
 * Find a path of tile coordinates from start to goal (inclusive of goal, exclusive of start).
 * Returns null when unreachable. The start tile is always treated as open (Sims can stand up out of furniture).
 */
export function findPath(g: PathGrid, start: Point, goal: Point): Point[] | null {
  const w = g.lot.width;
  const sx = Math.floor(start.x), sz = Math.floor(start.z);
  if (!inLot(g.lot, goal.x, goal.z) || !inLot(g.lot, sx, sz)) return null;
  if (sx === goal.x && sz === goal.z) return [];
  if (!tileOpen(g, goal.x, goal.z)) return null;
  const n = w * g.lot.depth;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const startK = sz * w + sx;
  const goalK = goal.z * w + goal.x;
  gScore[startK] = 0;
  const heap = new MinHeap();
  const h = (x: number, z: number) => {
    const dx = Math.abs(x - goal.x), dz = Math.abs(z - goal.z);
    return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz);
  };
  heap.push(startK, h(sx, sz));
  const startPt = { x: sx, z: sz };
  while (heap.size) {
    const k = heap.pop();
    if (k === goalK) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const x = k % w, z = (k / w) | 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz;
        if (!canStep(g, x, z, nx, nz, startPt)) continue;
        const nk = nz * w + nx;
        if (closed[nk]) continue;
        const cost = gScore[k] + (dx && dz ? 1.41421356 : 1);
        if (cost < gScore[nk]) {
          gScore[nk] = cost;
          came[nk] = k;
          heap.push(nk, cost + h(nx, nz));
        }
      }
    }
  }
  if (came[goalK] === -1) return null;
  const path: Point[] = [];
  for (let k = goalK; k !== startK; k = came[k]) path.push({ x: k % w, z: (k / w) | 0 });
  path.reverse();
  return path;
}

/** Path length in tiles (diagonals √2). */
export function pathLength(start: Point, path: Point[]): number {
  let len = 0;
  let px = Math.floor(start.x), pz = Math.floor(start.z);
  for (const p of path) {
    len += p.x !== px && p.z !== pz ? 1.414 : 1;
    px = p.x; pz = p.z;
  }
  return len;
}
