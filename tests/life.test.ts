import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createGame, randomDraft } from '../src/sim/newgame';
import { enqueue } from '../src/sim/actions';
import { buyObject } from '../src/sim/build';
import { joinCareer } from '../src/sim/schedule';
import { calendarOf, eventsOn, gameMinutesPerSecond, outingCheck, planParty, worksToday, YEAR_DAYS } from '../src/sim/life';
import { OUTINGS } from '../src/sim/defs';
import type { GameState } from '../src/sim/types';

function newGame(n = 1): Game {
  const seed = { rng: 7 } as GameState;
  const drafts = Array.from({ length: n }, () => randomDraft(seed, 'Life'));
  return new Game(createGame({ householdName: 'Life', sims: drafts, lot: 'starter', seed: 21 }));
}

/** Jump to a given day at a given hour (ticking through so schedules run). */
function goTo(g: Game, day: number, hour: number) {
  const target = day * 1440 + hour * 60;
  while (g.state.time < target) g.tick(Math.min(60, target - g.state.time));
}

describe('clock', () => {
  it('the day takes 15 real minutes and the night 8.5', () => {
    let realDay = 0, realNight = 0;
    for (let m = 0; m < 1440; m++) {
      const secs = 1 / gameMinutesPerSecond(m);
      if (m >= 7 * 60 && m < 21 * 60) realDay += secs; else realNight += secs;
    }
    expect(Math.round(realDay / 60)).toBe(15);
    expect(Math.round((realNight / 60) * 10) / 10).toBe(8.5);
  });
});

describe('calendar', () => {
  it('has four week-long seasons with the holidays in the right places', () => {
    expect(YEAR_DAYS).toBe(28);
    expect(calendarOf(0).season.id).toBe('spring');
    expect(eventsOn(6).map((e) => e.id)).toContain('easter');
    expect(eventsOn(7 + 3).map((e) => e.id)).toContain('summer');
    expect(eventsOn(14 + 4).map((e) => e.id)).toContain('halloween');
    expect(eventsOn(14 + 5).map((e) => e.id)).toContain('bonfire');
    expect(eventsOn(21 + 5).map((e) => e.id)).toContain('christmas');
    expect(calendarOf(28).year).toBe(2);
  });

  it('puts up a Christmas tree on Christmas Eve and takes it down after New Year', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    goTo(g, 21 + 4, 9);
    expect(g.state.lot.objects.some((o) => o.defId === 'christmas_tree')).toBe(true);
    goTo(g, 21 + 5, 9);
    expect(g.state.lot.objects.some((o) => o.defId === 'presents')).toBe(true);
    goTo(g, 28, 2);
    expect(g.state.lot.objects.some((o) => o.defId === 'christmas_tree' || o.defId === 'presents')).toBe(false);
  });

  it('nobody works on Christmas Day and teachers get the summer off', () => {
    const g = newGame(2);
    const [a, b] = g.household();
    joinCareer(g, a, 'teacher');
    joinCareer(g, b, 'shop');
    goTo(g, 7 + 1, 7); // summer, Tuesday
    expect(worksToday(g, a)).toBe(false);
    expect(worksToday(g, b)).toBe(true);
    goTo(g, 21 + 5, 7); // Christmas Day (Saturday)
    expect(worksToday(g, b)).toBe(false);
  });
});

describe('food', () => {
  it('cooking uses food, and an empty fridge blocks it', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    const stove = g.state.lot.objects.find((o) => o.defId === 'stove')!;
    const before = g.state.household.groceries;
    enqueue(g, sim, { kind: 'object', objectId: stove.id, interactionId: 'cook', label: 'Cook', icon: '', userQueued: true });
    g.tick(60);
    expect(g.state.household.groceries).toBe(before - 2);
    g.state.household.groceries = 0;
    enqueue(g, sim, { kind: 'object', objectId: stove.id, interactionId: 'cook', label: 'Cook', icon: '', userQueued: true });
    g.tick(5);
    expect(sim.current?.interactionId).not.toBe('cook');
  });

  it('hungry Sims with no food order a takeaway', () => {
    const g = newGame();
    const sim = g.household()[0];
    g.state.household.groceries = 0;
    sim.needs.hunger = 10;
    const funds = g.state.household.funds;
    g.tick(120);
    expect(sim.needs.hunger).toBeGreaterThan(40);
    expect(g.state.household.funds).toBeLessThan(funds);
  });

  it('a big food shop fills the fridge', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    const before = g.state.household.groceries;
    expect(outingCheck(g, sim, OUTINGS.food_big).ok).toBe(true);
    enqueue(g, sim, { kind: 'outing', selfId: 'food_big', label: 'Shop', icon: '', userQueued: true });
    g.tick(150);
    expect(sim.location).toBe('lot');
    expect(g.state.household.groceries).toBe(before + 35);
  });
});

describe('driving', () => {
  it('five lessons, then a test, then a licence and the car', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    expect(outingCheck(g, sim, OUTINGS.test).ok).toBe(false);
    sim.driving.lessons = 9; // plenty of practice: the test is almost certain
    g.state.time = 10 * 60;
    let passed = false;
    for (let tries = 0; tries < 6 && !passed; tries++) {
      enqueue(g, sim, { kind: 'outing', selfId: 'test', label: 'Test', icon: '', userQueued: true });
      g.tick(90);
      passed = sim.driving.licence;
    }
    expect(passed).toBe(true);
    expect(buyObject(g, 'car', 1, 12, 0).ok).toBe(true);
    enqueue(g, sim, { kind: 'outing', selfId: 'drive', label: 'Drive', icon: '', userQueued: true });
    g.tick(20);
    expect(g.state.lot.objects.find((o) => o.defId === 'car')!.outWith).toBe(sim.id);
    g.tick(90);
    expect(g.state.lot.objects.find((o) => o.defId === 'car')!.outWith).toBeFalsy();
  });
});

describe('parties and noise', () => {
  it('guests arrive, and late karaoke annoys the neighbours', () => {
    const g = newGame();
    const host = g.household()[0];
    buyObject(g, 'karaoke', 2, 2, 0);
    const guests = g.state.sims.filter((s) => s.isTownie).slice(0, 3).map((s) => s.id);
    expect(planParty(g, host, 'karaoke', 20 * 60, guests).ok).toBe(true);
    g.tick(20 * 60 - g.state.time + 5);
    expect(g.state.sims.filter((s) => guests.includes(s.id) && s.location === 'lot').length).toBe(3);
    const mood = g.state.household.neighbourMood;
    // Force non-stop karaoke late at night.
    const k = g.state.lot.objects.find((o) => o.defId === 'karaoke')!;
    goTo(g, 0, 22);
    for (let i = 0; i < 150; i++) {
      if (host.current?.interactionId !== 'sing') enqueue(g, host, { kind: 'object', objectId: k.id, interactionId: 'sing', label: 'Sing', icon: '', userQueued: true }, true);
      g.tick(1);
    }
    expect(g.state.household.neighbourMood).toBeLessThan(mood);
    expect(g.state.noise.stage).toBeGreaterThanOrEqual(1);
    expect(g.state.notifications.some((n) => n.text.includes('banging on the wall'))).toBe(true);
  });
});
