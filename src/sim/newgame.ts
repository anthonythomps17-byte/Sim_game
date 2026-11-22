// Creating Sims, townies and a fresh game.
import { ASPIRATIONS, NAMES, OBJECTS, TRAITS } from './defs';
import { computeRooms, hKey, inLot, parseWallKey, vKey } from './lot';
import { roomOutlineKeys, wallKeysOnLine } from './build';
import { random } from './rng';
import { NEED_IDS, SKILL_IDS, type Appearance, type GameState, type Lot, type Needs, type PlacedObject, type Sim, type WallKind } from './types';

export const SAVE_VERSION = 1;
export const LOT_WIDTH = 22;
export const LOT_DEPTH = 18;

export const SKIN_TONES = ['#f6d7c3', '#efc3a4', '#e0ac85', '#c98e63', '#a86f48', '#8a5534', '#6b3f26', '#4a2a19'];
export const HAIR_COLORS = ['#1f1a17', '#3d2a1e', '#6b4126', '#9a6034', '#c98d4b', '#e6c27a', '#f1e1b0', '#b0372b', '#d86a3a', '#8c8c8c', '#e8e8e8', '#6a4fb3', '#e66fa6', '#3d8fd6', '#3fb37f'];
export const EYE_COLORS = ['#3b2516', '#6b4a2b', '#2f6db3', '#4b8a4e', '#7a8a96', '#8a6bb8'];
export const CLOTH_COLORS = ['#e05a5a', '#f08ab0', '#e7833a', '#f2c14e', '#a7c957', '#57b36a', '#2bb3a6', '#4a90d9', '#3b4ba8', '#9b6ad6', '#8b5e3c', '#333844', '#7b8794', '#f4f1ea', '#c9b79c'];
export const HAIR_STYLES = [
  { id: 'short', name: 'Short' }, { id: 'buzz', name: 'Buzz cut' }, { id: 'bob', name: 'Bob' },
  { id: 'long', name: 'Long' }, { id: 'ponytail', name: 'Ponytail' }, { id: 'buns', name: 'Space buns' },
  { id: 'curly', name: 'Curly' }, { id: 'afro', name: 'Afro' }, { id: 'quiff', name: 'Quiff' },
  { id: 'braids', name: 'Braids' }, { id: 'bald', name: 'Bald' },
];
export const TOPS = [
  { id: 'tshirt', name: 'T-shirt' }, { id: 'longsleeve', name: 'Long sleeves' }, { id: 'hoodie', name: 'Hoodie' },
  { id: 'jumper', name: 'Jumper' }, { id: 'dress', name: 'Dress' },
];
export const BOTTOMS = [{ id: 'trousers', name: 'Trousers' }, { id: 'shorts', name: 'Shorts' }, { id: 'skirt', name: 'Skirt' }];
export const BODIES: Appearance['body'][] = ['slim', 'average', 'broad'];

const pickR = <T,>(st: GameState, list: readonly T[]): T => list[Math.floor(random(st) * list.length)];

export function randomAppearance(st: GameState): Appearance {
  const top = pickR(st, TOPS).id;
  return {
    body: pickR(st, BODIES),
    height: 0.94 + random(st) * 0.12,
    skin: pickR(st, SKIN_TONES),
    hairStyle: pickR(st, HAIR_STYLES.filter((h) => h.id !== 'bald')).id,
    hairColor: pickR(st, HAIR_COLORS.slice(0, 9)),
    eyeColor: pickR(st, EYE_COLORS),
    face: Math.floor(random(st) * 4),
    freckles: random(st) < 0.25,
    top,
    topColor: pickR(st, CLOTH_COLORS),
    bottom: top === 'dress' ? 'skirt' : pickR(st, BOTTOMS).id,
    bottomColor: pickR(st, CLOTH_COLORS),
    shoeColor: pickR(st, ['#2b2b2b', '#f4f1ea', '#8b5e3c', '#c0392b', '#3b4ba8']),
  };
}

export function randomTraits(st: GameState, n = 3): string[] {
  const ids = Object.keys(TRAITS);
  const out: string[] = [];
  while (out.length < n) {
    const t = pickR(st, ids);
    if (out.includes(t)) continue;
    if ((t === 'outgoing' && out.includes('loner')) || (t === 'loner' && out.includes('outgoing'))) continue;
    if ((t === 'lazy' && out.includes('active')) || (t === 'active' && out.includes('lazy'))) continue;
    out.push(t);
  }
  return out;
}

export function fullNeeds(v = 80): Needs {
  const n = {} as Needs;
  for (const id of NEED_IDS) n[id] = v;
  return n;
}

