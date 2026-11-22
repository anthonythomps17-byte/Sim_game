// Build and buy commands. All money checks happen here.
import { BUILD_PRICES, FLOORS, OBJECTS, PAINTS, REWARD_OBJECTS } from './defs';
import type { Game } from './game';
import { canPlaceObject, computeRooms, footprintSize, hKey, inLot, objectTiles, parseWallKey, vKey, wallsOfRoom } from './lot';
import { interrupt } from './actions';
import type { Lot, PlacedObject, WallKind } from './types';

export interface BuildResult { ok: boolean; cost: number; reason?: string }

/** Wall keys along a straight grid line from corner (x0,z0) to corner (x1,z1). */
export function wallKeysOnLine(x0: number, z0: number, x1: number, z1: number): string[] {
  const keys: string[] = [];
  if (z0 === z1) {
    const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0];
    for (let x = a; x < b; x++) keys.push(hKey(x, z0));
  } else if (x0 === x1) {
    const [a, b] = z0 < z1 ? [z0, z1] : [z1, z0];
    for (let z = a; z < b; z++) keys.push(vKey(x0, z));
  }
  return keys;
}

/** Keys of the 4 sides of a rectangle between corners. */
export function roomOutlineKeys(x0: number, z0: number, x1: number, z1: number): string[] {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [az, bz] = z0 < z1 ? [z0, z1] : [z1, z0];
  if (ax === bx || az === bz) return [];
  return [
    ...wallKeysOnLine(ax, az, bx, az), ...wallKeysOnLine(ax, bz, bx, bz),
    ...wallKeysOnLine(ax, az, ax, bz), ...wallKeysOnLine(bx, az, bx, bz),
  ];
}

export function wallKeyInLot(lot: Lot, key: string): boolean {
  const { dir, x, z } = parseWallKey(key);
  if (dir === 'h') return x >= 0 && x < lot.width && z >= 0 && z <= lot.depth;
  return z >= 0 && z < lot.depth && x >= 0 && x <= lot.width;
}

/** Would a wall at this key cut through a multi-tile object? */
function wallCutsObject(lot: Lot, key: string): boolean {
  const { dir, x, z } = parseWallKey(key);
  const a = dir === 'h' ? { x, z: z - 1 } : { x: x - 1, z };
  const b = { x, z };
  for (const obj of lot.objects) {
    const tiles = objectTiles(obj);
    const hasA = tiles.some((t) => t.x === a.x && t.z === a.z);
    const hasB = tiles.some((t) => t.x === b.x && t.z === b.z);
    if (hasA && hasB) return true;
  }
  return false;
}

export function placeWalls(game: Game, keys: string[], dryRun = false): BuildResult {
  const lot = game.state.lot;
  const fresh = keys.filter((k) => wallKeyInLot(lot, k) && !lot.walls[k] && !wallCutsObject(lot, k));
  const cost = fresh.length * BUILD_PRICES.wall;
  if (!fresh.length) return { ok: false, cost: 0, reason: 'Nothing to build' };
  if (cost > game.state.household.funds) return { ok: false, cost, reason: 'Not enough money' };
  if (dryRun) return { ok: true, cost };
  for (const k of fresh) lot.walls[k] = { kind: 'wall', paint: ['plaster', 'plaster'] };
  autoPaintNewWalls(lot, fresh);
  game.addFunds(-cost);
  game.lotChanged();
  game.sound('build');
  return { ok: true, cost };
}

/** New walls take on the paint of neighbouring walls in the same room, or brick outside. */
function autoPaintNewWalls(lot: Lot, keys: string[]): void {
  const info = computeRooms(lot);
  for (const k of keys) {
    const { dir, x, z } = parseWallKey(k);
    const sides: [{ x: number; z: number }, { x: number; z: number }] = [dir === 'h' ? { x, z: z - 1 } : { x: x - 1, z }, { x, z }];
    sides.forEach((t, side) => {
      const room = inLot(lot, t.x, t.z) ? info.rooms[t.z * lot.width + t.x] : 0;
      let paint = room === 0 ? 'brick' : 'plaster';
      if (room !== 0) {
        const existing = wallsOfRoom(lot, info, room).find((w) => !keys.includes(w.key));
        if (existing) paint = lot.walls[existing.key].paint[existing.side];
      }
      lot.walls[k].paint[side] = paint;
    });
  }
}

