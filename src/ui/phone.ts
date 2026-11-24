// The Sim's mobile phone: messages, calls, online shopping, the bank and the vet.
import { canControl } from '../sim/family';
import { billBreakdown } from '../sim/home';
import { petStatus, speciesOf, VET_COST } from '../sim/pets';
import { contacts, SERVICES, senderName, SHOP_ITEMS, TEXT_KINDS, unreadCount, type TextKind } from '../sim/phone';
import { findRel, friendshipLabel } from '../sim/relationships';
import { SELF_ACTIONS } from '../sim/defs';
import { activePlayer } from '../sim/family';
import type { PhoneMsg, Sim } from '../sim/types';
import type { App } from './app';
import { modal } from './panels';
import { clear, h, initials, money } from './dom';

type Screen = { s: 'home' } | { s: 'messages' } | { s: 'thread'; from: number | string } | { s: 'contacts' } | { s: 'shop' } | { s: 'bank' } | { s: 'vet' };

export class PhoneUi {
  private body: HTMLElement | null = null;
  private close: (() => void) | null = null;
  private simId = 0;
  private screen: Screen = { s: 'home' };
  private timer = 0;
  private sig = '';
  private ringing = new Map<string, () => void>();
  private prompted = new Set<string>();

  constructor(private app: App) {}

  private sim(): Sim | undefined { return this.app.game?.sim(this.simId); }

