// Everyday life systems: the calendar and holidays, food shopping, driving, parties and noise,
// and how fast the clock runs by day and by night.
import { townHour } from './town';
import { addClothesDirt, clothesHour } from './clothes';
import { phoneHour } from './phone';
import { CAREERS, OBJECTS, OUTINGS, type OutingDef } from './defs';
import type { Game } from './game';
import { MINUTES_PER_DAY } from './game';
import { canPlaceObject, spotApproaches } from './lot';
import { addMoodlet, clamp } from './mood';
import { findPath } from './path';
import { changeRel } from './relationships';
import { chance, pick } from './rng';
import { enqueue, interrupt } from './actions';
import type { Party, PlacedObject, Sim } from './types';
import { homeHour } from './home';
import { dogBack, petsHour } from './pets';

// ---------- Clock speed ----------

/** At normal speed the day (07:00–21:00) takes 15 real minutes and the night 8.5. */
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 21;
export const REAL_MINUTES_DAY = 15;
export const REAL_MINUTES_NIGHT = 8.5;

export function isDaytime(minuteOfDay: number): boolean {
  const h = minuteOfDay / 60;
  return h >= DAY_START_HOUR && h < DAY_END_HOUR;
}

/** Game minutes that pass per real second at 1x. */
export function gameMinutesPerSecond(minuteOfDay: number): number {
  const dayMinutes = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const nightMinutes = MINUTES_PER_DAY - dayMinutes;
  return isDaytime(minuteOfDay) ? dayMinutes / (REAL_MINUTES_DAY * 60) : nightMinutes / (REAL_MINUTES_NIGHT * 60);
}

// ---------- Calendar ----------

export const SEASONS = [
  { id: 'spring', name: 'Spring', icon: '🌸' },
  { id: 'summer', name: 'Summer', icon: '☀️' },
  { id: 'autumn', name: 'Autumn', icon: '🍂' },
  { id: 'winter', name: 'Winter', icon: '❄️' },
] as const;
export type SeasonId = (typeof SEASONS)[number]['id'];
export const DAYS_PER_SEASON = 7;
export const YEAR_DAYS = DAYS_PER_SEASON * SEASONS.length;

export interface CalendarDay { year: number; season: (typeof SEASONS)[number]; seasonIndex: number; dayOfSeason: number }

export function calendarOf(day: number): CalendarDay {
  const inYear = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  const seasonIndex = Math.floor(inYear / DAYS_PER_SEASON);
  return { year: Math.floor(day / YEAR_DAYS) + 1, season: SEASONS[seasonIndex], seasonIndex, dayOfSeason: (inYear % DAYS_PER_SEASON) + 1 };
}

export interface CalendarEvent {
  id: string; name: string; icon: string; season: SeasonId; days: number[]; desc: string;
  /** Decorations to put out: defId, whether indoors, and how many days they stay. */
  temps?: { defId: string; indoors: boolean; days: number }[];
  /** Nobody works. */
  dayOff?: boolean;
  /** Fireworks fill the sky between these hours. */
  fireworks?: [number, number];
}

export const EVENTS: CalendarEvent[] = [
  { id: 'easter', name: 'Easter Sunday', icon: '🐣', season: 'spring', days: [7], desc: 'Egg hunt in the garden and an Easter fair in town.', temps: [{ defId: 'easter_eggs', indoors: false, days: 1 }] },
  { id: 'summer', name: 'Summer holidays', icon: '🏖️', season: 'summer', days: [1, 2, 3, 4, 5, 6, 7], desc: 'Schools are out. Book a holiday if you have saved up, or go to the beach.' },
  { id: 'halloween', name: 'Halloween', icon: '🎃', season: 'autumn', days: [5], desc: 'Carve a pumpkin and go trick or treating after dark.', temps: [{ defId: 'pumpkin', indoors: false, days: 2 }] },
  { id: 'bonfire', name: 'Bonfire Night', icon: '🎆', season: 'autumn', days: [6], desc: 'Remember, remember the fifth of November! Fireworks after dark.', temps: [{ defId: 'fireworks_box', indoors: false, days: 1 }], fireworks: [18.5, 22.5] },
  { id: 'christmas_eve', name: 'Christmas Eve', icon: '🎄', season: 'winter', days: [5], desc: 'Put the tree up!', temps: [{ defId: 'christmas_tree', indoors: true, days: 3 }] },
  { id: 'christmas', name: 'Christmas Day', icon: '🎁', season: 'winter', days: [6], desc: 'Presents under the tree. Nobody has to work.', temps: [{ defId: 'presents', indoors: true, days: 1 }], dayOff: true },
  { id: 'nye', name: "New Year's Eve", icon: '🥂', season: 'winter', days: [7], desc: 'Fireworks at midnight!', fireworks: [23.5, 24] },
];

