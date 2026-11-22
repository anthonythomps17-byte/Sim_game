// The neighbourhood around the lot, laid out like a real corner of Ashton-in-Makerfield:
// the lot sits on a side street of terraces, with a road crossing just to the north, an avenue
// and a park to the west, a curving main road to the east, a wider road and a primary school to
// the south. Street names are made up so no real address is identifiable.
//
// Orientation: the lot's street runs along x. Map north is -x, south is +x, west is -z, east is +z.
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { ModelBuilder } from './models';
import type { Materials } from './materials';

const BRICKS = ['#a14b35', '#9a4431', '#ad5640', '#8f3f2d', '#b05a43', '#c0b6a4'];
const DOORS = ['#2f5d50', '#3b4ba8', '#7a2b2b', '#2d3037', '#c9a227', '#5c3a6e'];

export type SeasonKey = 'spring' | 'summer' | 'autumn' | 'winter';
export interface Scenery { ground: Mesh; lotGround: Mesh; trees: Record<SeasonKey, Mesh>; lampPositions: Vector3[]; meshes: Mesh[] }

type P = [number, number]; // [x, z]

interface StreetDef { name: string; points: P[]; width: number; houses: boolean; sign?: P }

/** The street plan. */
function streets(lotD: number): StreetDef[] {
  return [
    // The lot's own street, from the north-east terraces to the wide road in the south.
    { name: 'Larkfield Close', points: [[-70, -4.5], [52, -4.5]], width: 4.5, houses: true, sign: [-12, -1.4] },
    // Crossing road just north of the lot, from the avenue to the main road.
    { name: 'Wellbrook Road', points: [[-16, -32], [-16, 70]], width: 5, houses: true, sign: [-19.5, 3] },
    // Avenue to the west, beside the park.
    { name: 'Maple Avenue', points: [[-125, -32], [52, -32], [110, -36]], width: 5, houses: true, sign: [-12, -28] },
    // Curving main road to the east.
    { name: 'Mill Lane', points: [[115, 68], [52, 70], [-16, 68], [-62, 52], [-125, 34]], width: 7, houses: true, sign: [-12, 64] },
    // Wide road to the south.
    { name: 'Heath Road', points: [[52, -130], [52, 130]], width: 7, houses: true, sign: [48, 3] },
    // A street of terraces to the north.
    { name: 'Cobden Street', points: [[-66, -32], [-70, 56]], width: 4.5, houses: true },
    // Diagonal road through the north-west.
    { name: 'Victoria Road', points: [[-125, -105], [-16, -32]], width: 6, houses: true },
    // Curving road further south.
    { name: 'Rowan Crescent', points: [[80, -130], [92, -60], [100, 0], [108, 40]], width: 5, houses: true },
    // Lane beside the lot.
    { name: '', points: [[24.5, 1], [24.5, 50], [52, 50]], width: 2.6, houses: false },
    // Back alley along the lot's rear.
    { name: '', points: [[-14, lotD + 3], [52, lotD + 3]], width: 2.6, houses: false },
  ];
}

/** Coarse occupancy grid (1 m) that stops houses overlapping roads, the park, the school and each other. */
class Occupancy {
  private grid: Uint8Array;
  constructor(private min = -140, private size = 280) { this.grid = new Uint8Array(size * size); }
  private idx(x: number, z: number) {
    const ix = Math.floor(x - this.min), iz = Math.floor(z - this.min);
    if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size) return -1;
    return iz * this.size + ix;
  }
  /** Mark (or test) an oriented rectangle: centre, half sizes, angle about y. */
  rect(cx: number, cz: number, hw: number, hd: number, angle: number, mark: boolean): boolean {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let u = -hw; u <= hw; u += 0.7) {
      for (let v = -hd; v <= hd; v += 0.7) {
        const x = cx + u * c + v * s, z = cz - u * s + v * c;
        const i = this.idx(x, z);
        if (i < 0) { if (!mark) return false; continue; }
        if (mark) this.grid[i] = 1;
        else if (this.grid[i]) return false;
      }
    }
    return true;
  }
}

