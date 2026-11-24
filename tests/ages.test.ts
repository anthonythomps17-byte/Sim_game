// Growing up, school days and jobs you can see.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createGame, randomDraft } from '../src/sim/newgame';
import { joinCareer } from '../src/sim/schedule';
import { agesHour, isSchoolDay, setAge } from '../src/sim/ages';
import { enqueue } from '../src/sim/actions';
import type { GameState } from '../src/sim/types';

function newGame(ages: ('child' | 'teen' | 'adult')[]): Game {
  const seed = { rng: 41 } as GameState;
  const drafts = ages.map((age) => ({ ...randomDraft(seed, 'Kids'), age }));
  const g = new Game(createGame({ householdName: 'Kids', sims: drafts, lot: 'starter', seed: 23 }));
  g.state.settings.freeWill = 'off';
  return g;
}
const keepWell = (g: Game) => { for (const s of g.household()) for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = Math.max(s.needs[k], 60); };
const runUntil = (g: Game, minute: number) => { while (g.state.time < minute) { g.tick(1); keepWell(g); } };

describe('growing up', () => {
  it('children walk to Hillcrest, spend the day in class and come home with homework', () => {
    const g = newGame(['adult', 'child']);
    const kid = g.household()[1];
    expect(kid.age).toBe('child');
    expect(isSchoolDay(g)).toBe(true); // Monday of spring
    runUntil(g, 10 * 60 + 30);
    expect(kid.location).toBe('town');
    expect(kid.current?.interactionId).toBe('school');
    const grade = kid.school!.grade;
    runUntil(g, 15 * 60 + 5);
    expect(kid.school!.attendedDay).toBe(0);
    expect(kid.school!.homework).toBe(true);
    expect(kid.school!.grade).toBeGreaterThan(grade);
    runUntil(g, 17 * 60);
    expect(kid.location).toBe('lot');
    enqueue(g, kid, { kind: 'self', selfId: 'homework', label: 'Homework', icon: '📚', userQueued: true });
    for (let i = 0; i < 90 && kid.school!.homework; i++) { g.tick(1); keepWell(g); }
    expect(kid.school!.homework).toBe(false);
  });

  it('classmates turn up at school too', () => {
    const g = newGame(['adult']);
    runUntil(g, 10 * 60 + 30);
    const inClass = g.state.sims.filter((s) => s.isTownie && s.age === 'child' && s.location === 'town');
    expect(inClass.length).toBeGreaterThan(0);
  });

  it('a birthday every two weeks: child → teen → adult, with a cake', () => {
    const g = newGame(['adult', 'child']);
    const kid = g.household()[1];
    g.state.time = 14 * 1440 + 8 * 60;
    agesHour(g, 8);
    expect(kid.age).toBe('teen');
    expect(kid.appearance.age).toBe('teen');
    expect(g.state.lot.objects.some((o) => o.defId === 'birthday_cake')).toBe(true);
    g.state.time = 28 * 1440 + 8 * 60;
    agesHour(g, 8);
    expect(kid.age).toBe('adult');
    expect(kid.school).toBeUndefined();
    // Growing up can be switched off.
    const g2 = newGame(['adult', 'child']);
    g2.state.settings.ageing = false;
    g2.state.time = 14 * 1440 + 8 * 60;
    agesHour(g2, 8);
    expect(g2.household()[1].age).toBe('child');
  });

  it('teens go to Ashton High (off-screen) and come back with homework', () => {
    const g = newGame(['adult', 'teen']);
    const teen = g.household()[1];
    runUntil(g, 10 * 60);
    expect(teen.location).toBe('away');
    runUntil(g, 16 * 60 + 30);
    expect(teen.location).toBe('lot');
    expect(teen.school!.homework).toBe(true);
  });

  it('children cannot get jobs or flirt, and are kept away from the cooker', () => {
    const g = newGame(['adult', 'child']);
    const kid = g.household()[1];
    expect(joinCareer(g, kid, 'coffee')).toBe(false);
    setAge(kid, 'adult', g.day);
    expect(joinCareer(g, kid, 'coffee')).toBe(true);
  });
});

describe('jobs you can see', () => {
  it('a barista walks to the café, works the shift behind the counter, gets paid and walks home', () => {
    const g = newGame(['adult']);
    const sim = g.household()[0];
    joinCareer(g, sim, 'coffee');
    sim.career!.workedToday = false;
    g.state.time = 1440 + 6 * 60; // Tuesday 6am
    const funds = g.state.household.funds;
    runUntil(g, 1440 + 9 * 60);
    expect(sim.location).toBe('town');
    expect(sim.current?.interactionId).toBe('work');
    expect(sim.current?.phase).toBe('perform');
    runUntil(g, 1440 + 14 * 60 + 10);
    expect(g.state.household.funds).toBeGreaterThan(funds);
    expect(sim.career!.daysWorked).toBe(1);
    runUntil(g, 1440 + 16 * 60);
    expect(sim.location).toBe('lot');
  });
});
