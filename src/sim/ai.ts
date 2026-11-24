// Free will: every object advertises what it offers and each idle Sim picks a high-scoring option.
// score = Σ need gain × urgency × trait modifiers ÷ walking distance, then pick from the top 3.
import { DESTINATIONS } from './town';
import { ALL_TRAITS, ASPIRATIONS, OBJECTS, SELF_ACTIONS, SOCIALS, type Effects } from './defs';
import type { Game } from './game';
import { objectCenter } from './lot';
import { needUtility } from './mood';
import { findRel } from './relationships';
import { random } from './rng';
import { activityKey, checkInteraction, totalEffects, socialGainMult } from './actions';
import { socialCheck } from './social';
import { partyActive } from './life';
import { petActionsFor, petsOnLot, label as petLabel } from './pets';
import type { NeedId, QueuedAction, Sim, SkillId } from './types';

export interface Option { action: Omit<QueuedAction, 'uid'>; score: number; label: string }

function effectsUtility(sim: Sim, effects: Effects): number {
  let u = 0;
  for (const k in effects) u += needUtility(k as NeedId, sim.needs[k as NeedId], effects[k as NeedId]!);
  return u;
}

let partyNow = false;

function tagMult(sim: Sim, tags: string[] | undefined): number {
  if (!tags) return 1;
  let m = 1;
  // Party time: everyone wants to sing, dance and chat.
  if (partyNow && tags.some((t) => t === 'party' || t === 'dance' || t === 'karaoke' || t === 'social' || t === 'music')) m *= 2.5;
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
  partyNow = partyActive(game);

  const area = game.areaOf(sim);
  for (const obj of game.areaLot(area).objects) {
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
      if (inter.condition === 'binsIn') score += 28;
      if (inter.condition === 'laundry') score += game.state.household.laundry / 5;
      if (inter.condition === 'wetWashing' || inter.condition === 'canHang') score += 22;
      if (inter.condition === 'dryWashing') score += 15;
      if (inter.special === 'bedding') score += obj.dirt / 6;
      if (inter.condition === 'bowlLow') score += 18;
      if (inter.condition === 'petHungry') score += 16;
      if (inter.condition === 'cageDirty') score += 12;
      if (inter.condition === 'hasPet') score += 4;
      if (inter.condition === 'binsBack') score += 12;
      if (inter.condition === 'overflowing') score += 14;
      if (inter.condition === 'broken') score += 16;
      if (inter.condition === 'dirtyClothes') score += (sim.clothesDirt ?? 0) / 2.5;
      if (inter.special === 'scoopPoo') score += game.roomOf(c) !== 0 ? 34 : 16;
      if (inter.special === 'cleanTray') score += obj.dirt / 3;
      if (inter.special === 'exercise') score += 5;
      score *= tagMult(sim, inter.tags);
      score /= 1 + dist / 18;
      if (score > 0.5) options.push({ action: { kind: 'object', objectId: obj.id, interactionId: inter.id, label: inter.name, icon: inter.icon, userQueued: false }, score, label: inter.name });
    }
  }

  // Self actions.
  for (const self of Object.values(SELF_ACTIONS)) {
    if (self.auto === false || self.ui) continue;
    if (area === 'town' && !TOWN_SELF.has(self.id)) continue;
    if (self.special === 'callFriend' && !game.isHousehold(sim)) continue;
    if (self.condition === 'dusty' && (!game.isHousehold(sim) || game.state.household.dust < 35)) continue;
    if (self.condition === 'weedy' && (!game.isHousehold(sim) || game.state.household.weeds < 35)) continue;
    if (self.condition === 'noFood' && (!game.isHousehold(sim) || game.state.household.groceries >= 2 || game.state.household.funds < (self.cost ?? 0))) continue;
    // A takeaway's food arrives afterwards, so score it by the meal.
    const selfFx = self.special === 'takeaway' ? { hunger: 75 } : self.effects;
    let score = effectsUtility(sim, totalEffects(sim, selfFx, self.tags)) * (self.special === 'takeaway' ? 1 : 0.6);
    if (lowOnly && score < 8) continue;
    score += skillBonus(sim, self.skill, game) * 0.3;
    if (self.special === 'hoover') score += game.state.household.dust / 6;
    if (self.special === 'weed') score += game.state.household.weeds / 6;
    score *= tagMult(sim, self.tags);
    if (score > 0.5) options.push({ action: { kind: 'self', selfId: self.id, label: self.name, icon: self.icon, userQueued: false }, score, label: self.name });
  }

  // Off to the park or the café, or home again.
  if (game.isHousehold(sim) && game.state.town) townOptions(game, sim, area, options, lowOnly);

  // Fuss and play with pets.
  for (const pet of area === 'home' ? petsOnLot(game) : []) {
    if (pet.task?.kind === 'withSim') continue;
    const dist = Math.hypot(pet.pos.x - sim.pos.x, pet.pos.z - sim.pos.z);
    for (const { def, ok } of petActionsFor(game, sim, pet)) {
      if (!ok || def.id === 'bath') continue;
      let score = effectsUtility(sim, totalEffects(sim, def.effects, ['pets'])) * 0.8;
      if (def.pet.fun) score += (100 - pet.fun) / 9;
      if (def.pet.clean) score += (100 - pet.clean) / 10;
      if (lowOnly && score < 8) continue;
      score *= tagMult(sim, ['pets']);
      score /= 1 + dist / 18;
      if (score > 0.5) options.push({ action: { kind: 'pet', petId: pet.id, petAction: def.id, label: petLabel(def.name, pet), icon: def.icon, userQueued: false }, score, label: def.name });
    }
  }

  // Socials with other Sims on the lot.
  for (const other of game.simsIn(area)) {
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
  // Variety: things done recently are less appealing (but needs still win when urgent).
  for (const o of options) {
    const key = activityKey(o.action);
    const repeats = key ? sim.recent.filter((r) => r === key).length : 0;
    if (repeats) o.score *= Math.pow(0.55, repeats);
  }
  return options.sort((a, b) => b.score - a.score);
}

