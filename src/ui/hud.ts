// Heads-up display for live mode: money, clock and speed, Sim portraits, needs, queue, toasts, bubbles.
import { ASPIRATIONS, CAREERS, MOODLETS, NEEDS } from '../sim/defs';
import { DAY_NAMES } from '../sim/game';
import { moodLabel, moodScore } from '../sim/mood';
import { friendshipLabel, relationshipsOf, romanceLabel } from '../sim/relationships';
import { condMet, missingForPromotion } from '../sim/schedule';
import { SKILL_NAMES, skillLevel, skillProgress } from '../sim/skills';
import { NEED_IDS, SKILL_IDS, type GameNotification, type Sim } from '../sim/types';
import type { App } from './app';
import { calendarOf, eventsOn, PARTY_THEMES } from '../sim/life';
import { neighbourFace } from './panels';
import { activePlayer, ownerOf } from '../sim/family';
import { clothesLabel } from '../sim/clothes';
import { unreadCount } from '../sim/phone';
import { bar, clear, h, initials, money } from './dom';

type Tab = 'needs' | 'skills' | 'career' | 'people' | 'goals';

export class Hud {
  el: HTMLElement;
  private fundsEl!: HTMLElement;
  private foodEl!: HTMLElement;
  private homeBadge!: HTMLElement;
  private playerBtn!: HTMLElement;
  private onlineBtn!: HTMLElement;
  private onlineBanner!: HTMLElement;
  private topEl!: HTMLElement;
  private topBottom = 0;
  private partyEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private ffEl!: HTMLElement;
  private bellBadge!: HTMLElement;
  private portraitsEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private queueEl!: HTMLElement;
  private toastsEl!: HTMLElement;
  private bubblesEl!: HTMLElement;
  private modeBtns: Record<string, HTMLElement> = {};
  private wallBtn!: HTMLElement;
  private walkBtn!: HTMLElement;
  private tab: Tab = 'needs';
  private collapsed = false;
  private sigs = new Map<string, string>();
  private bubbles = new Map<number, { b: HTMLElement; n: HTMLElement }>();

  constructor(private app: App) {
    this.el = h('div', { class: 'passthrough', style: 'position:absolute;inset:0' });
    this.build();
  }

