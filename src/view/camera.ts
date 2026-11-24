// Touch-first orbit camera: drag to pan, pinch to zoom, two-finger twist to rotate.
// Mouse: left-drag pan, right-drag rotate/tilt, wheel zoom. Keys: WASD/arrows, Q/E, +/-.
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Culling/ray';

export interface PointerHandlers {
  onTap(x: number, y: number): void;
  onLongPress(x: number, y: number): void;
  /** Return true to use this drag for a tool instead of panning. */
  onDragStart(x: number, y: number): boolean;
  onDragMove(x: number, y: number): void;
  onDragEnd(x: number, y: number, cancelled: boolean): void;
  onHover(x: number, y: number): void;
}

interface Ptr { x: number; y: number; sx: number; sy: number; t: number; button: number; type: string }

export class CameraController {
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3;
  minRadius = 5;
  maxRadius = 48;
  minBeta = 0.22;
  maxBeta = 1.32;
  bounds = { minX: -8, maxX: 30, minZ: -8, maxZ: 26 };
  enabled = true;
  /** Walk mode: the movement keys walk the Sim instead of moving the camera. */
  walkKeys = false;

  private pointers = new Map<number, Ptr>();
  private mode: 'none' | 'pending' | 'pan' | 'tool' | 'orbit' | 'gesture' = 'none';
  private longTimer: number | null = null;
  private longFired = false;
  private gesture = { dist: 0, angle: 0, mx: 0, my: 0 };
  private keys = new Set<string>();

