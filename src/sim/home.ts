// Running a home: chores (dust, weeds, bins), things breaking (drains, boiler), energy and bills.
import { OBJECTS } from './defs';
import type { Game } from './game';
import { calendarOf } from './life';
import { weeklyPetCost } from './pets';
import { addMoodlet, clamp } from './mood';
import { canPlaceObject } from './lot';
import { chance, pick } from './rng';
import type { PlacedObject, Sim } from './types';

export const SUBSCRIPTIONS = {
  netflix: { name: 'Netflix', icon: '🍿', weekly: 8, desc: 'Binge whole series on the TV.' },
  sky: { name: 'Sky Sports', icon: '📡', weekly: 22, desc: 'Live football matches on the TV.' },
} as const;
export type SubscriptionId = keyof typeof SUBSCRIPTIONS;

export const BIN_DAY = 3; // Thursday
export const BASE_ENERGY = 90;
/** Green upgrades don't count towards rent and council tax. */
const ENERGY_KIT = ['solar', 'heat_pump'];
export const PLUMBER_COST = 120;
export const ENGINEER_COST = 250;
export const SERVICE_COST = 60;

const count = (game: Game, defId: string) => game.state.lot.objects.filter((o) => o.defId === defId).length;

export function hasHeatPump(game: Game): boolean { return count(game, 'heat_pump') > 0; }

export function boiler(game: Game): PlacedObject | undefined { return game.state.lot.objects.find((o) => o.defId === 'boiler'); }

/** No hot water or heating: the boiler is broken and there's no heat pump. */
export function noHotWater(game: Game): boolean {
  const b = boiler(game);
  return !!b?.broken && !hasHeatPump(game);
}

export interface BillBreakdown { home: number; energy: number; energySaved: number; subscriptions: number; pets: number; total: number }

export function billBreakdown(game: Game): BillBreakdown {
  const kit = game.state.lot.objects.filter((o) => ENERGY_KIT.includes(o.defId)).reduce((s, o) => s + OBJECTS[o.defId].price, 0);
  const home = Math.round(50 + (game.homeValue() - kit) * 0.008);
  const solar = Math.min(2, count(game, 'solar'));
  const full = BASE_ENERGY + count(game, 'karaoke') * 3 + count(game, 'tv_big') * 4 + game.state.household.extraEnergy;
  let energy = full * (1 - 0.25 * solar);
  if (hasHeatPump(game)) energy *= 0.65;
  energy = Math.round(energy);
  const subs = game.state.household.subscriptions;
  const subscriptions = (subs.netflix ? SUBSCRIPTIONS.netflix.weekly : 0) + (subs.sky ? SUBSCRIPTIONS.sky.weekly : 0);
  const pets = weeklyPetCost(game);
  return { home, energy, energySaved: Math.round(full - energy), subscriptions, pets, total: home + energy + subscriptions + pets };
}

/** Room score penalties from dust (indoors) and weeds / spilled rubbish (outdoors). */
export function roomPenalty(game: Game, room: number): number {
  const h = game.state.household;
  if (room === 0) return Math.max(0, h.weeds - 30) / 4 + (binsOverflowing(game) ? 15 : 0);
  return Math.max(0, h.dust - 30) / 3;
}

export function wheelieBin(game: Game): PlacedObject | undefined { return game.state.lot.objects.find((o) => o.defId === 'wheelie_bin'); }

export function binsOverflowing(game: Game): boolean { return game.state.household.rubbish >= 100 && !!wheelieBin(game); }

/** Wednesday afternoon until collection on Thursday at 7am. */
export function binWindow(game: Game): boolean {
  const h = game.minuteOfDay / 60;
  return (game.weekday === BIN_DAY - 1 && h >= 12) || (game.weekday === BIN_DAY && h < 7);
}

export function takeBinsOut(game: Game, bin: PlacedObject): void {
  const exit = game.exitTile();
  const lot = game.state.lot;
  bin.home = { x: bin.x, z: bin.z };
  for (const dx of [-2, 2, -3, 3, -4, 4, 5, -5]) {
    const x = exit.x + dx;
    if (canPlaceObject(lot, bin.defId, x, 0, bin.rot, bin.id)) { bin.x = x; bin.z = 0; break; }
  }
  bin.atKerb = true;
  game.lotChanged();
}

export function bringBinsIn(game: Game, bin: PlacedObject): void {
  if (bin.home && canPlaceObject(game.state.lot, bin.defId, bin.home.x, bin.home.z, bin.rot, bin.id)) { bin.x = bin.home.x; bin.z = bin.home.z; }
  bin.atKerb = false;
  game.lotChanged();
}