  open(sim: Sim, screen: Screen = { s: 'home' }) {
    this.simId = sim.id;
    this.screen = screen;
    this.body = h('div', { class: 'phone' });
    this.sig = '';
    this.render();
    this.close = modal(this.app.root, `📱 ${sim.name.split(' ')[0]}'s phone`, [this.body], [], () => {
      clearInterval(this.timer);
      this.body = null;
      this.close = null;
    });
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refresh(), 700);
  }

  private go(screen: Screen) { this.screen = screen; this.sig = ''; this.render(); }

  /** Redraw when something on the phone changed (a reply came in). */
  private refresh() {
    const sim = this.sim();
    if (!sim || !this.body) { this.close?.(); return; }
    const st = this.app.game!.state;
    const sig = `${sim.phone?.msgs.length ?? 0}:${sim.phone?.msgs.map((m) => m.offer?.answer ?? '').join('')}:${st.household.funds}:${st.deliveries?.length ?? 0}:${st.bills?.amount ?? 0}:${st.pets.map((p) => `${p.sickSince}${p.fleas}`).join()}`;
    if (sig !== this.sig) this.render();
  }

  private render() {
    const body = this.body;
    const sim = this.sim();
    if (!body || !sim) return;
    const st = this.app.game!.state;
    this.sig = `${sim.phone?.msgs.length ?? 0}:${sim.phone?.msgs.map((m) => m.offer?.answer ?? '').join('')}:${st.household.funds}:${st.deliveries?.length ?? 0}:${st.bills?.amount ?? 0}:${st.pets.map((p) => `${p.sickSince}${p.fleas}`).join()}`;
    clear(body);
    const m = this.app.game!.minuteOfDay;
    body.append(h('div', { class: 'ph-status' }, h('span', null, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`), h('span', null, '📶 🔋')));
    const screen = h('div', { class: 'ph-screen' });
    body.append(screen);
    switch (this.screen.s) {
      case 'home': this.home(screen, sim); break;
      case 'messages': this.messages(screen, sim); break;
      case 'thread': this.thread(screen, sim, this.screen.from); break;
      case 'contacts': this.contacts(screen, sim); break;
      case 'shop': this.shop(screen); break;
      case 'bank': this.bank(screen); break;
      case 'vet': this.vet(screen); break;
    }
  }

  private back(title: string, to: Screen = { s: 'home' }): HTMLElement {
    return h('div', { class: 'ph-bar' }, h('button', { class: 'btn small ghost', onclick: () => this.go(to) }, '‹ Back'), h('b', null, title));
  }

  private queueSelf(sim: Sim, id: string) {
    const def = SELF_ACTIONS[id];
    if (!def) return;
    this.close?.();
    void this.app.act({ t: 'queue', simId: sim.id, action: { kind: 'self', selfId: id, label: def.name, icon: def.icon, userQueued: true } }, def.cost ? { amount: def.cost, what: def.name.replace(/ \(.*\)$/, '').toLowerCase() } : undefined);
  }

  // ---------- Screens ----------

  private home(el: HTMLElement, sim: Sim) {
    const st = this.app.game!.state;
    const unread = unreadCount(sim);
    const app = (icon: string, label: string, onclick: () => void, badge = 0, disabled = false) =>
      h('button', { class: 'ph-app', onclick, disabled }, h('span', { class: 'ph-icon' }, icon, badge ? h('span', { class: 'badge' }, String(badge)) : null), h('span', null, label));
    const sickPets = st.pets.filter((p) => p.sickSince !== undefined || p.fleas).length;
    el.append(h('div', { class: 'ph-grid' },
      app('💬', 'Messages', () => this.go({ s: 'messages' }), unread),
      app('📞', 'Contacts', () => this.go({ s: 'contacts' })),
      app('🛒', 'Shop', () => this.go({ s: 'shop' }), st.deliveries?.length ?? 0),
      app('🏦', 'Bank', () => this.go({ s: 'bank' }), st.bills ? 1 : 0),
      st.pets.length ? app('🩺', 'Vet', () => this.go({ s: 'vet' }), sickPets) : null,
      app('🍕', 'Takeaway', () => this.queueSelf(sim, 'takeaway'), 0, sim.location !== 'lot'),
      app('🤳', 'Selfie', () => this.queueSelf(sim, 'selfie'), 0, sim.location !== 'lot'),
      app('📲', 'Social', () => this.queueSelf(sim, 'scroll'), 0, sim.location !== 'lot'),
      app('📅', 'Calendar', () => { this.close?.(); this.app.panels.calendar(); }),
    ));
    if (sim.location === 'work') el.append(h('p', { class: 'muted', style: 'text-align:center' }, 'At work: phones away! Messages will wait.'));
  }

  /** Conversations, newest first. */
  private messages(el: HTMLElement, sim: Sim) {
    el.append(this.back('Messages'));
    const msgs = sim.phone?.msgs ?? [];
    this.markRead(sim);
    const last = new Map<number | string, PhoneMsg>();
    for (const m of msgs) last.set(m.from, m);
    const threads = [...last.values()].sort((a, b) => b.time - a.time);
    if (!threads.length) el.append(h('p', { class: 'muted' }, 'No messages yet. Text a friend from Contacts!'));
    for (const m of threads) {
      const waiting = msgs.some((x) => x.from === m.from && x.offer && !x.offer.answer);
      el.append(h('button', { class: 'ph-row', onclick: () => this.go({ s: 'thread', from: m.from }) },
        this.avatar(m.from),
        h('div', { class: 'grow' }, h('div', { class: 't' }, senderName(this.app.game!, m.from)), h('div', { class: 's' }, `${m.out ? 'You: ' : ''}${m.text}`)),
        waiting ? h('span', { class: 'chip bad' }, 'Reply!') : h('span', { class: 's' }, this.when(m.time))));
    }
    el.append(h('button', { class: 'btn primary', style: 'width:100%;margin-top:8px', onclick: () => this.go({ s: 'contacts' }) }, '✏️ New message'));
  }

  private thread(el: HTMLElement, sim: Sim, from: number | string) {
    const game = this.app.game!;
    el.append(this.back(senderName(game, from), { s: 'messages' }));
    this.markRead(sim);
    const list = h('div', { class: 'ph-thread' });
    for (const m of (sim.phone?.msgs ?? []).filter((x) => x.from === from)) {
      const bubble = h('div', { class: `ph-bubble ${m.out ? 'out' : 'in'}` }, m.text, h('small', null, this.when(m.time)));
      list.append(bubble);
      const o = m.offer;
      if (!o) continue;
      if (o.answer) list.append(h('div', { class: 'ph-note' }, o.answer === 'yes' ? '✔ You said yes' : o.until < game.state.time ? 'Expired' : '✖ You said no'));
      else if (o.kind === 'bills') {
        const bills = game.state.bills;
        if (bills) list.append(h('div', { class: 'ph-offer' }, h('button', { class: 'btn small primary', onclick: () => { void this.app.act({ t: 'payBills' }, { amount: bills.amount, what: 'the bills', household: true }); } }, `Pay ${money(bills.amount)}`)));
      } else {
        const yes = o.kind === 'visit' ? 'Yes, come over' : o.kind === 'walk' ? 'Yes, go for a walk' : `Yes (+${money(o.pay ?? 0)})`;
        list.append(h('div', { class: 'ph-offer' },
          h('button', { class: 'btn small ghost', onclick: () => void this.app.act({ t: 'offer', simId: sim.id, msgId: m.id, yes: false }) }, 'No thanks'),
          h('button', { class: 'btn small primary', onclick: () => void this.app.act({ t: 'offer', simId: sim.id, msgId: m.id, yes: true }) }, yes)));
      }
    }
    el.append(list);
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    if (typeof from !== 'number') return;
    const st = game.state;
    const kinds = (Object.keys(TEXT_KINDS) as TextKind[]).filter((k) => k !== 'flirt' || st.settings.romance);
    el.append(h('div', { class: 'ph-compose' },
      ...kinds.map((k) => h('button', { class: 'opt', onclick: () => this.text(sim, from, k) }, `${TEXT_KINDS[k].icon} ${TEXT_KINDS[k].label}`)),
      h('button', { class: 'opt', onclick: () => this.call(sim, from) }, '📞 Call')));
  }

  private contacts(el: HTMLElement, sim: Sim) {
    const game = this.app.game!;
    el.append(this.back('Contacts'));
    const people = contacts(game, sim);
    if (!people.length) el.append(h('p', { class: 'muted' }, 'No numbers yet. Meet the neighbours first: invite someone over, or say hi when they visit.'));
    for (const p of people) {
      const rel = findRel(game.state, sim.id, p.id);
      el.append(h('div', { class: 'ph-row' }, this.avatar(p.id),
        h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, `${friendshipLabel(rel?.friendship ?? 0)}${p.location === 'lot' ? ' · here now' : ''}`)),
        h('button', { class: 'btn small', 'aria-label': `Text ${p.name}`, onclick: () => this.go({ s: 'thread', from: p.id }) }, '💬'),
        h('button', { class: 'btn small', 'aria-label': `Call ${p.name}`, onclick: () => this.call(sim, p.id) }, '📞')));
    }
  }

  private shop(el: HTMLElement) {
    const st = this.app.game!.state;
    el.append(this.back('Shop'));
    for (const [id, it] of Object.entries(SHOP_ITEMS)) {
      el.append(h('div', { class: 'ph-row' }, h('span', { class: 'ph-av' }, it.icon),
        h('div', { class: 'grow' }, h('div', { class: 't' }, it.name), h('div', { class: 's' }, it.desc)),
        h('button', { class: 'btn small primary', disabled: st.household.funds < it.price, onclick: () => void this.app.act({ t: 'order', item: id }, { amount: it.price, what: it.name.toLowerCase() }) }, money(it.price))));
    }
    const coming = st.deliveries ?? [];
    if (coming.length) {
      el.append(h('div', { class: 'opt-label' }, 'On the way'), ...coming.map((d) => h('div', { class: 's' }, `🚚 ${SHOP_ITEMS[d.item]?.name ?? d.item}: arriving in about ${Math.max(1, Math.round((d.at - st.time) / 60))}h`)));
    }
    el.append(h('p', { class: 'muted' }, `In the cupboard: 🛒 ${st.household.groceries} food · 🦴 ${st.household.petFood} pet food · 🍪 ${st.household.petTreats ?? 0} treats`));
  }

  private bank(el: HTMLElement) {
    const game = this.app.game!;
    const st = game.state;
    el.append(this.back('Bank'));
    el.append(h('div', { class: 'ph-balance' }, h('small', null, 'Balance'), money(st.household.funds)));
    const me = activePlayer(st);
    if (me?.role === 'member') el.append(h('p', { class: 'muted' }, `${me.name}'s allowance left this week: ${money(Math.max(0, me.allowance - me.spent))}`));
    if (st.bills) {
      const bills = st.bills;
      el.append(h('div', { class: 'card on' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `Bills due: ${money(bills.amount)}`), h('div', { class: 's' }, 'Pay within 3 days to avoid a late fee.')),
        h('button', { class: 'btn small primary', onclick: () => void this.app.act({ t: 'payBills' }, { amount: bills.amount, what: 'the bills', household: true }) }, 'Pay'))));
    } else el.append(h('p', { class: 'muted' }, 'No bills to pay right now. 👍'));
    const b = billBreakdown(game);
    el.append(h('div', { class: 'opt-label' }, 'Next weekly bill'), h('div', { class: 's' }, `🏠 ${money(b.home)} · ⚡ ${money(b.energy)} · 📺 ${money(b.subscriptions)}${b.pets ? ` · 🐾 ${money(b.pets)}` : ''} = ${money(b.total)}`));
  }

  private vet(el: HTMLElement) {
    const st = this.app.game!.state;
    el.append(this.back('Ashton Vets'));
    el.append(h('p', { class: 'muted' }, `A home visit costs ${money(VET_COST)}. The vet treats poorly pets and fleas.`));
    for (const pet of st.pets) {
      const status = petStatus(pet);
      el.append(h('div', { class: 'ph-row' }, h('span', { class: 'ph-av' }, speciesOf(pet).icon),
        h('div', { class: 'grow' }, h('div', { class: 't' }, pet.name), h('div', { class: 's' }, status.length ? status.join(' · ') : '💚 Healthy')),
        h('button', { class: `btn small ${status.some((x) => !x.startsWith('💩')) ? 'primary' : ''}`, disabled: st.household.funds < VET_COST, onclick: () => void this.app.act({ t: 'vet', petId: pet.id }, { amount: VET_COST, what: `the vet for ${pet.name}` }) }, 'Book')));
    }
  }

  // ---------- Actions ----------

  private text(sim: Sim, to: number, kind: TextKind) {
    void this.app.act({ t: 'text', simId: sim.id, to, kind }).then(() => this.render());
  }

  private call(sim: Sim, to: number) {
    void this.app.act({ t: 'call', simId: sim.id, to }).then((r) => { if (r.ok) this.close?.(); });
  }

  private markRead(sim: Sim) {
    if (unreadCount(sim) > 0) void this.app.act({ t: 'readPhone', simId: sim.id });
  }

  private avatar(from: number | string): HTMLElement {
    const game = this.app.game!;
    if (typeof from === 'number') {
      const p = game.sim(from);
      return h('span', { class: 'ph-av', style: `background:${p?.appearance.topColor ?? '#ccc'};color:white` }, initials(p?.name ?? '?'));
    }
    return h('span', { class: 'ph-av' }, SERVICES[from]?.icon ?? '📨');
  }

  private when(time: number): string {
    const now = this.app.game!.state.time;
    const mins = now - time;
    if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
    if (mins < 1440) return `${Math.round(mins / 60)}h`;
    return `${Math.round(mins / 1440)}d`;
  }

  // ---------- Incoming calls ----------

  /** Ring on the device of whoever plays the Sim being called. */
  checkCalls() {
    const game = this.app.game;
    if (!game || this.app.screen !== 'play') return;
    const st = game.state;
    const live = new Set<string>();
    for (const sim of game.household()) {
      const call = sim.call;
      if (!call || !canControl(st, sim)) continue;
      const key = `${sim.id}:${call.until}`;
      live.add(key);
      if (this.prompted.has(key)) continue;
      this.prompted.add(key);
      const caller = game.sim(call.from);
      let close = () => {};
      close = modal(this.app.root, '📞 Incoming call', [
        h('p', { style: 'font-size:18px;text-align:center' }, h('b', null, caller?.name ?? 'Someone'), ` is calling ${sim.name.split(' ')[0]}!`),
      ], [
        h('button', { class: 'btn ghost', onclick: () => { close(); void this.app.act({ t: 'answerCall', simId: sim.id, yes: false }); } }, '📵 Decline'),
        h('button', { class: 'btn primary', onclick: () => { close(); void this.app.act({ t: 'answerCall', simId: sim.id, yes: true }); } }, '📞 Answer'),
      ], () => this.ringing.delete(key));
      this.ringing.set(key, close);
      this.app.sound('phone');
    }
    // Stop ringing when the call was answered elsewhere or rang out.
    for (const [key, close] of [...this.ringing]) if (!live.has(key)) { this.ringing.delete(key); close(); }
  }
}
