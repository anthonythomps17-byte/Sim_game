// Playing on several devices. One device (the host) runs the world and keeps the save. Other
// devices in the family join with a code, are let in by the host, and then:
//  - receive the world (in full once, then small updates every second),
//  - run it forward themselves between updates so Sims move smoothly,
//  - send everything their player does to the host as commands.
// Nothing goes anywhere except between your own devices, through the relay.
import type { App } from '../ui/app';
import type { Cmd, CmdResult, Spend } from '../sim/commands';
import { requestApproval, runCommand } from '../sim/commands';
import type { GameEvent, GameState } from '../sim/types';
import { apply, diff, snapshot, type Op } from './sync';
import { deviceId, RelayLink, type LinkState } from './relay';

const UPDATE_EVERY = 1; // seconds between world updates
const BEAT_EVERY = 2.5; // seconds between "still here" messages when nothing changed

type ToGuest =
  | { t: 'wait' }
  | { t: 'denied' }
  | { t: 'full'; seq: number; state: GameState; rate: number }
  | { t: 'diff'; seq: number; ops: Op[]; rate: number }
  | { t: 'beat'; seq: number; rate: number }
  | { t: 'result'; id: number; res: CmdResult }
  | { t: 'ev'; events: GameEvent[] }
  | { t: 'bye' };

type ToHost =
  | { t: 'hello'; name: string; playerId: number | null }
  | { t: 'player'; playerId: number | null }
  | { t: 'cmd'; id: number; cmd: Cmd; spend?: Spend }
  | { t: 'resync' };

export interface Device { peer: string; name: string; playerId: number | null; allowed: boolean; asking: boolean }

// ---------------------------------------------------------------------------------------------
// Host

export class HostSession {
  readonly role = 'host';
  readonly link: RelayLink;
  readonly devices = new Map<string, Device>();
  linkState: LinkState = 'connecting';
  private mirror: GameState | null = null;
  private seq = 0;
  private sinceUpdate = 0;
  private sinceSend = 0;
  private dirty = false;
  private rate = 0;
  /** Who last gave each Sim an instruction, so "go clothes shopping" opens on their device. */
  private commander = new Map<number, string>();
  /** Devices let in during this session (they reconnect quietly). */
  private welcomed = new Set<string>();
  onChange: () => void = () => {};

  constructor(private app: App, readonly code: string) {
    this.link = new RelayLink({
      room: code, role: 'host', peer: deviceId(),
      onMessage: (t) => this.onMessage(t),
      onState: (s, why) => {
        this.linkState = s;
        if (s === 'closed') app.onlineEnded(why ?? 'The connection closed.');
        this.onChange();
      },
    });
  }

  get guests(): Device[] { return [...this.devices.values()].filter((d) => d.allowed); }
  get asking(): Device[] { return [...this.devices.values()].filter((d) => d.asking); }

  private sendTo(msg: ToGuest, to: string | string[]) {
    if (Array.isArray(to) && !to.length) return;
    this.link.send(JSON.stringify(msg), to);
  }
  private sendAll(msg: ToGuest) { this.sendTo(msg, this.guests.map((g) => g.peer)); }

