// Build mode: draw walls and rooms, add doors and windows, lay floors, paint walls.
import { BUILD_PRICES, FLOORS, PAINTS } from '../sim/defs';
import { eraseWalls, paintFloor, paintWall, placeWalls, roomOutlineKeys, setWallKind, wallKeyInLot, wallKeysOnLine } from '../sim/build';
import type { App } from './app';
import { clear, h, money } from './dom';

type Tool = 'wall' | 'room' | 'door' | 'window' | 'floor' | 'paint' | 'erase' | 'erasefloor';

const TOOLS: { id: Tool; icon: string; name: string; hint: string }[] = [
  { id: 'room', icon: '⬜', name: 'Room', hint: 'Drag to draw a whole room.' },
  { id: 'wall', icon: '🧱', name: 'Wall', hint: 'Drag along the grid to draw a wall.' },
  { id: 'door', icon: '🚪', name: 'Door', hint: 'Tap a wall to add a door. Tap a door to turn it back into wall.' },
  { id: 'window', icon: '🪟', name: 'Window', hint: 'Tap a wall to add a window. Windows brighten rooms.' },
  { id: 'floor', icon: '🟫', name: 'Floor', hint: 'Tap or drag over tiles to lay flooring.' },
  { id: 'paint', icon: '🎨', name: 'Paint', hint: 'Tap the side of a wall to paint it.' },
  { id: 'erase', icon: '🧹', name: 'Remove walls', hint: 'Drag along walls to remove them (refunded).' },
  { id: 'erasefloor', icon: '🌱', name: 'Remove floor', hint: 'Drag over tiles to take up flooring.' },
];

export class BuildMode {
  el: HTMLElement;
  private tool: Tool = 'room';
  private floor = 'oak';
  private paint = 'sage';
  private wholeRoom = true;
  private optsEl!: HTMLElement;
  private toolsEl!: HTMLElement;
  private hintEl: HTMLElement;
  private drag: { x0: number; z0: number; x1: number; z1: number } | null = null;

  constructor(private app: App) {
    this.el = h('div', { class: 'passthrough', style: 'position:absolute;inset:0;display:none' });
    this.hintEl = h('div', { class: 'panel hint' });
    this.toolsEl = h('div', { class: 'cats' });
    this.optsEl = h('div');
    this.el.append(this.hintEl, h('div', { class: 'panel sheet' }, this.toolsEl, this.optsEl));
    this.render();
  }

  open() { this.el.style.display = ''; this.render(); }
  close() { this.el.style.display = 'none'; this.clearPreview(); }

  private render() {
    clear(this.toolsEl);
    for (const t of TOOLS) {
      this.toolsEl.append(h('button', { class: `tab ${t.id === this.tool ? 'on' : ''}`, onclick: () => { this.tool = t.id; this.render(); } }, `${t.icon} ${t.name}`));
    }
    const tool = TOOLS.find((t) => t.id === this.tool)!;
    const price = this.tool === 'wall' || this.tool === 'room' ? `${money(BUILD_PRICES.wall)} per wall` : this.tool === 'door' ? money(BUILD_PRICES.door) : this.tool === 'window' ? money(BUILD_PRICES.window) : this.tool === 'floor' ? `${money(BUILD_PRICES.floor)} per tile` : this.tool === 'paint' ? `${money(BUILD_PRICES.paint)} per wall` : 'Refunded';
    this.hintEl.textContent = `${tool.hint} (${price})`;
    clear(this.optsEl);
    if (this.tool === 'floor') {
      this.optsEl.append(h('div', { class: 'swatches' }, ...Object.values(FLOORS).map((f) =>
        h('button', { class: `swatch ${f.id === this.floor ? 'on' : ''}`, title: f.name, 'aria-label': f.name, style: `background:${swatchCss(f.color, f.pattern)}`, onclick: () => { this.floor = f.id; this.render(); } }))));
    } else if (this.tool === 'paint') {
      this.optsEl.append(
        h('div', { class: 'swatches' }, ...Object.values(PAINTS).map((p) =>
          h('button', { class: `swatch ${p.id === this.paint ? 'on' : ''}`, title: p.name, 'aria-label': p.name, style: `background:${swatchCss(p.color, p.pattern)}`, onclick: () => { this.paint = p.id; this.render(); } }))),
        h('label', { class: 'row', style: 'font-weight:700' }, h('input', { type: 'checkbox', checked: this.wholeRoom, onchange: (e: Event) => { this.wholeRoom = (e.target as HTMLInputElement).checked; } }), 'Paint the whole room'),
      );
    } else {
      this.optsEl.append(h('p', { class: 'muted', style: 'margin:4px 2px' }, 'Two fingers to move the camera while building. Sims wait while you build.'));
    }
  }

