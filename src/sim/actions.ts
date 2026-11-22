// Actions run as small state machines: route → walk → perform → finish (or get interrupted).
import { ALL_TRAITS, OBJECTS, OUTINGS, SELF_ACTIONS, SOCIALS, interaction, type Effects, type InteractionDef, type SpotDef } from './defs';
import type { Game } from './game';
import { objectCenter, spotApproaches, spotWorld, type SpotWorld } from './lot';
import { addMoodlet, clamp, moodFactor } from './mood';
import { findPath, pathLength } from './path';
import { chance, random } from './rng';
import { levelOf, skillRateMult, SKILL_NAMES, skillLevel } from './skills';
import { chooseAutonomous } from './ai';
import { resolveSocial, socialCheck } from './social';
import { arriveAtWork, skipWork } from './schedule';
import { changeRel, findRel } from './relationships';
import { canDriveNow, hasFood, openPresent, useFood } from './life';
import type { NeedId, PlacedObject, Point, QueuedAction, RunningAction, Sim, SkillId } from './types';

export const WALK_SPEED = 1.7; // tiles per game minute
/** Global skill speed. Lower means skills take longer to master. */
export const SKILL_SPEED = 0.6;

// ---------- Queue management ----------

export function enqueue(game: Game, sim: Sim, action: Omit<QueuedAction, 'uid'>, front = false): number {
  const q: QueuedAction = { ...action, uid: game.nextId() };
  if (front) sim.queue.unshift(q);
  else {
    if (sim.queue.length >= 8) return -1;
    sim.queue.push(q);
  }
  return q.uid;
}

export function cancelAction(game: Game, sim: Sim, uid: number): void {
  const target = sim.current?.uid === uid ? sim.current : sim.queue.find((q) => q.uid === uid);
  if (!target) return;
  if (target.kind === 'leave') return; // visitors always go home
  if (target.kind === 'work') skipWork(game, sim);
  if (sim.current?.uid === uid) interrupt(game, sim);
  else sim.queue = sim.queue.filter((q) => q.uid !== uid);
}

/** Stop the current action, release furniture and stand the Sim up. */
export function interrupt(game: Game, sim: Sim): void {
  const cur = sim.current;
  if (!cur) return;
  releaseReservation(game, sim);
  standUp(sim);
  sim.current = null;
  sim.anim = 'idle';
}

/** Interrupt and optionally drop autonomous queued actions too. */
export function releaseAll(game: Game, sim: Sim, keepUserQueue: boolean): void {
  interrupt(game, sim);
  if (keepUserQueue) sim.queue = sim.queue.filter((q) => q.userQueued);
  else sim.queue = [];
}

function releaseReservation(game: Game, sim: Sim): void {
  const res = sim.current?.reserved;
  if (!res) return;
  const obj = game.object(res.objectId);
  if (obj && obj.users[res.spot] === sim.id) obj.users[res.spot] = null;
}

function standUp(sim: Sim): void {
  const cur = sim.current;
  if (cur?.returnTo && sim.poseObjectId !== null) {
    sim.pos = { ...cur.returnTo };
  }
  sim.poseObjectId = null;
}

// ---------- Availability ----------

export interface Availability { ok: boolean; hidden?: boolean; reason?: string }