  private onMessage(text: string) {
    let msg: { sys?: string; peer?: string; guests?: string[]; from?: string; d?: ToHost };
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.sys === 'hello') {
      // (Re)connected to the relay: anyone it no longer has has gone.
      const live = new Set(msg.guests ?? []);
      for (const peer of [...this.devices.keys()]) if (!live.has(peer)) this.devices.delete(peer);
      this.onChange();
      return;
    }
    if (msg.sys === 'join' && msg.peer) {
      if (!this.devices.has(msg.peer)) this.devices.set(msg.peer, { peer: msg.peer, name: 'A device', playerId: null, allowed: false, asking: false });
      return;
    }
    if (msg.sys === 'leave' && msg.peer) {
      this.devices.delete(msg.peer);
      this.onChange();
      return;
    }
    const from = msg.from;
    const d = msg.d;
    if (!from || !d) return;
    let dev = this.devices.get(from);
    if (!dev) { dev = { peer: from, name: 'A device', playerId: null, allowed: false, asking: false }; this.devices.set(from, dev); }
    switch (d.t) {
      case 'hello': {
        dev.name = String(d.name || 'A device').slice(0, 24);
        dev.playerId = this.validPlayer(d.playerId);
        // Devices reconnect every so often (the relay limits how long a connection lasts).
        if (dev.allowed || this.welcomed.has(from)) { dev.allowed = true; dev.asking = false; this.sendFull(from); this.onChange(); return; }
        if (this.app.settings.trustedDevices[from]) { this.admit(dev); return; }
        dev.asking = true;
        this.sendTo({ t: 'wait' }, from);
        this.app.joinRequest(dev);
        this.onChange();
        return;
      }
      case 'player':
        dev.playerId = this.validPlayer(d.playerId);
        this.onChange();
        return;
      case 'resync':
        if (dev.allowed) this.sendFull(from);
        return;
      case 'cmd': {
        if (!dev.allowed || !d.cmd || typeof d.id !== 'number') return;
        const res = this.run(d.cmd, d.spend, dev.playerId, from);
        this.sendTo({ t: 'result', id: d.id, res }, from);
        return;
      }
    }
  }

  private validPlayer(id: unknown): number | null {
    const st = this.app.game?.state;
    return typeof id === 'number' && st?.family?.players.some((p) => p.id === id) ? id : null;
  }

  /** Run a command from any device (this one included). */
  run(cmd: Cmd, spend: Spend | undefined, playerId: number | null, from: string): CmdResult {
    const game = this.app.game;
    if (!game) return { ok: false };
    let res = runCommand(game, cmd, { playerId, spend });
    if (res.approval && spend) {
      const pid = playerId ?? game.state.family?.activeId ?? null;
      res = { ok: false, pending: requestApproval(game, cmd, spend, pid, res.approval.reason) };
    }
    if (res.ok && cmd.t === 'queue') this.commander.set(cmd.simId, from);
    this.app.flushEvents();
    this.dirty = true;
    return res;
  }

  admit(dev: Device, trust = true) {
    dev.allowed = true;
    dev.asking = false;
    this.welcomed.add(dev.peer);
    if (trust) { this.app.settings.trustedDevices[dev.peer] = dev.name; this.app.applySettings(); }
    this.sendFull(dev.peer);
    this.app.toast(`${dev.name} joined the game.`, '📡');
    this.app.sound('notify');
    this.onChange();
  }

  deny(dev: Device) {
    dev.asking = false;
    this.sendTo({ t: 'denied' }, dev.peer);
    this.devices.delete(dev.peer);
    this.onChange();
  }

  /** Bring everyone up to date first, then hand the newcomer the whole world. */
  private sendFull(peer: string) {
    if (!this.app.game) return;
    this.update(true);
    if (!this.mirror) this.mirror = snapshot(this.app.game.state);
    this.sendTo({ t: 'full', seq: this.seq, state: this.mirror, rate: this.rate }, peer);
  }

  /** Called every frame on the host after the world moves on. */
  frame(dt: number, rate: number) {
    this.rate = rate;
    this.sinceUpdate += dt;
    this.sinceSend += dt;
    if (this.dirty || this.sinceUpdate >= UPDATE_EVERY) this.update(false);
  }

  private update(force: boolean) {
    const game = this.app.game;
    this.sinceUpdate = 0;
    this.dirty = false;
    if (!game || !this.guests.length) { this.mirror = null; return; }
    if (!this.mirror) { if (!force) return; this.mirror = snapshot(game.state); return; }
    const ops = diff(this.mirror, game.state);
    if (ops.length) {
      this.mirror = apply(this.mirror, ops);
      this.seq++;
      this.sendAll({ t: 'diff', seq: this.seq, ops, rate: this.rate });
      this.sinceSend = 0;
    } else if (this.sinceSend >= BEAT_EVERY) {
      this.sendAll({ t: 'beat', seq: this.seq, rate: this.rate });
      this.sinceSend = 0;
    }
  }

  /** Share what just happened (messages, sounds) with the other devices. */
  events(events: GameEvent[]) {
    const out = events.filter((e) => e.type === 'notify' || e.type === 'sound');
    if (out.length && this.guests.length) this.sendAll({ t: 'ev', events: out });
  }

  /** Open a panel on the device whose player asked for it. True if it went to another device. */
  routePanel(e: Extract<GameEvent, { type: 'openPanel' }>): boolean {
    const peer = this.commander.get(e.simId);
    if (!peer || peer === 'host' || !this.devices.get(peer)?.allowed) return false;
    this.sendTo({ t: 'ev', events: [e] }, peer);
    return true;
  }

  noteLocalCommand(cmd: Cmd) { if (cmd.t === 'queue') this.commander.set(cmd.simId, 'host'); this.dirty = true; }
  markDirty() { this.dirty = true; }

  stop() {
    this.sendAll({ t: 'bye' });
    this.link.stop();
  }
}