  private build() {
    const app = this.app;
    this.bubblesEl = h('div', { class: 'bubbles' });
    this.fundsEl = h('div', { class: 'funds' });
    this.foodEl = h('div', { class: 'food', title: 'Food in the fridge' });
    this.partyEl = h('div', { class: 'panel partybar', style: 'display:none' });
    this.timeEl = h('button', { class: 'time', title: 'Calendar', onclick: () => app.panels.calendar() });
    const speeds: [string, 0 | 1 | 2 | 3][] = [['❚❚', 0], ['▶', 1], ['▶▶', 2], ['▶▶▶', 3]];
    this.speedBtns = speeds.map(([label, s]) => h('button', { class: 'speed', 'aria-label': s === 0 ? 'Pause' : `Speed ${s}`, onclick: () => app.setSpeed(s) }, label) as HTMLButtonElement);
    this.ffEl = h('span', { class: 'ff' });
    this.bellBadge = h('span', { class: 'badge' });
    const bell = h('button', { class: 'btn icon-btn round rel', 'aria-label': 'Messages', onclick: () => app.panels.notifications() }, '🔔', this.bellBadge);
    const menu = h('button', { class: 'btn icon-btn round', 'aria-label': 'Menu', onclick: () => app.menus.pauseMenu() }, '☰');
    this.homeBadge = h('span', { class: 'badge' });
    const home = h('button', { class: 'btn icon-btn round rel', 'aria-label': 'Home and bills', onclick: () => app.panels.home() }, '🏠', this.homeBadge);
    const top = this.topEl = h('div', { class: 'topbar' },
      h('div', { class: 'panel money' }, this.fundsEl, this.foodEl),
      h('div', { class: 'panel clock' }, this.timeEl, ...this.speedBtns, this.ffEl),
      h('div', { class: 'top-right' }, this.onlineBtn = h('button', { class: 'btn icon-btn round rel online-chip', 'aria-label': 'Playing on other devices', onclick: () => app.onlineUi.hostPanel() }), this.playerBtn = h('button', { class: 'btn player-chip', 'aria-label': 'Switch player', onclick: () => app.panels.switchPlayer() }), home, bell, menu),
    );
    this.portraitsEl = h('div', { class: 'portraits' });
    this.panelEl = h('div', { class: 'panel simpanel' });
    this.queueEl = h('div', { class: 'panel queue' });
    const modes = h('div', { class: 'panel modes' },
      ...(['live', 'buy', 'build'] as const).map((m) => {
        const b = h('button', { class: 'mode', 'aria-label': `${m} mode`, onclick: () => app.setMode(m) },
          m === 'live' ? '🙂' : m === 'buy' ? '🛋️' : '🔨', h('small', null, m === 'live' ? 'Live' : m === 'buy' ? 'Buy' : 'Build'));
        this.modeBtns[m] = b;
        return b;
      }));
    this.wallBtn = h('button', { class: 'btn', title: 'Walls up / cutaway / down', onclick: () => app.cycleWalls() });
    const camtools = h('div', { class: 'camtools' },
      this.wallBtn,
      this.walkBtn = h('button', { class: 'btn walk-btn', 'aria-label': 'Walk mode (joystick)', title: 'Walk mode: steer your Sim', onclick: () => app.walk.toggle() }, '🕹️'),
      h('button', { class: 'btn', 'aria-label': 'Rotate left', onclick: () => app.world.cam.rotateBy(Math.PI / 4) }, '⟲'),
      h('button', { class: 'btn', 'aria-label': 'Rotate right', onclick: () => app.world.cam.rotateBy(-Math.PI / 4) }, '⟳'),
      h('button', { class: 'btn', 'aria-label': 'Tilt', onclick: () => app.world.cam.tiltBy(app.world.cam.beta > 0.8 ? -0.5 : 0.5) }, '⤢'),
    );
    const modebar = h('div', { class: 'modebar' }, camtools, modes);
    this.toastsEl = h('div', { class: 'toasts' });
    this.onlineBanner = h('div', { class: 'panel online-banner', style: 'display:none' });
    this.el.append(this.bubblesEl, top, this.onlineBanner, this.partyEl, this.portraitsEl, this.panelEl, this.queueEl, modebar, this.toastsEl);
  }

  setMode(mode: string) {
    for (const [m, b] of Object.entries(this.modeBtns)) b.classList.toggle('on', m === mode);
    const live = mode === 'live';
    this.panelEl.style.display = live ? '' : 'none';
    this.queueEl.style.display = live ? '' : 'none';
    this.portraitsEl.style.display = live ? '' : 'none';
    this.bubblesEl.style.display = live ? '' : 'none';
  }

  setWalk(on: boolean) {
    this.walkBtn.classList.toggle('on', on);
    this.el.classList.toggle('walking', on);
    if (on && window.innerWidth <= 760) { this.collapsed = true; this.sigs.clear(); this.refresh(); }
  }

  setWallLabel(mode: string) {
    this.wallBtn.textContent = mode === 'up' ? '🧱 Up' : mode === 'down' ? '🧱 Down' : '🧱 Cut';
  }

  openTab(tab: Tab) { this.tab = tab; this.collapsed = false; this.sigs.clear(); this.refresh(); }

  // ---------- Slow refresh (a few times a second) ----------

