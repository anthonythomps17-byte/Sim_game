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
import { normalizeAppearance } from '../sim/newgame';
import { hex } from './materials';

const THIGH = 0.43, SHIN = 0.41, FOOT_H = 0.06, HIP_H = THIGH + SHIN + FOOT_H;
const TORSO_H = 0.5, UPPER_ARM = 0.3, LOWER_ARM = 0.27;
// Head half-sizes: realistic proportions (about 1/7 of height), slightly egg-shaped.
const HX = 0.108, HY = 0.142, HZ = 0.124, HEAD_C = 0.15;

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
  /** Dirty clothes: 0 clean, 1 grubby (stains), 2 filthy (more stains and flies). */
  private dirt: 0 | 1 | 2 = 0;
  private cloth: { m: StandardMaterial; base: Color3 }[] = [];
  private stains: { mesh: Mesh; stage: 1 | 2 }[] = [];
  private flies: Mesh[] = [];

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
    this.cloth = [];
    this.stains = [];
    for (const f of this.flies) f.dispose();
    this.flies = [];
    for (const child of this.body.getChildren()) if (child !== this.ring) child.dispose();
    this.spine = new TransformNode('spine', this.scene);
    this.head = new TransformNode('head', this.scene);
    this.build(a);
  }

  private build(input: Appearance): void {
    this.appearanceKey = JSON.stringify(input);
    const a = normalizeAppearance(input);
    const s = this.scene;
    const skin = mat(s, 'skin', a.skin, 0.08);
    const skinShade = mat(s, 'skinShade', shadeHex(a.skin, 0.9), 0.05);
    const hair = mat(s, 'hair', a.hairColor, 0.25);
    hair.backFaceCulling = false;
    const brow = mat(s, 'brow', shadeHex(a.hairColor, 0.75));
    const top = mat(s, 'top', a.topColor);
    const topTrim = mat(s, 'topTrim', shadeHex(a.topColor, 0.82));
    const bottomColor = a.bottom === 'jeans' && a.bottomColor === '#3b4ba8' ? '#3a5a8c' : a.bottomColor;
    const bottom = mat(s, 'bottom', bottomColor);
    const bottomTrim = mat(s, 'bottomTrim', shadeHex(bottomColor, 0.8));
    const shoe = mat(s, 'shoe', a.shoeColor, 0.15);
    const sole = mat(s, 'sole', a.shoes === 'trainers' ? '#f4f1ea' : '#2b2b2b', 0.1);
    const eyeWhite = mat(s, 'eyeW', '#fbfbf8', 0.3);
    const iris = mat(s, 'iris', a.eyeColor, 0.5);
    const pupil = mat(s, 'pupil', '#111111', 0.6);
    const shine = mat(s, 'shine', '#ffffff');
    shine.emissiveColor = new Color3(1, 1, 1);
    const lip = mat(s, 'lip', mixHex(a.lipColor, a.skin, 0.35), 0.2);
    const dark = mat(s, 'lash', '#1a1412');
    const freckle = mat(s, 'freckle', shadeHex(a.skin, 0.72));
    const blush = mat(s, 'blush', mixHex(a.skin, '#ff8fa0', 0.3));
    const acc = mat(s, 'acc', a.accessoryColor, 0.3);
    const gold = mat(s, 'gold', '#d9b25a', 0.6);
    this.mats.push(skin, skinShade, hair, brow, top, topTrim, bottom, bottomTrim, shoe, sole, eyeWhite, iris, pupil, shine, lip, dark, freckle, blush, acc, gold);
    this.cloth = [top, topTrim, bottom, bottomTrim, shoe].map((m) => ({ m, base: m.diffuseColor.clone() }));

    const shoulderW = a.body === 'slim' ? 0.31 : a.body === 'broad' ? 0.41 : 0.35;
    const depth = a.body === 'slim' ? 0.19 : a.body === 'broad' ? 0.25 : 0.21;
    const curvy = a.figure === 'curvy';
    const hipW = curvy ? shoulderW * 1.02 + 0.04 : shoulderW * 0.9;
    const waistW = curvy ? shoulderW * 0.72 : shoulderW * 0.86;
    this.root.scaling.setAll(a.height);
    this.body.position.y = HIP_H;
    const sleeveless = a.top === 'vest' || a.top === 'dress';
    const shortSleeve = a.top === 'tshirt';
    const covered = (m: StandardMaterial) => (a.top === 'dress' ? top : m);

    // ----- Pelvis and torso -----
    const pelvis = MeshBuilder.CreateSphere('pelvis', { diameter: 1, segments: 12 }, s);
    pelvis.scaling.set(hipW, 0.26, depth * 1.08);
    pelvis.position.y = 0.0;
    this.add(pelvis, this.body, covered(bottom));
    this.spine.parent = this.body;
    this.spine.position.y = 0.05;
    const waist = MeshBuilder.CreateCylinder('waist', { diameterTop: waistW * 1.02, diameterBottom: hipW * 0.95, height: 0.2, tessellation: 16 }, s);
    waist.scaling.z = depth / Math.max(waistW, hipW) * 1.12;
    waist.position.y = 0.08;
    this.add(waist, this.spine, a.top === 'vest' || a.top === 'tshirt' || a.top === 'shirt' ? top : top);
    const chest = MeshBuilder.CreateSphere('chest', { diameter: 1, segments: 14 }, s);
    chest.scaling.set(shoulderW, 0.36, depth * 1.08);
    chest.position.y = 0.32;
    this.add(chest, this.spine, top);
    // Rounded shoulders.
    for (const side of [-1, 1]) {
      const sh = MeshBuilder.CreateSphere('shoulder', { diameter: 0.092, segments: 8 }, s);
      sh.position.set(side * (shoulderW / 2 - 0.005), TORSO_H - 0.085, 0);
      this.add(sh, this.spine, sleeveless ? skin : top);
    }
    if (a.top === 'vest') {
      // Straps and a scoop neck: show skin at the top of the chest.
      const neckSkin = MeshBuilder.CreateSphere('scoop', { diameter: 1, segments: 10, slice: 0.35 }, s);
      neckSkin.scaling.set(shoulderW * 0.7, 0.22, depth * 0.95);
      neckSkin.position.y = TORSO_H - 0.13;
      this.add(neckSkin, this.spine, skin);
    }
    if (a.top === 'hoodie') {
      const hood = MeshBuilder.CreateTorus('hood', { diameter: 0.2, thickness: 0.07, tessellation: 16 }, s);
      hood.scaling.set(1.1, 1, 0.9);
      hood.position.set(0, TORSO_H - 0.01, -0.03);
      hood.rotation.x = -0.25;
      this.add(hood, this.spine, topTrim);
      const pocket = MeshBuilder.CreateBox('pocket', { width: shoulderW * 0.55, height: 0.09, depth: 0.02 }, s);
      pocket.position.set(0, 0.12, depth / 2 + 0.01);
      this.add(pocket, this.spine, topTrim);
      for (const side of [-1, 1]) {
        const str = MeshBuilder.CreateCylinder('string', { diameter: 0.008, height: 0.12 }, s);
        str.position.set(side * 0.03, TORSO_H - 0.12, depth / 2 + 0.005);
        this.add(str, this.spine, mat(s, 'str', '#f4f1ea'));
      }
    }
    if (a.top === 'jumper' || a.top === 'longsleeve') {
      const collar = MeshBuilder.CreateTorus('collar', { diameter: 0.13, thickness: 0.03, tessellation: 14 }, s);
      collar.position.y = TORSO_H - 0.01;
      this.add(collar, this.spine, topTrim);
      if (a.top === 'jumper') {
        const hem = MeshBuilder.CreateCylinder('hem', { diameter: hipW * 0.98, height: 0.05, tessellation: 16 }, s);
        hem.scaling.z = depth / hipW * 1.12;
        hem.position.y = 0.0;
        this.add(hem, this.spine, topTrim);
      }
    }
    if (a.top === 'shirt' || a.top === 'jacket') {
      for (const side of [-1, 1]) {
        const lapel = MeshBuilder.CreateBox('lapel', { width: 0.06, height: a.top === 'jacket' ? 0.24 : 0.06, depth: 0.015 }, s);
        lapel.position.set(side * 0.04, TORSO_H - (a.top === 'jacket' ? 0.16 : 0.03), depth / 2 + 0.01);
        lapel.rotation.z = side * 0.35;
        this.add(lapel, this.spine, a.top === 'jacket' ? topTrim : top);
      }
      if (a.top === 'shirt') for (let i = 0; i < 4; i++) {
        const btn = MeshBuilder.CreateSphere('btn', { diameter: 0.012, segments: 4 }, s);
        btn.position.set(0, 0.42 - i * 0.1, depth / 2 + 0.012);
        this.add(btn, this.spine, mat(s, 'btnm', '#f4f1ea'));
      }
      if (a.top === 'jacket') {
        const coat = MeshBuilder.CreateCylinder('coat', { diameterTop: waistW * 1.12, diameterBottom: hipW * 1.12, height: 0.26, tessellation: 16 }, s);
        coat.scaling.z = depth / hipW * 1.25;
        coat.position.y = 0.0;
        this.add(coat, this.spine, top);
        const tee = MeshBuilder.CreateBox('tee', { width: 0.08, height: 0.3, depth: 0.01 }, s);
        tee.position.set(0, 0.3, depth / 2 + 0.012);
        this.add(tee, this.spine, mat(s, 'teem', '#f4f1ea'));
      }
    }
    const neck = MeshBuilder.CreateCylinder('neck', { diameterTop: 0.085, diameterBottom: 0.1, height: 0.13, tessellation: 10 }, s);
    neck.position.y = TORSO_H + 0.04;
    this.add(neck, this.spine, skin);

    // ----- Head and face -----
    this.head.parent = this.spine;
    this.head.position.y = TORSO_H + 0.08;
    const headMesh = MeshBuilder.CreateSphere('headm', { diameter: 1, segments: 18 }, s);
    headMesh.scaling.set(HX * 2, HY * 2, HZ * 2);
    headMesh.position.y = HEAD_C;
    this.add(headMesh, this.head, skin);
    const jawShape = [[0.86, 0.78, 0.9], [0.98, 0.74, 0.94], [0.72, 0.82, 0.88], [0.98, 0.7, 0.92]][a.face % 4];
    const jaw = MeshBuilder.CreateSphere('jaw', { diameter: 1, segments: 14 }, s);
    jaw.scaling.set(HX * 1.75 * jawShape[0], HY * 1.15 * jawShape[1], HZ * 1.6 * jawShape[2]);
    jaw.position.set(0, HEAD_C - 0.078, 0.0);
    this.add(jaw, this.head, skin);
    for (const side of [-1, 1]) {
      const ear = MeshBuilder.CreateSphere('ear', { diameter: 0.055, segments: 8 }, s);
      ear.scaling.set(0.4, 1, 0.65);
      ear.position.set(side * (HX - 0.002), HEAD_C - 0.005, -0.005);
      this.add(ear, this.head, skinShade);
    }
    const es = a.eyeSize, sp = 0.043 * a.eyeSpacing;
    const eyeY = HEAD_C - 0.002;
    const surface = (x: number, y: number) => HZ * Math.sqrt(Math.max(0.05, 1 - (x / HX) ** 2 - ((y - HEAD_C) / HY) ** 2));
    for (const side of [-1, 1]) {
      const eye = new TransformNode('eye', s);
      eye.parent = this.head;
      eye.position.set(side * sp, eyeY, surface(sp, eyeY) - 0.012);
      const white = MeshBuilder.CreateSphere('eyew', { diameter: 0.04 * es, segments: 10 }, s);
      white.scaling.set(1.2, 0.82, 0.55);
      this.add(white, eye, eyeWhite);
      const ir = MeshBuilder.CreateSphere('iris', { diameter: 0.027 * es, segments: 10 }, s);
      ir.scaling.set(1, 1, 0.45);
      ir.position.z = 0.0075 * es;
      this.add(ir, eye, iris);
      const pu = MeshBuilder.CreateSphere('pupil', { diameter: 0.011 * es, segments: 6 }, s);
      pu.scaling.set(1, 1, 0.4);
      pu.position.z = 0.0105 * es;
      this.add(pu, eye, pupil);
      const hl = MeshBuilder.CreateSphere('shine', { diameter: 0.005 * es, segments: 4 }, s);
      hl.position.set(0.004 * es, 0.004 * es, 0.0125 * es);
      this.add(hl, eye, shine);
      // Upper eyelid: a skin-coloured hood over the top of the eye.
      const lid = MeshBuilder.CreateSphere('lid', { diameter: 0.044 * es, segments: 8, slice: 0.3 }, s);
      lid.scaling.set(1.2, 0.75, 0.62);
      lid.position.set(0, 0.002, 0.001);
      this.add(lid, eye, skinShade);
      if (a.lashes) {
        const lash = MeshBuilder.CreateBox('lash', { width: 0.045 * es, height: 0.004, depth: 0.012 }, s);
        lash.position.set(side * 0.004, 0.012 * es, 0.009);
        lash.rotation.z = side * -0.15;
        lash.rotation.x = -0.4;
        this.add(lash, eye, dark);
      }
      this.eyes.push(eye);
      const browPts: Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        const x = side * (sp - 0.022 + u * 0.046);
        const y = eyeY + 0.028 + Math.sin(u * Math.PI) * 0.007 - (side * x > sp + 0.015 ? 0.003 : 0);
        browPts.push(new Vector3(x, y, surface(x, y) + 0.002));
      }
      const thick = a.brows === 'thin' ? 0.0035 : a.brows === 'thick' ? 0.0075 : 0.0055;
      this.add(MeshBuilder.CreateTube('brow', { path: browPts, radius: thick, tessellation: 6, cap: 2 }, s), this.head, brow);
      if (a.freckles) {
        for (let i = 0; i < 4; i++) {
          const fx = side * (sp + 0.004 * (i - 1.5) * 2), fy = eyeY - 0.032 - (i % 2) * 0.008;
          const fr = MeshBuilder.CreateSphere('fr', { diameter: 0.006, segments: 3 }, s);
          fr.position.set(fx, fy, surface(fx, fy) + 0.001);
          this.add(fr, this.head, freckle);
        }
      }
      if (a.blush) {
        const bx = side * (sp + 0.012), by = eyeY - 0.045;
        const bl = MeshBuilder.CreateSphere('blush', { diameter: 0.035, segments: 6 }, s);
        bl.scaling.set(1, 0.6, 0.15);
        bl.position.set(bx, by, surface(bx, by) - 0.001);
        this.add(bl, this.head, blush);
      }
    }
    // Nose: a bridge and a rounded tip.
    const ns = a.noseSize;
    const bridge = MeshBuilder.CreateCapsule('bridge', { radius: 0.0075 * ns, height: 0.04 * ns, tessellation: 8 }, s);
    bridge.position.set(0, eyeY - 0.026, surface(0, eyeY - 0.026) - 0.001);
    bridge.rotation.x = 0.3;
    this.add(bridge, this.head, skin);
    const tip = MeshBuilder.CreateSphere('nose', { diameter: 0.03 * ns, segments: 8 }, s);
    tip.scaling.set(1.15, 0.85, 0.9);
    tip.position.set(0, eyeY - 0.048, surface(0, eyeY - 0.048) + 0.012 * ns);
    this.add(tip, this.head, skinShade);
    // Lips.
    const mw = 0.026 * a.mouthWidth;
    const mouthY = eyeY - 0.085;
    const lipPath = (dy: number, curve: number) => {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const u = (i / 8) * 2 - 1;
        const x = u * mw;
        const y = mouthY + dy + curve * (1 - u * u);
        pts.push(new Vector3(x, y, Math.max(surface(x, y), 0.104) + 0.004 - Math.abs(u) * 0.006));
      }
      return pts;
    };
    this.add(MeshBuilder.CreateTube('lipU', { path: lipPath(0.004, 0.002), radius: 0.0042, tessellation: 6, cap: 2 }, s), this.head, lip);
    this.add(MeshBuilder.CreateTube('lipL', { path: lipPath(-0.004, -0.003), radius: 0.0052, tessellation: 6, cap: 2 }, s), this.head, lip);

    this.buildHair(a.hairStyle, hair);
    this.buildAccessory(a.accessory, acc, gold, dark);

    // ----- Arms: index 0 = right (+x), 1 = left (-x) -----
    for (const side of [1, -1]) {
      const root = new TransformNode('shoulder', s);
      root.parent = this.spine;
      root.position.set(side * (shoulderW / 2 + 0.015), TORSO_H - 0.08, 0);
      const upper = MeshBuilder.CreateCapsule('uarm', { radius: 0.042, height: UPPER_ARM + 0.06, tessellation: 10 }, s);
      upper.position.y = -UPPER_ARM / 2;
      this.add(upper, root, sleeveless ? skin : top);
      if (shortSleeve) {
        const cuff = MeshBuilder.CreateCylinder('sleeve', { diameter: 0.1, height: 0.12, tessellation: 10 }, s);
        cuff.position.y = -0.05;
        this.add(cuff, root, top);
        upper.material = skin;
      }
      const mid = new TransformNode('elbow', s);
      mid.parent = root;
      mid.position.y = -UPPER_ARM;
      const lower = MeshBuilder.CreateCapsule('larm', { radius: 0.036, height: LOWER_ARM + 0.05, tessellation: 10 }, s);
      lower.position.y = -LOWER_ARM / 2;
      this.add(lower, mid, sleeveless || shortSleeve ? skin : top);
      if (!sleeveless && !shortSleeve) {
        const cuff = MeshBuilder.CreateCylinder('cuff', { diameter: 0.085, height: 0.04, tessellation: 10 }, s);
        cuff.position.y = -LOWER_ARM + 0.01;
        this.add(cuff, mid, topTrim);
      }
      const hand = MeshBuilder.CreateSphere('hand', { diameter: 0.085, segments: 8 }, s);
      hand.scaling.set(0.7, 1.15, 0.9);
      hand.position.y = -LOWER_ARM - 0.04;
      this.add(hand, mid, skin);
      const thumb = MeshBuilder.CreateCapsule('thumb', { radius: 0.012, height: 0.05, tessellation: 6 }, s);
      thumb.position.set(-side * 0.0, -LOWER_ARM - 0.025, 0.03);
      thumb.rotation.x = 0.6;
      this.add(thumb, mid, skin);
      this.arms.push({ root, mid, upper, lower, end: hand });
    }

    // ----- Legs -----
    const skirtLike = a.top === 'dress' || a.bottom === 'skirt';
    const shorts = a.bottom === 'shorts';
    const tight = a.bottom === 'leggings';
    const thighMat = skirtLike ? skin : covered(bottom);
    const shinMat = skirtLike || shorts ? skin : bottom;
    for (const side of [1, -1]) {
      const root = new TransformNode('hip', s);
      root.parent = this.body;
      root.position.set(side * hipW * 0.26, 0, 0);
      const upper = MeshBuilder.CreateCapsule('thigh', { radius: tight ? 0.062 : 0.068, height: THIGH + 0.08, tessellation: 10 }, s);
      upper.position.y = -THIGH / 2;
      this.add(upper, root, thighMat);
      if (shorts) {
        const hemS = MeshBuilder.CreateCylinder('shortsHem', { diameter: 0.15, height: 0.2, tessellation: 10 }, s);
        hemS.position.y = -0.1;
        this.add(hemS, root, bottom);
        upper.material = skin;
      }
      const mid = new TransformNode('knee', s);
      mid.parent = root;
      mid.position.y = -THIGH;
      const lower = MeshBuilder.CreateCapsule('shin', { radius: tight ? 0.048 : 0.054, height: SHIN + 0.04, tessellation: 10 }, s);
      lower.position.y = -SHIN / 2;
      this.add(lower, mid, shinMat);
      if (a.bottom === 'joggers' && !skirtLike) {
        const band = MeshBuilder.CreateCylinder('cuffband', { diameter: 0.11, height: 0.05, tessellation: 10 }, s);
        band.position.y = -SHIN + 0.04;
        this.add(band, mid, bottomTrim);
      }
      // Shoes: trainers, boots or smart shoes.
      const upperShoe = MeshBuilder.CreateBox('shoe', { width: 0.1, height: a.shoes === 'boots' ? 0.16 : 0.07, depth: 0.24 }, s);
      upperShoe.position.set(0, -SHIN - FOOT_H / 2 + (a.shoes === 'boots' ? 0.06 : 0.015), 0.045);
      this.add(upperShoe, mid, shoe);
      const toe = MeshBuilder.CreateSphere('toe', { diameter: 0.1, segments: 8 }, s);
      toe.scaling.set(1, 0.65, 0.9);
      toe.position.set(0, -SHIN - FOOT_H / 2 + 0.01, 0.13);
      this.add(toe, mid, shoe);
      const soleM = MeshBuilder.CreateBox('sole', { width: 0.105, height: 0.025, depth: 0.27 }, s);
      soleM.position.set(0, -SHIN - FOOT_H + 0.008, 0.055);
      this.add(soleM, mid, sole);
      this.legs.push({ root, mid, upper, lower, end: upperShoe });
    }
    if (skirtLike) {
      const len = a.top === 'dress' ? 0.46 : 0.34;
      const skirt = MeshBuilder.CreateCylinder('skirt', { diameterTop: hipW * 1.02, diameterBottom: hipW * 1.55, height: len, tessellation: 18 }, s);
      skirt.scaling.z = depth / hipW * 1.25;
      skirt.position.y = 0.06 - len / 2;
      this.skirt = this.add(skirt, this.body, a.top === 'dress' ? top : bottom);
    }
    this.buildStains(shoulderW, depth, hipW);
    this.applyDirt();
  }

  /** Mud and food stains, hidden until the clothes get dirty. */
  private buildStains(shoulderW: number, depth: number, hipW: number): void {
    const s = this.scene;
    const mud = mat(s, 'mud', '#4a3420', 0.02);
    const food = mat(s, 'foodStain', '#8a4a1c', 0.02);
    this.mats.push(mud, food);
    const spots: [TransformNode, number, number, number, number, StandardMaterial, 1 | 2][] = [
      [this.spine, -shoulderW * 0.18, 0.3, depth / 2 + 0.004, 0.11, food, 1],
      [this.spine, shoulderW * 0.2, 0.15, depth / 2 + 0.004, 0.1, mud, 1],
      [this.spine, 0.03, 0.4, depth / 2 - 0.008, 0.08, food, 2],
      [this.spine, -shoulderW * 0.08, 0.06, depth / 2 + 0.006, 0.12, mud, 2],
      [this.spine, shoulderW * 0.05, 0.25, -depth / 2 - 0.004, 0.12, mud, 2],
      [this.body, hipW * 0.25, -0.05, depth / 2 + 0.01, 0.1, mud, 1],
      [this.body, -hipW * 0.22, -0.02, depth / 2 + 0.01, 0.09, mud, 2],
    ];
    for (const [parent, x, y, z, d, m, stage] of spots) {
      const st = MeshBuilder.CreateSphere('stain', { diameter: d, segments: 6 }, s);
      st.scaling.z = 0.25;
      st.position.set(x, y, z);
      this.add(st, parent, m);
      st.isPickable = false;
      this.stains.push({ mesh: st, stage });
    }
    const black = mat(s, 'fly', '#111111');
    this.mats.push(black);
    for (let i = 0; i < 3; i++) {
      const f = MeshBuilder.CreateSphere('fly', { diameter: 0.045, segments: 4 }, s);
      f.parent = this.root;
      f.material = black;
      f.isPickable = false;
      this.flies.push(f);
    }
  }

  setDirt(stage: 0 | 1 | 2): void {
    if (stage === this.dirt) return;
    this.dirt = stage;
    this.applyDirt();
  }

  private applyDirt(): void {
    const mudColor = hex('#6b5434');
    const t = this.dirt === 2 ? 0.48 : this.dirt === 1 ? 0.24 : 0;
    for (const c of this.cloth) c.m.diffuseColor = Color3.Lerp(c.base, mudColor, t);
    for (const st of this.stains) st.mesh.setEnabled(this.dirt >= st.stage);
    for (const f of this.flies) f.setEnabled(this.dirt === 2);
  }

  /** Hair shell that hugs the head. `slice` = how far down it reaches, `arc` = how far round (gap at the front). */
  private shell(hair: StandardMaterial, scale: number, slice: number, arc = 1, yOff = 0, zOff = 0, tilt = 0, sx = 1, sz = 1): Mesh {
    const m = MeshBuilder.CreateSphere('hair', { diameter: 1, segments: 18, slice, arc, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    m.scaling.set(HX * 2 * scale * sx, HY * 2 * scale, HZ * 2 * scale * sz);
    m.position.set(0, HEAD_C + yOff, zOff);
    // Put the open part of the arc at the front, over the face.
    m.rotation.set(tilt, arc < 1 ? -Math.PI / 2 - Math.PI * (1 + arc) : 0, 0);
    return this.add(m, this.head, hair);
  }

  private buildHair(style: string, hair: StandardMaterial): void {
    const s = this.scene;
    const blob = (d: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const m = MeshBuilder.CreateSphere('hairb', { diameter: d, segments: 8 }, s);
      m.position.set(x, y, z);
      m.scaling.set(sx, sy, sz);
      return this.add(m, this.head, hair);
    };
    const strand = (pts: [number, number, number][], r0: number, r1: number) => {
      const path = pts.map(([x, y, z]) => new Vector3(x, y, z));
      return this.add(MeshBuilder.CreateTube('strand', { path, radiusFunction: (i: number, d: number) => { void d; return r0 + (r1 - r0) * (i / (path.length - 1)); }, tessellation: 10, cap: 2 }, s), this.head, hair);
    };
    // Crown: covers the top of the head down to a natural hairline on the forehead.
    const crown = (scale = 1.07, slice = 0.36) => this.shell(hair, scale, slice, 1, 0.006, -0.006, -0.34);
    // Back and sides, open at the face, reaching down to `slice`.
    const back = (slice: number, scale = 1.1, flare = 1) => this.shell(hair, scale, slice, 0.6, 0, -0.006, 0, flare, flare);
    const nape = HEAD_C - HY * 0.7;
    switch (style) {
      case 'bald': return;
      case 'buzz':
        this.shell(hair, 1.08, 0.4, 1, 0.004, -0.008, -0.34);
        this.shell(hair, 1.085, 0.62, 0.55, 0, -0.008);
        return;
      case 'short':
        crown(1.08, 0.45);
        back(0.62, 1.09);
        blob(0.11, 0.02, HEAD_C + HY * 0.82, HZ * 0.55, 1.6, 0.45, 0.9).rotation.z = -0.25;
        return;
      case 'pixie':
        crown(1.08, 0.45);
        back(0.66, 1.08);
        blob(0.12, -0.035, HEAD_C + HY * 0.7, HZ * 0.72, 1.4, 0.4, 0.6).rotation.z = 0.45;
        return;
      case 'quiff':
        crown(1.07, 0.42);
        back(0.6, 1.07);
        blob(0.12, 0, HEAD_C + HY * 1.02, HZ * 0.45, 1.3, 0.75, 1.3).rotation.x = -0.4;
        return;
      case 'side_part':
        crown(1.09, 0.45);
        back(0.84, 1.12, 1.04);
        blob(0.13, -0.045, HEAD_C + HY * 0.68, HZ * 0.74, 1.5, 0.5, 0.55).rotation.z = 0.5;
        return;
      case 'bob':
        crown(1.1, 0.46);
        back(0.88, 1.15, 1.08);
        blob(0.13, 0, HEAD_C + HY * 0.72, HZ * 0.72, 1.7, 0.42, 0.55);
        return;
      case 'long':
      case 'wavy': {
        crown(1.09, 0.45);
        back(0.84, 1.12, 1.03);
        // A curtain of hair down the back and strands over the shoulders.
        const wav = style === 'wavy' ? 0.018 : 0;
        for (let i = 0; i < 7; i++) {
          const x = -0.09 + i * 0.03;
          const z = -HZ * 0.75 + Math.abs(x) * 0.25;
          strand([[x, nape + 0.05, z], [x + wav, nape - 0.08, z - 0.03], [x - wav, nape - 0.2, z - 0.035], [x + wav * 0.5, nape - 0.3, z - 0.03]], 0.03, 0.02);
        }
        for (const side of [-1, 1]) {
          const x = side * HX * 0.95;
          strand([[x, HEAD_C, 0.0], [x + side * 0.01, nape - 0.02, 0.03], [x + side * (0.03 + wav), nape - 0.14, 0.05], [x + side * 0.03, nape - 0.24, 0.04]], 0.028, 0.016);
        }
        return;
      }
      case 'ponytail':
      case 'high_pony': {
        crown(1.05, 0.48);
        back(0.72, 1.06);
        const hy = style === 'high_pony' ? HEAD_C + HY * 0.75 : HEAD_C + 0.01;
        const tie = MeshBuilder.CreateTorus('tie', { diameter: 0.04, thickness: 0.014, tessellation: 10 }, s);
        tie.position.set(0, hy, -HZ - 0.01);
        tie.rotation.x = Math.PI / 2;
        this.add(tie, this.head, mat(s, 'tiem', '#e05a7a'));
        strand([[0, hy, -HZ - 0.02], [0, hy - 0.04, -HZ - 0.07], [0, hy - 0.14, -HZ - 0.08], [0, hy - 0.26, -HZ - 0.05]], 0.035, 0.012);
        return;
      }
      case 'bun':
        crown(1.05, 0.48);
        back(0.7, 1.06);
        blob(0.11, 0, HEAD_C + HY * 0.95, -HZ * 0.55, 1.1, 0.9, 1.1);
        blob(0.05, 0.03, HEAD_C + HY * 1.05, -HZ * 0.4);
        return;
      case 'buns':
        crown(1.05, 0.48);
        back(0.68, 1.06);
        for (const side of [-1, 1]) blob(0.09, side * HX * 0.75, HEAD_C + HY * 0.85, -HZ * 0.15);
        return;
      case 'braids':
        crown(1.05, 0.48);
        back(0.7, 1.06);
        for (const side of [-1, 1]) for (let i = 0; i < 7; i++) blob(0.038 - i * 0.002, side * (HX * 0.85 + 0.01), nape - 0.01 - i * 0.04, 0.02 + i * 0.006, 1, 1.15, 1);
        return;
      case 'cornrows':
        this.shell(hair, 1.08, 0.4, 1, 0.004, -0.008, -0.34);
        this.shell(hair, 1.085, 0.66, 0.55, 0, -0.008);
        for (let i = 0; i < 6; i++) {
          const x = -0.075 + i * 0.03;
          const pts: Vector3[] = [];
          // From the hairline over the top to the nape, hugging the scalp.
          for (let j = 0; j <= 10; j++) {
            const a = -0.55 + (j / 10) * 2.6;
            const k = Math.sqrt(Math.max(0, 1 - (x / (HX * 1.09)) ** 2));
            pts.push(new Vector3(x, HEAD_C + Math.cos(a) * HY * 1.09 * k, -Math.sin(a) * HZ * 1.09 * k));
          }
          this.add(MeshBuilder.CreateTube('row', { path: pts, radius: 0.0065, tessellation: 6 }, s), this.head, hair);
        }
        return;
      case 'curly': {
        crown(1.1, 0.46);
        back(0.8, 1.13, 1.05);
        for (let i = 0; i < 34; i++) {
          const a = (i / 34) * Math.PI * 2 * 3;
          const lat = 0.15 + (i % 7) * 0.12;
          const ang = a % (Math.PI * 2);
          if (Math.abs(Math.sin(ang)) > 0.85 && Math.cos(ang) > 0 && lat > 0.5) continue; // keep the face clear
          const x = Math.cos(ang) * HX * 1.15 * Math.sin(lat * Math.PI * 0.7 + 0.3);
          const z = -Math.abs(Math.sin(ang)) * HZ * 1.1 * Math.sin(lat * Math.PI * 0.7 + 0.3) + (Math.sin(ang) > 0 ? 0 : 0);
          const y = HEAD_C + HY * (1.05 - lat * 1.1);
          blob(0.055, x, y, z);
        }
        return;
      }
      case 'afro': {
        crown(1.1, 0.36);
        const big = this.shell(hair, 1.5, 0.7, 0.66, 0.04, -0.035, 0);
        big.scaling.y *= 0.95;
        for (let i = 0; i < 18; i++) {
          const a = Math.PI * 0.15 + (i / 17) * Math.PI * 0.7;
          blob(0.09, Math.cos(a) * HX * 1.45, HEAD_C + 0.05 + Math.sin(i * 1.7) * 0.05, -Math.sin(a) * HZ * 1.4);
        }
        blob(0.16, 0, HEAD_C + HY * 1.15, -0.02, 1.6, 0.7, 1.4);
        return;
      }
      default:
        crown();
        back(0.62);
    }
  }

  private buildAccessory(kind: string, acc: StandardMaterial, gold: StandardMaterial, dark: StandardMaterial): void {
    const s = this.scene;
    const eyeY = HEAD_C - 0.002;
    switch (kind) {
      case 'glasses':
      case 'sunglasses':
        for (const side of [-1, 1]) {
          const rim = MeshBuilder.CreateTorus('rim', { diameter: 0.052, thickness: 0.006, tessellation: 16 }, s);
          rim.rotation.x = Math.PI / 2;
          rim.position.set(side * 0.044, eyeY, HZ + 0.006);
          this.add(rim, this.head, acc);
          if (kind === 'sunglasses') {
            const lens = MeshBuilder.CreateCylinder('lens', { diameter: 0.048, height: 0.003, tessellation: 16 }, s);
            lens.rotation.x = Math.PI / 2;
            lens.position.set(side * 0.044, eyeY, HZ + 0.006);
            this.add(lens, this.head, dark);
          }
          const arm = MeshBuilder.CreateTube('arm', { path: [new Vector3(side * 0.07, eyeY + 0.004, HZ - 0.004), new Vector3(side * (HX + 0.003), eyeY + 0.006, HZ * 0.35), new Vector3(side * (HX + 0.002), eyeY - 0.004, -0.01)], radius: 0.003, tessellation: 5 }, s);
          this.add(arm, this.head, acc);
        }
        this.add(Object.assign(MeshBuilder.CreateBox('bridgeG', { width: 0.03, height: 0.005, depth: 0.005 }, s), { position: new Vector3(0, eyeY + 0.008, HZ + 0.01) }), this.head, acc);
        return;
      case 'earrings':
        for (const side of [-1, 1]) {
          const e = MeshBuilder.CreateTorus('earring', { diameter: 0.022, thickness: 0.004, tessellation: 12 }, s);
          e.position.set(side * (HX + 0.004), HEAD_C - 0.035, 0);
          e.rotation.z = Math.PI / 2;
          this.add(e, this.head, gold);
        }
        return;
      case 'beanie': {
        const b = this.shell(acc, 1.16, 0.5, 1, 0.02, -0.005, -0.2);
        b.material = acc;
        const band = MeshBuilder.CreateTorus('band', { diameter: HX * 2.2, thickness: 0.035, tessellation: 20 }, s);
        band.scaling.z = HZ / HX;
        band.position.set(0, HEAD_C + 0.045, -0.01);
        band.rotation.x = -0.2;
        this.add(band, this.head, acc);
        return;
      }
      case 'cap': {
        const c = this.shell(acc, 1.12, 0.45, 1, 0.012, -0.004, -0.18);
        c.material = acc;
        const brim = MeshBuilder.CreateCylinder('brim', { diameter: 0.17, height: 0.012, tessellation: 18, arc: 0.5 }, s);
        brim.position.set(0, HEAD_C + HY * 0.62, HZ * 0.55);
        brim.rotation.set(-0.15, Math.PI, 0);
        this.add(brim, this.head, acc);
        return;
      }
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
    } else if (name === 'hoover') {
      p = MeshBuilder.CreateBox('hoover', { width: 0.3, height: 0.25, depth: 0.22 }, s);
      p.material = mat(s, 'hooverm', '#e05a5a');
      p.parent = this.root;
      p.position.set(0, 0.13, 0.55);
      const stick = MeshBuilder.CreateCylinder('hstick', { diameter: 0.04, height: 0.9 }, s);
      stick.material = mat(s, 'hstickm', '#555');
      stick.parent = p;
      stick.position.set(0, 0.45, -0.15);
      stick.rotation.x = -0.45;
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
    for (const n of ['book', 'phone', 'guitar', 'fork', 'hoover']) {
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

    // Flies buzzing round filthy clothes.
    if (this.dirt === 2) this.flies.forEach((f, i) => {
      const a = t * (3 + i) + i * 2.1;
      f.position.set(Math.cos(a) * (0.28 + i * 0.05), 1.25 + Math.sin(t * 5 + i) * 0.2, Math.sin(a) * (0.28 + i * 0.05));
    });

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
      case 'hoover': {
        props.push('hoover');
        const push = Math.sin(t * 4 * sp);
        ra.root.rotation.x = la.root.rotation.x = -0.75 - push * 0.15;
        ra.mid.rotation.x = la.mid.rotation.x = -0.35;
        this.spine.rotation.x = 0.12;
        if (this.props.hoover) this.props.hoover.position.z = 0.55 + push * 0.18;
        this.legs.forEach((l, i) => { l.root.rotation.x = (i ? 1 : -1) * push * 0.15; });
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

function mixHex(a: string, b: string, t: number): string {
  return Color3.Lerp(hex(a), hex(b), t).toHexString();
}

function shadeHex(c: string, f: number): string {
  const col = hex(c).scale(f);
  return new Color3(Math.min(1, col.r), Math.min(1, col.g), Math.min(1, col.b)).toHexString();
}
