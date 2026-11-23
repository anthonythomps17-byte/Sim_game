// Low-poly pets built from primitives, with simple procedural animation.
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Pet, PetAnim } from '../sim/types';
import { hex } from './materials';

function mat(scene: Scene, color: string, spec = 0.05): StandardMaterial {
  const m = new StandardMaterial('petm', scene);
  m.diffuseColor = hex(color);
  m.specularColor = new Color3(spec, spec, spec);
  m.maxSimultaneousLights = 8;
  return m;
}

function shade(c: string, f: number): string {
  const col = hex(c).scale(f);
  return new Color3(Math.min(1, col.r), Math.min(1, col.g), Math.min(1, col.b)).toHexString();
}

export class PetAvatar {
  readonly root: TransformNode;
  private body: TransformNode;
  private head: TransformNode | null = null;
  private tail: TransformNode | null = null;
  private legs: TransformNode[] = [];
  private ears: TransformNode[] = [];
  private mats: StandardMaterial[] = [];
  private meshes: Mesh[] = [];
  private phase = 0;
  private baseY = 0;

  constructor(private scene: Scene, readonly pet: Pet, private meta: Record<string, unknown>, private shadowCaster?: (m: Mesh) => void) {
    this.root = new TransformNode(`pet${pet.id}`, scene);
    this.body = new TransformNode('pbody', scene);
    this.body.parent = this.root;
    switch (pet.species) {
      case 'dog': this.quadruped(0.52, 0.14, 0.3, 0.12, 'dog'); break;
      case 'cat': this.quadruped(0.4, 0.105, 0.17, 0.09, 'cat'); break;
      case 'parrot': this.parrot(); break;
      case 'rabbit': this.rabbit(); break;
      default: this.hamster();
    }
  }

  private m(color: string, spec = 0.05) { const x = mat(this.scene, color, spec); this.mats.push(x); return x; }

  private add(mesh: Mesh, parent: TransformNode, material: StandardMaterial): Mesh {
    mesh.parent = parent;
    mesh.material = material;
    mesh.metadata = this.meta;
    this.meshes.push(mesh);
    this.shadowCaster?.(mesh);
    return mesh;
  }

  private node(name: string, parent: TransformNode, x: number, y: number, z: number): TransformNode {
    const n = new TransformNode(name, this.scene);
    n.parent = parent;
    n.position.set(x, y, z);
    return n;
  }

  private eyes(parent: TransformNode, spread: number, y: number, z: number, size: number) {
    const black = this.m('#151515', 0.6);
    for (const side of [-1, 1]) {
      const e = MeshBuilder.CreateSphere('peye', { diameter: size, segments: 6 }, this.scene);
      e.position.set(side * spread, y, z);
      this.add(e, parent, black);
    }
  }

