import { describe, expect, it } from 'vitest';
import { createGame, randomDraft } from '../src/sim/newgame';
import { newPlayer } from '../src/sim/family';
import { Game } from '../src/sim/game';
import { requestApproval, runCommand } from '../src/sim/commands';
import type { GameState } from '../src/sim/types';

function setup() {
  const seed = { rng: 4 } as GameState;
  const st = createGame({ householdName: 'Cmd', sims: [randomDraft(seed, 'Cmd'), randomDraft(seed, 'Cmd')], lot: 'starter', seed: 3 });
  const game = new Game(st);
  const mum = newPlayer(st, 'Mum', 'manager');
  const kid = newPlayer(st, 'Ella', 'member');
  const [a, b] = st.household.memberIds;
  st.family!.owners[a] = kid.id;
  st.family!.owners[b] = mum.id;
  st.family!.activeId = mum.id;
  return { st, game, mum, kid, a, b };
}

describe('commands', () => {
  it('run as the player who sent them, without changing who is active on the host', () => {
    const { st, game, mum, kid, a, b } = setup();
    const action = { kind: 'goto' as const, dest: { x: 10, z: 10 }, label: 'Go', icon: '📍', userQueued: true };
    expect(runCommand(game, { t: 'queue', simId: b, action }, { playerId: kid.id }).ok).toBe(false);
    expect(runCommand(game, { t: 'queue', simId: a, action }, { playerId: kid.id }).ok).toBe(true);
    expect(st.family!.activeId).toBe(mum.id);
  });

  it('spending over the allowance goes to a money manager, who can say yes from another device', () => {
    const { st, game, mum, kid } = setup();
    kid.allowance = 50;
    const funds = st.household.funds;
    const cmd = { t: 'clothes' as const, simId: st.household.memberIds[0], appearance: { ...st.sims[0].appearance, topColor: '#123456' }, cost: 80 };
    const spend = { amount: 80, what: 'new clothes' };
    const res = runCommand(game, cmd, { playerId: kid.id, spend });
    expect(res.ok).toBe(false);
    expect(res.approval?.reason).toBe('needsApproval');
    const id = requestApproval(game, cmd, spend, kid.id, 'needsApproval');
    expect(st.approvals).toHaveLength(1);
    // Ella can't approve her own request...
    expect(runCommand(game, { t: 'approve', id, yes: true }, { playerId: kid.id }).ok).toBe(false);
    // ...but Mum can.
    expect(runCommand(game, { t: 'approve', id, yes: true }, { playerId: mum.id }).ok).toBe(true);
    expect(st.approvals).toHaveLength(0);
    expect(st.household.funds).toBe(funds - 80);
    expect(st.sims.find((s) => s.id === cmd.simId)!.appearance.topColor).toBe('#123456');
    expect(kid.spent).toBe(0);
  });

  it("a manager's PIN works on anyone's device, and requests can be withdrawn", () => {
    const { st, game, mum, kid } = setup();
    mum.pin = '4321';
    const spend = { amount: 0, what: 'Netflix', household: true };
    const id = requestApproval(game, { t: 'subscribe', id: 'netflix', on: true }, spend, kid.id, 'managerOnly');
    expect(runCommand(game, { t: 'approve', id, yes: true, pin: '0000' }, { playerId: kid.id }).ok).toBe(false);
    expect(runCommand(game, { t: 'approve', id, yes: true, pin: '4321' }, { playerId: kid.id }).ok).toBe(true);
    expect(st.household.subscriptions.netflix).toBe(true);
    const id2 = requestApproval(game, { t: 'subscribe', id: 'sky', on: true }, spend, kid.id, 'managerOnly');
    expect(runCommand(game, { t: 'approve', id: id2, yes: false }, { playerId: kid.id }).ok).toBe(true);
    expect(st.approvals).toHaveLength(0);
    expect(st.household.subscriptions.sky).toBe(false);
  });

  it('buy and sell objects', () => {
    const { st, game, mum } = setup();
    const before = st.lot.objects.length;
    let placed = false;
    for (let x = 1; x < st.lot.width - 2 && !placed; x++) {
      for (let z = 1; z < st.lot.depth - 2 && !placed; z++) {
        const r = runCommand(game, { t: 'buy', defId: 'plant_small', x, z, rot: 0 }, { playerId: mum.id });
        if (r.ok) { placed = true; expect(r.id).toBeTypeOf('number'); runCommand(game, { t: 'sell', id: r.id! }, { playerId: mum.id }); }
      }
    }
    expect(placed).toBe(true);
    expect(st.lot.objects.length).toBe(before);
  });
});