export function eventsOn(day: number): CalendarEvent[] {
  const c = calendarOf(day);
  return EVENTS.filter((e) => e.season === c.season.id && e.days.includes(c.dayOfSeason));
}

export function isEventToday(game: Game, id: string): boolean {
  return eventsOn(game.day).some((e) => e.id === id);
}

export function fireworksActive(game: Game): boolean {
  if (game.state.fireworksUntil > game.state.time) return true;
  const h = game.minuteOfDay / 60;
  for (const e of eventsOn(game.day)) if (e.fireworks && h >= e.fireworks[0] && h < e.fireworks[1]) return true;
  // New Year fireworks carry on just past midnight.
  if (h < 0.5 && game.day > 0 && eventsOn(game.day - 1).some((e) => e.id === 'nye')) return true;
  return false;
}

/** Nobody minds noise on Bonfire Night or New Year's Eve. */
function noiseExcused(game: Game): boolean {
  const h = game.minuteOfDay / 60;
  if (eventsOn(game.day).some((e) => e.id === 'bonfire' || e.id === 'nye')) return true;
  return h < 1 && game.day > 0 && eventsOn(game.day - 1).some((e) => e.id === 'nye');
}

/** Is this Sim's job on today? Holidays and school holidays count. */
export function worksToday(game: Game, sim: Sim): boolean {
  if (!sim.career) return false;
  const def = CAREERS[sim.career.id];
  const lvl = def?.levels[sim.career.level];
  if (!lvl || !lvl.days.includes(game.weekday)) return false;
  const today = eventsOn(game.day);
  if (today.some((e) => e.dayOff)) return false;
  if (def.schoolHolidays) {
    const c = calendarOf(game.day);
    if (today.some((e) => e.id === 'summer') || (c.season.id === 'winter' && c.dayOfSeason >= 5)) return false;
  }
  return true;
}

// ---------- Decorations ----------

function exitReachable(game: Game, obj: PlacedObject): boolean {
  const def = OBJECTS[obj.defId];
  const grid = game.grid();
  return def.spots.some((s) => spotApproaches(obj, s).some((t) => findPath(grid, game.exitTile(), t) !== null));
}

