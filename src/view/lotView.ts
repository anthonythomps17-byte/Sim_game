// Draws the lot: walls (with cutaway), floors, furniture, lamps, the build grid and placement previews.
// Walls and floors use thin instances, so the whole house is a handful of draw calls.
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { Light } from '@babylonjs/core/Lights/light';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { FLOORS, OBJECTS, PAINTS } from '../sim/defs';
import { footprintSize, parseWallKey } from '../sim/lot';
import type { Lot, PlacedObject, Wall } from '../sim/types';
import { buildModel } from './models';
import type { Materials } from './materials';

export const WALL_H = 2.6;
const LOW_H = 0.34;
const T = 0.07;

export type WallMode = 'up' | 'cutaway' | 'down';

interface Piece { base: string; cx: number; cy: number; cz: number; sx: number; sy: number; sz: number; rotY?: number; side?: 0 | 1 }

class InstanceSet {
  matrices: number[] = [];
  info: { key: string; side: 0 | 1 | null }[] = [];
  constructor(public mesh: Mesh) {
    mesh.thinInstanceEnablePicking = true;
  }
  add(m: Matrix, key: string, side: 0 | 1 | null) {
    for (let i = 0; i < 16; i++) this.matrices.push(m.m[i]);
    this.info.push({ key, side });
  }
  commit() {
    if (!this.info.length) {
      this.mesh.setEnabled(false);
      return;
    }
    this.mesh.setEnabled(true);
    this.mesh.thinInstanceSetBuffer('matrix', new Float32Array(this.matrices), 16, false);
    this.mesh.thinInstanceRefreshBoundingInfo(false);
  }
  reset() { this.matrices = []; this.info = []; }
}

interface ObjectView { root: Mesh; glow: Mesh[]; key: string; light: PointLight | null; obj: PlacedObject }

export class LotView {
  private wallSets = new Map<string, InstanceSet>();
  private floorSets = new Map<string, InstanceSet>();
  private objects = new Map<number, ObjectView>();
  private grid: Mesh;
  private outline: Mesh;
  private ghost: { root: Mesh; defId: string } | null = null;
  private ghostMat: StandardMaterial;
  private ghostBad: StandardMaterial;
  private previewSet: InstanceSet;
  private floorPreview: Mesh;
  private version = -1;
  private loweredSig = '';
  private highlighted: number | null = null;
  wallMode: WallMode = 'cutaway';
  private lot: Lot | null = null;
  private weedMesh: Mesh | null = null;
  private weedLevel = -1;