export function checkInteraction(game: Game, sim: Sim, obj: PlacedObject, inter: InteractionDef): Availability {
  const visitor = !game.isHousehold(sim);
  if (visitor && !inter.visitor) return { ok: false, hidden: true };
  switch (inter.condition) {
    case 'dirty': if (obj.dirt < 30) return { ok: false, hidden: true }; break;
    case 'grown': if (obj.growth < 100) return { ok: false, hidden: true }; break;
    case 'growing': if (obj.growth <= 0 || obj.growth >= 100) return { ok: false, hidden: true }; break;
    case 'empty': if (obj.growth > 0) return { ok: false, hidden: true }; break;
    case 'bills': if (!game.state.bills) return { ok: false, hidden: true }; break;
    case 'lightOn': if (!obj.lightOn) return { ok: false, hidden: true }; break;
    case 'lightOff': if (obj.lightOn) return { ok: false, hidden: true }; break;
    case 'night': if (!game.isNight()) return { ok: false, reason: 'Only at night' }; break;
    case 'once': if (sim.counters[onceKey(obj, inter)]) return { ok: false, hidden: true }; break;
    case 'nightOnce':
      if (sim.counters[onceKey(obj, inter)]) return { ok: false, hidden: true };
      if (!game.isNight()) return { ok: false, reason: 'Wait until dark' };
      break;
    case 'uncarved': if (obj.growth >= 100) return { ok: false, hidden: true }; break;
    case 'carved': if (obj.growth < 100) return { ok: false, hidden: true }; break;
    case 'canDrive':
      if (!sim.driving.licence) return { ok: false, reason: 'Needs a driving licence' };
      if (!canDriveNow(game, sim)) return { ok: false, reason: 'The car is out' };
      break;
  }
  if (inter.food && !hasFood(game, inter.food)) return { ok: false, reason: 'No food left. Go food shopping!' };
  if (inter.minSkill && levelOf(sim, inter.minSkill.skill) < inter.minSkill.level) {
    return { ok: false, reason: `Needs ${SKILL_NAMES[inter.minSkill.skill].name} ${inter.minSkill.level}` };
  }
  const def = OBJECTS[obj.defId];
  if (!inter.shared && !inter.seatNear && def.spots.length && !def.spots.some((_, i) => obj.users[i] === null || obj.users[i] === sim.id)) {
    return { ok: false, reason: 'In use' };
  }
  return { ok: true };
}

// ---------- Effects ----------

function traitExtraEffects(sim: Sim, tags: string[] | undefined): Effects {
  const out: Effects = {};
  if (!tags) return out;
  for (const id of [...sim.traits, ...sim.perks]) {
    const t = ALL_TRAITS[id];
    if (!t?.tagEffects) continue;
    for (const tag of tags) {
      const extra = t.tagEffects[tag];
      if (!extra) continue;
      for (const k in extra) out[k as NeedId] = (out[k as NeedId] ?? 0) + extra[k as NeedId]!;
    }
  }
  return out;
}

export function totalEffects(sim: Sim, base: Effects | undefined, tags: string[] | undefined): Effects {
  const out: Effects = { ...(base ?? {}) };
  const extra = traitExtraEffects(sim, tags);
  for (const k in extra) out[k as NeedId] = (out[k as NeedId] ?? 0) + extra[k as NeedId]!;
  return out;
}

function toRates(effects: Effects, duration: number): Partial<Record<NeedId, number>> {
  const rates: Partial<Record<NeedId, number>> = {};
  for (const k in effects) rates[k as NeedId] = effects[k as NeedId]! / Math.max(1, duration);
  return rates;
}

// ---------- Seats ----------

export interface SeatChoice { obj: PlacedObject; spot: number; world: SpotWorld; path: Point[] }

export function findSeat(game: Game, sim: Sim, near: Point, maxDist: number, faceTowards?: Point, preferDining = false): SeatChoice | null {
  let best: SeatChoice | null = null;
  let bestScore = Infinity;
  for (const obj of game.state.lot.objects) {
    const def = OBJECTS[obj.defId];
    if (!def.seat) continue;
    def.spots.forEach((spot, i) => {
      if (obj.users[i] !== null && obj.users[i] !== sim.id) return;
      const world = spotWorld(obj, spot);
      if (!world.pose) return;
      const d = Math.hypot(world.pose.x - near.x, world.pose.z - near.z);
      if (d > maxDist) return;
      if (faceTowards) {
        const dx = faceTowards.x - world.pose.x, dz = faceTowards.z - world.pose.z;
        const len = Math.hypot(dx, dz) || 1;
        const dot = (Math.sin(world.facing) * dx + Math.cos(world.facing) * dz) / len;
        if (dot < 0.55) return;
      }
      let score = d + Math.hypot(world.pose.x - sim.pos.x, world.pose.z - sim.pos.z) * 0.3;
      if (preferDining && def.dining) score -= 4;
      if (score >= bestScore) return;
      const route = routeToSpot(game, sim, obj, spot);
      if (!route) return;
      bestScore = score;
      best = { obj, spot: i, world: route.world, path: route.path };
    });
  }
  return best;
}

