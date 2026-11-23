// Pets: dogs and cats roam the lot; parrots, rabbits and hamsters live in a cage or hutch.
// Pets get hungry, bored and grubby, but nothing bad ever happens to them.
import { OBJECTS, PET_SPECIES, type PetActionDef } from './defs';
import type { Game } from './game';
import { objectCenter, spotApproaches } from './lot';
import { addMoodlet, clamp } from './mood';
import { findPath } from './path';
import { pick, random } from './rng';
import { placeTemp } from './life';
import type { Pet, PlacedObject, Point, Sim } from './types';

export const MAX_PETS = 4;

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
  game.addFunds(-quote.total);
  const exit = game.exitTile();
  const home = homeId !== null ? game.object(homeId) : undefined;
  if (home) home.load = 100;
  const pet: Pet = {
    id: game.nextId(), species: speciesId, name: name.trim() || pick(st, sp.names), color,
    hunger: 85, fun: 80, clean: 90, energy: 85, bond: 20,
    pos: home ? objectCenter(home) : { x: exit.x + 0.5, z: exit.z + 0.5 }, facing: 0, anim: 'idle',
    location: 'lot', homeId, task: null, words: 0, tricks: 0, say: null, warnedAt: 0, adopted: st.time,
  };
  st.pets.push(pet);
  if (st.household.petFood < 10) st.household.petFood += 20;
  for (const sim of game.household()) addMoodlet(sim, 'new_pet', st.time);
  game.notify(`Welcome home, ${pet.name} the ${sp.name.toLowerCase()}! ${sp.roams ? 'Keep the food bowl topped up.' : `${pet.name} lives in the ${OBJECTS[sp.habitat!].name.toLowerCase()}.`}`, sp.icon, 'good');
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
  pet.hunger = clamp(pet.hunger - (d.hunger / 60) * dt, 0, 100);
  pet.fun = clamp(pet.fun - (d.fun / 60) * dt * (sleeping ? 0.3 : 1), 0, 100);
  pet.clean = clamp(pet.clean - (d.clean / 60) * dt, 0, 100);
  if (speciesOf(pet).roams) pet.energy = clamp(pet.energy + (sleeping ? 14 / 60 : -d.energy / 60) * dt, 0, 100);
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

function chooseTask(game: Game, pet: Pet): void {
  const st = game.state;
  const r = random(st);
  let task: Pet['task'] = null;
  if (pet.energy < 25 || (game.isNight() && r < 0.5 && pet.energy < 80)) {
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
      return { def, ok: true };
    });
}

export function applyPetAction(game: Game, sim: Sim, pet: Pet, def: PetActionDef): void {
  const e = def.pet;
  pet.fun = clamp(pet.fun + (e.fun ?? 0), 0, 100);
  pet.clean = clamp(pet.clean + (e.clean ?? 0), 0, 100);
  pet.energy = clamp(pet.energy + (e.energy ?? 0), 0, 100);
  pet.hunger = clamp(pet.hunger + (e.hunger ?? 0), 0, 100);
  pet.bond = clamp(pet.bond + (e.bond ?? 0), 0, 100);
  if (def.moodlet) addMoodlet(sim, def.moodlet, game.state.time);
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
  dog.task = null;
}

export { label as petLabel };
