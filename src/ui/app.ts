// The app controller: screens (title, create-a-Sim, play), modes (live, buy, build), input routing,
// the main loop and saving. The simulation core never sees any of this.
import { Game } from '../sim/game';
import { createGame, randomAppearance, type NewGameOptions } from '../sim/newgame';
import { serialize, deserialize, SaveError } from '../sim/save';
import { enqueue, cancelAction, checkInteraction } from '../sim/actions';
import { availableSocials } from '../sim/social';
import { OBJECTS, OUTINGS, SELF_ACTIONS } from '../sim/defs';
import { scheduleNextVisit } from '../sim/schedule';
import type { GameEvent, GameState, Sim } from '../sim/types';
import { WorldView } from '../view/world';
import { CasView } from '../view/casView';
import type { PointerHandlers } from '../view/camera';
import { Audio } from '../platform/audio';
import { downloadText, loadSettings, loadSlot, pickTextFile, saveSettings, saveSlot, type DeviceSettings, type SlotId } from '../platform/storage';
import { Hud } from './hud';
import { Panels } from './panels';
import { Menus } from './menus';
import { BuyMode } from './buy';
import { BuildMode } from './build';
import { CasScreen } from './cas';
import { Tutorial } from './tutorial';
import { showRadial, type RadialOption } from './radial';
import { GAME_TITLE } from './title';
import { h } from './dom';

type Screen = 'title' | 'cas' | 'play';
type Mode = 'live' | 'buy' | 'build';

export class App {
  readonly root: HTMLElement;
  readonly world: WorldView;
  readonly casView: CasView;
  readonly audio = new Audio();
  readonly settings: DeviceSettings = loadSettings();
  game: Game | null = null;
  screen: Screen = 'title';
  mode: Mode = 'live';
  fastForward = false;
  private pausedByMenu = false;

  readonly hud: Hud;
  readonly panels: Panels;
  readonly menus: Menus;
  readonly buy: BuyMode;
  readonly build: BuildMode;
  readonly cas: CasScreen;
  readonly tutorial: Tutorial;
  private playLayer: HTMLElement;
  private hudTimer = 0;
  private lastSave = 0;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.root = root;
    const handlers: PointerHandlers = {
      onTap: (x, y) => this.onTap(x, y),
      onLongPress: (x, y) => this.onLongPress(x, y),
      onDragStart: (x, y) => (this.mode === 'buy' ? this.buy.onDragStart(x, y) : this.mode === 'build' ? this.build.onDragStart(x, y) : false),
      onDragMove: (x, y) => { if (this.mode === 'buy') this.buy.onDragMove(x, y); else if (this.mode === 'build') this.build.onDragMove(x, y); },
      onDragEnd: (x, y, c) => { if (this.mode === 'buy') this.buy.onDragEnd(); else if (this.mode === 'build') this.build.onDragEnd(x, y, c); },
      onHover: () => {},
    };
    this.world = new WorldView(canvas, handlers);
    this.casView = new CasView(this.world.engine, canvas);
    this.hud = new Hud(this);
    this.panels = new Panels(this);
    this.menus = new Menus(this);
    this.buy = new BuyMode(this);
    this.build = new BuildMode(this);
    this.cas = new CasScreen(this);
    this.tutorial = new Tutorial(this);
    this.playLayer = h('div', { class: 'passthrough', style: 'position:absolute;inset:0' }, this.hud.el, this.buy.el, this.build.el, this.tutorial.el);
    document.title = GAME_TITLE;
    this.applySettings();

