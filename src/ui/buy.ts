// Buy mode: catalogue grouped by room; place, move, rotate and sell furniture.
import { NEEDS, OBJECTS, OBJECT_CATEGORIES, type ObjectDef } from '../sim/defs';
import { buyObject, moveObject, objectPrice, sellObject } from '../sim/build';
import { canPlaceObject, footprintSize } from '../sim/lot';
import { SKILL_NAMES } from '../sim/skills';
import type { NeedId } from '../sim/types';
import type { App } from './app';
import { clear, h, money } from './dom';

export const OBJECT_ICONS: Record<string, string> = {
  fridge: '🧊', stove: '🍳', range: '🔥', counter: '🔪', kitchen_sink: '🚰', coffee: '☕', dining_table: '🍽️', dining_chair: '🪑',
  toilet: '🚽', shower: '🚿', bath: '🛁', bathroom_sink: '🧼', mirror: '🪞', bed_single: '🛏️', bed_double: '🛏️', wardrobe: '👗',
  computer: '💻', bookshelf: '📚', dresser: '🗄️', sofa: '🛋️', armchair: '💺', tv: '📺', tv_big: '🎬', coffee_table: '🫖', rug: '🟫',
  stereo: '📻', guitar: '🎸', piano: '🎹', easel: '🖌️', chess: '♟️', telescope: '🔭', chem_kit: '🧪', workbench: '🔐', treadmill: '🏃',
  weights: '🏋️', veg_patch: '🥕', bbq: '🍔', bench: '🪵', goal: '⚽', mailbox: '📮', floor_lamp: '💡', table_lamp: '🪔', lantern: '🏮',
  plant_small: '🪴', plant_big: '🌳', aquarium: '🐠', winding_wheel: '⛏️', lock_sculpture: '🔑', jukebox: '🎶', antique_locks: '🗝️',
  racing_print: '🏇', golden_guitar: '🎸', inspiring_easel: '🖼️', dream_bed: '☁️', magic_loo: '✨',
};

export function summary(def: ObjectDef): string {
  const best: Partial<Record<NeedId, number>> = {};
  const skills = new Set<string>();
  for (const i of def.interactions) {
    const fx = { ...(i.effects ?? {}) };
    if (i.then) for (const [k, v] of Object.entries(i.then.effects)) fx[k as NeedId] = (fx[k as NeedId] ?? 0) + (v ?? 0);
    for (const [k, v] of Object.entries(fx)) if ((v ?? 0) > 0) best[k as NeedId] = Math.max(best[k as NeedId] ?? 0, v ?? 0);
    if (i.skill) skills.add(i.skill);
  }
  const needs = Object.entries(best).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 3).map(([k]) => NEEDS[k as NeedId].icon).join('');
  const sk = [...skills].map((s) => SKILL_NAMES[s as keyof typeof SKILL_NAMES].icon).join('');
  const parts = [needs && `Fills ${needs}`, sk && `Skill ${sk}`, def.light && 'Light', def.decor >= 2 && `Room +${def.decor}`].filter(Boolean);
  return parts.join(' · ');
}

export class BuyMode {
  el: HTMLElement;
  private cat = 'kitchen';
  private itemsEl!: HTMLElement;
  private toolbar: HTMLElement;
  private placing: { defId: string; x: number; z: number; rot: 0 | 1 | 2 | 3; moving?: number } | null = null;
  private selected: number | null = null;
  private hintEl: HTMLElement;

  constructor(private app: App) {
    this.el = h('div', { class: 'passthrough', style: 'position:absolute;inset:0;display:none' });
    this.toolbar = h('div', { class: 'panel toolbar', style: 'display:none' });
    this.hintEl = h('div', { class: 'panel hint' }, 'Pick something to buy, or tap furniture to move or sell it. Hold furniture to move it.');
    this.el.append(this.hintEl, this.toolbar, this.buildSheet());
  }

