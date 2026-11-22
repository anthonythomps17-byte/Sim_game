// Low-poly furniture built from primitives, merged into one vertex-coloured mesh per object.
// Origin is the centre of the footprint on the floor; the front faces +z.
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { ObjectDef } from '../sim/defs';
import type { PlacedObject } from '../sim/types';
import { hex, type Materials } from './materials';

const WOOD = '#a0703f', DARKWOOD = '#6b4529', LIGHTWOOD = '#d4ad78', WHITE = '#f1eee7';
const METAL = '#a4acb5', DARK = '#2d3037', BRASS = '#d1a640', SOIL = '#5a3d27', LEAF = '#4f9a48', LEAF2 = '#6fbd56';

export class ModelBuilder {
  parts: Mesh[] = [];
  glows: { mesh: Mesh; color: string }[] = [];
  glass: Mesh[] = [];
  private n = 0;
  constructor(private scene: Scene) {}

  private paint(m: Mesh, color: string): Mesh {
    const c = hex(color);
    const count = m.getTotalVertices();
    const arr = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { arr[i * 4] = c.r; arr[i * 4 + 1] = c.g; arr[i * 4 + 2] = c.b; arr[i * 4 + 3] = 1; }
    m.setVerticesData(VertexBuffer.ColorKind, arr);
    this.parts.push(m);
    return m;
  }

  box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0): Mesh {
    const m = MeshBuilder.CreateBox('p' + this.n++, { width: w, height: h, depth: d }, this.scene);
    m.position.set(x, y + h / 2, z);
    return this.paint(m, color);
  }

  cyl(dTop: number, dBot: number, h: number, color: string, x = 0, y = 0, z = 0, tess = 10): Mesh {
    const m = MeshBuilder.CreateCylinder('p' + this.n++, { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: tess }, this.scene);
    m.position.set(x, y + h / 2, z);
    return this.paint(m, color);
  }

  sphere(d: number, color: string, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 6): Mesh {
    const m = MeshBuilder.CreateSphere('p' + this.n++, { diameter: d, segments: seg }, this.scene);
    m.position.set(x, y, z);
    m.scaling.set(sx, sy, sz);
    return this.paint(m, color);
  }

  torus(d: number, t: number, color: string, x = 0, y = 0, z = 0, tess = 16): Mesh {
    const m = MeshBuilder.CreateTorus('p' + this.n++, { diameter: d, thickness: t, tessellation: tess }, this.scene);
    m.position.set(x, y, z);
    return this.paint(m, color);
  }

  /** A part that glows (lamp shade, screen). Not merged with the rest. */
  glow(m: Mesh, color: string): Mesh {
    this.parts = this.parts.filter((p) => p !== m);
    this.glows.push({ mesh: m, color });
    return m;
  }

  glassPart(m: Mesh): Mesh {
    this.parts = this.parts.filter((p) => p !== m);
    this.glass.push(m);
    return m;
  }

  legs(w: number, d: number, h: number, color: string, inset = 0.06, size = 0.06) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(size, h, size, color, sx * (w / 2 - inset), 0, sz * (d / 2 - inset));
  }
}

export interface BuiltModel { root: Mesh; glow: Mesh[]; glass: Mesh | null }

type Builder = (b: ModelBuilder, def: ObjectDef, obj: PlacedObject | null) => void;

const books = (b: ModelBuilder, w: number, y: number, z: number, depth: number) => {
  const cols = ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22', '#16a085'];
  let x = -w / 2 + 0.04;
  let i = 0;
  while (x < w / 2 - 0.08) {
    const bw = 0.05 + ((i * 7) % 3) * 0.015;
    const bh = 0.22 + ((i * 5) % 4) * 0.025;
    b.box(bw, bh, depth, cols[i % cols.length], x + bw / 2, y, z);
    x += bw + 0.008;
    i++;
  }
};

const bed = (b: ModelBuilder, w: number, sheet: string, blanket: string, frame = WOOD) => {
  const d = 2;
  b.box(w - 0.05, 0.3, d - 0.05, frame, 0, 0.05, 0);
  b.legs(w - 0.05, d - 0.05, 0.08, frame);
  b.box(w - 0.12, 0.16, d - 0.15, sheet, 0, 0.35, 0);
  b.box(w - 0.1, 0.06, d * 0.62, blanket, 0, 0.5, 0.3);
  const pillows = w > 1.5 ? [-w / 4, w / 4] : [0];
  for (const px of pillows) b.box(Math.min(0.62, w - 0.25), 0.12, 0.32, WHITE, px, 0.5, -0.72);
  b.box(w - 0.02, 0.95, 0.08, frame, 0, 0, -d / 2 + 0.04);
};

