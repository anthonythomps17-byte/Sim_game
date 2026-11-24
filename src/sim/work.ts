// Jobs you can see: café, shop and teaching careers work in town (behind the café counter,
// stacking shelves at Aldi, at the school whiteboard) instead of disappearing off-screen.
import type { Game } from './game';
import { CAREERS, OBJECTS } from './defs';
import { careerLevel, finishWorkDay } from './schedule';
import { worksToday } from './life';
import { addMoodlet, clamp } from './mood';
import { enqueue } from './actions';
import type { PlacedObject, Sim } from './types';

export const PLACE_NAMES: Record<string, string> = { cafe: 'the café', aldi: 'Aldi', school: 'Hillcrest Primary' };

export function workPlace(sim: Sim): string | undefined {
  return sim.career ? CAREERS[sim.career.id]?.place : undefined;
}

export function workplaceObject(game: Game, place: string): PlacedObject | undefined {
  const objs = game.state.town?.objects.filter((o) => OBJECTS[o.defId]?.workplace === place) ?? [];
  return objs.find((o) => o.users.every((u) => u === null)) ?? objs[0];
}

/** Can this Sim work a shift at this object right now? */
export function canWorkHere(game: Game, sim: Sim, obj: PlacedObject): { ok: boolean; hidden?: boolean; reason?: string } {
  const place = workPlace(sim);
  if (!place || OBJECTS[obj.defId]?.workplace !== place || !game.isHousehold(sim)) return { ok: false, hidden: true };
  const lvl = careerLevel(sim);
  if (!lvl || !worksToday(game, sim) || sim.career!.workedToday) return { ok: false, reason: 'Not working today' };
  const m = game.minuteOfDay;
  if (m < lvl.start * 60 - 120 || m >= lvl.end * 60 - 20) return { ok: false, reason: `Shift is ${lvl.start}:00–${lvl.end}:00` };
  return { ok: true };
}

export function isOnShift(sim: Sim): boolean {
  return sim.current?.interactionId === 'work' || sim.queue.some((q) => q.interactionId === 'work');
}

/** Head off to work in town. */
export function goToWorkplace(game: Game, sim: Sim): boolean {
  const place = workPlace(sim);
  const obj = place ? workplaceObject(game, place) : undefined;
  if (!obj || !sim.career) return false;
  enqueue(game, sim, { kind: 'object', objectId: obj.id, interactionId: 'work', label: 'Go to work', icon: CAREERS[sim.career.id].icon, userQueued: true }, true);
  game.notify(`${sim.name} is walking to work at ${PLACE_NAMES[place!]}.`, CAREERS[sim.career.id].icon, 'info');
  return true;
}

export function shiftEndHour(sim: Sim): number {
  return careerLevel(sim)?.end ?? 17;
}

/** End of a full shift: paid as usual, then walk home. */
export function shiftDone(game: Game, sim: Sim): void {
  if (!sim.career) return;
  finishWorkDay(game, sim);
  sim.career.workedToday = true;
  addMoodlet(sim, 'good_shift', game.state.time);
  const e = game.exitTile();
  enqueue(game, sim, { kind: 'goto', area: 'home', dest: { x: e.x, z: e.z + 2 }, label: 'Walk home', icon: '🏠', userQueued: true }, true);
}

/** Left work early (or was called away): half pay and an unhappy boss. */
export function shiftAbandoned(game: Game, sim: Sim, fraction: number): void {
  const lvl = careerLevel(sim);
  if (!sim.career || !lvl) return;
  sim.career.workedToday = true;
  const pay = Math.round(lvl.pay * (lvl.end - lvl.start) * Math.max(0, Math.min(1, fraction)) * 0.5);
  if (pay) game.addFunds(pay);
  sim.career.performance = clamp(sim.career.performance - 10, -100, 100);
  game.notify(`${sim.name} left work early (£${pay}). The boss noticed.`, '😬', 'bad');
}
