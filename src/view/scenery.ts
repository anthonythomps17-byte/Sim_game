// The street around the lot: red-brick terraces with slate roofs, a church spire and old pit-head gear
// on the skyline. A stylised Ashton-in-Makerfield, built from merged primitives (a handful of draw calls).
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ModelBuilder } from './models';
import type { Materials } from './materials';

const BRICKS = ['#a14b35', '#9a4431', '#ad5640', '#8f3f2d', '#b05a43'];
const DOORS = ['#2f5d50', '#3b4ba8', '#7a2b2b', '#2d3037', '#c9a227', '#5c3a6e'];

export interface Scenery { ground: Mesh; lampPositions: Vector3[]; meshes: Mesh[] }

function terraceHouse(b: ModelBuilder, x: number, z: number, facing: 1 | -1, i: number) {
  const w = 5, d = 6, h = 5.4;
  const brick = BRICKS[i % BRICKS.length];
  b.box(w - 0.05, h, d, brick, x, 0, z);
  const roof = b.cyl(0.01, d * 1.25, w, '#4a515c', x, h - 0.02, z, 3);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.x = Math.PI;
  roof.position.y = h + d * 0.18;
  roof.scaling.set(1, 1, 0.55);
  b.box(0.7, 1.4, 0.7, brick, x + w / 2 - 0.6, h + 0.6, z);
  b.box(0.8, 0.12, 0.8, '#6e3526', x + w / 2 - 0.6, h + 2.0, z);
  const fz = z + (facing * d) / 2 + facing * 0.02;
  // Front door, bay window and upstairs windows.
  b.box(0.95, 2.1, 0.08, DOORS[(i * 7) % DOORS.length], x - 1.3, 0, fz);
  b.box(1.15, 0.12, 0.12, '#e8e2d6', x - 1.3, 2.1, fz);
  b.box(0.6, 0.06, 0.6, '#cfc6b8', x - 1.3, 0, fz + facing * 0.3);
  for (const [wx, wy, ww, wh] of [[1.1, 0.8, 1.8, 1.5], [-1.3, 3.1, 1.1, 1.3], [1.1, 3.1, 1.6, 1.3]]) {
    b.box(ww + 0.2, wh + 0.2, 0.1, '#ece8df', x + wx, wy - 0.1, fz);
    b.box(ww, wh, 0.12, '#2b3a4a', x + wx, wy, fz + facing * 0.02);
    b.box(ww + 0.3, 0.1, 0.25, '#d9d2c4', x + wx, wy - 0.15, fz + facing * 0.1);
  }
  // Little front wall.
  b.box(w, 0.6, 0.25, brick, x, 0, z + facing * (d / 2 + 1.4));
}

function tree(b: ModelBuilder, x: number, z: number, s = 1) {
  b.cyl(0.25 * s, 0.35 * s, 2.2 * s, '#6b4529', x, 0, z, 6);
  b.sphere(2.6 * s, '#4f8f3e', x, 2.9 * s, z, 1, 0.9, 1, 5);
  b.sphere(1.8 * s, '#62a64a', x + 0.6 * s, 3.6 * s, z + 0.3 * s, 1, 1, 1, 5);
}

function streetLamp(b: ModelBuilder, x: number, z: number) {
  b.cyl(0.14, 0.2, 4.2, '#2d3037', x, 0, z, 8);
  b.box(0.1, 0.1, 1.0, '#2d3037', x, 4.1, z + 0.45);
  b.box(0.42, 0.25, 0.5, '#2d3037', x, 3.95, z + 0.9);
}

