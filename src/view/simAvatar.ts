// A procedurally built, procedurally animated Sim. One base body; hair, face and outfits are
// separate parts tinted in code, which is what makes create-a-Sim possible without modelling every combination.
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AnimId, Appearance } from '../sim/types';
import { hex } from './materials';

const THIGH = 0.42, SHIN = 0.4, FOOT_H = 0.06, HIP_H = THIGH + SHIN + FOOT_H;
const TORSO_H = 0.52, HEAD_D = 0.42, UPPER_ARM = 0.28, LOWER_ARM = 0.25;

interface Limb { root: TransformNode; mid: TransformNode; upper: Mesh; lower: Mesh; end: Mesh }

export interface PoseInput {
  anim: AnimId;
  seated: boolean;
  seatHeight: number;
  time: number;      // seconds
  speed: number;     // animation speed multiplier
  blinkSeed: number;
}

function mat(scene: Scene, name: string, color: string, spec = 0.05): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = hex(color);
  m.specularColor = new Color3(spec, spec, spec);
  m.maxSimultaneousLights = 8;
  return m;
}

export class SimAvatar {
  readonly root: TransformNode;
  private body: TransformNode;
  private spine: TransformNode;
  private head: TransformNode;
  private arms: Limb[] = [];
  private legs: Limb[] = [];
  private eyes: TransformNode[] = [];
  private meshes: Mesh[] = [];
  private mats: StandardMaterial[] = [];
  private skirt: Mesh | null = null;
  private props: Record<string, Mesh> = {};
  readonly ring: Mesh;
  private appearanceKey = '';
  private walkPhase = 0;

  constructor(private scene: Scene, public simId: number, appearance: Appearance, private shadowCaster?: (m: Mesh) => void) {
    this.root = new TransformNode(`sim${simId}`, scene);
    this.body = new TransformNode('body', scene);
    this.body.parent = this.root;
    this.spine = new TransformNode('spine', scene);
    this.head = new TransformNode('head', scene);
    this.ring = MeshBuilder.CreateTorus('ring', { diameter: 0.75, thickness: 0.06, tessellation: 24 }, scene);
    this.ring.parent = this.root;
    this.ring.position.y = 0.03;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
    this.build(appearance);
  }

  private add(m: Mesh, parent: TransformNode, material: StandardMaterial): Mesh {
    m.parent = parent;
    m.material = material;
    m.metadata = { kind: 'sim', id: this.simId };
    this.meshes.push(m);
    this.shadowCaster?.(m);
    return m;
  }

  setAppearance(a: Appearance): void {
    const key = JSON.stringify(a);
    if (key === this.appearanceKey) return;
    for (const m of this.meshes) m.dispose();
    for (const m of this.mats) m.dispose();
    for (const p of Object.values(this.props)) p.dispose();
    this.meshes = [];
    this.mats = [];
    this.props = {};
    this.arms = [];
    this.legs = [];
    this.eyes = [];
    this.skirt = null;
    for (const child of this.body.getChildren()) if (child !== this.ring) child.dispose();
    this.spine = new TransformNode('spine', this.scene);
    this.head = new TransformNode('head', this.scene);
    this.build(a);
  }

