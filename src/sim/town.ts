// The town: the streets outside the front door, Town Green Park and the café. It is a second
// walkable map joined to the home lot at the front gate. Its layout (walls, floors, which tiles
// you can walk on) is built from code; only its furniture lives in the save (Sims reserve seats).
//
// Coordinates: world x/z are the home lot's (the lot covers [0, width] × [0, depth]). The town
// grid starts at TOWN_ORIGIN, so town tile (x, z) covers world (x + ox, z + oz).
import type { Game } from './game';
import { OBJECTS } from './defs';
import { chance, pick, random } from './rng';
import { clamp } from './mood';
import type { GameState, Lot, PlacedObject, Point, Sim, Wall } from './types';

export const TOWN_ORIGIN = { x: -66, z: -121 };
export const TOWN_W = 92;
export const TOWN_D = 121;
/** Bump when the layout changes, so older saves get the new town. */
export const TOWN_VERSION = 1;

type P = [number, number];
export interface StreetDef { name: string; points: P[]; width: number; houses: boolean; sign?: P }

/** The street plan (shared with the 3D scenery). */
export function streets(lotD: number): StreetDef[] {
  return [
    // The lot's own street, from the north-east terraces to the wide road in the south.
    { name: 'Larkfield Close', points: [[-70, -4.5], [52, -4.5]], width: 4.5, houses: true, sign: [-12, -1.4] },
    // Crossing road just north of the lot, from the avenue to the main road.
    { name: 'Wellbrook Road', points: [[-16, -32], [-16, 70]], width: 5, houses: true, sign: [-19.5, 3] },
    // Avenue to the west, beside the park.
    { name: 'Maple Avenue', points: [[-125, -32], [52, -32], [110, -36]], width: 5, houses: true, sign: [-12, -28] },
    // Curving main road to the east.
    { name: 'Mill Lane', points: [[115, 68], [52, 70], [-16, 68], [-62, 52], [-125, 34]], width: 7, houses: true, sign: [-12, 64] },
    // Wide road to the south.
    { name: 'Heath Road', points: [[52, -130], [52, 130]], width: 7, houses: true, sign: [48, 3] },
    // A street of terraces to the north.
    { name: 'Cobden Street', points: [[-66, -32], [-70, 56]], width: 4.5, houses: true },
    // Diagonal road through the north-west.
    { name: 'Victoria Road', points: [[-125, -105], [-16, -32]], width: 6, houses: true },
    // Curving road further south.
    { name: 'Rowan Crescent', points: [[80, -130], [92, -60], [100, 0], [108, 40]], width: 5, houses: true },
    // Lane beside the lot.
    { name: '', points: [[24.5, 1], [24.5, 50], [52, 50]], width: 2.6, houses: false },
    // Back alley along the lot's rear.
    { name: '', points: [[-14, lotD + 3], [52, lotD + 3]], width: 2.6, houses: false },
  ];
}

export const PARK = { x0: -64, x1: 18, z0: -118, z1: -38 };
/** The café building (world, walls on these lines). */
export const CAFE = { x0: -31, x1: -21, z0: -27, z1: -19 };
/** The row of shops in the park's corner (solid). */
const SHOPS = { x0: -62, x1: -40, z0: -48, z1: -40 };

export const toWorld = (p: Point): Point => ({ x: p.x + TOWN_ORIGIN.x, z: p.z + TOWN_ORIGIN.z });
export const toTown = (p: Point): Point => ({ x: p.x - TOWN_ORIGIN.x, z: p.z - TOWN_ORIGIN.z });

// ---------- Places to go ----------

export interface Destination { id: string; name: string; icon: string; tile: Point }
/** Town-grid tiles. */
export const DESTINATIONS: Record<string, Destination> = {
  park: { id: 'park', name: 'Town Green Park', icon: '🌳', tile: { x: 66, z: 80 } },
  cafe: { id: 'cafe', name: 'Town Green Café', icon: '☕', tile: { x: 40, z: 98 } },
};

/** Where townies walk in from and leave by (town tiles). */
export const TOWN_EXITS: Point[] = [{ x: 2, z: 41 }, { x: 83, z: 11 }, { x: 1, z: 89 }, { x: 90, z: 117 }];

/** The town tile just outside the home lot's front gate. */
export function townGate(game: Game): Point {
  const e = game.exitTile();
  return { x: e.x - TOWN_ORIGIN.x, z: -1 - TOWN_ORIGIN.z };
}

// ---------- Trees in the park (also drawn by the scenery) ----------

const KEEP_CLEAR: { x0: number; x1: number; z0: number; z1: number }[] = [
  { x0: -24, x1: 18, z0: -66, z1: -38 }, // playground, picnic area, ice cream van
  { x0: -36, x1: -22, z0: -72, z1: -58 }, // duck pond
  { x0: -46, x1: -32, z0: -90, z1: -74 }, // kickabout
  SHOPS,
];