// ---------------------------------------------------------------------------------------------
// Guest

export type GuestPhase = 'connecting' | 'waiting' | 'playing' | 'hostAway' | 'ended';

export class GuestSession {
  readonly role = 'guest';
  readonly link: RelayLink;
  phase: GuestPhase = 'connecting';
  linkState: LinkState = 'connecting';
  /** How fast the host's world is running (0 when paused there). */
  rate = 0;
  private base: GameState | null = null;
  private seq = 0;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: CmdResult) => void; timer: number }>();
  lastHeard = 0;
  onChange: () => void = () => {};

  constructor(private app: App, readonly code: string, public name: string, public playerId: number | null) {
    this.link = new RelayLink({
      room: code, role: 'guest', peer: deviceId(), noRoomRetryMs: 0,
      onMessage: (t) => this.onMessage(t),
      onState: (s, why) => {
        this.linkState = s;
        if (s === 'open') this.hello();
        if (s === 'closed') this.end(why ?? 'The connection closed.');
        this.onChange();
      },
    });
  }

  private send(msg: ToHost) { this.link.send(JSON.stringify(msg)); }
  private hello() { this.send({ t: 'hello', name: this.name, playerId: this.playerId }); }

  setPlayer(id: number | null) {
    this.playerId = id;
    this.send({ t: 'player', playerId: id });
  }

  /** The host hasn't been heard from for a while (its screen is off, or it's reconnecting). */
  get quiet(): boolean { return this.phase === 'hostAway' || (this.phase === 'playing' && performance.now() - this.lastHeard > 7000); }

  private onMessage(text: string) {
    let msg: ToGuest & { sys?: string };
    try { msg = JSON.parse(text); } catch { return; }
    this.lastHeard = performance.now();
    if (msg.sys === 'hostgone') { if (this.phase === 'playing') this.phase = 'hostAway'; this.onChange(); return; }
    if (msg.sys === 'hostback') { this.hello(); return; }
    switch (msg.t) {
      case 'wait': this.phase = 'waiting'; this.onChange(); return;
      case 'denied': this.end('The host device said no.'); return;
      case 'bye': this.end('The host device stopped the game.'); return;
      case 'full': {
        this.base = msg.state;
        this.seq = msg.seq;
        this.rate = msg.rate;
        // Once in, keep trying for a while if the host drops out, as it may just be reconnecting.
        this.link.opts.noRoomRetryMs = 3 * 60_000;
        const first = this.phase !== 'playing' && this.phase !== 'hostAway';
        this.phase = 'playing';
        if (first) this.app.enterGuestGame(structuredClone(this.base));
        else this.app.applyRemoteState(structuredClone(this.base));
        this.onChange();
        return;
      }
      case 'diff': {
        if (!this.base) return;
        if (msg.seq !== this.seq + 1) { this.send({ t: 'resync' }); return; }
        this.base = apply(this.base, msg.ops);
        this.seq = msg.seq;
        this.rate = msg.rate;
        if (this.phase === 'hostAway') { this.phase = 'playing'; this.onChange(); }
        this.app.applyRemoteState(structuredClone(this.base));
        return;
      }
      case 'beat':
        this.rate = msg.rate;
        if (msg.seq !== this.seq) this.send({ t: 'resync' });
        if (this.phase === 'hostAway') { this.phase = 'playing'; this.onChange(); }
        return;
      case 'result': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.resolve(msg.res);
        return;
      }
      case 'ev':
        this.app.remoteEvents(msg.events);
        return;
    }
  }

  /** Send a command to the host and wait for the answer. */
  run(cmd: Cmd, spend?: Spend): Promise<CmdResult> {
    if (!this.link.open || this.phase !== 'playing') return Promise.resolve({ ok: false, why: 'Not connected to the host device right now.' });
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => { this.pending.delete(id); resolve({ ok: false, why: 'The host device didn\'t answer.' }); }, 10_000);
      this.pending.set(id, { resolve, timer });
      this.send({ t: 'cmd', id, cmd, spend });
    });
  }

  private end(why: string) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.link.stop();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve({ ok: false }); }
    this.pending.clear();
    this.app.onlineEnded(why);
    this.onChange();
  }

  stop() {
    this.phase = 'ended';
    this.link.stop();
  }
}

export type OnlineSession = HostSession | GuestSession;
