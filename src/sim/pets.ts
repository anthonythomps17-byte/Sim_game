// Pets: dogs and cats roam the lot; parrots, rabbits and hamsters live in a cage or hutch.
// Pets get hungry, bored and grubby. Dogs poo in the garden (pick it up!), cats use a litter tray,
// and cages need cleaning out. Now and then a pet catches fleas or feels poorly and needs the vet,
// but nothing truly bad ever happens to them.
import { OBJECTS, PET_SPECIES, type PetActionDef } from './defs';
import type { Game } from './game';
import { canPlaceObject, objectCenter, spotApproaches } from './lot';
import { addMoodlet, clamp } from './mood';
import { findPath } from './path';
import { pick, random } from './rng';
import { calendarOf, placeTemp } from './life';
import type { Pet, PlacedObject, Point, Sim } from './types';

export const MAX_PETS = 4;
export const VET_COST = 60;
export const FLEA_COST = 15;
const MAX_POOS = 10;
/** Poo per hour (a dog needs to go roughly twice a day). */
const POO_RATE: Record<string, number> = { dog: 8, cat: 6 };

export const speciesOf = (pet: Pet) => PET_SPECIES[pet.species];
export const roams = (pet: Pet) => !!PET_SPECIES[pet.species]?.roams;
export const petsOnLot = (game: Game) => game.state.pets.filter((p) => p.location === 'lot');
export const label = (text: string, pet: Pet) => text.replace('{name}', pet.name);

export function petHappiness(pet: Pet): number {
  const s = speciesOf(pet);
  const needs = [pet.hunger, pet.fun, pet.clean, ...(s.roams ? [pet.energy] : [])];
  return needs.reduce((a, b) => a + b, 0) / needs.length;
}

/** The pet living in a cage or hutch, if any. */
export function occupant(game: Game, obj: PlacedObject): Pet | undefined {
  return game.state.pets.find((p) => p.homeId === obj.id);
}

export function weeklyPetCost(game: Game): number {
  return game.state.pets.reduce((s, p) => s + (speciesOf(p)?.weekly ?? 0), 0);
}

// ---------- Adoption ----------

export interface AdoptQuote { ok: boolean; why?: string; total: number; extras: string[] }

export function adoptQuote(game: Game, speciesId: string): AdoptQuote {
  const sp = PET_SPECIES[speciesId];
  const st = game.state;
  if (!sp) return { ok: false, why: 'Unknown animal', total: 0, extras: [] };
  if (st.pets.length >= MAX_PETS) return { ok: false, why: `You can have up to ${MAX_PETS} pets`, total: 0, extras: [] };
  let total = sp.price;
  const extras: string[] = [];
  if (sp.habitat) {
    const free = st.lot.objects.some((o) => o.defId === sp.habitat && !occupant(game, o));
    if (!free) { total += OBJECTS[sp.habitat].price; extras.push(OBJECTS[sp.habitat].name); }
  } else if (!st.lot.objects.some((o) => o.defId === 'pet_bowl')) {
    total += OBJECTS.pet_bowl.price;
    extras.push(OBJECTS.pet_bowl.name);
  }
  if (speciesId === 'cat' && !st.lot.objects.some((o) => o.defId === 'litter_tray')) {
    total += OBJECTS.litter_tray.price;
    extras.push(OBJECTS.litter_tray.name);
  }
  if (st.household.funds < total) return { ok: false, why: `Costs £${total}. Not enough money yet!`, total, extras };
  return { ok: true, total, extras };
}