let treeCache: { x: number; z: number; s: number }[] | null = null;
export function parkTrees(): { x: number; z: number; s: number }[] {
  if (treeCache) return treeCache;
  const out: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 70 && out.length < 40; i++) {
    const x = PARK.x0 + 4 + ((i * 37) % (PARK.x1 - PARK.x0 - 8)) + 0.5;
    const z = PARK.z0 + 4 + ((i * 53) % (PARK.z1 - PARK.z0 - 8)) + 0.5;
    if (KEEP_CLEAR.some((r) => x > r.x0 - 2 && x < r.x1 + 2 && z > r.z0 - 2 && z < r.z1 + 2)) continue;
    out.push({ x, z, s: 0.8 + ((i * 13) % 7) * 0.08 });
  }
  treeCache = out;
  return out;
}

// ---------- Where you can walk ----------

function distToSegment(px: number, pz: number, a: P, b: P): number {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const len2 = vx * vx + vz * vz || 1;
  const t = clamp(((px - a[0]) * vx + (pz - a[1]) * vz) / len2, 0, 1);
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t));
}

let maskCache: Uint8Array | null = null;
/** 1 = walkable town tile (pavements, roads, the park, the café). */
export function townMask(): Uint8Array {
  if (maskCache) return maskCache;
  const m = new Uint8Array(TOWN_W * TOWN_D);
  const plan = streets(18).filter((s) => s.points.some(([, z]) => z < 0));
  for (let z = 0; z < TOWN_D; z++) {
    for (let x = 0; x < TOWN_W; x++) {
      const wx = x + TOWN_ORIGIN.x + 0.5, wz = z + TOWN_ORIGIN.z + 0.5;
      let ok = false;
      for (const st of plan) {
        const half = (st.houses ? st.width + 4 : st.width) / 2;
        for (let i = 0; i < st.points.length - 1 && !ok; i++) if (distToSegment(wx, wz, st.points[i], st.points[i + 1]) <= half) ok = true;
        if (ok) break;
      }
      if (wx > PARK.x0 && wx < PARK.x1 && wz > PARK.z0 && wz < PARK.z1 + 1.5) ok = true;
      if (wx > SHOPS.x0 && wx < SHOPS.x1 && wz > SHOPS.z0 && wz < SHOPS.z1) ok = false;
      if (wx > CAFE.x0 && wx < CAFE.x1 + 1 && wz > CAFE.z0 && wz < CAFE.z1) ok = true;
      m[z * TOWN_W + x] = ok ? 1 : 0;
    }
  }
  for (const t of parkTrees()) {
    const tx = Math.floor(t.x - TOWN_ORIGIN.x), tz = Math.floor(t.z - TOWN_ORIGIN.z);
    if (tx >= 0 && tz >= 0 && tx < TOWN_W && tz < TOWN_D) m[tz * TOWN_W + tx] = 0;
  }
  maskCache = m;
  return m;
}

// ---------- Walls and floors (the café) ----------

let layoutCache: { walls: Record<string, Wall>; floors: (string | null)[] } | null = null;
function layout() {
  if (layoutCache) return layoutCache;
  const walls: Record<string, Wall> = {};
  const floors: (string | null)[] = new Array(TOWN_W * TOWN_D).fill(null);
  const x0 = CAFE.x0 - TOWN_ORIGIN.x, x1 = CAFE.x1 - TOWN_ORIGIN.x, z0 = CAFE.z0 - TOWN_ORIGIN.z, z1 = CAFE.z1 - TOWN_ORIGIN.z;
  const out = 'brick', inn = 'mustard';
  const doors = new Set([`v,${x1},${z0 + 4}`, 'h,36,100', `v,${x1},${z0 + 5}`]);
  const windows = new Set([`v,${x1},${z0 + 1}`, `v,${x1},${z0 + 2}`, `v,${x1},${z0 + 7}`, `h,${x0 + 2},${z0}`, `h,${x0 + 3},${z0}`, `h,${x0 + 6},${z0}`, `h,${x0 + 7},${z0}`, `h,${x0 + 4},${z1}`, `h,${x0 + 7},${z1}`]);
  const put = (key: string, paint: [string, string]) => { walls[key] = { kind: doors.has(key) ? 'door' : windows.has(key) ? 'window' : 'wall', paint }; };
  for (let x = x0; x < x1; x++) { put(`h,${x},${z0}`, [out, inn]); put(`h,${x},${z1}`, [inn, out]); }
  for (let z = z0; z < z1; z++) { put(`v,${x0},${z}`, [out, inn]); put(`v,${x1},${z}`, [inn, out]); }
  // The customer toilet in the back corner.
  for (const x of [35, 36]) put(`h,${x},100`, ['plaster', 'plaster']);
  for (const z of [100, 101]) put(`v,37,${z}`, ['plaster', 'plaster']);
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) floors[z * TOWN_W + x] = x <= 36 && z >= 100 ? 'tile_white' : 'oak';
  layoutCache = { walls, floors };
  return layoutCache;
}

