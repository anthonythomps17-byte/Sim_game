// Skill levels from experience points.
import { ALL_TRAITS } from './defs';
import type { Sim, SkillId } from './types';

export const SKILL_NAMES: Record<SkillId, { name: string; icon: string }> = {
  cooking: { name: 'Cooking', icon: '🍳' },
  fitness: { name: 'Fitness', icon: '💪' },
  creativity: { name: 'Creativity', icon: '🎨' },
  music: { name: 'Music', icon: '🎵' },
  logic: { name: 'Logic', icon: '🧠' },
  charisma: { name: 'Charisma', icon: '✨' },
  gardening: { name: 'Gardening', icon: '🌱' },
};

/** XP needed to reach each level (index = level). Level 1 is the start. */
export const XP_FOR_LEVEL = [0, 0, 40, 100, 180, 290, 430, 600, 800, 1050, 1350];
export const MAX_SKILL = 10;

export function skillLevel(xp: number): number {
  let level = 1;
  for (let l = 2; l <= MAX_SKILL; l++) if (xp >= XP_FOR_LEVEL[l]) level = l;
  return level;
}

export function skillProgress(xp: number): number {
  const level = skillLevel(xp);
  if (level >= MAX_SKILL) return 1;
  const a = XP_FOR_LEVEL[level], b = XP_FOR_LEVEL[level + 1];
  return (xp - a) / (b - a);
}

export function levelOf(sim: Sim, skill: SkillId): number {
  return skillLevel(sim.skills[skill] ?? 0);
}

export function skillRateMult(sim: Sim, skill: SkillId): number {
  let m = 1;
  for (const id of [...sim.traits, ...sim.perks]) {
    const t = ALL_TRAITS[id];
    if (!t) continue;
    m *= t.skillRate?.[skill] ?? 1;
    m *= t.skillRateAll ?? 1;
  }
  return m;
}