export function eraseWalls(game: Game, keys: string[]): BuildResult {
  const lot = game.state.lot;
  const existing = keys.filter((k) => lot.walls[k]);
  if (!existing.length) return { ok: false, cost: 0, reason: 'No walls there' };
  let refund = 0;
  for (const k of existing) {
    const kind = lot.walls[k].kind;
    refund += kind === 'door' ? BUILD_PRICES.door : kind === 'window' ? BUILD_PRICES.window : BUILD_PRICES.wall;
    delete lot.walls[k];
  }
  game.addFunds(refund);
  game.lotChanged();
  game.sound('erase');
  return { ok: true, cost: -refund };
}

export function setWallKind(game: Game, key: string, kind: WallKind): BuildResult {
  const lot = game.state.lot;
  const wall = lot.walls[key];
  if (!wall) return { ok: false, cost: 0, reason: 'Place it on a wall' };
  if (wall.kind === kind) return { ok: false, cost: 0, reason: 'Already there' };
  const price = (k: WallKind) => (k === 'door' ? BUILD_PRICES.door : k === 'window' ? BUILD_PRICES.window : BUILD_PRICES.wall);
  const cost = price(kind) - price(wall.kind);
  if (cost > game.state.household.funds) return { ok: false, cost, reason: 'Not enough money' };
  wall.kind = kind;
  game.addFunds(-cost);
  game.lotChanged();
  game.sound('build');
  return { ok: true, cost };
}

export function paintFloor(game: Game, x0: number, z0: number, x1: number, z1: number, floorId: string | null): BuildResult {
  const lot = game.state.lot;
  if (floorId && !FLOORS[floorId]) return { ok: false, cost: 0 };
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [az, bz] = z0 < z1 ? [z0, z1] : [z1, z0];
  const tiles: number[] = [];
  for (let x = Math.max(0, ax); x <= Math.min(lot.width - 1, bx); x++) {
    for (let z = Math.max(0, az); z <= Math.min(lot.depth - 1, bz); z++) {
      const i = z * lot.width + x;
      if (lot.floors[i] !== floorId) tiles.push(i);
    }
  }
  if (!tiles.length) return { ok: false, cost: 0, reason: 'Nothing to change' };
  const cost = floorId ? tiles.length * BUILD_PRICES.floor : -tiles.filter((i) => lot.floors[i]).length * BUILD_PRICES.floor;
  if (cost > game.state.household.funds) return { ok: false, cost, reason: 'Not enough money' };
  for (const i of tiles) lot.floors[i] = floorId;
  game.addFunds(-cost);
  game.lotChanged();
  game.sound('build');
  return { ok: true, cost };
}

/** Paint one side of a wall, or every wall side facing the same room. */
export function paintWall(game: Game, key: string, side: 0 | 1, paintId: string, wholeRoom: boolean): BuildResult {
  const lot = game.state.lot;
  if (!lot.walls[key] || !PAINTS[paintId]) return { ok: false, cost: 0 };
  let targets = [{ key, side }];
  if (wholeRoom) {
    const info = computeRooms(lot);
    const { dir, x, z } = parseWallKey(key);
    const t = side === 0 ? (dir === 'h' ? { x, z: z - 1 } : { x: x - 1, z }) : { x, z };
    const room = inLot(lot, t.x, t.z) ? info.rooms[t.z * lot.width + t.x] : 0;
    targets = wallsOfRoom(lot, info, room) as { key: string; side: 0 | 1 }[];
  }
  targets = targets.filter((w) => lot.walls[w.key].paint[w.side] !== paintId);
  if (!targets.length) return { ok: false, cost: 0, reason: 'Already that colour' };
  const cost = targets.length * BUILD_PRICES.paint;
  if (cost > game.state.household.funds) return { ok: false, cost, reason: 'Not enough money' };
  for (const w of targets) lot.walls[w.key].paint[w.side] = paintId;
  game.addFunds(-cost);
  game.lotChanged();
  game.sound('build');
  return { ok: true, cost };
}

// ---------- Buy mode ----------

export function objectPrice(game: Game, defId: string): number {
  const def = OBJECTS[defId];
  if (def.temp) return Infinity;
  if (def.reward) return game.state.household.rewardsUnlocked.includes(defId) ? 0 : Infinity;
  if (def.market && !game.state.household.marketFinds.includes(defId)) return Infinity;
  return def.price;
}

