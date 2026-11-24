// Life on the streets: people walking by (some with dogs), kids on bikes, cars, the postman on
// weekday mornings, the bin lorry on Thursdays and the school run. All of this is scenery: it
// lives only in the view (nothing saved or sent between devices) and follows the game clock.
// Cars stop for your Sims when they cross the road.
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Game } from '../sim/game';
import type { Pet, Sim } from '../sim/types';
import { streets, SCHOOL, SCHOOL_GROUNDS, TOWN_ORIGIN } from '../sim/town';
import { calendarOf } from '../sim/life';
import { buildShape, carShape, type ModelBuilder } from './models';
import { PetAvatar } from './petAvatar';
import type { Materials } from './materials';

type P = { x: number; z: number };

/** A polyline you can ask "where are you after d metres?" */
class Route {
  readonly len: number;
  private cum: number[] = [0];
  constructor(readonly pts: P[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.len = this.cum[this.cum.length - 1] || 1;
  }
  at(d: number): { p: P; dir: number } {
    d = Math.max(0, Math.min(this.len, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (d - this.cum[i - 1]) / seg;
    return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, dir: Math.atan2(b.x - a.x, b.z - a.z) };
  }
}

/** Offset a polyline sideways (positive = to the right of travel). */
function offset(pts: [number, number][], by: number): P[] {
  return pts.map(([x, z], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return { x: x + (dz / l) * by, z: z - (dx / l) * by };
  });
}

let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pickC = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const SKIN = ['#f1d3bd', '#e8b48f', '#c98e66', '#9a6440', '#6e4527', '#f6dcc8'];
const HAIR = ['#2b1d14', '#5a3a24', '#a0703f', '#d9b25a', '#1a1a1a', '#8a8a8a', '#b5532a'];
const CLOTHES = ['#3b6fd1', '#c0392b', '#2f8f5b', '#f2c14e', '#9b6ad6', '#2d3037', '#e07a5f', '#4a515c', '#f4f1ea', '#e05a7a', '#2bb3a6'];

/** A simple person: one merged body plus swinging arms and legs (cheap enough for a crowd). */
class Person {
  readonly root: TransformNode;
  private legs: Mesh[] = [];
  private arms: Mesh[] = [];
  private bike: Mesh | null = null;
  phase = rnd() * 10;

  constructor(scene: Scene, mats: Materials, opts: { kid?: boolean; uniform?: string; bike?: boolean; hiVis?: boolean }) {
    this.root = new TransformNode('passerby', scene);
    const skin = pickC(SKIN), hair = pickC(HAIR);
    const top = opts.hiVis ? '#e6f23a' : opts.uniform ?? pickC(CLOTHES), bottom = opts.uniform ? '#2d3037' : pickC(['#2d3037', '#3a5a8c', '#4a515c', '#8b5e3c', '#2f5d50']);
    const body = buildShape(scene, mats, (b: ModelBuilder) => {
      b.box(0.36, 0.55, 0.22, top, 0, 0.88, 0);
      b.sphere(0.27, skin, 0, 1.6, 0);
      b.sphere(0.29, hair, 0, 1.66, -0.03, 1, 0.75, 1);
      b.box(0.34, 0.12, 0.22, bottom, 0, 0.8, 0);
      if (opts.uniform) b.box(0.3, 0.3, 0.12, '#c0392b', 0.22, 0.9, 0); // postbag
    }, 'pb');
    body.parent = this.root;
    for (const side of [-1, 1]) {
      const leg = buildShape(scene, mats, (b) => { b.box(0.13, 0.8, 0.14, bottom, 0, -0.8, 0); b.box(0.14, 0.08, 0.24, '#2b2b2b', 0, -0.84, 0.04); }, 'pbleg');
      leg.parent = this.root;
      leg.position.set(side * 0.1, 0.82, 0);
      this.legs.push(leg);
      const arm = buildShape(scene, mats, (b) => { b.box(0.1, 0.5, 0.1, top, 0, -0.52, 0); b.sphere(0.1, skin, 0, -0.55, 0); }, 'pbarm');
      arm.parent = this.root;
      arm.position.set(side * 0.24, 1.4, 0);
      this.arms.push(arm);
    }
    if (opts.kid) this.root.scaling.setAll(0.72);
    if (opts.bike) {
      this.bike = buildShape(scene, mats, (b) => {
        const col = pickC(['#c0392b', '#3b6fd1', '#f2c14e', '#9b6ad6']);
        for (const z of [-0.55, 0.55]) { const w = b.torus(0.62, 0.05, '#22252b', 0, 0.32, z, 16); w.rotation.z = Math.PI / 2; }
        const f = b.box(0.05, 0.05, 1.0, col, 0, 0.55, 0); f.rotation.x = -0.15;
        b.box(0.05, 0.45, 0.05, col, 0, 0.32, -0.15);
        b.box(0.22, 0.05, 0.3, '#2d3037', 0, 0.78, -0.2);
        b.box(0.5, 0.04, 0.04, '#2d3037', 0, 0.95, 0.5);
        b.box(0.05, 0.4, 0.05, col, 0, 0.55, 0.5);
      }, 'bike');
      this.bike.parent = this.root;
      this.bike.scaling.setAll(1 / 0.72);
    }
  }

  show(on: boolean) { if (this.root.isEnabled() !== on) this.root.setEnabled(on); }

  place(p: P, dir: number, moving: boolean, dt: number, speed: number) {
    this.root.position.set(p.x, this.bike ? 0.5 : 0, p.z);
    this.root.rotation.y = dir;
    if (moving) this.phase += dt * speed;
    const s = moving ? Math.sin(this.phase) : 0;
    if (this.bike) {
      // Pedalling.
      this.legs[0].rotation.x = -1.2 + s * 0.6;
      this.legs[1].rotation.x = -1.2 - s * 0.6;
      for (const a of this.arms) a.rotation.x = -1.1;
      return;
    }
    this.legs[0].rotation.x = s * 0.55;
    this.legs[1].rotation.x = -s * 0.55;
    this.arms[0].rotation.x = -s * 0.45;
    this.arms[1].rotation.x = s * 0.45;
  }

  dispose() { this.root.dispose(false, true); }
}

interface Walker { person: Person; route: Route; speed: number; phase: number; dog?: PetAvatar; minActive: number }
interface Car { mesh: Mesh; route: Route; s: number; speed: number; dir: 1 | -1 }

export class StreetLife {
  private walkers: Walker[] = [];
  private cars: Car[] = [];
  private postman: Person;
  private postRoute: Route;
  private lorry: Mesh;
  private lorryRoute: Route;
  private kids: { person: Person; route: Route }[] = [];
  private time = 0;

  constructor(scene: Scene, mats: Materials) {
    const plan = streets(18).filter((s) => s.houses && s.name);
    const pavements: Route[] = [];
    const roads: { route: Route; pts: [number, number][] }[] = [];
    for (const st of plan) {
      const pts = st.points as [number, number][];
      for (const side of [-1, 1]) pavements.push(new Route(offset(pts, side * (st.width / 2 + 1.1))));
      roads.push({ route: new Route(offset(pts, st.width / 2 - 1.2)), pts });
    }
    // Busiest near home: Larkfield Close, Wellbrook Road and Maple Avenue.
    const near = pavements.slice(0, 6);
    for (let i = 0; i < 14; i++) {
      const route = i < 9 ? near[i % near.length] : pickC(pavements);
      const person = new Person(scene, mats, { kid: i === 12 || i === 13, bike: i === 12 || i === 13 });
      const w: Walker = { person, route, speed: i >= 12 ? 4.2 : 1.1 + rnd() * 0.5, phase: rnd() * route.len * 2, minActive: i };
      if (i === 2 || i === 7) {
        const dog = { id: -50 - i, species: 'dog', name: '', color: pickC(['#c69c6d', '#3b2a1e', '#f4f1ea', '#1c1c1c']), anim: 'walk' } as unknown as Pet;
        w.dog = new PetAvatar(scene, dog, { kind: 'scenery' });
        w.dog.root.getChildMeshes().forEach((m) => { m.isPickable = false; });
      }
      if (i >= 12) w.route = new Route(roads[i % 3].route.pts);
      person.root.getChildMeshes().forEach((m) => { m.isPickable = false; });
      this.walkers.push(w);
    }
    const colours = ['#c0392b', '#f4f1ea', '#2d3037', '#3b6fd1', '#8a8a8a', '#2f8f5b', '#f2c14e'];
    for (let i = 0; i < 6; i++) {
      const road = roads[i % Math.min(roads.length, 4)];
      const dir: 1 | -1 = i % 2 ? 1 : -1;
      const route = new Route(offset(road.pts, dir * 1.3));
      const mesh = buildShape(scene, mats, (b) => carShape(b, colours[i % colours.length]), 'traffic');
      this.cars.push({ mesh, route, s: rnd() * route.len, speed: 9 + rnd() * 3, dir });
    }
    this.postman = new Person(scene, mats, { uniform: '#2a4d8f' });
    this.postRoute = new Route([{ x: -40, z: -1.6 }, { x: 50, z: -1.6 }]);
    this.lorry = buildShape(scene, mats, (b) => {
      b.box(2.4, 2.4, 6.2, '#2f8f5b', 0, 0.6, -0.8);
      b.box(2.3, 1.9, 1.8, '#f4f1ea', 0, 0.6, 3.1);
      b.box(2.1, 0.7, 0.05, '#9fc9e0', 0, 1.6, 4.0);
      for (const z of [-2.6, 0.2, 3.0]) for (const x of [-1.15, 1.15]) { const w = b.cyl(0.9, 0.9, 0.35, '#22252b', x, 0.45, z, 12); w.rotation.z = Math.PI / 2; }
      b.box(2.4, 0.15, 6.25, '#f2c14e', 0, 2.1, -0.8);
    }, 'binLorry');
    this.lorryRoute = new Route([{ x: -60, z: -5.6 }, { x: 52, z: -5.6 }]);
    // The school run: from the streets to the school gate.
    const gate = { x: (SCHOOL.x0 + SCHOOL.x1) / 2, z: SCHOOL_GROUNDS.z1 + 1 };
    const starts: P[][] = [
      [{ x: -30, z: -2 }, { x: -18, z: -2 }, { x: -18, z: -29 }, { x: gate.x, z: -29 }, gate],
      [{ x: -16, z: 30 }, { x: -13.5, z: 0 }, { x: -13.5, z: -29 }, { x: gate.x, z: -29 }, gate],
      [{ x: -60, z: -29.5 }, { x: gate.x - 2, z: -29.5 }, gate],
      [{ x: 49, z: 20 }, { x: 49, z: -29 }, { x: gate.x + 2, z: -29 }, gate],
      [{ x: 10, z: -2 }, { x: -18.5, z: -2 }, { x: -18.5, z: -30 }, { x: gate.x, z: -30 }, gate],
      [{ x: 49, z: -80 }, { x: 49, z: -30 }, { x: gate.x + 1, z: -30 }, gate],
    ];
    for (let i = 0; i < 8; i++) {
      const kid = new Person(scene, mats, { kid: true, uniform: pickC(['#2a4d8f', '#9b2f3a', '#2f5d50']) });
      kid.root.getChildMeshes().forEach((m) => { m.isPickable = false; });
      this.kids.push({ person: kid, route: new Route(starts[i % starts.length]) });
    }
    this.postman.root.getChildMeshes().forEach((m) => { m.isPickable = false; });
  }

  /** People out right now, by time of day. */
  private crowd(hour: number, weekend: boolean): number {
    if (hour < 6) return 0;
    if (hour < 7) return 2;
    if (hour < 9) return weekend ? 5 : 9;
    if (hour < 18) return weekend ? 14 : 11;
    if (hour < 21) return 8;
    if (hour < 23) return 3;
    return 1;
  }

  update(game: Game | null, dt: number, speed: number, camTarget: Vector3) {
    const all = [...this.walkers.map((w) => w.person), this.postman, ...this.kids.map((k) => k.person)];
    if (!game) { for (const p of all) p.show(false); for (const c of this.cars) c.mesh.setEnabled(false); this.lorry.setEnabled(false); return; }
    const st = game.state;
    const t = st.time;
    const gdt = dt * Math.max(0, speed) * 0.9; // game minutes this frame (roughly)
    this.time += dt;
    const hour = game.hour + game.minuteOfDay % 60 / 60;
    const weekend = game.weekday >= 5;
    const near = (p: P, r = 75) => Math.abs(p.x - camTarget.x) < r && Math.abs(p.z - camTarget.z) < r;
    const anim = Math.max(0.6, speed) * 6;

    // Walkers ping-pong along their pavements.
    const n = this.crowd(hour, weekend);
    for (const w of this.walkers) {
      const active = w.minActive < n;
      const d = ((t * w.speed * 60 / 60 + w.phase) % (w.route.len * 2));
      const fwd = d < w.route.len;
      const at = w.route.at(fwd ? d : w.route.len * 2 - d);
      const dir = at.dir + (fwd ? 0 : Math.PI);
      const show = active && near(at.p);
      w.person.show(show);
      if (show) w.person.place(at.p, dir, speed > 0, dt, anim * (w.speed > 3 ? 1.6 : 1));
      if (w.dog) {
        w.dog.setVisible(show);
        if (show) {
          const behind = w.route.at(fwd ? d - 1.4 : w.route.len * 2 - d + 1.4);
          w.dog.root.position.set(behind.p.x + 0.5, 0, behind.p.z);
          w.dog.root.rotation.y = dir;
          w.dog.pose(speed > 0 ? 'walk' : 'sit', this.time, dt * Math.max(1, speed), Math.max(1, speed));
        }
      }
    }

    // Cars, which wait for Sims crossing the road.
    const sims = st.sims.filter((s) => game.present(s)).map((s: Sim) => (s.location === 'town' ? { x: s.pos.x + TOWN_ORIGIN.x, z: s.pos.z + TOWN_ORIGIN.z } : s.pos));
    const traffic = hour >= 6 && hour < 23 ? (hour >= 7 && hour < 19 ? 6 : 3) : 1;
    this.cars.forEach((c, i) => {
      const on = i < traffic;
      const s = c.dir > 0 ? c.s : c.route.len - c.s;
      const at = c.route.at(s);
      const dir = at.dir + (c.dir > 0 ? 0 : Math.PI);
      const ahead = { x: at.p.x + Math.sin(dir) * 4, z: at.p.z + Math.cos(dir) * 4 };
      const blocked = sims.some((p) => Math.hypot(p.x - ahead.x, p.z - ahead.z) < 3.2 || Math.hypot(p.x - at.p.x, p.z - at.p.z) < 2.6);
      if (!blocked) c.s += gdt * c.speed * 1.1;
      if (c.s > c.route.len) c.s = 0;
      const show = on && near(at.p, 90);
      c.mesh.setEnabled(show);
      if (show) { c.mesh.position.set(at.p.x, 0, at.p.z); c.mesh.rotation.y = dir; }
    });

    // The postman: weekday mornings along Larkfield Close, stopping at each door.
    const postOn = game.weekday < 6 && hour >= 8 && hour < 11;
    if (postOn) {
      const mins = (hour - 8) * 60;
      const walked = mins * 0.6;
      const stop = (walked % 6) < 1.2;
      const at = this.postRoute.at(Math.min(this.postRoute.len, walked - Math.floor(walked / 6) * 1.2));
      this.postman.show(near(at.p));
      this.postman.place(at.p, stop ? Math.PI : at.dir, !stop && speed > 0, dt, anim);
    } else this.postman.show(false);

    // Thursday morning: the bin lorry.
    const binDay = game.weekday === 3 && hour >= 7 && hour < 8;
    if (binDay) {
      const k = (hour - 7) * 60;
      const at = this.lorryRoute.at(this.lorryRoute.len - (k / 60) * this.lorryRoute.len);
      this.lorry.setEnabled(near(at.p, 90));
      this.lorry.position.set(at.p.x, 0, at.p.z);
      this.lorry.rotation.y = -Math.PI / 2;
    } else this.lorry.setEnabled(false);

    // The school run (not at weekends or in the summer holidays).
    const termTime = game.weekday < 5 && calendarOf(game.day).season.id !== 'summer';
    const morning = hour >= 8.25 && hour < 8.95, home = hour >= 15.1 && hour < 15.8;
    this.kids.forEach((k, i) => {
      if (!termTime || !(morning || home)) { k.person.show(false); return; }
      const start = morning ? 8.25 + (i % 4) * 0.05 : 15.1 + (i % 4) * 0.05;
      const prog = Math.min(1, Math.max(0, (hour - start) / 0.55));
      const d = (morning ? prog : 1 - prog) * k.route.len;
      const at = k.route.at(d);
      const visible = prog > 0 && prog < 1 && near(at.p);
      k.person.show(visible);
      if (visible) k.person.place({ x: at.p.x + ((i % 3) - 1) * 0.5, z: at.p.z }, at.dir + (morning ? 0 : Math.PI), speed > 0, dt, anim);
    });
  }
}