export function buildScenery(scene: Scene, mats: Materials, lotW: number, lotD: number): Scenery {
  const meshes: Mesh[] = [];
  // Grass everywhere, slightly brighter on the lot itself.
  const ground = MeshBuilder.CreateGround('ground', { width: 260, height: 260, subdivisions: 1 }, scene);
  ground.position.set(lotW / 2, 0, lotD / 2);
  ground.material = mats.pattern('grassWide', 'grass', '#6fa64f', 60);
  ground.receiveShadows = true;
  ground.metadata = { kind: 'ground' };
  meshes.push(ground);
  const lotGround = MeshBuilder.CreateGround('lotGround', { width: lotW, height: lotD }, scene);
  lotGround.position.set(lotW / 2, 0.004, lotD / 2);
  lotGround.material = mats.pattern('grassLot', 'grass', '#7dbb57', 6);
  lotGround.receiveShadows = true;
  lotGround.metadata = { kind: 'ground' };
  meshes.push(lotGround);

  const flat = new ModelBuilder(scene);
  // Pavement, kerb and road along the front of the lot.
  flat.box(300, 0.08, 2, '#b9b5ad', lotW / 2, 0, -1);
  flat.box(300, 0.1, 0.2, '#8d8a84', lotW / 2, 0, -2.0);
  flat.box(300, 0.03, 6, '#4b4e55', lotW / 2, 0, -5);
  for (let x = -120; x < 140; x += 4) flat.box(2, 0.035, 0.15, '#e8e4da', x, 0, -5);
  flat.box(300, 0.08, 2, '#b9b5ad', lotW / 2, 0, -9);
  // Back alley behind the lot.
  flat.box(300, 0.03, 3, '#8b8780', lotW / 2, 0, lotD + 3);
  const flatMesh = Mesh.MergeMeshes(flat.parts, true, true)!;
  flatMesh.material = mats.vertexColor;
  flatMesh.receiveShadows = true;
  flatMesh.isPickable = false;
  meshes.push(flatMesh);

  const b = new ModelBuilder(scene);
  let i = 0;
  // Opposite side of the street, facing the lot.
  for (let x = -40; x <= 62; x += 5) terraceHouse(b, x, -14, 1, i++);
  // Behind the lot, backs facing us.
  for (let x = -40; x <= 62; x += 5) terraceHouse(b, x, lotD + 9, -1, i++);
  // Neighbouring plots either side.
  for (const zz of [3, 11]) {
    terraceHouse(b, -8, zz, -1, i++);
    terraceHouse(b, lotW + 8, zz, -1, i++);
  }
  // Garden fences and hedges round the lot.
  for (let z = 0; z < lotD; z += 1) {
    b.box(0.08, 1.1, 1.0, '#8a6a48', -0.3, 0, z + 0.5);
    b.box(0.08, 1.1, 1.0, '#8a6a48', lotW + 0.3, 0, z + 0.5);
  }
  for (let x = 0; x < lotW; x += 1) b.box(1.0, 1.1, 0.08, '#8a6a48', x + 0.5, 0, lotD + 0.3);
  for (let x = 0; x < lotW; x += 2) if (x < 5 || x > 10) b.sphere(1.0, '#3f7a3a', x + 1, 0.45, -0.25, 1.1, 0.8, 0.7, 5);
  for (const [x, z, s] of [[-4, -1.2, 0.8], [26, -1.2, 0.9], [-3, 16, 1.1], [25, 6, 1.0], [-14, 30, 1.3], [40, 30, 1.2], [12, -20, 1.0], [-25, -20, 1.2]] as const) tree(b, x, z, s);
  const lamps: Vector3[] = [];
  for (const x of [-10, 4, 18, 32]) { streetLamp(b, x, -1.7); lamps.push(new Vector3(x, 3.85, -0.8)); }
  // A bus stop.
  b.box(2.4, 0.08, 1.0, '#2d3037', 30, 2.3, -1.2);
  b.box(0.08, 2.3, 0.08, '#2d3037', 28.9, 0, -1.6);
  b.box(0.08, 2.3, 0.08, '#2d3037', 31.1, 0, -1.6);

  // Skyline landmarks: a church spire (St Thomas') and pit-head winding gear.
  const cx = -30, cz = 48;
  b.box(10, 7, 18, '#9c8f80', cx, 0, cz);
  const nave = b.cyl(0.01, 13, 18, '#4a515c', cx, 7, cz, 3); nave.rotation.x = Math.PI / 2; nave.rotation.y = Math.PI / 2; nave.position.y = 9.3; nave.scaling.set(0.6, 1, 1);
  b.box(4.5, 15, 4.5, '#a89a8a', cx, 0, cz - 10);
  b.cyl(0.05, 4.6, 12, '#5a6170', cx, 15, cz - 10, 8);
  const gx = 70, gz = 50;
  for (const sx of [-1, 1]) { const leg = b.box(0.5, 20, 0.5, '#6b2a22', gx + sx * 3, 0, gz); leg.rotation.z = sx * 0.12; }
  const strut = b.box(0.5, 20, 0.5, '#6b2a22', gx, 0, gz - 5); strut.rotation.x = -0.35;
  const wheel = b.torus(6, 0.4, '#2d3037', gx, 19.5, gz, 24); wheel.rotation.z = Math.PI / 2; wheel.rotation.y = Math.PI / 2; wheel.rotation.x = Math.PI / 2;
  b.box(9, 6, 7, '#8f3f2d', gx + 6, 0, gz + 4);

  const city = Mesh.MergeMeshes(b.parts, true, true)!;
  city.material = mats.vertexColor;
  city.isPickable = false;
  city.receiveShadows = true;
  meshes.push(city);

  // Lamp heads glow at night.
  const lampHeads = new ModelBuilder(scene);
  for (const p of lamps) lampHeads.box(0.32, 0.12, 0.4, '#ffe2b0', p.x, p.y - 0.06, p.z - 0.0);
  const lampMesh = Mesh.MergeMeshes(lampHeads.parts, true, true)!;
  lampMesh.material = mats.color('#ffe2b0', { emissive: 0.9 });
  lampMesh.isPickable = false;
  lampMesh.metadata = { glowKind: 'street' };
  meshes.push(lampMesh);

  // Town sign.
  const signTex = new DynamicTexture('signTex', { width: 512, height: 128 }, scene, true);
  const ctx = signTex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#1d1d1d';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 492, 108);
  ctx.fillStyle = '#1d1d1d';
  ctx.font = 'bold 50px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Ashton-in-Makerfield', 256, 66);
  signTex.update();
  const signMat = new StandardMaterial('signMat', scene);
  signMat.diffuseTexture = signTex;
  signMat.specularColor = new Color3(0, 0, 0);
  signMat.emissiveColor = new Color3(0.25, 0.25, 0.25);
  const sign = MeshBuilder.CreatePlane('sign', { width: 3, height: 0.75, sideOrientation: Mesh.DOUBLESIDE }, scene);
  sign.material = signMat;
  sign.position.set(-6, 2.0, -2.6);
  sign.isPickable = false;
  const post = MeshBuilder.CreateBox('signPost', { width: 0.1, height: 2, depth: 0.1 }, scene);
  post.material = mats.color('#555a60');
  post.position.set(-6, 1, -2.55);
  meshes.push(sign, post);

  return { ground, lampPositions: lamps, meshes };
}
