// Things that happen on the clock: work, bills, visitors, lights, aspirations.
import { afterWork } from './clothes';
import { billsText, takeBonus } from './phone';
import { ALL_TRAITS, ASPIRATIONS, CAREERS, OBJECTS, OUTINGS, type AspirationCond, type CareerLevel } from './defs';
import type { Game } from './game';
import { MINUTES_PER_DAY } from './game';
import { addMoodlet, clamp, moodFactor } from './mood';
import { friendCount } from './relationships';
import { chance, pick, randInt, random } from './rng';
import { levelOf, SKILL_NAMES } from './skills';
import { enqueue, gainSkill, interrupt, payBills } from './actions';
import type { RunningAction, Sim, SkillId } from './types';
import { onHour, outingReturn, returnCar, takeCar, worksToday } from './life';
import { billBreakdown } from './home';
import { takeDog } from './pets';
import { resetAllowances } from './family';

export function careerLevel(sim: Sim): CareerLevel | null {
  if (!sim.career) return null;
  return CAREERS[sim.career.id]?.levels[sim.career.level] ?? null;
}

export function workToday(game: Game, sim: Sim): boolean {
  return worksToday(game, sim);
}

export function runSchedules(game: Game, dt: number): void {
  const now = game.state.time;
  const minute = game.minuteOfDay;
  const hour = game.hour;

  for (const sim of game.household()) {
    // Coming home from work or an outing.
    if ((sim.location === 'work' || sim.location === 'away') && now >= sim.awayUntil) returnHome(game, sim);
    if (!sim.career || (sim.location !== 'lot' && sim.location !== 'town')) continue;
    const lvl = careerLevel(sim)!;
    if (!worksToday(game, sim) || sim.career.workedToday) continue;
    const start = lvl.start * 60;
    const busyWithWork = sim.current?.kind === 'work' || sim.queue.some((q) => q.kind === 'work');
    if (minute >= start - 40 && minute < start + 30 && !busyWithWork) {
      if (sim.current && !(sim.current.kind === 'work')) interrupt(game, sim);
      enqueue(game, sim, { kind: 'work', label: 'Go to work', icon: CAREERS[sim.career.id].icon, userQueued: true }, true);
      if (minute < start - 38) game.notify(`${sim.name} is off to work as a ${lvl.title}.`, '🚌', 'info');
    } else if (minute >= start + 30 && !busyWithWork) {
      skipWork(game, sim); // missed the bus
    }
  }

  // Visitors leave when their visit is over.
  for (const sim of game.state.sims) {
    if (!sim.isTownie || (sim.location !== 'lot' && sim.location !== 'town')) continue;
    if (now >= sim.visitUntil && sim.current?.kind !== 'leave' && !sim.queue.some((q) => q.kind === 'leave')) {
      interrupt(game, sim);
      sim.queue = [];
      enqueue(game, sim, { kind: 'leave', label: 'Go home', icon: '👋', userQueued: true });
    }
  }

  // Invited guests arrive.
  for (const v of [...game.state.pendingVisits]) {
    if (now >= v.at) {
      game.state.pendingVisits = game.state.pendingVisits.filter((p) => p !== v);
      const townie = game.sim(v.simId);
      if (townie && townie.location !== 'lot') {
        // Someone out in the park drops what they're doing and comes round.
        if (townie.location === 'town') { interrupt(game, townie); townie.queue = []; townie.current = null; }
        arriveVisitor(game, townie, 180);
      }
    }
  }

  // Lamps come on at dusk and go off in the morning.
  if (hour !== game.state.flags.lastHour) {
    const prev = game.state.flags.lastHour;
    game.state.flags.lastHour = hour;
    if (hour === 19 || hour === 7) {
      for (const obj of game.state.lot.objects) if (OBJECTS[obj.defId].light) obj.lightOn = hour === 19;
      game.lotChanged();
    }
    if (prev !== -1 && hour === 9 && game.weekday === 0 && game.day > 0) issueBills(game);
    checkAspirations(game);
    onHour(game, hour);
  }

  // Overdue bills get paid automatically, with a late fee.
  const bills = game.state.bills;
  if (bills && now >= bills.dueBy) {
    bills.amount = Math.round(bills.amount * 1.25);
    game.notify(`The bills were overdue, so they were paid with a 25% late fee.`, '🧾', 'bad');
    payBills(game);
    for (const sim of game.household()) addMoodlet(sim, 'bills_late', now);
  }

  // Random townie visits in the daytime.
  if (now >= game.state.flags.nextVisitAt) {
    scheduleNextVisit(game);
    const visitors = game.state.sims.filter((s) => s.isTownie && s.location === 'lot');
    const candidates = game.state.sims.filter((s) => s.isTownie && s.location === 'home');
    if (visitors.length < 2 && candidates.length && hour >= 10 && hour < 19) {
      const townie = pick(game.state, candidates);
      arriveVisitor(game, townie, randInt(game.state, 90, 200));
    }
  }
  void dt;
}

