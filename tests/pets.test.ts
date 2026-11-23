import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createGame, randomDraft } from '../src/sim/newgame';
import { enqueue } from '../src/sim/actions';
import { adoptPet, occupant, petHappiness } from '../src/sim/pets';
import { billBreakdown, homeSpecial } from '../src/sim/home';
import type { GameState } from '../src/sim/types';

function newGame(): Game {
  const seed = { rng: 9 } as GameState;
  return new Game(createGame({ householdName: 'Pets', sims: [randomDraft(seed, 'Pets')], lot: 'starter', seed: 13 }));
}
const refresh = (g: Game) => { for (const s of g.household()) { for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = 100; s.queue = []; s.current = null; s.poseObjectId = null; } };
void homeSpecial;

describe('pets', () => {
  it('can adopt every kind of pet, with a home set up automatically', () => {
    const g = newGame();
    g.state.household.funds = 5000;
    for (const [sp, home] of [['dog', null], ['cat', null], ['parrot', 'parrot_cage'], ['rabbit', 'rabbit_hutch']] as const) {
      const res = adoptPet(g, sp, '', '#c69c6d');
      expect(res.ok, `${sp}: ${res.why}`).toBe(true);
      if (home) {
        const cage = g.state.lot.objects.find((o) => o.defId === home)!;
        expect(occupant(g, cage)?.id).toBe(res.pet!.id);
      }
    }
    expect(g.state.lot.objects.some((o) => o.defId === 'pet_bowl')).toBe(true);
    expect(adoptPet(g, 'hamster', '', '#e0a35c').ok).toBe(false); // max 4
    expect(billBreakdown(g).pets).toBe(12 + 8 + 6 + 5);
  });

  it('a dog wanders, eats from the bowl and enjoys a fuss', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const dog = adoptPet(g, 'dog', 'Biscuit', '#c69c6d').pet!;
    dog.hunger = 30;
    const start = { ...dog.pos };
    g.tick(120);
    expect(Math.hypot(dog.pos.x - start.x, dog.pos.z - start.z)).toBeGreaterThan(1);
    expect(dog.hunger).toBeGreaterThan(30);
    refresh(g);
    const sim = g.household()[0];
    dog.fun = 20;
    const bond = dog.bond;
    enqueue(g, sim, { kind: 'pet', petId: dog.id, petAction: 'fetch', label: 'Fetch', icon: '', userQueued: true });
    g.tick(80);
    expect(dog.fun).toBeGreaterThan(40);
    expect(dog.bond).toBeGreaterThan(bond);
  });

  it('walking the dog takes the dog along', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const dog = adoptPet(g, 'dog', 'Rex', '#3b2a1e').pet!;
    refresh(g);
    const sim = g.household()[0];
    dog.fun = 20;
    enqueue(g, sim, { kind: 'outing', selfId: 'dogwalk', label: 'Walk', icon: '', userQueued: true });
    g.tick(25);
    expect(dog.location).toBe('away');
    g.tick(80);
    expect(dog.location).toBe('lot');
    expect(dog.fun).toBeGreaterThan(50);
  });

  it('a parrot learns words when you talk to it', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const parrot = adoptPet(g, 'parrot', 'Polly', '#2fb34a').pet!;
    const cage = g.object(parrot.homeId!)!;
    refresh(g);
    const sim = g.household()[0];
    for (let i = 0; i < 6; i++) {
      enqueue(g, sim, { kind: 'object', objectId: cage.id, interactionId: 'play', label: 'Talk', icon: '', userQueued: true });
      g.tick(40);
      refresh(g);
    }
    expect(parrot.words).toBeGreaterThan(0);
  });

  it('neglected pets complain but are fine; feeding helps', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const rabbit = adoptPet(g, 'rabbit', 'Thumper', '#f4f1ea').pet!;
    g.tick(3 * 1440);
    expect(g.state.pets).toHaveLength(1);
    expect(petHappiness(rabbit)).toBeLessThan(50);
    expect(g.state.notifications.some((n) => n.text.startsWith('Thumper'))).toBe(true);
    refresh(g);
    g.state.household.petFood = 10;
    const hutch = g.object(rabbit.homeId!)!;
    const hunger = rabbit.hunger;
    enqueue(g, g.household()[0], { kind: 'object', objectId: hutch.id, interactionId: 'feed', label: 'Feed', icon: '', userQueued: true });
    g.tick(60);
    expect(rabbit.hunger).toBeGreaterThan(hunger);
  });

  it('the pet shop restocks pet food', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    refresh(g);
    g.state.time = 10 * 60;
    const before = g.state.household.petFood;
    enqueue(g, g.household()[0], { kind: 'outing', selfId: 'petshop', label: 'Pet shop', icon: '', userQueued: true });
    g.tick(90);
    expect(g.state.household.petFood).toBe(before + 30);
  });

  it('a household with pets survives a fortnight on free will', () => {
    const g = newGame();
    adoptPet(g, 'dog', 'Max', '#d9a066');
    adoptPet(g, 'cat', 'Tigger', '#e8913a');
    g.tick(14 * 1440);
    for (const s of g.household()) expect(s.needs.hunger).toBeGreaterThan(0);
  });
});
