// Lot grid: walls on tile edges, floors per tile, placed objects, rooms.
//
// Tile (x, z) covers world [x, x+1] × [z, z+1].
// Wall key "h,x,z": along the line z, from x to x+1 — separates tiles (x, z-1) and (x, z).
// Wall key "v,x,z": along the line x, from z to z+1 — separates tiles (x-1, z) and (x, z).
// Paint side 0 faces the lower-coordinate tile, side 1 the higher one.
import { OBJECTS, FLOORS, PAINTS, type ObjectDef, type SpotDef } from './defs';
import type { Lot, PlacedObject, Point, Wall } from './types';

export const hKey = (x: number, z: number) => `h,${x},${z}`;
export const vKey = (x: number, z: number) => `v,${x},${z}`;

export function parseWallKey(key: string): { dir: 'h' | 'v'; x: number; z: number } {
  const [d, xs, zs] = key.split(',');
  return { dir: d as 'h' | 'v', x: Number(xs), z: Number(zs) };
}

export function inLot(lot: Lot, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < lot.width && z < lot.depth;
}

/** Wall between two orthogonally adjacent tiles, if any. */
export function wallBetween(lot: Lot, x: number, z: number, nx: number, nz: number): Wall | undefined {
  if (nx === x + 1) return lot.walls[vKey(nx, z)];
  if (nx === x - 1) return lot.walls[vKey(x, z)];
  if (nz === z + 1) return lot.walls[hKey(x, nz)];
  if (nz === z - 1) return lot.walls[hKey(x, z)];
  return undefined;
}

// ---------- Object geometry ----------

export function footprintSize(def: ObjectDef, rot: number): [number, number] {
  const [w, d] = def.footprint;
  return rot % 2 === 1 ? [d, w] : [w, d];
}

/** Map a local (unrotated) point inside the footprint to world coordinates. */
export function localToWorld(obj: { x: number; z: number; rot: number }, def: ObjectDef, lx: number, lz: number): Point {
  const [w, d] = def.footprint;
  const vx = lx - w / 2;
  const vz = lz - d / 2;
  let rx = vx, rz = vz;
  switch (obj.rot) {
    case 1: rx = vz; rz = -vx; break;
    case 2: rx = -vx; rz = -vz; break;
    case 3: rx = -vz; rz = vx; break;
  }
  const [W, D] = footprintSize(def, obj.rot);
  return { x: obj.x + W / 2 + rx, z: obj.z + D / 2 + rz };
}

/** Facing angle (radians) for the object's front. Direction = (sin a, cos a). */
export function rotAngle(rot: number): number {
  return (rot * Math.PI) / 2;
}

export function objectCenter(obj: PlacedObject): Point {
  const def = OBJECTS[obj.defId];
  const [W, D] = footprintSize(def, obj.rot);
  return { x: obj.x + W / 2, z: obj.z + D / 2 };
}

export function objectTiles(obj: { x: number; z: number; rot: number; defId: string }): Point[] {
  const def = OBJECTS[obj.defId];
  const [W, D] = footprintSize(def, obj.rot);
  const tiles: Point[] = [];
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) tiles.push({ x: obj.x + i, z: obj.z + j });
  return tiles;
}

export interface SpotWorld { tile: Point; pose?: Point; facing: number }

/** All tiles a Sim may stand on to use this spot (main approach first, then alternatives). */
export function spotApproaches(obj: PlacedObject, spot: SpotDef): Point[] {
  const def = OBJECTS[obj.defId];
  return [spot.at, ...(spot.alt ?? [])].map(([ax, az]) => {
    const c = localToWorld(obj, def, ax + 0.5, az + 0.5);
    return { x: Math.floor(c.x), z: Math.floor(c.z) };
  });
}

export function spotWorld(obj: PlacedObject, spot: SpotDef, approach = 0): SpotWorld {
  const def = OBJECTS[obj.defId];
  const tile = spotApproaches(obj, spot)[approach];
  const base = rotAngle(obj.rot);
  if (spot.pose) {
    const pose = localToWorld(obj, def, spot.pose[0], spot.pose[1]);
    const facing = spot.face === 'in' ? base + Math.PI : base;
    return { tile, pose, facing };
  }
  const centre = objectCenter(obj);
  const facing = Math.atan2(centre.x - (tile.x + 0.5), centre.z - (tile.z + 0.5));
  return { tile, facing };
}

// ---------- Occupancy ----------

/** Tiles blocked for walking: map from tile index to object id. */
export function buildOccupancy(lot: Lot, ignoreId?: number): Int32Array {
  const occ = new Int32Array(lot.width * lot.depth).fill(-1);
  for (const obj of lot.objects) {
    if (obj.id === ignoreId) continue;
    const def = OBJECTS[obj.defId];
    if (!def || def.walkable) continue;
    for (const t of objectTiles(obj)) {
      if (inLot(lot, t.x, t.z)) occ[t.z * lot.width + t.x] = obj.id;
    }
  }
  return occ;
}