export function skipWork(game: Game, sim: Sim): void {
  if (!sim.career || sim.career.workedToday) return;
  sim.career.workedToday = true;
  sim.career.performance = clamp(sim.career.performance - 20, -100, 100);
  addMoodlet(sim, 'missed_work', game.state.time);
  game.notify(`${sim.name} skipped work today. Their boss wasn't happy.`, '😟', 'bad');
}

export function scheduleNextVisit(game: Game): void {
  const day = Math.floor(game.state.time / MINUTES_PER_DAY);
  // One chance of a visit each day, at a random time between 10:00 and 18:00.
  const nextDay = game.minuteOfDay >= 10 * 60 ? day + 1 : day;
  game.state.flags.nextVisitAt = nextDay * MINUTES_PER_DAY + randInt(game.state, 10 * 60, 18 * 60);
  if (!chance(game.state, 0.6)) game.state.flags.nextVisitAt += MINUTES_PER_DAY;
}

export function arriveVisitor(game: Game, townie: Sim, minutes: number): void {
  const exit = game.exitTile();
  townie.location = 'lot';
  townie.pos = { x: exit.x + 0.5, z: exit.z + 0.5 };
  townie.facing = 0;
  townie.queue = [];
  townie.current = null;
  townie.visitUntil = game.state.time + minutes;
  for (const n of Object.keys(townie.needs) as (keyof Sim['needs'])[]) townie.needs[n] = Math.max(townie.needs[n], 55 + random(game.state) * 35);
  townie.thinkCooldown = 1;
  game.notify(`${townie.name} from ${townie.district} has come to visit.`, '🚶', 'info');
  game.sound('doorbell');
}

/** Called when a Sim reaches the edge of the lot on the way out. */
export function arriveAtWork(game: Game, sim: Sim, action: RunningAction): void {
  const now = game.state.time;
  if (action.kind === 'leave') {
    sim.location = 'home';
    sim.visitUntil = 0;
    addMoodlet(sim, 'visited', now);
    return;
  }
  if (action.kind === 'outing') {
    const o = OUTINGS[action.selfId!];
    if (!o) return;
    if (o.cost) game.addFunds(-o.cost);
    sim.location = 'away';
    sim.awayReason = action.selfId;
    if (o.special === 'dogWalk') takeDog(game, sim);
    // Drivers get there and back quicker (lessons and tests use the instructor's car).
    const usesCar = o.special !== 'lesson' && o.special !== 'drivingTest' && takeCar(game, sim, o.special === 'refuel');
    sim.awayUntil = now + (usesCar && o.duration > 60 && !o.household ? o.duration - 20 : o.duration);
    if (usesCar && o.id !== 'drive') addMoodlet(sim, 'enjoyed_drive', now);
    return;
  }
  const lvl = careerLevel(sim);
  if (!lvl || !sim.career) return;
  sim.location = 'work';
  sim.awayReason = 'work';
  takeCar(game, sim);
  sim.career.workedToday = true;
  const day = Math.floor(now / MINUTES_PER_DAY);
  sim.awayUntil = Math.max(now + 60, day * MINUTES_PER_DAY + lvl.end * 60);
  sim.queue = sim.queue.filter((q) => q.userQueued && q.kind !== 'work');
}

