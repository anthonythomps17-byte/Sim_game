// The app controller: screens (title, create-a-Sim, play), modes (live, buy, build), input routing,
// the main loop and saving. The simulation core never sees any of this.
import { Game } from '../sim/game';
import { createGame, randomAppearance, type NewGameOptions } from '../sim/newgame';
import { serialize, deserialize, SaveError } from '../sim/save';
import { checkInteraction } from '../sim/actions';
import { runCommand, type Cmd, type CmdResult, type Spend } from '../sim/commands';
import { availableSocials } from '../sim/social';
import { OBJECTS, OUTINGS, SELF_ACTIONS } from '../sim/defs';
import { scheduleNextVisit } from '../sim/schedule';
import { gameMinutesPerSecond } from '../sim/life';
import { label as petLabel, occupant, petActionsFor } from '../sim/pets';
import { activePlayer, canControl, familyOn, ownerOf } from '../sim/family';
import { GuestSession, HostSession, type Device, type OnlineSession } from '../net/online';
import { OnlineUi } from './online';
import { PhoneUi } from './phone';
import { randomCode } from '../net/relay';
import type { GameEvent, GameState, QueuedAction, Sim } from '../sim/types';
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
const PHONE_ONLY = new Set(['text', 'call', 'selfie', 'scroll', 'phone']);
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
  /** Playing on several devices (null when playing alone). */
  online: OnlineSession | null = null;
  /** Guest devices: messages already read here. */
  private readUpTo = 0;

  readonly hud: Hud;
  readonly panels: Panels;
  readonly menus: Menus;
  readonly buy: BuyMode;
  readonly build: BuildMode;
  readonly cas: CasScreen;
  readonly tutorial: Tutorial;
  readonly onlineUi: OnlineUi;
  readonly phone: PhoneUi;
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
    this.world.sky.onBurst = () => this.sound('firework');
    this.hud = new Hud(this);
    this.panels = new Panels(this);
    this.menus = new Menus(this);
    this.buy = new BuyMode(this);
    this.build = new BuildMode(this);
    this.cas = new CasScreen(this);
    this.tutorial = new Tutorial(this);
    this.onlineUi = new OnlineUi(this);
    this.phone = new PhoneUi(this);
    this.playLayer = h('div', { class: 'passthrough', style: 'position:absolute;inset:0' }, this.hud.el, this.buy.el, this.build.el, this.tutorial.el);
    document.title = GAME_TITLE;
    this.applySettings();

    // Audio can only start after a user gesture.
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false, passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.autosave(); });
    window.addEventListener('beforeunload', () => { if (this.online?.role === 'host') this.online.stop(); });
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
    const online = this.online;
    let speed: number;
    if (online?.role === 'guest') {
      // The host device runs the world; this device runs it forward between updates.
      speed = online.quiet ? 0 : online.rate;
      this.fastForward = speed > st.speed && speed > 0;
      if (speed > 0) game.tick(dt * speed * gameMinutesPerSecond(game.minuteOfDay));
      game.drainEvents();
    } else {
      speed = this.mode === 'live' && !this.pausedByMenu ? st.speed : 0;
      const members = game.household();
      // Skip ahead while everyone is out (and, if chosen in Settings, while everyone sleeps).
      const allAway = members.length > 0 && members.every((s) => s.location !== 'lot');
      const allAsleep = members.length > 0 && members.every((s) => s.location !== 'lot' || (s.current?.anim === 'sleep' && s.current.phase === 'perform'));
      this.fastForward = speed > 0 && (allAway || (this.settings.skipSleep && allAsleep));
      if (this.fastForward) speed *= 8;
      if (speed > 0) game.tick(dt * speed * gameMinutesPerSecond(game.minuteOfDay));
      this.flushEvents();
      online?.frame(dt, speed);
    }
    this.world.setSelected(st.selectedSimId);
    this.world.frame(dt, speed);
    this.hud.frame();
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.2; this.hud.refresh(); this.phone.checkCalls(); if (online) this.onlineUi.checkApprovals(); }
  }

  // ---------- Screens ----------

  async showTitle() {
    if (this.game) await this.autosave();
    this.stopOnline();
    this.screen = 'title';
    this.game = null;
    this.root.replaceChildren(this.menus.title);
    this.casView.setActive(false);
    this.casView.layout(window.innerWidth > 760 ? 'right' : 'top');
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
    if (!this.game || this.screen !== 'play' || this.online?.role === 'guest') return;
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

  // ---------- Playing on several devices ----------

  /** Share this game with the family's other devices. */
  startHosting(newCode = false): HostSession | null {
    if (!this.game || this.online?.role === 'guest') return null;
    if (this.online?.role === 'host') return this.online;
    if (newCode || !this.settings.hostCode) { this.settings.hostCode = randomCode(); this.applySettings(); }
    const host = new HostSession(this, this.settings.hostCode);
    host.onChange = () => { this.hud.refresh(); this.onlineUi.changed(); };
    this.online = host;
    return host;
  }

  stopOnline() {
    const o = this.online;
    if (!o) return;
    this.online = null;
    o.stop();
    this.onlineUi.changed();
  }

  /** Join the game running on another device. */
  joinGame(code: string, name: string): GuestSession {
    this.stopOnline();
    this.settings.joinCode = code;
    this.settings.deviceName = name;
    this.applySettings();
    const guest = new GuestSession(this, code, name, this.settings.lastPlayerId);
    guest.onChange = () => { if (this.screen === 'play') this.hud.refresh(); this.onlineUi.changed(); };
    this.online = guest;
    return guest;
  }

  /** The host let this device in: show its world. */
  enterGuestGame(state: GameState) {
    this.prepareRemote(state, null);
    this.enterPlay(new Game(state));
    this.onlineUi.closeJoin();
    const st = state;
    if (familyOn(st) && !st.family!.players.some((p) => p.id === this.settings.lastPlayerId)) this.panels.switchPlayer();
    else this.toast(`Joined the ${st.household.name} household.`, '📡');
  }

  /** Keep this device's own view of things (who's selected, who's playing, what's been read). */
  private prepareRemote(next: GameState, prev: GameState | null) {
    const me = this.online?.role === 'guest' ? this.online.playerId : null;
    if (next.family && me !== null && next.family.players.some((p) => p.id === me)) next.family.activeId = me;
    if (prev && next.sims.some((s) => s.id === prev.selectedSimId)) next.selectedSimId = prev.selectedSimId;
    else if (!prev) {
      const mine = next.household.memberIds.find((id) => next.family?.owners[id] === me);
      if (mine !== undefined) next.selectedSimId = mine;
    }
    for (const n of next.notifications) if (n.id <= this.readUpTo) n.read = true;
  }

  /** A world update from the host device. */
  applyRemoteState(state: GameState) {
    const game = this.game;
    if (!game || this.online?.role !== 'guest') return;
    this.prepareRemote(state, game.state);
    if (game.replaceState(state)) this.world.lotView.invalidate();
  }

  /** Messages and sounds from the host device. */
  remoteEvents(events: GameEvent[]) {
    if (!this.game) return;
    for (const e of events) {
      if (e.type === 'notify') { this.hud.toast(e.notification); if (e.notification.kind === 'bills') this.sound('notify'); }
      else if (e.type === 'sound') this.sound(e.sound);
      else if (e.type === 'openPanel') this.handleEvent(e);
    }
  }

  markRead() {
    for (const n of this.game?.state.notifications ?? []) this.readUpTo = Math.max(this.readUpTo, n.id);
  }

  joinRequest(dev: Device) { this.onlineUi.joinRequest(dev); }

  /** The connection to the other devices ended for good. */
  onlineEnded(why: string) {
    const o = this.online;
    if (!o) return;
    this.online = null;
    this.onlineUi.changed();
    if (o.role === 'guest') {
      this.onlineUi.closeJoin();
      if (this.screen === 'play') { this.game = null; void this.showTitle(); }
      this.panels.message('Family game', why);
    } else {
      this.panels.message('Playing on other devices stopped', `${why} Your game carries on here.`);
    }
  }

  // ---------- Commands ----------

  /**
   * Do something in the world. On a guest device it goes to the host device; otherwise it runs
   * here. In family mode, members spend from a weekly allowance and a money manager approves
   * anything bigger (or household decisions like bills and pets).
   */
  async act(cmd: Cmd, spend?: Spend): Promise<CmdResult> {
    const game = this.game;
    if (!game) return { ok: false };
    let res: CmdResult;
    const online = this.online;
    if (online?.role === 'guest') {
      res = await online.run(cmd, spend);
    } else if (online?.role === 'host') {
      res = online.run(cmd, spend, null, 'host');
    } else {
      res = runCommand(game, cmd, { spend });
      if (res.approval && spend) {
        const yes = await this.panels.approval(spend.what, spend.amount, res.approval.reason, res.approval.left);
        res = yes ? runCommand(game, cmd, { spend, approved: true }) : { ok: false };
      }
      this.flushEvents();
    }
    this.showResult(res);
    this.hud.refresh();
    return res;
  }

  private showResult(res: CmdResult) {
    if (res.toast) this.toast(res.toast.text, res.toast.icon);
    if (res.sound) this.sound(res.sound);
    if (res.pending) { this.toast('Asked a money manager. They can say yes on their device, or with their PIN from 🔔 Messages.', '📨'); this.sound('notify'); }
    else if (!res.ok && res.why) { this.toast(res.why, '🚫'); this.sound('error'); }
  }

  // ---------- Commands from the HUD ----------

  setSpeed(s: 0 | 1 | 2 | 3) {
    if (!this.game) return;
    this.sound('tap');
    if (this.online?.role === 'guest') this.game.state.speed = s; // show it straight away
    void this.act({ t: 'speed', speed: s });
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
    const owner = ownerOf(game.state, sim.id);
    if (owner && !canControl(game.state, sim)) this.toast(`${sim.name.split(' ')[0]} belongs to ${owner.name}. You can watch, but only ${owner.name} can give instructions.`, '👤');
    if (sim.location === 'work') this.toast(`${sim.name} is at work.`, '💼');
    else if (sim.location === 'away') this.toast(`${sim.name} is out and about.`, '🚶');
    this.sound('tap');
    this.hud.refresh();
  }

  cancel(simId: number, uid: number) {
    if (!this.game?.sim(simId)) return;
    void this.act({ t: 'cancel', simId, uid });
  }

  private queue(sim: Sim, action: Omit<QueuedAction, 'uid'>, spend?: Spend) {
    if (!this.game) return;
    if (!canControl(this.game.state, sim)) {
      const owner = ownerOf(this.game.state, sim.id);
      this.toast(`${sim.name.split(' ')[0]} is ${owner?.name}'s Sim. ${this.online?.role === 'guest' ? `Only ${owner?.name} can play them.` : `Switch to ${owner?.name} to play them.`}`, '👤');
      return;
    }
    if (sim.location !== 'lot') { this.toast(`${sim.name} isn't home right now.`, '🚶'); return; }
    void this.act({ t: 'queue', simId: sim.id, action: { ...action, userQueued: true } }, spend);
  }

  queueOuting(sim: Sim, id: string) {
    const o = OUTINGS[id];
    if (o.household) {
      const n = this.game!.household().filter((s) => s.location === 'lot').length;
      const total = (o.cost ?? 0) * n;
      this.panels.confirm(o.name.replace(/ \(.*\)$/, ''), `Everyone at home goes together. It costs £${total} in total. Jobs give you the time off.`, 'Book it! ✈️', () => {
        void this.act({ t: 'householdOuting', id }, { amount: total, what: 'a family holiday', household: true });
      });
      return;
    }
    this.queue(sim, { kind: 'outing', selfId: id, label: o.name, icon: o.icon, userQueued: true }, o.cost ? { amount: o.cost, what: o.name.replace(/ \(.*\)$/, '') } : undefined);
  }

  /** Hand the tablet to another player (or, on a guest device, choose who this device plays). */
  switchPlayer(id: number) {
    const st = this.game?.state;
    if (!st?.family) return;
    st.family.activeId = id;
    this.settings.lastPlayerId = id;
    this.applySettings();
    if (this.online?.role === 'guest') this.online.setPlayer(id);
    const me = activePlayer(st);
    const mine = this.game!.household().find((s) => ownerOf(st, s.id)?.id === id);
    if (mine) this.selectSim(mine.id, true);
    this.toast(`${me?.name} is playing now.`, '👤');
    this.hud.refresh();
  }

  invite(townieId: number) {
    void this.act({ t: 'invite', simId: townieId });
  }

  flushEvents() {
    if (!this.game) return;
    const events = this.game.drainEvents();
    if (this.online?.role === 'guest') return;
    for (const e of events) this.handleEvent(e);
    if (this.online?.role === 'host') this.online.events(events);
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
        if (this.online?.role === 'host' && this.online.routePanel(e)) break;
        const sim = this.game!.sim(e.simId);
        if (!sim) break;
        if (e.panel === 'careers') this.panels.careers(sim);
        if (e.panel === 'relationships') this.panels.invite(sim);
        if (e.panel === 'clothes') this.panels.clothes(sim);
        if (e.panel === 'party') this.panels.party(sim);
        if (e.panel === 'home') this.panels.home();
        if (e.panel === 'pets') this.panels.pets();
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
    if (hit.kind === 'pet') { this.petMenu(x, y, hit.id); return; }
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

  private petMenu(x: number, y: number, petId: number) {
    const game = this.game!;
    const pet = game.state.pets.find((p) => p.id === petId);
    const sel = this.selectedSim();
    if (!pet) return;
    const options: RadialOption[] = [];
    if (sel) {
      for (const { def, ok, why } of petActionsFor(game, sel, pet)) {
        options.push({ icon: def.icon, label: petLabel(def.name, pet) + (def.cost ? ` (£${def.cost})` : ''), disabled: !ok, why, onPick: () => this.queue(sel, { kind: 'pet', petId: pet.id, petAction: def.id, label: petLabel(def.name, pet), icon: def.icon, userQueued: true }, def.cost ? { amount: def.cost, what: `${def.name.toLowerCase()} for ${pet.name}` } : undefined) });
      }
      if (pet.species === 'dog') options.push({ icon: '🦮', label: `Walk ${pet.name}`, onPick: () => this.queueOuting(sel, 'dogwalk') });
    }
    options.push({ icon: '🐾', label: 'Pets', onPick: () => this.panels.pets() });
    showRadial(this.root, x, y, pet.name, options);
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
      const resident = occupant(game, obj);
      const name = resident ? petLabel(inter.name, resident) : inter.name;
      const fee = inter.special === 'plumber' ? 120 : inter.special === 'engineer' ? 250 : inter.special === 'service' ? 60 : 0;
      options.push({
        icon: inter.icon, label: name, disabled: !avail.ok, why: avail.reason,
        onPick: () => {
          this.queue(sim, { kind: 'object', objectId: obj.id, interactionId: inter.id, label: name, icon: inter.icon, userQueued: true }, fee ? { amount: fee, what: name.replace(/ \(.*\)$/, '').toLowerCase() } : undefined);
        },
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
        const hh = game.state.household;
        if (s.condition === 'dusty' && hh.dust < 15) continue;
        if (s.condition === 'weedy' && hh.weeds < 15) continue;
        if (PHONE_ONLY.has(s.id)) continue; // these live in the 📱 Phone
        options.push({
          icon: s.icon, label: s.name,
          onPick: () => s.ui === 'relationships' ? this.panels.invite(sel) : s.ui === 'party' ? this.panels.party(sel) : s.ui === 'pets' ? this.panels.pets() : this.queue(sel, { kind: 'self', selfId: s.id, label: s.name, icon: s.icon, userQueued: true }),
        });
      }
      options.push({ icon: '📱', label: 'Phone', onPick: () => this.phone.open(sel) });
      options.push({ icon: '🌳', label: 'Go for a walk', onPick: () => this.queueOuting(sel, 'walk') });
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
    if (target.isTownie) options.push({ icon: '👋', label: 'Say goodbye', onPick: () => { void this.act({ t: 'goodbye', simId: target.id }); } });
    options.push({ icon: 'ℹ️', label: 'About', onPick: () => this.panels.simInfo(target) });
    showRadial(this.root, x, y, target.name, options);
  }
}