const sofaShape = (b: ModelBuilder, w: number, fabric: string) => {
  b.box(w - 0.08, 0.4, 0.82, fabric, 0, 0.08, 0.02);
  b.box(w - 0.08, 0.55, 0.22, fabric, 0, 0.4, -0.32);
  b.box(0.16, 0.58, 0.82, fabric, -w / 2 + 0.12, 0.08, 0.02);
  b.box(0.16, 0.58, 0.82, fabric, w / 2 - 0.12, 0.08, 0.02);
  const n = Math.round(w);
  for (let i = 0; i < n; i++) b.box((w - 0.4) / n - 0.03, 0.1, 0.55, hexShade(fabric, 1.12), -((w - 0.4) / 2) + ((w - 0.4) / n) * (i + 0.5), 0.48, 0.1);
  b.legs(w - 0.1, 0.8, 0.08, DARKWOOD);
};

function hexShade(c: string, f: number): string {
  const col = hex(c).scale(f);
  return new Color3(Math.min(1, col.r), Math.min(1, col.g), Math.min(1, col.b)).toHexString();
}

const lampShade = (b: ModelBuilder, y: number, d: number, h: number) => {
  b.glow(b.cyl(d * 0.65, d, h, '#ffd9a0', 0, y, 0, 12), 'lamp');
};

const guitarShape = (b: ModelBuilder, body: string, neck: string) => {
  b.box(0.05, 0.5, 0.05, DARK, 0, 0, -0.1);
  const g1 = b.sphere(0.36, body, 0, 0.42, 0.02, 1, 1.2, 0.35, 8);
  const g2 = b.sphere(0.28, body, 0, 0.66, 0.02, 1, 1.1, 0.35, 8);
  const n = b.box(0.06, 0.55, 0.04, neck, 0, 0.75, 0.02);
  b.sphere(0.1, DARK, 0, 0.48, 0.07, 1, 1, 0.2, 6);
  for (const m of [g1, g2, n]) m.rotation.x = -0.18;
};

const easelShape = (b: ModelBuilder, canvas: string, frame: string) => {
  const l1 = b.box(0.05, 1.6, 0.05, LIGHTWOOD, -0.25, 0, 0.05); l1.rotation.z = 0.12;
  const l2 = b.box(0.05, 1.6, 0.05, LIGHTWOOD, 0.25, 0, 0.05); l2.rotation.z = -0.12;
  const l3 = b.box(0.05, 1.5, 0.05, LIGHTWOOD, 0, 0, -0.25); l3.rotation.x = -0.25;
  b.box(0.62, 0.04, 0.12, LIGHTWOOD, 0, 0.62, 0.1);
  b.box(0.6, 0.5, 0.04, frame, 0, 0.68, 0.12);
  b.box(0.54, 0.44, 0.02, canvas, 0, 0.71, 0.145);
};

const toiletShape = (b: ModelBuilder, color: string) => {
  b.cyl(0.28, 0.22, 0.25, color, 0, 0, 0.02);
  b.cyl(0.42, 0.34, 0.16, color, 0, 0.25, 0.04);
  b.cyl(0.38, 0.38, 0.03, hexShade(color, 0.92), 0, 0.41, 0.04);
  b.box(0.45, 0.4, 0.2, color, 0, 0.3, -0.32);
  b.box(0.08, 0.03, 0.04, METAL, 0.12, 0.7, -0.2);
};

