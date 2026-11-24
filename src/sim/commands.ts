// Everything a player can do to the world, as plain data. The UI builds a command, and the device
// that owns the world runs it. On one device that's immediate; when playing together the other
// devices send their commands to the host device, which runs them and shares the result.
import type { Game } from './game';
import type { Appearance, Party, QueuedAction, WallKind } from './types';
import { cancelAction, enqueue, payBills } from './actions';
import { joinCareer, quitCareer } from './schedule';
import { endParty, householdOuting, planParty } from './life';
import { adoptPet, rehomePet } from './pets';
import { buyObject, eraseWalls, moveObject, paintFloor, paintWall, placeWalls, sellObject, setWallKind, unlockRewardObject } from './build';
import { ENGINEER_COST, PLUMBER_COST, SUBSCRIPTIONS, type SubscriptionId } from './home';
import { activePlayer, canControl, checkSpend, managers, ownerOf, recordSpend } from './family';
import { addMoodlet } from './mood';
import { REWARD_TRAITS } from './defs';
import { answerCall, answerOffer, markRead, order, sendText, startCall, SHOP_ITEMS, type TextKind } from './phone';
import { vetVisit } from './pets';
import { setSteer } from './steer';

export type Cmd =
  | { t: 'queue'; simId: number; action: Omit<QueuedAction, 'uid'> }
  | { t: 'cancel'; simId: number; uid: number }
  | { t: 'speed'; speed: 0 | 1 | 2 | 3 }
  | { t: 'householdOuting'; id: string }
  | { t: 'joinCareer'; simId: number; careerId: string }
  | { t: 'quitCareer'; simId: number }
  | { t: 'planParty'; simId: number; theme: Party['theme']; start: number; guests: number[] }
  | { t: 'endParty' }
  | { t: 'clothes'; simId: number; appearance: Appearance; cost: number }
  | { t: 'rewardTrait'; simId: number; traitId: string }
  | { t: 'rewardObject'; simId: number; defId: string }
  | { t: 'invite'; simId: number }
  | { t: 'goodbye'; simId: number }
  | { t: 'payBills' }
  | { t: 'adopt'; species: string; name: string; color: string }
  | { t: 'rehome'; petId: number }
  | { t: 'subscribe'; id: SubscriptionId; on: boolean }
  | { t: 'fix'; objectId: number }
  | { t: 'buy'; defId: string; x: number; z: number; rot: 0 | 1 | 2 | 3 }
  | { t: 'move'; id: number; x: number; z: number; rot: 0 | 1 | 2 | 3 }
  | { t: 'rotate'; id: number }
  | { t: 'sell'; id: number }
  | { t: 'walls'; keys: string[] }
  | { t: 'eraseWalls'; keys: string[] }
  | { t: 'wallKind'; key: string; kind: WallKind }
  | { t: 'paintFloor'; x0: number; z0: number; x1: number; z1: number; floor: string | null }
  | { t: 'paintWall'; key: string; side: 0 | 1; paint: string; wholeRoom: boolean }
  | { t: 'approve'; id: number; yes: boolean; pin?: string }
  | { t: 'text'; simId: number; to: number; kind: TextKind }
  | { t: 'call'; simId: number; to: number }
  | { t: 'answerCall'; simId: number; yes: boolean }
  | { t: 'offer'; simId: number; msgId: number; yes: boolean }
  | { t: 'readPhone'; simId: number }
  | { t: 'order'; item: string }
  | { t: 'vet'; petId: number }
  | { t: 'steer'; simId: number; dx: number; dz: number }
  | { t: 'relaxed'; on: boolean };

/** Money a command costs, checked against the player's allowance in family mode. */
export interface Spend { amount: number; what: string; household?: boolean }

export interface CmdResult {
  ok: boolean;
  why?: string;
  toast?: { text: string; icon: string };
  sound?: string;
  /** A money manager has to say yes first. */
  approval?: { reason: 'needsApproval' | 'managerOnly'; left: number };
  /** Waiting for a money manager on another device (approval id). */
  pending?: number;
  /** Id of something the command created (a bought object). */
  id?: number;
}