  refresh() {
    const game = this.app.game;
    if (!game) return;
    const st = game.state;
    const funds = money(st.household.funds);
    this.fundsEl.textContent = '💷 ' + funds;
    this.fundsEl.classList.toggle('neg', st.household.funds < 0);
    const m = game.minuteOfDay;
    const hh = Math.floor(m / 60), mm = Math.floor(m % 60);
    const hour12 = ((hh + 11) % 12) + 1;
    clear(this.timeEl);
    const cal = calendarOf(game.day);
    const ev = eventsOn(game.day).map((e) => e.icon).join('');
    this.timeEl.append(`${hour12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`, h('small', null, `${DAY_NAMES[game.weekday].slice(0, 3)} · ${cal.season.icon} ${cal.season.name} ${cal.dayOfSeason} ${ev}`));
    const online = this.app.online;
    this.onlineBtn.style.display = online ? '' : 'none';
    let banner = '';
    if (online?.role === 'host') {
      const n = online.guests.length;
      this.onlineBtn.replaceChildren('📡', ...(n || online.asking.length ? [h('span', { class: 'badge', style: online.asking.length ? '' : 'background:var(--good)' }, String(online.asking.length || n))] : []));
      this.onlineBtn.classList.toggle('ok', online.linkState === 'open');
      this.onlineBtn.title = `Sharing as ${online.code} · ${n} other device${n === 1 ? '' : 's'}`;
      if (online.asking.length) banner = `📱 ${online.asking[0].name} wants to join. Tap 📡 to let them in.`;
    } else if (online?.role === 'guest') {
      this.onlineBtn.replaceChildren('📡');
      this.onlineBtn.classList.toggle('ok', online.linkState === 'open' && !online.quiet);
      if (online.phase === 'hostAway') banner = '⏳ The host device dropped out. Waiting for it to come back…';
      else if (online.linkState !== 'open') banner = '🟡 Reconnecting…';
      else if (online.quiet) banner = '😴 The host device seems to be asleep. Open the game on it to carry on.';
      else if (online.rate === 0 && st.speed > 0) banner = '⏸ Paused on the host device';
    }
    const bottom = Math.round(this.topEl.getBoundingClientRect().bottom);
    if (bottom > 0 && bottom !== this.topBottom) { this.topBottom = bottom; document.documentElement.style.setProperty('--hud-top', `${bottom}px`); }
    this.onlineBanner.textContent = banner;
    this.onlineBanner.style.display = banner ? '' : 'none';
    const me = activePlayer(st);
    this.playerBtn.style.display = me ? '' : 'none';
    if (me) { this.playerBtn.textContent = `👤 ${me.name}`; this.playerBtn.style.boxShadow = `inset 0 0 0 3px ${me.color}`; }
    const house = st.household;
    const problems = st.lot.objects.filter((o) => o.broken).length + (house.dust >= 70 ? 1 : 0) + (house.weeds >= 70 ? 1 : 0) + (house.rubbish >= 100 ? 1 : 0);
    this.homeBadge.textContent = problems ? '!' : '';
    this.homeBadge.style.display = problems ? '' : 'none';
    const food = st.household.groceries;
    this.foodEl.textContent = `🛒 ${food}`;
    this.foodEl.classList.toggle('low', food <= 6);
    const p = st.party;
    const showNeighbours = st.household.neighbourMood < 60;
    if (p || showNeighbours) {
      this.partyEl.style.display = '';
      clear(this.partyEl);
      if (p) {
        const t = (m: number) => { const hr = Math.floor((m % 1440) / 60); return `${((hr + 11) % 12) + 1}${hr < 12 ? 'am' : 'pm'}`; };
        this.partyEl.append(h('span', null, `${PARTY_THEMES[p.theme].icon} ${PARTY_THEMES[p.theme].name} ${t(p.start)}–${t(p.end)}${p.started ? ' · on now!' : ''}`));
      }
      this.partyEl.append(h('span', { class: 'muted' }, `Neighbours ${neighbourFace(st.household.neighbourMood).split(' ')[0]}`));
      if (p) this.partyEl.append(h('button', { class: 'btn small', onclick: () => { const host = game.sim(p.host); if (host) this.app.panels.party(host); } }, p.started ? 'End' : 'Details'));
    } else this.partyEl.style.display = 'none';
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', st.speed === i));
    this.ffEl.textContent = this.app.fastForward ? '⏩ Skipping ahead' : '';
    const unread = st.notifications.filter((n) => !n.read).length + (st.approvals?.length ?? 0);
    this.bellBadge.textContent = String(unread);
    this.bellBadge.style.display = unread ? '' : 'none';
    this.renderPortraits();
    this.renderPanel();
    this.renderQueue();
  }

  private changed(key: string, sig: string): boolean {
    if (this.sigs.get(key) === sig) return false;
    this.sigs.set(key, sig);
    return true;
  }

