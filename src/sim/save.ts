// Saving is just JSON. Storage (IndexedDB) lives in src/platform so the core stays testable.
import { SAVE_VERSION } from './newgame';
import { OBJECTS } from './defs';
import type { GameState } from './types';

export interface SaveFile { app: 'ashton-life'; version: number; savedAt: string; state: GameState }

export function serialize(state: GameState): string {
  // Running actions and queues are dropped: Sims simply pick up where free will takes them.
  const copy: GameState = JSON.parse(JSON.stringify(state));
  for (const sim of copy.sims) {
    if (sim.current?.returnTo && sim.poseObjectId !== null) sim.pos = sim.current.returnTo;
    sim.current = null;
    sim.queue = sim.queue.filter((q) => q.kind !== 'respond' && q.kind !== 'seat');
    sim.poseObjectId = null;
    sim.anim = 'idle';
  }
  for (const obj of copy.lot.objects) obj.users = obj.users.map(() => null);
  const file: SaveFile = { app: 'ashton-life', version: SAVE_VERSION, savedAt: new Date().toISOString(), state: copy };
  return JSON.stringify(file);
}

export class SaveError extends Error {}

export function deserialize(text: string): GameState {
  let file: SaveFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SaveError("That file isn't a saved game.");
  }
  if (!file || file.app !== 'ashton-life' || !file.state) throw new SaveError("That file isn't an Ashton Life save.");
  if (file.version > SAVE_VERSION) throw new SaveError('That save is from a newer version of the game.');
  const st = file.state;
  // Defensive repairs so an older or hand-edited save still loads.
  st.lot.objects = st.lot.objects.filter((o) => OBJECTS[o.defId]);
  for (const o of st.lot.objects) {
    const n = OBJECTS[o.defId].spots.length;
    if (!Array.isArray(o.users) || o.users.length !== n) o.users = new Array(n).fill(null);
  }
  st.pendingVisits ??= [];
  st.flags ??= { lastHour: -1, nextVisitAt: st.time + 600 };
  st.household.marketFinds ??= [];
  st.household.rewardsUnlocked ??= [];
  st.household.groceries ??= 30;
  st.household.dust ??= 0;
  st.household.weeds ??= 10;
  st.household.rubbish ??= 0;
  st.household.subscriptions ??= { netflix: false, sky: false };
  st.household.discount ??= 0;
  st.household.neighbourMood ??= 80;
  st.household.nextDoorId ??= st.sims.find((s) => s.isTownie)?.id ?? 0;
  st.party ??= null;
  st.noise ??= { tonight: 0, stage: 0 };
  st.fireworksUntil ??= 0;
  for (const c of st.sims) if (c.career?.id === 'cafe') c.career = { ...c.career, id: 'coffee', level: Math.min(c.career.level, 4) };
  st.settings ??= { freeWill: 'full', romance: true };
  for (const sim of st.sims) {
    sim.perks ??= [];
    sim.recent ??= [];
    sim.driving ??= { lessons: 0, licence: false };
    sim.counters ??= {};
    sim.queue ??= [];
    sim.current = null;
  }
  return st;
}
