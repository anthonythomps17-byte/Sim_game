// Walk mode: steer the selected Sim with an on-screen joystick (or WASD / arrow keys) while
// the camera follows them. Taps still work for using things and talking to people.
import type { App } from './app';
import { canControl } from '../sim/family';
import { h } from './dom';

export class WalkMode {
  on = false;
  readonly el: HTMLElement;
  private knob: HTMLElement;
  private stick: [number, number] = [0, 0];
  private pointer: number | null = null;
  private lastSent = '';
  private sentAt = 0;

  constructor(private app: App) {
    this.knob = h('div', { class: 'joy-knob' });
    this.el = h('div', { class: 'joystick', style: 'display:none', 'aria-label': 'Joystick: drag to walk' }, this.knob);
    this.el.addEventListener('pointerdown', (e) => { this.pointer = e.pointerId; this.el.setPointerCapture(e.pointerId); this.track(e); e.preventDefault(); });
    this.el.addEventListener('pointermove', (e) => { if (e.pointerId === this.pointer) this.track(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== this.pointer) return; this.pointer = null; this.stick = [0, 0]; this.knob.style.transform = ''; };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  private track(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.stick = [dx, -dy];
    this.knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
  }

  toggle(force?: boolean) {
    this.on = force ?? !this.on;
    this.el.style.display = this.on ? '' : 'none';
    this.app.world.cam.walkKeys = this.on;
    this.app.hud.setWalk(this.on);
    if (this.on) {
      const sim = this.app.selectedSim();
      if (sim) this.app.selectSim(sim.id, true);
      this.app.toast('Walk mode: drag the joystick (or use WASD) to walk. Tap things to use them.', '🕹️');
    } else this.send(0, 0, true);
  }

  /** Every frame. */
  frame(dt: number) {
    if (!this.on || this.app.mode !== 'live') return;
    const game = this.app.game;
    const sim = this.app.selectedSim();
    if (!game || !sim || !game.present(sim) || !canControl(game.state, sim)) return;
    const [kx, ky] = this.app.world.cam.walkInput();
    let [x, y] = this.stick;
    if (kx || ky) { x = kx; y = ky; }
    const dir = Math.hypot(x, y) > 0.2 ? this.app.world.cam.groundDir(x, y) : { x: 0, z: 0 };
    this.send(dir.x, dir.z);
    // The camera follows.
    const w = this.app.world.worldPos(sim);
    const cam = this.app.world.cam;
    const f = Math.min(1, dt * 4);
    cam.focus(cam.target.x + (w.x - cam.target.x) * f, cam.target.z + (w.z - cam.target.z) * f);
  }

  private send(dx: number, dz: number, force = false) {
    const game = this.app.game;
    const sim = this.app.selectedSim();
    if (!game || !sim) return;
    const key = `${sim.id}:${dx.toFixed(1)}:${dz.toFixed(1)}`;
    const now = performance.now();
    const moving = dx !== 0 || dz !== 0;
    if (!force && key === this.lastSent && (!moving || now - this.sentAt < 400)) return;
    if (!force && now - this.sentAt < 90 && moving) return;
    this.lastSent = key;
    this.sentAt = now;
    void this.app.act({ t: 'steer', simId: sim.id, dx, dz }, undefined, true);
  }
}