  private corner(x: number, y: number): { x: number; z: number } | null {
    const g = this.app.world.groundAt(x, y);
    if (!g) return null;
    const lot = this.app.game!.state.lot;
    return { x: Math.max(0, Math.min(lot.width, Math.round(g.x))), z: Math.max(0, Math.min(lot.depth, Math.round(g.z))) };
  }

  private tile(x: number, y: number): { x: number; z: number } | null {
    const g = this.app.world.groundAt(x, y);
    if (!g) return null;
    const lot = this.app.game!.state.lot;
    return { x: Math.max(0, Math.min(lot.width - 1, Math.floor(g.x))), z: Math.max(0, Math.min(lot.depth - 1, Math.floor(g.z))) };
  }

  private keysForDrag(): string[] {
    const d = this.drag!;
    const lot = this.app.game!.state.lot;
    if (this.tool === 'room') return roomOutlineKeys(d.x0, d.z0, d.x1, d.z1).filter((k) => wallKeyInLot(lot, k));
    // Straight line, snapped to the longer axis.
    const horizontal = Math.abs(d.x1 - d.x0) >= Math.abs(d.z1 - d.z0);
    return (horizontal ? wallKeysOnLine(d.x0, d.z0, d.x1, d.z0) : wallKeysOnLine(d.x0, d.z0, d.x0, d.z1)).filter((k) => wallKeyInLot(lot, k));
  }

  private updatePreview() {
    const game = this.app.game!;
    if (!this.drag) { this.clearPreview(); return; }
    if (this.tool === 'floor' || this.tool === 'erasefloor') {
      const d = this.drag;
      const tiles = (Math.abs(d.x1 - d.x0) + 1) * (Math.abs(d.z1 - d.z0) + 1);
      const cost = this.tool === 'floor' ? tiles * BUILD_PRICES.floor : 0;
      this.app.world.lotView.setFloorPreview(d, cost <= game.state.household.funds);
      this.hintEl.textContent = this.tool === 'floor' ? `${tiles} tiles · ${money(cost)}` : `Remove floor from ${tiles} tiles`;
      return;
    }
    const keys = this.keysForDrag();
    if (this.tool === 'erase') {
      const existing = keys.filter((k) => game.state.lot.walls[k]);
      this.app.world.lotView.setWallPreview(existing, false);
      this.hintEl.textContent = `Remove ${existing.length} wall${existing.length === 1 ? '' : 's'}`;
      return;
    }
    const fresh = keys.filter((k) => !game.state.lot.walls[k]);
    const cost = fresh.length * BUILD_PRICES.wall;
    this.app.world.lotView.setWallPreview(keys, cost <= game.state.household.funds);
    this.hintEl.textContent = `${fresh.length} wall${fresh.length === 1 ? '' : 's'} · ${money(cost)}`;
  }

  private clearPreview() {
    this.app.world?.lotView.setWallPreview([], true);
    this.app.world?.lotView.setFloorPreview(null);
  }

  /** Check the cost first (family mode may need a money manager), then build. */
  private paid(quote: { ok: boolean; cost: number; reason?: string }, what: string, run: () => { ok: boolean; reason?: string }) {
    if (!quote.ok) { this.result(quote); return; }
    this.app.spend(quote.cost, what, () => { const r = run(); this.result(r); return r.ok; });
  }