export const BUILDERS: Record<string, Builder> = {
  fridge: (b) => {
    b.box(0.82, 1.85, 0.7, WHITE, 0, 0, -0.05);
    b.box(0.8, 0.02, 0.02, '#c9c6bf', 0, 1.15, 0.31);
    b.box(0.04, 0.35, 0.04, METAL, 0.3, 1.25, 0.32);
    b.box(0.04, 0.25, 0.04, METAL, 0.3, 0.8, 0.32);
  },
  stove: (b) => {
    b.box(0.9, 0.9, 0.7, '#e7e4de', 0, 0, -0.05);
    b.box(0.9, 0.03, 0.7, DARK, 0, 0.9, -0.05);
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.12], [0.2, 0.12]]) b.cyl(0.18, 0.18, 0.02, '#555', x, 0.93, z, 10);
    b.box(0.7, 0.45, 0.02, '#3a3d44', 0, 0.15, 0.31);
    b.box(0.6, 0.03, 0.04, METAL, 0, 0.65, 0.32);
    for (let i = 0; i < 4; i++) b.cyl(0.05, 0.05, 0.03, DARK, -0.27 + i * 0.18, 0.78, 0.31, 8).rotation.x = Math.PI / 2;
  },
  range: (b) => {
    b.box(1.85, 0.92, 0.7, '#2f5d50', 0, 0, -0.05);
    b.box(1.85, 0.04, 0.7, DARK, 0, 0.92, -0.05);
    for (const x of [-0.45, 0.45]) { b.box(0.7, 0.5, 0.02, '#244a3f', x, 0.12, 0.31); b.box(0.12, 0.04, 0.05, BRASS, x, 0.55, 0.33); }
    b.box(1.75, 0.03, 0.04, BRASS, 0, 0.8, 0.34);
    for (const [x, z] of [[-0.6, -0.15], [-0.2, -0.15], [0.2, -0.15], [0.6, -0.15]]) b.cyl(0.22, 0.22, 0.02, '#555', x, 0.96, z, 10);
    b.box(1.6, 0.5, 0.55, '#2f5d50', 0, 1.6, -0.12);
  },
  counter: (b) => {
    b.box(0.95, 0.86, 0.66, '#7d9cb5', 0, 0, -0.02);
    b.box(0.98, 0.05, 0.7, '#ddd6c8', 0, 0.86, -0.02);
    b.box(0.03, 0.6, 0.02, '#5e7b92', 0, 0.15, 0.32);
    b.box(0.04, 0.12, 0.04, METAL, 0.12, 0.6, 0.33);
    b.cyl(0.14, 0.12, 0.2, '#e05a5a', -0.25, 0.91, -0.15, 10);
    b.box(0.3, 0.02, 0.2, LIGHTWOOD, 0.15, 0.91, 0.0);
  },
  kitchen_sink: (b) => {
    b.box(0.95, 0.86, 0.66, '#7d9cb5', 0, 0, -0.02);
    b.box(0.98, 0.05, 0.7, '#ddd6c8', 0, 0.86, -0.02);
    b.box(0.6, 0.03, 0.42, '#8c949c', 0, 0.9, 0.02);
    b.cyl(0.04, 0.04, 0.28, METAL, 0, 0.9, -0.24, 8);
    b.box(0.04, 0.04, 0.18, METAL, 0, 1.15, -0.16);
  },
  coffee: (b) => {
    b.box(0.7, 0.86, 0.6, LIGHTWOOD, 0, 0, -0.05);
    b.box(0.72, 0.04, 0.62, '#ddd6c8', 0, 0.86, -0.05);
    b.box(0.32, 0.4, 0.3, '#30343b', 0, 0.9, -0.1);
    b.box(0.22, 0.08, 0.1, '#c44', 0, 1.18, 0.07);
    b.cyl(0.08, 0.07, 0.1, WHITE, 0, 0.9, 0.08, 8);
  },
  dining_table: (b) => {
    b.box(1.8, 0.06, 0.88, WOOD, 0, 0.72, 0);
    b.legs(1.75, 0.82, 0.72, DARKWOOD, 0.08, 0.07);
    b.cyl(0.18, 0.12, 0.14, '#3f7d74', 0, 0.78, 0, 10);
    b.sphere(0.2, '#f2c14e', 0, 0.96, 0, 1, 0.8, 1, 6);
  },
  dining_chair: (b) => {
    b.box(0.46, 0.05, 0.44, WOOD, 0, 0.43, 0);
    b.legs(0.44, 0.42, 0.43, DARKWOOD, 0.04, 0.05);
    b.box(0.46, 0.5, 0.05, WOOD, 0, 0.48, -0.2);
    b.box(0.4, 0.04, 0.38, '#c75b4a', 0, 0.48, 0.02);
  },
  toilet: (b) => toiletShape(b, WHITE),
  magic_loo: (b) => { toiletShape(b, '#e6c04a'); b.glow(b.sphere(0.12, '#fff3b0', 0, 1.0, -0.3), 'sparkle'); },
  shower: (b) => {
    b.box(0.92, 0.08, 0.92, WHITE, 0, 0, 0);
    b.box(0.92, 2.1, 0.04, '#cfe3ea', 0, 0.08, -0.44);
    b.box(0.04, 2.1, 0.92, '#cfe3ea', -0.44, 0.08, 0);
    b.glassPart(b.box(0.04, 1.9, 0.92, '#bfe2f2', 0.44, 0.08, 0));
    b.glassPart(b.box(0.5, 1.9, 0.03, '#bfe2f2', 0.2, 0.08, 0.45));
    b.cyl(0.03, 0.03, 0.4, METAL, 0, 1.75, -0.38, 6);
    b.cyl(0.18, 0.08, 0.06, METAL, 0, 2.0, -0.3, 10);
  },
  bath: (b) => {
    b.box(1.75, 0.5, 0.8, WHITE, 0, 0.1, 0);
    b.box(1.55, 0.04, 0.6, '#8fd0ea', 0, 0.48, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.sphere(0.1, BRASS, sx * 0.75, 0.06, sz * 0.3);
    b.cyl(0.04, 0.04, 0.3, BRASS, -0.82, 0.55, 0, 6);
  },
  bathroom_sink: (b) => {
    b.cyl(0.18, 0.24, 0.75, WHITE, 0, 0, -0.1, 10);
    b.box(0.6, 0.14, 0.45, WHITE, 0, 0.75, -0.05);
    b.box(0.46, 0.03, 0.3, '#bfe2f2', 0, 0.87, -0.03);
    b.cyl(0.03, 0.03, 0.16, METAL, 0, 0.89, -0.22, 6);
    b.box(0.5, 0.6, 0.03, '#d9eef7', 0, 1.15, -0.4);
  },
  mirror: (b) => {
    b.box(0.08, 0.08, 0.4, DARKWOOD, -0.25, 0, 0);
    b.box(0.08, 0.08, 0.4, DARKWOOD, 0.25, 0, 0);
    b.box(0.66, 1.7, 0.06, DARKWOOD, 0, 0.08, 0);
    b.box(0.56, 1.55, 0.02, '#cfe8f3', 0, 0.15, 0.035);
  },
  bed_single: (b) => bed(b, 1, '#efe9dc', '#5b84c4'),
  bed_double: (b) => bed(b, 2, '#efe9dc', '#c86f86'),
  dream_bed: (b) => {
    bed(b, 2, '#ffffff', '#b9a5f0', '#e8e2f7');
    for (let i = 0; i < 5; i++) b.sphere(0.5, '#ffffff', -0.8 + i * 0.4, 1.0 + (i % 2) * 0.12, -0.95, 1, 0.8, 0.6);
  },
  wardrobe: (b) => {
    b.box(0.92, 2.0, 0.6, WOOD, 0, 0, -0.05);
    b.box(0.02, 1.85, 0.02, DARKWOOD, 0, 0.08, 0.26);
    b.box(0.03, 0.18, 0.03, BRASS, -0.06, 1.0, 0.27);
    b.box(0.03, 0.18, 0.03, BRASS, 0.06, 1.0, 0.27);
    b.box(0.96, 0.06, 0.64, DARKWOOD, 0, 2.0, -0.05);
  },
  computer: (b) => {
    b.box(1.8, 0.05, 0.75, LIGHTWOOD, 0, 0.73, -0.05);
    b.box(0.05, 0.73, 0.7, LIGHTWOOD, -0.86, 0, -0.05);
    b.box(0.45, 0.73, 0.7, LIGHTWOOD, 0.66, 0, -0.05);
    b.box(0.6, 0.38, 0.04, DARK, -0.3, 0.88, -0.25);
    b.glow(b.box(0.54, 0.32, 0.01, '#6ea8ff', -0.3, 0.91, -0.225), 'screen');
    b.box(0.06, 0.12, 0.06, DARK, -0.3, 0.78, -0.27);
    b.box(0.45, 0.02, 0.15, '#444', -0.3, 0.78, 0.05);
    // Chair in front of the desk.
    b.box(0.46, 0.06, 0.44, '#3b4ba8', -0.3, 0.45, 0.7);
    b.box(0.44, 0.5, 0.06, '#3b4ba8', -0.3, 0.5, 0.92);
    b.cyl(0.05, 0.05, 0.4, DARK, -0.3, 0.05, 0.7, 6);
    b.cyl(0.4, 0.4, 0.05, DARK, -0.3, 0, 0.7, 8);
  },
  bookshelf: (b) => {
    b.box(0.92, 1.9, 0.38, WOOD, 0, 0, -0.08);
    b.box(0.84, 1.8, 0.02, DARKWOOD, 0, 0.05, -0.26);
    for (let i = 0; i < 4; i++) {
      b.box(0.84, 0.03, 0.34, DARKWOOD, 0, 0.08 + i * 0.45, -0.06);
      books(b, 0.84, 0.11 + i * 0.45, 0.0, 0.26);
    }
  },
  dresser: (b) => {
    b.box(0.9, 0.85, 0.5, WOOD, 0, 0, -0.1);
    for (let i = 0; i < 3; i++) { b.box(0.84, 0.02, 0.02, DARKWOOD, 0, 0.27 + i * 0.25, 0.16); b.box(0.12, 0.03, 0.03, BRASS, 0, 0.17 + i * 0.25, 0.17); }
    b.cyl(0.1, 0.16, 0.25, '#2bb3a6', 0.25, 0.85, -0.1, 8);
    b.sphere(0.2, '#f08ab0', 0.25, 1.15, -0.1, 1, 0.8, 1);
    b.box(0.25, 0.3, 0.03, '#f4f1ea', -0.2, 0.85, -0.3);
  },
  sofa: (b) => sofaShape(b, 2, '#c75b4a'),
  armchair: (b) => sofaShape(b, 1, '#3f7d74'),
  bench: (b) => {
    for (let i = 0; i < 4; i++) b.box(1.8, 0.04, 0.1, WOOD, 0, 0.43, -0.18 + i * 0.12);
    for (let i = 0; i < 3; i++) b.box(1.8, 0.08, 0.04, WOOD, 0, 0.55 + i * 0.14, -0.3);
    for (const x of [-0.8, 0.8]) { b.box(0.06, 0.45, 0.5, DARK, x, 0, -0.05); b.box(0.06, 0.45, 0.06, DARK, x, 0.43, -0.3); }
  },
  tv: (b) => {
    b.box(0.92, 0.48, 0.42, DARKWOOD, 0, 0, -0.1);
    b.box(0.82, 0.5, 0.05, DARK, 0, 0.55, -0.15);
    b.glow(b.box(0.76, 0.44, 0.01, '#5b8fd6', 0, 0.58, -0.12), 'screen');
    b.box(0.2, 0.08, 0.15, DARK, 0, 0.48, -0.15);
  },
  tv_big: (b) => {
    b.box(1.9, 0.45, 0.45, DARK, 0, 0, -0.08);
    b.box(1.7, 0.98, 0.06, '#1b1d22', 0, 0.6, -0.15);
    b.glow(b.box(1.62, 0.9, 0.01, '#5b8fd6', 0, 0.64, -0.115), 'screen');
    b.box(0.25, 0.15, 0.15, '#1b1d22', 0, 0.45, -0.15);
  },
  coffee_table: (b) => {
    b.box(1.4, 0.05, 0.65, LIGHTWOOD, 0, 0.38, 0);
    b.legs(1.35, 0.6, 0.38, DARKWOOD, 0.05, 0.05);
    b.cyl(0.09, 0.08, 0.1, WHITE, 0.3, 0.43, 0.05, 8);
    b.box(0.3, 0.04, 0.22, '#c0392b', -0.3, 0.43, 0);
  },
  rug: (b) => {
    b.box(1.9, 0.015, 1.9, '#7a3f5e', 0, 0, 0);
    b.box(1.6, 0.02, 1.6, '#d9a441', 0, 0, 0);
    b.box(1.2, 0.025, 1.2, '#7a3f5e', 0, 0, 0);
  },
  stereo: (b) => {
    b.box(0.5, 0.6, 0.4, DARKWOOD, 0, 0, -0.1);
    b.box(0.42, 0.22, 0.32, DARK, 0, 0.6, -0.1);
    for (const x of [-0.38, 0.38]) { b.box(0.2, 0.8, 0.25, DARK, x, 0, -0.1); b.cyl(0.12, 0.12, 0.02, '#555', x, 0.45, 0.03, 10).rotation.x = Math.PI / 2; }
    b.glow(b.box(0.2, 0.04, 0.01, '#7dff9a', 0, 0.72, 0.065), 'screen');
  },
  guitar: (b) => guitarShape(b, '#c77b3a', DARKWOOD),
  golden_guitar: (b) => { guitarShape(b, '#e6c04a', '#b8902c'); b.glow(b.sphere(0.1, '#fff3b0', 0.15, 1.15, 0.05), 'sparkle'); },
  piano: (b) => {
    b.box(1.6, 1.25, 0.55, '#2b1c14', 0, 0, -0.15);
    b.box(1.5, 0.05, 0.25, '#2b1c14', 0, 0.72, 0.22);
    b.box(1.4, 0.03, 0.18, WHITE, 0, 0.77, 0.2);
    for (let i = 0; i < 14; i++) if (i % 7 !== 2 && i % 7 !== 6) b.box(0.04, 0.02, 0.1, DARK, -0.65 + i * 0.1, 0.8, 0.16);
    b.box(0.9, 0.06, 0.35, '#2b1c14', 0, 0.45, 0.75);
    b.legs(0.85, 0.3, 0.45, '#2b1c14', 0.05, 0.05);
  },
  easel: (b) => easelShape(b, '#fdfbf5', LIGHTWOOD),
  inspiring_easel: (b) => { easelShape(b, '#a7d8f0', BRASS); b.box(0.3, 0.2, 0.01, '#f08ab0', -0.08, 0.82, 0.16); b.box(0.25, 0.15, 0.01, '#f2c14e', 0.1, 0.76, 0.16); },
  chess: (b) => {
    b.cyl(0.12, 0.3, 0.7, DARKWOOD, 0, 0, 0, 8);
    b.box(0.7, 0.05, 0.7, WOOD, 0, 0.7, 0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) b.box(0.14, 0.01, 0.14, (i + j) % 2 ? '#f3e7d0' : '#3a2a1f', -0.21 + i * 0.14, 0.75, -0.21 + j * 0.14);
    b.cyl(0.04, 0.06, 0.1, WHITE, -0.1, 0.76, 0.15, 6);
    b.cyl(0.04, 0.06, 0.12, DARK, 0.1, 0.76, -0.15, 6);
    for (const z of [0.75, -0.75]) { b.cyl(0.32, 0.32, 0.05, '#7a5230', 0, 0.42, z, 10); b.cyl(0.06, 0.08, 0.42, DARK, 0, 0, z, 6); }
  },
  telescope: (b) => {
    for (let i = 0; i < 3; i++) { const l = b.box(0.04, 1.2, 0.04, DARK, Math.sin(i * 2.1) * 0.2, 0, Math.cos(i * 2.1) * 0.2); l.rotation.z = Math.sin(i * 2.1) * -0.2; l.rotation.x = Math.cos(i * 2.1) * 0.2; }
    const tube = b.cyl(0.14, 0.18, 0.9, WHITE, 0, 1.1, 0, 12); tube.rotation.x = 0.9;
    b.cyl(0.16, 0.16, 0.05, DARK, 0, 1.1, 0, 10);
  },
  chem_kit: (b) => {
    b.box(1.8, 0.05, 0.7, WHITE, 0, 0.85, -0.05);
    b.box(1.75, 0.85, 0.65, '#8fa3b5', 0, 0, -0.05);
    b.glow(b.cyl(0.06, 0.16, 0.22, '#7dff9a', -0.5, 0.9, 0), 'flask');
    b.glow(b.cyl(0.08, 0.08, 0.25, '#ff7dd6', -0.2, 0.9, -0.1), 'flask');
    b.glow(b.sphere(0.16, '#7dd3ff', 0.2, 0.98, 0), 'flask');
    b.box(0.3, 0.35, 0.3, DARK, 0.6, 0.9, -0.15);
    b.cyl(0.03, 0.03, 0.4, METAL, 0.2, 0.9, -0.2, 6);
  },
  workbench: (b) => {
    b.box(1.85, 0.08, 0.75, '#8a5a32', 0, 0.85, -0.05);
    b.legs(1.8, 0.7, 0.85, DARKWOOD, 0.06, 0.09);
    b.box(1.7, 0.04, 0.6, DARKWOOD, 0, 0.25, -0.05);
    b.box(0.2, 0.18, 0.16, '#44505c', -0.6, 0.93, 0.18);
    b.box(1.6, 0.9, 0.04, '#9c7a54', 0, 0.93, -0.4);
    for (let i = 0; i < 6; i++) b.box(0.06, 0.18, 0.02, i % 2 ? METAL : BRASS, -0.6 + i * 0.25, 1.4, -0.37);
    b.box(0.14, 0.12, 0.08, BRASS, 0.1, 0.93, 0.05);
    b.torus(0.1, 0.025, METAL, 0.1, 1.08, 0.05, 10).rotation.x = Math.PI / 2;
    b.box(0.25, 0.05, 0.12, '#c44', 0.5, 0.93, 0.05);
  },
  treadmill: (b) => {
    b.box(0.8, 0.15, 1.7, DARK, 0, 0, 0.1);
    b.box(0.66, 0.02, 1.5, '#555', 0, 0.15, 0.1);
    for (const x of [-0.36, 0.36]) b.box(0.05, 1.2, 0.05, METAL, x, 0.15, -0.7);
    b.box(0.8, 0.25, 0.2, DARK, 0, 1.25, -0.7);
    b.glow(b.box(0.3, 0.12, 0.01, '#7dff9a', 0, 1.32, -0.59), 'screen');
  },
  weights: (b) => {
    b.box(0.35, 0.12, 1.2, '#c0392b', 0, 0.42, 0.1);
    b.legs(0.3, 1.0, 0.42, DARK, 0.04, 0.06);
    for (const x of [-0.42, 0.42]) b.box(0.05, 1.1, 0.05, METAL, x, 0, -0.45);
    b.cyl(0.04, 0.04, 1.4, METAL, 0, 1.05, -0.45, 6).rotation.z = Math.PI / 2;
    for (const x of [-0.6, 0.6]) b.cyl(0.4, 0.4, 0.06, DARK, x, 1.05, -0.45, 12).rotation.z = Math.PI / 2;
  },
  veg_patch: (b, _def, obj) => {
    b.box(1.9, 0.12, 1.9, SOIL, 0, 0, 0);
    for (const [w, d, x, z] of [[1.95, 0.08, 0, 0.95], [1.95, 0.08, 0, -0.95], [0.08, 1.95, 0.95, 0], [0.08, 1.95, -0.95, 0]]) b.box(w, 0.2, d, WOOD, x, 0, z);
    const g = obj?.growth ?? 0;
    if (g <= 0) return;
    const stage = g >= 100 ? 3 : g >= 50 ? 2 : 1;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const x = -0.6 + i * 0.6, z = -0.6 + j * 0.6;
      if (stage === 1) b.sphere(0.12, LEAF2, x, 0.16, z, 1, 0.6, 1);
      else {
        b.sphere(stage === 3 ? 0.38 : 0.26, LEAF, x, 0.25, z, 1, 0.8, 1);
        if (stage === 3) b.sphere(0.14, (i + j) % 2 ? '#e7833a' : '#c0392b', x + 0.1, 0.3, z + 0.12);
      }
    }
  },
  bbq: (b) => {
    for (let i = 0; i < 3; i++) b.box(0.04, 0.6, 0.04, DARK, Math.sin(i * 2.1) * 0.2, 0, Math.cos(i * 2.1) * 0.2);
    b.sphere(0.6, DARK, 0, 0.75, 0, 1, 0.55, 1, 8);
    b.cyl(0.58, 0.58, 0.03, '#666', 0, 0.75, 0, 12);
    const lid = b.sphere(0.58, '#1c1c1c', 0, 0.85, -0.25, 1, 0.5, 1, 8); lid.rotation.x = -1.1;
  },
  goal: (b) => {
    for (const x of [-0.95, 0.95]) b.cyl(0.08, 0.08, 1.4, WHITE, x, 0, 0.3, 8);
    b.cyl(0.08, 0.08, 1.98, WHITE, 0, 1.36, 0.3, 8).rotation.z = Math.PI / 2;
    for (const x of [-0.95, 0.95]) { const s = b.box(0.04, 1.5, 0.04, WHITE, x, 0, -0.2); s.rotation.x = 0.35; }
    b.glassPart(b.box(1.9, 1.35, 0.02, '#ffffff', 0, 0, -0.3));
    b.sphere(0.22, WHITE, 0.4, 0.11, 1.3);
  },
  mailbox: (b) => {
    b.box(0.08, 1.0, 0.08, DARKWOOD, 0, 0, 0);
    b.box(0.35, 0.3, 0.45, '#c0392b', 0, 1.0, 0);
    b.cyl(0.35, 0.35, 0.45, '#c0392b', 0, 1.15, 0, 12).rotation.x = Math.PI / 2;
    b.box(0.2, 0.03, 0.02, DARK, 0, 1.15, 0.24);
  },
  floor_lamp: (b) => {
    b.cyl(0.35, 0.35, 0.04, DARK, 0, 0, 0, 12);
    b.cyl(0.04, 0.04, 1.4, BRASS, 0, 0.04, 0, 6);
    lampShade(b, 1.35, 0.5, 0.35);
  },
  table_lamp: (b) => {
    b.cyl(0.55, 0.55, 0.04, WOOD, 0, 0.55, 0, 12);
    b.cyl(0.06, 0.06, 0.55, DARKWOOD, 0, 0, 0, 6);
    b.cyl(0.35, 0.35, 0.03, DARKWOOD, 0, 0, 0, 10);
    b.cyl(0.12, 0.16, 0.25, '#2bb3a6', 0, 0.59, 0, 8);
    lampShade(b, 0.84, 0.34, 0.25);
  },
  lantern: (b) => {
    b.cyl(0.25, 0.3, 0.15, DARK, 0, 0, 0, 8);
    b.cyl(0.08, 0.08, 2.0, DARK, 0, 0.15, 0, 6);
    b.box(0.1, 0.05, 0.4, DARK, 0, 2.0, 0);
    b.glow(b.box(0.26, 0.32, 0.26, '#ffe2b0', 0, 2.1, 0), 'lamp');
    b.cyl(0.05, 0.42, 0.15, DARK, 0, 2.42, 0, 4);
  },
  plant_small: (b) => {
    b.cyl(0.35, 0.25, 0.32, '#c96a3d', 0, 0, 0, 8);
    b.sphere(0.5, LEAF, 0, 0.55, 0, 1, 0.9, 1);
    b.sphere(0.3, LEAF2, 0.1, 0.75, 0.05);
  },
  plant_big: (b) => {
    b.cyl(0.45, 0.35, 0.4, '#e9e4d8', 0, 0, 0, 8);
    b.cyl(0.05, 0.07, 1.0, DARKWOOD, 0, 0.4, 0, 6);
    for (let i = 0; i < 7; i++) b.sphere(0.32, i % 2 ? LEAF : LEAF2, Math.sin(i * 1.7) * 0.25, 1.0 + (i % 3) * 0.25, Math.cos(i * 1.7) * 0.25, 1, 0.55, 1);
  },
  aquarium: (b) => {
    b.box(1.6, 0.75, 0.55, DARKWOOD, 0, 0, -0.05);
    b.glow(b.box(1.5, 0.6, 0.45, '#5fc4ff', 0, 0.78, -0.05), 'water');
    b.box(1.58, 0.05, 0.53, DARK, 0, 1.4, -0.05);
    for (let i = 0; i < 4; i++) b.box(0.12, 0.06, 0.03, i % 2 ? '#ff9a3c' : '#ffd23c', -0.5 + i * 0.32, 0.95 + (i % 2) * 0.18, 0.18);
    b.sphere(0.18, LEAF, -0.6, 0.85, -0.1, 0.5, 1.6, 0.5);
  },
  winding_wheel: (b) => {
    b.box(0.7, 0.1, 0.7, '#555', 0, 0, 0);
    const l1 = b.box(0.06, 1.7, 0.06, '#7a2b20', -0.22, 0.05, 0.1); l1.rotation.z = 0.18;
    const l2 = b.box(0.06, 1.7, 0.06, '#7a2b20', 0.22, 0.05, 0.1); l2.rotation.z = -0.18;
    const l3 = b.box(0.06, 1.6, 0.06, '#7a2b20', 0, 0.05, -0.25); l3.rotation.x = -0.35;
    const w = b.torus(0.8, 0.05, DARK, 0, 1.75, 0.15, 20); w.rotation.x = Math.PI / 2; w.rotation.z = Math.PI / 2; w.rotation.y = Math.PI / 2;
    for (let i = 0; i < 4; i++) { const s = b.box(0.03, 0.78, 0.03, DARK, 0, 1.36, 0.15); s.rotation.z = (i * Math.PI) / 4; s.position.y = 1.75; }
  },
  lock_sculpture: (b) => {
    b.box(0.6, 0.15, 0.6, '#8c8c8c', 0, 0, 0);
    b.box(0.6, 0.6, 0.3, BRASS, 0, 0.15, 0);
    const sh = b.torus(0.45, 0.08, METAL, 0, 0.78, 0, 16); sh.rotation.x = Math.PI / 2; sh.rotation.y = Math.PI / 2;
    b.box(0.08, 0.16, 0.04, DARK, 0, 0.4, 0.16);
    b.sphere(0.1, DARK, 0, 0.5, 0.16, 1, 1, 0.3);
  },
  jukebox: (b) => {
    b.box(0.8, 1.2, 0.55, '#8b2a3a', 0, 0, -0.05);
    b.cyl(0.8, 0.8, 0.55, '#8b2a3a', 0, 1.2, -0.05, 16).rotation.x = Math.PI / 2;
    b.glow(b.box(0.6, 0.5, 0.01, '#ffcf6b', 0, 0.65, 0.23), 'lamp');
    b.glow(b.cyl(0.6, 0.6, 0.01, '#ff8ac8', 0, 1.2, 0.235, 16), 'lamp').rotation.x = Math.PI / 2;
  },
  antique_locks: (b) => {
    b.box(0.85, 1.7, 0.45, DARKWOOD, 0, 0, -0.1);
    b.glassPart(b.box(0.75, 1.3, 0.02, '#d9eef7', 0, 0.3, 0.13));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) b.box(0.12, 0.14, 0.06, j % 2 ? METAL : BRASS, -0.25 + j * 0.25, 0.4 + i * 0.42, 0.0);
  },
  racing_print: (b) => {
    const a = b.box(0.7, 1.4, 0.05, WOOD, 0, 0, 0.1); a.rotation.x = -0.12;
    const p = b.box(0.6, 0.9, 0.02, '#2f6b3a', 0, 0.35, 0.15); p.rotation.x = -0.12;
    const h = b.sphere(0.25, '#6b4126', 0, 0.85, 0.17, 1.6, 1, 0.2); h.rotation.x = -0.12;
    b.box(0.5, 0.08, 0.01, '#f2c14e', 0, 1.1, 0.19).rotation.x = -0.12;
    const c = b.box(0.7, 1.35, 0.05, WOOD, 0, 0, -0.1); c.rotation.x = 0.12;
  },
};

