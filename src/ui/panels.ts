// Modal panels: jobs, outings, rewards, invitations, messages, object info and the neighbourhood map.
import { ALL_TRAITS, ASPIRATIONS, CAREERS, NEEDS, OBJECTS, OUTINGS, REWARD_OBJECTS, REWARD_TRAITS, NAMES } from '../sim/defs';
import { calendarOf, DAYS_PER_SEASON, endParty, EVENTS, eventsOn, familyCar, outingCheck, PARTY_COST_PER_GUEST, PARTY_THEMES, planParty, SEASONS, YEAR_DAYS } from '../sim/life';
import { BOTTOMS, CLOTH_COLORS, TOPS } from '../sim/newgame';
import { addMoodlet } from '../sim/mood';
import { DAY_NAMES } from '../sim/game';
import { joinCareer, quitCareer } from '../sim/schedule';
import { SKILL_NAMES, levelOf } from '../sim/skills';
import { unlockRewardObject } from '../sim/build';
import { payBills } from '../sim/actions';
import { friendshipLabel, findRel } from '../sim/relationships';
import type { NeedId, Party, PlacedObject, Sim, SkillId } from '../sim/types';
import type { App } from './app';
import { chip, clear, h, initials, money } from './dom';

export function neighbourFace(mood: number): string {
  return mood >= 70 ? '😊 happy' : mood >= 40 ? '😐 putting up with you' : '😠 fed up';
}

export function modal(root: HTMLElement, title: string, body: (HTMLElement | string | null)[], foot: HTMLElement[] = [], onClose?: () => void): () => void {
  const bg = h('div', { class: 'modal-bg' });
  const close = () => { bg.remove(); onClose?.(); };
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); });
  const box = h('div', { class: 'panel modal', role: 'dialog', 'aria-label': title },
    h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('h2', { style: 'flex:1' }, title), h('button', { class: 'btn icon-btn round ghost', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'body' }, ...body),
    foot.length ? h('div', { class: 'foot' }, ...foot) : null,
  );
  bg.append(box);
  root.append(bg);
  return close;
}

