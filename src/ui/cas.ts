// Create-a-Sim: build a household of up to 4 Sims.
import { ASPIRATIONS, TRAITS } from '../sim/defs';
import { ACCESSORIES, BODIES, BOTTOMS, CLOTH_COLORS, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, LIP_COLORS, SHOES, SKIN_TONES, TOPS, normalizeAppearance, randomDraft, type SimDraft } from '../sim/newgame';
import type { GameState } from '../sim/types';
import type { App } from './app';
import { modal } from './panels';
import { clear, h, initials } from './dom';

type Tab = 'who' | 'look' | 'face' | 'hair' | 'clothes';

export class CasScreen {
  el: HTMLElement;
  private drafts: SimDraft[] = [];
  private idx = 0;
  private household = '';
  private tab: Tab = 'who';
  private panel!: HTMLElement;
  private rng = { rng: Math.floor(Math.random() * 1e9) } as GameState;

  constructor(private app: App) {
    this.el = h('div', { class: 'screen cas' });
  }

  open() {
    const surname = randomDraft(this.rng).name.split(' ')[1];
    this.household = surname;
    this.drafts = [randomDraft(this.rng, surname)];
    this.idx = 0;
    this.tab = 'who';
    this.render();
  }

  private get d(): SimDraft { return this.drafts[this.idx]; }

  private update() {
    this.app.casView.show(this.d.appearance);
    this.render();
  }

  private render() {
    clear(this.el);
    this.app.casView.show(this.d.appearance);
    const members = h('div', { class: 'cas-members' },
      ...this.drafts.map((d, i) => h('button', {
        class: `portrait ${i === this.idx ? 'sel' : ''}`, style: `width:48px;height:48px;font-size:15px;background:${d.appearance.topColor}`,
        'aria-label': d.name, onclick: () => { this.idx = i; this.update(); },
      }, initials(d.name))),
      this.drafts.length < 4 ? h('button', { class: 'btn small', onclick: () => { this.drafts.push(randomDraft(this.rng, this.household)); this.idx = this.drafts.length - 1; this.update(); } }, '＋ Add Sim') : null,
      this.drafts.length > 1 ? h('button', { class: 'btn small ghost', onclick: () => { this.drafts.splice(this.idx, 1); this.idx = Math.max(0, this.idx - 1); this.update(); } }, 'Remove') : null,
    );
    const tabs = h('div', { class: 'tabs' }, ...([['who', 'Personality'], ['look', 'Body'], ['face', 'Face'], ['hair', 'Hair'], ['clothes', 'Clothes']] as [Tab, string][])
      .map(([t, l]) => h('button', { class: `tab ${t === this.tab ? 'on' : ''}`, onclick: () => { this.tab = t; this.app.casView.zoomFace(t === 'hair' || t === 'face'); this.render(); } }, l)));
    const scroll = h('div', { class: 'cas-scroll' });
    this.renderTab(scroll);
    this.panel = h('div', { class: 'panel cas-panel' },
      h('div', { class: 'opt-label', style: 'margin-top:0' }, 'Household name'),
      h('input', { type: 'text', value: this.household, maxlength: 24, 'aria-label': 'Household name', oninput: (e: Event) => { this.household = (e.target as HTMLInputElement).value; } }),
      h('div', { class: 'opt-label' }, `Your household (${this.drafts.length}/4)`),
      members, tabs, scroll,
      h('div', { class: 'cas-foot' },
        h('button', { class: 'btn ghost', onclick: () => this.app.showTitle() }, '← Back'),
        h('button', { class: 'btn', onclick: () => { const keep = this.d.name; this.drafts[this.idx] = randomDraft(this.rng, keep.split(' ')[1]); this.update(); } }, '🎲 Random'),
        h('button', { class: 'btn primary', style: 'margin-left:auto', onclick: () => this.done() }, 'Done ✓'),
      ),
    );
    this.el.append(this.panel,
      h('div', { class: 'cas-tools' },
        h('button', { class: 'btn', onclick: () => { this.app.casView.anim = this.app.casView.anim === 'wave' ? 'dance' : this.app.casView.anim === 'dance' ? 'idle' : 'wave'; } }, '💃 Pose'),
      ));
  }