function neighbours(game: Game, delta: number) {
  game.state.household.neighbourMood = clamp(game.state.household.neighbourMood + delta, 0, 100);
}

export function homeHour(game: Game, hour: number): void {
  const st = game.state;
  const h = st.household;
  const season = calendarOf(game.day).season.id;
  const bin = wheelieBin(game);
  if (hour === 0) {
    h.laundry = clamp(h.laundry + game.household().length * 7, 0, 100);
    if (h.laundry >= 70 && h.laundry < 100) game.notify('The laundry basket is nearly full. Time to do the washing!', '🧺', 'info');
    if (h.wetWashing > 0) {
      h.laundry = clamp(h.laundry + Math.round(h.wetWashing / 2), 0, 100);
      h.wetWashing = 0;
      game.notify('The washing was left in the machine too long and went smelly. It needs washing again!', '🧺', 'bad');
    }
    h.dust = clamp(h.dust + 12 + game.household().length * 2, 0, 100);
    h.weeds = clamp(h.weeds + (season === 'winter' ? 3 : season === 'summer' ? 14 : 10), 0, 100);
    if (bin) h.rubbish = clamp(h.rubbish + 10 + game.household().length * 3, 0, 120);
    if (h.dust >= 70) game.notify('The house is getting dusty. Time to hoover! (Tap your Sim → Hoover the house)', '🧹', 'info');
    if (h.weeds >= 70) game.notify('Weeds are taking over the garden! (Tap your Sim → Weed the garden)', '🌿', 'info');
  }
  if (hour === 6) randomProblems(game, season);
  if (hour === 8 && h.laundry >= 100) for (const sim of game.household()) addMoodlet(sim, 'no_clean_clothes', st.time);
  if (bin) {
    if (game.weekday === BIN_DAY - 1 && hour === 19 && !bin.atKerb) game.notify("It's bin day tomorrow! Take the wheelie bin out tonight.", '🗑️', 'bills');
    if (game.weekday === BIN_DAY && hour === 7) {
      if (bin.atKerb) {
        h.rubbish = 0;
        game.notify('The bin men have been. Remember to bring the bin back in.', '🚛', 'good');
      } else {
        game.notify('Oh no, the bins were missed! They will fill up until next Thursday.', '🗑️', 'bad');
        neighbours(game, -4);
      }
    }
    if (game.weekday === BIN_DAY + 1 && hour === 10 && bin.atKerb) {
      game.notify('The bin has been left out on the street all day. The neighbours noticed.', '😒', 'bad');
      neighbours(game, -3);
    }
    if (binsOverflowing(game) && hour % 6 === 0) {
      for (const sim of game.household()) if (sim.location === 'lot') addMoodlet(sim, 'smelly_bins', st.time);
    }
  }
  // Feeling good about a green home.
  if (hour === 8 && (hasHeatPump(game) || count(game, 'solar') > 0)) {
    for (const sim of game.household()) addMoodlet(sim, 'eco_home', st.time);
  }
  // No heating in winter is miserable.
  if (noHotWater(game) && season === 'winter') {
    for (const sim of game.household()) if (sim.location === 'lot') addMoodlet(sim, 'cold_house', st.time);
  }
}

function randomProblems(game: Game, season: string): void {
  const st = game.state;
  const drains = st.lot.objects.filter((o) => OBJECTS[o.defId].canBlock && !o.broken);
  if (drains.length && chance(st, 0.07)) {
    const d = pick(st, drains);
    d.broken = true;
    game.notify(`The ${OBJECTS[d.defId].name.toLowerCase()} is blocked! Unblock it yourself or call a plumber.`, '🪠', 'bad');
    game.lotChanged();
  }
  const b = boiler(game);
  if (b && !b.broken && !hasHeatPump(game)) {
    const serviced = b.growth > 0 && game.day - b.growth < 14;
    const p = (season === 'winter' ? 0.07 : 0.025) * (serviced ? 0.3 : 1);
    if (chance(st, p)) {
      b.broken = true;
      game.notify('The boiler has broken down! No hot water or heating until it is fixed.', '🔥', 'bad');
      game.sound('error');
      game.lotChanged();
    }
  }
}