/** Find a free, reachable spot for a decoration, inside if asked (and possible). */
export function placeTemp(game: Game, defId: string, indoors: boolean, expiresDay?: number): PlacedObject | null {
  const lot = game.state.lot;
  const def = OBJECTS[defId];
  const cx = lot.width / 2, cz = lot.depth / 2;
  const candidates: { x: number; z: number; rot: 0 | 1 | 2 | 3; score: number }[] = [];
  for (let x = 0; x < lot.width; x++) {
    for (let z = 1; z < lot.depth; z++) {
      for (const rot of [0, 2] as const) {
        if (!canPlaceObject(lot, defId, x, z, rot)) continue;
        const room = game.roomOf({ x: x + 0.5, z: z + 0.5 });
        let score = Math.hypot(x - cx, z - cz);
        if (indoors) score += room === 0 ? 40 : 0;
        else score += room === 0 ? 0 : 40;
        candidates.push({ x, z, rot, score });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const c of candidates.slice(0, 60)) {
    const obj: PlacedObject = {
      id: game.nextId(), defId, x: c.x, z: c.z, rot: c.rot, users: def.spots.map(() => null), dirt: 0, growth: 0,
      lightOn: !!def.light, bought: game.state.time, expiresDay,
    };
    lot.objects.push(obj);
    game.lotChanged();
    if (exitReachable(game, obj)) return obj;
    lot.objects.pop();
    game.lotChanged();
  }
  return null;
}

function removeExpiredTemps(game: Game): void {
  const lot = game.state.lot;
  const keep = lot.objects.filter((o) => o.expiresDay === undefined || o.expiresDay >= game.day);
  if (keep.length === lot.objects.length) return;
  for (const o of lot.objects) {
    if (keep.includes(o)) continue;
    for (const sim of game.state.sims) if (sim.current?.objectId === o.id || sim.current?.reserved?.objectId === o.id) interrupt(game, sim);
  }
  lot.objects = keep;
  game.lotChanged();
}

// ---------- Hourly and per-minute ----------

export function onHour(game: Game, hour: number): void {
  const st = game.state;
  homeHour(game, hour);
  petsHour(game, hour);
  clothesHour(game, hour);
  phoneHour(game, hour);
  townHour(game, hour);
  const cal = calendarOf(game.day);
  if (hour === 0) {
    removeExpiredTemps(game);
    st.household.neighbourMood = clamp(st.household.neighbourMood + 8, 0, 100);
    if (cal.seasonIndex === 0 && cal.dayOfSeason === 1 && game.day > 0) {
      game.notify(`Happy New Year! Welcome to Year ${cal.year}. 🎉`, '🥂', 'good');
    }
  }
  if (hour === 7) {
    for (const e of eventsOn(game.day)) {
      for (const t of e.temps ?? []) {
        if (st.lot.objects.some((o) => o.defId === t.defId)) continue;
        const placed = placeTemp(game, t.defId, t.indoors, game.day + t.days - 1);
        if (!placed) game.notify(`There was no room for the ${OBJECTS[t.defId].name}. Clear some space!`, e.icon, 'info');
      }
    }
  }
  if (hour === 8) {
    if (cal.dayOfSeason === 1) {
      const extra = cal.season.id === 'summer' ? ' Summer holidays! Save up and book a trip in "Go out".' : cal.season.id === 'winter' ? ' Christmas is on the way.' : '';
      game.notify(`${cal.season.name} has arrived.${extra}`, cal.season.icon, 'info');
    }
    for (const e of eventsOn(game.day)) {
      if (e.id === 'summer' && cal.dayOfSeason !== 1) continue;
      if (e.id !== 'summer') game.notify(`Today is ${e.name}! ${e.desc}`, e.icon, 'good');
    }
  }
  if (hour === 18) st.noise = { tonight: 0, stage: 0 };
}

export function runLife(game: Game, dt: number): void {
  const st = game.state;
  const party = st.party;
  if (party) {
    if (!party.started && st.time >= party.start) startParty(game, party);
    else if (party.started && st.time >= party.end) endParty(game, false);
  }
  // Late-night noise.
  const h = game.minuteOfDay / 60;
  if ((h >= 22 || h < 7) && !noiseExcused(game)) {
    let loud = 0;
    for (const sim of game.simsOnLot()) if (sim.current?.phase === 'perform' && sim.current.tags?.includes('loud')) loud++;
    if (loud > 0) {
      st.noise.tonight += loud * dt;
      st.household.neighbourMood = clamp(st.household.neighbourMood - loud * dt * 0.06, 0, 100);
      noiseConsequences(game);
    }
  }
  // Running low on food.
  const food = st.household.groceries;
  if (food <= 6 && !st.flags.lowFoodWarned) {
    st.flags.lowFoodWarned = true;
    game.notify(food <= 0 ? 'The fridge is empty! Go food shopping, or order a takeaway.' : 'Food is running low. Time for a trip to the shops.', '🛒', 'bills');
  }
}

function noiseConsequences(game: Game): void {
  const st = game.state;
  const n = st.noise;
  const neighbour = game.sim(st.household.nextDoorId);
  const who = neighbour ? `${neighbour.name.split(' ')[0]} from next door` : 'The neighbours';
  if (n.stage < 1 && n.tonight >= 20) {
    n.stage = 1;
    game.notify(`🔊 It's late and ${who} is banging on the wall. Turn it down!`, '🔊', 'bad');
    game.sound('error');
  } else if (n.stage < 2 && n.tonight >= 60) {
    n.stage = 2;
    game.notify(`😠 ${who} came round to complain about the noise.`, '😠', 'bad');
    for (const sim of game.household()) {
      if (sim.location === 'lot') addMoodlet(sim, 'told_off', st.time);
      if (neighbour) changeRel(st, sim.id, neighbour.id, -12, 0);
    }
  } else if (n.stage < 3 && n.tonight >= 120) {
    n.stage = 3;
    game.addFunds(-80);
    game.notify('👮 The neighbours complained to the council. Noise fine: £80.', '👮', 'bad');
    if (st.party?.started) endParty(game, true);
  }
}

// ---------- Food ----------

export function hasFood(game: Game, n: number): boolean { return game.state.household.groceries >= n; }

export function useFood(game: Game, n: number): void {
  const st = game.state;
  st.household.groceries = Math.max(0, st.household.groceries - n);
}

export function addFood(game: Game, n: number): void {
  game.state.household.groceries += n;
  if (game.state.household.groceries > 6) game.state.flags.lowFoodWarned = false;
}

// ---------- Driving ----------

export function familyCar(game: Game): PlacedObject | undefined {
  return game.state.lot.objects.find((o) => o.defId === 'car');
}

export const MIN_FUEL = 15;

export function carFuel(car: PlacedObject): number { return car.fuel ?? 100; }

export function canDriveNow(game: Game, sim: Sim): boolean {
  const car = familyCar(game);
  return sim.driving.licence && !!car && !car.outWith && carFuel(car) >= MIN_FUEL;
}

/** On leaving the lot: take the car if possible. Returns true when driving. */
export function takeCar(game: Game, sim: Sim, refuelling = false): boolean {
  const car = familyCar(game);
  if (!car || !sim.driving.licence || car.outWith) return false;
  if (!refuelling && carFuel(car) < MIN_FUEL) {
    game.notify(`The car is nearly out of petrol, so ${sim.name} took the bus. Fill up at the petrol station!`, '⛽', 'bad');
    return false;
  }
  car.outWith = sim.id;
  car.dirt = Math.min(100, car.dirt + 20);
  if (!refuelling) {
    car.fuel = Math.max(0, carFuel(car) - 12);
    if (carFuel(car) < 30) game.notify('The petrol light is on. Fill up soon!', '⛽', 'info');
  }
  game.lotChanged();
  return true;
}

export function returnCar(game: Game, sim: Sim): void {
  const car = familyCar(game);
  if (car && car.outWith === sim.id) {
    car.outWith = null;
    game.lotChanged();
  }
}

export function drivingTest(game: Game, sim: Sim): void {
  const p = Math.min(0.92, 0.45 + (sim.driving.lessons - 5) * 0.1);
  if (chance(game.state, p)) {
    sim.driving.licence = true;
    addMoodlet(sim, 'passed_test', game.state.time);
    game.notify(`${sim.name} passed their driving test! Buy a car (Buy mode → Garden) to drive everywhere.`, '🚗', 'good');
    game.sound('levelup');
  } else {
    addMoodlet(sim, 'failed_test', game.state.time);
    game.notify(`${sim.name} failed their driving test. Another lesson will help.`, '🚧', 'bad');
  }
}

// ---------- Outings ----------

export interface OutingCheck { ok: boolean; hidden?: boolean; why?: string }

export function outingCheck(game: Game, sim: Sim, o: OutingDef): OutingCheck {
  const cal = calendarOf(game.day);
  if (o.season && o.season !== cal.season.id) return { ok: false, hidden: true };
  if (o.seasonDays && !o.seasonDays.includes(cal.dayOfSeason)) return { ok: false, hidden: true };
  if (o.event && !isEventToday(game, o.event)) return { ok: false, hidden: true };
  if (o.household && !game.isHousehold(sim)) return { ok: false, hidden: true };
  switch (o.condition) {
    case 'learner': if (sim.driving.licence) return { ok: false, hidden: true }; break;
    case 'testReady':
      if (sim.driving.licence) return { ok: false, hidden: true };
      if (sim.driving.lessons < 5) return { ok: false, why: `Needs 5 driving lessons (${sim.driving.lessons}/5)` };
      break;
    case 'hasDog':
      if (!game.state.pets.some((p) => p.species === 'dog')) return { ok: false, hidden: true };
      if (!game.state.pets.some((p) => p.species === 'dog' && p.location === 'lot')) return { ok: false, why: 'The dog is already out' };
      break;
    case 'canDrive': {
      if (!sim.driving.licence) return { ok: false, hidden: true };
      const car = familyCar(game);
      if (!car) return { ok: false, why: 'Buy a car first' };
      if (car.outWith) return { ok: false, why: 'The car is out' };
      if (o.special === 'refuel') {
        if (carFuel(car) >= 95) return { ok: false, why: 'The tank is already full' };
        const cost = Math.round((100 - carFuel(car)) * 0.9);
        if (game.state.household.funds < cost) return { ok: false, why: `Petrol costs £${cost}` };
      } else if (carFuel(car) < MIN_FUEL) return { ok: false, why: 'Out of petrol! Fill up first' };
      break;
    }
  }
  if (o.days && !o.days.includes(game.weekday)) return { ok: false, why: `Only on ${o.days.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ')}` };
  const hour = game.hour;
  if (o.hours && (hour < o.hours[0] || hour >= o.hours[1])) return { ok: false, why: `Open ${o.hours[0]}:00–${o.hours[1]}:00` };
  const people = o.household ? game.household().filter((s) => s.location === 'lot').length : 1;
  if (o.cost && game.state.household.funds < o.cost * people) return { ok: false, why: `Costs £${o.cost * people}. Not enough money yet!` };
  if (sim.location !== 'lot') return { ok: false, why: 'Not at home' };
  return { ok: true };
}

/** Effects when a Sim comes back from an outing. */
export function outingReturn(game: Game, sim: Sim, id: string): void {
  const o = OUTINGS[id];
  if (!o) return;
  if (o.groceries) {
    addFood(game, o.groceries);
    game.notify(`${sim.name} stocked up the fridge (+${o.groceries} food).`, '🛒', 'good');
  }
  if (o.special === 'lesson') {
    sim.driving.lessons++;
    game.notify(sim.driving.lessons >= 5 ? `${sim.name} has had ${sim.driving.lessons} lessons and is ready for the driving test!` : `${sim.name} had driving lesson ${sim.driving.lessons} of 5.`, '🚦', 'info');
  }
  if (o.special === 'drivingTest') drivingTest(game, sim);
  if (o.special === 'refuel') {
    const car = familyCar(game);
    if (car) {
      const cost = Math.round((100 - carFuel(car)) * 0.9);
      game.addFunds(-cost);
      car.fuel = 100;
      game.notify(`${sim.name} filled up the car with petrol (£${cost}).`, '⛽', 'info');
    }
  }
  if (o.special === 'petFood') {
    game.state.household.petFood += 30;
    game.state.household.petTreats = (game.state.household.petTreats ?? 0) + 5;
    game.notify(`${sim.name} bought pet food (+30) and treats (+5).`, '🦴', 'good');
  }
  addClothesDirt(sim, o.special === 'dogWalk' || id === 'walk' ? 12 : o.duration >= 1440 ? 40 : 8);
  if (o.special === 'dogWalk') dogBack(game, sim);
  if (o.groceries && game.state.pets.length) game.state.household.petFood += 10;
  if (o.special === 'bargain') {
    game.state.household.discount = 0.25;
    addMoodlet(sim, 'bargain', game.state.time);
    game.notify(`${sim.name} came back from B&M with a voucher: 25% off your next Buy mode purchase!`, '🏷️', 'good');
  }
  if (o.special === 'clothes') game.events.push({ type: 'openPanel', panel: 'clothes', simId: sim.id });
  if (o.souvenir && !game.state.household.marketFinds.includes(o.souvenir)) {
    game.state.household.marketFinds.push(o.souvenir);
    game.notify(`Souvenir! A ${OBJECTS[o.souvenir].name} is now in the Buy catalogue (Market finds).`, '🎁', 'good');
  }
  if (o.leave && sim.career) sim.career.workedToday = true;
  returnCar(game, sim);
}

/** Send the whole household on an outing together (holidays). */
export function householdOuting(game: Game, id: string): void {
  const o = OUTINGS[id];
  for (const sim of game.household()) {
    if (sim.location !== 'lot') continue;
    interrupt(game, sim);
    sim.queue = [];
    enqueue(game, sim, { kind: 'outing', selfId: id, label: o.name, icon: o.icon, userQueued: true });
  }
}

// ---------- Parties ----------

export const PARTY_THEMES = {
  karaoke: { name: 'Karaoke night', icon: '🎤' },
  dance: { name: 'Dance party', icon: '💃' },
  bbq: { name: 'Garden barbecue', icon: '🍔' },
} as const;

export const PARTY_COST_PER_GUEST = 8;

export function planParty(game: Game, host: Sim, theme: Party['theme'], start: number, guests: number[]): { ok: boolean; why?: string } {
  const st = game.state;
  if (st.party) return { ok: false, why: 'A party is already planned.' };
  if (!guests.length) return { ok: false, why: 'Invite at least one friend.' };
  const cost = guests.length * PARTY_COST_PER_GUEST;
  if (st.household.funds < cost) return { ok: false, why: `Party food and drinks cost £${cost}.` };
  game.addFunds(-cost);
  st.party = { host: host.id, theme, start, end: start + 5 * 60, guests: guests.slice(0, 6), started: false };
  const when = start - st.time < 60 ? 'soon' : `at ${Math.floor((start % MINUTES_PER_DAY) / 60)}:00`;
  game.notify(`${PARTY_THEMES[theme].name} planned for ${when}! ${guests.length} friends invited. Keep it down after 10pm.`, PARTY_THEMES[theme].icon, 'good');
  return { ok: true };
}

function startParty(game: Game, party: Party): void {
  party.started = true;
  const minutes = party.end - game.state.time;
  for (const id of party.guests) {
    const g = game.sim(id);
    if (!g) continue;
    if (g.location === 'lot') g.visitUntil = party.end;
    else if (g.location === 'home') {
      g.location = 'lot';
      const exit = game.exitTile();
      g.pos = { x: exit.x + 0.5 + (Math.random() - 0.5), z: exit.z + 0.5 };
      g.queue = [];
      g.current = null;
      g.visitUntil = game.state.time + minutes;
      g.thinkCooldown = 1;
      for (const n of Object.keys(g.needs) as (keyof Sim['needs'])[]) g.needs[n] = Math.max(g.needs[n], 65);
    }
  }
  game.notify(`The ${PARTY_THEMES[party.theme].name.toLowerCase()} has started! 🎉`, PARTY_THEMES[party.theme].icon, 'good');
  game.sound('doorbell');
}

export function endParty(game: Game, shutDown: boolean): void {
  const st = game.state;
  const party = st.party;
  if (!party) return;
  st.party = null;
  if (!party.started) { game.notify('The party was cancelled.', '🎉', 'info'); return; }
  const people = [...game.household(), ...party.guests.map((id) => game.sim(id)!)].filter((s) => s && s.location === 'lot');
  const score = people.length ? people.reduce((a, s) => a + (s.needs.fun + s.needs.social) / 2, 0) / people.length : 0;
  for (const id of party.guests) {
    const g = game.sim(id);
    if (g && g.location === 'lot') g.visitUntil = st.time;
  }
  if (shutDown) { game.notify('The party got shut down. Maybe quieter next time!', '😬', 'bad'); return; }
  const great = score >= 70;
  for (const s of people) addMoodlet(s, great ? 'great_party' : 'flat_party', st.time);
  if (great) for (const id of party.guests) changeRel(st, party.host, id, 8, 0);
  game.notify(great ? 'What a party! Everyone had a brilliant time. 🥳' : 'The party was a bit flat. Try a karaoke machine or more friends!', great ? '🥳' : '😕', great ? 'good' : 'info');
}

export function partyActive(game: Game): boolean { return !!game.state.party?.started; }

/** A present under the tree: a gift card or a rare find. */
export function openPresent(game: Game, sim: Sim): void {
  const finds = Object.values(OBJECTS).filter((d) => d.market && !game.state.household.marketFinds.includes(d.id));
  if (finds.length && chance(game.state, 0.4)) {
    const f = pick(game.state, finds);
    game.state.household.marketFinds.push(f.id);
    game.notify(`${sim.name} unwrapped a ${f.name}! Find it in Buy mode (Market finds).`, '🎁', 'good');
  } else {
    const amount = 50 + Math.floor(game.state.rng % 4) * 25;
    game.addFunds(amount);
    game.notify(`${sim.name} got a £${amount} gift card!`, '🎁', 'good');
  }
}

export function seasonOfDay(day: number): SeasonId { return calendarOf(day).season.id; }

export function objectIsTemp(o: PlacedObject): boolean { return OBJECTS[o.defId]?.temp === true; }