  private buildSheet(): HTMLElement {
    const cats = h('div', { class: 'cats' }, ...OBJECT_CATEGORIES.map((c) =>
      h('button', { class: `tab ${c.id === this.cat ? 'on' : ''}`, 'data-cat': c.id, onclick: () => { this.cat = c.id; this.renderItems(); for (const b of cats.children) b.classList.toggle('on', (b as HTMLElement).dataset.cat === c.id); } }, `${c.icon} ${c.name}`)));
    this.itemsEl = h('div', { class: 'items' });
    return h('div', { class: 'panel sheet' }, cats, this.itemsEl);
  }

  open() {
    this.el.style.display = '';
    this.renderItems();
    this.cancel();
  }

  close() {
    this.el.style.display = 'none';
    this.cancel();
  }

  renderItems() {
    const game = this.app.game!;
    clear(this.itemsEl);
    const defs = Object.values(OBJECTS).filter((d) => d.category === this.cat);
    if (!defs.length) this.itemsEl.append(h('p', { class: 'muted' }, 'Nothing here yet.'));
    for (const def of defs) {
      const price = objectPrice(game, def.id);
      const locked = !isFinite(price);
      const count = def.reward ? game.state.household.rewardsUnlocked.filter((x) => x === def.id).length : 0;
      const afford = !locked && price <= game.state.household.funds;
      const item = h('button', {
        class: `item ${locked ? 'locked' : ''} ${this.placing?.defId === def.id && !this.placing.moving ? 'on' : ''}`,
        title: def.description,
        onclick: () => {
          if (locked) { this.app.toast(def.reward ? 'Unlock this with reward points (Goal tab → 🏆).' : 'Find this at the market on Tuesdays and Saturdays!', '🔒'); return; }
          if (!afford) { this.app.toast("You can't afford that yet.", '💸'); this.app.sound('error'); return; }
          this.startPlacing(def.id);
        },
      },
        h('span', { class: 'em' }, OBJECT_ICONS[def.id] ?? '📦'),
        h('span', { class: 'nm' }, def.name),
        h('span', { class: 'pr', style: afford || locked ? '' : 'color:var(--bad)' }, locked ? '🔒 Locked' : def.reward ? `Free (${count} ready)` : money(price)),
        h('span', { class: 'fx' }, summary(def)));
      this.itemsEl.append(item);
    }
  }

  private startPlacing(defId: string, moving?: number) {
    const game = this.app.game!;
    const t = this.app.world.camera.target;
    const def = OBJECTS[defId];
    const obj = moving !== undefined ? game.object(moving) : undefined;
    const rot = (obj?.rot ?? 0) as 0 | 1 | 2 | 3;
    const [W, D] = footprintSize(def, rot);
    this.placing = { defId, x: obj?.x ?? Math.round(t.x - W / 2), z: obj?.z ?? Math.round(t.z - D / 2), rot, moving };
    this.selected = null;
    this.app.world.lotView.setHighlight(null);
    if (moving !== undefined) this.app.world.lotView.objectMesh(moving)?.setEnabled(false);
    this.updateGhost();
    this.renderToolbar();
    this.renderItems();
  }

  private valid(): boolean {
    const p = this.placing!;
    return canPlaceObject(this.app.game!.state.lot, p.defId, p.x, p.z, p.rot, p.moving);
  }

  private updateGhost() {
    const p = this.placing;
    if (!p) { this.app.world.lotView.setGhost(null); return; }
    this.app.world.lotView.setGhost(p.defId, p.x, p.z, p.rot, this.valid());
  }