function returnHome(game: Game, sim: Sim): void {
  const now = game.state.time;
  const exit = game.exitTile();
  sim.location = 'lot';
  sim.pos = { x: exit.x + 0.5, z: exit.z + 0.5 };
  sim.facing = 0;
  sim.current = null;
  sim.thinkCooldown = 0;
  const reason = sim.awayReason;
  sim.awayReason = undefined;
  if (reason === 'work') { finishWorkDay(game, sim); returnCar(game, sim); }
  else if (reason && OUTINGS[reason]) {
    const o = OUTINGS[reason];
    for (const k in o.effects) {
      const n = k as keyof Sim['needs'];
      sim.needs[n] = clamp(sim.needs[n] + o.effects[n]!, 0, 100);
    }
    if (o.moodlet) addMoodlet(sim, o.moodlet, now);
    if (o.skill && o.skillXp) gainSkill(game, sim, o.skill, o.skillXp);
    if (o.special === 'marketFind') marketFind(game, sim);
    if (!o.groceries && !o.special) game.notify(`${sim.name} is back from ${o.name.replace(/ \(.*\)$/, '')}.`, o.icon, 'info');
    outingReturn(game, sim, reason);
  }
}

function finishWorkDay(game: Game, sim: Sim): void {
  const career = sim.career!;
  const def = CAREERS[career.id];
  const lvl = def.levels[career.level];
  const hours = lvl.end - lvl.start;
  const bonus = takeBonus(sim);
  const pay = Math.round(lvl.pay * hours) + bonus;
  game.addFunds(pay);
  afterWork(sim, career.id);
  career.daysWorked++;
  const mf = moodFactor(sim);
  let perf = 10 * mf;
  for (const s of def.skills) perf += Math.min(levelOf(sim, s), 10) * 0.8;
  for (const t of sim.traits) perf *= ALL_TRAITS[t]?.workPerformance ?? 1;
  career.performance = clamp(career.performance + perf, -100, 100);
  const now = game.state.time;
  addMoodlet(sim, mf >= 1.1 ? 'good_day' : mf < 0.85 ? 'hard_day' : 'good_day', now);
  game.notify(`${sim.name} earned £${pay} at work today${bonus ? ` (with £${bonus} for the extra hours)` : ''}.`, '💷', 'good');
  game.sound('cash');
  if (career.performance >= 100) tryPromote(game, sim);
}

export function missingForPromotion(sim: Sim): { skill: SkillId; level: number }[] {
  const def = sim.career && CAREERS[sim.career.id];
  const next = def?.levels[sim.career!.level + 1];
  if (!next) return [];
  return (Object.entries(next.req) as [SkillId, number][])
    .filter(([skill, level]) => levelOf(sim, skill) < level)
    .map(([skill, level]) => ({ skill, level }));
}

function tryPromote(game: Game, sim: Sim): void {
  const career = sim.career!;
  const def = CAREERS[career.id];
  const next = def.levels[career.level + 1];
  if (!next) { career.performance = 100; return; }
  const missing = missingForPromotion(sim);
  const needLicence = !!next.licence && !sim.driving.licence;
  if (missing.length || needLicence) {
    career.performance = 100;
    const m = [...missing.map((x) => `${SKILL_NAMES[x.skill].name} ${x.level}`), ...(needLicence ? ['a driving licence'] : [])].join(' and ');
    game.notify(`${sim.name} is ready for promotion but needs ${m}.`, '📈', 'info');
    return;
  }
  career.level++;
  career.performance = 10;
  addMoodlet(sim, 'promoted', game.state.time);
  game.notify(`${sim.name} was promoted to ${next.title}! Now £${next.pay}/hour.`, '🎉', 'good');
  game.sound('levelup');
}