/** Build a merged mesh for an object. */
export function buildModel(scene: Scene, mats: Materials, def: ObjectDef, obj: PlacedObject | null, name: string): BuiltModel {
  const b = new ModelBuilder(scene);
  const fn = BUILDERS[def.id];
  if (fn) fn(b, def, obj);
  else b.box(def.footprint[0] * 0.9, 0.8, def.footprint[1] * 0.9, '#ff00ff');
  const root = b.parts.length > 1 ? Mesh.MergeMeshes(b.parts, true, true)! : b.parts[0];
  root.name = name;
  root.material = mats.vertexColor;
  const glow: Mesh[] = [];
  for (const g of b.glows) {
    const color = g.color === 'lamp' ? '#ffd9a0' : g.color === 'screen' ? '#5b8fd6' : g.color === 'water' ? '#5fc4ff' : g.color === 'flask' ? '#9cffb5' : '#fff3b0';
    g.mesh.material = mats.color(color, { emissive: g.color === 'lamp' ? 0.25 : 0.6 });
    g.mesh.metadata = { glowKind: g.color };
    g.mesh.parent = root;
    glow.push(g.mesh);
  }
  let glass: Mesh | null = null;
  if (b.glass.length) {
    glass = b.glass.length > 1 ? Mesh.MergeMeshes(b.glass, true, true)! : b.glass[0];
    glass.removeVerticesData(VertexBuffer.ColorKind);
    glass.material = mats.color('#cfeaf7', { alpha: 0.35, spec: 0.4 });
    glass.parent = root;
  }
  return { root, glow, glass };
}