  private build(a: Appearance): void {
    this.appearanceKey = JSON.stringify(a);
    const s = this.scene;
    const skin = mat(s, 'skin', a.skin);
    const hair = mat(s, 'hair', a.hairColor, 0.12);
    const top = mat(s, 'top', a.topColor);
    const bottom = mat(s, 'bottom', a.bottomColor);
    const shoe = mat(s, 'shoe', a.shoeColor, 0.15);
    const eyeWhite = mat(s, 'eyeW', '#fbfbf8', 0.3);
    const iris = mat(s, 'iris', a.eyeColor, 0.4);
    const lip = mat(s, 'lip', '#b5524f');
    const freckle = mat(s, 'freckle', '#a0623e');
    this.mats.push(skin, hair, top, bottom, shoe, eyeWhite, iris, lip, freckle);

    const width = a.body === 'slim' ? 0.29 : a.body === 'broad' ? 0.42 : 0.35;
    const depth = a.body === 'slim' ? 0.19 : a.body === 'broad' ? 0.25 : 0.21;
    this.root.scaling.setAll(a.height);
    this.body.position.y = HIP_H;

    // Torso and pelvis.
    const pelvis = MeshBuilder.CreateSphere('pelvis', { diameter: 1, segments: 8 }, s);
    pelvis.scaling.set(width * 0.95, 0.24, depth * 1.05);
    pelvis.position.y = 0.02;
    this.add(pelvis, this.body, a.top === 'dress' ? top : bottom);
    this.spine.parent = this.body;
    this.spine.position.y = 0.05;
    const torso = MeshBuilder.CreateCapsule('torso', { radius: 0.5, height: 2, tessellation: 10 }, s);
    torso.scaling.set(width, TORSO_H / 2, depth);
    torso.position.y = TORSO_H / 2;
    this.add(torso, this.spine, top);
    if (a.top === 'hoodie') {
      const hood = MeshBuilder.CreateSphere('hood', { diameter: 1, segments: 8, slice: 0.6 }, s);
      hood.scaling.set(width * 0.85, 0.16, depth * 1.1);
      hood.position.set(0, TORSO_H - 0.02, -0.06);
      hood.rotation.x = -0.4;
      this.add(hood, this.spine, top);
      const pocket = MeshBuilder.CreateBox('pocket', { width: width * 0.6, height: 0.1, depth: 0.02 }, s);
      pocket.position.set(0, 0.12, depth / 2 + 0.005);
      this.add(pocket, this.spine, mat(s, 'pocket', shadeHex(a.topColor, 0.85)));
    }
    if (a.top === 'jumper') {
      const collar = MeshBuilder.CreateTorus('collar', { diameter: 0.17, thickness: 0.05, tessellation: 12 }, s);
      collar.position.y = TORSO_H - 0.01;
      this.add(collar, this.spine, mat(s, 'collar', shadeHex(a.topColor, 0.8)));
    }
    const neck = MeshBuilder.CreateCylinder('neck', { diameter: 0.11, height: 0.12, tessellation: 8 }, s);
    neck.position.y = TORSO_H + 0.03;
    this.add(neck, this.spine, skin);

    // Head and face.
    this.head.parent = this.spine;
    this.head.position.y = TORSO_H + 0.08;
    const headMesh = MeshBuilder.CreateSphere('headm', { diameter: HEAD_D, segments: 10 }, s);
    headMesh.position.y = HEAD_D / 2;
    headMesh.scaling.set(0.95, 1.02, 0.98);
    this.add(headMesh, this.head, skin);
    const f = [
      { sp: 0.075, size: 0.07, mouth: 0.08 },
      { sp: 0.085, size: 0.078, mouth: 0.07 },
      { sp: 0.07, size: 0.06, mouth: 0.09 },
      { sp: 0.08, size: 0.085, mouth: 0.06 },
    ][a.face % 4];
    for (const side of [-1, 1]) {
      const eye = new TransformNode('eye', s);
      eye.parent = this.head;
      eye.position.set(side * f.sp, HEAD_D * 0.52, HEAD_D * 0.43);
      const white = MeshBuilder.CreateSphere('eyew', { diameter: f.size, segments: 6 }, s);
      white.scaling.set(1, 1.1, 0.5);
      this.add(white, eye, eyeWhite);
      const ir = MeshBuilder.CreateSphere('iris', { diameter: f.size * 0.62, segments: 6 }, s);
      ir.position.z = f.size * 0.2;
      ir.scaling.set(1, 1.1, 0.5);
      this.add(ir, eye, iris);
      this.eyes.push(eye);
      const brow = MeshBuilder.CreateBox('brow', { width: f.size * 1.1, height: 0.016, depth: 0.02 }, s);
      brow.position.set(side * f.sp, HEAD_D * 0.52 + f.size * 0.85, HEAD_D * 0.44);
      brow.rotation.z = side * -0.12;
      this.add(brow, this.head, hair);
      if (a.freckles) {
        for (let i = 0; i < 3; i++) {
          const fr = MeshBuilder.CreateSphere('fr', { diameter: 0.014, segments: 3 }, s);
          fr.position.set(side * (f.sp + 0.012 * (i - 1)), HEAD_D * 0.4 + (i % 2) * 0.012, HEAD_D * 0.46);
          this.add(fr, this.head, freckle);
        }
      }
    }
    const nose = MeshBuilder.CreateSphere('nose', { diameter: 0.045, segments: 5 }, s);
    nose.position.set(0, HEAD_D * 0.42, HEAD_D * 0.49);
    this.add(nose, this.head, mat(s, 'nose', shadeHex(a.skin, 0.93)));
    const smile: Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const u = (i / 6 - 0.5) * 2;
      smile.push(new Vector3(u * f.mouth * 0.5, HEAD_D * 0.3 - (1 - u * u) * 0.018, HEAD_D * 0.47 - Math.abs(u) * 0.015));
    }
    const mouth = MeshBuilder.CreateTube('mouth', { path: smile, radius: 0.009, tessellation: 6, cap: 2 }, s);
    this.add(mouth, this.head, lip);