export interface SimDraft { name: string; appearance: Appearance; traits: string[]; aspiration: string }

export function makeSim(id: number, draft: SimDraft, isTownie: boolean): Sim {
  const skills = {} as Sim['skills'];
  for (const s of SKILL_IDS) skills[s] = 0;
  return {
    id, name: draft.name, isTownie, appearance: draft.appearance, traits: [...draft.traits],
    aspiration: draft.aspiration, aspirationStep: 0, rewardPoints: 0,
    needs: fullNeeds(80), skills, career: null, moodlets: [],
    pos: { x: 8.5, z: 3.5 }, facing: 0, anim: 'idle', poseObjectId: null,
    location: isTownie ? 'home' : 'lot', awayUntil: 0, queue: [], current: null,
    thinkCooldown: 1, thought: null, counters: {}, visitUntil: 0, perks: [], recent: [], driving: { lessons: 0, licence: false },
  };
}

export function randomName(st: GameState): string {
  return `${pickR(st, NAMES.first)} ${pickR(st, NAMES.last)}`;
}

export function randomDraft(st: GameState, lastName?: string): SimDraft {
  const first = pickR(st, NAMES.first);
  return {
    name: `${first} ${lastName ?? pickR(st, NAMES.last)}`,
    appearance: randomAppearance(st),
    traits: randomTraits(st),
    aspiration: pickR(st, Object.keys(ASPIRATIONS)),
  };
}

// ---------- Lots ----------

export function emptyLot(): Lot {
  return { width: LOT_WIDTH, depth: LOT_DEPTH, walls: {}, floors: new Array(LOT_WIDTH * LOT_DEPTH).fill(null), objects: [], version: 1 };
}

function setWalls(lot: Lot, keys: string[], kind: WallKind = 'wall') {
  for (const k of keys) lot.walls[k] = { kind, paint: ['plaster', 'plaster'] };
}

function floorRect(lot: Lot, x0: number, z0: number, x1: number, z1: number, id: string) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) lot.floors[z * lot.width + x] = id;
}

/** Give each room its own interior paint and the outside red brick. */
export function paintRooms(lot: Lot, roomPaints: Record<string, string>): void {
  const info = computeRooms(lot);
  for (const key in lot.walls) {
    const { dir, x, z } = parseWallKey(key);
    const tiles = [dir === 'h' ? { x, z: z - 1 } : { x: x - 1, z }, { x, z }];
    tiles.forEach((t, side) => {
      const room = inLot(lot, t.x, t.z) ? info.rooms[t.z * lot.width + t.x] : 0;
      const floor = inLot(lot, t.x, t.z) ? lot.floors[t.z * lot.width + t.x] : null;
      lot.walls[key].paint[side] = room === 0 ? 'brick' : roomPaints[floor ?? ''] ?? 'plaster';
    });
  }
}

let objId = 1000;
function obj(defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3): PlacedObject {
  return { id: objId++, defId, x, z, rot, users: OBJECTS[defId].spots.map(() => null), dirt: 0, growth: 0, lightOn: false, bought: -9999 };
}

