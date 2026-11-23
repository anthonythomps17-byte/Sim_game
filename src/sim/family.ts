// Family mode: several people share one household on one device. Each player looks after their
// own Sims; a money manager approves bigger spending. Plain data and rules, no UI.
import type { GameState, Player, Sim } from './types';

export const PLAYER_COLORS = ['#ff7a59', '#2bb3a6', '#9b6ad6', '#f2c14e', '#4a90d9', '#e05a7a'];

export function familyOn(st: GameState): boolean {
  return !!st.family?.enabled && st.family.players.length > 0;
}

export function activePlayer(st: GameState): Player | null {
  if (!familyOn(st)) return null;
  return st.family!.players.find((p) => p.id === st.family!.activeId) ?? st.family!.players[0];
}

export function managers(st: GameState): Player[] {
  return st.family?.players.filter((p) => p.role === 'manager') ?? [];
}

/** Who looks after this Sim (null = anyone). */
export function ownerOf(st: GameState, simId: number): Player | null {
  if (!familyOn(st)) return null;
  const id = st.family!.owners[simId];
  return st.family!.players.find((p) => p.id === id) ?? null;
}

/** Can the active player give this Sim instructions? */
export function canControl(st: GameState, sim: Sim): boolean {
  const me = activePlayer(st);
  if (!me) return true;
  const owner = ownerOf(st, sim.id);
  return !owner || owner.id === me.id;
}

export type SpendCheck = { ok: true } | { ok: false; reason: 'needsApproval' | 'managerOnly'; left: number };

/**
 * Can the active player spend this? Members spend from a weekly allowance; anything over it,
 * and "household decisions" (bills, subscriptions, pets, holidays), need a money manager.
 */
export function checkSpend(st: GameState, amount: number, householdDecision = false): SpendCheck {
  const me = activePlayer(st);
  if (!me || me.role === 'manager' || !managers(st).length) return { ok: true };
  const left = Math.max(0, me.allowance - me.spent);
  if (householdDecision) return { ok: false, reason: 'managerOnly', left };
  if (amount <= left) return { ok: true };
  return { ok: false, reason: 'needsApproval', left };
}

/** Record spending against the active player's allowance (approved spending doesn't count). */
export function recordSpend(st: GameState, amount: number): void {
  const me = activePlayer(st);
  if (me && me.role === 'member' && amount > 0) me.spent += amount;
}

/** Allowances start again every Monday. */
export function resetAllowances(st: GameState): void {
  for (const p of st.family?.players ?? []) p.spent = 0;
}

export function newPlayer(st: GameState, name: string, role: Player['role']): Player {
  st.family ??= { enabled: true, players: [], activeId: 0, owners: {} };
  const p: Player = {
    id: st.nextId++, name, role, allowance: role === 'manager' ? 0 : 300, spent: 0, pin: '',
    color: PLAYER_COLORS[st.family.players.length % PLAYER_COLORS.length],
  };
  st.family.players.push(p);
  if (!st.family.activeId) st.family.activeId = p.id;
  return p;
}