export function adoptPet(game: Game, speciesId: string, name: string, color: string): { ok: boolean; why?: string; pet?: Pet } {
  const quote = adoptQuote(game, speciesId);
  if (!quote.ok) return { ok: false, why: quote.why };
  const sp = PET_SPECIES[speciesId];
  const st = game.state;
  let homeId: number | null = null;
  if (sp.habitat) {
    let home = st.lot.objects.find((o) => o.defId === sp.habitat && !occupant(game, o));
    if (!home) {
      home = placeTemp(game, sp.habitat, speciesId !== 'rabbit') ?? undefined;
      if (!home) return { ok: false, why: `There's no room for a ${OBJECTS[sp.habitat].name.toLowerCase()}. Clear some space first.` };
    }
    homeId = home.id;
  } else if (!st.lot.objects.some((o) => o.defId === 'pet_bowl')) {
    const bowl = placeTemp(game, 'pet_bowl', true);
    if (!bowl) return { ok: false, why: "There's no room for a food bowl. Clear some space first." };
    bowl.load = 100;
  }
  if (speciesId === 'cat' && !st.lot.objects.some((o) => o.defId === 'litter_tray')) {
    if (!placeTemp(game, 'litter_tray', true)) return { ok: false, why: "There's no room for a litter tray. Clear some space first." };
  }
  game.addFunds(-quote.total);
  const exit = game.exitTile();
  const home = homeId !== null ? game.object(homeId) : undefined;
  if (home) home.load = 100;
  const pet: Pet = {
    id: game.nextId(), species: speciesId, name: name.trim() || pick(st, sp.names), color,
    hunger: 85, fun: 80, clean: 90, energy: 85, bond: 20,
    pos: home ? objectCenter(home) : { x: exit.x + 0.5, z: exit.z + 0.5 }, facing: 0, anim: 'idle',
    location: 'lot', homeId, task: null, words: 0, tricks: 0, say: null, warnedAt: 0, adopted: st.time, poo: 20,
  };
  st.pets.push(pet);
  if (st.household.petFood < 10) st.household.petFood += 20;
  for (const sim of game.household()) addMoodlet(sim, 'new_pet', st.time);
  const tip = speciesId === 'dog' ? 'Keep the food bowl topped up, and pick up after them in the garden!'
    : speciesId === 'cat' ? 'Keep the food bowl topped up and the litter tray clean.'
    : `${pet.name} lives in the ${OBJECTS[sp.habitat!].name.toLowerCase()}. Clean it out every few days.`;
  game.notify(`Welcome home, ${pet.name} the ${sp.name.toLowerCase()}! ${tip}`, sp.icon, 'good');
  game.sound('levelup');
  return { ok: true, pet };
}

export function rehomePet(game: Game, petId: number): void {
  const pet = game.state.pets.find((p) => p.id === petId);
  if (!pet) return;
  game.state.pets = game.state.pets.filter((p) => p.id !== petId);
  game.notify(`${pet.name} has gone to live with a lovely family in ${pick(game.state, ['Bryn', 'Ashton Heath', 'Landgate', 'Stubshaw Cross'])}.`, speciesOf(pet)?.icon ?? '🐾', 'info');
}

// ---------- Per-minute update ----------

function pathNear(game: Game, from: Point, to: Point): Point[] | null {
  const grid = game.grid();
  const tx = Math.floor(to.x), tz = Math.floor(to.z);
  for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 0]]) {
    const p = findPath(grid, from, { x: tx + dx, z: tz + dz });
    if (p) return p;
  }
  return null;
}

function randomTile(game: Game, pet: Pet, radius: number, indoors?: boolean): Point[] | null {
  const lot = game.state.lot;
  const grid = game.grid();
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(pet.pos.x + (random(game.state) * 2 - 1) * radius);
    const z = Math.floor(pet.pos.z + (random(game.state) * 2 - 1) * radius);
    if (x < 0 || z < 1 || x >= lot.width || z >= lot.depth) continue;
    if (indoors !== undefined && (game.roomOf({ x: x + 0.5, z: z + 0.5 }) !== 0) !== indoors) continue;
    const p = findPath(grid, pet.pos, { x, z });
    if (p && p.length) return p;
  }
  return null;
}

function bowlWithFood(game: Game): PlacedObject | undefined {
  return game.state.lot.objects.find((o) => o.defId === 'pet_bowl' && (o.load ?? 0) > 5);
}