/** Shortest route to any of a spot's approach tiles. */
export function routeToSpot(game: Game, sim: Sim, obj: PlacedObject, spot: SpotDef): { path: Point[]; world: SpotWorld; len: number } | null {
  const grid = game.grid();
  let best: { path: Point[]; world: SpotWorld; len: number } | null = null;
  spotApproaches(obj, spot).forEach((_, a) => {
    const world = spotWorld(obj, spot, a);
    const path = findPath(grid, sim.pos, world.tile);
    if (!path) return;
    const len = pathLength(sim.pos, path);
    if (!best || len < best.len) best = { path, world, len };
  });
  return best;
}

// ---------- Starting actions ----------

function fail(game: Game, sim: Sim, icon: string, why: string, q: QueuedAction): void {
  game.think(sim, icon, 15);
  if (q.userQueued && game.isHousehold(sim)) game.notify(`${sim.name}: ${why}`, icon, 'info');
  if (q.objectId !== undefined) game.unreachable.set(`${sim.id}:${q.objectId}`, game.state.time + 60);
}

function baseRunning(q: QueuedAction): RunningAction {
  return { ...q, phase: 'route', path: [], pathIndex: 0, elapsed: 0, duration: 10, rates: {}, anim: 'idle', untilFull: [], waitTime: 0 };
}

function startAction(game: Game, sim: Sim, q: QueuedAction): RunningAction | null {
  const r = baseRunning(q);
  const grid = game.grid();
  switch (q.kind) {
    case 'object': {
      const obj = game.object(q.objectId!);
      const inter = obj && interaction(obj.defId, q.interactionId!);
      if (!obj || !inter) return null;
      const avail = checkInteraction(game, sim, obj, inter);
      if (!avail.ok) { fail(game, sim, '🚫', avail.reason ?? "can't do that now", q); return null; }
      const def = OBJECTS[obj.defId];
      const effects = totalEffects(sim, inter.effects, inter.tags);
      r.duration = inter.duration;
      r.rates = toRates(effects, inter.duration);
      r.anim = inter.anim;
      r.untilFull = inter.untilFull ? (Object.keys(effects).filter((k) => effects[k as NeedId]! > 0) as NeedId[]) : [];
      r.skill = inter.skill;
      r.skillRate = inter.skillRate;
      r.tags = inter.tags;
      if (inter.seatNear) {
        const centre = objectCenter(obj);
        const faceTv = inter.tags?.includes('tv') ? centre : undefined;
        const seat = findSeat(game, sim, centre, faceTv ? 7 : 8, faceTv);
        if (seat) {
          r.reserved = { objectId: seat.obj.id, spot: seat.spot };
          seat.obj.users[seat.spot] = sim.id;
          r.path = seat.path;
          r.pose = { x: seat.world.pose!.x, z: seat.world.pose!.z, facing: seat.world.facing, objectId: seat.obj.id };
          return r;
        }
      }
      if (!def.spots.length) return null;
      // Pick the free spot with the shortest path.
      let best: { i: number; path: Point[]; world: SpotWorld; len: number } | null = null;
      def.spots.forEach((spot, i) => {
        if (!inter.shared && obj.users[i] !== null && obj.users[i] !== sim.id) return;
        const route = routeToSpot(game, sim, obj, spot);
        if (!route) return;
        if (!best || route.len < best.len) best = { i, path: route.path, world: route.world, len: route.len };
      });
      if (!best) { fail(game, sim, '❓', `can't reach the ${def.name}`, q); return null; }
      const b = best as { i: number; path: Point[]; world: SpotWorld; len: number };
      if (!inter.shared) {
        obj.users[b.i] = sim.id;
        r.reserved = { objectId: obj.id, spot: b.i };
      }
      r.path = b.path;
      if (b.world.pose && !inter.poseless) {
        r.pose = { x: b.world.pose.x, z: b.world.pose.z, facing: b.world.facing, objectId: obj.id };
      } else {
        r.pose = { x: b.world.tile.x + 0.5, z: b.world.tile.z + 0.5, facing: b.world.facing };
      }
      return r;
    }
    case 'seat': {
      const inline = q.inline!;
      const effects = totalEffects(sim, inline.effects, inline.tags);
      r.duration = inline.duration;
      r.rates = toRates(effects, inline.duration);
      r.anim = inline.anim;
      const seat = findSeat(game, sim, sim.pos, 12, undefined, true);
      if (seat) {
        r.reserved = { objectId: seat.obj.id, spot: seat.spot };
        seat.obj.users[seat.spot] = sim.id;
        r.path = seat.path;
        r.pose = { x: seat.world.pose!.x, z: seat.world.pose!.z, facing: seat.world.facing, objectId: seat.obj.id };
      }
      return r;
    }
    case 'self': {
      const def = q.selfId ? SELF_ACTIONS[q.selfId] : undefined;
      const inline = q.inline;
      const effects = totalEffects(sim, inline?.effects ?? def?.effects, inline?.tags ?? def?.tags);
      r.duration = inline?.duration ?? def?.duration ?? 10;
      r.rates = toRates(effects, r.duration);
      r.anim = inline?.anim ?? def?.anim ?? 'idle';
      r.skill = def?.skill;
      r.skillRate = def?.skillRate;
      if (def?.cost && game.state.household.funds < def.cost) { fail(game, sim, '💸', `can't afford that (£${def.cost})`, q); return null; }
      if (r.anim === 'sleep') r.untilFull = ['energy'];
      return r;
    }
    case 'goto': {
      const path = findPath(grid, sim.pos, q.dest!);
      if (!path) { fail(game, sim, '❓', "can't get there", q); return null; }
      r.path = path;
      r.duration = 0;
      return r;
    }
    case 'social': {
      const target = game.sim(q.targetSimId!);
      const social = SOCIALS[q.socialId!];
      if (!target || target.location !== 'lot' || !social) return null;
      const check = socialCheck(game, sim, target, social);
      if (!check.ok) { fail(game, sim, '🚫', check.reason ?? 'not now', q); return null; }
      const path = pathNextTo(game, sim, target.pos);
      if (!path) { fail(game, sim, '❓', `can't reach ${target.name}`, q); return null; }
      r.path = path;
      r.duration = social.duration;
      r.anim = social.anim ?? 'talk';
      const gain = socialGainMult(sim);
      r.rates = toRates({ social: social.social * gain, fun: social.fun ?? 0 }, social.duration);
      return r;
    }
    case 'respond': {
      const inline = q.inline!;
      r.duration = inline.duration;
      r.anim = inline.anim;
      r.rates = toRates(totalEffects(sim, inline.effects, inline.tags), inline.duration);
      return r;
    }
    case 'work':
    case 'outing':
    case 'leave': {
      if (q.kind === 'outing') {
        const o = OUTINGS[q.selfId!];
        if (o?.cost && game.state.household.funds < o.cost) { fail(game, sim, '💸', `can't afford ${o.name}`, q); return null; }
      }
      const path = findPath(grid, sim.pos, game.exitTile()) ?? [];
      r.path = path;
      r.duration = 0;
      r.anim = 'walk';
      return r;
    }
  }
  return null;
}

