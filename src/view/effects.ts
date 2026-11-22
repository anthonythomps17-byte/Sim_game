// Sky effects: fireworks for Bonfire Night and New Year, snow in winter.
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';

interface Spark { p: Vector3; v: Vector3; life: number; max: number }

const FIREWORK_COLOURS = ['#ff4d6d', '#ffd23c', '#4dc3ff', '#7dff9a', '#d98cff', '#ffffff'];

export class SkyEffects {
  private sparkMeshes: Mesh[] = [];
  private sparks: Spark[][] = [];
  private spawnTimer = 0;
  private snow: Mesh;
  private flakes: Vector3[] = [];
  onBurst: () => void = () => {};

  constructor(scene: Scene) {
    for (const c of FIREWORK_COLOURS) {
      const m = MeshBuilder.CreateSphere('spark', { diameter: 0.35, segments: 3 }, scene);
      const mat = new StandardMaterial('sparkm', scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString(c);
      m.material = mat;
      m.isPickable = false;
      m.thinInstanceEnablePicking = false;
      m.setEnabled(false);
      this.sparkMeshes.push(m);
      this.sparks.push([]);
    }
    this.snow = MeshBuilder.CreateBox('snow', { size: 0.07 }, scene);
    const sm = new StandardMaterial('snowm', scene);
    sm.disableLighting = true;
    sm.emissiveColor = new Color3(0.95, 0.97, 1);
    this.snow.material = sm;
    this.snow.isPickable = false;
    this.snow.setEnabled(false);
    for (let i = 0; i < 700; i++) this.flakes.push(new Vector3(Math.random() * 50 - 14, Math.random() * 14, Math.random() * 40 - 12));
  }

  private burst() {
    const centre = new Vector3(-10 + Math.random() * 42, 16 + Math.random() * 10, -24 + Math.random() * 12);
    const ci = Math.floor(Math.random() * this.sparkMeshes.length);
    const n = 40;
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const speed = 6 + Math.random() * 2;
      this.sparks[ci].push({ p: centre.clone(), v: new Vector3(s * Math.cos(a) * speed, u * speed, s * Math.sin(a) * speed), life: 0, max: 1.4 + Math.random() * 0.6 });
    }
    this.onBurst();
  }

  update(dt: number, fireworks: boolean, snowing: boolean, centre: Vector3) {
    if (fireworks) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnTimer = 0.35 + Math.random() * 0.8; this.burst(); }
    }
    this.sparkMeshes.forEach((mesh, ci) => {
      const list = this.sparks[ci];
      for (const s of list) {
        s.life += dt;
        s.v.y -= 4.5 * dt;
        s.v.scaleInPlace(1 - dt * 0.9);
        s.p.addInPlace(s.v.scale(dt));
      }
      this.sparks[ci] = list.filter((s) => s.life < s.max);
      const live = this.sparks[ci];
      if (!live.length) { mesh.setEnabled(false); return; }
      const buf = new Float32Array(live.length * 16);
      live.forEach((s, i) => {
        const k = Math.max(0.05, 1 - s.life / s.max);
        Matrix.ScalingToRef(k, k, k, tmp);
        tmp.setTranslation(s.p);
        tmp.copyToArray(buf, i * 16);
      });
      mesh.setEnabled(true);
      mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
    });
    if (snowing) {
      const buf = new Float32Array(this.flakes.length * 16);
      this.flakes.forEach((f, i) => {
        f.y -= dt * 1.4;
        f.x += Math.sin(f.y * 0.8 + i) * dt * 0.3;
        if (f.y < 0) { f.y = 14; f.x = centre.x - 25 + Math.random() * 50; f.z = centre.z - 20 + Math.random() * 40; }
        Matrix.TranslationToRef(f.x, f.y, f.z, tmp);
        tmp.copyToArray(buf, i * 16);
      });
      this.snow.setEnabled(true);
      this.snow.thinInstanceSetBuffer('matrix', buf, 16, false);
    } else this.snow.setEnabled(false);
  }
}

const tmp = new Matrix();