export function canPlaceObject(lot: Lot, defId: string, x: number, z: number, rot: number, ignoreId?: number): boolean {
  const def = OBJECTS[defId];
  if (!def) return false;
  const [W, D] = footprintSize(def, rot);
  if (x < 0 || z < 0 || x + W > lot.width || z + D > lot.depth) return false;
  for (const other of lot.objects) {
    if (other.id === ignoreId) continue;
    const odef = OBJECTS[other.defId];
    // Rugs can sit under things, and things can sit on rugs.
    if (odef.walkable || def.walkable) {
      if (!(odef.walkable && def.walkable)) continue;
    }
    for (const t of objectTiles(other)) {
      if (t.x >= x && t.x < x + W && t.z >= z && t.z < z + D) return false;
    }
  }
  // No walls running through the middle of the object.
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < D; j++) {
      if (i + 1 < W && lot.walls[vKey(x + i + 1, z + j)]) return false;
      if (j + 1 < D && lot.walls[hKey(x + i, z + j + 1)]) return false;
    }
  }
  return true;
}

// ---------- Rooms ----------

export interface RoomInfo { rooms: Int32Array; count: number; sizes: number[] }

/** Flood-fill tiles separated by walls (doors and windows count as walls). Room 0 is outdoors. */
export function computeRooms(lot: Lot): RoomInfo {
  const { width: w, depth: d } = lot;
  const region = new Int32Array(w * d).fill(-1);
  const regions: { tiles: number[]; touchesEdge: boolean }[] = [];
  for (let start = 0; start < w * d; start++) {
    if (region[start] !== -1) continue;
    const id = regions.length;
    const info = { tiles: [] as number[], touchesEdge: false };
    regions.push(info);
    const stack = [start];
    region[start] = id;
    while (stack.length) {
      const idx = stack.pop()!;
      info.tiles.push(idx);
      const x = idx % w, z = (idx / w) | 0;
      if (x === 0 || z === 0 || x === w - 1 || z === d - 1) info.touchesEdge = true;
      const n = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]];
      for (const [nx, nz] of n) {
        if (!inLot(lot, nx, nz)) continue;
        const ni = nz * w + nx;
        if (region[ni] !== -1) continue;
        if (wallBetween(lot, x, z, nx, nz)) continue;
        region[ni] = id;
        stack.push(ni);
      }
    }
  }
  const rooms = new Int32Array(w * d);
  const remap: number[] = [];
  let next = 1;
  const sizes = [0];
  for (let r = 0; r < regions.length; r++) {
    if (regions[r].touchesEdge) remap[r] = 0;
    else { remap[r] = next++; sizes.push(regions[r].tiles.length); }
  }
  for (let i = 0; i < w * d; i++) {
    rooms[i] = remap[region[i]];
    if (rooms[i] === 0) sizes[0]++;
  }
  return { rooms, count: next, sizes };
}

export function roomAt(info: RoomInfo, lot: Lot, p: Point): number {
  const x = Math.floor(p.x), z = Math.floor(p.z);
  if (!inLot(lot, x, z)) return 0;
  return info.rooms[z * lot.width + x];
}

// ---------- Value ----------

export function homeValue(lot: Lot, prices: { wall: number; door: number; window: number; floor: number }): number {
  let v = 0;
  for (const obj of lot.objects) {
    const def = OBJECTS[obj.defId];
    if (def.temp) continue;
    v += def.reward ? 500 : def.price;
  }
  for (const key in lot.walls) {
    const k = lot.walls[key].kind;
    v += k === 'door' ? prices.door : k === 'window' ? prices.window : prices.wall;
  }
  for (const f of lot.floors) if (f) v += prices.floor;
  return v;
}

export function surfaceDecor(lot: Lot, roomInfo: RoomInfo, room: number): number {
  let floorDecor = 0, tiles = 0;
  for (let i = 0; i < lot.floors.length; i++) {
    if (roomInfo.rooms[i] !== room) continue;
    tiles++;
    const f = lot.floors[i];
    if (f && FLOORS[f]) floorDecor += FLOORS[f].decor;
  }
  return tiles ? floorDecor / tiles : 0;
}

export function wallsOfRoom(lot: Lot, roomInfo: RoomInfo, room: number): { key: string; side: 0 | 1 }[] {
  const out: { key: string; side: 0 | 1 }[] = [];
  const w = lot.width;
  for (const key in lot.walls) {
    const { dir, x, z } = parseWallKey(key);
    const lowTile = dir === 'h' ? { x, z: z - 1 } : { x: x - 1, z };
    const highTile = { x, z };
    if (inLot(lot, lowTile.x, lowTile.z) && roomInfo.rooms[lowTile.z * w + lowTile.x] === room) out.push({ key, side: 0 });
    if (inLot(lot, highTile.x, highTile.z) && roomInfo.rooms[highTile.z * w + highTile.x] === room) out.push({ key, side: 1 });
  }
  return out;
}

export function paintDecor(lot: Lot, roomInfo: RoomInfo, room: number): number {
  const walls = wallsOfRoom(lot, roomInfo, room);
  if (!walls.length) return 0;
  let sum = 0;
  for (const { key, side } of walls) sum += PAINTS[lot.walls[key].paint[side]]?.decor ?? 0;
  return sum / walls.length;
}