/** Handle the home-related specials from interactions. Returns true if handled. */
export function homeSpecial(game: Game, sim: Sim, obj: PlacedObject, special: string): boolean {
  const st = game.state;
  switch (special) {
    case 'unblock': {
      const p = 0.55 + sim.skills.fitness / 4000 + sim.skills.logic / 4000;
      if (chance(st, p)) {
        obj.broken = false;
        addMoodlet(sim, 'fixed_it', st.time);
        game.notify(`${sim.name} unblocked the ${OBJECTS[obj.defId].name.toLowerCase()}. Yuck, but done!`, '🪠', 'good');
        game.lotChanged();
      } else game.notify(`${sim.name} couldn't shift the blockage. Try again, or call a plumber.`, '🪠', 'info');
      return true;
    }
    case 'plumber':
      game.addFunds(-PLUMBER_COST);
      obj.broken = false;
      game.notify(`The plumber fixed the ${OBJECTS[obj.defId].name.toLowerCase()} (£${PLUMBER_COST}).`, '🔧', 'info');
      game.sound('cash');
      game.lotChanged();
      return true;
    case 'fixBoiler': {
      const engineer = sim.career?.id === 'engineer' ? 0.3 : 0;
      const p = 0.2 + engineer + Math.min(0.5, sim.skills.logic / 2000);
      if (chance(st, p)) {
        obj.broken = false;
        addMoodlet(sim, 'fixed_it', st.time);
        game.notify(`${sim.name} fixed the boiler! Hot water is back.`, '🔥', 'good');
        game.lotChanged();
      } else game.notify(`${sim.name} couldn't fix the boiler. More Logic skill would help, or call an engineer.`, '🔧', 'info');
      return true;
    }
    case 'engineer':
      game.addFunds(-ENGINEER_COST);
      obj.broken = false;
      obj.growth = game.day; // counts as a service
      game.notify(`A heating engineer fixed the boiler (£${ENGINEER_COST}).`, '🔥', 'info');
      game.sound('cash');
      game.lotChanged();
      return true;
    case 'service':
      game.addFunds(-SERVICE_COST);
      obj.growth = game.day;
      game.notify(`Boiler serviced (£${SERVICE_COST}). It is much less likely to break for two weeks.`, '🧰', 'info');
      return true;
    case 'binsOut': takeBinsOut(game, obj); return true;
    case 'binsIn': bringBinsIn(game, obj); return true;
    case 'tidyBins':
      st.household.rubbish = Math.min(st.household.rubbish, 85);
      game.notify(`${sim.name} cleared up the spilled rubbish.`, '🧹', 'good');
      return true;
    case 'wash': {
      const load = Math.min(h_(game).laundry, 60);
      h_(game).laundry -= load;
      h_(game).wetWashing += load;
      game.notify(`${sim.name} put a wash on. Hang it out or tumble dry it before it goes smelly!`, '🧺', 'info');
      return true;
    }
    case 'tumble':
      h_(game).wetWashing = 0;
      h_(game).extraEnergy += 4;
      return true;
    case 'hang':
      obj.load = h_(game).wetWashing;
      obj.growth = 1;
      h_(game).wetWashing = 0;
      game.lotChanged();
      return true;
    case 'bringIn':
      obj.load = 0;
      obj.growth = 0;
      game.lotChanged();
      return true;
    case 'bedding':
      h_(game).laundry = clamp(h_(game).laundry + 15, 0, 100);
      return true;
    case 'refuel':
      sim.queue.unshift({ uid: game.nextId(), kind: 'outing', selfId: 'petrol', label: 'Fill up with petrol', icon: '⛽', userQueued: true });
      return true;
    case 'bbq':
      if (calendarOf(game.day).season.id === 'summer') addMoodlet(sim, 'summer_bbq', st.time);
      return true;
  }
  return false;
}

const h_ = (game: Game) => game.state.household;

/** Washing on the line dries in the sun (or slowly in winter). Call every game minute. */
export function dryWashing(game: Game, dt: number): void {
  const season = calendarOf(game.day).season.id;
  const perHour = season === 'summer' ? 50 : season === 'winter' ? 12 : 28;
  const night = game.isNight() ? 0.3 : 1;
  for (const o of game.state.lot.objects) {
    if (o.defId !== 'washing_line' || !o.load || o.growth <= 0 || o.growth >= 100) continue;
    o.growth = Math.min(100, o.growth + (perHour / 60) * dt * night);
    if (o.growth >= 100) {
      game.notify('The washing is dry. Bring it in!', '👕', 'good');
      game.lotChanged();
    }
  }
}

export function washingLine(game: Game): PlacedObject | undefined { return game.state.lot.objects.find((o) => o.defId === 'washing_line'); }

export function selfSpecial(game: Game, sim: Sim, special: string): void {
  const h = game.state.household;
  if (special === 'hoover') {
    h.dust = Math.max(0, h.dust - 60);
    if (h.dust < 15) addMoodlet(sim, 'clean_house', game.state.time);
    game.recomputeRooms();
  }
  if (special === 'weed') {
    h.weeds = Math.max(0, h.weeds - 55);
    if (h.weeds < 15) addMoodlet(sim, 'tidy_garden', game.state.time);
    game.recomputeRooms();
  }
}