  private renderPortraits() {
    const game = this.app.game!;
    const sims = game.household();
    const sig = sims.map((s) => `${s.id}:${s.location}:${moodLabel(moodScore(s)).label}:${s.current?.icon ?? ''}:${game.state.selectedSimId}:${ownerOf(game.state, s.id)?.color ?? ''}`).join('|') + (activePlayer(game.state)?.id ?? '');
    if (!this.changed('portraits', sig)) return;
    clear(this.portraitsEl);
    for (const sim of sims) {
      const mood = moodLabel(moodScore(sim));
      const away = sim.location === 'work' || sim.location === 'away';
      const p = h('button', {
        class: `portrait ${sim.id === game.state.selectedSimId ? 'sel' : ''} ${away ? 'away' : ''}`,
        style: `background:${sim.appearance.topColor};${ownerOf(game.state, sim.id) ? `border-color:${ownerOf(game.state, sim.id)!.color}` : ''}`,
        'aria-label': `Select ${sim.name}`,
        onclick: () => this.app.selectSim(sim.id, true),
      },
        initials(sim.name),
        h('span', { class: 'mood' }, mood.emoji),
        sim.location === 'work' ? h('span', { class: 'act' }, '💼') : sim.location === 'away' ? h('span', { class: 'act' }, '🚶') : sim.current ? h('span', { class: 'act' }, sim.current.icon) : sim.location === 'town' ? h('span', { class: 'act' }, '🌳') : null,
      );
      this.portraitsEl.append(p);
    }
  }

  private selected(): Sim | undefined {
    const game = this.app.game!;
    return game.sim(game.state.selectedSimId);
  }

  private renderPanel() {
    const sim = this.selected();
    const game = this.app.game!;
    if (!sim) { clear(this.panelEl); return; }
    const mood = moodLabel(moodScore(sim));
    const headSig = `${sim.id}:${mood.label}:${this.tab}:${this.collapsed}:${sim.location}:${sim.career?.level}`;
    if (this.changed('head', headSig)) {
      clear(this.panelEl);
      this.panelEl.classList.toggle('collapsed', this.collapsed);
      const job = sim.career ? `${CAREERS[sim.career.id].levels[sim.career.level].title}` : 'No job yet';
      const where = sim.location === 'work' ? ' · at work' : sim.location === 'away' ? ' · out and about' : sim.location === 'town' ? ' · out in town' : '';
      const head = h('div', { class: 'sp-head', onclick: () => { this.collapsed = !this.collapsed; this.sigs.clear(); this.refresh(); } },
        h('div', null, h('div', { class: 'sp-name' }, sim.name), h('div', { class: 'sp-sub' }, job + where)),
        h('div', { class: 'sp-mood', style: `color:${mood.color}` }, h('span', { class: 'em' }, mood.emoji), mood.label),
        game.isHousehold(sim) ? h('button', { class: 'btn icon-btn round rel sp-phone', 'aria-label': 'Phone', onclick: (e: Event) => { e.stopPropagation(); this.app.phone.open(sim); } }, '📱', h('span', { class: 'badge', style: 'display:none' })) : null,
      );
      const tabs = h('div', { class: 'tabs' },
        ...([['needs', 'Needs'], ['skills', 'Skills'], ['career', 'Job'], ['people', 'People'], ['goals', 'Goal']] as [Tab, string][])
          .map(([t, label]) => h('button', { class: `tab ${this.tab === t ? 'on' : ''}`, onclick: (e: Event) => { e.stopPropagation(); this.openTab(t); } }, label)));
      const body = h('div', { class: 'sp-body' }, tabs, h('div', { class: 'sp-content' }));
      this.panelEl.append(head, body);
      this.sigs.delete('content');
    }
    const badge = this.panelEl.querySelector('.sp-phone .badge') as HTMLElement | null;
    if (badge) {
      const n = unreadCount(sim) + (sim.call ? 1 : 0);
      badge.textContent = sim.call ? '📞' : String(n);
      badge.style.display = n ? '' : 'none';
    }
    const content = this.panelEl.querySelector('.sp-content') as HTMLElement | null;
    if (!content || this.collapsed) return;
    switch (this.tab) {
      case 'needs': return this.renderNeeds(content, sim);
      case 'skills': return this.renderSkills(content, sim);
      case 'career': return this.renderCareer(content, sim);
      case 'people': return this.renderPeople(content, sim);
      case 'goals': return this.renderGoals(content, sim);
    }
    void game;
  }

