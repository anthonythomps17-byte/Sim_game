import { describe, expect, it } from 'vitest';
import { createGame, randomDraft } from '../src/sim/newgame';
import { activePlayer, canControl, checkSpend, newPlayer, recordSpend, resetAllowances } from '../src/sim/family';
import { Game } from '../src/sim/game';
import type { GameState } from '../src/sim/types';

function setup() {
  const seed = { rng: 4 } as GameState;
  const st = createGame({ householdName: 'Fam', sims: [randomDraft(seed, 'Fam'), randomDraft(seed, 'Fam')], lot: 'starter', seed: 2 });
  const mum = newPlayer(st, 'Mum', 'manager');
  const kid = newPlayer(st, 'Ella', 'member');
  const [a, b] = st.household.memberIds;
  st.family!.owners[a] = kid.id;
  st.family!.owners[b] = mum.id;
  return { st, mum, kid, a: st.sims.find((s) => s.id === a)!, b: st.sims.find((s) => s.id === b)! };
}

describe('family mode', () => {
  it('players only control their own Sims', () => {
    const { st, kid, a, b } = setup();
    st.family!.activeId = kid.id;
    expect(activePlayer(st)?.name).toBe('Ella');
    expect(canControl(st, a)).toBe(true);
    expect(canControl(st, b)).toBe(false);
  });

  it('members spend from an allowance; bigger spending and household decisions need a manager', () => {
    const { st, mum, kid } = setup();
    st.family!.activeId = kid.id;
    expect(checkSpend(st, 250).ok).toBe(true);
    recordSpend(st, 250);
    const over = checkSpend(st, 100);
    expect(over.ok).toBe(false);
    if (!over.ok) { expect(over.reason).toBe('needsApproval'); expect(over.left).toBe(50); }
    const bills = checkSpend(st, 10, true);
    expect(bills.ok).toBe(false);
    st.family!.activeId = mum.id;
    expect(checkSpend(st, 99999, true).ok).toBe(true);
    resetAllowances(st);
    expect(kid.spent).toBe(0);
  });

  it('allowances reset with the weekly bills, and the game runs with family mode on', () => {
    const { st, kid } = setup();
    kid.spent = 200;
    const g = new Game(st);
    g.tick(7 * 1440 + 10 * 60);
    expect(kid.spent).toBe(0);
  });

  it('turning family mode off removes all limits', () => {
    const { st, kid, b } = setup();
    st.family!.activeId = kid.id;
    st.family!.enabled = false;
    expect(canControl(st, b)).toBe(true);
    expect(checkSpend(st, 5000, true).ok).toBe(true);
  });
});
