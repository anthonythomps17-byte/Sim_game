// Screens for playing on several devices: share a game, join one, let devices in, and answer
// spending requests from other players.
import { activePlayer, familyOn, managers } from '../sim/family';
import type { Approval } from '../sim/types';
import type { Device, GuestSession, HostSession } from '../net/online';
import { cleanCode } from '../net/relay';
import type { App } from './app';
import { modal } from './panels';
import { clear, h, money } from './dom';

export class OnlineUi {
  private hostBody: HTMLElement | null = null;
  private closeHost: (() => void) | null = null;
  private joinBody: HTMLElement | null = null;
  private closeJoinModal: (() => void) | null = null;
  private asked = new Set<string>();
  private prompted = new Set<number>();

  constructor(private app: App) {}

  /** Something about the connection changed: redraw whatever is open. */
  changed() {
    if (this.hostBody) this.renderHost();
    if (this.joinBody) this.renderJoin();
  }

  // ---------- Host ----------

  hostPanel() {
    const app = this.app;
    if (app.online?.role === 'guest') { this.guestPanel(); return; }
    this.hostBody = h('div');
    this.renderHost();
    this.closeHost = modal(app.root, '📡 Play on other devices', [this.hostBody], [], () => { this.hostBody = null; this.closeHost = null; });
  }

  private renderHost() {
    const body = this.hostBody;
    if (!body) return;
    const app = this.app;
    clear(body);
    const host = app.online?.role === 'host' ? app.online : null;
    if (!host) {
      body.append(...[
        h('p', null, 'Let the family play this household together, each on their own phone or tablet.'),
        h('ul', { class: 'muted', style: 'padding-left:18px;margin:6px 0 10px' },
          h('li', null, 'This device runs the world and keeps the save, so keep the game open here.'),
          h('li', null, 'Other devices join with a code, and you let each one in.'),
          h('li', null, 'Only your devices can join. No accounts, no chat, nothing public.'),
          h('li', null, familyOn(app.game!.state) ? 'Each device picks which family player it is.' : 'Tip: set up Family players first so everyone gets their own Sims and allowance.')),
        h('button', { class: 'btn primary', style: 'width:100%', onclick: () => { app.startHosting(); this.renderHost(); } }, '📡 Start sharing'),
        familyOn(app.game!.state) ? null : h('button', { class: 'btn', style: 'width:100%;margin-top:8px', onclick: () => { this.closeHost?.(); app.panels.family(); } }, '👨‍👩‍👧 Set up Family players'),
      ].filter((x) => x !== null));
      return;
    }
    const status = host.linkState === 'open' ? 'Ready for other devices to join' : host.linkState === 'retrying' ? 'Reconnecting…' : 'Connecting…';
    body.append(
      h('p', { class: 'muted', style: 'margin-bottom:4px' }, 'On the other device, open My Life and tap “Join a family game”, then type:'),
      h('div', { class: 'join-code', 'aria-label': 'Game code' }, host.code),
      h('p', { class: 'muted', style: 'text-align:center;margin-top:4px' }, `${host.linkState === 'open' ? '🟢' : '🟡'} ${status}`),
    );
    for (const d of host.asking) {
      body.append(h('div', { class: 'card on' }, h('div', { class: 'row' }, h('span', { style: 'font-size:24px' }, '📱'),
        h('div', { class: 'grow' }, h('div', { class: 't' }, d.name), h('div', { class: 's' }, 'Wants to join')),
        h('button', { class: 'btn small ghost', onclick: () => host.deny(d) }, 'No'),
        h('button', { class: 'btn small primary', onclick: () => host.admit(d) }, 'Let in'))));
    }
    const st = app.game!.state;
    const guests = host.guests;
    body.append(h('div', { class: 'opt-label' }, `Playing now (${guests.length + 1})`),
      h('div', { class: 'row' }, h('span', { style: 'font-size:22px' }, '⭐'), h('div', { class: 'grow' }, h('div', { class: 't' }, 'This device (host)'), h('div', { class: 's' }, activePlayer(st)?.name ?? ''))),
      ...guests.map((g) => h('div', { class: 'row' }, h('span', { style: 'font-size:22px' }, '📱'),
        h('div', { class: 'grow' }, h('div', { class: 't' }, g.name), h('div', { class: 's' }, st.family?.players.find((p) => p.id === g.playerId)?.name ?? (familyOn(st) ? 'Choosing a player…' : ''))))));
    const trusted = Object.entries(app.settings.trustedDevices);
    if (trusted.length) {
      body.append(h('div', { class: 'opt-label' }, 'Devices let in before (they join straight away)'),
        ...trusted.map(([id, name]) => h('div', { class: 'row' }, h('div', { class: 'grow' }, name),
          h('button', { class: 'btn small ghost', onclick: () => { delete app.settings.trustedDevices[id]; app.applySettings(); this.renderHost(); } }, 'Forget'))));
    }
    body.append(h('div', { class: 'row', style: 'margin-top:10px;gap:8px' },
      h('button', { class: 'btn', style: 'flex:1', onclick: () => { app.stopOnline(); app.startHosting(true); this.renderHost(); } }, '🔄 New code'),
      h('button', { class: 'btn', style: 'flex:1', onclick: () => app.panels.confirm('Stop sharing?', 'The other devices will leave the game. Your game carries on here.', 'Stop', () => { app.stopOnline(); this.renderHost(); }) }, '⏹ Stop sharing')));
  }