export function effectsText(effects: Partial<Record<NeedId, number>> | undefined): string {
  if (!effects) return '';
  return Object.entries(effects).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${NEEDS[k as NeedId].icon}+${v}`).join(' ');
}

export class Panels {
  constructor(private app: App) {}
  private get root() { return this.app.root; }

  careers(sim: Sim) {
    const game = this.app.game!;
    let close = () => {};
    const cards = Object.values(CAREERS).map((c) => {
      const l = c.levels[0];
      const days = l.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
      const mine = sim.career?.id === c.id;
      return h('div', { class: `card ${mine ? 'on' : ''}` },
        h('div', { class: 'row' }, h('span', { style: 'font-size:28px' }, c.icon),
          h('div', { class: 'grow' }, h('div', { class: 't' }, c.name), h('div', { class: 's' }, c.desc),
            h('div', { class: 's' }, `Starts as ${l.title}: £${l.pay}/h, ${l.start}:00–${l.end}:00, ${days}`),
            h('div', { class: 's' }, `Key skills: ${c.skills.map((s) => SKILL_NAMES[s].name).join(', ')} · ${c.levels.length} levels`)),
          mine ? h('button', { class: 'btn small', onclick: () => { quitCareer(game, sim); close(); this.app.hud.openTab('career'); } }, 'Quit')
            : h('button', { class: 'btn small primary', onclick: () => { joinCareer(game, sim, c.id); this.app.flushEvents(); close(); this.app.hud.openTab('career'); } }, 'Join')));
    });
    close = modal(this.root, `Jobs for ${sim.name.split(' ')[0]}`, [h('p', { class: 'muted' }, 'Sims go to work automatically. Good moods and skills earn promotions.'), ...cards]);
  }

  outings(sim: Sim) {
    const game = this.app.game!;
    let close = () => {};
    const groups: { title: string; ids: string[] }[] = [
      { title: 'Shopping', ids: ['food_big', 'food_top', 'clothes', 'gerard', 'market'] },
      { title: 'Driving', ids: ['lesson', 'test', 'drive'] },
      { title: 'This season', ids: ['easter_fair', 'seaside', 'summer_fair', 'trick', 'bonfire', 'christmas_market', 'skating'] },
      { title: 'Holidays (summer only)', ids: ['holiday_blackpool', 'holiday_spain'] },
      { title: 'Out and about', ids: Object.keys(OUTINGS) },
    ];
    const used = new Set<string>();
    const body: HTMLElement[] = [h('p', { class: 'muted' }, `${sim.name.split(' ')[0]} walks off the lot and comes back later.${sim.driving.licence && familyCar(game) ? ' Drivers take the car and get home sooner.' : ''}`)];
    for (const g of groups) {
      const rows: HTMLElement[] = [];
      for (const id of g.ids) {
        if (used.has(id)) continue;
        const o = OUTINGS[id];
        if (!o) continue;
        const check = outingCheck(game, sim, o);
        if (check.hidden) continue;
        used.add(id);
        const extras = [o.groceries ? `🛒 +${o.groceries} food` : '', effectsText(o.effects)].filter(Boolean).join(' · ');
        rows.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { style: 'font-size:28px' }, o.icon),
          h('div', { class: 'grow' }, h('div', { class: 't' }, o.name), h('div', { class: 's' }, `${o.duration >= 1440 ? `${o.duration / 1440} day${o.duration > 1440 ? 's' : ''}` : `${Math.round((o.duration / 60) * 10) / 10}h`} · ${o.cost ? (o.household ? `£${o.cost} each` : money(o.cost)) : 'Free'}${extras ? ' · ' + extras : ''}`),
            check.why ? h('div', { class: 's', style: 'color:var(--bad)' }, check.why) : null),
          h('button', { class: 'btn small primary', disabled: !check.ok, onclick: () => { close(); this.app.queueOuting(sim, o.id); } }, 'Go'))));
      }
      if (rows.length) body.push(h('div', { class: 'opt-label' }, g.title), ...rows);
    }
    close = modal(this.root, 'Go out in Ashton', body);
  }

  calendar() {
    const game = this.app.game!;
    const today = calendarOf(game.day);
    const yearStart = game.day - (game.day % YEAR_DAYS);
    const seasons = SEASONS.map((season, si) => {
      const cells = Array.from({ length: DAYS_PER_SEASON }, (_, d) => {
        const day = yearStart + si * DAYS_PER_SEASON + d;
        const ev = eventsOn(day).filter((e) => e.id !== 'summer');
        const isToday = day === game.day;
        return h('div', { class: `cal-day ${isToday ? 'today' : ''} ${day < game.day ? 'past' : ''}`, title: ev.map((e) => e.name).join(', ') },
          h('span', { class: 'n' }, `${DAY_NAMES[d].slice(0, 2)} ${d + 1}`), h('span', { class: 'e' }, ev.map((e) => e.icon).join('')));
      });
      return h('div', { class: 'card' }, h('div', { class: 't' }, `${season.icon} ${season.name}${season.id === 'summer' ? ' · school holidays 🏖️' : ''}`), h('div', { class: 'cal-row' }, ...cells));
    });
    const upcoming = EVENTS.map((e) => {
      const si = SEASONS.findIndex((s) => s.id === e.season);
      const day = yearStart + si * DAYS_PER_SEASON + e.days[0] - 1;
      return { e, day: day >= game.day ? day : day + YEAR_DAYS };
    }).sort((a, b) => a.day - b.day);
    modal(this.root, `Year ${today.year} calendar`, [
      h('p', { class: 'muted' }, `Today is ${DAY_NAMES[game.weekday]}, ${today.season.name} day ${today.dayOfSeason}. Each season lasts a week.`),
      ...seasons,
      h('div', { class: 'opt-label' }, 'Coming up'),
      ...upcoming.map(({ e, day }) => h('div', { class: 'row' }, h('span', { style: 'font-size:22px' }, e.icon), h('div', { class: 'grow' }, h('div', { class: 't' }, e.name), h('div', { class: 's' }, e.desc)),
        h('span', { class: 'chip' }, day === game.day ? 'Today' : `in ${day - game.day} day${day - game.day === 1 ? '' : 's'}`))),
    ]);
  }

  party(host: Sim) {
    const game = this.app.game!;
    const st = game.state;
    let close = () => {};
    if (st.party) {
      const p = st.party;
      close = modal(this.root, `${PARTY_THEMES[p.theme].icon} ${PARTY_THEMES[p.theme].name}`, [
        h('p', null, p.started ? 'The party is in full swing!' : `Starts at ${Math.floor((p.start % 1440) / 60)}:00.`),
        h('p', { class: 'muted' }, `Guests: ${p.guests.map((id) => game.sim(id)?.name).join(', ')}`),
      ], [h('button', { class: 'btn', onclick: () => { endParty(game, false); this.app.flushEvents(); close(); } }, p.started ? 'End the party' : 'Cancel the party')]);
      return;
    }
    let theme: Party['theme'] = 'karaoke';
    let startHour = 19;
    const guests = new Set<number>();
    const townies = st.sims.filter((s) => s.isTownie).sort((a, b) => (findRel(st, host.id, b.id)?.friendship ?? -1) - (findRel(st, host.id, a.id)?.friendship ?? -1));
    const costEl = h('div', { class: 'muted' });
    const updateCost = () => { costEl.textContent = `Food and drinks: £${guests.size * PARTY_COST_PER_GUEST}. Neighbours: ${neighbourFace(st.household.neighbourMood)}. Keep the noise down after 10pm!`; };
    const seg = <T extends string | number>(values: [T, string][], get: () => T, set: (v: T) => void) => {
      const wrap = h('div', { class: 'opts' });
      const draw = () => { clear(wrap); for (const [v, label] of values) wrap.append(h('button', { class: `opt ${get() === v ? 'on' : ''}`, onclick: () => { set(v); draw(); } }, label)); };
      draw();
      return wrap;
    };
    const nowHour = game.hour;
    const times: [number, string][] = [17, 18, 19, 20, 21].filter((t) => t > nowHour).map((t) => [t, `Tonight ${t - 12}pm`]);
    times.push([24 + 19, 'Tomorrow 7pm']);
    if (!times.some(([t]) => t === startHour)) startHour = times[0][0];
    updateCost();
    close = modal(this.root, 'Plan a party', [
      h('div', { class: 'opt-label' }, 'Theme'),
      seg<Party['theme']>(Object.entries(PARTY_THEMES).map(([k, v]) => [k as Party['theme'], `${v.icon} ${v.name}`]), () => theme, (v) => { theme = v; }),
      h('div', { class: 'opt-label' }, 'When'),
      seg<number>(times, () => startHour, (v) => { startHour = v; }),
      h('div', { class: 'opt-label' }, 'Invite friends (up to 6)'),
      h('div', { class: 'grid2' }, ...townies.map((t) => {
        const rel = findRel(st, host.id, t.id);
        const b = h('button', { class: 'trait', onclick: () => {
          if (guests.has(t.id)) guests.delete(t.id); else if (guests.size < 6) guests.add(t.id);
          b.classList.toggle('on', guests.has(t.id));
          updateCost();
        } }, h('b', null, t.name), `${t.district} · ${rel?.met ? friendshipLabel(rel.friendship) : 'Not met yet'}`);
        return b;
      })),
      h('p', null, costEl),
      !st.lot.objects.some((o) => o.defId === 'karaoke') ? h('p', { class: 'muted' }, '🎤 Tip: buy a Karaoke Machine (Buy mode → Living room) for karaoke nights.') : null,
    ], [
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => {
        const day = Math.floor(st.time / 1440);
        const res = planParty(game, host, theme, day * 1440 + startHour * 60, [...guests]);
        if (!res.ok) { this.app.toast(res.why ?? 'Could not plan the party.', '🎉'); return; }
        this.app.flushEvents();
        close();
      } }, '🎉 Send invitations'),
    ]);
  }

  clothes(sim: Sim) {
    const game = this.app.game!;
    const original = { ...sim.appearance };
    const prices = { top: 25, bottom: 20, shoes: 15 };
    let close = () => {};
    const totalEl = h('div', { class: 't' });
    const body = h('div');
    const total = () => {
      const a = sim.appearance;
      let t = 0;
      if (a.top !== original.top || a.topColor !== original.topColor) t += prices.top;
      if (a.bottom !== original.bottom || a.bottomColor !== original.bottomColor) t += prices.bottom;
      if (a.shoeColor !== original.shoeColor) t += prices.shoes;
      return t;
    };
    const render = () => {
      clear(body);
      const a = sim.appearance;
      const opts = <T extends string>(label: string, list: { id: T; name: string }[], cur: T, set: (v: T) => void) => [h('div', { class: 'opt-label' }, label),
        h('div', { class: 'opts' }, ...list.map((o) => h('button', { class: `opt ${o.id === cur ? 'on' : ''}`, onclick: () => { set(o.id); render(); } }, o.name)))];
      const cols = (label: string, list: string[], cur: string, set: (v: string) => void) => [h('div', { class: 'opt-label' }, label),
        h('div', { class: 'colors' }, ...list.map((c) => h('button', { class: `color ${c === cur ? 'on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => { set(c); render(); } })))];
      body.append(
        ...opts(`Tops (£${prices.top})`, TOPS, a.top, (v) => { a.top = v; if (v === 'dress') a.bottom = 'skirt'; }),
        ...cols('Top colour', CLOTH_COLORS, a.topColor, (v) => { a.topColor = v; }),
        ...(a.top === 'dress' ? [] : [...opts(`Bottoms (£${prices.bottom})`, BOTTOMS, a.bottom, (v) => { a.bottom = v; }), ...cols('Bottoms colour', CLOTH_COLORS, a.bottomColor, (v) => { a.bottomColor = v; })]),
        ...cols(`Shoes (£${prices.shoes})`, ['#2b2b2b', '#f4f1ea', '#8b5e3c', '#c0392b', '#3b4ba8', '#f08ab0', '#57b36a'], a.shoeColor, (v) => { a.shoeColor = v; }),
      );
      totalEl.textContent = `Total: ${money(total())}`;
    };
    render();
    this.app.world.cam.focus(sim.pos.x, sim.pos.z);
    let bought = false;
    close = modal(this.root, `Clothes shopping: ${sim.name.split(' ')[0]}`, [h('p', { class: 'muted' }, 'Try things on. You can see them on your Sim.'), body], [
      totalEl,
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Leave it'),
      h('button', { class: 'btn primary', onclick: () => {
        const t = total();
        if (t > game.state.household.funds) { this.app.toast("You can't afford all that.", '💸'); return; }
        if (t > 0) { game.addFunds(-t); addMoodlet(sim, 'new_clothes', game.state.time); this.app.toast(`New outfit for ${money(t)}!`, '🛍️'); this.app.sound('cash'); }
        bought = true;
        close();
      } }, '🛍️ Buy'),
    ], () => { if (!bought) sim.appearance = original; });
  }

  rewards(sim: Sim) {
    const game = this.app.game!;
    let close = () => {};
    const render = (): HTMLElement[] => [
      h('p', { class: 'muted' }, `Reward points: 🏆 ${sim.rewardPoints}. Earn them by completing aspiration steps.`),
      h('div', { class: 'opt-label' }, 'Special traits'),
      ...Object.values(REWARD_TRAITS).map((t) => {
        const owned = sim.perks.includes(t.id);
        return h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { style: 'font-size:26px' }, t.icon), h('div', { class: 'grow' }, h('div', { class: 't' }, t.name), h('div', { class: 's' }, t.desc)),
          owned ? chip('Owned', 'good') : h('button', { class: 'btn small teal', disabled: sim.rewardPoints < (t.cost ?? 0), onclick: () => { sim.rewardPoints -= t.cost ?? 0; sim.perks.push(t.id); this.app.sound('levelup'); close(); this.rewards(sim); } }, `🏆 ${t.cost}`)));
      }),
      h('div', { class: 'opt-label' }, 'Reward objects (placed from Buy mode → Rewards)'),
      ...REWARD_OBJECTS.map((r) => {
        const def = OBJECTS[r.id];
        const unlocked = game.state.household.rewardsUnlocked.filter((x) => x === r.id).length;
        return h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { style: 'font-size:26px' }, '🎁'), h('div', { class: 'grow' }, h('div', { class: 't' }, def.name), h('div', { class: 's' }, def.description)),
          unlocked ? chip(`${unlocked} ready`, 'good') : null,
          h('button', { class: 'btn small teal', disabled: sim.rewardPoints < r.cost, onclick: () => { unlockRewardObject(game, sim.id, r.id); this.app.flushEvents(); close(); this.rewards(sim); } }, `🏆 ${r.cost}`)));
      }),
    ];
    close = modal(this.root, 'Rewards', render());
  }

  invite(sim?: Sim) {
    const game = this.app.game!;
    let close = () => {};
    const townies = game.state.sims.filter((s) => s.isTownie);
    const rows = townies.map((t) => {
      const rel = sim ? findRel(game.state, sim.id, t.id) : undefined;
      const here = t.location === 'lot';
      const coming = game.state.pendingVisits.some((v) => v.simId === t.id);
      return h('div', { class: 'card' }, h('div', { class: 'row' },
        h('span', { class: 'portrait', style: `width:40px;height:40px;font-size:13px;border-width:2px;background:${t.appearance.topColor}` }, initials(t.name)),
        h('div', { class: 'grow' }, h('div', { class: 't' }, t.name), h('div', { class: 's' }, `From ${t.district} · ${rel?.met ? friendshipLabel(rel.friendship) : 'Not met yet'} · ${t.traits.map((x) => ALL_TRAITS[x]?.name).join(', ')}`)),
        here ? chip('Visiting') : coming ? chip('On the way') : h('button', { class: 'btn small primary', onclick: () => { this.app.invite(t.id); close(); } }, 'Invite')));
    });
    close = modal(this.root, 'Invite someone over', [h('p', { class: 'muted' }, 'Neighbours from around Ashton. Invited guests arrive within the hour.'), ...rows]);
  }

  notifications() {
    const game = this.app.game!;
    const st = game.state;
    let close = () => {};
    const bills = st.bills;
    const list = [...st.notifications].reverse().slice(0, 40).map((n) => {
      const d = Math.floor(n.time / 1440), m = n.time % 1440;
      return h('div', { class: 'row', style: n.read ? '' : 'background:rgba(255,122,89,0.08)' }, h('span', { style: 'font-size:22px' }, n.icon),
        h('div', { class: 'grow' }, h('div', null, n.text), h('div', { class: 's' }, `${DAY_NAMES[d % 7]} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`)));
    });
    for (const n of st.notifications) n.read = true;
    const billCard = bills ? h('div', { class: 'card on' }, h('div', { class: 'row' }, h('span', { style: 'font-size:26px' }, '🧾'),
      h('div', { class: 'grow' }, h('div', { class: 't' }, `Bills due: ${money(bills.amount)}`), h('div', { class: 's' }, `Pay before ${DAY_NAMES[Math.floor(bills.dueBy / 1440) % 7]} to avoid a late fee.`)),
      h('button', { class: 'btn small primary', onclick: () => { payBills(game); this.app.flushEvents(); close(); } }, 'Pay'))) : null;
    close = modal(this.root, 'Messages', [billCard, ...(list.length ? list : [h('p', { class: 'muted' }, 'Nothing yet.')])]);
  }

  objectInfo(obj: PlacedObject) {
    const def = OBJECTS[obj.defId];
    const rows = def.interactions.filter((i) => !i.condition || i.condition === 'night').map((i) =>
      h('div', { class: 'row' }, h('span', { style: 'font-size:20px' }, i.icon), h('div', { class: 'grow' }, h('div', { class: 't' }, i.name),
        h('div', { class: 's' }, [effectsText(i.effects ?? i.then?.effects), i.skill ? `${SKILL_NAMES[i.skill].icon} ${SKILL_NAMES[i.skill].name}` : '', i.minSkill ? `(needs ${SKILL_NAMES[i.minSkill.skill].name} ${i.minSkill.level})` : '', `${i.duration} min`].filter(Boolean).join(' · ')))));
    modal(this.root, def.name, [
      h('p', null, def.description),
      h('div', { class: 's muted' }, `${def.reward ? 'Reward object' : money(def.price)} · Room score +${def.decor}${obj.dirt >= 30 ? ' · Needs a clean' : ''}${def.id === 'veg_patch' && obj.growth > 0 ? ` · Growth ${Math.floor(obj.growth)}%` : ''}`),
      ...rows,
    ]);
  }

  simInfo(sim: Sim) {
    const game = this.app.game!;
    const asp = ASPIRATIONS[sim.aspiration];
    const rel = game.state.selectedSimId !== sim.id ? findRel(game.state, game.state.selectedSimId, sim.id) : undefined;
    const top = (Object.keys(sim.skills) as SkillId[]).filter((s) => levelOf(sim, s) > 1).map((s) => `${SKILL_NAMES[s].name} ${levelOf(sim, s)}`).join(', ');
    modal(this.root, sim.name, [
      h('p', { class: 'muted' }, sim.isTownie ? `Lives in ${sim.district}.` : `Part of the ${game.state.household.name} household.`),
      h('div', { class: 'opt-label' }, 'Traits'),
      h('div', { class: 'opts' }, ...[...sim.traits, ...sim.perks].map((t) => chip(`${ALL_TRAITS[t]?.icon} ${ALL_TRAITS[t]?.name}`))),
      asp ? h('p', null, `Dreams of being: ${asp.icon} ${asp.name}`) : null,
      top ? h('p', null, `Skills: ${top}`) : null,
      sim.career ? h('p', null, `Works as: ${CAREERS[sim.career.id].levels[sim.career.level].title}`) : null,
      rel ? h('p', null, `Relationship: ${friendshipLabel(rel.friendship)}`) : null,
    ]);
  }

  map() {
    const game = this.app.game!;
    const places = [
      ['🛍️', 'The High Street', 'Gerard Street and its old shopfronts. Café, shops, part-time jobs.'],
      ['🧺', 'Market Square', 'Market on Tuesdays and Saturdays: food stalls and rare finds.'],
      ['🏬', 'Shopping centre', 'The Gerard Centre: supermarket and everyday things.'],
      ['⛪', 'Church and green', "St Thomas' Church. Weddings and community events."],
      ['⚽', 'Football ground', 'Home of the local clubs. Matches at the weekend.'],
      ['🏇', 'Racecourse', 'Race days on Saturdays at the edge of town.'],
      ['🏛️', 'Heritage museum', 'Coal mining and lock-making history.'],
    ];
    const districts = NAMES.districts.map((d) => {
      const people = game.state.sims.filter((s) => s.district === d).map((s) => s.name.split(' ')[0]);
      return h('div', { class: 'card' }, h('div', { class: 't' }, `📍 ${d}${d === 'Town Green' ? ' (your home)' : ''}`), h('div', { class: 's' }, people.length ? `Neighbours: ${people.join(', ')}` : 'Quiet streets'));
    });
    modal(this.root, 'Ashton-in-Makerfield', [
      h('p', { class: 'muted' }, 'Sims can visit these places with "Go out" (tap your Sim, or the Job tab). Visiting them in 3D comes in a later update.'),
      ...places.map(([i, n, d]) => h('div', { class: 'row' }, h('span', { style: 'font-size:24px' }, i), h('div', { class: 'grow' }, h('div', { class: 't' }, n), h('div', { class: 's' }, d)))),
      h('div', { class: 'opt-label' }, 'Districts'),
      h('div', { class: 'grid2' }, ...districts),
    ]);
  }

  confirm(title: string, text: string, yes: string, onYes: () => void) {
    let close = () => {};
    close = modal(this.root, title, [h('p', null, text)], [
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => { close(); onYes(); } }, yes),
    ]);
  }

  message(title: string, text: string) {
    let close = () => {};
    close = modal(this.root, title, [h('p', null, text)], [h('button', { class: 'btn primary', onclick: () => close() }, 'OK')]);
  }
}
