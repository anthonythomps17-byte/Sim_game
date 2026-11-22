import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createGame, randomDraft, emptyLot } from '../src/sim/newgame';
import { buildOccupancy, computeRooms, hKey, vKey, spotApproaches, canPlaceObject } from '../src/sim/lot';
import { findPath } from '../src/sim/path';
import { needUtility, moodScore } from '../src/sim/mood';
import { scoreOptions } from '../src/sim/ai';
import { enqueue, cancelAction } from '../src/sim/actions';
import { buyObject, placeWalls, roomOutlineKeys, sellObject, setWallKind, paintFloor } from '../src/sim/build';
import { joinCareer } from '../src/sim/schedule';
import { serialize, deserialize } from '../src/sim/save';
import { skillLevel } from '../src/sim/skills';
import { OBJECTS } from '../src/sim/defs';
import type { GameState } from '../src/sim/types';

function newGame(n = 1, lot: 'starter' | 'empty' = 'starter'): Game {
  const seedState = { rng: 42 } as GameState;
  const drafts = Array.from({ length: n }, () => randomDraft(seedState, 'Test'));
  for (const d of drafts) d.traits = ['cheerful', 'neat', 'geek'];
  return new Game(createGame({ householdName: 'Test', sims: drafts, lot, seed: 7 }));
}

describe('data files', () => {
  it('every object spot and interaction is well formed', () => {
    for (const def of Object.values(OBJECTS)) {
      expect(def.footprint.length).toBe(2);
      for (const i of def.interactions) {
        expect(i.duration).toBeGreaterThan(0);
        expect(typeof i.name).toBe('string');
      }
    }
  });
});

describe('lot and pathfinding', () => {
  it('walls block paths and doors let Sims through', () => {
    const g = newGame(1, 'empty');
    const lot = g.state.lot;
    // A closed 4x4 box at 2..6.
    for (const k of roomOutlineKeys(2, 2, 6, 6)) lot.walls[k] = { kind: 'wall', paint: ['plaster', 'plaster'] };
    g.lotChanged();
    const grid = { lot, occ: buildOccupancy(lot) };
    expect(findPath(grid, { x: 0.5, z: 0.5 }, { x: 3, z: 3 })).toBeNull();
    lot.walls[hKey(3, 2)].kind = 'door';
    g.lotChanged();
    const path = findPath({ lot, occ: buildOccupancy(lot) }, { x: 0.5, z: 0.5 }, { x: 3, z: 3 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 3, z: 3 });
  });

  it('finds enclosed rooms', () => {
    const lot = emptyLot();
    for (const k of roomOutlineKeys(2, 2, 6, 6)) lot.walls[k] = { kind: 'wall', paint: ['plaster', 'plaster'] };
    lot.walls[vKey(4, 2)] = { kind: 'wall', paint: ['plaster', 'plaster'] };
    lot.walls[vKey(4, 3)] = { kind: 'wall', paint: ['plaster', 'plaster'] };
    lot.walls[vKey(4, 4)] = { kind: 'wall', paint: ['plaster', 'plaster'] };
    lot.walls[vKey(4, 5)] = { kind: 'wall', paint: ['plaster', 'plaster'] };
    const info = computeRooms(lot);
    expect(info.count).toBe(3); // outdoors + 2 rooms
    expect(info.rooms[0]).toBe(0);
    expect(info.rooms[3 * lot.width + 3]).not.toBe(info.rooms[3 * lot.width + 5]);
  });

  it('starter home has 5 rooms and every useful object is reachable from the front path', () => {
    const g = newGame();
    expect(g.roomInfo().count - 1).toBe(5);
    const grid = g.grid();
    for (const obj of g.state.lot.objects) {
      const def = OBJECTS[obj.defId];
      if (!def.spots.length) continue;
      const reachable = def.spots.some((s) => spotApproaches(obj, s).some((t) => findPath(grid, { x: 7.5, z: 1.5 }, t) !== null));
      expect(reachable, `${obj.defId} at ${obj.x},${obj.z}`).toBe(true);
    }
  });

  it('objects cannot overlap or straddle walls', () => {
    const g = newGame();
    const fridge = g.state.lot.objects.find((o) => o.defId === 'fridge')!;
    expect(canPlaceObject(g.state.lot, 'guitar', fridge.x, fridge.z, 0)).toBe(false);
    expect(canPlaceObject(g.state.lot, 'guitar', 1, 1, 0)).toBe(true);
    // A 2-wide sofa across the living/kitchen wall line x=10.
    expect(canPlaceObject(g.state.lot, 'sofa', 9, 8, 0)).toBe(false);
  });
});