function decay(pet: Pet, dt: number, sleeping: boolean) {
  const d = speciesOf(pet).decay;
  const poorly = pet.sickSince !== undefined ? 1.6 : 1;
  const itchy = pet.fleas ? 1.5 : 1;
  pet.hunger = clamp(pet.hunger - (d.hunger / 60) * dt, 0, 100);
  pet.fun = clamp(pet.fun - (d.fun / 60) * dt * (sleeping ? 0.3 : 1) * poorly * itchy, 0, 100);
  pet.clean = clamp(pet.clean - (d.clean / 60) * dt * itchy, 0, 100);
  if (speciesOf(pet).roams) pet.energy = clamp(pet.energy + (sleeping ? 14 / 60 : (-d.energy / 60) * poorly) * dt, 0, 100);
  const rate = POO_RATE[pet.species];
  if (rate) pet.poo = clamp((pet.poo ?? 0) + (rate / 60) * dt * (sleeping ? 0.3 : 1), 0, 100);
}

// ---------- Poo ----------

export const poos = (game: Game) => game.state.lot.objects.filter((o) => o.defId === 'pet_poo');
export const litterTray = (game: Game) => game.state.lot.objects.find((o) => o.defId === 'litter_tray');

/** Leave a poo on (or next to) this spot. */
export function dropPoo(game: Game, pos: Point, pet: Pet | null): PlacedObject | null {
  const lot = game.state.lot;
  if (poos(game).length >= MAX_POOS) return null;
  const bx = Math.floor(pos.x), bz = Math.floor(pos.z);
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const x = bx + dx, z = bz + dz;
    if (x < 0 || z < 1 || x >= lot.width || z >= lot.depth) continue;
    if (!canPlaceObject(lot, 'pet_poo', x, z, 0)) continue;
    const obj: PlacedObject = { id: game.nextId(), defId: 'pet_poo', x, z, rot: ((x + z) % 4) as 0 | 1 | 2 | 3, users: OBJECTS.pet_poo.spots.map(() => null), dirt: 0, growth: 0, lightOn: false, bought: game.state.time };
    lot.objects.push(obj);
    game.lotChanged();
    const indoors = game.roomOf({ x: x + 0.5, z: z + 0.5 }) !== 0;
    if (pet && indoors) {
      game.notify(`Oh no, ${pet.name} had an accident indoors! 💩 Tap it to clean it up.${pet.species === 'cat' ? (litterTray(game) ? ' (The litter tray needs cleaning.)' : ' (Cats need a litter tray.)') : ''}`, '💩', 'bad');
    }
    return obj;
  }
  return null;
}

/** A Sim walking over this tile: did they tread in something? */
export function pooAt(game: Game, x: number, z: number): PlacedObject | undefined {
  return game.state.lot.objects.find((o) => o.defId === 'pet_poo' && o.x === x && o.z === z);
}

// ---------- Health ----------

export function petStatus(pet: Pet): string[] {
  const out: string[] = [];
  if (pet.sickSince !== undefined) out.push('🤒 Poorly: needs the vet');
  if (pet.fleas) out.push('🐜 Has fleas');
  if ((pet.poo ?? 0) >= 90) out.push('💩 Needs to go out');
  return out;
}

/** The vet comes round: poorly pets get better and fleas are sorted. */
export function vetVisit(game: Game, petId: number): { ok: boolean; why?: string } {
  const pet = game.state.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false };
  if (game.state.household.funds < VET_COST) return { ok: false, why: `The vet costs £${VET_COST}.` };
  game.addFunds(-VET_COST);
  const was = pet.sickSince !== undefined ? 'poorly' : pet.fleas ? 'fleas' : 'checkup';
  pet.sickSince = undefined;
  pet.fleas = false;
  pet.fleaGuard = game.state.time + 7 * 1440;
  pet.energy = Math.max(pet.energy, 60);
  pet.bond = clamp(pet.bond + 3, 0, 100);
  pet.say = { text: '💚', until: game.state.time + 30 };
  game.notify(was === 'poorly' ? `The vet checked ${pet.name} over and gave some medicine. ${pet.name} is feeling better already! (£${VET_COST})`
    : was === 'fleas' ? `The vet treated ${pet.name}'s fleas (£${VET_COST}).` : `${pet.name} had a check-up at the vet. All healthy! (£${VET_COST})`, '🩺', 'good');
  game.sound('cash');
  return { ok: true };
}