  private renderNeeds(el: HTMLElement, sim: Sim) {
    const now = this.app.game!.state.time;
    const dirt = sim.clothesDirt ?? 0;
    const sig = NEED_IDS.map((n) => Math.round(sim.needs[n] / 2)).join(',') + '|' + sim.moodlets.map((m) => m.id).join(',') + '|' + Math.round(dirt / 5) + '|' + (sim.basket?.cost ?? 0);
    if (!this.changed('content', sig)) return;
    clear(el);
    el.append(h('div', { class: 'needs' }, ...NEED_IDS.map((n) =>
      h('div', { class: 'need' }, h('span', { class: 'ic' }, NEEDS[n].icon), h('span', { class: 'lbl' }, NEEDS[n].name), bar(sim.needs[n])))));
    if (sim.basket?.items) {
      el.append(h('div', { class: 'chip', style: 'margin-top:6px' }, `🛒 Basket: ${sim.basket.items} item${sim.basket.items === 1 ? '' : 's'}, ${money(sim.basket.cost)}. Pay at the till!`));
    }
    if (this.app.game!.isHousehold(sim)) {
      const c = clothesLabel(dirt);
      el.append(h('div', { class: 'need clothes-need' }, h('span', { class: 'ic' }, '👕'), h('span', { class: 'lbl' }, `Clothes: ${c.label}`),
        bar(100 - dirt)));
    }
    if (sim.moodlets.length) {
      el.append(h('div', { class: 'moodlets' }, ...sim.moodlets.map((m) => {
        const def = MOODLETS[m.id];
        const mins = Math.max(0, Math.round(m.expires - now));
        return h('span', { class: `chip ${def.value >= 0 ? 'good' : 'bad'}`, title: `${def.value > 0 ? '+' : ''}${def.value} mood, ${Math.ceil(mins / 60)}h left` }, def.icon, def.name);
      })));
    }
  }

  private renderSkills(el: HTMLElement, sim: Sim) {
    const sig = SKILL_IDS.map((s) => Math.floor(sim.skills[s])).join(',') + `|${sim.driving.lessons}${sim.driving.licence}`;
    if (!this.changed('content', sig)) return;
    clear(el);
    el.append(h('div', { class: 'list' }, ...SKILL_IDS.map((s) => {
      const lvl = skillLevel(sim.skills[s]);
      return h('div', { class: 'row' }, h('span', { style: 'font-size:20px' }, SKILL_NAMES[s].icon),
        h('div', { class: 'grow' }, h('div', { class: 't' }, SKILL_NAMES[s].name), bar(skillProgress(sim.skills[s]) * 100, 'var(--teal)')),
        h('span', { class: 'skill-lvl' }, `Lv ${lvl}`));
    }), h('div', { class: 'row' }, h('span', { style: 'font-size:20px' }, '🚗'),
      h('div', { class: 'grow' }, h('div', { class: 't' }, 'Driving'), h('div', { class: 's' }, sim.driving.licence ? 'Full licence ✅' : sim.driving.lessons >= 5 ? 'Ready for the test (Go out → Driving test)' : `Learner: ${sim.driving.lessons}/5 lessons (Go out → Driving lesson)`)))));
  }