export function socialGainMult(sim: Sim): number {
  let m = 1;
  for (const t of sim.traits) m *= ALL_TRAITS[t]?.socialGain ?? 1;
  return m;
}

/** Path to a free tile next to a point (for chatting). */
export function pathNextTo(game: Game, sim: Sim, p: Point): Point[] | null {
  const grid = game.grid();
  const tx = Math.floor(p.x), tz = Math.floor(p.z);
  const sx = Math.floor(sim.pos.x), sz = Math.floor(sim.pos.z);
  if (Math.abs(sx - tx) <= 1 && Math.abs(sz - tz) <= 1 && (sx !== tx || sz !== tz)) return [];
  let best: Point[] | null = null;
  let bestLen = Infinity;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const path = findPath(grid, sim.pos, { x: tx + dx, z: tz + dz });
    if (!path) continue;
    const len = pathLength(sim.pos, path);
    if (len < bestLen) { best = path; bestLen = len; }
  }
  return best;
}

// ---------- Per-minute update ----------

export function stepSim(game: Game, sim: Sim, dt: number): void {
  // A player-queued action interrupts an autonomous one.
  if (sim.current && !sim.current.userQueued && sim.queue.some((q) => q.userQueued)) interrupt(game, sim);

  if (!sim.current) {
    while (sim.queue.length && !sim.current) {
      const q = sim.queue.shift()!;
      sim.current = startAction(game, sim, q);
    }
    if (!sim.current) {
      sim.anim = 'idle';
      sim.thinkCooldown -= dt;
      if (sim.thinkCooldown <= 0) {
        sim.thinkCooldown = 2 + random(game.state) * 3;
        const choice = chooseAutonomous(game, sim);
        if (choice) enqueue(game, sim, choice);
      }
      return;
    }
  }
  const cur = sim.current!;
  if (cur.phase === 'route') cur.phase = 'walk';
  if (cur.phase === 'walk') {
    walk(game, sim, cur, dt);
    return;
  }
  perform(game, sim, cur, dt);
}