  /** A device asked to join: ask the host. */
  joinRequest(dev: Device) {
    if (this.hostBody) { this.renderHost(); this.app.sound('notify'); return; }
    if (this.asked.has(dev.peer)) return;
    this.asked.add(dev.peer);
    const host = this.app.online as HostSession;
    let close = () => {};
    close = modal(this.app.root, '📱 Someone wants to join', [
      h('p', null, `“${dev.name}” wants to join your game. Only let in devices you know.`),
    ], [
      h('button', { class: 'btn ghost', onclick: () => { close(); if (dev.asking) host.deny(dev); } }, 'No'),
      h('button', { class: 'btn primary', onclick: () => { close(); if (dev.asking) host.admit(dev); } }, 'Let them in'),
    ], () => this.asked.delete(dev.peer));
    this.app.sound('notify');
  }

  // ---------- Guest ----------

  /** From the title screen: join a game running on another device. */
  joinPanel() {
    const app = this.app;
    const s = app.settings;
    const codeIn = h('input', { type: 'text', value: s.joinCode, maxlength: 7, placeholder: 'ABC123', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Game code', class: 'code-input' }) as HTMLInputElement;
    codeIn.addEventListener('input', () => { codeIn.value = cleanCode(codeIn.value); });
    const nameIn = h('input', { type: 'text', value: s.deviceName, maxlength: 20, placeholder: "e.g. Ella's phone", 'aria-label': 'This device’s name' }) as HTMLInputElement;
    this.joinBody = h('div');
    const form = h('div', null,
      h('p', { class: 'muted' }, 'On the device that has the game, open the menu ☰ → 📡 Play on other devices to see the code.'),
      h('div', { class: 'opt-label' }, 'Game code'), codeIn,
      h('div', { class: 'opt-label' }, 'Name this device'), nameIn,
      this.joinBody);
    this.closeJoinModal = modal(app.root, '📡 Join a family game', [form], [
      h('button', { class: 'btn ghost', onclick: () => { app.stopOnline(); this.closeJoin(); } }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => {
        const code = cleanCode(codeIn.value);
        const name = nameIn.value.trim() || 'Phone';
        if (code.length !== 6) { app.toast('The code has 6 letters and numbers.', '📡'); return; }
        app.joinGame(code, name);
        this.renderJoin();
      } }, 'Join'),
    ], () => { this.joinBody = null; this.closeJoinModal = null; if (app.online?.role === 'guest' && app.screen !== 'play') app.stopOnline(); });
  }

  private renderJoin() {
    const body = this.joinBody;
    if (!body) return;
    clear(body);
    const g = this.app.online?.role === 'guest' ? this.app.online : null;
    if (!g) return;
    const text = g.phase === 'waiting' ? '⏳ Waiting for the host device to let you in…'
      : g.linkState === 'retrying' ? '🟡 Trying to connect…' : '🟡 Connecting…';
    body.append(h('p', { class: 'chip', style: 'margin-top:12px' }, text));
  }

  closeJoin() {
    const c = this.closeJoinModal;
    this.closeJoinModal = null;
    this.joinBody = null;
    c?.();
  }

  guestPanel() {
    const app = this.app;
    const g = app.online as GuestSession;
    let close = () => {};
    close = modal(app.root, '📡 Family game', [
      h('p', null, `Connected to game ${g.code} as “${g.name}”.`),
      h('p', { class: 'muted' }, 'The host device runs the world and keeps the save. If it goes to sleep, everything pauses until it wakes up.'),
    ], [
      h('button', { class: 'btn', onclick: () => { close(); app.panels.switchPlayer(); } }, '👤 Change player'),
      h('button', { class: 'btn', onclick: () => { close(); this.leave(); } }, '🚪 Leave'),
    ]);
  }

  leave() {
    const app = this.app;
    app.panels.confirm('Leave the family game?', 'You can join again any time with the same code.', 'Leave', () => { app.stopOnline(); app.game = null; void app.showTitle(); });
  }

  // ---------- Spending requests ----------

  private mine(a: Approval): boolean { return activePlayer(this.app.game!.state)?.id === a.playerId; }

  /** Money managers get asked straight away when someone on another device wants to spend. */
  checkApprovals() {
    const st = this.app.game?.state;
    if (!st?.approvals?.length) return;
    const me = activePlayer(st);
    if (me?.role !== 'manager') return;
    for (const a of st.approvals) {
      if (this.prompted.has(a.id) || a.playerId === me.id) continue;
      this.prompted.add(a.id);
      this.prompt(a);
    }
  }

  private who(a: Approval): string {
    return this.app.game?.state.family?.players.find((p) => p.id === a.playerId)?.name ?? 'Someone';
  }

  private prompt(a: Approval) {
    const app = this.app;
    let close = () => {};
    close = modal(app.root, '📨 Can I?', [
      h('p', null, `${this.who(a)} would like ${a.what}${a.amount ? ` (${money(a.amount)})` : ''}.`),
      h('p', { class: 'muted' }, a.reason === 'managerOnly' ? 'This is a household decision.' : `It's more than their allowance has left this week.`),
    ], [
      h('button', { class: 'btn ghost', onclick: () => { close(); void app.act({ t: 'approve', id: a.id, yes: false }); } }, '🙅 No'),
      h('button', { class: 'btn primary', onclick: () => { close(); void app.act({ t: 'approve', id: a.id, yes: true }); } }, '👍 Yes'),
    ]);
    app.sound('notify');
  }

  /** Waiting requests, for the Messages panel. */
  approvalCards(closePanel: () => void): HTMLElement[] {
    const app = this.app;
    const st = app.game?.state;
    if (!st?.approvals?.length) return [];
    const me = activePlayer(st);
    const needPin = managers(st).some((m) => m.pin);
    return st.approvals.map((a) => {
      const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: 'PIN', 'aria-label': 'Money manager PIN', style: 'width:80px' }) as HTMLInputElement;
      const answer = (yes: boolean) => { closePanel(); void app.act({ t: 'approve', id: a.id, yes, pin: pin.value || undefined }); };
      const buttons = me?.role === 'manager'
        ? [h('button', { class: 'btn small ghost', onclick: () => answer(false) }, 'No'), h('button', { class: 'btn small primary', onclick: () => answer(true) }, 'Yes')]
        : this.mine(a)
          ? [needPin ? pin : null, needPin ? h('button', { class: 'btn small primary', onclick: () => answer(true) }, 'Approve') : null, h('button', { class: 'btn small ghost', onclick: () => answer(false) }, 'Withdraw')]
          : [needPin ? pin : null, needPin ? h('button', { class: 'btn small primary', onclick: () => answer(true) }, 'Approve') : null];
      return h('div', { class: 'card on' }, h('div', { class: 'row' }, h('span', { style: 'font-size:24px' }, '📨'),
        h('div', { class: 'grow' }, h('div', { class: 't' }, `${this.who(a)}: ${a.what}`), h('div', { class: 's' }, `${a.amount ? money(a.amount) + ' · ' : ''}Waiting for a money manager`)),
        ...buttons));
    });
  }
}
