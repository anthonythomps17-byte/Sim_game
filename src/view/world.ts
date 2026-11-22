// The 3D view. It only reads the game state; taps become commands handled by the UI layer.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import type { Light } from '@babylonjs/core/Lights/light';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent';
import '@babylonjs/core/Lights/Clustered';
import '@babylonjs/core/Rendering/outlineRenderer';
import '@babylonjs/core/Culling/ray';
import type { Game } from '../sim/game';
import { OBJECTS } from '../sim/defs';
import { moodLabel, moodScore } from '../sim/mood';
import type { Sim } from '../sim/types';
import { Materials } from './materials';
import { CameraController, type PointerHandlers } from './camera';
import { buildScenery } from './scenery';
import { LotView, type WallMode } from './lotView';
import { SimAvatar } from './simAvatar';
import { SkyEffects } from './effects';
import { calendarOf, fireworksActive, isEventToday } from '../sim/life';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

export type Quality = 'low' | 'medium' | 'high';
export type PickResult =
  | { kind: 'sim'; id: number }
  | { kind: 'object'; id: number }
  | { kind: 'wall'; key: string; side: 0 | 1 }
  | { kind: 'ground'; x: number; z: number };

const SKY = {
  night: new Color3(0.06, 0.09, 0.2),
  dawn: new Color3(0.98, 0.72, 0.52),
  day: new Color3(0.62, 0.82, 0.95),
  dusk: new Color3(0.95, 0.56, 0.42),
};

export class WorldView {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly cam: CameraController;
  readonly mats: Materials;
  readonly lotView: LotView;
  private sun: DirectionalLight;
  private hemi: HemisphericLight;
  private shadows: ShadowGenerator | null = null;
  private clustered: ClusteredLightContainer | null = null;
  private streetLights: PointLight[] = [];
  private streetGlow: Mesh | null = null;
  private avatars = new Map<number, SimAvatar>();
  private game: Game | null = null;
  private time = 0;
  quality: Quality = 'medium';
  private lastNight: boolean | null = null;
  private dynTimer = 0;
  private selectedSim = -1;
  private fps = 60;
  readonly sky: SkyEffects;
  private seasonMats: { trees: StandardMaterial; ground: StandardMaterial; lot: StandardMaterial } | null = null;
  private season = '';

  constructor(readonly canvas: HTMLCanvasElement, handlers: PointerHandlers) {
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance', antialias: true }, false);
    this.scene = new Scene(this.engine);
    this.scene.skipPointerMovePicking = true;
    this.scene.clearColor = new Color4(0.62, 0.82, 0.95, 1);
    this.scene.ambientColor = new Color3(0.25, 0.25, 0.25);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.006;
    this.scene.fogColor = SKY.day;
    this.mats = new Materials(this.scene);

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2 - 0.5, 0.95, 26, new Vector3(11, 0, 8), this.scene);
    this.camera.minZ = 0.3;
    this.camera.maxZ = 400;
    this.camera.fov = 0.75;
    this.cam = new CameraController(this.camera, this.scene, canvas, handlers);
    this.cam.alpha = this.camera.alpha;