export function petsTick(game: Game, dt: number): void {
  const now = game.state.time;
  for (const pet of game.state.pets) {
    if (pet.say && pet.say.until < now) pet.say = null;
    if (pet.location !== 'lot') { decay(pet, dt * 0.5, false); continue; }
    const sp = speciesOf(pet);
    if (!sp) continue;
    if (!sp.roams) { cagedTick(game, pet, dt); continue; }
    const t = pet.task;
    decay(pet, dt, t?.kind === 'sleep' && t.i >= t.path.length);
    if (t?.kind === 'withSim') {
      const sim = game.sim(t.targetId!);
      if (!sim || sim.current?.petId !== pet.id) { pet.task = null; pet.anim = 'idle'; continue; }
      pet.facing = Math.atan2(sim.pos.x - pet.pos.x, sim.pos.z - pet.pos.z);
      continue;
    }
    if (t && t.i < t.path.length) {
      // Walk along the path.
      let budget = (sp.speed ?? 1.6) * dt * (t.kind === 'follow' ? 1.3 : 1);
      pet.anim = t.kind === 'follow' ? 'run' : 'walk';
      while (budget > 0 && t.i < t.path.length) {
        const n = t.path[t.i];
        const tx = n.x + 0.5 + (pet.id % 3 - 1) * 0.15, tz = n.z + 0.5;
        const dx = tx - pet.pos.x, dz = tz - pet.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-4) pet.facing = Math.atan2(dx, dz);
        if (dist <= budget) { pet.pos = { x: tx, z: tz }; budget -= dist; t.i++; }
        else { pet.pos = { x: pet.pos.x + (dx / dist) * budget, z: pet.pos.z + (dz / dist) * budget }; budget = 0; }
      }
      if (t.i >= t.path.length) {
        if (t.kind === 'poo') {
          doTheBusiness(game, pet);
          t.until = now + 3;
          pet.anim = 'sit';
          continue;
        }
        t.until = now + (t.kind === 'sleep' ? 90 + random(game.state) * 90 : t.kind === 'eat' ? 15 : 4 + random(game.state) * 14);
        pet.anim = t.kind === 'sleep' ? 'sleep' : t.kind === 'eat' ? 'eat' : random(game.state) < 0.5 ? 'sit' : 'idle';
      }
      continue;
    }
    if (t && now < t.until) {
      if (t.kind === 'eat') {
        const bowl = bowlWithFood(game);
        if (bowl) {
          pet.hunger = clamp(pet.hunger + 5 * dt, 0, 100);
          bowl.load = Math.max(0, (bowl.load ?? 0) - 1.5 * dt);
        }
        if (!bowl || pet.hunger >= 99) t.until = now;
      }
      if (t.kind === 'sleep' && pet.energy >= 99) t.until = now;
      continue;
    }
    chooseTask(game, pet);
  }
}

function doTheBusiness(game: Game, pet: Pet): void {
  pet.poo = 0;
  if (pet.species === 'cat') {
    const tray = litterTray(game);
    if (tray && tray.dirt < 100 && Math.hypot(objectCenter(tray).x - pet.pos.x, objectCenter(tray).z - pet.pos.z) < 2) {
      tray.dirt = Math.min(100, tray.dirt + 30);
      return;
    }
  }
  dropPoo(game, pet.pos, pet);
}

/** Where to go: dogs go in the garden, cats use a clean litter tray. Null means "here and now". */
function pooPath(game: Game, pet: Pet): Point[] | null {
  if (pet.species === 'cat') {
    const tray = litterTray(game);
    if (tray && tray.dirt < 100) {
      const tile = spotApproaches(tray, OBJECTS.litter_tray.spots[0])[0];
      return findPath(game.grid(), pet.pos, tile) ?? pathNear(game, pet.pos, objectCenter(tray));
    }
    return randomTile(game, pet, 4);
  }
  // Well-trained, happy dogs wait for the garden; others don't always make it.
  return randomTile(game, pet, 9, false) ?? (pet.bond > 40 ? null : randomTile(game, pet, 3));
}

