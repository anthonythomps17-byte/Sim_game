import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createGame, randomDraft } from '../src/sim/newgame';
import { checkInteraction, enqueue } from '../src/sim/actions';
import { buyObject } from '../src/sim/build';
import { billBreakdown, binsOverflowing, homeSpecial, noHotWater } from '../src/sim/home';
import { interaction } from '../src/sim/defs';
import type { GameState } from '../src/sim/types';

function newGame(): Game {
  const seed = { rng: 3 } as GameState;
  const g = new Game(createGame({ householdName: 'Home', sims: [randomDraft(seed, 'Home')], lot: 'starter', seed: 5 }));
  return g;
}
const goTo = (g: Game, day: number, hour: number) => { const t = day * 1440 + hour * 60; while (g.state.time < t) g.tick(Math.min(60, t - g.state.time)); };
const obj = (g: Game, id: string) => g.state.lot.objects.find((o) => o.defId === id)!;
/** Free will is off in these tests, so keep the Sim fed and rested and clear any queue. */
const refresh = (g: Game) => { for (const s of g.household()) { for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = 100; s.queue = []; s.current = null; s.poseObjectId = null; } };

describe('bins', () => {
  it('bins taken out on Wednesday night get emptied on Thursday', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    goTo(g, 2, 20); // Wednesday evening
    refresh(g);
    const bin = obj(g, 'wheelie_bin');
    expect(checkInteraction(g, sim, bin, interaction('wheelie_bin', 'out')!).ok).toBe(true);
    enqueue(g, sim, { kind: 'object', objectId: bin.id, interactionId: 'out', label: 'Bins', icon: '', userQueued: true });
    g.tick(30);
    expect(bin.atKerb).toBe(true);
    expect(bin.z).toBe(0);
    goTo(g, 3, 8);
    expect(g.state.household.rubbish).toBe(0);
    expect(checkInteraction(g, sim, bin, interaction('wheelie_bin', 'in')!).ok).toBe(true);
  });

  it('missing bin day lets rubbish overflow', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    goTo(g, 10, 12);
    expect(binsOverflowing(g)).toBe(true);
  });
});

describe('chores', () => {
  it('dust and weeds build up, and hoovering and weeding clear them', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    goTo(g, 4, 9);
    expect(g.state.household.dust).toBeGreaterThan(40);
    expect(g.state.household.weeds).toBeGreaterThan(40);
    refresh(g);
    const dust = g.state.household.dust, weeds = g.state.household.weeds;
    enqueue(g, sim, { kind: 'self', selfId: 'hoover', label: 'Hoover', icon: '', userQueued: true });
    enqueue(g, sim, { kind: 'self', selfId: 'weed', label: 'Weed', icon: '', userQueued: true });
    g.tick(150);
    expect(g.state.household.dust).toBeLessThan(dust);
    expect(g.state.household.weeds).toBeLessThan(weeds);
  });
});

describe('things breaking', () => {
  it('a blocked drain stops the shower until a plumber fixes it', () => {
    const g = newGame();
    const sim = g.household()[0];
    const shower = obj(g, 'shower');
    shower.broken = true;
    expect(checkInteraction(g, sim, shower, interaction('shower', 'shower')!).ok).toBe(false);
    const funds = g.state.household.funds;
    homeSpecial(g, sim, shower, 'plumber');
    expect(shower.broken).toBe(false);
    expect(g.state.household.funds).toBe(funds - 120);
  });

  it('a broken boiler means cold showers, and a heat pump avoids it', () => {
    const g = newGame();
    obj(g, 'boiler').broken = true;
    expect(noHotWater(g)).toBe(true);
    expect(buyObject(g, 'heat_pump', 19, 10, 0).ok).toBe(true);
    expect(noHotWater(g)).toBe(false);
  });
});

describe('energy and subscriptions', () => {
  it('solar panels and a heat pump cut the energy bill; subscriptions add to it', () => {
    const g = newGame();
    const before = billBreakdown(g);
    buyObject(g, 'solar', 1, 14, 0);
    buyObject(g, 'heat_pump', 19, 10, 0);
    const after = billBreakdown(g);
    expect(after.energy).toBeLessThan(before.energy * 0.6);
    expect(after.energySaved).toBeGreaterThan(0);
    const sim = g.household()[0];
    const tv = obj(g, 'tv');
    expect(checkInteraction(g, sim, tv, interaction('tv', 'netflix')!).hidden).toBe(true);
    g.state.household.subscriptions.netflix = true;
    g.state.household.subscriptions.sky = true;
    expect(checkInteraction(g, sim, tv, interaction('tv', 'netflix')!).ok).toBe(true);
    expect(billBreakdown(g).subscriptions).toBe(30);
  });
});

describe('outings and seasons', () => {
  it('B&M gives a voucher for the next purchase', () => {
    const g = newGame();
    g.state.settings.freeWill = 'off';
    const sim = g.household()[0];
    enqueue(g, sim, { kind: 'outing', selfId: 'bm', label: 'B&M', icon: '', userQueued: true });
    g.tick(120);
    expect(g.state.household.discount).toBe(0.25);
    const funds = g.state.household.funds;
    expect(buyObject(g, 'guitar', 1, 1, 0).ok).toBe(true);
    expect(g.state.household.funds).toBe(funds - Math.round(250 * 0.75));
    expect(g.state.household.discount).toBe(0);
  });

  it('no barbecues in winter', () => {
    const g = newGame();
    const sim = g.household()[0];
    const bbq = buyObject(g, 'bbq', 2, 15, 0);
    const o = g.object(bbq.id!)!;
    expect(checkInteraction(g, sim, o, interaction('bbq', 'grill')!).ok).toBe(true);
    goTo(g, 22, 9);
    expect(checkInteraction(g, sim, o, interaction('bbq', 'grill')!).reason).toContain('cold');
  });
});