  private quadruped(len: number, r: number, legLen: number, headD: number, kind: 'dog' | 'cat') {
    const s = this.scene;
    const fur = this.m(this.pet.color);
    const dark = this.m(shade(this.pet.color, 0.7));
    const light = this.m(shade(this.pet.color, 1.25));
    this.baseY = legLen + r * 0.3;
    this.body.position.y = this.baseY;
    const torso = MeshBuilder.CreateCapsule('ptorso', { radius: r, height: len, tessellation: 10 }, s);
    torso.rotation.x = Math.PI / 2;
    this.add(torso, this.body, fur);
    if (kind === 'dog') {
      const chest = MeshBuilder.CreateSphere('pchest', { diameter: r * 1.6, segments: 8 }, s);
      chest.position.set(0, -r * 0.2, len * 0.32);
      this.add(chest, this.body, light);
    }
    // Head.
    this.head = this.node('phead', this.body, 0, r * 0.9, len / 2);
    const head = MeshBuilder.CreateSphere('phm', { diameter: headD * 2, segments: 10 }, s);
    head.scaling.set(1, 0.95, kind === 'dog' ? 1.05 : 0.95);
    this.add(head, this.head, fur);
    const snout = MeshBuilder.CreateSphere('psnout', { diameter: headD * (kind === 'dog' ? 1.1 : 0.8), segments: 8 }, s);
    snout.scaling.set(1, 0.75, kind === 'dog' ? 1.4 : 1);
    snout.position.set(0, -headD * 0.3, headD * 0.85);
    this.add(snout, this.head, light);
    const nose = MeshBuilder.CreateSphere('pnose', { diameter: headD * 0.32, segments: 6 }, s);
    nose.position.set(0, -headD * 0.15, headD * (kind === 'dog' ? 1.45 : 1.15));
    this.add(nose, this.head, this.m(kind === 'dog' ? '#151515' : '#e48a9a'));
    this.eyes(this.head, headD * 0.42, headD * 0.15, headD * 0.82, headD * 0.28);
    for (const side of [-1, 1]) {
      const ear = this.node('pear', this.head, side * headD * 0.6, headD * 0.6, 0);
      if (kind === 'dog') {
        const e = MeshBuilder.CreateSphere('pearm', { diameter: headD * 0.9, segments: 6 }, s);
        e.scaling.set(0.35, 1.1, 0.7);
        e.position.set(side * headD * 0.12, -headD * 0.45, 0);
        this.add(e, ear, dark);
      } else {
        const e = MeshBuilder.CreateCylinder('pearm', { diameterTop: 0, diameterBottom: headD * 0.7, height: headD * 0.75, tessellation: 4 }, s);
        e.position.y = headD * 0.2;
        e.rotation.z = -side * 0.25;
        this.add(e, ear, fur);
      }
      this.ears.push(ear);
    }
    // Legs: front pair then back pair.
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const hip = this.node('pleg', this.body, x * r * 0.55, -r * 0.3, z * len * 0.36);
      const leg = MeshBuilder.CreateCapsule('plegm', { radius: r * 0.32, height: legLen + r * 0.3, tessellation: 6 }, s);
      leg.position.y = -legLen / 2;
      this.add(leg, hip, fur);
      const paw = MeshBuilder.CreateSphere('ppaw', { diameter: r * 0.75, segments: 6 }, s);
      paw.scaling.set(1, 0.6, 1.3);
      paw.position.set(0, -legLen + r * 0.1, r * 0.1);
      this.add(paw, hip, kind === 'dog' ? light : fur);
      this.legs.push(hip);
    }
    // Tail.
    this.tail = this.node('ptail', this.body, 0, r * 0.4, -len / 2 - r * 0.6);
    const tail = MeshBuilder.CreateCapsule('ptailm', { radius: r * (kind === 'dog' ? 0.22 : 0.17), height: kind === 'dog' ? 0.26 : 0.24, tessellation: 6 }, s);
    tail.position.y = kind === 'dog' ? 0.11 : 0.1;
    this.add(tail, this.tail, kind === 'dog' ? fur : dark);
    if (kind === 'cat') {
      const tip = MeshBuilder.CreateCapsule('ptailtip', { radius: r * 0.15, height: 0.18, tessellation: 6 }, s);
      tip.position.set(0, 0.24, 0.05);
      tip.rotation.x = 0.7;
      this.add(tip, this.tail, dark);
    }
    this.tail.rotation.x = kind === 'dog' ? -0.7 : -0.45;
  }

  private parrot() {
    const s = this.scene;
    const feather = this.m(this.pet.color, 0.2);
    const wing = this.m(shade(this.pet.color, 0.72), 0.2);
    this.body.position.y = 0;
    const b = MeshBuilder.CreateSphere('pbody', { diameter: 0.16, segments: 10 }, s);
    b.scaling.set(0.85, 1.25, 0.9);
    b.position.y = 0.1;
    this.add(b, this.body, feather);
    this.head = this.node('phead', this.body, 0, 0.22, 0.02);
    this.add(MeshBuilder.CreateSphere('phm', { diameter: 0.11, segments: 10 }, s), this.head, feather);
    const beak = MeshBuilder.CreateCylinder('pbeak', { diameterTop: 0, diameterBottom: 0.04, height: 0.05, tessellation: 6 }, s);
    beak.rotation.x = Math.PI / 2 + 0.6;
    beak.position.set(0, -0.01, 0.06);
    this.add(beak, this.head, this.m('#3a3a3a'));
    const face = MeshBuilder.CreateSphere('pface', { diameter: 0.05, segments: 6 }, s);
    face.scaling.set(1.6, 1, 0.4);
    face.position.set(0, 0.01, 0.045);
    this.add(face, this.head, this.m('#f4f1ea'));
    this.eyes(this.head, 0.03, 0.015, 0.045, 0.014);
    for (const side of [-1, 1]) {
      const w = MeshBuilder.CreateSphere('pwing', { diameter: 0.14, segments: 6 }, s);
      w.scaling.set(0.3, 1.1, 0.8);
      w.position.set(side * 0.065, 0.1, -0.01);
      this.add(w, this.body, wing);
    }
    this.tail = this.node('ptail', this.body, 0, 0.02, -0.05);
    const t = MeshBuilder.CreateBox('ptailm', { width: 0.05, height: 0.2, depth: 0.015 }, s);
    t.position.y = -0.1;
    this.add(t, this.tail, wing);
    this.tail.rotation.x = 0.3;
  }

  private rabbit() {
    const s = this.scene;
    const fur = this.m(this.pet.color);
    const pink = this.m('#e8a0aa');
    const b = MeshBuilder.CreateSphere('pbody', { diameter: 0.26, segments: 10 }, s);
    b.scaling.set(0.85, 0.85, 1.1);
    b.position.y = 0.11;
    this.add(b, this.body, fur);
    this.head = this.node('phead', this.body, 0, 0.2, 0.12);
    this.add(MeshBuilder.CreateSphere('phm', { diameter: 0.14, segments: 10 }, s), this.head, fur);
    const nose = MeshBuilder.CreateSphere('pnose', { diameter: 0.025, segments: 6 }, s);
    nose.position.set(0, -0.005, 0.07);
    this.add(nose, this.head, pink);
    this.eyes(this.head, 0.04, 0.02, 0.05, 0.02);
    for (const side of [-1, 1]) {
      const ear = this.node('pear', this.head, side * 0.03, 0.06, -0.01);
      const e = MeshBuilder.CreateCapsule('pearm', { radius: 0.022, height: 0.16, tessellation: 6 }, s);
      e.scaling.z = 0.5;
      e.position.y = 0.07;
      this.add(e, ear, fur);
      ear.rotation.set(-0.2, 0, side * 0.2);
      this.ears.push(ear);
    }
    const tail = MeshBuilder.CreateSphere('ptail', { diameter: 0.06, segments: 6 }, s);
    tail.position.set(0, 0.12, -0.15);
    this.add(tail, this.body, this.m('#ffffff'));
  }

  private hamster() {
    const s = this.scene;
    const fur = this.m(this.pet.color);
    const b = MeshBuilder.CreateSphere('pbody', { diameter: 0.11, segments: 10 }, s);
    b.scaling.set(0.9, 0.8, 1.15);
    b.position.y = 0.045;
    this.add(b, this.body, fur);
    const belly = MeshBuilder.CreateSphere('pbelly', { diameter: 0.07, segments: 6 }, s);
    belly.position.set(0, 0.03, 0.03);
    this.add(belly, this.body, this.m('#f4f1ea'));
    this.head = this.node('phead', this.body, 0, 0.06, 0.05);
    this.eyes(this.head, 0.02, 0.005, 0.017, 0.013);
    for (const side of [-1, 1]) {
      const ear = MeshBuilder.CreateSphere('pear', { diameter: 0.025, segments: 5 }, s);
      ear.position.set(side * 0.025, 0.025, 0);
      this.add(ear, this.head, this.m('#e8a0aa'));
    }
  }

  setVisible(v: boolean) { this.root.setEnabled(v); }

  /** Animate for this frame. */
  pose(anim: PetAnim, t: number, dt: number, speed: number) {
    const sp = this.pet.species;
    this.phase += dt * speed * (anim === 'run' ? 14 : anim === 'walk' ? 9 : 3);
    const ph = this.phase;
    this.body.rotation.set(0, 0, 0);
    this.body.position.x = 0;
    const baseY = this.baseY;
    this.body.position.y = baseY;
    if (this.head) this.head.rotation.set(0, 0, 0);
    for (const l of this.legs) l.rotation.set(0, 0, 0);
    const wag = (amp: number, f: number) => { if (this.tail) this.tail.rotation.y = Math.sin(t * f) * amp; };

    if (sp === 'dog' || sp === 'cat') {
      switch (anim) {
        case 'walk':
        case 'run': {
          const amp = anim === 'run' ? 0.7 : 0.45;
          this.legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + (i === 0 || i === 3 ? 0 : Math.PI)) * amp; });
          this.body.position.y = baseY + Math.abs(Math.sin(ph)) * 0.02;
          wag(sp === 'dog' ? 0.5 : 0.15, 10);
          break;
        }
        case 'sit':
          this.body.rotation.x = -0.45;
          this.body.position.y = baseY - 0.08;
          this.legs[2].rotation.x = this.legs[3].rotation.x = 1.2;
          this.legs[0].rotation.x = this.legs[1].rotation.x = 0.35;
          wag(sp === 'dog' ? 0.35 : 0.1, 5);
          if (this.head) this.head.rotation.y = Math.sin(t * 0.6) * 0.4;
          break;
        case 'sleep':
          this.body.position.y = sp === 'dog' ? 0.15 : 0.11;
          for (const l of this.legs) l.rotation.x = -Math.PI / 2 + 0.1;
          this.body.rotation.z = 0.25;
          if (this.head) this.head.rotation.x = 0.5;
          if (this.tail) this.tail.rotation.y = 0.9;
          this.body.scaling.y = 1 + Math.sin(t * 1.5) * 0.03;
          break;
        case 'eat':
          if (this.head) this.head.rotation.x = 0.8 + Math.sin(t * 8) * 0.1;
          this.body.rotation.x = 0.15;
          wag(0.3, 8);
          break;
        case 'happy':
          this.body.position.y = baseY + Math.abs(Math.sin(t * 7)) * 0.06;
          wag(0.8, 16);
          if (this.head) this.head.rotation.x = -0.25;
          break;
        case 'pounce': {
          const k = (Math.sin(t * 5) + 1) / 2;
          this.body.rotation.x = -0.3 * k;
          this.body.position.y = baseY + k * 0.12;
          this.legs[0].rotation.x = this.legs[1].rotation.x = -0.9 * k;
          wag(0.3, 6);
          break;
        }
        default:
          wag(sp === 'dog' ? 0.25 : 0.08, sp === 'dog' ? 6 : 2);
          if (this.head) this.head.rotation.y = Math.sin(t * 0.5 + this.pet.id) * 0.5;
      }
      for (const e of this.ears) e.rotation.x = Math.sin(t * 3 + this.pet.id) * 0.05;
    } else if (sp === 'parrot') {
      if (this.head) this.head.rotation.y = Math.sin(t * 1.3) * 0.6;
      if (this.head) this.head.rotation.x = Math.max(0, Math.sin(t * 2.7)) * 0.25;
      this.body.position.y = Math.abs(Math.sin(t * 1.1)) * 0.01;
    } else if (sp === 'rabbit') {
      const hop = anim === 'hop' ? Math.abs(Math.sin(t * 6)) * 0.08 : 0;
      this.body.position.y = hop;
      this.body.position.x = anim === 'hop' ? Math.sin(t * 0.8) * 0.35 : 0;
      this.body.rotation.y = anim === 'hop' ? (Math.cos(t * 0.8) > 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
      for (const [i, e] of this.ears.entries()) e.rotation.z = (i ? -1 : 1) * (0.2 + Math.sin(t * 2 + i) * 0.08);
      if (this.head) this.head.rotation.x = Math.sin(t * 9) * 0.03;
    } else {
      // Hamster: running in the wheel, or curled up asleep.
      if (anim === 'run') {
        this.body.position.y = 0.06 + Math.abs(Math.sin(t * 18)) * 0.01;
        this.body.rotation.x = -0.2;
      } else {
        this.body.position.y = 0;
        this.body.scaling.y = 1 + Math.sin(t * 2) * 0.04;
      }
    }
  }

  dispose() {
    this.root.dispose(false, true);
    for (const m of this.mats) m.dispose();
  }
}