function chooseTask(game: Game, pet: Pet): void {
  const st = game.state;
  const r = random(st);
  let task: Pet['task'] = null;
  if ((pet.poo ?? 0) >= 100) {
    const path = pooPath(game, pet);
    if (path) task = { kind: 'poo', path, i: 0, until: 0 };
    else doTheBusiness(game, pet);
  }
  const poorly = pet.sickSince !== undefined;
  if (!task && (pet.energy < 25 || (game.isNight() && r < 0.5 && pet.energy < 80) || (poorly && r < 0.6))) {
    const bed = st.lot.objects.find((o) => o.defId === 'pet_bed');
    const path = bed ? findPath(game.grid(), pet.pos, { x: bed.x, z: bed.z }) : randomTile(game, pet, 5, true);
    if (path) task = { kind: 'sleep', path, i: 0, until: 0 };
  }
  if (!task && pet.hunger < 50) {
    const bowl = bowlWithFood(game);
    if (bowl) {
      const def = OBJECTS[bowl.defId];
      const tile = spotApproaches(bowl, def.spots[0])[0];
      const path = findPath(game.grid(), pet.pos, tile) ?? pathNear(game, pet.pos, objectCenter(bowl));
      if (path) task = { kind: 'eat', path, i: 0, until: 0 };
    }
  }
  if (!task && pet.species === 'dog' && r < 0.45) {
    const people = game.household().filter((s) => s.location === 'lot');
    if (people.length) {
      const who = pick(st, people);
      const path = pathNear(game, pet.pos, who.pos);
      if (path && path.length) task = { kind: 'follow', path, i: 0, until: 0, targetId: who.id };
    }
  }
  if (!task && r < 0.75) {
    const path = randomTile(game, pet, pet.species === 'cat' ? 5 : 7, pet.species === 'cat' && game.isNight() ? true : undefined);
    if (path) task = { kind: 'wander', path, i: 0, until: 0 };
  }
  if (!task) {
    task = { kind: 'idle', path: [], i: 0, until: st.time + 5 + random(st) * 15 };
    pet.anim = pet.species === 'cat' && random(st) < 0.4 ? 'sleep' : 'sit';
  }
  pet.task = task;
}

function cagedTick(game: Game, pet: Pet, dt: number): void {
  const home = pet.homeId !== null ? game.object(pet.homeId) : undefined;
  if (!home) {
    // The cage was sold: the pet waits in a box until a new home is bought.
    decay(pet, dt * 0.5, false);
    const fresh = game.state.lot.objects.find((o) => o.defId === speciesOf(pet).habitat && !occupant(game, o));
    if (fresh) pet.homeId = fresh.id;
    return;
  }
  decay(pet, dt, false);
  pet.pos = objectCenter(home);
  // Droppings and old bedding build up in the cage.
  home.dirt = Math.round(100 - pet.clean);
  if ((home.load ?? 0) > 0 && pet.hunger < 85) {
    pet.hunger = clamp(pet.hunger + (8 / 60) * dt, 0, 100);
    home.load = Math.max(0, (home.load ?? 0) - (6 / 60) * dt);
  }
  // Something to look at.
  const night = game.isNight();
  pet.anim = pet.species === 'hamster' ? (night || game.minuteOfDay % 120 < 40 ? 'run' : 'sleep')
    : pet.species === 'rabbit' ? (game.minuteOfDay % 30 < 6 ? 'hop' : 'idle')
    : 'idle';
  const words = speciesOf(pet).words;
  if (pet.species === 'parrot' && words && pet.words > 0 && !pet.say && random(game.state) < 0.004 * dt) {
    pet.say = { text: words[Math.floor(random(game.state) * Math.min(words.length, pet.words))], until: game.state.time + 8 };
  }
}