  private opts<T extends string>(label: string, list: { id: T; name: string }[], current: T, set: (v: T) => void): HTMLElement[] {
    return [h('div', { class: 'opt-label' }, label), h('div', { class: 'opts' }, ...list.map((o) => h('button', { class: `opt ${o.id === current ? 'on' : ''}`, onclick: () => { set(o.id); this.update(); } }, o.name)))];
  }

  private colors(label: string, list: string[], current: string, set: (v: string) => void): HTMLElement[] {
    return [h('div', { class: 'opt-label' }, label), h('div', { class: 'colors' }, ...list.map((c) => h('button', { class: `color ${c === current ? 'on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => { set(c); this.update(); } })))];
  }

  private slider(label: string, min: number, max: number, value: number, set: (v: number) => void): HTMLElement[] {
    const a = this.d.appearance;
    return [h('div', { class: 'opt-label' }, label), h('input', { type: 'range', min, max, step: 0.01, value, 'aria-label': label, style: 'width:100%', oninput: (e: Event) => { set(Number((e.target as HTMLInputElement).value)); this.app.casView.show(a); } })];
  }

  private renderTab(el: HTMLElement) {
    this.d.appearance = normalizeAppearance(this.d.appearance);
    const a = this.d.appearance as Required<typeof this.d.appearance>;
    switch (this.tab) {
      case 'who': {
        el.append(
          h('div', { class: 'opt-label' }, 'Name'),
          h('input', { type: 'text', value: this.d.name, maxlength: 28, 'aria-label': 'Sim name', oninput: (e: Event) => { this.d.name = (e.target as HTMLInputElement).value; } }),
          h('div', { class: 'opt-label' }, `Traits (pick 3) · ${this.d.traits.length}/3`),
          h('div', { class: 'grid2' }, ...Object.values(TRAITS).map((t) => {
            const on = this.d.traits.includes(t.id);
            return h('button', { class: `trait ${on ? 'on' : ''}`, onclick: () => {
              if (on) this.d.traits = this.d.traits.filter((x) => x !== t.id);
              else if (this.d.traits.length < 3) this.d.traits.push(t.id);
              else this.app.toast('Three traits each. Tap one to remove it first.', 'ℹ️');
              this.render();
            } }, h('b', null, `${t.icon} ${t.name}`), t.desc);
          })),
          h('div', { class: 'opt-label' }, 'Aspiration (life goal)'),
          h('div', { class: 'grid2' }, ...Object.values(ASPIRATIONS).map((asp) =>
            h('button', { class: `trait ${asp.id === this.d.aspiration ? 'on' : ''}`, onclick: () => { this.d.aspiration = asp.id; this.render(); } }, h('b', null, `${asp.icon} ${asp.name}`), asp.desc))),
        );
        break;
      }
      case 'look':
        el.append(
          ...this.opts('Build', BODIES.map((b) => ({ id: b, name: b[0].toUpperCase() + b.slice(1) })), a.body, (v) => { a.body = v; }),
          ...this.opts('Figure', [{ id: 'straight', name: 'Straight' }, { id: 'curvy', name: 'Curvy' }], a.figure, (v) => { a.figure = v as 'straight' | 'curvy'; }),
          ...this.slider('Height', 0.9, 1.1, a.height, (v) => { a.height = v; }),
          ...this.colors('Skin tone', SKIN_TONES, a.skin, (v) => { a.skin = v; }),
        );
        break;
      case 'face':
        el.append(
          ...this.opts('Face shape', [0, 1, 2, 3].map((i) => ({ id: String(i), name: ['Oval', 'Round', 'Heart', 'Square'][i] })), String(a.face), (v) => { a.face = Number(v); }),
          ...this.colors('Eye colour', EYE_COLORS, a.eyeColor, (v) => { a.eyeColor = v; }),
          ...this.slider('Eye size', 0.8, 1.2, a.eyeSize, (v) => { a.eyeSize = v; }),
          ...this.slider('Eye spacing', 0.85, 1.15, a.eyeSpacing, (v) => { a.eyeSpacing = v; }),
          ...this.opts('Eyebrows', [{ id: 'thin', name: 'Thin' }, { id: 'medium', name: 'Medium' }, { id: 'thick', name: 'Thick' }], a.brows, (v) => { a.brows = v as 'thin'; }),
          ...this.opts('Eyelashes', [{ id: 'no', name: 'Natural' }, { id: 'yes', name: 'Long lashes' }], a.lashes ? 'yes' : 'no', (v) => { a.lashes = v === 'yes'; }),
          ...this.slider('Nose size', 0.75, 1.3, a.noseSize, (v) => { a.noseSize = v; }),
          ...this.slider('Mouth width', 0.8, 1.25, a.mouthWidth, (v) => { a.mouthWidth = v; }),
          ...this.colors('Lip colour', LIP_COLORS, a.lipColor, (v) => { a.lipColor = v; }),
          ...this.opts('Freckles', [{ id: 'no', name: 'None' }, { id: 'yes', name: 'Freckles' }], a.freckles ? 'yes' : 'no', (v) => { a.freckles = v === 'yes'; }),
          ...this.opts('Blush', [{ id: 'no', name: 'None' }, { id: 'yes', name: 'Rosy cheeks' }], a.blush ? 'yes' : 'no', (v) => { a.blush = v === 'yes'; }),
        );
        break;
      case 'hair':
        el.append(
          ...this.opts('Hair style', HAIR_STYLES, a.hairStyle, (v) => { a.hairStyle = v; }),
          ...this.colors('Hair colour', HAIR_COLORS, a.hairColor, (v) => { a.hairColor = v; }),
        );
        break;
      case 'clothes':
        el.append(
          ...this.opts('Top', TOPS, a.top, (v) => { a.top = v; if (v === 'dress') a.bottom = 'skirt'; }),
          ...this.colors('Top colour', CLOTH_COLORS, a.topColor, (v) => { a.topColor = v; }),
          ...(a.top === 'dress' ? [] : this.opts('Bottoms', BOTTOMS, a.bottom, (v) => { a.bottom = v; })),
          ...(a.top === 'dress' ? [] : this.colors('Bottoms colour', CLOTH_COLORS, a.bottomColor, (v) => { a.bottomColor = v; })),
          ...this.opts('Shoes', SHOES, a.shoes, (v) => { a.shoes = v as 'trainers'; }),
          ...this.colors('Shoe colour', ['#2b2b2b', '#f4f1ea', '#8b5e3c', '#c0392b', '#3b4ba8', '#f08ab0', '#57b36a'], a.shoeColor, (v) => { a.shoeColor = v; }),
          ...this.opts('Accessory', ACCESSORIES, a.accessory, (v) => { a.accessory = v as 'none'; }),
          ...(a.accessory === 'none' || a.accessory === 'earrings' ? [] : this.colors('Accessory colour', ['#2d3037', '#8b5e3c', '#c0392b', '#3b4ba8', '#f08ab0', '#f4f1ea', '#57b36a'], a.accessoryColor, (v) => { a.accessoryColor = v; })),
        );
        break;
    }
  }

  private done() {
    for (const d of this.drafts) {
      d.name = d.name.trim() || 'Sim';
      if (d.traits.length < 3) {
        this.idx = this.drafts.indexOf(d);
        this.tab = 'who';
        this.render();
        this.app.toast(`${d.name} needs 3 traits.`, 'ℹ️');
        return;
      }
    }
    const name = this.household.trim() || 'Household';
    let close = () => {};
    const choose = (lot: 'starter' | 'empty') => { close(); this.app.startNewGame({ householdName: name, sims: this.drafts, lot }); };
    close = modal(this.app.root, 'Choose a home in Town Green', [
      h('div', { class: 'card', style: 'cursor:pointer', onclick: () => choose('starter') },
        h('div', { class: 't', style: 'font-size:18px' }, '🏠 Red-brick starter home'), h('p', { class: 'muted' }, 'Two bedrooms, kitchen, bathroom and a garden. Furnished with the basics. £14,000 to spend.')),
      h('div', { class: 'card', style: 'cursor:pointer', onclick: () => choose('empty') },
        h('div', { class: 't', style: 'font-size:18px' }, '🌱 Empty plot'), h('p', { class: 'muted' }, 'Build your dream home from scratch in Build mode. £30,000 to spend.')),
    ]);
  }
}