export interface RunOptions {
  /** The player giving the command (family mode). Defaults to the active player. */
  playerId?: number | null;
  spend?: Spend;
  /** A money manager already said yes. */
  approved?: boolean;
}

const OK: CmdResult = { ok: true };
const fail = (why?: string): CmdResult => ({ ok: false, why });
const first = (name: string) => name.split(' ')[0];

/** Run a command as a given player. */
export function runCommand(game: Game, cmd: Cmd, opts: RunOptions = {}): CmdResult {
  const fam = game.state.family;
  const before = fam?.activeId;
  if (fam && opts.playerId) fam.activeId = opts.playerId;
  try {
    const sp = opts.spend;
    if (sp && !opts.approved) {
      const chk = checkSpend(game.state, sp.amount, sp.household);
      if (!chk.ok) return { ok: false, approval: { reason: chk.reason, left: chk.left } };
    }
    const res = exec(game, cmd);
    if (res.ok && sp && !opts.approved) recordSpend(game.state, sp.amount);
    return res;
  } finally {
    if (fam && opts.playerId && before !== undefined) fam.activeId = before;
  }
}

/** Ask the money managers (on any device) to approve a command. Returns the request id. */
export function requestApproval(game: Game, cmd: Cmd, spend: Spend, playerId: number | null, reason: 'needsApproval' | 'managerOnly'): number {
  const st = game.state;
  st.approvals ??= [];
  const id = game.nextId();
  st.approvals.push({ id, playerId: playerId ?? 0, what: spend.what, amount: spend.amount, household: !!spend.household, reason, cmd, time: st.time });
  if (st.approvals.length > 12) st.approvals.shift();
  const who = st.family?.players.find((p) => p.id === playerId)?.name ?? 'Someone';
  game.notify(`${who} asked for ${spend.what}${spend.amount ? ` (£${spend.amount})` : ''}. A money manager needs to say yes.`, '📨', 'info');
  return id;
}