  constructor(private camera: ArcRotateCamera, private scene: Scene, private canvas: HTMLCanvasElement, private handlers: PointerHandlers) {
    this.alpha = camera.alpha;
    this.beta = camera.beta;
    this.radius = camera.radius;
    this.target = camera.target.clone();
    camera.inputs.clear();
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Point on the ground plane (y = 0) under a screen position. */
  groundAt(x: number, y: number): Vector3 | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.y) < 1e-5) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    return ray.origin.add(ray.direction.scale(t));
  }

  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private clearLong() {
    if (this.longTimer !== null) { clearTimeout(this.longTimer); this.longTimer = null; }
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now(), button: e.button, type: e.pointerType });
    if (this.pointers.size === 1) {
      this.longFired = false;
      if (e.button === 2 || e.button === 1) { this.mode = 'orbit'; return; }
      this.mode = 'pending';
      this.clearLong();
      // Two hops so queued pointer moves on a busy device get handled before deciding it was a hold.
      this.longTimer = window.setTimeout(() => {
        this.longTimer = window.setTimeout(() => {
          if (this.mode === 'pending') {
            this.longFired = true;
            this.handlers.onLongPress(p.x, p.y);
          }
        }, 40);
      }, 520);
    } else if (this.pointers.size === 2) {
      this.clearLong();
      if (this.mode === 'tool') this.handlers.onDragEnd(p.x, p.y, true);
      this.mode = 'gesture';
      this.startGesture();
    }
  };

  private startGesture() {
    const [a, b] = [...this.pointers.values()];
    this.gesture.dist = Math.hypot(a.x - b.x, a.y - b.y);
    this.gesture.angle = Math.atan2(b.y - a.y, b.x - a.x);
    this.gesture.mx = (a.x + b.x) / 2;
    this.gesture.my = (a.y + b.y) / 2;
  }

  private move = (e: PointerEvent) => {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === 'mouse') this.handlers.onHover(p.x, p.y);
      return;
    }
    const px = ptr.x, py = ptr.y;
    ptr.x = p.x; ptr.y = p.y;
    switch (this.mode) {
      case 'pending': {
        if (Math.hypot(p.x - ptr.sx, p.y - ptr.sy) < 9) return;
        this.clearLong();
        if (this.longFired) { this.mode = 'none'; return; }
        this.mode = this.handlers.onDragStart(ptr.sx, ptr.sy) ? 'tool' : 'pan';
        if (this.mode === 'tool') this.handlers.onDragMove(p.x, p.y);
        else this.pan(px, py, p.x, p.y);
        return;
      }
      case 'pan': this.pan(px, py, p.x, p.y); return;
      case 'tool': this.handlers.onDragMove(p.x, p.y); return;
      case 'orbit':
        this.alpha -= (p.x - px) * 0.008;
        this.beta -= (p.y - py) * 0.006;
        this.clamp();
        return;
      case 'gesture': {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.gesture.dist > 10 && dist > 10) this.radius *= this.gesture.dist / dist;
        let da = angle - this.gesture.angle;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.alpha -= da;
        this.pan(this.gesture.mx, this.gesture.my, mx, my);
        this.gesture = { dist, angle, mx, my };
        this.clamp();
        return;
      }
    }
  };

  private up = (e: PointerEvent) => {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    this.clearLong();
    if (this.mode === 'pending' && !this.longFired && performance.now() - ptr.t < 800) this.handlers.onTap(p.x, p.y);
    if (this.mode === 'tool') this.handlers.onDragEnd(p.x, p.y, false);
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.mode === 'gesture') this.mode = 'pan';
  };

  private cancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.clearLong();
    if (this.mode === 'tool') this.handlers.onDragEnd(0, 0, true);
    if (this.pointers.size === 0) this.mode = 'none';
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.radius *= 1 + Math.sign(e.deltaY) * Math.min(0.25, Math.abs(e.deltaY) * 0.0015);
    this.clamp();
  };

  private pan(x0: number, y0: number, x1: number, y1: number) {
    const a = this.groundAt(x0, y0);
    const b = this.groundAt(x1, y1);
    if (!a || !b) return;
    this.target.x -= b.x - a.x;
    this.target.z -= b.z - a.z;
    this.clamp();
    // Apply immediately so the ground stays under the finger.
    this.camera.target.x = this.target.x;
    this.camera.target.z = this.target.z;
  }

  rotateBy(da: number) { this.alpha += da; }
  tiltBy(db: number) { this.beta += db; this.clamp(); }
  zoomBy(f: number) { this.radius *= f; this.clamp(); }

  /** Movement keys held right now: [right, forward] each -1..1. */
  walkInput(): [number, number] {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('w') || k.has('arrowup')) y += 1;
    if (k.has('s') || k.has('arrowdown')) y -= 1;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    return [x, y];
  }

  /** Ground direction for screen input (right, forward), relative to where the camera looks. */
  groundDir(right: number, forward: number): { x: number; z: number } {
    const fx = -Math.cos(this.alpha), fz = -Math.sin(this.alpha);
    return { x: fx * forward + fz * right, z: fz * forward - fx * right };
  }

  focus(x: number, z: number) {
    this.target.x = x;
    this.target.z = z;
    this.clamp();
  }

  clamp() {
    this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius));
    this.beta = Math.max(this.minBeta, Math.min(this.maxBeta, this.beta));
    this.target.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.target.x));
    this.target.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.target.z));
  }

  update(dt: number) {
    // Keyboard.
    const k = this.keys;
    if (k.size) {
      const walk = this.walkKeys;
      const speed = this.radius * 0.9 * dt;
      const fx = -Math.cos(this.alpha), fz = -Math.sin(this.alpha);
      const rx = -fz, rz = fx;
      let mx = 0, mz = 0;
      if (!walk) {
        if (k.has('w') || k.has('arrowup')) { mx += fx; mz += fz; }
        if (k.has('s') || k.has('arrowdown')) { mx -= fx; mz -= fz; }
        if (k.has('a') || k.has('arrowleft')) { mx += rx; mz += rz; }
        if (k.has('d') || k.has('arrowright')) { mx -= rx; mz -= rz; }
      }
      this.target.x += mx * speed;
      this.target.z += mz * speed;
      if (k.has('q')) this.alpha += dt * 1.5;
      if (k.has('e')) this.alpha -= dt * 1.5;
      if (k.has('+') || k.has('=')) this.radius *= 1 - dt;
      if (k.has('-')) this.radius *= 1 + dt;
      this.clamp();
    }
    const f = Math.min(1, dt * 10);
    const c = this.camera;
    c.alpha += (this.alpha - c.alpha) * f;
    c.beta += (this.beta - c.beta) * f;
    c.radius += (this.radius - c.radius) * f;
    c.target.x += (this.target.x - c.target.x) * f;
    c.target.y += (this.target.y - c.target.y) * f;
    c.target.z += (this.target.z - c.target.z) * f;
  }
}
