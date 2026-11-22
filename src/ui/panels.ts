// Modal panels: jobs, outings, rewards, invitations, messages, object info and the neighbourhood map.
import { ALL_TRAITS, ASPIRATIONS, CAREERS, NEEDS, OBJECTS, OUTINGS, REWARD_OBJECTS, REWARD_TRAITS, NAMES } from '../sim/defs';
import { DAY_NAMES } from '../sim/game';
import { joinCareer, quitCareer } from '../sim/schedule';
import { SKILL_NAMES, levelOf } from '../sim/skills';
import { unlockRewardObject } from '../sim/build';
import { payBills } from '../sim/actions';
import { friendshipLabel, findRel } from '../sim/relationships';
import type { NeedId, PlacedObject, Sim, SkillId } from '../sim/types';
import type { App } from './app';
import { chip, h, initials, money } from './dom';

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
    const hour = game.hour;
    const rows = Object.values(OUTINGS).map((o) => {
      const dayOk = !o.days || o.days.includes(game.weekday);
      const hourOk = !o.hours || (hour >= o.hours[0] && hour < o.hours[1]);
      const afford = !o.cost || game.state.household.funds >= o.cost;
      const why = !dayOk ? `Only on ${o.days!.map((d) => DAY_NAMES[d]).join(' & ')}` : !hourOk ? `Open ${o.hours![0]}:00–${o.hours![1]}:00` : !afford ? 'Not enough money' : '';
      return h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { style: 'font-size:28px' }, o.icon),
        h('div', { class: 'grow' }, h('div', { class: 't' }, o.name), h('div', { class: 's' }, `${Math.round(o.duration / 60 * 10) / 10}h · ${o.cost ? money(o.cost) : 'Free'} · ${effectsText(o.effects)}`), why ? h('div', { class: 's', style: 'color:var(--bad)' }, why) : null),
        h('button', { class: 'btn small primary', disabled: !!why || sim.location !== 'lot', onclick: () => { this.app.queueOuting(sim, o.id); close(); } }, 'Go')));
    });
    close = modal(this.root, 'Go out in Ashton', [h('p', { class: 'muted' }, `${sim.name.split(' ')[0]} will walk off the lot and come back later.`), ...rows]);
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
