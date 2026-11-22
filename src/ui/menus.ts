// Title screen, pause menu, save slots and settings.
import { GAME_TITLE } from './title';
import { listSlots, SLOTS, type SlotId, type SlotMeta } from '../platform/storage';
import type { App } from './app';
import { modal } from './panels';
import { clear, h, money } from './dom';

export class Menus {
  title: HTMLElement;
  constructor(private app: App) {
    this.title = h('div', { class: 'screen title-screen' });
  }

  async renderTitle() {
    clear(this.title);
    const slots = await listSlots();
    const auto = slots.find((s) => s.slot === 'auto');
    const [first, second] = GAME_TITLE.split(' ');
    this.title.append(h('div', null,
      h('h1', { class: 'logo' }, first, h('br'), h('span', null, second)),
      h('p', { class: 'tagline' }, 'A life sim set in Ashton-in-Makerfield'),
      h('div', { class: 'menu-col' },
        auto ? h('button', { class: 'btn primary', onclick: () => this.app.loadFromSlot('auto') }, `▶  Continue · ${auto.household}`) : null,
        h('button', { class: `btn ${auto ? '' : 'primary'}`, onclick: () => this.app.showCas() }, '✨  New household'),
        slots.length ? h('button', { class: 'btn', onclick: () => this.loadMenu() }, '📂  Load game') : null,
        h('button', { class: 'btn', onclick: () => this.app.importSave() }, '📥  Import save file'),
        h('button', { class: 'btn', onclick: () => this.settings() }, '⚙️  Settings'),
      ),
    ));
  }

  private slotLabel(slot: SlotId): string { return slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(4)}`; }

  private slotDesc(m?: SlotMeta): string {
    if (!m) return 'Empty';
    const when = new Date(m.savedAt);
    return `${m.household} · Day ${m.day + 1} · ${money(m.funds)} · ${when.toLocaleDateString('en-GB')} ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async loadMenu() {
    const slots = await listSlots();
    let close = () => {};
    const rows = SLOTS.map((s) => {
      const m = slots.find((x) => x.slot === s);
      return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, this.slotLabel(s)), h('div', { class: 's' }, this.slotDesc(m))),
        h('button', { class: 'btn small primary', disabled: !m, onclick: () => { close(); this.app.loadFromSlot(s); } }, 'Load')));
    });
    close = modal(this.app.root, 'Load game', rows);
  }

  async saveMenu() {
    const slots = await listSlots();
    let close = () => {};
    const rows = (['slot1', 'slot2', 'slot3'] as SlotId[]).map((s) => {
      const m = slots.find((x) => x.slot === s);
      return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, this.slotLabel(s)), h('div', { class: 's' }, this.slotDesc(m))),
        h('button', { class: 'btn small primary', onclick: async () => { close(); await this.app.saveToSlot(s); } }, m ? 'Overwrite' : 'Save')));
    });
    close = modal(this.app.root, 'Save game', [h('p', { class: 'muted' }, 'The game also autosaves at the end of every day. Browser storage can be cleared, so export a backup now and then.'), ...rows]);
  }

  pauseMenu() {
    let close = () => {};
    const btn = (label: string, fn: () => void, cls = '') => h('button', { class: `btn ${cls}`, style: 'width:100%;justify-content:flex-start;margin-bottom:8px', onclick: () => { close(); fn(); } }, label);
    close = modal(this.app.root, 'Menu', [
      btn('💾  Save game', () => this.saveMenu(), 'primary'),
      btn('📂  Load game', () => this.loadMenu()),
      btn('📤  Export save (backup file)', () => this.app.exportSave()),
      btn('📥  Import save file', () => this.app.importSave()),
      btn('🗺️  Ashton map', () => this.app.panels.map()),
      btn('🏡  Invite someone over', () => this.app.panels.invite(this.app.selectedSim())),
      btn('⚙️  Settings', () => this.settings()),
      btn('❓  How to play', () => this.app.tutorial.start()),
      btn('🚪  Quit to title', () => this.app.panels.confirm('Quit to title?', 'Unsaved progress since the last autosave will be lost.', 'Quit', () => this.app.showTitle())),
    ], [], () => this.app.menuClosed());
    this.app.menuOpened();
  }

  settings() {
    const app = this.app;
    const s = app.settings;
    const game = app.game;
    const seg = <T extends string>(values: [T, string][], current: T, set: (v: T) => void) => {
      const wrap = h('div', { class: 'seg' });
      const draw = (cur: T) => {
        clear(wrap);
        for (const [v, label] of values) wrap.append(h('button', { class: v === cur ? 'on' : '', onclick: () => { set(v); draw(v); } }, label));
      };
      draw(current);
      return wrap;
    };
    modal(app.root, 'Settings', [
      h('div', { class: 'settings-row' }, 'Graphics', seg([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], s.quality, (v) => { s.quality = v; app.applySettings(); })),
      h('div', { class: 'settings-row' }, 'Walls', seg([['up', 'Up'], ['cutaway', 'Cutaway'], ['down', 'Down']], s.wallMode, (v) => { s.wallMode = v; app.applySettings(); })),
      h('div', { class: 'settings-row' }, 'Music', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.music, oninput: (e: Event) => { s.music = Number((e.target as HTMLInputElement).value); app.applySettings(); } })),
      h('div', { class: 'settings-row' }, 'Sound effects', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.sfx, oninput: (e: Event) => { s.sfx = Number((e.target as HTMLInputElement).value); app.applySettings(); } })),
      game ? h('div', { class: 'settings-row' }, h('span', null, 'Free will', h('div', { class: 'muted' }, 'How much Sims do on their own')), seg([['off', 'Off'], ['low', 'Low'], ['full', 'Full']], game.state.settings.freeWill, (v) => { game.state.settings.freeWill = v; })) : null,
      game ? h('div', { class: 'settings-row' }, h('span', null, 'Romance', h('div', { class: 'muted' }, 'Flirting and partners')), seg([['on', 'On'], ['off', 'Friendships only']], game.state.settings.romance ? 'on' : 'off', (v) => { game.state.settings.romance = v === 'on'; })) : null,
      h('p', { class: 'muted' }, `${GAME_TITLE} works offline once installed. No accounts, no ads, no chat, no in-app purchases.`),
    ]);
  }
}