describe('needs and utility', () => {
  it('a starving Sim values food over TV', () => {
    const food = needUtility('hunger', 10, 70);
    const tv = needUtility('fun', 30, 40);
    expect(food).toBeGreaterThan(tv);
  });

  it('free will picks food when hungry and the toilet when bursting', () => {
    const g = newGame();
    const sim = g.household()[0];
    sim.needs.hunger = 5;
    let top = scoreOptions(g, sim)[0];
    expect(['snack', 'sandwich', 'cook']).toContain(top.action.interactionId);
    sim.needs.hunger = 90;
    sim.needs.bladder = 5;
    top = scoreOptions(g, sim)[0];
    expect(top.action.interactionId).toBe('use');
  });

  it('needs decay and mood falls as needs drop', () => {
    const g = newGame();
    const sim = g.household()[0];
    g.state.settings.freeWill = 'off';
    const moodBefore = moodScore(sim);
    const hungerBefore = sim.needs.hunger;
    g.tick(120);
    expect(sim.needs.hunger).toBeLessThan(hungerBefore);
    expect(moodScore(sim)).toBeLessThanOrEqual(moodBefore);
  });
});

describe('actions', () => {
  it('a queued snack walks to the fridge and fills hunger', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    sim.needs.hunger = 30;
    const fridge = g.state.lot.objects.find((o) => o.defId === 'fridge')!;
    enqueue(g, sim, { kind: 'object', objectId: fridge.id, interactionId: 'snack', label: 'Snack', icon: '', userQueued: true });
    g.tick(60);
    expect(sim.needs.hunger).toBeGreaterThan(40);
    expect(sim.current).toBeNull();
  });

  it('cooking leads to sitting down to eat, and builds skill', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    sim.needs.hunger = 20;
    const stove = g.state.lot.objects.find((o) => o.defId === 'stove')!;
    enqueue(g, sim, { kind: 'object', objectId: stove.id, interactionId: 'cook', label: 'Cook', icon: '', userQueued: true });
    let sawSeated = false;
    for (let i = 0; i < 150; i++) {
      g.tick(1);
      if (sim.current?.kind === 'seat' && sim.poseObjectId !== null) sawSeated = true;
    }
    expect(sawSeated).toBe(true);
    expect(sim.needs.hunger).toBeGreaterThan(60);
    expect(sim.skills.cooking).toBeGreaterThan(0);
    expect(stove.dirt).toBeGreaterThan(0);
  });

  it('sleeping fills energy and frees the bed afterwards', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    sim.needs.energy = 20;
    sim.needs.bladder = 100;
    sim.needs.hunger = 100;
    const bed = g.state.lot.objects.find((o) => o.defId === 'bed_double')!;
    enqueue(g, sim, { kind: 'object', objectId: bed.id, interactionId: 'sleep', label: 'Sleep', icon: '', userQueued: true });
    g.tick(30);
    expect(bed.users).toContain(sim.id);
    g.tick(390);
    expect(sim.needs.energy).toBeGreaterThan(95);
    expect(bed.users).not.toContain(sim.id);
    expect(sim.poseObjectId).toBeNull();
  });

  it('cancelling stops the action', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    const tv = g.state.lot.objects.find((o) => o.defId === 'tv')!;
    const uid = enqueue(g, sim, { kind: 'object', objectId: tv.id, interactionId: 'watch', label: 'TV', icon: '', userQueued: true });
    g.tick(5);
    expect(sim.current?.uid).toBe(uid);
    cancelAction(g, sim, uid);
    expect(sim.current).toBeNull();
  });

  it('Sims left alone with full free will look after themselves for two days', () => {
    const g = newGame(2);
    g.tick(60 * 48);
    for (const sim of g.household()) {
      expect(sim.needs.hunger).toBeGreaterThan(5);
      expect(sim.needs.energy).toBeGreaterThan(5);
    }
  });
});

describe('social', () => {
  it('chatting raises friendship and social', () => {
    const g = newGame(2);
    g.state.settings.freeWill = 'off';
    const [a, b] = g.household();
    a.needs.social = 20;
    const before = g.state.relationships.find((r) => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id))!.friendship;
    enqueue(g, a, { kind: 'social', targetSimId: b.id, socialId: 'chat', label: 'Chat', icon: '', userQueued: true });
    g.tick(60);
    const rel = g.state.relationships.find((r) => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id))!;
    expect(a.needs.social).toBeGreaterThan(20);
    expect(rel.friendship).not.toBe(before);
  });
});

