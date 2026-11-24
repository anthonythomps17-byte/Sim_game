// Dirty clothes. What a Sim is wearing gets grubbier as they go about their day (much faster when
// working out, gardening or cleaning). They change into clean clothes from the wardrobe, which
// adds to the laundry basket; washing and drying the laundry refills the wardrobes.
import type { Game } from './game';
import { addMoodlet, clamp } from './mood';
import type { Sim } from './types';

/** Laundry-basket points one outfit is worth. */
export const OUTFIT_LAUNDRY = 8;
/** Clean outfits each person can keep in the wardrobes. */
export const OUTFITS_PER_SIM = 7;

/** Dirt per game minute while doing things (by animation). */
const DIRT_BY_ANIM: Record<string, number> = {
  workout: 0.5, garden: 0.32, hoover: 0.18, use: 0.06, cook: 0.12, eat: 0.04, dance: 0.12, cheer: 0.1,
  walk: 0.025, idle: 0.02, talk: 0.02, sit: 0.015, sleep: 0,
};

/** Dirt after a shift at work, by career. */
const WORK_DIRT: Record<string, number> = {
  baker: 30, engineer: 28, chef: 26, athlete: 30, lifeguard: 18, coffee: 18, bar: 20, shop: 14, cardshop: 12,
  teacher: 14, artist: 22, scientist: 16, musician: 14,
};

export const dirtOf = (sim: Sim) => sim.clothesDirt ?? 0;

export function clothesLabel(d: number): { label: string; icon: string; color: string } {
  if (d >= 80) return { label: 'Filthy', icon: '🤢', color: 'var(--bad)' };
  if (d >= 55) return { label: 'Grubby', icon: '👕', color: 'var(--warn)' };
  if (d >= 25) return { label: 'Worn', icon: '👕', color: 'var(--ink-soft)' };
  return { label: 'Clean', icon: '✨', color: 'var(--good)' };
}

/** 0 clean, 1 grubby, 2 filthy: what the 3D Sim shows. */
export function dirtStage(sim: Sim): 0 | 1 | 2 {
  const d = dirtOf(sim);
  return d >= 80 ? 2 : d >= 50 ? 1 : 0;
}

export function cleanClothes(game: Game): number {
  return game.state.household.cleanClothes ?? 0;
}

export function maxClothes(game: Game): number {
  return Math.max(1, game.household().length) * OUTFITS_PER_SIM;
}

/** Every game minute, for Sims at home. */
export function clothesTick(game: Game, sim: Sim, dt: number, anim: string, tags: string[] | undefined): void {
  if (!game.isHousehold(sim) || sim.location !== 'lot') return;
  let rate = DIRT_BY_ANIM[anim] ?? 0.03;
  if (tags?.includes('fitness')) rate = Math.max(rate, 0.45);
  if (tags?.includes('cleaning')) rate += 0.12;
  if (tags?.includes('pets')) rate += 0.08;
  sim.clothesDirt = clamp(dirtOf(sim) + rate * dt, 0, 100);
  // Wearing filthy clothes, you start to pong.
  if (dirtOf(sim) >= 70) sim.needs.hygiene = clamp(sim.needs.hygiene - (3 / 60) * dt, 0, 100);
}

export function addClothesDirt(sim: Sim, amount: number): void {
  sim.clothesDirt = clamp(dirtOf(sim) + amount, 0, 100);
}

export function afterWork(sim: Sim, careerId: string): void {
  addClothesDirt(sim, WORK_DIRT[careerId] ?? 15);
}

/** Change into a clean outfit. The worn one goes in the laundry basket. */
export function changeClothes(game: Game, sim: Sim, quiet = false): { ok: boolean; why?: string } {
  const h = game.state.household;
  if ((h.cleanClothes ?? 0) <= 0) {
    if (!quiet) game.notify(`${sim.name} has no clean clothes left! Do the washing, then dry it.`, '🧦', 'bad');
    return { ok: false, why: 'No clean clothes left. Do the washing!' };
  }
  h.cleanClothes = (h.cleanClothes ?? 0) - 1;
  h.laundry = clamp(h.laundry + OUTFIT_LAUNDRY, 0, 100);
  sim.clothesDirt = 0;
  sim.moodlets = sim.moodlets.filter((m) => m.id !== 'grubby_clothes' && m.id !== 'filthy_clothes');
  addMoodlet(sim, 'fresh_clothes', game.state.time);
  return { ok: true };
}

/** Washing that has been dried goes back in the wardrobes as clean outfits. */
export function putAwayWashing(game: Game, load: number): number {
  const h = game.state.household;
  const outfits = Math.max(1, Math.round(load / OUTFIT_LAUNDRY));
  const before = h.cleanClothes ?? 0;
  h.cleanClothes = Math.min(maxClothes(game), before + outfits);
  return h.cleanClothes - before;
}

/** Every game hour: how dirty clothes make Sims feel. */
export function clothesHour(game: Game, hour: number): void {
  const st = game.state;
  const now = st.time;
  for (const sim of game.household()) {
    if (sim.location !== 'lot') continue;
    const d = dirtOf(sim);
    if (d >= 80) {
      sim.moodlets = sim.moodlets.filter((m) => m.id !== 'grubby_clothes');
      addMoodlet(sim, 'filthy_clothes', now);
    } else if (d >= 55) addMoodlet(sim, 'grubby_clothes', now);
  }
  if (hour === 8 && cleanClothes(game) === 0 && game.household().some((s) => dirtOf(s) >= 50)) {
    for (const sim of game.household()) addMoodlet(sim, 'no_clean_clothes', now);
    game.notify('There are no clean clothes in the wardrobes! Do a wash and dry it.', '🧦', 'bad');
  }
}