export function buyObject(game: Game, defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3): BuildResult & { id?: number } {
  const def = OBJECTS[defId];
  if (!def) return { ok: false, cost: 0 };
  const price = objectPrice(game, defId);
  if (!isFinite(price)) return { ok: false, cost: 0, reason: 'Not unlocked yet' };
  if (price > game.state.household.funds) return { ok: false, cost: price, reason: 'Not enough money' };
  if (!canPlaceObject(game.state.lot, defId, x, z, rot)) return { ok: false, cost: price, reason: "Doesn't fit there" };
  const voucher = game.state.household.discount;
  const paid = voucher > 0 && price > 0 ? Math.round(price * (1 - voucher)) : price;
  if (paid !== price) {
    game.state.household.discount = 0;
    game.notify(`Voucher used: saved £${price - paid}!`, '🏷️', 'good');
  }
  const obj: PlacedObject = {
    id: game.nextId(), defId, x, z, rot, users: def.spots.map(() => null), dirt: 0, growth: 0,
    lightOn: !!def.light && game.isNight(), bought: game.state.time,
  };
  game.state.lot.objects.push(obj);
  if (def.reward) consumeRewardUnlock(game, defId);
  game.addFunds(-paid);
  bumpSimsOffObject(game, obj);
  game.lotChanged();
  game.sound('place');
  return { ok: true, cost: paid, id: obj.id };
}

export function moveObject(game: Game, id: number, x: number, z: number, rot: 0 | 1 | 2 | 3): BuildResult {
  const obj = game.object(id);
  if (!obj) return { ok: false, cost: 0 };
  if (!canPlaceObject(game.state.lot, obj.defId, x, z, rot, id)) return { ok: false, cost: 0, reason: "Doesn't fit there" };
  kickUsers(game, obj);
  obj.x = x; obj.z = z; obj.rot = rot;
  bumpSimsOffObject(game, obj);
  game.lotChanged();
  game.sound('place');
  return { ok: true, cost: 0 };
}

export function sellObject(game: Game, id: number): BuildResult {
  const obj = game.object(id);
  if (!obj) return { ok: false, cost: 0 };
  const def = OBJECTS[obj.defId];
  kickUsers(game, obj);
  // Full refund if bought within the last in-game hour, otherwise 75%.
  const recent = game.state.time - obj.bought < 60;
  const refund = def.reward ? 0 : Math.round(def.price * (recent ? 1 : 0.75));
  game.state.lot.objects = game.state.lot.objects.filter((o) => o.id !== id);
  if (def.reward) game.state.household.rewardsUnlocked.push(def.id);
  game.addFunds(refund);
  game.lotChanged();
  game.sound('cash');
  return { ok: true, cost: -refund };
}

function kickUsers(game: Game, obj: PlacedObject): void {
  for (const sim of game.state.sims) {
    const cur = sim.current;
    if (!cur) continue;
    if (cur.objectId === obj.id || cur.reserved?.objectId === obj.id) interrupt(game, sim);
  }
  obj.users = obj.users.map(() => null);
}

/** Nudge any Sim standing where new furniture now is. */
function bumpSimsOffObject(game: Game, obj: PlacedObject): void {
  const def = OBJECTS[obj.defId];
  if (def.walkable) return;
  const [W, D] = footprintSize(def, obj.rot);
  for (const sim of game.simsOnLot()) {
    if (sim.poseObjectId !== null) continue;
    const tx = Math.floor(sim.pos.x), tz = Math.floor(sim.pos.z);
    if (tx >= obj.x && tx < obj.x + W && tz >= obj.z && tz < obj.z + D) {
      sim.pos = { x: obj.x + W / 2, z: Math.min(game.state.lot.depth - 0.5, obj.z + D + 0.5) };
      if (sim.pos.z >= game.state.lot.depth) sim.pos.z = Math.max(0.5, obj.z - 0.5);
    }
  }
}

export function unlockRewardObject(game: Game, simId: number, defId: string): BuildResult {
  const sim = game.sim(simId);
  const entry = REWARD_OBJECTS.find((r) => r.id === defId);
  if (!sim || !entry) return { ok: false, cost: 0 };
  if (sim.rewardPoints < entry.cost) return { ok: false, cost: entry.cost, reason: 'Not enough reward points' };
  sim.rewardPoints -= entry.cost;
  game.state.household.rewardsUnlocked.push(defId);
  game.notify(`${OBJECTS[defId].name} unlocked! Find it in Buy mode under Rewards.`, '🏆', 'good');
  return { ok: true, cost: 0 };
}

/** Placing a reward object uses up one unlock. */
export function consumeRewardUnlock(game: Game, defId: string): void {
  const list = game.state.household.rewardsUnlocked;
  const i = list.indexOf(defId);
  if (i >= 0) list.splice(i, 1);
}