  private result(res: { ok: boolean; reason?: string }) {
    if (!res.ok && res.reason) { this.app.toast(res.reason, '🚫'); this.app.sound('error'); }
    this.render();
  }

  // ---------- Pointer input ----------

  onTap(x: number, y: number) {
    const game = this.app.game!;
    switch (this.tool) {
      case 'door':
      case 'window': {
        const w = this.app.world.pickWall(x, y);
        if (!w) { this.app.toast('Tap on a wall.', '🧱'); return; }
        const cur = game.state.lot.walls[w.key];
        const kind = cur?.kind === this.tool ? 'wall' : this.tool;
        this.paid(setWallKind(game, w.key, kind, true), `a ${this.tool}`, () => setWallKind(game, w.key, kind));
        return;
      }
      case 'paint': {
        const w = this.app.world.pickWall(x, y);
        if (!w) { this.app.toast('Tap on a wall.', '🧱'); return; }
        this.paid(paintWall(game, w.key, w.side, this.paint, this.wholeRoom, true), 'some paint', () => paintWall(game, w.key, w.side, this.paint, this.wholeRoom));
        return;
      }
      case 'floor':
      case 'erasefloor': {
        const t = this.tile(x, y);
        const f = this.tool === 'floor' ? this.floor : null;
        if (t) this.paid(paintFloor(game, t.x, t.z, t.x, t.z, f, true), 'new flooring', () => paintFloor(game, t.x, t.z, t.x, t.z, f));
        return;
      }
    }
  }

  onLongPress() {}

  onDragStart(x: number, y: number): boolean {
    if (this.tool === 'door' || this.tool === 'window' || this.tool === 'paint') return false;
    const p = this.tool === 'floor' || this.tool === 'erasefloor' ? this.tile(x, y) : this.corner(x, y);
    if (!p) return false;
    this.drag = { x0: p.x, z0: p.z, x1: p.x, z1: p.z };
    this.updatePreview();
    return true;
  }

  onDragMove(x: number, y: number) {
    if (!this.drag) return;
    const p = this.tool === 'floor' || this.tool === 'erasefloor' ? this.tile(x, y) : this.corner(x, y);
    if (!p) return;
    this.drag.x1 = p.x;
    this.drag.z1 = p.z;
    this.updatePreview();
  }

  onDragEnd(_x: number, _y: number, cancelled: boolean) {
    const d = this.drag;
    this.drag = null;
    this.clearPreview();
    if (!d || cancelled) { this.render(); return; }
    const game = this.app.game!;
    if (this.tool === 'floor' || this.tool === 'erasefloor') {
      const f = this.tool === 'floor' ? this.floor : null;
      this.paid(paintFloor(game, d.x0, d.z0, d.x1, d.z1, f, true), 'new flooring', () => paintFloor(game, d.x0, d.z0, d.x1, d.z1, f));
      return;
    }
    this.drag = d;
    const keys = this.keysForDrag();
    this.drag = null;
    if (this.tool === 'erase') { this.result(eraseWalls(game, keys)); return; }
    this.paid(placeWalls(game, keys, true), 'new walls', () => placeWalls(game, keys));
  }
}

function swatchCss(color: string, pattern?: string): string {
  switch (pattern) {
    case 'check': return `repeating-conic-gradient(${color} 0 25%, #ece8df 0 50%) 50% / 20px 20px`;
    case 'stripes': return `repeating-linear-gradient(90deg, ${color} 0 6px, #e8b9c1 6px 12px)`;
    case 'bricks': return `repeating-linear-gradient(0deg, ${color} 0 7px, #d9cfc2 7px 9px)`;
    case 'planks': return `repeating-linear-gradient(0deg, ${color} 0 11px, rgba(0,0,0,0.25) 11px 12px)`;
    case 'tiles': return `repeating-linear-gradient(0deg, ${color} 0 16px, rgba(0,0,0,0.2) 16px 17px), ${color}`;
    case 'panels': return `linear-gradient(${color}, ${color})`;
    default: return color;
  }
}