    // Audio can only start after a user gesture.
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false, passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.autosave(); });
  }

  start() {
    void this.showTitle();
    let last = performance.now();
    this.world.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.loop(dt);
    });
  }

  private loop(dt: number) {
    if (this.screen !== 'play' || !this.game) {
      this.casView.frame(dt);
      return;
    }
    const game = this.game;
    const st = game.state;
    let speed = this.mode === 'live' && !this.pausedByMenu ? st.speed : 0;
    const members = game.household();
    this.fastForward = speed > 0 && members.length > 0 && members.every((s) => s.location !== 'lot' || (s.current?.anim === 'sleep' && s.current.phase === 'perform'));
    if (this.fastForward) speed *= 8;
    if (speed > 0) game.tick(dt * speed);
    this.flushEvents();
    this.world.setSelected(st.selectedSimId);
    this.world.frame(dt, speed);
    this.hud.frame();
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.2; this.hud.refresh(); }
  }

  // ---------- Screens ----------

  async showTitle() {
    if (this.game) await this.autosave();
    this.screen = 'title';
    this.game = null;
    this.root.replaceChildren(this.menus.title);
    this.casView.setActive(false);
    this.casView.layout('right');
    this.casView.anim = 'wave';
    this.casView.show(randomAppearance({ rng: Math.floor(Math.random() * 1e9) } as GameState));
    await this.menus.renderTitle();
  }

  showCas() {
    this.screen = 'cas';
    this.root.replaceChildren(this.cas.el);
    this.casView.setActive(true);
    this.casView.anim = 'idle';
    this.casView.layout(window.innerWidth > 760 ? 'left' : 'top');
    this.cas.open();
  }

  startNewGame(opts: NewGameOptions) {
    const state = createGame(opts);
    this.enterPlay(new Game(state));
    scheduleNextVisit(this.game!);
    this.game!.notify(`Welcome to Town Green, ${opts.householdName} household!`, '🏡', 'good');
    if (!this.settings.seenTutorial) this.tutorial.start();
    void this.autosave();
  }

  private enterPlay(game: Game) {
    this.game = game;
    this.screen = 'play';
    this.mode = 'live';
    this.casView.setActive(false);
    this.root.replaceChildren(this.playLayer);
    this.world.setGame(game);
    this.hud.reset();
    this.setMode('live');
    this.hud.setWallLabel(this.settings.wallMode);
    const sel = game.sim(game.state.selectedSimId) ?? game.household()[0];
    if (sel) this.selectSim(sel.id, true);
    this.hud.refresh();
  }

  menuOpened() { this.pausedByMenu = true; }
  menuClosed() { this.pausedByMenu = false; }

  // ---------- Saving ----------

  private meta() {
    const g = this.game!;
    return { household: g.state.household.name, day: g.day, funds: g.state.household.funds };
  }

  async autosave() {
    if (!this.game || this.screen !== 'play') return;
    try {
      await saveSlot('auto', this.meta(), serialize(this.game.state));
      this.lastSave = performance.now();
    } catch (e) {
      console.warn('Autosave failed', e);
    }
  }

  async saveToSlot(slot: SlotId) {
    if (!this.game) return;
    try {
      await saveSlot(slot, this.meta(), serialize(this.game.state));
      this.toast('Game saved.', '💾');
    } catch {
      this.panels.message('Could not save', 'The browser would not let us save. Try exporting a backup file instead.');
    }
  }

  async loadFromSlot(slot: SlotId) {
    try {
      const text = await loadSlot(slot);
      if (!text) { this.panels.message('Empty slot', 'There is no game saved there.'); return; }
      this.enterPlay(new Game(deserialize(text)));
    } catch (e) {
      this.panels.message('Could not load', e instanceof SaveError ? e.message : 'That save could not be read.');
    }
  }

  exportSave() {
    if (!this.game) return;
    const name = this.game.state.household.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    downloadText(`ashton-life-${name}-day${this.game.day + 1}.json`, serialize(this.game.state));
  }

  async importSave() {
    const text = await pickTextFile();
    if (!text) return;
    try {
      const state = deserialize(text);
      this.enterPlay(new Game(state));
      this.toast('Save imported.', '📥');
    } catch (e) {
      this.panels.message('Could not import', e instanceof SaveError ? e.message : 'That file could not be read.');
    }
  }

  applySettings() {
    const s = this.settings;
    saveSettings(s);
    if (this.world.quality !== s.quality) this.world.setQuality(s.quality);
    this.world.setWallMode(s.wallMode);
    this.hud?.setWallLabel(s.wallMode);
    this.audio.setVolumes(s.sfx, s.music);
  }

  cycleWalls() {
    const order = ['cutaway', 'up', 'down'] as const;
    this.settings.wallMode = order[(order.indexOf(this.settings.wallMode) + 1) % order.length];
    this.applySettings();
  }

  // ---------- Commands from the HUD ----------

  setSpeed(s: 0 | 1 | 2 | 3) {
    if (!this.game) return;
    this.game.state.speed = s;
    this.sound('tap');
    this.hud.refresh();
  }

  setMode(m: Mode) {
    if (!this.game) return;
    if (this.mode === 'buy') this.buy.close();
    if (this.mode === 'build') this.build.close();
    this.mode = m;
    this.hud.setMode(m);
    this.world.lotView.showGrid(m !== 'live');
    this.world.setBuildCamera(m === 'build');
    if (m === 'buy') this.buy.open();
    if (m === 'build') this.build.open();
    this.sound('open');
  }

  selectedSim(): Sim | undefined { return this.game?.sim(this.game.state.selectedSimId); }

  selectSim(id: number, focus: boolean) {
    const game = this.game;
    const sim = game?.sim(id);
    if (!game || !sim) return;
    if (game.state.selectedSimId === id && focus && sim.location === 'lot') this.world.cam.focus(sim.pos.x, sim.pos.z);
    game.state.selectedSimId = id;
    if (focus && sim.location === 'lot') this.world.cam.focus(sim.pos.x, sim.pos.z);
    if (sim.location === 'work') this.toast(`${sim.name} is at work.`, '💼');
    else if (sim.location === 'away') this.toast(`${sim.name} is out and about.`, '🚶');
    this.sound('tap');
    this.hud.refresh();
  }

  cancel(simId: number, uid: number) {
    const sim = this.game?.sim(simId);
    if (!sim || !this.game) return;
    cancelAction(this.game, sim, uid);
    this.flushEvents();
    this.hud.refresh();
  }

  private queue(sim: Sim, action: Parameters<typeof enqueue>[2]) {
    if (!this.game) return;
    if (sim.location !== 'lot') { this.toast(`${sim.name} isn't home right now.`, '🚶'); return; }
    const uid = enqueue(this.game, sim, { ...action, userQueued: true });
    if (uid < 0) { this.toast('The action queue is full.', '✋'); return; }
    this.sound('tap');
    this.hud.refresh();
  }

  queueOuting(sim: Sim, id: string) {
    const o = OUTINGS[id];
    this.queue(sim, { kind: 'outing', selfId: id, label: o.name, icon: o.icon, userQueued: true });
  }

  invite(townieId: number) {
    const game = this.game;
    const t = game?.sim(townieId);
    if (!game || !t) return;
    if (t.location === 'lot' || game.state.pendingVisits.some((v) => v.simId === townieId)) return;
    game.state.pendingVisits.push({ simId: townieId, at: game.state.time + 20 + Math.random() * 30 });
    this.toast(`${t.name} is on their way over.`, '📱');
    this.hud.refresh();
  }

  flushEvents() {
    if (!this.game) return;
    for (const e of this.game.drainEvents()) this.handleEvent(e);
  }

  private handleEvent(e: GameEvent) {
    switch (e.type) {
      case 'notify':
        this.hud.toast(e.notification);
        if (e.notification.kind === 'bills') this.sound('notify');
        break;
      case 'sound': this.sound(e.sound); break;
      case 'dayEnded':
        if (performance.now() - this.lastSave > 5000) void this.autosave();
        break;
      case 'openPanel': {
        const sim = this.game!.sim(e.simId);
        if (!sim) break;
        if (e.panel === 'careers') this.panels.careers(sim);
        if (e.panel === 'relationships') this.panels.invite(sim);
        break;
      }
    }
  }

  toast(text: string, icon = 'ℹ️') { this.hud.toast({ text, icon, kind: 'info' }); }
  sound(name: string) { this.audio.play(name); }

  // ---------- Pointer input in live mode ----------

  private onTap(x: number, y: number) {
    if (this.screen !== 'play' || !this.game) return;
    if (this.mode === 'buy') { this.buy.onTap(x, y); return; }
    if (this.mode === 'build') { this.build.onTap(x, y); return; }
    const game = this.game;
    const hit = this.world.pick(x, y);
    const sel = this.selectedSim();
    if (!hit) return;
    if (hit.kind === 'sim') { this.simMenu(x, y, hit.id); return; }
    if (!sel) return;
    if (hit.kind === 'object') { this.objectMenu(x, y, hit.id); return; }
    if (hit.kind === 'ground' || hit.kind === 'wall') {
      const g = hit.kind === 'ground' ? hit : this.world.groundAt(x, y);
      if (!g) return;
      const tx = Math.floor(g.x), tz = Math.floor(g.z);
      const lot = game.state.lot;
      if (tx < 0 || tz < 0 || tx >= lot.width || tz >= lot.depth) return;
      showRadial(this.root, x, y, sel.name.split(' ')[0], [
        { icon: '📍', label: 'Go here', onPick: () => this.queue(sel, { kind: 'goto', dest: { x: tx, z: tz }, label: 'Go here', icon: '📍', userQueued: true }) },
      ]);
    }
  }

  private onLongPress(x: number, y: number) {
    if (this.screen !== 'play' || !this.game) return;
    if (this.mode === 'buy') { this.buy.onLongPress(x, y); return; }
    if (this.mode === 'build') return;
    const hit = this.world.pick(x, y);
    if (hit?.kind === 'object') { const o = this.game.object(hit.id); if (o) this.panels.objectInfo(o); }
    if (hit?.kind === 'sim') { const s = this.game.sim(hit.id); if (s) this.panels.simInfo(s); }
  }

  private objectMenu(x: number, y: number, objId: number) {
    const game = this.game!;
    const obj = game.object(objId);
    const sim = this.selectedSim();
    if (!obj || !sim) return;
    const def = OBJECTS[obj.defId];
    const options: RadialOption[] = [];
    for (const inter of def.interactions) {
      const avail = checkInteraction(game, sim, obj, inter);
      if (avail.hidden) continue;
      options.push({
        icon: inter.icon, label: inter.name, disabled: !avail.ok, why: avail.reason,
        onPick: () => this.queue(sim, { kind: 'object', objectId: obj.id, interactionId: inter.id, label: inter.name, icon: inter.icon, userQueued: true }),
      });
    }
    options.push({ icon: 'ℹ️', label: 'About', onPick: () => this.panels.objectInfo(obj) });
    this.world.lotView.setHighlight(objId);
    showRadial(this.root, x, y, `${sim.name.split(' ')[0]} → ${def.name}`, options, () => this.world.lotView.setHighlight(null));
  }

  private simMenu(x: number, y: number, targetId: number) {
    const game = this.game!;
    const target = game.sim(targetId);
    const sel = this.selectedSim();
    if (!target) return;
    const options: RadialOption[] = [];
    if (sel && target.id === sel.id) {
      for (const s of Object.values(SELF_ACTIONS)) {
        options.push({
          icon: s.icon, label: s.name,
          onPick: () => s.ui === 'relationships' ? this.panels.invite(sel) : this.queue(sel, { kind: 'self', selfId: s.id, label: s.name, icon: s.icon, userQueued: true }),
        });
      }
      options.push({ icon: '🚶', label: 'Go out…', onPick: () => this.panels.outings(sel) });
      options.push({ icon: 'ℹ️', label: 'About', onPick: () => this.panels.simInfo(sel) });
      showRadial(this.root, x, y, sel.name.split(' ')[0], options);
      return;
    }
    if (game.isHousehold(target)) options.push({ icon: '👆', label: `Control ${target.name.split(' ')[0]}`, onPick: () => this.selectSim(target.id, false) });
    if (sel && sel.location === 'lot') {
      for (const { def, avail } of availableSocials(game, sel, target)) {
        options.push({
          icon: def.icon, label: def.name, disabled: !avail.ok, why: avail.reason,
          onPick: () => this.queue(sel, { kind: 'social', targetSimId: target.id, socialId: def.id, label: `${def.name} with ${target.name.split(' ')[0]}`, icon: def.icon, userQueued: true }),
        });
      }
    }
    if (target.isTownie) options.push({ icon: '👋', label: 'Say goodbye', onPick: () => { target.visitUntil = game.state.time; } });
    options.push({ icon: 'ℹ️', label: 'About', onPick: () => this.panels.simInfo(target) });
    showRadial(this.root, x, y, target.name, options);
  }
}
