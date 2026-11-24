// The Game wraps the plain-JSON GameState with caches and the per-minute tick.
// The 3D view only reads `game.state`; input arrives as method calls (commands).
import { BUILD_PRICES, NEEDS, NEED_TUNING, OBJECTS, ALL_TRAITS } from './defs';
import {
  buildOccupancy, computeRooms, homeValue, objectTiles, paintDecor, surfaceDecor, roomAt,
  type RoomInfo,
} from './lot';
import { addMoodlet, clamp, expireMoodlets, needDecayMult } from './mood';
import { buildEdges, type PathGrid } from './path';
import { stepSim, releaseAll } from './actions';
import { runSchedules } from './schedule';
import { runLife } from './life';
import { dryWashing, roomPenalty } from './home';
import { petsTick } from './pets';
import { clothesTick } from './clothes';
import { phoneTick } from './phone';
import type { GameEvent, GameNotification, GameState, Lot, NeedId, PlacedObject, Point, Sim } from './types';
import { townLot, townMask } from './town';
import { stepSteer } from './steer';

export type Area = 'home' | 'town';
import { NEED_IDS } from './types';

export const MINUTES_PER_DAY = 1440;
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export class Game {
  state: GameState;
  events: GameEvent[] = [];
  private occ: Int32Array | null = null;
  private rooms: RoomInfo | null = null;
  roomScores: number[] = [];
  private roomTimer = 0;
  /** Objects a Sim recently failed to reach: `${simId}:${objId}` → retry time. */
  unreachable = new Map<string, number>();
  /** The lot changed since the last replaceState (a guest device predicting ahead). */
  private lotTouched = false;
  /** Which map the code running now is about (set while updating each Sim). */
  ctx: Area = 'home';
  private townCache: { lot: Lot | null } = { lot: null };
  private townOcc: Int32Array | null = null;
  private townOccFor: PlacedObject[] | null = null;
  private townRooms: RoomInfo | null = null;
  private edges: Uint8Array | null = null;
  private townEdges: Uint8Array | null = null;

  constructor(state: GameState) {
    this.state = state;
    this.recomputeRooms();
  }

  // ---------- Lookups ----------
  sim(id: number): Sim | undefined { return this.state.sims.find((s) => s.id === id); }
  household(): Sim[] { return this.state.household.memberIds.map((id) => this.sim(id)!).filter(Boolean); }
  simsOnLot(): Sim[] { return this.state.sims.filter((s) => s.location === 'lot'); }
  /** Sims on a map: the home lot or out in town. */
  simsIn(area: Area): Sim[] { return this.state.sims.filter((s) => s.location === (area === 'town' ? 'town' : 'lot')); }
  areaOf(sim: Sim): Area { return sim.location === 'town' ? 'town' : 'home'; }
  /** Is this Sim somewhere you can see them (home or town)? */
  present(sim: Sim): boolean { return sim.location === 'lot' || sim.location === 'town'; }
  sameArea(a: Sim, b: Sim): boolean { return this.present(a) && a.location === b.location; }
  object(id: number): PlacedObject | undefined {
    return this.state.lot.objects.find((o) => o.id === id) ?? this.state.town?.objects.find((o) => o.id === id);
  }
  objectArea(id: number): Area | undefined {
    if (this.state.lot.objects.some((o) => o.id === id)) return 'home';
    if (this.state.town?.objects.some((o) => o.id === id)) return 'town';
    return undefined;
  }
  /** The map's lot: home, or the town (park, café and streets). */
  areaLot(area: Area = this.ctx): Lot {
    return area === 'town' && this.state.town ? townLot(this.state, this.townCache) : this.state.lot;
  }
  /** Run something as if it were happening on a map (pathfinding, objects, rooms). */
  inArea<T>(area: Area, fn: () => T): T {
    const before = this.ctx;
    this.ctx = area;
    try { return fn(); } finally { this.ctx = before; }
  }
  isHousehold(sim: Sim): boolean { return this.state.household.memberIds.includes(sim.id); }
  nextId(): number { return this.state.nextId++; }

  get day(): number { return Math.floor(this.state.time / MINUTES_PER_DAY); }
  get weekday(): number { return this.day % 7; }
  get minuteOfDay(): number { return this.state.time % MINUTES_PER_DAY; }
  get hour(): number { return Math.floor(this.minuteOfDay / 60); }
  isNight(): boolean { const h = this.minuteOfDay / 60; return h >= 19.5 || h < 6.5; }

  exitTile(): Point { return { x: Math.floor(this.state.lot.width / 2) - 4, z: 0 }; }

  grid(area: Area = this.ctx): PathGrid {
    if (area === 'town' && this.state.town) {
      const lot = this.areaLot('town');
      if (!this.townOcc || this.townOccFor !== lot.objects) {
        // Furniture, plus everything that isn't pavement, road, park or café.
        const occ = buildOccupancy(lot);
        const mask = townMask();
        for (let i = 0; i < occ.length; i++) if (!mask[i]) occ[i] = -2;
        this.townOcc = occ;
        this.townOccFor = lot.objects;
      }
      this.townEdges ??= buildEdges(lot);
      return { lot, occ: this.townOcc, edges: this.townEdges };
    }
    if (!this.occ) { this.occ = buildOccupancy(this.state.lot); this.edges = buildEdges(this.state.lot); }
    return { lot: this.state.lot, occ: this.occ, edges: this.edges ?? undefined };
  }

  roomInfo(area: Area = 'home'): RoomInfo {
    if (area === 'town' && this.state.town) {
      if (!this.townRooms) this.townRooms = computeRooms(this.areaLot('town'));
      return this.townRooms;
    }
    if (!this.rooms) this.rooms = computeRooms(this.state.lot);
    return this.rooms;
  }

  roomOf(p: Point, area: Area = this.ctx): number { return roomAt(this.roomInfo(area), this.areaLot(area), p); }

  /** Call after any wall, floor or object change. */
  lotChanged(): void {
    this.occ = null;
    this.rooms = null;
    this.state.lot.version++;
    this.lotTouched = true;
    this.unreachable.clear();
    this.recomputeRooms();
    this.events.push({ type: 'lotChanged' });
  }

  /**
   * Swap in a new copy of the world (another device sent it). Caches are kept when the lot
   * hasn't changed, so this is cheap enough to do every second.
   */
  replaceState(next: GameState): boolean {
    const lotChanged = next.lot.version !== this.state.lot.version || this.lotTouched;
    if (next.town?.version !== this.state.town?.version) { this.townRooms = null; this.townEdges = null; }
    this.state = next;
    this.lotTouched = false;
    if (lotChanged) {
      this.occ = null;
      this.rooms = null;
      this.unreachable.clear();
      this.recomputeRooms();
    }
    return lotChanged;
  }

  homeValue(): number { return homeValue(this.state.lot, BUILD_PRICES); }

  // ---------- Messages and money ----------
  notify(text: string, icon = 'ℹ️', kind: GameNotification['kind'] = 'info'): GameNotification {
    const n: GameNotification = { id: this.nextId(), time: this.state.time, text, icon, kind, read: false };
    this.state.notifications.push(n);
    if (this.state.notifications.length > 60) this.state.notifications.shift();
    this.events.push({ type: 'notify', notification: n });
    return n;
  }

  sound(sound: string): void { this.events.push({ type: 'sound', sound }); }

  addFunds(delta: number): void {
    this.state.household.funds = Math.round(this.state.household.funds + delta);
    this.events.push({ type: 'funds', delta });
  }

  think(sim: Sim, icon: string, minutes = 20): void {
    sim.thought = { icon, until: this.state.time + minutes };
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- Rooms ----------
  recomputeRooms(): void {
    const info = this.roomInfo();
    const lot = this.state.lot;
    const night = this.isNight();
    const scores: number[] = [];
    for (let r = 0; r < info.count; r++) {
      let decor = 0, dirt = 0, lampsOn = 0;
      for (const obj of lot.objects) {
        const tiles = objectTiles(obj);
        if (info.rooms[tiles[0].z * lot.width + tiles[0].x] !== r) continue;
        const def = OBJECTS[obj.defId];
        decor += def.decor;
        if (obj.dirt > 60) dirt++;
        if (def.light && obj.lightOn) lampsOn++;
      }
      let score: number;
      if (r === 0) {
        score = (night ? 40 : 58) + Math.min(25, decor * 2) + (night && lampsOn ? 12 : 0);
      } else {
        const size = info.sizes[r];
        const roomWindows = this.roomHasWindow(r);
        score = 38 + Math.min(30, decor * 3) + surfaceDecor(lot, info, r) * 6 + paintDecor(lot, info, r) * 6;
        if (night) score += lampsOn ? 10 : -22;
        else score += roomWindows ? 8 : lampsOn ? 2 : -8;
        if (size < 6) score -= 10; else if (size >= 14) score += 5;
        score -= dirt * 9;
      }
      score -= roomPenalty(this, r);
      scores.push(clamp(Math.round(score), 0, 100));
    }
    this.roomScores = scores;
  }

  private roomHasWindow(room: number): boolean {
    const info = this.roomInfo();
    const lot = this.state.lot;
    for (const key in lot.walls) {
      if (lot.walls[key].kind !== 'window') continue;
      const [d, xs, zs] = key.split(',');
      const x = Number(xs), z = Number(zs);
      const a = d === 'h' ? { x, z: z - 1 } : { x: x - 1, z };
      const b = { x, z };
      for (const t of [a, b]) {
        if (t.x >= 0 && t.z >= 0 && t.x < lot.width && t.z < lot.depth && info.rooms[t.z * lot.width + t.x] === room) return true;
      }
    }
    return false;
  }

  roomScoreAt(p: Point): number { return this.roomScores[this.roomOf(p, 'home')] ?? 50; }

  // ---------- Tick ----------
  /** Advance the simulation by `minutes` of game time. */
  tick(minutes: number): void {
    let remaining = minutes;
    while (remaining > 0) {
      const dt = Math.min(1, remaining);
      remaining -= dt;
      this.step(dt);
    }
  }

  private step(dt: number): void {
    const prevDay = this.day;
    this.state.time += dt;
    const now = this.state.time;

    for (const sim of this.state.sims) {
      expireMoodlets(sim, now);
      if (sim.thought && sim.thought.until < now) sim.thought = null;
      if (sim.location === 'home') continue;
      this.decayNeeds(sim, dt);
      if (sim.location === 'lot' || sim.location === 'town') {
        this.inArea(this.areaOf(sim), () => {
          if (!stepSteer(this, sim, dt)) stepSim(this, sim, dt);
          this.checkFailures(sim);
        });
      }
    }

    this.roomTimer -= dt;
    if (this.roomTimer <= 0) {
      this.roomTimer = 10;
      this.recomputeRooms();
      this.updateRoomMoodlets();
    }

    this.growPlants(dt);
    dryWashing(this, dt);
    petsTick(this, dt);
    phoneTick(this);
    runSchedules(this, dt);
    runLife(this, dt);

    if (this.day !== prevDay) this.endOfDay(prevDay);
  }

  private decayNeeds(sim: Sim, dt: number): void {
    const cur = sim.current;
    const performing = cur?.phase === 'perform';
    const anim = performing ? cur!.anim : sim.anim;
    const sitting = sim.poseObjectId !== null && anim !== 'sleep';
    const sleeping = anim === 'sleep' && performing;
    const atWork = sim.location === 'work' || sim.location === 'away';
    clothesTick(this, sim, dt, anim, performing ? cur!.tags : undefined);
    for (const need of NEED_IDS) {
      if (need === 'room') continue;
      if (performing && (cur!.rates[need] ?? 0) > 0) continue; // being filled
      let rate = NEEDS[need].decayPerHour / 60;
      rate *= needDecayMult(sim, need, sitting);
      if (this.state.settings.relaxed && this.isHousehold(sim)) rate *= 0.55;
      if (sleeping) rate *= need === 'bladder' ? 0.6 : NEED_TUNING.sleepingDecayMult;
      if (sitting && need === 'energy') rate *= NEED_TUNING.sittingEnergyMult;
      if (atWork) rate *= NEED_TUNING.workDecayMult;
      sim.needs[need] = clamp(sim.needs[need] - rate * dt, 0, 100);
    }
    if (atWork) {
      // Colleagues keep Social and Bladder ticking over; nobody comes home at zero.
      sim.needs.social = clamp(sim.needs.social + (6 / 60) * dt, 0, 100);
      sim.needs.bladder = Math.max(sim.needs.bladder, 55);
      for (const n of ['hunger', 'energy', 'hygiene', 'fun'] as NeedId[]) sim.needs[n] = Math.max(sim.needs[n], 15);
    }
    if (sitting && !performing) {
      sim.needs.comfort = clamp(sim.needs.comfort + (NEED_TUNING.sittingComfortPerHour / 60) * dt, 0, 100);
    } else if (sitting && performing && !(cur!.rates.comfort ?? 0)) {
      sim.needs.comfort = clamp(sim.needs.comfort + (NEED_TUNING.sittingComfortPerHour / 60) * dt * 0.7, 0, 100);
    }
    // Room need drifts towards how nice the current room is.
    const target = sim.location === 'lot' ? this.roomScoreAt(sim.pos) : sim.location === 'town' ? 68 : 60;
    const diff = target - sim.needs.room;
    sim.needs.room = clamp(sim.needs.room + Math.sign(diff) * Math.min(Math.abs(diff), (25 / 60) * dt), 0, 100);
  }

  private checkFailures(sim: Sim): void {
    const now = this.state.time;
    if (sim.needs.bladder <= 0) {
      releaseAll(this, sim, true);
      sim.needs.bladder = 100;
      sim.needs.hygiene = clamp(sim.needs.hygiene - 40, 0, 100);
      addMoodlet(sim, 'embarrassed', now);
      this.think(sim, '😳', 30);
      if (this.isHousehold(sim)) this.notify(`${sim.name} couldn't hold it in! Build or buy a toilet nearby.`, '😳', 'bad');
    }
    if (sim.needs.energy <= 0 && !(sim.current?.anim === 'sleep')) {
      releaseAll(this, sim, true);
      sim.queue.unshift({
        uid: this.nextId(), kind: 'self', selfId: '__passout', label: 'Passed out', icon: '😵', userQueued: true,
        inline: { anim: 'sleep', duration: 240, effects: { energy: 60 }, moodlet: 'slept_on_floor' },
      });
      if (this.isHousehold(sim)) this.notify(`${sim.name} was so tired they fell asleep on the floor!`, '😵', 'bad');
    }
    if (sim.needs.hunger <= 2 && this.isHousehold(sim) && !sim.thought) {
      this.think(sim, '🍽️', 30);
    }
  }

  private updateRoomMoodlets(): void {
    const now = this.state.time;
    for (const sim of this.simsOnLot()) {
      const score = this.roomScoreAt(sim.pos);
      if (score >= 85) addMoodlet(sim, 'lovely_room', now);
      const messy = sim.traits.some((t) => ALL_TRAITS[t]?.messMood) && this.state.lot.objects.some((o) => o.dirt > 60);
      if (messy) addMoodlet(sim, 'dirty_house', now);
    }
  }

  private growPlants(dt: number): void {
    for (const obj of this.state.lot.objects) {
      if (obj.defId !== 'veg_patch' || obj.growth <= 0 || obj.growth >= 100) continue;
      obj.growth = Math.min(100, obj.growth + (2.2 / 60) * dt);
    }
  }

  private endOfDay(day: number): void {
    for (const sim of this.household()) if (sim.career) sim.career.workedToday = false;
    // Friendships fade a little if nobody keeps in touch.
    for (const rel of this.state.relationships) {
      if (Math.abs(rel.friendship) > 15) rel.friendship -= Math.sign(rel.friendship) * 0.5;
      if (!rel.partners && rel.romance > 0) rel.romance = Math.max(0, rel.romance - 0.5);
    }
    this.events.push({ type: 'dayEnded', day });
  }
}