describe('build and buy', () => {
  it('buying costs money and selling refunds it', () => {
    const g = newGame();
    const funds = g.state.household.funds;
    const res = buyObject(g, 'guitar', 1, 1, 0);
    expect(res.ok).toBe(true);
    expect(g.state.household.funds).toBe(funds - OBJECTS.guitar.price);
    sellObject(g, res.id!);
    expect(g.state.household.funds).toBe(funds);
  });

  it('walls, doors and floors cost money', () => {
    const g = newGame(1, 'empty');
    const funds = g.state.household.funds;
    const r = placeWalls(g, roomOutlineKeys(1, 1, 4, 4));
    expect(r.ok).toBe(true);
    expect(g.state.household.funds).toBe(funds - 12 * 40);
    expect(setWallKind(g, hKey(2, 1), 'door').ok).toBe(true);
    expect(paintFloor(g, 1, 1, 3, 3, 'oak').ok).toBe(true);
    expect(g.roomInfo().count).toBe(2);
  });
});

describe('careers and money', () => {
  it('a Sim goes to work, comes home and gets paid', () => {
    const g = newGame();
    const sim = g.household()[0];
    joinCareer(g, sim, 'scientist'); // Mon–Fri 9–15
    g.tick(24 * 60); // to Tuesday 08:00
    const funds = g.state.household.funds;
    g.tick(90); // 09:30
    expect(sim.location).toBe('work');
    g.tick(6 * 60);
    expect(sim.location).toBe('lot');
    expect(g.state.household.funds).toBeGreaterThan(funds + 60);
    expect(sim.career!.performance).toBeGreaterThan(0);
  });

  it('weekly bills arrive on Monday', () => {
    const g = newGame();
    g.tick(7 * 24 * 60 + 120);
    const hasBill = g.state.bills !== null || g.state.notifications.some((n) => n.kind === 'bills');
    expect(hasBill).toBe(true);
  });
});

describe('skills', () => {
  it('levels follow the XP table', () => {
    expect(skillLevel(0)).toBe(1);
    expect(skillLevel(60)).toBe(2);
    expect(skillLevel(59)).toBe(1);
    expect(skillLevel(5000)).toBe(10);
  });
});

describe('saving', () => {
  it('round-trips through JSON', () => {
    const g = newGame(2);
    g.tick(200);
    const text = serialize(g.state);
    const loaded = deserialize(text);
    expect(loaded.sims.length).toBe(g.state.sims.length);
    expect(loaded.household.funds).toBe(g.state.household.funds);
    expect(loaded.lot.objects.length).toBe(g.state.lot.objects.length);
    const g2 = new Game(loaded);
    g2.tick(60);
  });

  it('rejects files that are not saves', () => {
    expect(() => deserialize('{"hello":1}')).toThrow();
    expect(() => deserialize('nope')).toThrow();
  });
});

describe('long run', () => {
  it('a household of 4 with jobs survives two weeks without errors', () => {
    const seedState = { rng: 99 } as GameState;
    const drafts = Array.from({ length: 4 }, () => randomDraft(seedState, 'Long'));
    const g = new Game(createGame({ householdName: 'Long', sims: drafts, lot: 'starter', seed: 3 }));
    const careers = ['chef', 'scientist', 'artist', 'cafe'];
    g.household().forEach((s, i) => joinCareer(g, s, careers[i]));
    const funds = g.state.household.funds;
    let lowCount = 0;
    for (let h = 0; h < 24 * 14; h++) {
      g.tick(60);
      for (const s of g.household()) if (s.location === 'lot' && (s.needs.hunger < 3 || s.needs.energy < 3)) lowCount++;
    }
    // Sims should rarely be at rock bottom.
    expect(lowCount).toBeLessThan(40);
    const worked = g.household().reduce((n, s) => n + (s.career?.daysWorked ?? 0), 0);
    expect(worked).toBeGreaterThan(15);
    expect(g.state.household.funds).toBeGreaterThan(funds - 2000);
    // Visitors came by.
    expect(g.state.notifications.some((n) => n.text.includes('has come to visit'))).toBe(true);
    // Everyone has made progress on something.
    for (const s of g.household()) expect(Object.values(s.skills).some((x) => x > 30)).toBe(true);
  });
});