function walk(game: Game, sim: Sim, cur: RunningAction, dt: number): void {
  let budget = WALK_SPEED * dt;
  sim.anim = 'walk';
  while (budget > 0 && cur.pathIndex < cur.path.length) {
    const t = cur.path[cur.pathIndex];
    const tx = t.x + 0.5, tz = t.z + 0.5;
    const dx = tx - sim.pos.x, dz = tz - sim.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-4) sim.facing = Math.atan2(dx, dz);
    if (dist <= budget) {
      sim.pos = { x: tx, z: tz };
      budget -= dist;
      cur.pathIndex++;
    } else {
      sim.pos = { x: sim.pos.x + (dx / dist) * budget, z: sim.pos.z + (dz / dist) * budget };
      budget = 0;
    }
  }
  if (cur.pathIndex < cur.path.length) return;
  arrive(game, sim, cur);
}

function arrive(game: Game, sim: Sim, cur: RunningAction): void {
  switch (cur.kind) {
    case 'goto':
      finish(game, sim, true);
      return;
    case 'work':
    case 'outing':
    case 'leave':
      sim.current = null;
      sim.anim = 'idle';
      arriveAtWork(game, sim, cur);
      return;
    case 'social': {
      const target = game.sim(cur.targetSimId!);
      if (!target || target.location !== 'lot') { finish(game, sim, false); return; }
      const d = Math.hypot(target.pos.x - sim.pos.x, target.pos.z - sim.pos.z);
      if (d > 2.4) {
        cur.waitTime++;
        const path = cur.waitTime < 4 ? pathNextTo(game, sim, target.pos) : null;
        if (!path) { finish(game, sim, false); return; }
        cur.path = path;
        cur.pathIndex = 0;
        return;
      }
      // Ask the other Sim to join in.
      const busy = target.current && (target.current.userQueued || target.current.anim === 'sleep' || target.current.kind === 'social' || target.current.kind === 'respond');
      if (busy && target.current?.targetSimId !== sim.id) {
        game.think(sim, '⏳', 10);
        finish(game, sim, false);
        return;
      }
      if (target.current && target.current.kind !== 'social') interrupt(game, target);
      const social = SOCIALS[cur.socialId!];
      target.queue.unshift({
        uid: game.nextId(), kind: 'respond', label: `Chatting with ${sim.name}`, icon: social.icon, userQueued: false,
        targetSimId: sim.id,
        inline: { anim: social.anim ?? 'talk', duration: social.duration, effects: { social: social.social * socialGainMult(target), fun: social.fun ?? 0 } },
      });
      const facing = Math.atan2(target.pos.x - sim.pos.x, target.pos.z - sim.pos.z);
      sim.facing = facing;
      cur.phase = 'perform';
      sim.anim = cur.anim;
      return;
    }
    default:
      break;
  }
  if (cur.pose) {
    if (cur.pose.objectId !== undefined) {
      cur.returnTo = { x: Math.floor(sim.pos.x) + 0.5, z: Math.floor(sim.pos.z) + 0.5 };
      sim.poseObjectId = cur.pose.objectId;
    }
    sim.pos = { x: cur.pose.x, z: cur.pose.z };
    sim.facing = cur.pose.facing;
  }
  cur.phase = 'perform';
  sim.anim = cur.anim;
}

function perform(game: Game, sim: Sim, cur: RunningAction, dt: number): void {
  sim.anim = cur.anim;
  if (cur.kind === 'respond') {
    const other = game.sim(cur.targetSimId!);
    if (other) sim.facing = Math.atan2(other.pos.x - sim.pos.x, other.pos.z - sim.pos.z);
  }
  cur.elapsed += dt;
  for (const k in cur.rates) {
    const n = k as NeedId;
    sim.needs[n] = clamp(sim.needs[n] + cur.rates[n]! * dt, 0, 100);
  }
  if (cur.skill && cur.skillRate && game.isHousehold(sim)) gainSkill(game, sim, cur.skill as SkillId, (cur.skillRate / 60) * dt * moodFactor(sim));

  const full = cur.untilFull.length > 0 && cur.elapsed > 3 && cur.untilFull.every((n) => sim.needs[n] >= 99.5);
  // Sleepers wake up for an urgent bladder or hunger.
  const urgent = cur.anim === 'sleep' && (sim.needs.bladder < 12 || sim.needs.hunger < 8);
  if (full || cur.elapsed >= cur.duration || urgent) finish(game, sim, true);
}