// ---------- Furniture ----------

/** [defId, x, z, rot] in town tiles. */
const FURNITURE: [string, number, number, 0 | 1 | 2 | 3][] = [
  // Café
  ['cafe_counter', 39, 100, 2], ['cafe_shelf', 39, 101, 2],
  ['dining_table', 37, 96, 0], ['dining_chair', 37, 95, 0], ['dining_chair', 38, 95, 0], ['dining_chair', 37, 97, 2], ['dining_chair', 38, 97, 2],
  ['dining_table', 41, 96, 0], ['dining_chair', 41, 95, 0], ['dining_chair', 42, 95, 0], ['dining_chair', 41, 97, 2], ['dining_chair', 42, 97, 2],
  ['armchair', 44, 95, 3], ['armchair', 44, 96, 3], ['plant_big', 44, 94, 0], ['plant_big', 35, 94, 0],
  ['bookshelf', 35, 97, 1], ['floor_lamp', 35, 99, 1], ['floor_lamp', 43, 101, 2],
  ['toilet', 35, 101, 2], ['bathroom_sink', 36, 101, 2],
  // Park: playground, picnic area, pond, ice creams, kickabout
  ['swings', 68, 73, 0], ['slide', 74, 69, 0], ['picnic_table', 59, 75, 0], ['picnic_table', 59, 69, 0],
  ['bench', 54, 78, 0], ['bench', 80, 61, 3], ['bench', 48, 60, 1], ['chess', 52, 71, 0],
  ['duck_pond', 36, 55, 0], ['ice_cream_van', 70, 61, 0], ['goal', 26, 41, 0],
  ['park_bin', 62, 80, 0], ['park_bin', 76, 76, 0], ['flower_bed', 48, 80, 0], ['flower_bed', 72, 80, 0],
];

export function createTown(st: GameState): NonNullable<GameState['town']> {
  const objects: PlacedObject[] = [];
  for (const [defId, x, z, rot] of FURNITURE) {
    const def = OBJECTS[defId];
    if (!def) continue;
    objects.push({ id: st.nextId++, defId, x, z, rot, users: def.spots.map(() => null), dirt: 0, growth: 0, lightOn: !!def.light, bought: 0 });
  }
  return { version: TOWN_VERSION, objects };
}

/** The town as a Lot (layout from code, furniture from the save). */
export function townLot(st: GameState, cache: { lot: Lot | null }): Lot {
  const town = st.town!;
  if (cache.lot && cache.lot.objects === town.objects) return cache.lot;
  const { walls, floors } = layout();
  cache.lot = { width: TOWN_W, depth: TOWN_D, walls, floors, objects: town.objects, version: town.version * 1000 };
  return cache.lot;
}

// ---------- People out and about ----------

export const inTown = (sim: Sim) => sim.location === 'town';

/** Every hour: neighbours come and go in the park and café. */
export function townHour(game: Game, hour: number): void {
  const st = game.state;
  if (!st.town) return;
  const here = st.sims.filter((s) => s.isTownie && s.location === 'town');
  const weekend = game.weekday >= 5;
  const wanted = hour < 8 || hour > 20 ? 0 : 3 + (weekend ? 2 : 0) + (hour >= 12 && hour <= 17 ? 1 : 0);
  if (here.length >= wanted) return;
  const free = st.sims.filter((s) => s.isTownie && s.location === 'home' && !st.pendingVisits.some((v) => v.simId === s.id) && !st.party?.guests.includes(s.id));
  for (let i = here.length; i < wanted && free.length; i++) {
    if (!chance(st, 0.7)) continue;
    const t = free.splice(Math.floor(random(st) * free.length), 1)[0];
    const exit = pick(st, TOWN_EXITS);
    t.location = 'town';
    t.pos = { x: exit.x + 0.5, z: exit.z + 0.5 };
    t.queue = [];
    t.current = null;
    t.visitUntil = st.time + 60 + random(st) * 120;
    t.thinkCooldown = 0;
    for (const n of Object.keys(t.needs) as (keyof Sim['needs'])[]) t.needs[n] = Math.max(t.needs[n], 55);
  }
}

/** Nearest place to leave town from (for townies going home). */
export function nearestExit(p: Point): Point {
  let best = TOWN_EXITS[0], d = Infinity;
  for (const e of TOWN_EXITS) { const dd = Math.hypot(e.x - p.x, e.z - p.z); if (dd < d) { d = dd; best = e; } }
  return best;
}

export function cafeOpen(game: Game): boolean { return game.hour >= 7 && game.hour < 19; }