    this.hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.3), this.scene);
    this.hemi.intensity = 0.6;
    this.hemi.groundColor = new Color3(0.35, 0.33, 0.3);
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), this.scene);
    this.sun.position = new Vector3(30, 40, -20);
    this.sun.intensity = 1.2;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 120;

    try {
      this.clustered = new ClusteredLightContainer('lamps', [], this.scene);
      if (!this.clustered.isSupported) { this.clustered.dispose(); this.clustered = null; }
    } catch {
      this.clustered = null;
    }

    this.lotView = new LotView(this.scene, this.mats, () => this.shadows, (l) => this.addLamp(l), (l) => this.removeLamp(l));
    const scenery = buildScenery(this.scene, this.mats, 22, 18);
    this.sky = new SkyEffects(this.scene);
    this.seasonMats = { trees: scenery.trees.material as StandardMaterial, ground: scenery.ground.material as StandardMaterial, lot: scenery.lotGround.material as StandardMaterial };
    this.streetGlow = scenery.meshes.find((m) => m.metadata?.glowKind === 'street') ?? null;
    for (const p of scenery.lampPositions) {
      const l = new PointLight('street', p, this.scene);
      l.diffuse = new Color3(1, 0.85, 0.6);
      l.range = 10;
      l.intensity = 0;
      this.addLamp(l);
      this.streetLights.push(l);
    }
    this.setQuality('medium');

    window.addEventListener('resize', () => this.engine.resize());
  }

  private addLamp(l: Light) {
    if (this.clustered) this.clustered.addLight(l);
  }

  private removeLamp(l: Light) {
    if (this.clustered) this.clustered.removeLight(l);
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    this.engine.setHardwareScalingLevel(1 / Math.min(dpr, cap));
    if (this.shadows) { this.shadows.dispose(); this.shadows = null; }
    if (q !== 'low') {
      this.shadows = new ShadowGenerator(q === 'high' ? 2048 : 1024, this.sun);
      this.shadows.usePercentageCloserFiltering = true;
      this.shadows.filteringQuality = q === 'high' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
      this.shadows.bias = 0.0015;
      this.shadows.normalBias = 0.015;
      this.shadows.darkness = 0.35;
      for (const m of this.scene.meshes) {
        const k = m.metadata?.kind;
        if ((k === 'object' && !m.parent) || k === 'sim' || k === 'wall') this.shadows.addShadowCaster(m);
      }
    }
    this.engine.resize();
  }

  setGame(game: Game) {
    this.game = game;
    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();
    this.lotView.init(game.state.lot);
    const lot = game.state.lot;
    this.cam.bounds = { minX: -6, maxX: lot.width + 6, minZ: -6, maxZ: lot.depth + 4 };
    this.cam.focus(lot.width / 2, lot.depth / 2 - 1);
  }

  setWallMode(m: WallMode) { this.lotView.wallMode = m; }

  setBuildCamera(on: boolean) {
    if (on) { this.cam.beta = 0.45; this.cam.radius = Math.max(this.cam.radius, 22); }
    else this.cam.beta = 0.95;
    this.cam.clamp();
  }

  setSelected(id: number) { this.selectedSim = id; }

  // ---------- Per-frame ----------

  frame(dt: number, speed: number) {
    const game = this.game;
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    this.cam.update(dt);
    if (!game) { this.scene.render(); return; }
    const st = game.state;
    const night = game.isNight();
    const c = this.camera.position;
    this.lotView.sync(st.lot, { x: c.x, z: c.z, tx: this.camera.target.x, tz: this.camera.target.z }, night, (x, z) => game.roomOf({ x, z }));
    this.dynTimer -= dt;
    if (this.dynTimer <= 0 || night !== this.lastNight) {
      this.dynTimer = 0.5;
      this.lotView.refreshDynamic(st.lot, night);
    }
    this.updateSky(game.minuteOfDay, night);
    this.updateSeason(game.day);
    const cal = calendarOf(game.day);
    const snowing = cal.season.id === 'winter' && (cal.dayOfSeason % 2 === 1 || isEventToday(game, 'christmas'));
    this.sky.update(dt, fireworksActive(game), snowing, this.camera.target);
    this.syncSims(game, dt, speed);
    this.scene.render();
  }

  get averageFps() { return this.fps; }

  /** Tint trees and grass for the season: blossom, summer green, autumn gold, winter snow. */
  private updateSeason(day: number) {
    const id = calendarOf(day).season.id;
    if (id === this.season || !this.seasonMats) return;
    this.season = id;
    const tints: Record<string, { trees: string; grass: string }> = {
      spring: { trees: '#ffd0e4', grass: '#f2ffe6' },
      summer: { trees: '#ffffff', grass: '#ffffff' },
      autumn: { trees: '#ff9a3c', grass: '#e6d9a8' },
      winter: { trees: '#e9f0ff', grass: '#ffffff' },
    };
    const t = tints[id];
    const tree = Color3.FromHexString(t.trees);
    // Vertex colours are multiplied by this, so values above 1 brighten towards white.
    this.seasonMats.trees.diffuseColor = id === 'winter' ? new Color3(2.2, 1.6, 2.6) : id === 'spring' ? new Color3(1.9, 1.15, 1.6) : id === 'autumn' ? new Color3(2.4, 1.05, 0.35) : tree;
    const grass = id === 'winter' ? new Color3(2.1, 1.75, 2.4) : Color3.FromHexString(t.grass);
    this.seasonMats.ground.diffuseColor = grass;
    this.seasonMats.lot.diffuseColor = grass;
  }

  private updateSky(minute: number, night: boolean) {
    const h = minute / 60;
    const dayT = (h - 6) / 14; // 06:00 → 0, 20:00 → 1
    const el = Math.sin(Math.max(0, Math.min(1, dayT)) * Math.PI);
    const az = Math.PI * (0.15 + Math.max(0, Math.min(1, dayT)) * 0.7);
    if (dayT > 0 && dayT < 1) {
      this.sun.direction = new Vector3(-Math.cos(az) * Math.cos(el * 1.1), -Math.max(0.25, el), Math.sin(az) * 0.6).normalize();
      this.sun.intensity = 0.35 + el * 0.95;
      this.sun.diffuse = Color3.Lerp(new Color3(1, 0.7, 0.45), new Color3(1, 0.97, 0.9), Math.min(1, el * 1.6));
    } else {
      this.sun.direction = new Vector3(0.3, -1, 0.5).normalize();
      this.sun.intensity = 0.22;
      this.sun.diffuse = new Color3(0.55, 0.65, 1);
    }
    this.sun.position = this.camera.target.subtract(this.sun.direction.scale(50));
    let sky: Color3;
    if (h < 5 || h >= 21.5) sky = SKY.night;
    else if (h < 7) sky = Color3.Lerp(SKY.night, SKY.dawn, Math.min(1, (h - 5) / 1.2)).scale(1).add(Color3.Lerp(Color3.Black(), SKY.day, Math.max(0, (h - 6.2) / 0.8)).scale(0.5));
    else if (h < 18.5) sky = SKY.day;
    else if (h < 20.2) sky = Color3.Lerp(SKY.day, SKY.dusk, (h - 18.5) / 1.7);
    else sky = Color3.Lerp(SKY.dusk, SKY.night, Math.min(1, (h - 20.2) / 1.3));
    sky = new Color3(Math.min(1, sky.r), Math.min(1, sky.g), Math.min(1, sky.b));
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = sky;
    const dayAmt = Math.max(0, Math.min(1, el * 1.5));
    this.hemi.intensity = 0.22 + dayAmt * 0.45;
    this.hemi.diffuse = Color3.Lerp(new Color3(0.45, 0.5, 0.8), new Color3(1, 0.98, 0.92), dayAmt);
    if (night !== this.lastNight) {
      this.lastNight = night;
      for (const l of this.streetLights) l.intensity = night ? 1.3 : 0;
      if (this.streetGlow) this.streetGlow.material = this.mats.color('#ffe2b0', { emissive: night ? 0.95 : 0.05 });
    }
  }

  private syncSims(game: Game, dt: number, speed: number) {
    const seen = new Set<number>();
    for (const sim of game.state.sims) {
      let av = this.avatars.get(sim.id);
      if (sim.location !== 'lot') { av?.setVisible(false); continue; }
      seen.add(sim.id);
      if (!av) {
        av = new SimAvatar(this.scene, sim.id, sim.appearance, (m) => this.shadows?.addShadowCaster(m));
        this.avatars.set(sim.id, av);
      }
      av.setAppearance(sim.appearance);
      av.setVisible(true);
      this.poseSim(av, sim, game, dt, speed);
    }
    for (const [id, av] of this.avatars) if (!seen.has(id)) av.setVisible(false);
  }

  private poseSim(av: SimAvatar, sim: Sim, game: Game, dt: number, speed: number) {
    const target = new Vector3(sim.pos.x, 0, sim.pos.z);
    const r = av.root;
    // Smooth movement between simulation steps.
    const d = Vector3.Distance(r.position, target);
    if (d > 2) r.position.copyFrom(target);
    else Vector3.LerpToRef(r.position, target, Math.min(1, dt * 14), r.position);
    let diff = sim.facing - r.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    r.rotation.y += diff * Math.min(1, dt * 12);
    const posed = sim.poseObjectId !== null ? game.object(sim.poseObjectId) : undefined;
    const seatHeight = posed ? OBJECTS[posed.defId].seatHeight ?? 0.45 : 0;
    const anim = sim.current?.phase === 'perform' ? sim.current.anim : sim.anim;
    av.pose({ anim, seated: !!posed && anim !== 'sleep', seatHeight, time: this.time * Math.max(1, speed * 0.7), speed: Math.max(1, speed), blinkSeed: sim.id * 1.7 }, dt * Math.max(1, speed));
    const sel = sim.id === this.selectedSim;
    av.setSelected(sel, moodLabel(moodScore(sim)).color);
  }

  // ---------- Picking & projection ----------

  /** Sims are thin, so a tap near one counts: distance from the tap to the line from feet to head. */
  private simNear(x: number, y: number): { id: number; d: number } | null {
    let best: { id: number; d: number } | null = null;
    for (const [id, av] of this.avatars) {
      if (!av.root.isEnabled()) continue;
      const p = av.root.position;
      const feet = this.project(p.x, p.y, p.z);
      const head = this.project(p.x, p.y + 1.8 * av.root.scaling.y, p.z);
      if (!feet.visible) continue;
      const vx = head.x - feet.x, vy = head.y - feet.y;
      const len2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - feet.x) * vx + (y - feet.y) * vy) / len2));
      const d = Math.hypot(x - (feet.x + vx * t), y - (feet.y + vy * t));
      const reach = Math.max(18, Math.sqrt(len2) * 0.28);
      if (d < reach && (!best || d < best.d)) best = { id, d };
    }
    return best;
  }

  pick(x: number, y: number): PickResult | null {
    const near = this.simNear(x, y);
    if (near) return { kind: 'sim', id: near.id };
    const hit = this.scene.pick(x, y, (m) => m.isPickable && m.isEnabled() && !!m.metadata && m.metadata.kind !== 'ground');
    if (hit?.hit && hit.pickedMesh) {
      const meta = hit.pickedMesh.metadata;
      if (meta.kind === 'sim') return { kind: 'sim', id: meta.id };
      if (meta.kind === 'object') return { kind: 'object', id: meta.id };
      if (meta.kind === 'wall' && hit.thinInstanceIndex !== undefined && hit.thinInstanceIndex >= 0 && hit.pickedPoint) {
        const w = this.lotView.wallFromPick(hit.pickedMesh.name, hit.thinInstanceIndex, hit.pickedPoint);
        if (w) return { kind: 'wall', ...w };
      }
    }
    const g = this.cam.groundAt(x, y);
    if (g) return { kind: 'ground', x: g.x, z: g.z };
    return null;
  }

  /** Pick only walls (for doors, windows and paint). */
  pickWall(x: number, y: number): { key: string; side: 0 | 1 } | null {
    const hit = this.scene.pick(x, y, (m) => m.isEnabled() && m.metadata?.kind === 'wall');
    if (hit?.hit && hit.pickedMesh && hit.pickedPoint && hit.thinInstanceIndex !== undefined && hit.thinInstanceIndex >= 0) {
      return this.lotView.wallFromPick(hit.pickedMesh.name, hit.thinInstanceIndex, hit.pickedPoint);
    }
    return null;
  }

  groundAt(x: number, y: number): { x: number; z: number } | null {
    const g = this.cam.groundAt(x, y);
    return g ? { x: g.x, z: g.z } : null;
  }

  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const p = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    const scale = this.canvas.clientWidth / w;
    return { x: p.x * scale, y: p.y * scale, visible: p.z > 0 && p.z < 1 };
  }

  simScreenPos(simId: number): { x: number; y: number; visible: boolean } | null {
    const av = this.avatars.get(simId);
    if (!av || !av.root.isEnabled()) return null;
    const p = av.root.position;
    return this.project(p.x, p.y + 2.15 * av.root.scaling.y, p.z);
  }

  render() { this.scene.render(); }
}