/** Things a Sim can do on their own while out: no hoovering the park. */
const TOWN_SELF = new Set(['daydream', 'stretch', 'phone', 'scroll']);

function townOptions(game: Game, sim: Sim, area: 'home' | 'town', options: Option[], lowOnly: boolean): void {
  const st = game.state;
  const hour = game.hour;
  if (area === 'home') {
    // A trip out now and then, in the daytime, when bored or lonely.
    if (hour < 9 || hour >= 19 || lowOnly) return;
    if (sim.counters.tripDay === game.day) return;
    if (sim.needs.energy < 40 || sim.needs.bladder < 40 || sim.needs.hunger < 35) return;
    const score = effectsUtility(sim, { fun: 30, social: 30 }) * 0.45;
    if (score < 6) return;
    const where = random(st) < 0.6 ? DESTINATIONS.park : DESTINATIONS.cafe;
    options.push({ action: { kind: 'goto', area: 'town', dest: where.tile, label: `Go to ${where.name}`, icon: where.icon, userQueued: false }, score, label: where.name });
    return;
  }
  // Out and about: head home when tired, grubby, late, or after a good while.
  const out = st.time - (sim.counters.leftHomeAt ?? st.time);
  let score = 0;
  if (sim.needs.energy < 35) score += 30;
  if (sim.needs.hygiene < 30) score += 20;
  if (hour >= 20 || hour < 7) score += 35;
  if (out > 180) score += 12 + (out - 180) / 10;
  if (score > 0) {
    const e = game.exitTile();
    options.push({ action: { kind: 'goto', area: 'home', dest: { x: e.x, z: e.z + 2 }, label: 'Go home', icon: '🏠', userQueued: false }, score, label: 'Go home' });
  }
}

export function chooseAutonomous(game: Game, sim: Sim): Omit<QueuedAction, 'uid'> | null {
  if (game.isHousehold(sim) && game.state.settings.freeWill === 'off') return null;
  if (game.isHousehold(sim) && (sim.manualUntil ?? 0) > game.state.time) return null;
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