/** Every hour: pets that need something make themselves known. */
export function petsHour(game: Game, hour: number): void {
  const st = game.state;
  for (const pet of st.pets) {
    if (pet.location !== 'lot') continue;
    const sp = speciesOf(pet);
    const happy = petHappiness(pet);
    if (st.time - pet.warnedAt > 8 * 60) {
      const need = pet.hunger < 20 ? 'is hungry' : pet.fun < 15 ? 'is bored and wants to play' : pet.clean < 15 ? (sp.roams ? 'needs a wash' : 'needs its cage cleaning') : null;
      if (need) {
        pet.warnedAt = st.time;
        game.notify(`${pet.name} ${need}!${pet.hunger < 20 && st.household.petFood <= 0 ? ' You are out of pet food: go to the pet shop.' : ''}`, sp.icon, 'bad');
      }
    }
    if (hour % 4 === 0 && happy < 25) for (const sim of game.household()) if (sim.location === 'lot') addMoodlet(sim, 'worried_pet', st.time);
    if (happy > 70) pet.bond = clamp(pet.bond + 0.3, 0, 100);
    if (hour === 9) healthCheck(game, pet);
    if (pet.fleas && !pet.say && random(st) < 0.35) pet.say = { text: '🐜 scratch scratch', until: st.time + 15 };
    else if (pet.sickSince !== undefined && !pet.say && random(st) < 0.3) pet.say = { text: '🤒', until: st.time + 20 };
    // Fleas get everywhere.
    if (pet.fleas && hour % 3 === 0) for (const sim of game.household()) if (sim.location === 'lot' && random(st) < 0.25) addMoodlet(sim, 'itchy', st.time);
  }
  pooHour(game, hour);
}

function healthCheck(game: Game, pet: Pet): void {
  const st = game.state;
  const sp = speciesOf(pet);
  if (pet.sickSince !== undefined && st.time - pet.sickSince > 4 * 1440) {
    pet.sickSince = undefined;
    game.notify(`${pet.name} is feeling better on their own. Phew!`, sp.icon, 'good');
  } else if (pet.sickSince === undefined && random(st) < 0.015 + (petHappiness(pet) < 30 ? 0.12 : 0) + (pet.clean < 20 ? 0.05 : 0)) {
    pet.sickSince = st.time;
    game.notify(`${pet.name} seems poorly 🤒 and doesn't want to play. Call the vet (Pets, or the Vet app on your phone).`, '🤒', 'bad');
  }
  if ((pet.species === 'dog' || pet.species === 'cat') && !pet.fleas && st.time > (pet.fleaGuard ?? 0)
    && random(st) < 0.035 + (pet.clean < 40 ? 0.1 : 0)) {
    pet.fleas = true;
    game.notify(`${pet.name} keeps scratching. Looks like fleas! 🐜 Tap ${pet.name} → Flea treatment (£${FLEA_COST}).`, '🐜', 'bad');
  }
}

function pooHour(game: Game, hour: number): void {
  const st = game.state;
  const list = poos(game);
  if (!list.length) return;
  for (const p of list) p.dirt = Math.min(100, p.dirt + 4); // gets smellier
  const indoors = list.filter((p) => game.roomOf({ x: p.x + 0.5, z: p.z + 0.5 }) !== 0);
  if (indoors.length) {
    for (const sim of game.household()) {
      if (sim.location !== 'lot') continue;
      if (indoors.some((p) => game.roomOf({ x: p.x + 0.5, z: p.z + 0.5 }) === game.roomOf(sim.pos))) addMoodlet(sim, 'poo_smell', st.time);
    }
  }
  if (hour === 17 && list.length >= 3) {
    game.notify(`There's dog poo all over the garden (${list.length})! Tap it to pick it up before someone treads in it.`, '💩', 'info');
    if (list.length >= 6) st.household.neighbourMood = clamp(st.household.neighbourMood - 2, 0, 100);
  }
}

// ---------- Sims and pets ----------