export function gainSkill(game: Game, sim: Sim, skill: SkillId, xp: number): void {
  const before = skillLevel(sim.skills[skill]);
  sim.skills[skill] = Math.min(2200, sim.skills[skill] + xp * SKILL_SPEED * skillRateMult(sim, skill));
  const after = skillLevel(sim.skills[skill]);
  if (after > before) {
    addMoodlet(sim, 'skill_up', game.state.time);
    game.notify(`${sim.name} reached ${SKILL_NAMES[skill].name} level ${after}!`, SKILL_NAMES[skill].icon, 'good');
    game.sound('levelup');
  }
}

/** Complete (or abandon) the current action. */
function finish(game: Game, sim: Sim, completed: boolean): void {
  const cur = sim.current!;
  releaseReservation(game, sim);
  standUp(sim);
  sim.current = null;
  sim.anim = 'idle';
  if (!completed) return;
  const key = activityKey(cur);
  if (key) {
    sim.recent.push(key);
    if (sim.recent.length > 6) sim.recent.shift();
  }
  const now = game.state.time;
  if (cur.kind === 'object') {
    const obj = game.object(cur.objectId!);
    const inter = obj && interaction(obj.defId, cur.interactionId!);
    if (obj && inter) completeInteraction(game, sim, obj, inter, cur);
  } else if (cur.kind === 'seat' || cur.kind === 'self') {
    const inline = cur.inline;
    if (inline?.moodlet) addMoodlet(sim, inline.moodlet, now);
    if (inline?.counter) sim.counters[inline.counter] = (sim.counters[inline.counter] ?? 0) + 1;
    const def = cur.selfId ? SELF_ACTIONS[cur.selfId] : undefined;
    if (def?.special === 'callFriend') callFriend(game, sim);
    if (def?.special === 'takeaway') {
      game.addFunds(-(def.cost ?? 0));
      game.notify(`${sim.name}'s takeaway has arrived.`, '🍕', 'info');
      sim.queue.unshift({
        uid: game.nextId(), kind: 'seat', label: 'Eat takeaway', icon: '🍕', userQueued: cur.userQueued,
        inline: { anim: 'eat', duration: 25, effects: { hunger: 75, fun: 10 }, moodlet: 'tasty_snack', tags: ['food'] },
      });
    }
    if (def?.ui) game.events.push({ type: 'openPanel', panel: def.ui, simId: sim.id });
  } else if (cur.kind === 'social') {
    resolveSocial(game, sim, cur);
  }
}

