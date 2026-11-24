// Growing up: children, teens and adults. Children and teens grow up on their birthday (every
// two game weeks), with a cake. Children go to Hillcrest Primary (you can see them in class);
// teens go to Ashton High (off-screen, like work). Both get homework and a weekly report.
import type { Game } from './game';
import type { Age, Sim } from './types';
import { addMoodlet, clamp } from './mood';
import { calendarOf, isEventToday, placeTemp } from './life';
import { enqueue } from './actions';
import { OBJECTS } from './defs';

export const STAGE_DAYS = 14;
export const AGE_NAMES: Record<Age, string> = { child: 'Child', teen: 'Teen', adult: 'Adult' };

export const ageOf = (sim: Sim): Age => sim.age ?? 'adult';
export const isKid = (sim: Sim) => ageOf(sim) !== 'adult';

export function daysToBirthday(game: Game, sim: Sim): number | null {
  if (ageOf(sim) === 'adult' || game.state.settings.ageing === false) return null;
  return Math.max(0, (sim.ageDay ?? 0) + STAGE_DAYS - game.day);
}

export function setAge(sim: Sim, age: Age, day: number): void {
  sim.age = age;
  sim.ageDay = day;
  sim.appearance = { ...sim.appearance, age };
  if (age === 'adult') sim.school = undefined;
  else sim.school ??= { grade: 60, homework: false, attendedDay: -1 };
}

/** School days: weekdays in term time (not the summer holidays or Christmas Day). */
export function isSchoolDay(game: Game): boolean {
  return game.weekday < 5 && calendarOf(game.day).season.id !== 'summer' && !isEventToday(game, 'christmas');
}

export function gradeLetter(g: number): string {
  return g >= 85 ? 'A*' : g >= 70 ? 'A' : g >= 55 ? 'B' : g >= 40 ? 'C' : 'D';
}

function grow(game: Game, sim: Sim): void {
  const next: Age = ageOf(sim) === 'child' ? 'teen' : 'adult';
  setAge(sim, next, game.day);
  addMoodlet(sim, 'birthday', game.state.time);
  const first = sim.name.split(' ')[0];
  game.notify(next === 'teen' ? `🎂 Happy birthday, ${first}! ${first} is a teenager now, and goes to Ashton High.`
    : `🎂 Happy birthday, ${first}! ${first} is all grown up: time to get a job, learn to drive and maybe fall in love.`, '🎂', 'good');
  game.sound('levelup');
  if (!game.state.lot.objects.some((o) => o.defId === 'birthday_cake') && OBJECTS.birthday_cake) placeTemp(game, 'birthday_cake', true, game.day + 1);
}

/** Every game hour. */
export function agesHour(game: Game, hour: number): void {
  const st = game.state;
  const day = game.day;
  if (hour === 8 && st.settings.ageing !== false) {
    for (const sim of game.household()) {
      const left = daysToBirthday(game, sim);
      if (left === null) continue;
      if (left <= 0) grow(game, sim);
      else if (left === 2) game.notify(`${sim.name.split(' ')[0]}'s birthday is in 2 days! 🎂`, '🎈', 'info');
    }
  }
  if (!isSchoolDay(game)) return;
  for (const sim of game.household()) {
    const age = ageOf(sim);
    if (age === 'adult') continue;
    const sc = (sim.school ??= { grade: 60, homework: false, attendedDay: -1 });
    if (hour === 7 && sc.homework) {
      sc.grade = clamp(sc.grade - 5, 0, 100);
      sc.homework = false;
      game.notify(`${sim.name.split(' ')[0]} forgot their homework! 📚`, '📚', 'bad');
    }
    if (hour >= 7 && hour <= 9 && sc.attendedDay !== day) goToSchool(game, sim);
    if (hour === 11 && sc.attendedDay !== day && !atSchool(sim)) {
      sc.grade = clamp(sc.grade - 8, 0, 100);
      sc.attendedDay = day;
      addMoodlet(sim, 'missed_school', st.time);
      game.notify(`${sim.name.split(' ')[0]} missed school today! The school rang home. 📞`, '🏫', 'bad');
    }
  }
  if (hour === 16 && game.weekday === 4) {
    for (const sim of game.household()) {
      if (!isKid(sim) || !sim.school) continue;
      const letter = gradeLetter(sim.school.grade);
      const good = letter === 'A*' || letter === 'A';
      addMoodlet(sim, good ? 'good_report' : letter === 'D' ? 'bad_report' : 'homework_done', st.time);
      if (good) sim.rewardPoints += 3;
      game.notify(`📝 ${sim.name.split(' ')[0]}'s school report: ${letter}${good ? '. Brilliant! (+3 reward points)' : letter === 'D' ? '. Must try harder: go to school and do homework.' : '. Keep it up!'}`, '📝', good ? 'good' : letter === 'D' ? 'bad' : 'info');
    }
  }
}

function atSchool(sim: Sim): boolean {
  return sim.current?.interactionId === 'school' || sim.awayReason === 'highschool' || sim.queue.some((q) => q.interactionId === 'school' || q.selfId === 'highschool');
}

/** Off to school: children walk to Hillcrest, teens catch the bus to Ashton High. */
export function goToSchool(game: Game, sim: Sim): void {
  if (!game.present(sim) || atSchool(sim)) return;
  if (ageOf(sim) === 'teen') {
    enqueue(game, sim, { kind: 'outing', selfId: 'highschool', label: 'Go to school', icon: '🏫', userQueued: true }, true);
    return;
  }
  const desk = freeDesk(game);
  if (!desk) return;
  enqueue(game, sim, { kind: 'object', objectId: desk, interactionId: 'school', label: 'Go to school', icon: '🎒', userQueued: true }, true);
  game.notify(`${sim.name.split(' ')[0]} is walking to school. 🎒`, '🎒', 'info');
}

export function freeDesk(game: Game): number | undefined {
  const desks = game.state.town?.objects.filter((o) => o.defId === 'school_desk') ?? [];
  const taken = new Set(game.state.sims.flatMap((s) => [s.current?.objectId, ...s.queue.map((q) => q.objectId)]).filter((x) => x !== undefined));
  return (desks.find((d) => d.users.every((u) => u === null) && !taken.has(d.id)) ?? desks[0])?.id;
}

/** A school day finished (in class, or back from the high school). */
export function schoolDayDone(game: Game, sim: Sim): void {
  const sc = (sim.school ??= { grade: 60, homework: false, attendedDay: -1 });
  sc.attendedDay = game.day;
  const mood = (sim.needs.fun + sim.needs.social + sim.needs.energy) / 3;
  sc.grade = clamp(sc.grade + (mood > 60 ? 4 : 2), 0, 100);
  if (!game.isHousehold(sim)) return;
  sc.homework = true;
  if (sim.location === 'town') {
    const e = game.exitTile();
    enqueue(game, sim, { kind: 'goto', area: 'home', dest: { x: e.x, z: e.z + 2 }, label: 'Walk home', icon: '🏠', userQueued: true }, true);
  }
  game.notify(`${sim.name.split(' ')[0]} is back from school, with homework! 📚`, '📚', 'info');
}

export function homeworkDone(game: Game, sim: Sim): void {
  if (!sim.school) return;
  sim.school.homework = false;
  sim.school.grade = clamp(sim.school.grade + 4, 0, 100);
  game.think(sim, '✅', 10);
}

/** How long a school day or shift has left (game minutes). */
export function untilHour(game: Game, hour: number): number {
  return Math.max(20, hour * 60 - game.minuteOfDay);
}
