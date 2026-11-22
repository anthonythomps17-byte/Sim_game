// Needs, urgency and mood.
import { ALL_TRAITS, MOODLETS, NEEDS } from './defs';
import { NEED_IDS, type NeedId, type Sim } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * "Unhappiness" of a need value. Convex, so a low need gains a lot from being filled:
 * a starving Sim always prefers food to TV.
 */
export function unhappiness(v: number): number {
  const d = (100 - clamp(v, 0, 100)) / 100;
  return 100 * Math.pow(d, 2.6);
}

/** Utility of raising a need by `gain` (can be negative). */
export function needUtility(need: NeedId, current: number, gain: number): number {
  const after = clamp(current + gain, 0, 100);
  return NEEDS[need].weight * (unhappiness(current) - unhappiness(after));
}

function needContribution(v: number): number {
  if (v >= 50) return (v - 50) / 50;
  return -Math.pow((50 - v) / 50, 1.4) * 1.6;
}

export function moodletTotal(sim: Sim): number {
  let sum = 0;
  for (const m of sim.moodlets) sum += MOODLETS[m.id]?.value ?? 0;
  return sum;
}

/** Mood from -100 to 100: weighted needs plus moodlets plus trait bonus. */
export function moodScore(sim: Sim): number {
  let total = 0, weights = 0;
  for (const n of NEED_IDS) {
    const w = NEEDS[n].weight;
    total += w * needContribution(sim.needs[n]);
    weights += w;
  }
  let score = (100 * total) / weights + moodletTotal(sim);
  for (const t of sim.traits) score += ALL_TRAITS[t]?.moodBonus ?? 0;
  return clamp(Math.round(score), -100, 100);
}

export interface MoodLabel { label: string; color: string; emoji: string }

export function moodLabel(score: number): MoodLabel {
  if (score >= 60) return { label: 'Very happy', color: '#2fbf71', emoji: '😄' };
  if (score >= 25) return { label: 'Happy', color: '#7bcf4a', emoji: '🙂' };
  if (score >= -10) return { label: 'Fine', color: '#e6c440', emoji: '😐' };
  if (score >= -45) return { label: 'Unhappy', color: '#ee8a3a', emoji: '🙁' };
  return { label: 'Miserable', color: '#e0474c', emoji: '😢' };
}

/** 0.5 (miserable) .. 1.5 (very happy). Scales work performance and skill gain. */
export function moodFactor(sim: Sim): number {
  return 0.5 + (moodScore(sim) + 100) / 200;
}

export function addMoodlet(sim: Sim, id: string, now: number): void {
  const def = MOODLETS[id];
  if (!def) return;
  const existing = sim.moodlets.find((m) => m.id === id);
  if (existing) existing.expires = Math.max(existing.expires, now + def.duration);
  else sim.moodlets.push({ id, expires: now + def.duration });
}

export function expireMoodlets(sim: Sim, now: number): void {
  sim.moodlets = sim.moodlets.filter((m) => m.expires > now);
}

export function needDecayMult(sim: Sim, need: NeedId, sitting: boolean): number {
  let m = 1;
  for (const id of [...sim.traits, ...sim.perks]) {
    const t = ALL_TRAITS[id];
    if (!t) continue;
    m *= t.needDecay?.[need] ?? 1;
    if (sitting) m *= t.sittingDecay?.[need] ?? 1;
  }
  return m;
}

export function lowestNeed(sim: Sim): { need: NeedId; value: number } {
  let need: NeedId = 'hunger';
  let value = 101;
  for (const n of NEED_IDS) {
    if (n === 'room') continue;
    if (sim.needs[n] < value) { value = sim.needs[n]; need = n; }
  }
  return { need, value };
}
