// Dirty clothes, phones and looking after pets.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createGame, randomDraft } from '../src/sim/newgame';
import { enqueue } from '../src/sim/actions';
import { homeSpecial } from '../src/sim/home';
import { changeClothes, cleanClothes, dirtOf } from '../src/sim/clothes';
import { answerCall, answerOffer, contacts, order, phoneHour, phoneTick, receive, sendText, unreadCount } from '../src/sim/phone';
import { adoptPet, dropPoo, litterTray, petObjectSpecial, poos, vetVisit } from '../src/sim/pets';
import { getRel } from '../src/sim/relationships';
import { runCommand } from '../src/sim/commands';
import type { GameState } from '../src/sim/types';

function newGame(): Game {
  const seed = { rng: 21 } as GameState;
  return new Game(createGame({ householdName: 'Life', sims: [randomDraft(seed, 'Life'), randomDraft(seed, 'Life')], lot: 'starter', seed: 17 }));
}
const refresh = (g: Game) => { for (const s of g.household()) { for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = 100; s.queue = []; s.current = null; s.poseObjectId = null; } };
const meet = (g: Game, a: number, b: number, friendship = 40) => { const r = getRel(g.state, a, b); r.met = true; r.friendship = friendship; };

describe('dirty clothes', () => {
  it('clothes get dirty, especially when working out, and a change uses a clean outfit', () => {
    const g = newGame();
    const sim = g.household()[0];
    expect(cleanClothes(g)).toBe(10);
    refresh(g);
    enqueue(g, sim, { kind: 'self', selfId: 'stretch', label: 'Stretch', icon: '🧘', userQueued: true });
    for (let i = 0; i < 40; i++) g.tick(1);
    expect(dirtOf(sim)).toBeGreaterThan(5);
    sim.clothesDirt = 90;
    const basket = g.state.household.laundry;
    expect(changeClothes(g, sim).ok).toBe(true);
    expect(dirtOf(sim)).toBe(0);
    expect(cleanClothes(g)).toBe(9);
    expect(g.state.household.laundry).toBe(basket + 8);
  });

  it('with nothing clean left you have to do the washing, which refills the wardrobes', () => {
    const g = newGame();
    const sim = g.household()[0];
    g.state.household.cleanClothes = 0;
    sim.clothesDirt = 90;
    expect(changeClothes(g, sim).ok).toBe(false);
    const washer = g.state.lot.objects.find((o) => o.defId === 'washer')!;
    const line = g.state.lot.objects.find((o) => o.defId === 'washing_line')!;
    g.state.household.laundry = 40;
    homeSpecial(g, sim, washer, 'wash');
    expect(g.state.household.wetWashing).toBe(40);
    homeSpecial(g, sim, line, 'hang');
    line.growth = 100;
    homeSpecial(g, sim, line, 'bringIn');
    expect(cleanClothes(g)).toBe(5);
    expect(changeClothes(g, sim).ok).toBe(true);
  });

  it('a shower comes with clean clothes', () => {
    const g = newGame();
    const sim = g.household()[0];
    refresh(g);
    sim.clothesDirt = 60;
    sim.needs.hygiene = 10;
    const shower = g.state.lot.objects.find((o) => o.defId === 'shower')!;
    enqueue(g, sim, { kind: 'object', objectId: shower.id, interactionId: 'shower', label: 'Shower', icon: '🚿', userQueued: true });
    for (let i = 0; i < 120 && dirtOf(sim) > 10; i++) g.tick(1);
    expect(dirtOf(sim)).toBeLessThan(10);
  });
});