function exec(game: Game, cmd: Cmd): CmdResult {
  const st = game.state;
  const simOf = (id: number) => game.sim(id);
  switch (cmd.t) {
    case 'queue': {
      const sim = simOf(cmd.simId);
      if (!sim) return fail();
      if (!canControl(st, sim)) return fail(`${first(sim.name)} is ${ownerOf(st, sim.id)?.name}'s Sim.`);
      if (sim.location !== 'lot') return fail(`${sim.name} isn't home right now.`);
      const uid = enqueue(game, sim, { ...cmd.action, userQueued: true });
      if (uid < 0) return fail('The action queue is full.');
      return { ok: true, sound: 'tap' };
    }
    case 'cancel': {
      const sim = simOf(cmd.simId);
      if (!sim) return fail();
      if (!canControl(st, sim)) return fail(`${first(sim.name)} is ${ownerOf(st, sim.id)?.name}'s Sim.`);
      cancelAction(game, sim, cmd.uid);
      return OK;
    }
    case 'speed':
      st.speed = cmd.speed;
      return OK;
    case 'householdOuting':
      householdOuting(game, cmd.id);
      return OK;
    case 'joinCareer': {
      const sim = simOf(cmd.simId);
      return sim && joinCareer(game, sim, cmd.careerId) ? OK : fail();
    }
    case 'quitCareer': {
      const sim = simOf(cmd.simId);
      if (sim) quitCareer(game, sim);
      return OK;
    }
    case 'planParty': {
      const sim = simOf(cmd.simId);
      if (!sim) return fail();
      const r = planParty(game, sim, cmd.theme, cmd.start, cmd.guests);
      return r.ok ? OK : fail(r.why ?? 'Could not plan the party.');
    }
    case 'endParty':
      endParty(game, false);
      return OK;
    case 'clothes': {
      const sim = simOf(cmd.simId);
      if (!sim) return fail();
      if (cmd.cost > st.household.funds) return fail("You can't afford all that.");
      sim.appearance = { ...cmd.appearance };
      if (cmd.cost <= 0) return OK;
      game.addFunds(-cmd.cost);
      addMoodlet(sim, 'new_clothes', st.time);
      return { ok: true, toast: { text: `New outfit for £${cmd.cost}!`, icon: '🛍️' }, sound: 'cash' };
    }
    case 'rewardTrait': {
      const sim = simOf(cmd.simId);
      const t = REWARD_TRAITS[cmd.traitId];
      if (!sim || !t || sim.perks.includes(t.id)) return fail();
      if (sim.rewardPoints < (t.cost ?? 0)) return fail('Not enough reward points');
      sim.rewardPoints -= t.cost ?? 0;
      sim.perks.push(t.id);
      return { ok: true, sound: 'levelup' };
    }
    case 'rewardObject': {
      const r = unlockRewardObject(game, cmd.simId, cmd.defId);
      return r.ok ? OK : fail(r.reason);
    }
    case 'invite': {
      const t = simOf(cmd.simId);
      if (!t || t.location === 'lot' || st.pendingVisits.some((v) => v.simId === t.id)) return fail();
      st.pendingVisits.push({ simId: t.id, at: st.time + 20 + Math.random() * 30 });
      return { ok: true, toast: { text: `${t.name} is on their way over.`, icon: '📱' } };
    }
    case 'goodbye': {
      const t = simOf(cmd.simId);
      if (t?.isTownie) t.visitUntil = st.time;
      return OK;
    }
    case 'payBills':
      return payBills(game) ? OK : fail('There are no bills to pay.');
    case 'adopt': {
      const r = adoptPet(game, cmd.species, cmd.name.slice(0, 18) || 'Pet', cmd.color);
      return r.ok ? OK : fail(r.why ?? "Couldn't adopt");
    }
    case 'rehome':
      rehomePet(game, cmd.petId);
      return OK;
    case 'subscribe': {
      const sub = SUBSCRIPTIONS[cmd.id];
      if (!sub) return fail();
      st.household.subscriptions[cmd.id] = cmd.on;
      return { ok: true, toast: { text: cmd.on ? `Subscribed to ${sub.name}! Added to your weekly bills.` : `${sub.name} cancelled.`, icon: sub.icon } };
    }
    case 'fix': {
      const o = game.object(cmd.objectId);
      if (!o?.broken) return fail();
      const isBoiler = o.defId === 'boiler';
      const cost = isBoiler ? ENGINEER_COST : PLUMBER_COST;
      if (st.household.funds < cost) return fail(`That costs £${cost}.`);
      o.broken = false;
      if (isBoiler) o.growth = game.day;
      game.addFunds(-cost);
      game.lotChanged();
      return { ok: true, sound: 'cash', toast: { text: isBoiler ? `Engineer fixed the boiler (£${cost}).` : `Plumber fixed the blockage (£${cost}).`, icon: '🔧' } };
    }
    case 'buy': {
      const r = buyObject(game, cmd.defId, cmd.x, cmd.z, cmd.rot);
      return r.ok ? { ok: true, id: r.id } : fail(r.reason ?? "Can't place that there.");
    }
    case 'move': {
      const r = moveObject(game, cmd.id, cmd.x, cmd.z, cmd.rot);
      return r.ok ? OK : fail(r.reason ?? "Can't place that there.");
    }
    case 'rotate': {
      const obj = game.object(cmd.id);
      if (!obj) return fail();
      for (let i = 1; i <= 3; i++) {
        if (moveObject(game, obj.id, obj.x, obj.z, ((obj.rot + i) % 4) as 0 | 1 | 2 | 3).ok) return OK;
      }
      return fail("There's no room to turn it.");
    }
    case 'sell': {
      const r = sellObject(game, cmd.id);
      return r.ok ? OK : fail(r.reason);
    }
    case 'walls': { const r = placeWalls(game, cmd.keys); return r.ok ? OK : fail(r.reason); }
    case 'eraseWalls': { const r = eraseWalls(game, cmd.keys); return r.ok ? OK : fail(r.reason); }
    case 'wallKind': { const r = setWallKind(game, cmd.key, cmd.kind); return r.ok ? OK : fail(r.reason); }
    case 'paintFloor': { const r = paintFloor(game, cmd.x0, cmd.z0, cmd.x1, cmd.z1, cmd.floor); return r.ok ? OK : fail(r.reason); }
    case 'paintWall': { const r = paintWall(game, cmd.key, cmd.side, cmd.paint, cmd.wholeRoom); return r.ok ? OK : fail(r.reason); }
    case 'approve': return answerApproval(game, cmd.id, cmd.yes, cmd.pin);
    case 'text':
    case 'call': {
      const sim = simOf(cmd.simId);
      if (!sim) return fail();
      if (!canControl(st, sim)) return fail(`${first(sim.name)} is ${ownerOf(st, sim.id)?.name}'s Sim.`);
      const r = cmd.t === 'text' ? sendText(game, sim, cmd.to, cmd.kind) : startCall(game, sim, cmd.to);
      return r.ok ? { ok: true, sound: 'tap' } : fail(r.why);
    }
    case 'answerCall': {
      const sim = simOf(cmd.simId);
      if (!sim) return fail();
      const r = answerCall(game, sim, cmd.yes);
      return r.ok ? OK : fail(r.why);
    }
    case 'offer': {
      const sim = simOf(cmd.simId);
      if (!sim) return fail();
      if (!canControl(st, sim)) return fail(`${first(sim.name)} is ${ownerOf(st, sim.id)?.name}'s Sim.`);
      const r = answerOffer(game, sim, cmd.msgId, cmd.yes);
      return r.ok ? OK : fail(r.why);
    }
    case 'readPhone': {
      const sim = simOf(cmd.simId);
      if (sim) markRead(sim);
      return OK;
    }
    case 'order': {
      const r = order(game, cmd.item);
      return r.ok ? { ok: true, toast: { text: `Ordered: ${SHOP_ITEMS[cmd.item]?.name}. It'll arrive in ${SHOP_ITEMS[cmd.item]?.hours} hours.`, icon: '📦' } } : fail(r.why);
    }
    case 'steer': {
      const sim = simOf(cmd.simId);
      if (!sim || !game.present(sim)) return fail();
      if (!canControl(st, sim)) return fail(`${first(sim.name)} is ${ownerOf(st, sim.id)?.name}'s Sim.`);
      setSteer(game, sim, Number(cmd.dx) || 0, Number(cmd.dz) || 0);
      return OK;
    }
    case 'relaxed':
      st.settings.relaxed = !!cmd.on;
      return OK;
    case 'vet': {
      const r = vetVisit(game, cmd.petId);
      return r.ok ? OK : fail(r.why);
    }
  }
}