export function petActionsFor(game: Game, sim: Sim, pet: Pet): { def: PetActionDef; ok: boolean; why?: string }[] {
  const sp = speciesOf(pet);
  if (!sp?.roams || pet.location !== 'lot') return [];
  const visitor = !game.isHousehold(sim);
  return sp.actions
    .filter((a) => !visitor || a.id === 'pet' || a.id === 'fetch' || a.id === 'play')
    .map((def) => {
      if (def.id === 'bath' && pet.clean > 70) return { def, ok: false, why: `${pet.name} is clean` };
      if (def.id === 'groom' && pet.clean > 90) return { def, ok: false, why: 'Already brushed' };
      if ((def.id === 'fetch' || def.id === 'play') && pet.energy < 15) return { def, ok: false, why: `${pet.name} is too sleepy` };
      if ((def.id === 'fetch' || def.id === 'play') && pet.sickSince !== undefined) return { def, ok: false, why: `${pet.name} is poorly` };
      if (def.condition === 'treats' && (game.state.household.petTreats ?? 0) <= 0) return { def, ok: false, why: 'No treats. Buy some on your phone or at the pet shop' };
      if (def.cost && game.state.household.funds < def.cost) return { def, ok: false, why: `Costs £${def.cost}` };
      return { def, ok: true };
    })
    .filter((x) => x.def.condition !== 'fleas' || pet.fleas);
}

export function applyPetAction(game: Game, sim: Sim, pet: Pet, def: PetActionDef): void {
  const e = def.pet;
  pet.fun = clamp(pet.fun + (e.fun ?? 0), 0, 100);
  pet.clean = clamp(pet.clean + (e.clean ?? 0), 0, 100);
  pet.energy = clamp(pet.energy + (e.energy ?? 0), 0, 100);
  pet.hunger = clamp(pet.hunger + (e.hunger ?? 0), 0, 100);
  pet.bond = clamp(pet.bond + (e.bond ?? 0), 0, 100);
  if (def.moodlet) addMoodlet(sim, def.moodlet, game.state.time);
  if (def.special === 'treat') {
    game.state.household.petTreats = Math.max(0, (game.state.household.petTreats ?? 0) - 1);
    pet.say = { text: '😋', until: game.state.time + 10 };
  }
  if (def.special === 'fleas') {
    if (def.cost) game.addFunds(-def.cost);
    pet.fleas = false;
    pet.fleaGuard = game.state.time + 7 * 1440;
    game.notify(`${sim.name} gave ${pet.name} flea treatment. No more scratching!`, '🐜', 'good');
  }
  if (def.special === 'trick') {
    pet.tricks++;
    const tricks = ['sit', 'give a paw', 'roll over', 'play dead', 'spin', 'high five', 'fetch the post'];
    if (pet.tricks <= tricks.length * 2 && pet.tricks % 2 === 0) game.notify(`${pet.name} learned to ${tricks[pet.tricks / 2 - 1]}!`, '🦴', 'good');
  }
}