describe('phones', () => {
  it('texting a friend gets a reply later, and friendship grows', () => {
    const g = newGame();
    const sim = g.household()[0];
    const friend = g.state.sims.find((s) => s.isTownie)!;
    meet(g, sim.id, friend.id, 30);
    expect(contacts(g, sim).map((s) => s.id)).toContain(friend.id);
    refresh(g);
    expect(sendText(g, sim, friend.id, 'chat').ok).toBe(true);
    expect(sim.phone!.msgs.at(-1)!.out).toBe(true);
    const before = getRel(g.state, sim.id, friend.id).friendship;
    for (let i = 0; i < 60; i++) { g.state.time += 1; phoneTick(g); }
    const reply = sim.phone!.msgs.at(-1)!;
    expect(reply.out).toBeFalsy();
    expect(reply.from).toBe(friend.id);
    expect(getRel(g.state, sim.id, friend.id).friendship).toBeGreaterThan(before);
    expect(unreadCount(sim)).toBe(1);
    runCommand(g, { t: 'readPhone', simId: sim.id });
    expect(unreadCount(sim)).toBe(0);
  });

  it('saying yes to "can I come round?" brings them over', () => {
    const g = newGame();
    const sim = g.household()[0];
    const friend = g.state.sims.find((s) => s.isTownie && s.location === 'home')!;
    meet(g, sim.id, friend.id);
    const msg = receive(g, sim, friend.id, 'Fancy a brew?', { kind: 'visit', until: g.state.time + 60 });
    expect(answerOffer(g, sim, msg.id, true).ok).toBe(true);
    expect(g.state.pendingVisits.some((v) => v.simId === friend.id)).toBe(true);
    expect(answerOffer(g, sim, msg.id, true).ok).toBe(false);
  });

  it('incoming calls can be answered, or ring out as a missed call', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const [a, b] = g.household();
    const friend = g.state.sims.find((s) => s.isTownie)!;
    refresh(g);
    a.call = { from: friend.id, until: g.state.time + 20 };
    expect(answerCall(g, a, true).ok).toBe(true);
    expect(a.queue[0]?.selfId ?? a.current?.selfId).toBe('call');
    b.call = { from: friend.id, until: g.state.time + 1 };
    g.state.time += 2;
    phoneTick(g);
    expect(b.call).toBeNull();
    expect(b.phone!.msgs.at(-1)!.text).toContain('Missed call');
  });

  it('friends text and ring by themselves over a few days', () => {
    const g = newGame();
    const sim = g.household()[0];
    for (const t of g.state.sims.filter((s) => s.isTownie)) meet(g, sim.id, t.id, 50);
    for (let d = 0; d < 6; d++) for (let h = 8; h <= 21; h++) phoneHour(g, h);
    expect((sim.phone?.msgs.length ?? 0)).toBeGreaterThan(2);
  });

  it('online shopping is delivered a few hours later', () => {
    const g = newGame();
    const food = g.state.household.groceries;
    const funds = g.state.household.funds;
    expect(order(g, 'groceries').ok).toBe(true);
    expect(g.state.household.funds).toBe(funds - 45);
    g.state.time += 200;
    phoneTick(g);
    expect(g.state.household.groceries).toBe(food + 25);
  });
});

describe('pet care', () => {
  it('dogs poo in the garden; poo can be picked up, and treading in it is horrible', () => {
    const g = newGame();
    g.state.household.funds = 5000;
    refresh(g);
    const dog = adoptPet(g, 'dog', 'Rex', '#c69c6d').pet!;
    dog.poo = 100;
    for (let i = 0; i < 300 && !poos(g).length; i++) g.tick(1);
    expect(poos(g).length).toBe(1);
    expect(dog.poo).toBeLessThan(20);
    const poo = poos(g)[0];
    const sim = g.household()[0];
    expect(petObjectSpecial(g, poo, 'scoopPoo')).toBe(true);
    expect(poos(g).length).toBe(0);
    // Tread in one.
    const exit = g.exitTile();
    const p2 = dropPoo(g, { x: exit.x + 0.5, z: exit.z + 1.5 }, null)!;
    refresh(g);
    sim.pos = { x: exit.x + 0.5, z: exit.z + 0.5 };
    sim.clothesDirt = 0;
    enqueue(g, sim, { kind: 'goto', dest: { x: p2.x, z: p2.z }, label: 'Go', icon: '📍', userQueued: true });
    for (let i = 0; i < 30; i++) g.tick(0.5);
    expect(p2.growth).toBe(1);
    expect(dirtOf(sim)).toBeGreaterThanOrEqual(25);
    expect(sim.moodlets.some((m) => m.id === 'trod_in_poo')).toBe(true);
  });

  it('cats come with a litter tray and use it', () => {
    const g = newGame();
    g.state.household.funds = 5000;
    const cat = adoptPet(g, 'cat', 'Tom', '#e8913a').pet!;
    const tray = litterTray(g)!;
    expect(tray).toBeTruthy();
    cat.poo = 100;
    for (let i = 0; i < 300 && tray.dirt === 0 && !poos(g).length; i++) g.tick(1);
    expect(tray.dirt).toBeGreaterThan(0);
    expect(petObjectSpecial(g, tray, 'cleanTray')).toBe(true);
    expect(tray.dirt).toBe(0);
  });

  it('the vet sorts out poorly pets and fleas', () => {
    const g = newGame();
    g.state.household.funds = 5000;
    const dog = adoptPet(g, 'dog', 'Rex', '#c69c6d').pet!;
    dog.sickSince = g.state.time;
    dog.fleas = true;
    expect(vetVisit(g, dog.id).ok).toBe(true);
    expect(dog.sickSince).toBeUndefined();
    expect(dog.fleas).toBe(false);
  });

  it('cages get dirty as the pet does, and cleaning out resets them', () => {
    const g = newGame();
    g.state.household.funds = 5000;
    const rabbit = adoptPet(g, 'rabbit', 'Flop', '#f4f1ea').pet!;
    rabbit.clean = 30;
    g.tick(1);
    const hutch = g.object(rabbit.homeId!)!;
    expect(hutch.dirt).toBeGreaterThanOrEqual(60);
    petObjectSpecial(g, hutch, 'cleanCage');
    expect(rabbit.clean).toBe(100);
    expect(hutch.dirt).toBe(0);
  });
});