  /** Weed tufts scattered over the lawn; more as the weeds level rises. */
  setWeeds(lot: Lot, level: number, isLawn: (x: number, z: number) => boolean) {
    const bucket = Math.round(level / 10);
    if (bucket === this.weedLevel && this.weedMesh) return;
    this.weedLevel = bucket;
    if (!this.weedMesh) {
      const m = MeshBuilder.CreateCylinder('weed', { diameterTop: 0.5, diameterBottom: 0.05, height: 0.28, tessellation: 5 }, this.scene);
      m.material = this.mats.color('#5c7d2a');
      m.isPickable = false;
      m.thinInstanceEnablePicking = false;
      this.weedMesh = m;
    }
    const n = Math.max(0, Math.round((level - 20) * 0.6));
    const list: number[] = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 400 && list.length / 16 < n; i++) {
      const x = rnd() * lot.width, z = 0.5 + rnd() * (lot.depth - 0.5);
      if (!isLawn(Math.floor(x), Math.floor(z))) continue;
      const s = 0.6 + rnd() * 0.7;
      Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationYawPitchRoll(rnd() * 6, 0, 0), new Vector3(x, 0.12, z)).copyToArray(list as unknown as Float32Array, list.length);
    }
    if (!n) { this.weedMesh.setEnabled(false); return; }
    this.weedMesh.setEnabled(true);
    this.weedMesh.thinInstanceSetBuffer('matrix', new Float32Array(list), 16, false);
    this.weedMesh.thinInstanceRefreshBoundingInfo(false);
  }

  constructor(private scene: Scene, private mats: Materials, private shadows: () => ShadowGenerator | null, private addLight: (l: Light) => void, private removeLight: (l: Light) => void) {
    this.ghostMat = new StandardMaterial('ghostOk', scene);
    this.ghostMat.diffuseColor = new Color3(0.5, 1, 0.6);
    this.ghostMat.emissiveColor = new Color3(0.1, 0.35, 0.15);
    this.ghostMat.alpha = 0.6;
    this.ghostBad = new StandardMaterial('ghostBad', scene);
    this.ghostBad.diffuseColor = new Color3(1, 0.45, 0.45);
    this.ghostBad.emissiveColor = new Color3(0.4, 0.05, 0.05);
    this.ghostBad.alpha = 0.6;
    const prev = MeshBuilder.CreateBox('wallPreview', { size: 1 }, scene);
    prev.material = this.ghostMat;
    prev.isPickable = false;
    this.previewSet = new InstanceSet(prev);
    this.previewSet.mesh.thinInstanceEnablePicking = false;
    this.previewSet.commit();
    this.floorPreview = MeshBuilder.CreateGround('floorPreview', { width: 1, height: 1 }, scene);
    this.floorPreview.material = this.ghostMat;
    this.floorPreview.isPickable = false;
    this.floorPreview.setEnabled(false);
    this.grid = MeshBuilder.CreateBox('grid', { size: 0.01 }, scene);
    this.outline = this.grid;
  }

  init(lot: Lot) {
    this.lot = lot;
    this.grid.dispose();
    const lines: Vector3[][] = [];
    for (let x = 0; x <= lot.width; x++) lines.push([new Vector3(x, 0.03, 0), new Vector3(x, 0.03, lot.depth)]);
    for (let z = 0; z <= lot.depth; z++) lines.push([new Vector3(0, 0.03, z), new Vector3(lot.width, 0.03, z)]);
    this.grid = MeshBuilder.CreateLineSystem('grid', { lines, colors: lines.map((l) => l.map(() => new Color4(1, 1, 1, 0.35))) }, this.scene);
    this.grid.isPickable = false;
    this.grid.setEnabled(false);
    this.outline.dispose?.();
    const o = [new Vector3(0, 0.03, 0), new Vector3(lot.width, 0.03, 0), new Vector3(lot.width, 0.03, lot.depth), new Vector3(0, 0.03, lot.depth), new Vector3(0, 0.03, 0)];
    this.outline = MeshBuilder.CreateLines('lotOutline', { points: o, colors: o.map(() => new Color4(1, 1, 1, 0.5)) }, this.scene);
    this.outline.isPickable = false;
    for (const v of this.objects.values()) this.disposeObject(v);
    this.objects.clear();
    this.version = -1;
  }

  showGrid(on: boolean) { this.grid.setEnabled(on); }

  // ---------- Sync ----------

  sync(lot: Lot, cam: { x: number; z: number; tx: number; tz: number }, night: boolean, roomAt: (x: number, z: number) => number) {
    this.lot = lot;
    const lowered = this.computeLowered(lot, cam, roomAt);
    const sig = [...lowered].sort().join('|') + this.wallMode;
    if (lot.version !== this.version) {
      this.version = lot.version;
      this.rebuildFloors(lot);
      this.syncObjects(lot, night);
      this.loweredSig = '';
    }
    if (sig !== this.loweredSig) {
      this.loweredSig = sig;
      this.rebuildWalls(lot, lowered);
    }
  }

  /**
   * Cutaway: a wall goes down when the room on its far side (seen from the camera) is indoors.
   * Front and interior walls drop; back walls with the garden behind them stay up.
   */
  private computeLowered(lot: Lot, cam: { x: number; z: number; tx: number; tz: number }, roomAt: (x: number, z: number) => number): Set<string> {
    const out = new Set<string>();
    if (this.wallMode === 'up') return out;
    if (this.wallMode === 'down') { for (const k in lot.walls) out.add(k); return out; }
    for (const key in lot.walls) {
      const { dir, x, z } = parseWallKey(key);
      // Which side is the camera on? The far tile is on the other side.
      const camLow = dir === 'h' ? cam.z < z : cam.x < x;
      const far = dir === 'h' ? (camLow ? { x, z } : { x, z: z - 1 }) : camLow ? { x, z } : { x: x - 1, z };
      if (far.x < 0 || far.z < 0 || far.x >= lot.width || far.z >= lot.depth) continue;
      if (roomAt(far.x, far.z) !== 0) out.add(key);
    }
    return out;
  }

  private wallSet(base: string): InstanceSet {
    let set = this.wallSets.get(base);
    if (set) return set;
    const mesh = MeshBuilder.CreateBox('w_' + base, { size: 1 }, this.scene);
    if (base.startsWith('paint:')) {
      const p = PAINTS[base.slice(6)] ?? PAINTS.plaster;
      mesh.material = this.mats.pattern('wall_' + p.id, p.pattern, p.color, 1, WALL_H);
    } else if (base === 'cap' || base === 'pillar') {
      mesh.material = this.mats.color('#5d564f');
    } else if (base === 'glass') {
      mesh.material = this.mats.color('#bfe3f5', { alpha: 0.35, spec: 0.6 });
    } else if (base === 'frame') {
      mesh.material = this.mats.color('#f4f1ea');
    } else if (base === 'leaf') {
      mesh.material = this.mats.color('#7a4f2e');
    }
    mesh.receiveShadows = base !== 'glass';
    if (base !== 'glass') this.shadows()?.addShadowCaster(mesh);
    mesh.metadata = { kind: 'wall', set: base };
    set = new InstanceSet(mesh);
    this.wallSets.set(base, set);
    return set;
  }

  private rebuildWalls(lot: Lot, lowered: Set<string>) {
    for (const s of this.wallSets.values()) s.reset();
    const corners = new Map<string, { x: number; z: number; low: boolean }>();
    const tmp = new Matrix();
    for (const key in lot.walls) {
      const wall = lot.walls[key];
      const low = lowered.has(key);
      const { dir, x, z } = parseWallKey(key);
      const cx = dir === 'h' ? x + 0.5 : x, cz = dir === 'h' ? z : z + 0.5;
      const segRot = dir === 'h' ? 0 : Math.PI / 2;
      const seg = Matrix.RotationY(segRot).multiply(Matrix.Translation(cx, 0, cz));
      for (const p of segmentPieces(wall, low)) {
        const base = p.base === 'paint' ? 'paint:' + wall.paint[p.side!] : p.base;
        const local = Matrix.Compose(new Vector3(p.sx, p.sy, p.sz), Quaternion.RotationYawPitchRoll(p.rotY ?? 0, 0, 0), new Vector3(p.cx, p.cy, p.cz));
        local.multiplyToRef(seg, tmp);
        this.wallSet(base).add(tmp, key, p.side ?? null);
      }
      const ends = dir === 'h' ? [[x, z], [x + 1, z]] : [[x, z], [x, z + 1]];
      for (const [ex, ez] of ends) {
        const k = `${ex},${ez}`;
        const c = corners.get(k);
        if (!c) corners.set(k, { x: ex, z: ez, low });
        else c.low = c.low && low;
      }
    }
    for (const [k, c] of corners) {
      const h = c.low ? LOW_H : WALL_H;
      this.wallSet('pillar').add(Matrix.Compose(new Vector3(T * 2 + 0.01, h + 0.03, T * 2 + 0.01), Quaternion.Identity(), new Vector3(c.x, (h + 0.03) / 2, c.z)), k, null);
    }
    for (const s of this.wallSets.values()) s.commit();
  }

  private rebuildFloors(lot: Lot) {
    for (const s of this.floorSets.values()) s.reset();
    for (let i = 0; i < lot.floors.length; i++) {
      const f = lot.floors[i];
      if (!f) continue;
      let set = this.floorSets.get(f);
      if (!set) {
        const def = FLOORS[f];
        const mesh = MeshBuilder.CreateGround('f_' + f, { width: 1, height: 1 }, this.scene);
        mesh.material = this.mats.pattern('floor_' + f, def?.pattern, def?.color ?? '#999', 1);
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        set = new InstanceSet(mesh);
        set.mesh.thinInstanceEnablePicking = false;
        this.floorSets.set(f, set);
      }
      const x = i % lot.width, z = Math.floor(i / lot.width);
      set.add(Matrix.Translation(x + 0.5, 0.012, z + 0.5), String(i), null);
    }
    for (const s of this.floorSets.values()) s.commit();
  }

  /** Find which wall (and side) a thin instance pick refers to. */
  wallFromPick(meshName: string, index: number, point: Vector3): { key: string; side: 0 | 1 } | null {
    for (const [base, set] of this.wallSets) {
      if ('w_' + base !== meshName) continue;
      const info = set.info[index];
      if (!info) return null;
      const { dir, x, z } = parseWallKey(info.key);
      const side: 0 | 1 = dir === 'h' ? (point.z < z ? 0 : 1) : point.x < x ? 0 : 1;
      if (info.key.includes(',') && this.lot?.walls[info.key]) return { key: info.key, side };
      return null;
    }
    return null;
  }

  // ---------- Objects ----------

  private objectKey(o: PlacedObject): string {
    const stage = o.defId === 'veg_patch' ? (o.growth >= 100 ? 3 : o.growth >= 50 ? 2 : o.growth > 0 ? 1 : 0) : o.defId === 'pumpkin' ? (o.growth >= 100 ? 1 : 0) : o.defId === 'washing_line' ? (o.load ? 1 : 0) : 0;
    return `${o.defId}:${stage}`;
  }

  private syncObjects(lot: Lot, night: boolean) {
    const seen = new Set<number>();
    for (const o of lot.objects) {
      seen.add(o.id);
      let v = this.objects.get(o.id);
      const key = this.objectKey(o);
      if (v && v.key !== key) { this.disposeObject(v); this.objects.delete(o.id); v = undefined; }
      if (!v) {
        v = this.createObject(o, key);
        this.objects.set(o.id, v);
      }
      v.obj = o;
      this.placeObject(v, o);
      this.updateLight(v, o, night);
    }
    for (const [id, v] of this.objects) if (!seen.has(id)) { this.disposeObject(v); this.objects.delete(id); }
    this.setHighlight(this.highlighted);
  }

  /** Called when plants grow or lamps switch without a version bump. */
  refreshDynamic(lot: Lot, night: boolean) {
    for (const o of lot.objects) {
      const v = this.objects.get(o.id);
      if (!v) continue;
      if (v.key !== this.objectKey(o)) { this.version = -1; return; }
      this.updateLight(v, o, night);
    }
  }

  private createObject(o: PlacedObject, key: string): ObjectView {
    const def = OBJECTS[o.defId];
    const built = buildModel(this.scene, this.mats, def, o, `obj${o.id}`);
    const meta = { kind: 'object', id: o.id };
    built.root.metadata = meta;
    for (const g of built.glow) g.metadata = { ...meta, glowKind: g.metadata?.glowKind };
    if (built.glass) built.glass.metadata = meta;
    built.root.receiveShadows = true;
    if (def.id !== 'rug') this.shadows()?.addShadowCaster(built.root, true);
    let light: PointLight | null = null;
    if (def.light) {
      const h = def.id === 'lantern' ? 2.2 : def.id === 'floor_lamp' ? 1.55 : 1.0;
      light = new PointLight(`lamp${o.id}`, new Vector3(0, h, 0), this.scene);
      light.diffuse = Color3.FromHexString(def.light.color);
      light.specular = new Color3(0.1, 0.1, 0.1);
      light.range = def.light.range;
      light.intensity = 0;
      light.metadata = { height: h };
      this.addLight(light);
    }
    return { root: built.root, glow: built.glow, key, light, obj: o };
  }

  private placeObject(v: ObjectView, o: PlacedObject) {
    const def = OBJECTS[o.defId];
    const [W, D] = footprintSize(def, o.rot);
    v.root.position.set(o.x + W / 2, 0.015, o.z + D / 2);
    // A car out on the road isn't on the drive.
    v.root.setEnabled(!o.outWith);
    if (o.broken) {
      v.root.renderOutline = true;
      v.root.outlineColor = new Color3(0.95, 0.2, 0.2);
      v.root.outlineWidth = 0.035;
    } else if (this.highlighted !== o.id) v.root.renderOutline = false;
    v.root.rotation.y = (o.rot * Math.PI) / 2;
    if (v.light) v.light.position.set(o.x + W / 2, v.light.metadata.height, o.z + D / 2);
  }

  private updateLight(v: ObjectView, o: PlacedObject, night: boolean) {
    if (!v.light) {
      // Screens glow, lamps follow their switch.
      return;
    }
    const def = OBJECTS[o.defId];
    const on = o.lightOn;
    v.light.intensity = on ? def.light!.intensity * (night ? 1 : 0.4) : 0;
    v.light.setEnabled(on);
    for (const g of v.glow) {
      if (g.metadata?.glowKind === 'lamp' && o.defId !== 'christmas_tree') g.material = this.mats.color('#ffd9a0', { emissive: on ? 0.95 : 0.12 });
    }
  }

  private disposeObject(v: ObjectView) {
    if (v.light) { this.removeLight(v.light); v.light.dispose(); }
    v.root.dispose(false, true);
  }

  setHighlight(id: number | null) {
    if (this.highlighted !== null) {
      const old = this.objects.get(this.highlighted);
      if (old) old.root.renderOutline = false;
    }
    this.highlighted = id;
    const v = id !== null ? this.objects.get(id) : undefined;
    if (v) {
      v.root.renderOutline = true;
      v.root.outlineColor = new Color3(1, 0.85, 0.3);
      v.root.outlineWidth = 0.025;
    }
  }

  objectMesh(id: number): Mesh | undefined { return this.objects.get(id)?.root; }

  // ---------- Previews ----------

  setGhost(defId: string | null, x = 0, z = 0, rot = 0, ok = true) {
    if (!defId) {
      this.ghost?.root.dispose(false, true);
      this.ghost = null;
      return;
    }
    if (!this.ghost || this.ghost.defId !== defId) {
      this.ghost?.root.dispose(false, true);
      const built = buildModel(this.scene, this.mats, OBJECTS[defId], null, 'ghost');
      built.root.isPickable = false;
      for (const m of built.root.getChildMeshes()) m.isPickable = false;
      this.ghost = { root: built.root, defId };
    }
    const mat = ok ? this.ghostMat : this.ghostBad;
    this.ghost.root.material = mat;
    for (const m of this.ghost.root.getChildMeshes()) m.material = mat;
    const def = OBJECTS[defId];
    const [W, D] = footprintSize(def, rot);
    this.ghost.root.position.set(x + W / 2, 0.03, z + D / 2);
    this.ghost.root.rotation.y = (rot * Math.PI) / 2;
  }

  setWallPreview(keys: string[], ok: boolean) {
    this.previewSet.reset();
    this.previewSet.mesh.material = ok ? this.ghostMat : this.ghostBad;
    for (const key of keys) {
      const { dir, x, z } = parseWallKey(key);
      const cx = dir === 'h' ? x + 0.5 : x, cz = dir === 'h' ? z : z + 0.5;
      const sx = dir === 'h' ? 1 : 0.16, sz = dir === 'h' ? 0.16 : 1;
      this.previewSet.add(Matrix.Compose(new Vector3(sx, WALL_H, sz), Quaternion.Identity(), new Vector3(cx, WALL_H / 2, cz)), key, null);
    }
    this.previewSet.commit();
  }

  setFloorPreview(rect: { x0: number; z0: number; x1: number; z1: number } | null, ok = true) {
    if (!rect) { this.floorPreview.setEnabled(false); return; }
    const ax = Math.min(rect.x0, rect.x1), bx = Math.max(rect.x0, rect.x1) + 1;
    const az = Math.min(rect.z0, rect.z1), bz = Math.max(rect.z0, rect.z1) + 1;
    this.floorPreview.setEnabled(true);
    this.floorPreview.material = ok ? this.ghostMat : this.ghostBad;
    this.floorPreview.scaling.set(bx - ax, 1, bz - az);
    this.floorPreview.position.set((ax + bx) / 2, 0.04, (az + bz) / 2);
  }
}

