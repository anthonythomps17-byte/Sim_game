import { describe, expect, it } from 'vitest';
import { createGame, randomDraft } from '../src/sim/newgame';
import { Game } from '../src/sim/game';
import { scheduleNextVisit } from '../src/sim/schedule';
import { apply, diff, snapshot } from '../src/net/sync';
import type { GameState } from '../src/sim/types';

function newGame() {
  const seed = { rng: 9 } as GameState;
  const st = createGame({ householdName: 'Sync', sims: [randomDraft(seed, 'Sync'), randomDraft(seed, 'Sync'), randomDraft(seed, 'Sync')], lot: 'starter', seed: 5 });
  const g = new Game(st);
  scheduleNextVisit(g);
  return g;
}

describe('state sync', () => {
  it('a guest copy stays identical to the host mirror through diffs', () => {
    const g = newGame();
    let mirror = snapshot(g.state);
    let guest = structuredClone(mirror);
    let bytes = 0, n = 0;
    for (let i = 0; i < 600; i++) {
      g.tick(0.5); // half a game minute per step
      if (i % 4 === 0) {
        const ops = diff(mirror, g.state);
        mirror = apply(mirror, ops);
        guest = apply(guest, JSON.parse(JSON.stringify(ops)));
        bytes += JSON.stringify(ops).length; n++;
      }
    }
    const last = diff(mirror, g.state);
    mirror = apply(mirror, last);
    guest = apply(guest, last);
    expect(guest).toEqual(mirror);
    expect(mirror).toEqual(snapshot(g.state));
    const full = JSON.stringify(mirror).length;
    console.log(`full state ${full} bytes, average diff ${Math.round(bytes / n)} bytes`);
    expect(bytes / n).toBeLessThan(full / 4);
  });

  it('handles deleted keys, resized arrays and nulls', () => {
    const a: Record<string, unknown> = { x: 1, y: [1, 2, 3], z: { q: 1, r: 2 }, n: { a: 1 } };
    const b: Record<string, unknown> = { x: 1.23456, y: [1, 2], z: { q: 1 }, n: null, w: 'new' };
    const ops = diff(a, b);
    const out = apply(structuredClone(a), ops);
    expect(out).toEqual({ x: 1.23, y: [1, 2], z: { q: 1 }, n: null, w: 'new' });
  });
});