function terraceHouse(b: ModelBuilder, brick: string, door: string, bay: boolean) {
  const w = 5, d = 6.5, h = 5.4;
  b.box(w - 0.04, h, d, brick, 0, 0, 0);
  // Pitched slate roof: a triangular prism with the ridge running along the street.
  const r = (d + 0.4) / Math.sqrt(3);
  const k = 2.3 / (1.5 * r);
  const roof = b.cyl(r * 2, r * 2, w + 0.02, '#4a515c', 0, 0, 0, 3);
  roof.rotation.z = Math.PI / 2;
  roof.scaling.set(k, 1, 1);
  roof.position.set(0, h + 0.5 * r * k, 0);
  b.box(0.7, 1.4, 0.7, brick, w / 2 - 0.6, h + 0.6, 0);
  b.box(0.8, 0.12, 0.8, '#6e3526', w / 2 - 0.6, h + 2.0, 0);
  const fz = d / 2 + 0.02;
  b.box(0.95, 2.1, 0.08, door, -1.3, 0, fz);
  b.box(1.15, 0.12, 0.12, '#e8e2d6', -1.3, 2.1, fz);
  b.box(0.6, 0.06, 0.6, '#cfc6b8', -1.3, 0, fz + 0.3);
  if (bay) {
    b.box(2.0, 2.3, 0.7, brick, 1.1, 0, fz + 0.3);
    b.box(1.8, 1.4, 0.06, '#2b3a4a', 1.1, 0.8, fz + 0.66);
    b.box(2.1, 0.15, 0.85, '#4a515c', 1.1, 2.3, fz + 0.3);
  } else {
    b.box(1.9, 1.6, 0.1, '#ece8df', 1.1, 0.7, fz);
    b.box(1.7, 1.4, 0.12, '#2b3a4a', 1.1, 0.8, fz + 0.02);
  }
  for (const wx of [-1.3, 1.1]) {
    b.box(1.4, 1.5, 0.1, '#ece8df', wx, 3.0, fz);
    b.box(1.2, 1.3, 0.12, '#2b3a4a', wx, 3.1, fz + 0.02);
  }
  // Low front wall with a gap for the path.
  b.box(w * 0.55, 0.6, 0.25, brick, 0.9, 0, fz + 1.5);
}

const TREE_COLOURS: Record<SeasonKey, [string, string]> = {
  spring: ['#f3b6cf', '#7fbf5a'],
  summer: ['#4f8f3e', '#62a64a'],
  autumn: ['#d9792b', '#e9b23a'],
  winter: ['#e8eef4', '#cfd9e2'],
};

function treeShape(b: ModelBuilder, season: SeasonKey) {
  const [a, c] = TREE_COLOURS[season];
  b.cyl(0.25, 0.35, 2.2, '#6b4529', 0, 0, 0, 6);
  b.sphere(2.6, a, 0, 2.9, 0, 1, 0.9, 1, 5);
  b.sphere(1.8, c, 0.6, 3.6, 0.3, 1, 1, 1, 5);
}

function makeTemplate(scene: Scene, mats: Materials, build: (b: ModelBuilder) => void, name: string): Mesh {
  const b = new ModelBuilder(scene);
  build(b);
  const m = Mesh.MergeMeshes(b.parts, true, true)!;
  m.name = name;
  m.material = mats.vertexColor;
  m.isPickable = false;
  m.receiveShadows = true;
  return m;
}

function setInstances(mesh: Mesh, list: Matrix[]) {
  if (!list.length) { mesh.setEnabled(false); return; }
  const buf = new Float32Array(list.length * 16);
  list.forEach((m, i) => m.copyToArray(buf, i * 16));
  mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
}

