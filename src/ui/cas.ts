// Create-a-Sim: build a household of up to 4 Sims.
import { ASPIRATIONS, TRAITS } from '../sim/defs';
import { BODIES, BOTTOMS, CLOTH_COLORS, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, TOPS, randomDraft, type SimDraft } from '../sim/newgame';
import type { GameState } from '../sim/types';
import type { App } from './app';
import { modal } from './panels';
import { clear, h, initials } from './dom';

type Tab = 'who' | 'look' | 'hair' | 'clothes';

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
    const tabs = h('div', { class: 'tabs' }, ...([['who', 'Personality'], ['look', 'Body'], ['hair', 'Hair & face'], ['clothes', 'Clothes']] as [Tab, string][])
      .map(([t, l]) => h('button', { class: `tab ${t === this.tab ? 'on' : ''}`, onclick: () => { this.tab = t; this.app.casView.zoomFace(t === 'hair'); this.render(); } }, l)));
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

  private renderTab(el: HTMLElement) {
    const a = this.d.appearance;
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
          ...this.opts('Body shape', BODIES.map((b) => ({ id: b, name: b[0].toUpperCase() + b.slice(1) })), a.body, (v) => { a.body = v; }),
          h('div', { class: 'opt-label' }, 'Height'),
          h('input', { type: 'range', min: 0.9, max: 1.1, step: 0.01, value: a.height, 'aria-label': 'Height', oninput: (e: Event) => { a.height = Number((e.target as HTMLInputElement).value); this.app.casView.show(a); } }),
          ...this.colors('Skin tone', SKIN_TONES, a.skin, (v) => { a.skin = v; }),
        );
        break;
      case 'hair':
        el.append(
          ...this.opts('Hair style', HAIR_STYLES, a.hairStyle, (v) => { a.hairStyle = v; }),
          ...this.colors('Hair colour', HAIR_COLORS, a.hairColor, (v) => { a.hairColor = v; }),
          ...this.colors('Eye colour', EYE_COLORS, a.eyeColor, (v) => { a.eyeColor = v; }),
          ...this.opts('Face', [0, 1, 2, 3].map((i) => ({ id: String(i), name: ['Classic', 'Bright-eyed', 'Calm', 'Cute'][i] })), String(a.face), (v) => { a.face = Number(v); }),
          ...this.opts('Freckles', [{ id: 'no', name: 'None' }, { id: 'yes', name: 'Freckles' }], a.freckles ? 'yes' : 'no', (v) => { a.freckles = v === 'yes'; }),
        );
        break;
      case 'clothes':
        el.append(
          ...this.opts('Top', TOPS, a.top, (v) => { a.top = v; if (v === 'dress') a.bottom = 'skirt'; }),
          ...this.colors('Top colour', CLOTH_COLORS, a.topColor, (v) => { a.topColor = v; }),
          ...(a.top === 'dress' ? [] : this.opts('Bottoms', BOTTOMS, a.bottom, (v) => { a.bottom = v; })),
          ...(a.top === 'dress' ? [] : this.colors('Bottoms colour', CLOTH_COLORS, a.bottomColor, (v) => { a.bottomColor = v; })),
          ...this.colors('Shoes', ['#2b2b2b', '#f4f1ea', '#8b5e3c', '#c0392b', '#3b4ba8', '#f08ab0', '#57b36a'], a.shoeColor, (v) => { a.shoeColor = v; }),
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