  private renderToolbar() {
    clear(this.toolbar);
    if (this.placing) {
      const def = OBJECTS[this.placing.defId];
      this.hintEl.textContent = `Drag or tap to position the ${def.name}. Rotate, then tap ✓.`;
      this.toolbar.style.display = '';
      this.toolbar.append(
        h('button', { class: 'btn', onclick: () => this.rotate() }, '⟳ Rotate'),
        h('button', { class: 'btn primary', onclick: () => this.place() }, this.placing.moving !== undefined ? '✓ Put here' : `✓ Buy ${money(objectPrice(this.app.game!, def.id))}`),
        h('button', { class: 'btn ghost', onclick: () => this.cancel() }, '✕'),
      );
    } else if (this.selected !== null) {
      const obj = this.app.game!.object(this.selected);
      if (!obj) { this.cancel(); return; }
      const def = OBJECTS[obj.defId];
      const recent = this.app.game!.state.time - obj.bought < 60;
      const refund = def.reward ? 0 : Math.round(def.price * (recent ? 1 : 0.75));
      this.hintEl.textContent = def.name;
      this.toolbar.style.display = '';
      this.toolbar.append(
        h('button', { class: 'btn', onclick: () => this.startPlacing(obj.defId, obj.id) }, '✥ Move'),
        h('button', { class: 'btn', onclick: () => this.rotateSelected() }, '⟳ Rotate'),
        h('button', { class: 'btn', onclick: () => this.sell() }, def.reward ? '↩ Store' : `💷 Sell +${money(refund)}`),
        h('button', { class: 'btn ghost', onclick: () => this.cancel() }, '✕'),
      );
    } else {
      this.hintEl.textContent = 'Pick something to buy, or tap furniture to move or sell it. Hold furniture to move it.';
      this.toolbar.style.display = 'none';
    }
  }

  private rotate() {
    if (!this.placing) return;
    this.placing.rot = ((this.placing.rot + 1) % 4) as 0 | 1 | 2 | 3;
    this.updateGhost();
  }

  private rotateSelected() {
    const game = this.app.game!;
    const obj = this.selected !== null ? game.object(this.selected) : undefined;
    if (!obj) return;
    for (let i = 1; i <= 3; i++) {
      const rot = ((obj.rot + i) % 4) as 0 | 1 | 2 | 3;
      if (moveObject(game, obj.id, obj.x, obj.z, rot).ok) return;
    }
    this.app.toast("There's no room to turn it.", '↻');
  }

  private place() {
    const p = this.placing;
    if (!p) return;
    const game = this.app.game!;
    const res = p.moving !== undefined ? moveObject(game, p.moving, p.x, p.z, p.rot) : buyObject(game, p.defId, p.x, p.z, p.rot);
    if (!res.ok) { this.app.toast(res.reason ?? "Can't place that there.", '🚫'); this.app.sound('error'); return; }
    if (p.moving !== undefined) this.app.world.lotView.objectMesh(p.moving)?.setEnabled(true);
    this.placing = null;
    this.app.world.lotView.setGhost(null);
    this.renderToolbar();
    this.renderItems();
  }

  private sell() {
    if (this.selected === null) return;
    sellObject(this.app.game!, this.selected);
    this.selected = null;
    this.app.world.lotView.setHighlight(null);
    this.renderToolbar();
    this.renderItems();
  }

  cancel() {
    if (this.placing?.moving !== undefined) this.app.world.lotView.objectMesh(this.placing.moving)?.setEnabled(true);
    this.placing = null;
    this.selected = null;
    this.app.world?.lotView.setGhost(null);
    this.app.world?.lotView.setHighlight(null);
    this.renderToolbar();
  }

  private moveGhostTo(x: number, y: number) {
    const p = this.placing;
    if (!p) return;
    const g = this.app.world.groundAt(x, y);
    if (!g) return;
    const [W, D] = footprintSize(OBJECTS[p.defId], p.rot);
    p.x = Math.round(g.x - W / 2);
    p.z = Math.round(g.z - D / 2);
    this.updateGhost();
  }

  // ---------- Pointer input ----------

  onTap(x: number, y: number) {
    if (this.placing) { this.moveGhostTo(x, y); return; }
    const hit = this.app.world.pick(x, y);
    if (hit?.kind === 'object') {
      this.selected = hit.id;
      this.app.world.lotView.setHighlight(hit.id);
    } else {
      this.selected = null;
      this.app.world.lotView.setHighlight(null);
    }
    this.renderToolbar();
  }

  onLongPress(x: number, y: number) {
    const hit = this.app.world.pick(x, y);
    if (hit?.kind === 'object') {
      const obj = this.app.game!.object(hit.id);
      if (obj) this.startPlacing(obj.defId, obj.id);
    }
  }

  onDragStart(x: number, y: number): boolean {
    if (!this.placing) return false;
    this.moveGhostTo(x, y);
    return true;
  }
  onDragMove(x: number, y: number) { this.moveGhostTo(x, y); }
  onDragEnd() {}
}