/** Object interactions on bowls, cages and hutches. Returns true if handled. */
export function petObjectSpecial(game: Game, obj: PlacedObject, special: string): boolean {
  const st = game.state;
  const pet = occupant(game, obj);
  switch (special) {
    case 'fillBowl':
      st.household.petFood = Math.max(0, st.household.petFood - 2);
      obj.load = 100;
      return true;
    case 'feedCaged':
      st.household.petFood = Math.max(0, st.household.petFood - 1);
      obj.load = 100;
      if (pet) pet.hunger = clamp(pet.hunger + 20, 0, 100);
      return true;
    case 'playCaged':
      if (!pet) return true;
      pet.fun = clamp(pet.fun + 45, 0, 100);
      pet.bond = clamp(pet.bond + 4, 0, 100);
      if (pet.species === 'parrot') {
        const words = speciesOf(pet).words ?? [];
        if (pet.words < words.length && random(st) < 0.6) {
          pet.words++;
          pet.say = { text: words[pet.words - 1], until: st.time + 15 };
          game.notify(`${pet.name} learned to say "${words[pet.words - 1]}"`, '🦜', 'good');
        }
      }
      return true;
    case 'cleanCage':
      if (pet) pet.clean = 100;
      obj.dirt = 0;
      st.household.rubbish = Math.min(120, st.household.rubbish + 4);
      return true;
    case 'treatCaged':
      st.household.petTreats = Math.max(0, (st.household.petTreats ?? 0) - 1);
      if (pet) { pet.fun = clamp(pet.fun + 15, 0, 100); pet.bond = clamp(pet.bond + 5, 0, 100); pet.say = { text: '😋', until: st.time + 10 }; }
      return true;
    case 'exercise':
      if (!pet) return true;
      pet.fun = clamp(pet.fun + 60, 0, 100);
      pet.bond = clamp(pet.bond + 5, 0, 100);
      if (pet.species === 'rabbit' && random(st) < 0.5) dropPoo(game, { x: obj.x + 0.5, z: obj.z + 1.5 }, null);
      return true;
    case 'scoopPoo':
      st.lot.objects = st.lot.objects.filter((o) => o !== obj);
      st.household.rubbish = Math.min(120, st.household.rubbish + 2);
      game.lotChanged();
      return true;
    case 'cleanTray':
      obj.dirt = 0;
      st.household.rubbish = Math.min(120, st.household.rubbish + 5);
      return true;
  }
  return false;
}

export function petCondition(game: Game, obj: PlacedObject, condition: string): { ok: boolean; hidden?: boolean; reason?: string } | null {
  const pet = occupant(game, obj);
  switch (condition) {
    case 'hasPet': return pet ? { ok: true } : { ok: false, hidden: true };
    case 'petHungry':
      if (!pet) return { ok: false, hidden: true };
      if (game.state.household.petFood <= 0) return { ok: false, reason: 'No pet food. Go to the pet shop!' };
      return pet.hunger < 80 || (obj.load ?? 0) < 30 ? { ok: true } : { ok: false, reason: `${pet.name} isn't hungry` };
    case 'cageDirty': return pet && pet.clean < 60 ? { ok: true } : { ok: false, hidden: true };
    case 'hasTreats':
      if (!pet) return { ok: false, hidden: true };
      return (game.state.household.petTreats ?? 0) > 0 ? { ok: true } : { ok: false, reason: 'No treats. Buy some on your phone or at the pet shop' };
    case 'bowlLow':
      if ((obj.load ?? 0) > 60) return { ok: false, hidden: true };
      if (game.state.household.petFood <= 0) return { ok: false, reason: 'No pet food. Go to the pet shop!' };
      return { ok: true };
  }
  return null;
}

/** Take the dog along on a walk. */
export function takeDog(game: Game, sim: Sim): Pet | undefined {
  const dog = game.state.pets.find((p) => p.species === 'dog' && p.location === 'lot');
  if (dog) { dog.location = 'away'; dog.task = { kind: 'idle', path: [], i: 0, until: 0, targetId: sim.id }; }
  return dog;
}

export function dogBack(game: Game, sim: Sim): void {
  const dog = game.state.pets.find((p) => p.location === 'away' && p.task?.targetId === sim.id);
  if (!dog) return;
  const exit = game.exitTile();
  dog.location = 'lot';
  dog.pos = { x: exit.x + 0.8, z: exit.z + 0.5 };
  dog.fun = clamp(dog.fun + 50, 0, 100);
  dog.energy = clamp(dog.energy - 20, 0, 100);
  dog.bond = clamp(dog.bond + 6, 0, 100);
  dog.poo = 0; // went on the walk (and the poo bag went in the bin)
  dog.task = null;
  const season = calendarOf(game.day).season.id;
  if ((season === 'autumn' || season === 'winter') && random(game.state) < 0.6) {
    dog.clean = clamp(dog.clean - 35, 0, 100);
    game.state.household.dust = clamp(game.state.household.dust + 8, 0, 100);
    game.notify(`${dog.name} came back with muddy paws and trailed mud through the house! 🐾`, '🐾', 'info');
  }
}

export { label as petLabel };
