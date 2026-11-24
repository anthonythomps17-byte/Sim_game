// Social interactions between Sims.
import { ALL_TRAITS, SOCIALS, type SocialDef } from './defs';
import type { Game } from './game';
import { addMoodlet, clamp, moodFactor } from './mood';
import { changeRel, findRel, friendshipLabel } from './relationships';
import { random } from './rng';
import { levelOf } from './skills';
import { gainSkill } from './actions';
import type { RunningAction, Sim } from './types';

export interface SocialAvailability { ok: boolean; hidden?: boolean; reason?: string }

export function socialCheck(game: Game, sim: Sim, target: Sim, social: SocialDef): SocialAvailability {
  if (sim.id === target.id) return { ok: false, hidden: true };
  if (social.romanceAction && !game.state.settings.romance) return { ok: false, hidden: true };
  // Romance is for grown-ups.
  if (social.romanceAction && ((sim.age ?? 'adult') !== 'adult' || (target.age ?? 'adult') !== 'adult')) return { ok: false, hidden: true };
  // Housemates are treated as family, so romance is only with Sims from outside the household.
  if (social.romanceAction && game.isHousehold(sim) && game.isHousehold(target)) return { ok: false, hidden: true };
  const rel = findRel(game.state, sim.id, target.id);
  const f = rel?.friendship ?? 0;
  const r = rel?.romance ?? 0;
  if (social.maxFriendship !== undefined && f > social.maxFriendship) return { ok: false, hidden: true };
  if (social.special === 'partners' && rel?.partners) return { ok: false, hidden: true };
  if (social.romanceAction) {
    // Only one partner at a time.
    const hasOther = game.state.relationships.some((x) => x.partners && (x.a === sim.id || x.b === sim.id) && !(x.a === target.id || x.b === target.id));
    if (hasOther) return { ok: false, reason: 'Already has a partner' };
  }
  if (social.minFriendship !== undefined && f < social.minFriendship) return { ok: false, reason: 'Needs a better friendship' };
  if (social.minRomance !== undefined && r < social.minRomance) return { ok: false, reason: 'Needs more romance' };
  return { ok: true };
}

export function availableSocials(game: Game, sim: Sim, target: Sim): { def: SocialDef; avail: SocialAvailability }[] {
  return Object.values(SOCIALS)
    .map((def) => ({ def, avail: socialCheck(game, sim, target, def) }))
    .filter((x) => !x.avail.hidden);
}

export function successChance(game: Game, sim: Sim, target: Sim, social: SocialDef): number {
  const rel = findRel(game.state, sim.id, target.id);
  let p = social.chance + levelOf(sim, 'charisma') * 0.025 + (rel?.friendship ?? 0) / 500;
  for (const t of [...sim.traits, ...sim.perks]) {
    const def = ALL_TRAITS[t];
    p += def?.socialChance ?? 0;
    if (social.romanceAction) p += def?.romanceChance ?? 0;
  }
  if (social.romanceAction) p += (rel?.romance ?? 0) / 300;
  p += (moodFactor(target) - 1) * 0.2;
  return clamp(p, 0.05, 0.98);
}

export function resolveSocial(game: Game, sim: Sim, cur: RunningAction): void {
  const target = game.sim(cur.targetSimId!);
  const social = SOCIALS[cur.socialId!];
  if (!target || !social) return;
  const now = game.state.time;
  const before = findRel(game.state, sim.id, target.id)?.friendship ?? 0;
  const ok = random(game.state) < successChance(game, sim, target, social);
  if (game.isHousehold(sim)) gainSkill(game, sim, 'charisma', 4 * moodFactor(sim));
  if (ok) {
    let romanceGain = social.romance ?? 0;
    for (const t of sim.traits) romanceGain *= ALL_TRAITS[t]?.romanceGain ?? 1;
    const rel = changeRel(game.state, sim.id, target.id, social.friendship ?? 0, romanceGain);
    game.think(sim, social.icon, 8);
    game.think(target, social.romanceAction ? '💗' : '😊', 8);
    addMoodlet(sim, 'good_chat', now);
    addMoodlet(target, 'good_chat', now);
    if (social.successMoodlet) { addMoodlet(sim, social.successMoodlet, now); addMoodlet(target, social.successMoodlet, now); }
    if (social.special === 'partners') {
      rel.partners = true;
      game.notify(`${sim.name} and ${target.name} are now partners! 💕`, '💍', 'good');
      game.sound('levelup');
    }
    if (before < 35 && rel.friendship >= 35) {
      addMoodlet(sim, 'new_friend', now);
      addMoodlet(target, 'new_friend', now);
      if (game.isHousehold(sim) || game.isHousehold(target)) {
        game.notify(`${sim.name} and ${target.name} are now friends!`, '🤗', 'good');
      }
    }
    if (rel.romance >= 30 && social.romanceAction) addMoodlet(sim, 'in_love', now);
  } else {
    changeRel(game.state, sim.id, target.id, -Math.abs(social.friendship ?? 2) * 0.6, social.romanceAction ? -4 : 0);
    if (social.failMoodlet) addMoodlet(sim, social.failMoodlet, now);
    game.think(sim, '😬', 10);
    game.think(target, social.romanceAction ? '🙅' : '😒', 10);
  }
}

export function relationshipSummary(game: Game, a: Sim, b: Sim): string {
  const rel = findRel(game.state, a.id, b.id);
  return friendshipLabel(rel?.friendship ?? 0);
}
