// A small separate scene for create-a-Sim, rendered by the same engine.
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Appearance, AnimId } from '../sim/types';
import { SimAvatar } from './simAvatar';

export class CasView {
  readonly scene: Scene;
  private camera: ArcRotateCamera;
  private avatar: SimAvatar | null = null;
  private time = 0;
  private spin = 0;
  anim: AnimId = 'idle';
  private dragging = false;
  private lastX = 0;

  constructor(engine: Engine, canvas: HTMLCanvasElement) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.98, 0.9, 0.86, 1);
    this.camera = new ArcRotateCamera('casCam', -Math.PI / 2, 1.35, 3.4, new Vector3(0, 1.0, 0), this.scene);
    this.camera.fov = 0.7;
    this.camera.inputs.clear();
    const hemi = new HemisphericLight('h', new Vector3(0.3, 1, -0.6), this.scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.6, 0.5, 0.5);
    const key = new DirectionalLight('k', new Vector3(-0.4, -0.6, 1), this.scene);
    key.intensity = 0.7;
    const podium = MeshBuilder.CreateCylinder('podium', { diameter: 1.6, height: 0.12, tessellation: 40 }, this.scene);
    podium.position.y = -0.06;
    const pm = new StandardMaterial('pm', this.scene);
    pm.diffuseColor = Color3.FromHexString('#f4c7b8');
    pm.specularColor = new Color3(0.05, 0.05, 0.05);
    podium.material = pm;
    const back = MeshBuilder.CreateDisc('back', { radius: 6, tessellation: 48 }, this.scene);
    back.position.set(0, 1.5, 3);
    const bm = new StandardMaterial('bm', this.scene);
    bm.diffuseColor = Color3.FromHexString('#fbe3d6');
    bm.emissiveColor = Color3.FromHexString('#7a5a50');
    bm.specularColor = new Color3(0, 0, 0);
    back.material = bm;
    canvas.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
  }

  private active = false;
  setActive(on: boolean) { this.active = on; }

  private down = (e: PointerEvent) => { if (!this.active) return; this.dragging = true; this.lastX = e.clientX; };
  private move = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.spin += (e.clientX - this.lastX) * 0.012;
    this.lastX = e.clientX;
  };
  private up = () => { this.dragging = false; };

  /** Where the Sim stands on screen: 'right' (title), 'left' (wide create-a-Sim) or 'top' (narrow create-a-Sim). */
  layout(where: 'left' | 'right' | 'top') {
    this.where = where;
    this.camera.targetScreenOffset.x = where === 'right' ? 0.6 : where === 'left' ? -0.6 : 0;
    this.camera.targetScreenOffset.y = where === 'top' ? 1.9 : 0;
    this.camera.radius = where === 'top' ? 9 : 3.4;
  }

  show(a: Appearance) {
    if (!this.avatar) this.avatar = new SimAvatar(this.scene, -1, a);
    else this.avatar.setAppearance(a);
  }

  private where: 'left' | 'right' | 'top' = 'left';

  zoomFace(on: boolean) {
    this.camera.target = new Vector3(0, on ? 1.55 : 1.0, 0);
    const far = this.where === 'top' ? 9 : 3.4;
    this.camera.radius = on ? far * 0.45 : far;
    this.camera.targetScreenOffset.y = this.where === 'top' ? (on ? 0.85 : 1.9) : 0;
  }

  frame(dt: number) {
    this.time += dt;
    if (this.avatar) {
      this.avatar.root.rotation.y = Math.PI + this.spin + Math.sin(this.time * 0.4) * 0.15;
      this.avatar.pose({ anim: this.anim, seated: false, seatHeight: 0, time: this.time, speed: 1, blinkSeed: 0.3 }, dt);
    }
    this.scene.render();
  }
}