/** A money manager (or someone who knows a manager's PIN) answers a request. */
function answerApproval(game: Game, id: number, yes: boolean, pin?: string): CmdResult {
  const st = game.state;
  const req = st.approvals?.find((a) => a.id === id);
  if (!req) return fail('That request has already been answered.');
  const me = activePlayer(st);
  const mgrs = managers(st);
  const isRequester = me?.id === req.playerId;
  const byPin = !!pin && mgrs.some((m) => m.pin && m.pin === pin);
  const allowed = me?.role === 'manager' || byPin || !mgrs.length;
  // The person who asked can always withdraw their own request.
  if (!yes && !allowed && !isRequester) return fail('Only a money manager can answer that.');
  if (yes && !allowed) return fail(pin ? "That PIN isn't right." : 'Only a money manager can say yes.');
  st.approvals = st.approvals!.filter((a) => a.id !== id);
  const who = st.family?.players.find((p) => p.id === req.playerId)?.name ?? 'Someone';
  const by = byPin ? mgrs.find((m) => m.pin === pin)?.name : me?.name;
  if (!yes) {
    game.notify(isRequester && !allowed ? `${who} changed their mind about ${req.what}.` : `${by ?? 'The money manager'} said no to ${req.what} for ${who}.`, '🙅', 'info');
    return OK;
  }
  const res = runCommand(game, req.cmd, { playerId: req.playerId || null, approved: true });
  if (res.ok) game.notify(`${by ?? 'The money manager'} said yes: ${req.what} for ${who}.`, '👍', 'good');
  else game.notify(`${by ?? 'The money manager'} said yes to ${req.what}, but it didn't work out${res.why ? `: ${res.why}` : ''}.`, '🤷', 'info');
  return res;
}
