// Free will: every object advertises what it offers and each idle Sim picks a high-scoring option.
// score = Σ need gain × urgency × trait modifiers ÷ walking distance, then pick from the top 3.
import { ALL_TRAITS, ASPIRATIONS, OBJECTS, SELF_ACTIONS, SOCIALS, type Effects } from './defs';
import type { Game } from './game';
import { objectCenter } from './lot';
import { needUtility } from './mood';
import { findRel } from './relationships';
import { random } from './rng';
import { checkInteraction, totalEffects, socialGainMult } from './actions';
import { socialCheck } from './social';
import type { NeedId, QueuedAction, Sim, SkillId } from './types';

export interface Option { action: Omit<QueuedAction, 'uid'>; score: number; label: string }

function effectsUtility(sim: Sim, effects: Effects): number {
  let u = 0;
  for (const k in effects) u += needUtility(k as NeedId, sim.needs[k as NeedId], effects[k as NeedId]!);
  return u;
}

function tagMult(sim: Sim, tags: string[] | undefined): number {
  if (!tags) return 1;
  let m = 1;
  for (const id of [...sim.traits, ...sim.perks]) {
    const t = ALL_TRAITS[id];
    if (!t?.tagWeight) continue;
    for (const tag of tags) m *= t.tagWeight[tag] ?? 1;
  }
  return m;
}

function aspirationSkill(sim: Sim): SkillId | null {
  const asp = ASPIRATIONS[sim.aspiration];
  const step = asp?.steps[sim.aspirationStep];
  if (step?.cond.type === 'skill') return step.cond.skill;
  return null;
}

function skillBonus(sim: Sim, skill: SkillId | undefined, game: Game): number {
  if (!skill || !game.isHousehold(sim)) return 0;
  let b = 6;
  if (aspirationSkill(sim) === skill) b *= 2;
  if (sim.career) {
    const careerSkills: Record<string, SkillId[]> = { chef: ['cooking'], musician: ['music'], athlete: ['fitness'], scientist: ['logic'], artist: ['creativity'], engineer: ['logic'], cafe: ['charisma'] };
    if (careerSkills[sim.career.id]?.includes(skill)) b *= 1.5;
  }
  // Skilling is less appealing when a need is getting low.
  const min = Math.min(sim.needs.hunger, sim.needs.energy, sim.needs.bladder, sim.needs.hygiene);
  if (min < 40) b *= 0.3;
  return b;
}

export function scoreOptions(game: Game, sim: Sim): Option[] {
  const options: Option[] = [];
  const lowOnly = game.isHousehold(sim) && game.state.settings.freeWill === 'low';
  const now = game.state.time;

  for (const obj of game.state.lot.objects) {
    const def = OBJECTS[obj.defId];
    if (!def.interactions.length) continue;
    const retry = game.unreachable.get(`${sim.id}:${obj.id}`);
    if (retry && retry > now) continue;
    const c = objectCenter(obj);
    const dist = Math.hypot(c.x - sim.pos.x, c.z - sim.pos.z);
    for (const inter of def.interactions) {
      if (inter.auto === false || inter.ui) continue;
      const avail = checkInteraction(game, sim, obj, inter);
      if (!avail.ok) continue;
      const effects = totalEffects(sim, inter.effects, inter.tags);
      if (inter.then) {
        for (const k in inter.then.effects) effects[k as NeedId] = (effects[k as NeedId] ?? 0) + inter.then.effects[k as NeedId]!;
      }
      let score = effectsUtility(sim, effects);
      if (lowOnly && score < 8) continue;
      score += skillBonus(sim, inter.skill, game);
      if (inter.cleans) score += obj.dirt > 60 ? 10 : 3;
      if (inter.special === 'harvest') score += 15;
      if (inter.special === 'tend' || inter.special === 'plant') score += 4;
      if (inter.condition === 'bills') score += 25;
      score *= tagMult(sim, inter.tags);
      score /= 1 + dist / 18;
      if (score > 0.5) options.push({ action: { kind: 'object', objectId: obj.id, interactionId: inter.id, label: inter.name, icon: inter.icon, userQueued: false }, score, label: inter.name });
    }
  }

  // Self actions.
  for (const self of Object.values(SELF_ACTIONS)) {
    if (self.auto === false || self.ui) continue;
    if (self.special === 'callFriend' && !game.isHousehold(sim)) continue;
    let score = effectsUtility(sim, totalEffects(sim, self.effects, self.tags)) * 0.6;
    if (lowOnly && score < 8) continue;
    score += skillBonus(sim, self.skill, game) * 0.3;
    score *= tagMult(sim, self.tags);
    if (score > 0.5) options.push({ action: { kind: 'self', selfId: self.id, label: self.name, icon: self.icon, userQueued: false }, score, label: self.name });
  }

  // Socials with other Sims on the lot.
  for (const other of game.simsOnLot()) {
    if (other.id === sim.id) continue;
    if (other.current?.anim === 'sleep' || other.current?.userQueued) continue;
    const rel = findRel(game.state, sim.id, other.id);
    const dist = Math.hypot(other.pos.x - sim.pos.x, other.pos.z - sim.pos.z);
    for (const social of Object.values(SOCIALS)) {
      if (social.auto === false) continue;
      if (!socialCheck(game, sim, other, social).ok) continue;
      let score = effectsUtility(sim, { social: social.social * socialGainMult(sim), fun: social.fun ?? 0 });
      if (lowOnly && score < 8) continue;
      score *= 1 + Math.max(-0.5, (rel?.friendship ?? 0) / 100);
      score *= tagMult(sim, social.tags);
      score /= 1 + dist / 18;
      if (score > 0.5) options.push({ action: { kind: 'social', targetSimId: other.id, socialId: social.id, label: `${social.name} with ${other.name}`, icon: social.icon, userQueued: false }, score, label: social.name });
    }
  }
  return options.sort((a, b) => b.score - a.score);
}

export function chooseAutonomous(game: Game, sim: Sim): Omit<QueuedAction, 'uid'> | null {
  if (game.isHousehold(sim) && game.state.settings.freeWill === 'off') return null;
  const options = scoreOptions(game, sim);
  if (!options.length) return null;
  // Pick from the top 3, weighted by score, so Sims don't feel robotic.
  const top = options.slice(0, 3).filter((o) => o.score >= options[0].score * 0.6);
  const total = top.reduce((s, o) => s + o.score, 0);
  let r = random(game.state) * total;
  for (const o of top) {
    r -= o.score;
    if (r <= 0) return o.action;
  }
  return top[0].action;
}