/** A small furnished red-brick house: living room, kitchen, two bedrooms and a bathroom. */
export function starterLot(): Lot {
  const lot = emptyLot();
  objId = 1000;
  // Outer shell: x 4..16, z 5..14.
  setWalls(lot, roomOutlineKeys(4, 5, 16, 14));
  setWalls(lot, wallKeysOnLine(10, 5, 10, 10));   // living | kitchen
  setWalls(lot, wallKeysOnLine(4, 10, 16, 10));   // front rooms | back rooms
  setWalls(lot, wallKeysOnLine(9, 10, 9, 14));    // bedroom 1 | bathroom
  setWalls(lot, wallKeysOnLine(12, 10, 12, 14));  // bathroom | bedroom 2
  const doors = [hKey(7, 5), vKey(10, 7), hKey(6, 10), hKey(10, 10), hKey(13, 10), vKey(16, 7)];
  for (const d of doors) lot.walls[d].kind = 'door';
  const windows = [hKey(5, 5), hKey(9, 5), hKey(12, 5), hKey(14, 5), hKey(6, 14), hKey(10, 14), hKey(14, 14), vKey(4, 7), vKey(16, 12), vKey(4, 12)];
  for (const w of windows) lot.walls[w].kind = 'window';

  floorRect(lot, 4, 5, 9, 9, 'oak');
  floorRect(lot, 10, 5, 15, 9, 'tile_check');
  floorRect(lot, 4, 10, 8, 13, 'carpet_rose');
  floorRect(lot, 9, 10, 11, 13, 'tile_white');
  floorRect(lot, 12, 10, 15, 13, 'carpet_blue');
  floorRect(lot, 7, 0, 7, 4, 'brick_paving');
  floorRect(lot, 16, 7, 18, 7, 'brick_paving');
  paintRooms(lot, { oak: 'sage', tile_check: 'plaster', carpet_rose: 'blush', tile_white: 'sky', carpet_blue: 'lilac' });

  lot.objects.push(
    // Living room
    obj('sofa', 5, 5, 0), obj('tv', 5, 9, 2), obj('floor_lamp', 4, 5, 0), obj('bookshelf', 8, 9, 2),
    obj('rug', 5, 7, 0), obj('plant_small', 9, 5, 0), obj('armchair', 4, 8, 1),
    // Kitchen
    obj('fridge', 11, 9, 2), obj('stove', 12, 9, 2), obj('counter', 14, 9, 2), obj('kitchen_sink', 15, 9, 2),
    obj('dining_table', 12, 6, 0), obj('dining_chair', 12, 7, 2), obj('dining_chair', 13, 7, 2),
    obj('dining_chair', 12, 5, 0), obj('dining_chair', 13, 5, 0), obj('table_lamp', 15, 5, 0),
    // Bedroom 1
    obj('bed_double', 5, 12, 2), obj('wardrobe', 8, 11, 3), obj('table_lamp', 4, 13, 2),
    // Bathroom
    obj('toilet', 9, 13, 2), obj('shower', 11, 13, 2), obj('bathroom_sink', 9, 11, 1),
    // Bedroom 2
    obj('bed_single', 15, 12, 2), obj('computer', 12, 12, 1), obj('table_lamp', 15, 10, 0),
    // Outside
    obj('mailbox', 9, 0, 0), obj('lantern', 6, 1, 0), obj('bench', 18, 2, 0), obj('veg_patch', 18, 15, 0), obj('plant_big', 8, 4, 0),
  );
  return lot;
}

export function emptyPlotLot(): Lot {
  const lot = emptyLot();
  objId = 1000;
  lot.objects.push(obj('mailbox', 9, 0, 0));
  floorRect(lot, 7, 0, 7, 3, 'brick_paving');
  return lot;
}

// ---------- New game ----------

export interface NewGameOptions { householdName: string; sims: SimDraft[]; lot: 'starter' | 'empty'; seed?: number }

export function createGame(opts: NewGameOptions): GameState {
  const lot = opts.lot === 'starter' ? starterLot() : emptyPlotLot();
  const st: GameState = {
    version: SAVE_VERSION,
    rng: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
    time: 8 * 60, // Monday 08:00
    speed: 1,
    household: { name: opts.householdName, funds: opts.lot === 'starter' ? 14000 : 30000, memberIds: [], rewardsUnlocked: [], marketFinds: [], paintingsSold: 0, groceries: 30, neighbourMood: 80, nextDoorId: 0 },
    sims: [], relationships: [], lot, bills: null, notifications: [],
    settings: { freeWill: 'full', romance: true },
    nextId: 1, selectedSimId: 0, lastVisitDay: -1, tutorialDone: false,
    pendingVisits: [], flags: { lastHour: 8, nextVisitAt: 13 * 60 },
    party: null, noise: { tonight: 0, stage: 0 }, fireworksUntil: 0,
  };
  const spawn = [{ x: 7.5, z: 3.5 }, { x: 8.5, z: 2.5 }, { x: 6.5, z: 2.5 }, { x: 9.5, z: 3.5 }];
  opts.sims.slice(0, 4).forEach((draft, i) => {
    const sim = makeSim(st.nextId++, draft, false);
    sim.pos = { ...spawn[i] };
    st.sims.push(sim);
    st.household.memberIds.push(sim.id);
  });
  // Household members already know each other.
  const ids = st.household.memberIds;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      st.relationships.push({ a: ids[i], b: ids[j], friendship: 40, romance: 0, partners: false, met: true });
    }
  }
  // Neighbours from around Ashton.
  for (let i = 0; i < 8; i++) {
    const t = makeSim(st.nextId++, randomDraft(st), true);
    t.district = NAMES.districts[i % NAMES.districts.length];
    st.sims.push(t);
  }
  const nextDoor = st.sims.find((s) => s.isTownie && s.district === 'Town Green') ?? st.sims.find((s) => s.isTownie);
  st.household.nextDoorId = nextDoor?.id ?? 0;
  st.selectedSimId = ids[0] ?? 0;
  return st;
}