function completeInteraction(game: Game, sim: Sim, obj: PlacedObject, inter: InteractionDef, cur: RunningAction): void {
  const now = game.state.time;
  if (inter.moodlet) addMoodlet(sim, inter.moodlet, now);
  if (inter.counter) sim.counters[inter.counter] = (sim.counters[inter.counter] ?? 0) + 1;
  if (inter.condition === 'once' || inter.condition === 'nightOnce') sim.counters[onceKey(obj, inter)] = 1;
  if (inter.food) useFood(game, inter.food);
  if (inter.dirties && obj.defId !== 'magic_loo') obj.dirt = Math.min(100, obj.dirt + inter.dirties);
  if (inter.cleans) { obj.dirt = 0; game.recomputeRooms(); }
  if (inter.cleansRoom) {
    const room = game.roomOf(objectCenter(obj));
    for (const o of game.state.lot.objects) if (game.roomOf(objectCenter(o)) === room) o.dirt = Math.max(0, o.dirt - 40);
    game.recomputeRooms();
  }
  if (inter.money !== undefined && game.isHousehold(sim)) {
    const lvl = inter.skill ? levelOf(sim, inter.skill) : 1;
    let amount = inter.money + (inter.moneyPerLevel ?? 0) * (lvl - 1);
    if (inter.tags?.includes('making')) for (const t of sim.traits) amount *= ALL_TRAITS[t]?.makingMoney ?? 1;
    amount = Math.round(amount * (0.85 + random(game.state) * 0.3));
    game.addFunds(amount);
    const what = inter.counter === 'paintings' ? 'painting' : inter.counter === 'songs' ? 'song' : inter.counter === 'harvests' ? 'veg at the market' : inter.counter === 'stories' ? 'story' : 'work';
    if (inter.counter === 'paintings') game.state.household.paintingsSold += amount;
    game.notify(`${sim.name} sold their ${what} for £${amount}.`, inter.icon, 'good');
    game.sound('cash');
  }
  switch (inter.special) {
    case 'plant': obj.growth = 1; break;
    case 'tend': {
      let bonus = 12 + levelOf(sim, 'gardening') * 2;
      for (const t of sim.traits) bonus *= ALL_TRAITS[t]?.growthBonus ?? 1;
      obj.growth = Math.min(100, obj.growth + bonus);
      break;
    }
    case 'harvest': obj.growth = 0; break;
    case 'carve': obj.growth = 100; game.lotChanged(); break;
    case 'fireworks': game.state.fireworksUntil = game.state.time + 25; game.sound('fireworks'); break;
    case 'present': if (game.isHousehold(sim)) openPresent(game, sim); break;
    case 'drive':
      sim.queue.unshift({ uid: game.nextId(), kind: 'outing', selfId: 'drive', label: 'Go for a drive', icon: '🚗', userQueued: true });
      break;
    case 'payBills': payBills(game); break;
    case 'lightOn': obj.lightOn = true; game.lotChanged(); break;
    case 'lightOff': obj.lightOn = false; game.lotChanged(); break;
    case 'changeOutfit': {
      const colours = ['#e05a5a', '#4a90d9', '#57b36a', '#f2c14e', '#9b6ad6', '#f08ab0', '#333844', '#f4f1ea', '#e7833a', '#2bb3a6'];
      sim.appearance.topColor = colours[Math.floor(random(game.state) * colours.length)];
      sim.appearance.bottomColor = colours[Math.floor(random(game.state) * colours.length)];
      break;
    }
  }
  if (inter.ui) game.events.push({ type: 'openPanel', panel: inter.ui, simId: sim.id });
  if (inter.then) {
    const t = inter.then;
    const skillOk = t.moodletMinSkill === undefined || (inter.skill ? levelOf(sim, inter.skill) >= t.moodletMinSkill : true);
    sim.queue.unshift({
      uid: game.nextId(), kind: 'seat', label: t.label, icon: inter.icon, userQueued: cur.userQueued,
      inline: { anim: t.anim, duration: t.duration, effects: t.effects, tags: t.tags, moodlet: skillOk ? t.moodlet : 'tasty_snack' },
    });
  }
}

/** Counter key for things each Sim can only do once per object (open presents, hunt eggs). */
export function onceKey(obj: PlacedObject, inter: InteractionDef): string {
  return `once:${obj.id}:${inter.id}`;
}

/** A key for "the same kind of thing" when judging variety. */
export function activityKey(a: Pick<QueuedAction, 'kind' | 'objectId' | 'interactionId' | 'selfId' | 'socialId'>): string | null {
  if (a.kind === 'object') return `o:${a.interactionId}`;
  if (a.kind === 'self') return `s:${a.selfId}`;
  if (a.kind === 'social') return `c:${a.socialId}`;
  return null;
}

export function payBills(game: Game): boolean {
  const bills = game.state.bills;
  if (!bills) return false;
  game.addFunds(-bills.amount);
  game.notify(`Bills paid: £${bills.amount}.`, '🧾', 'info');
  game.sound('cash');
  game.state.bills = null;
  return true;
}

function callFriend(game: Game, sim: Sim): void {
  const st = game.state;
  const others = st.sims.filter((s) => s.id !== sim.id && s.location !== 'lot');
  if (!others.length) return;
  const known = others
    .map((o) => ({ o, rel: findRel(st, sim.id, o.id) }))
    .filter((x) => x.rel?.met)
    .sort((a, b) => b.rel!.friendship - a.rel!.friendship);
  const other = known.length && chance(st, 0.8) ? known[0].o : others[Math.floor(random(st) * others.length)];
  changeRel(st, sim.id, other.id, 3, 0);
  game.think(sim, '📱', 10);
}
