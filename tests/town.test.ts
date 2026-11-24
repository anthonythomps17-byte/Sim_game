// Out of the front door: the streets, the park and the café.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createGame, randomDraft } from '../src/sim/newgame';
import { enqueue } from '../src/sim/actions';
import { setSteer } from '../src/sim/steer';
import { DESTINATIONS, townGate, townHour, townMask, TOWN_W } from '../src/sim/town';
import { findPath } from '../src/sim/path';
import { spotApproaches } from '../src/sim/lot';
import { OBJECTS } from '../src/sim/defs';
import { deserialize, serialize } from '../src/sim/save';
import type { GameState } from '../src/sim/types';

function newGame(): Game {
  const seed = { rng: 31 } as GameState;
  const g = new Game(createGame({ householdName: 'Town', sims: [randomDraft(seed, 'Town'), randomDraft(seed, 'Town')], lot: 'starter', seed: 19 }));
  g.state.settings.freeWill = 'off';
  g.state.time = 10 * 60; // 10am
  return g;
}
const refresh = (g: Game) => { for (const s of g.household()) { for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = 100; s.queue = []; s.current = null; s.poseObjectId = null; } };

describe('the town', () => {
  it('the park and the café can be reached from the front gate', () => {
    const g = newGame();
    const grid = g.grid('town');
    const gate = townGate(g);
    expect(townMask()[gate.z * TOWN_W + gate.x]).toBe(1);
    for (const d of Object.values(DESTINATIONS)) expect(findPath(grid, { x: gate.x + 0.5, z: gate.z + 0.5 }, d.tile), d.id).not.toBeNull();
    // Every piece of park and café furniture can be used.
    for (const o of g.state.town!.objects) {
      const def = OBJECTS[o.defId];
      if (!def.spots.length) continue;
      const ok = def.spots.some((spot) => spotApproaches(o, spot).some((t) => findPath(grid, { x: gate.x + 0.5, z: gate.z + 0.5 }, t)));
      expect(ok, `${o.defId} at ${o.x},${o.z}`).toBe(true);
    }
  });

  it('a Sim walks out of the front door to the park and comes home again', () => {
    const g = newGame();
    const sim = g.household()[0];
    refresh(g);
    enqueue(g, sim, { kind: 'goto', area: 'town', dest: DESTINATIONS.park.tile, label: 'Park', icon: '🌳', userQueued: true });
    for (let i = 0; i < 200 && !(sim.location === 'town' && !sim.current && !sim.queue.length); i++) g.tick(1);
    expect(sim.location).toBe('town');
    expect(Math.floor(sim.pos.x)).toBe(DESTINATIONS.park.tile.x);
    expect(Math.floor(sim.pos.z)).toBe(DESTINATIONS.park.tile.z);
    const e = g.exitTile();
    enqueue(g, sim, { kind: 'goto', area: 'home', dest: { x: e.x, z: e.z + 2 }, label: 'Home', icon: '🏠', userQueued: true });
    for (let i = 0; i < 200 && !(sim.location === 'lot' && !sim.current && !sim.queue.length); i++) g.tick(1);
    expect(sim.location).toBe('lot');
  });

  it('tapping a swing from home walks there and plays; the café sells coffee', () => {
    const g = newGame();
    const sim = g.household()[0];
    refresh(g);
    sim.needs.fun = 20;
    const swings = g.state.town!.objects.find((o) => o.defId === 'swings')!;
    enqueue(g, sim, { kind: 'object', objectId: swings.id, interactionId: 'swing', label: 'Swing', icon: '🛝', userQueued: true });
    for (let i = 0; i < 200 && !(sim.current?.phase === 'perform'); i++) g.tick(1);
    expect(sim.location).toBe('town');
    expect(sim.current?.interactionId).toBe('swing');
    for (let i = 0; i < 60 && sim.current; i++) g.tick(1);
    expect(sim.needs.fun).toBeGreaterThan(40);
    const counter = g.state.town!.objects.find((o) => o.defId === 'cafe_counter')!;
    const funds = g.state.household.funds;
    enqueue(g, sim, { kind: 'object', objectId: counter.id, interactionId: 'coffee', label: 'Coffee', icon: '☕', userQueued: true });
    for (let i = 0; i < 300 && !sim.moodlets.some((m) => m.id === 'cafe_treat'); i++) g.tick(1);
    expect(g.state.household.funds).toBe(funds - 3);
    expect(sim.moodlets.some((m) => m.id === 'cafe_treat')).toBe(true);
  });

  it('steering walks a Sim through the front of the lot into the street', () => {
    const g = newGame();
    const sim = g.household()[0];
    refresh(g);
    const e = g.exitTile();
    sim.pos = { x: e.x + 0.5, z: e.z + 0.5 };
    for (let i = 0; i < 6; i++) { setSteer(g, sim, 0, -1); g.tick(0.5); }
    expect(sim.location).toBe('town');
    for (let i = 0; i < 6; i++) { setSteer(g, sim, 0, 1); g.tick(0.5); }
    expect(sim.location).toBe('lot');
    // Walls stop you.
    sim.pos = { x: 1.5, z: 1.5 };
    for (let i = 0; i < 20; i++) { setSteer(g, sim, -1, 0); g.tick(0.5); }
    expect(sim.pos.x).toBeGreaterThanOrEqual(0);
  });

  it('neighbours come out to the park in the daytime, and go home again', () => {
    const g = newGame();
    g.state.settings.freeWill = 'full';
    townHour(g, 12);
    townHour(g, 12);
    const out = g.state.sims.filter((s) => s.location === 'town');
    expect(out.length).toBeGreaterThan(0);
    for (const t of out) t.visitUntil = g.state.time + 1;
    for (let i = 0; i < 240 && g.state.sims.some((s) => s.isTownie && s.location === 'town'); i++) g.tick(1);
    expect(g.state.sims.filter((s) => s.isTownie && s.location === 'town').length).toBe(0);
  });

  it('a save with Sims out in town loads again', () => {
    const g = newGame();
    const sim = g.household()[0];
    sim.location = 'town';
    sim.pos = { x: DESTINATIONS.park.tile.x + 0.5, z: DESTINATIONS.park.tile.z + 0.5 };
    const st = deserialize(serialize(g.state));
    expect(st.town!.objects.length).toBe(g.state.town!.objects.length);
    expect(st.sims.find((s) => s.id === sim.id)!.location).toBe('town');
    const g2 = new Game(st);
    g2.tick(5);
    // Older saves without a town get one.
    const old = JSON.parse(serialize(g.state));
    delete old.state.town;
    old.state.sims.find((s: { id: number }) => s.id === sim.id).location = 'lot';
    expect(deserialize(JSON.stringify(old)).town!.objects.length).toBeGreaterThan(10);
  });
});