  private renderCareer(el: HTMLElement, sim: Sim) {
    const c = sim.career;
    const sig = c ? `${c.id}:${c.level}:${Math.round(c.performance)}` : 'none';
    if (!this.changed('content', sig + sim.location)) return;
    clear(el);
    if (!c) {
      el.append(h('p', { class: 'muted' }, `${sim.name.split(' ')[0]} doesn't have a job. Jobs pay money and need skills to get promoted.`),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn primary small', onclick: () => this.app.panels.careers(sim) }, '💼 Find a job'),
          h('button', { class: 'btn small', onclick: () => this.app.panels.outings(sim) }, '🚶 Go out')));
      return;
    }
    const def = CAREERS[c.id];
    const lvl = def.levels[c.level];
    const days = lvl.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
    const missing = missingForPromotion(sim);
    const next = def.levels[c.level + 1];
    el.append(
      h('div', { class: 'row' }, h('span', { style: 'font-size:26px' }, def.icon),
        h('div', { class: 'grow' }, h('div', { class: 't' }, `${lvl.title} (level ${c.level + 1})`), h('div', { class: 's' }, `£${lvl.pay}/hour · ${lvl.start}:00–${lvl.end}:00 · ${days}`))),
      h('div', { class: 'opt-label' }, 'Performance'), bar(Math.max(0, c.performance), c.performance >= 0 ? 'var(--accent)' : 'var(--bad)'),
      next ? h('p', { class: 'muted' }, `Next: ${next.title} (£${next.pay}/h).` + (missing.length ? ` Needs ${missing.map((m) => `${SKILL_NAMES[m.skill].name} ${m.level}`).join(', ')}.` : ' Skills are ready!')) : h('p', { class: 'muted' }, 'Top of the career!'),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn small', onclick: () => this.app.panels.outings(sim) }, '🚶 Go out'),
        h('button', { class: 'btn small', onclick: () => this.app.panels.careers(sim) }, '💼 Change job')),
    );
  }

  private renderPeople(el: HTMLElement, sim: Sim) {
    const game = this.app.game!;
    const rels = relationshipsOf(game.state, sim.id).sort((a, b) => b.rel.friendship - a.rel.friendship);
    const sig = rels.map((r) => `${r.other}:${Math.round(r.rel.friendship)}:${Math.round(r.rel.romance)}`).join(',');
    if (!this.changed('content', sig)) return;
    clear(el);
    if (!rels.length) el.append(h('p', { class: 'muted' }, 'No one yet. Chat to visitors or call a neighbour!'));
    el.append(h('div', { class: 'list' }, ...rels.map(({ other, rel }) => {
      const o = game.sim(other)!;
      const rom = game.state.settings.romance ? romanceLabel(rel) : null;
      return h('div', { class: 'row' },
        h('span', { class: 'portrait', style: `width:38px;height:38px;font-size:13px;border-width:2px;background:${o.appearance.topColor}` }, initials(o.name)),
        h('div', { class: 'grow' }, h('div', { class: 't' }, o.name, rom ? h('span', { class: 'chip', style: 'margin-left:6px' }, '💗 ' + rom) : null),
          h('div', { class: 's' }, friendshipLabel(rel.friendship) + (o.isTownie ? ` · ${o.district}` : ' · Household')),
          bar((rel.friendship + 100) / 2, rel.friendship >= 0 ? 'var(--good)' : 'var(--bad)')),
        o.isTownie && o.location === 'home' ? h('button', { class: 'btn small', onclick: () => this.app.invite(o.id) }, 'Invite') : null,
      );
    })));
  }

  private renderGoals(el: HTMLElement, sim: Sim) {
    const game = this.app.game!;
    const asp = ASPIRATIONS[sim.aspiration];
    const sig = `${sim.aspiration}:${sim.aspirationStep}:${sim.rewardPoints}`;
    if (!this.changed('content', sig)) return;
    clear(el);
    if (!asp) return;
    el.append(
      h('div', { class: 'row' }, h('span', { style: 'font-size:26px' }, asp.icon), h('div', { class: 'grow' }, h('div', { class: 't' }, asp.name), h('div', { class: 's' }, asp.desc)),
        h('button', { class: 'btn small teal', onclick: () => this.app.panels.rewards(sim) }, `🏆 ${sim.rewardPoints}`)),
      h('div', { class: 'list' }, ...asp.steps.map((step, i) => {
        const done = i < sim.aspirationStep;
        const cur = i === sim.aspirationStep;
        return h('div', { class: 'row', style: cur ? 'background:rgba(255,122,89,0.1)' : '' },
          h('span', { style: 'font-size:18px' }, done ? '✅' : cur ? '👉' : '⬜'),
          h('div', { class: 'grow' }, h('div', { class: done ? 's' : 't' }, step.desc)),
          h('span', { class: 'chip' }, `+${step.points}`));
      })),
    );
    void condMet; void game;
  }

  private renderQueue() {
    const sim = this.selected();
    if (!sim || (sim.location !== 'lot' && sim.location !== 'town')) { clear(this.queueEl); this.sigs.delete('queue'); return; }
    const cur = sim.current;
    const prog = cur && cur.phase === 'perform' && cur.duration > 0 ? Math.round((cur.elapsed / cur.duration) * 10) : 0;
    const sig = [cur ? `${cur.uid}:${prog}` : '', ...sim.queue.map((q) => q.uid)].join(',');
    if (!this.changed('queue', sig)) return;
    clear(this.queueEl);
    const items = [...(cur ? [cur] : []), ...sim.queue].filter((q) => q.kind !== 'respond');
    for (const q of items.slice(0, 6)) {
      const isCur = q === cur;
      this.queueEl.append(h('button', { class: `qitem ${isCur ? 'cur' : ''}`, title: `${q.label} (tap to cancel)`, 'aria-label': `Cancel ${q.label}`, onclick: () => this.app.cancel(sim.id, q.uid) },
        q.icon, h('span', { class: 'x' }, '✕'),
        isCur && cur!.phase === 'perform' && cur!.duration > 0 ? h('div', { class: 'prog' }, h('div', { style: `width:${Math.min(100, (cur!.elapsed / cur!.duration) * 100)}%` })) : null));
    }
  }

  // ---------- Per-frame ----------

  frame() {
    const game = this.app.game;
    if (!game || this.app.mode !== 'live') return;
    const world = this.app.world;
    const seen = new Set<number>();
    for (const sim of game.state.sims) {
      if (!game.present(sim)) continue;
      const pos = world.simScreenPos(sim.id);
      if (!pos || !pos.visible) continue;
      seen.add(sim.id);
      let b = this.bubbles.get(sim.id);
      if (!b) {
        b = { b: h('div', { class: 'bubble' }), n: h('div', { class: 'nametag' }) };
        this.bubblesEl.append(b.b, b.n);
        this.bubbles.set(sim.id, b);
      }
      const sel = sim.id === game.state.selectedSimId;
      const icon = sim.thought?.icon ?? (sel && sim.current?.phase === 'perform' ? sim.current.icon : '');
      if (b.b.textContent !== icon) b.b.textContent = icon;
      b.b.style.display = icon ? '' : 'none';
      b.b.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
      const label = sim.isTownie ? sim.name.split(' ')[0] + (sim.location === 'lot' ? ' 🏠' : '') : sel ? '' : sim.name.split(' ')[0];
      if (b.n.textContent !== label) b.n.textContent = label;
      b.n.style.display = label ? '' : 'none';
      b.n.style.transform = `translate(${pos.x}px, ${pos.y + 4}px) translate(-50%, 0)`;
    }
    for (const pet of game.state.pets) {
      const key = -pet.id;
      const pos = pet.location === 'lot' ? world.petScreenPos(pet.id) : null;
      if (!pos || !pos.visible) continue;
      seen.add(key);
      let b = this.bubbles.get(key);
      if (!b) {
        b = { b: h('div', { class: 'bubble' }), n: h('div', { class: 'nametag' }) };
        this.bubblesEl.append(b.b, b.n);
        this.bubbles.set(key, b);
      }
      const need = pet.hunger < 20 ? '🍖' : pet.fun < 15 ? '🎾' : pet.clean < 15 ? '🫧' : '';
      const text = pet.say ? `💬 ${pet.say.text}` : need;
      if (b.b.textContent !== text) b.b.textContent = text;
      b.b.style.display = text ? '' : 'none';
      b.b.style.fontSize = pet.say ? '14px' : '';
      b.b.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
      if (b.n.textContent !== pet.name) b.n.textContent = pet.name;
      b.n.style.display = '';
      b.n.style.transform = `translate(${pos.x}px, ${pos.y + 4}px) translate(-50%, 0)`;
    }
    for (const [id, b] of this.bubbles) if (!seen.has(id)) { b.b.style.display = 'none'; b.n.style.display = 'none'; }
  }

  toast(n: Pick<GameNotification, 'text' | 'icon' | 'kind'>) {
    const t = h('div', { class: `panel toast ${n.kind}` }, h('span', { class: 'ic' }, n.icon), h('span', null, n.text));
    this.toastsEl.prepend(t);
    while (this.toastsEl.children.length > 4) this.toastsEl.lastElementChild?.remove();
    setTimeout(() => t.classList.add('fade'), 5200);
    setTimeout(() => t.remove(), 5700);
  }

  reset() { this.sigs.clear(); for (const b of this.bubbles.values()) { b.b.remove(); b.n.remove(); } this.bubbles.clear(); }
}