function segmentPieces(wall: Wall, low: boolean): Piece[] {
  const h = low ? LOW_H : WALL_H;
  const out: Piece[] = [];
  const side = (s: 0 | 1, x0: number, x1: number, y0: number, y1: number) =>
    out.push({ base: 'paint', side: s, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: s === 0 ? -T / 2 : T / 2, sx: x1 - x0, sy: y1 - y0, sz: T });
  for (const s of [0, 1] as const) {
    if (wall.kind === 'door') {
      side(s, -0.5, -0.4, 0, h);
      side(s, 0.4, 0.5, 0, h);
      if (!low) side(s, -0.4, 0.4, 2.1, h);
    } else if (wall.kind === 'window' && !low) {
      side(s, -0.5, 0.5, 0, 0.9);
      side(s, -0.5, 0.5, 2.0, h);
      side(s, -0.5, -0.36, 0.9, 2.0);
      side(s, 0.36, 0.5, 0.9, 2.0);
    } else {
      side(s, -0.5, 0.5, 0, h);
    }
  }
  if (wall.kind === 'door') {
    out.push({ base: 'cap', cx: -0.45, cy: h + 0.015, cz: 0, sx: 0.1, sy: 0.03, sz: T * 2 });
    out.push({ base: 'cap', cx: 0.45, cy: h + 0.015, cz: 0, sx: 0.1, sy: 0.03, sz: T * 2 });
    if (!low) {
      out.push({ base: 'cap', cx: 0, cy: h + 0.015, cz: 0, sx: 0.8, sy: 0.03, sz: T * 2 });
      out.push({ base: 'frame', cx: 0, cy: 2.08, cz: 0, sx: 0.84, sy: 0.06, sz: T * 2 + 0.04 });
      // Door leaf, swung open.
      const a = -1.35;
      out.push({ base: 'leaf', cx: -0.4 + Math.cos(a) * 0.39, cy: 1.02, cz: -Math.sin(a) * 0.39, sx: 0.78, sy: 2.02, sz: 0.045, rotY: a });
    }
  } else {
    out.push({ base: 'cap', cx: 0, cy: h + 0.015, cz: 0, sx: 1.0, sy: 0.03, sz: T * 2 });
  }
  if (wall.kind === 'window' && !low) {
    out.push({ base: 'glass', cx: 0, cy: 1.45, cz: 0, sx: 0.72, sy: 1.1, sz: 0.02 });
    out.push({ base: 'frame', cx: 0, cy: 0.9, cz: 0, sx: 0.84, sy: 0.05, sz: T * 2 + 0.08 });
    out.push({ base: 'frame', cx: 0, cy: 2.0, cz: 0, sx: 0.84, sy: 0.05, sz: T * 2 + 0.02 });
    out.push({ base: 'frame', cx: 0, cy: 1.45, cz: 0, sx: 0.04, sy: 1.1, sz: 0.05 });
    out.push({ base: 'frame', cx: 0, cy: 1.45, cz: 0, sx: 0.72, sy: 0.035, sz: 0.05 });
  }
  return out;
}