    this.buildHair(a.hairStyle, hair);

    // Arms: index 0 = right (+x), 1 = left (-x).
    const longSleeve = a.top !== 'tshirt' && a.top !== 'dress';
    for (const side of [1, -1]) {
      const root = new TransformNode('shoulder', s);
      root.parent = this.spine;
      root.position.set(side * (width / 2 + 0.03), TORSO_H - 0.07, 0);
      const upper = MeshBuilder.CreateCapsule('uarm', { radius: 0.052, height: UPPER_ARM + 0.06, tessellation: 8 }, s);
      upper.position.y = -UPPER_ARM / 2;
      this.add(upper, root, a.top === 'dress' ? skin : top);
      const mid = new TransformNode('elbow', s);
      mid.parent = root;
      mid.position.y = -UPPER_ARM;
      const lower = MeshBuilder.CreateCapsule('larm', { radius: 0.046, height: LOWER_ARM + 0.05, tessellation: 8 }, s);
      lower.position.y = -LOWER_ARM / 2;
      this.add(lower, mid, longSleeve ? top : skin);
      const hand = MeshBuilder.CreateSphere('hand', { diameter: 0.1, segments: 6 }, s);
      hand.position.y = -LOWER_ARM - 0.03;
      this.add(hand, mid, skin);
      this.arms.push({ root, mid, upper, lower, end: hand });
    }
    // Legs.
    const skirtLike = a.top === 'dress' || a.bottom === 'skirt';
    const thighMat = skirtLike ? skin : bottom;
    const shinMat = a.bottom === 'trousers' && a.top !== 'dress' ? bottom : skin;
    for (const side of [1, -1]) {
      const root = new TransformNode('hip', s);
      root.parent = this.body;
      root.position.set(side * width * 0.27, 0, 0);
      const upper = MeshBuilder.CreateCapsule('thigh', { radius: 0.075, height: THIGH + 0.08, tessellation: 8 }, s);
      upper.position.y = -THIGH / 2;
      this.add(upper, root, thighMat);
      const mid = new TransformNode('knee', s);
      mid.parent = root;
      mid.position.y = -THIGH;
      const lower = MeshBuilder.CreateCapsule('shin', { radius: 0.06, height: SHIN + 0.04, tessellation: 8 }, s);
      lower.position.y = -SHIN / 2;
      this.add(lower, mid, shinMat);
      const foot = MeshBuilder.CreateBox('foot', { width: 0.12, height: FOOT_H + 0.02, depth: 0.23 }, s);
      foot.position.set(0, -SHIN - FOOT_H / 2 + 0.01, 0.05);
      this.add(foot, mid, shoe);
      this.legs.push({ root, mid, upper, lower, end: foot });
    }
    if (skirtLike) {
      const skirt = MeshBuilder.CreateCylinder('skirt', { diameterTop: width * 1.0, diameterBottom: width * 1.7, height: a.top === 'dress' ? 0.45 : 0.36, tessellation: 12 }, s);
      skirt.position.y = a.top === 'dress' ? -0.17 : -0.12;
      this.skirt = this.add(skirt, this.body, a.top === 'dress' ? top : bottom);
    }
  }

  private buildHair(style: string, hair: StandardMaterial): void {
    const s = this.scene;
    const R = HEAD_D / 2;
    const cy = HEAD_D / 2;
    const cap = (scale: number, yOff: number, zOff: number, slice = 0.62) => {
      const m = MeshBuilder.CreateSphere('hair', { diameter: HEAD_D * scale, segments: 10, slice }, s);
      m.position.set(0, cy + yOff, zOff);
      m.rotation.x = -0.35;
      return this.add(m, this.head, hair);
    };
    const blob = (d: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const m = MeshBuilder.CreateSphere('hairb', { diameter: d, segments: 6 }, s);
      m.position.set(x, y, z);
      m.scaling.set(sx, sy, sz);
      return this.add(m, this.head, hair);
    };
    switch (style) {
      case 'bald': return;
      case 'buzz': cap(1.03, 0.01, -0.01, 0.55); return;
      case 'short': cap(1.1, 0.02, -0.02); blob(0.3, 0, cy + 0.02, -0.08, 1.2, 1, 0.9); return;
      case 'quiff': cap(1.08, 0.01, -0.02); blob(0.2, 0, cy + R * 0.95, R * 0.45, 1.3, 0.7, 1.2); return;
      case 'bob': {
        cap(1.12, 0.02, -0.02);
        blob(HEAD_D * 1.1, 0, cy - 0.02, -0.04, 1.02, 0.85, 0.95);
        return;
      }
      case 'long': {
        cap(1.12, 0.02, -0.02);
        const back = MeshBuilder.CreateBox('hairl', { width: HEAD_D * 0.95, height: 0.55, depth: 0.12 }, s);
        back.position.set(0, cy - 0.22, -R * 0.75);
        this.add(back, this.head, hair);
        blob(0.16, R * 0.8, cy - 0.12, -0.02, 0.6, 2.2, 0.8);
        blob(0.16, -R * 0.8, cy - 0.12, -0.02, 0.6, 2.2, 0.8);
        return;
      }
      case 'ponytail': {
        cap(1.1, 0.02, -0.02);
        blob(0.13, 0, cy + 0.08, -R - 0.02);
        const tail = MeshBuilder.CreateCapsule('tail', { radius: 0.06, height: 0.38, tessellation: 8 }, s);
        tail.position.set(0, cy - 0.12, -R - 0.08);
        tail.rotation.x = 0.25;
        this.add(tail, this.head, hair);
        return;
      }
      case 'buns': cap(1.08, 0.02, -0.02); blob(0.16, R * 0.7, cy + R * 0.85, -0.02); blob(0.16, -R * 0.7, cy + R * 0.85, -0.02); return;
      case 'curly': {
        cap(1.12, 0.03, -0.02);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          blob(0.13, Math.sin(a) * R * 0.95, cy + 0.05 + Math.cos(a * 2) * 0.04, Math.cos(a) * R * 0.85 - 0.04);
        }
        return;
      }
      case 'afro': blob(HEAD_D * 1.5, 0, cy + 0.08, -0.05, 1, 0.92, 1); return;
      case 'braids': {
        cap(1.1, 0.02, -0.02);
        for (const side of [-1, 1]) {
          for (let i = 0; i < 4; i++) blob(0.07, side * R * 0.85, cy - 0.05 - i * 0.07, 0.02, 1, 1.1, 1);
        }
        return;
      }
      default: cap(1.1, 0.02, -0.02);
    }
  }

  private prop(name: string): Mesh {
    let p = this.props[name];
    if (p) return p;
    const s = this.scene;
    if (name === 'book') {
      p = MeshBuilder.CreateBox('book', { width: 0.22, height: 0.16, depth: 0.04 }, s);
      p.material = mat(s, 'bookm', '#2e86c1');
      p.parent = this.spine;
      p.position.set(0, 0.18, 0.32);
      p.rotation.x = -0.6;
    } else if (name === 'phone') {
      p = MeshBuilder.CreateBox('phone', { width: 0.05, height: 0.1, depth: 0.015 }, s);
      p.material = mat(s, 'phonem', '#222');
      p.parent = this.arms[0].mid;
      p.position.set(-0.03, -LOWER_ARM - 0.05, 0.03);
    } else if (name === 'guitar') {
      p = MeshBuilder.CreateSphere('pguitar', { diameter: 0.32, segments: 6 }, s);
      p.scaling.set(1, 1.25, 0.35);
      p.material = mat(s, 'guitm', '#c77b3a');
      p.parent = this.spine;
      p.position.set(-0.05, 0.12, 0.2);
      p.rotation.z = 1.0;
      const neck = MeshBuilder.CreateBox('pgneck', { width: 0.05, height: 0.55, depth: 0.03 }, s);
      neck.material = mat(s, 'guitn', '#6b4529');
      neck.parent = p;
      neck.position.y = 0.42;
      neck.scaling.set(1, 0.8, 2.8);
    } else {
      p = MeshBuilder.CreateBox('fork', { width: 0.02, height: 0.12, depth: 0.02 }, s);
      p.material = mat(s, 'forkm', '#c0c4c9');
      p.parent = this.arms[0].mid;
      p.position.set(0, -LOWER_ARM - 0.08, 0.02);
    }
    p.isPickable = false;
    this.props[name] = p;
    return p;
  }

  private showProps(names: string[]): void {
    for (const n of ['book', 'phone', 'guitar', 'fork']) {
      if (names.includes(n)) this.prop(n).setEnabled(true);
      else this.props[n]?.setEnabled(false);
    }
  }

  setVisible(v: boolean): void { this.root.setEnabled(v); }

  setSelected(on: boolean, color: string): void {
    this.ring.setEnabled(on);
    if (on) {
      const m = (this.ring.material as StandardMaterial) ?? new StandardMaterial('ringm', this.scene);
      m.diffuseColor = hex(color);
      m.emissiveColor = hex(color).scale(0.7);
      m.disableLighting = false;
      this.ring.material = m;
    }
  }

  /** Apply the pose for this frame. */
  pose(p: PoseInput, dt: number): void {
    const t = p.time;
    const sp = p.speed;
    const [ra, la] = this.arms;
    const [rl, ll] = this.legs;
    // Reset.
    this.body.position.set(0, HIP_H, 0);
    this.body.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    for (const l of [...this.arms, ...this.legs]) { l.root.rotation.set(0, 0, 0); l.mid.rotation.set(0, 0, 0); }
    ra.root.rotation.z = 0.08; la.root.rotation.z = -0.08;
    if (this.skirt) this.skirt.scaling.set(1, 1, 1);
    const props: string[] = [];

    // Blinking.
    const blink = ((t + p.blinkSeed) % 4) < 0.12 ? 0.1 : 1;
    for (const e of this.eyes) e.scaling.y = blink;

    const sitLegs = (h: number) => {
      this.body.position.y = h + 0.08;
      const low = h < 0.3;
      for (const l of this.legs) { l.root.rotation.x = -Math.PI / 2; l.mid.rotation.x = low ? 0.1 : Math.PI / 2; }
      if (this.skirt) this.skirt.scaling.set(1, 0.5, 1);
    };

    if (p.anim === 'sleep') {
      this.body.rotation.x = -Math.PI / 2;
      this.body.position.y = p.seatHeight + 0.14;
      this.body.position.z = 0.0;
      ra.root.rotation.z = 0.15; la.root.rotation.z = -0.15;
      for (const e of this.eyes) e.scaling.y = 0.1;
      this.head.rotation.x = -0.15;
      this.showProps([]);
      return;
    }

    if (p.seated) sitLegs(p.seatHeight);

    switch (p.anim) {
      case 'walk':
      case 'run': {
        const run = p.anim === 'run';
        this.walkPhase += dt * sp * (run ? 13 : 8.5);
        const ph = this.walkPhase;
        const amp = run ? 0.75 : 0.45;
        this.legs.forEach((l, i) => {
          const o = ph + i * Math.PI;
          l.root.rotation.x = -Math.sin(o) * amp;
          l.mid.rotation.x = (1 - Math.cos(o)) * (run ? 0.6 : 0.3);
        });
        this.arms.forEach((a, i) => {
          const o = ph + i * Math.PI;
          a.root.rotation.x = Math.sin(o) * amp * 0.8;
          a.mid.rotation.x = run ? -1.3 : -0.25;
        });
        this.body.position.y = HIP_H + Math.abs(Math.sin(ph)) * (run ? 0.06 : 0.025);
        if (run) this.spine.rotation.x = 0.15;
        break;
      }
      case 'idle':
      case 'watch': {
        const br = Math.sin(t * 1.6) * 0.02;
        this.spine.rotation.x = br;
        this.head.rotation.y = Math.sin(t * 0.3 + p.blinkSeed) * 0.25;
        if (p.seated) { ra.root.rotation.x = la.root.rotation.x = -0.6; ra.mid.rotation.x = la.mid.rotation.x = -0.5; }
        if (p.anim === 'watch') this.head.rotation.x = -0.05;
        break;
      }
      case 'sit':
        ra.root.rotation.x = la.root.rotation.x = -0.55;
        ra.mid.rotation.x = la.mid.rotation.x = -0.6;
        this.head.rotation.y = Math.sin(t * 0.4 + p.blinkSeed) * 0.3;
        break;
      case 'talk': {
        ra.root.rotation.x = -0.45 + Math.sin(t * 3.1 * sp) * 0.3;
        ra.mid.rotation.x = -0.9 + Math.sin(t * 2.3 * sp) * 0.3;
        la.root.rotation.x = -0.25 + Math.sin(t * 2.7 * sp + 1) * 0.2;
        la.mid.rotation.x = -0.6;
        this.head.rotation.x = Math.sin(t * 4 * sp) * 0.07;
        this.head.rotation.z = Math.sin(t * 1.3) * 0.05;
        break;
      }
      case 'dance': {
        const b = Math.sin(t * 8 * sp);
        this.body.position.y += Math.abs(b) * 0.06;
        this.spine.rotation.y = Math.sin(t * 4 * sp) * 0.35;
        ra.root.rotation.z = 2.3 + b * 0.4; la.root.rotation.z = -2.3 + b * 0.4;
        ra.mid.rotation.x = la.mid.rotation.x = -0.5;
        this.legs.forEach((l, i) => { l.root.rotation.x = -Math.max(0, Math.sin(t * 8 * sp + i * Math.PI)) * 0.4; l.mid.rotation.x = Math.max(0, Math.sin(t * 8 * sp + i * Math.PI)) * 0.6; });
        this.head.rotation.z = b * 0.12;
        break;
      }
      case 'workout': {
        const j = (Math.sin(t * 7 * sp) + 1) / 2;
        ra.root.rotation.z = 0.2 + j * 2.6; la.root.rotation.z = -(0.2 + j * 2.6);
        rl.root.rotation.z = j * 0.2; ll.root.rotation.z = -j * 0.2;
        this.body.position.y += j * 0.05;
        break;
      }
      case 'cook':
      case 'use': {
        ra.root.rotation.x = -1.0 + Math.sin(t * 5 * sp) * 0.18;
        la.root.rotation.x = -1.0 + Math.sin(t * 5 * sp + 2) * 0.18;
        ra.mid.rotation.x = la.mid.rotation.x = -0.6;
        this.head.rotation.x = 0.25;
        if (p.seated) { this.spine.rotation.x = 0.1; }
        break;
      }
      case 'guitar': {
        props.push('guitar');
        ra.root.rotation.x = -0.5; ra.mid.rotation.x = -1.3 + Math.sin(t * 9 * sp) * 0.2; ra.root.rotation.z = 0.2;
        la.root.rotation.x = -0.9; la.root.rotation.z = -0.5; la.mid.rotation.x = -1.2;
        this.head.rotation.x = 0.2;
        this.head.rotation.z = Math.sin(t * 2) * 0.08;
        break;
      }
      case 'piano': {
        ra.root.rotation.x = -1.15; la.root.rotation.x = -1.15;
        ra.mid.rotation.x = -0.5 + Math.sin(t * 7 * sp) * 0.12; la.mid.rotation.x = -0.5 + Math.sin(t * 6 * sp + 1) * 0.12;
        this.head.rotation.z = Math.sin(t * 1.5) * 0.1;
        break;
      }
      case 'paint': {
        ra.root.rotation.x = -1.5 + Math.sin(t * 3 * sp) * 0.3; ra.mid.rotation.x = -0.3; ra.root.rotation.z = Math.sin(t * 2.2) * 0.2;
        la.root.rotation.x = -0.6; la.mid.rotation.x = -1.0;
        this.head.rotation.x = -0.05;
        break;
      }
      case 'read': {
        props.push('book');
        ra.root.rotation.x = la.root.rotation.x = -0.9;
        ra.mid.rotation.x = la.mid.rotation.x = -1.0;
        ra.root.rotation.z = -0.2; la.root.rotation.z = 0.2;
        this.head.rotation.x = 0.3;
        break;
      }
      case 'eat': {
        props.push('fork');
        const up = Math.max(0, Math.sin(t * 2.5 * sp));
        ra.root.rotation.x = -0.6 - up * 0.6; ra.mid.rotation.x = -1.2 - up * 0.9;
        la.root.rotation.x = -0.6; la.mid.rotation.x = -0.8;
        this.head.rotation.x = 0.15 - up * 0.1;
        break;
      }
      case 'shower': {
        ra.root.rotation.x = la.root.rotation.x = -2.5;
        ra.mid.rotation.x = -1.3 + Math.sin(t * 6 * sp) * 0.3; la.mid.rotation.x = -1.3 + Math.sin(t * 6 * sp + 1) * 0.3;
        ra.root.rotation.z = 0.5; la.root.rotation.z = -0.5;
        this.head.rotation.x = -0.2;
        break;
      }
      case 'garden': {
        this.body.position.y = 0.48;
        for (const l of this.legs) { l.root.rotation.x = -0.25; l.mid.rotation.x = 1.75; }
        this.spine.rotation.x = 0.45;
        ra.root.rotation.x = -0.6 + Math.sin(t * 4 * sp) * 0.25; la.root.rotation.x = -0.5 + Math.sin(t * 4 * sp + 2) * 0.25;
        this.head.rotation.x = 0.3;
        if (this.skirt) this.skirt.scaling.set(1, 0.6, 1);
        break;
      }
      case 'phone': {
        props.push('phone');
        ra.root.rotation.x = -0.35; ra.root.rotation.z = 0.35; ra.mid.rotation.x = -2.5;
        la.root.rotation.x = -0.2;
        this.head.rotation.z = -0.12;
        this.head.rotation.y = Math.sin(t * 0.7) * 0.2;
        break;
      }
      case 'wave':
      case 'cheer': {
        ra.root.rotation.z = 2.6 + Math.sin(t * 8 * sp) * 0.25; ra.mid.rotation.z = 0;
        if (p.anim === 'cheer') la.root.rotation.z = -2.6 - Math.sin(t * 8 * sp) * 0.25;
        this.body.position.y += p.anim === 'cheer' ? Math.abs(Math.sin(t * 6)) * 0.05 : 0;
        break;
      }
      case 'think': {
        ra.root.rotation.x = -0.65; ra.mid.rotation.x = -2.2; ra.root.rotation.z = -0.15;
        la.root.rotation.x = -0.4; la.mid.rotation.x = -1.3; la.root.rotation.z = 0.3;
        this.head.rotation.z = 0.12; this.head.rotation.x = -0.1;
        break;
      }
      case 'sad': {
        this.head.rotation.x = 0.4;
        this.spine.rotation.x = 0.15;
        break;
      }
    }
    this.showProps(props);
  }

  dispose(): void {
    this.root.dispose(false, true);
    for (const m of this.mats) m.dispose();
  }
}

function shadeHex(c: string, f: number): string {
  const col = hex(c).scale(f);
  return new Color3(Math.min(1, col.r), Math.min(1, col.g), Math.min(1, col.b)).toHexString();
}