function signMaterial(scene: Scene, text: string, school: boolean): StandardMaterial {
  const w = 512, h = 112;
  const tex = new DynamicTexture('sign:' + text, { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = school ? '#1f4e8c' : '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = school ? '#ffffff' : '#1d1d1d';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = school ? '#ffffff' : '#1d1d1d';
  ctx.font = `bold ${text.length > 20 ? 36 : 46}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  tex.update();
  const m = new StandardMaterial('signm:' + text, scene);
  m.diffuseTexture = tex;
  m.specularColor = new Color3(0, 0, 0);
  m.emissiveColor = new Color3(0.3, 0.3, 0.3);
  return m;
}

function addSign(scene: Scene, mats: Materials, text: string, x: number, z: number, rotY: number, meshes: Mesh[], width = 2.6, school = false) {
  const sign = MeshBuilder.CreatePlane('sign', { width, height: width * 0.22, sideOrientation: Mesh.DOUBLESIDE }, scene);
  sign.material = signMaterial(scene, text, school);
  sign.position.set(x, 1.9, z);
  sign.rotation.y = rotY;
  sign.isPickable = false;
  const post = MeshBuilder.CreateBox('signPost', { width: 0.08, height: 1.9, depth: 0.08 }, scene);
  post.material = mats.color('#555a60');
  post.position.set(x, 0.95, z);
  post.isPickable = false;
  meshes.push(sign, post);
}

/** A flat strip (road, pavement, path) between two points. */
function segment(b: ModelBuilder, a: P, c: P, width: number, color: string, y: number) {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const m = b.box(width, 0.02, len + width * 0.5, color, (a[0] + c[0]) / 2, y, (a[1] + c[1]) / 2);
  m.rotation.y = Math.atan2(c[0] - a[0], c[1] - a[1]);
}

export function buildScenery(scene: Scene, mats: Materials, lotW: number, lotD: number): Scenery {
  const meshes: Mesh[] = [];
  const occ = new Occupancy();

  const ground = MeshBuilder.CreateGround('ground', { width: 300, height: 300, subdivisions: 1 }, scene);
  ground.position.set(lotW / 2, 0, lotD / 2);
  ground.material = mats.pattern('grassWide', 'grass', '#6fa64f', 70);
  ground.receiveShadows = true;
  ground.metadata = { kind: 'ground' };
  meshes.push(ground);
  const lotGround = MeshBuilder.CreateGround('lotGround', { width: lotW, height: lotD }, scene);
  lotGround.position.set(lotW / 2, 0.004, lotD / 2);
  lotGround.material = mats.pattern('grassLot', 'grass', '#7dbb57', 6);
  lotGround.receiveShadows = true;
  lotGround.metadata = { kind: 'ground' };
  meshes.push(lotGround);

  // Keep the lot itself (and a margin) clear.
  occ.rect(lotW / 2, lotD / 2, lotW / 2 + 1.5, lotD / 2 + 1.5, 0, true);

  // ---------- Park (west) and school (south-east) ----------
  const flat = new ModelBuilder(scene);
  const park = { x0: -64, x1: 18, z0: -118, z1: -38 };
  flat.box(park.x1 - park.x0, 0.02, park.z1 - park.z0, '#78b552', (park.x0 + park.x1) / 2, 0.005, (park.z0 + park.z1) / 2);
  occ.rect((park.x0 + park.x1) / 2, (park.z0 + park.z1) / 2, (park.x1 - park.x0) / 2, (park.z1 - park.z0) / 2, 0, true);
  const pathPts: P[] = [[16, -40], [0, -55], [-20, -60], [-35, -80], [-30, -100], [-10, -108], [5, -95], [0, -75], [-20, -60]];
  for (let i = 0; i < pathPts.length - 1; i++) segment(flat, pathPts[i], pathPts[i + 1], 2.2, '#d8c9a3', 0.03);
  segment(flat, [-62, -45], [-35, -80], 2.2, '#d8c9a3', 0.03);
  const school = { x0: 58, x1: 96, z0: 70, z1: 112 };
  flat.box(school.x1 - school.x0, 0.02, school.z1 - school.z0, '#8cc066', (school.x0 + school.x1) / 2, 0.005, (school.z0 + school.z1) / 2);
  flat.box(16, 0.03, 18, '#9a9a96', 66, 0.01, 92);
  for (let i = 0; i < 4; i++) flat.box(0.2, 0.035, 3, '#f2c14e', 62 + i * 2.5, 0.012, 88);
  occ.rect((school.x0 + school.x1) / 2, (school.z0 + school.z1) / 2, (school.x1 - school.x0) / 2, (school.z1 - school.z0) / 2, 0, true);
  // Corner shops.
  occ.rect(-51, -44, 11, 4, 0, true);

  // ---------- Roads and pavements ----------
  const plan = streets(lotD);
  for (const st of plan) {
    for (let i = 0; i < st.points.length - 1; i++) {
      const [a, c] = [st.points[i], st.points[i + 1]];
      segment(flat, a, c, st.width, '#4b4e55', 0.03);
      const ang = Math.atan2(c[0] - a[0], c[1] - a[1]);
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (st.houses) {
        segment(flat, a, c, st.width + 4, '#b9b5ad', 0.02);
        if (st.width >= 5) {
          for (let t = 0; t < len; t += 6) {
            const k = t / len;
            flat.box(0.15, 0.035, 2.2, '#e8e4da', a[0] + (c[0] - a[0]) * k, 0.02, a[1] + (c[1] - a[1]) * k).rotation.y = ang;
          }
        }
      }
      occ.rect((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (st.width + 4) / 2, len / 2 + 2, ang, true);
    }
  }
  const flatMesh = Mesh.MergeMeshes(flat.parts, true, true)!;
  flatMesh.material = mats.vertexColor;
  flatMesh.receiveShadows = true;
  flatMesh.isPickable = false;
  meshes.push(flatMesh);

  // ---------- Terraced houses along every street (thin instances: one draw call per style) ----------
  const templates = [0, 1, 2, 3, 4, 5].map((i) => makeTemplate(scene, mats, (b) => terraceHouse(b, BRICKS[i], DOORS[i], i % 2 === 0), `terrace${i}`));
  const houseMats: Matrix[][] = templates.map(() => []);
  let n = 0;
  for (const st of plan) {
    if (!st.houses) continue;
    for (let i = 0; i < st.points.length - 1; i++) {
      const [a, c] = [st.points[i], st.points[i + 1]];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const dirX = (c[0] - a[0]) / len, dirZ = (c[1] - a[1]) / len;
      for (const side of [-1, 1]) {
        const nx = side * dirZ, nz = side * -dirX;
        const off = (st.width + 4) / 2 + 5.3;
        for (let t = 4; t < len - 4; t += 5) {
          const cx = a[0] + dirX * t + nx * off, cz = a[1] + dirZ * t + nz * off;
          // The front (+z of the model) faces the road.
          const angle = Math.atan2(-nx, -nz);
          if (!occ.rect(cx, cz, 1.8, 4.9, angle, false)) continue;
          occ.rect(cx, cz, 1.8, 4.9, angle, true);
          const hash = Math.abs(Math.sin(n * 12.9898 + i * 78.233) * 43758.5453) % 1;
          const ti = hash < 0.08 ? 5 : Math.floor(hash * 5) % 5;
          houseMats[ti].push(Matrix.Compose(Vector3.One(), Quaternion.RotationYawPitchRoll(angle, 0, 0), new Vector3(cx, 0, cz)));
          n++;
        }
      }
    }
  }
  templates.forEach((t, i) => { setInstances(t, houseMats[i]); meshes.push(t); });

  // ---------- Landmarks ----------
  const b = new ModelBuilder(scene);
  // Primary school.
  b.box(28, 6, 12, '#b5654a', 82, 0, 100);
  b.box(28.4, 0.4, 12.4, '#6e3526', 82, 6, 100);
  for (let i = 0; i < 9; i++) b.box(2, 2, 0.1, '#bfe2f2', 70.5 + i * 3, 2.2, 93.95);
  b.box(2, 2.6, 0.1, '#1f4e8c', 82, 0, 93.95);
  for (let i = 0; i < 18; i++) b.box(0.08, 1.4, 0.08, '#2d6b3a', school.x0 + 1 + i * 2, 0, school.z0 + 0.3);
  b.box(36, 0.1, 0.08, '#2d6b3a', 77, 1.35, school.z0 + 0.3);
  // A little parade of shops.
  ([['#2f6b8c'], ['#c0392b'], ['#2f5d50']] as const).forEach(([col], i) => {
    const x = -44 - i * 7, z = -44;
    b.box(6.8, 6, 7, '#a14b35', x, 0, z);
    b.box(6.6, 2.4, 0.12, '#bfe2f2', x, 0.4, z + 3.5);
    b.box(6.8, 0.7, 0.2, col, x, 2.9, z + 3.55);
  });
  // Skyline: church spire and the old pit-head winding gear.
  const cx = -150, cz = -20;
  b.box(10, 7, 18, '#9c8f80', cx, 0, cz);
  b.box(4.5, 15, 4.5, '#a89a8a', cx + 10, 0, cz);
  b.cyl(0.05, 4.6, 12, '#5a6170', cx + 10, 15, cz, 8);
  const gx = -60, gz = 160;
  for (const sx of [-1, 1]) { const leg = b.box(0.5, 20, 0.5, '#6b2a22', gx + sx * 3, 0, gz); leg.rotation.z = sx * 0.12; }
  const strut = b.box(0.5, 20, 0.5, '#6b2a22', gx, 0, gz - 5); strut.rotation.x = -0.35;
  const wheel = b.torus(6, 0.4, '#2d3037', gx, 19.5, gz, 24); wheel.rotation.z = Math.PI / 2; wheel.rotation.y = Math.PI / 2; wheel.rotation.x = Math.PI / 2;
  // Fences and hedges round the lot.
  for (let z = 0; z < lotD; z += 1) {
    b.box(0.08, 1.1, 1.0, '#8a6a48', -0.3, 0, z + 0.5);
    b.box(0.08, 1.1, 1.0, '#8a6a48', lotW + 0.3, 0, z + 0.5);
  }
  for (let x = 0; x < lotW; x += 1) b.box(1.0, 1.1, 0.08, '#8a6a48', x + 0.5, 0, lotD + 0.3);
  for (let x = 0; x < lotW; x += 2) if (x < 5 || x > 10) b.sphere(1.0, '#3f7a3a', x + 1, 0.45, -0.25, 1.1, 0.8, 0.7, 5);
  // Street lamps along the lot's street.
  const lamps: Vector3[] = [];
  for (const x of [-10, 4, 18, 32]) {
    b.cyl(0.14, 0.2, 4.2, '#2d3037', x, 0, -1.2, 8);
    b.box(0.1, 0.1, 1.0, '#2d3037', x, 4.1, -1.65);
    b.box(0.42, 0.25, 0.5, '#2d3037', x, 3.95, -2.1);
    lamps.push(new Vector3(x, 3.85, -2.1));
  }
  // Bus stop near the wide road.
  b.box(2.4, 0.08, 1.0, '#2d3037', 40, 2.3, -0.9);
  b.box(0.08, 2.3, 0.08, '#2d3037', 38.9, 0, -1.3);
  b.box(0.08, 2.3, 0.08, '#2d3037', 41.1, 0, -1.3);
  const city = Mesh.MergeMeshes(b.parts, true, true)!;
  city.material = mats.vertexColor;
  city.isPickable = false;
  city.receiveShadows = true;
  meshes.push(city);

  // ---------- Trees (thin instances, tinted by season) ----------
  const treeMats: Matrix[] = [];
  const addTree = (x: number, z: number, s: number) => treeMats.push(Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationYawPitchRoll(x * 0.37, 0, 0), new Vector3(x, 0, z)));
  for (let i = 0; i < 46; i++) {
    const x = park.x0 + 4 + ((i * 37) % (park.x1 - park.x0 - 8));
    const z = park.z0 + 4 + ((i * 53) % (park.z1 - park.z0 - 8));
    addTree(x, z, 0.8 + ((i * 13) % 7) * 0.08);
  }
  for (const [x, z, s] of [[-4, -1.2, 0.8], [26, -1.0, 0.9], [-3, 16, 1.1], [90, 74, 1.1], [60, 108, 1.0], [94, 110, 1.2], [-14, 30, 1.0], [28, 30, 0.9]] as const) addTree(x, z, s);
  // One tree model per season; the view shows the right one.
  const trees = {} as Record<SeasonKey, Mesh>;
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as SeasonKey[]) {
    trees[season] = makeTemplate(scene, mats, (tb) => treeShape(tb, season), `trees_${season}`);
    setInstances(trees[season], treeMats);
    trees[season].setEnabled(season === 'spring');
    meshes.push(trees[season]);
  }

  // ---------- Lamp glow and signs ----------
  const lampHeads = new ModelBuilder(scene);
  for (const p of lamps) lampHeads.box(0.32, 0.12, 0.4, '#ffe2b0', p.x, p.y - 0.06, p.z);
  const lampMesh = Mesh.MergeMeshes(lampHeads.parts, true, true)!;
  lampMesh.material = mats.color('#ffe2b0', { emissive: 0.9 });
  lampMesh.isPickable = false;
  lampMesh.metadata = { glowKind: 'street' };
  meshes.push(lampMesh);
  for (const st of plan) if (st.sign && st.name) addSign(scene, mats, st.name, st.sign[0], st.sign[1], -Math.PI / 2, meshes);
  addSign(scene, mats, 'Ashton-in-Makerfield', -6, -1.0, 0, meshes, 3);
  addSign(scene, mats, 'Hillcrest Primary School', 70, 69, 0, meshes, 3.6, true);
  addSign(scene, mats, 'Town Green Park', 17, -40, -Math.PI / 2, meshes, 3);
  return { ground, lotGround, trees, lampPositions: lamps, meshes };
}