export function joinCareer(game: Game, sim: Sim, careerId: string): boolean {
  if (!CAREERS[careerId]) return false;
  sim.career = { id: careerId, level: 0, performance: 0, daysWorked: 0, workedToday: true };
  const lvl = CAREERS[careerId].levels[0];
  game.notify(`${sim.name} joined the ${CAREERS[careerId].name} career as a ${lvl.title}. Work starts tomorrow.`, CAREERS[careerId].icon, 'good');
  return true;
}

export function quitCareer(game: Game, sim: Sim): void {
  if (!sim.career) return;
  game.notify(`${sim.name} quit their job.`, '📭', 'info');
  sim.career = null;
}

function issueBills(game: Game): void {
  const b = billBreakdown(game);
  const amount = b.total;
  game.state.household.extraEnergy = 0;
  resetAllowances(game.state);
  if (game.state.bills) game.state.bills.amount += amount;
  else game.state.bills = { amount, issued: game.state.time, dueBy: game.state.time + 3 * MINUTES_PER_DAY };
  const parts = [`home £${b.home}`, `energy £${b.energy}${b.energySaved ? ` (saved £${b.energySaved})` : ''}`, b.subscriptions ? `TV £${b.subscriptions}` : '', b.pets ? `pets £${b.pets}` : ''].filter(Boolean).join(', ');
  game.notify(`Weekly bills have arrived: £${game.state.bills.amount} (${parts}). Pay within 3 days.`, '🧾', 'bills');
  billsText(game, game.state.bills.amount);
  game.sound('notify');
}

function marketFind(game: Game, sim: Sim): void {
  const finds = Object.values(OBJECTS).filter((d) => d.market && !game.state.household.marketFinds.includes(d.id));
  if (!finds.length || !chance(game.state, 0.6)) return;
  const f = pick(game.state, finds);
  game.state.household.marketFinds.push(f.id);
  addMoodlet(sim, 'market_find', game.state.time);
  game.notify(`${sim.name} spotted a rare ${f.name} on the market! It's now in the Buy catalogue.`, '🧺', 'good');
}

// ---------- Aspirations ----------

export function condMet(game: Game, sim: Sim, cond: AspirationCond): boolean {
  switch (cond.type) {
    case 'skill': return levelOf(sim, cond.skill) >= cond.level;
    case 'counter': return (sim.counters[cond.key] ?? 0) >= cond.count;
    case 'career': return sim.career?.id === cond.career && sim.career.level + 1 >= cond.level;
    case 'friends': return friendCount(game.state, sim.id, cond.min) >= cond.count;
    case 'homeValue': return game.homeValue() >= cond.amount;
    case 'rooms': return game.roomInfo().count - 1 >= cond.count;
  }
}

export function checkAspirations(game: Game): void {
  for (const sim of game.household()) {
    const asp = ASPIRATIONS[sim.aspiration];
    if (!asp) continue;
    let guard = 0;
    while (sim.aspirationStep < asp.steps.length && condMet(game, sim, asp.steps[sim.aspirationStep].cond) && guard++ < 10) {
      const step = asp.steps[sim.aspirationStep];
      sim.aspirationStep++;
      sim.rewardPoints += step.points;
      addMoodlet(sim, 'aspiration', game.state.time);
      game.notify(`${sim.name} completed "${step.desc}" (+${step.points} reward points).`, '⭐', 'good');
      game.sound('levelup');
      if (sim.aspirationStep >= asp.steps.length) game.notify(`${sim.name} has achieved their ${asp.name} aspiration! 🏆`, asp.icon, 'good');
    }
  }
}
