// Mobile phones. Each Sim in the household has a phone with text conversations. They can text and
// call the people they've met; friends text back (after a while), invite themselves round, ask
// them out for a walk or ring them up; the boss asks about extra shifts and the bank sends the bills.
// There's also online shopping, delivered a few hours later.
import type { Game } from './game';
import { enqueue, interrupt } from './actions';
import { addMoodlet, clamp } from './mood';
import { changeRel, findRel } from './relationships';
import { chance, pick, random } from './rng';
import { CAREERS, OUTINGS } from './defs';
import type { PhoneMsg, PhoneOffer, Sim } from './types';

export type TextKind = 'chat' | 'meme' | 'invite' | 'flirt' | 'sorry';

export const TEXT_KINDS: Record<TextKind, { icon: string; label: string }> = {
  chat: { icon: '👋', label: 'Say hi' },
  meme: { icon: '😂', label: 'Send a meme' },
  invite: { icon: '🏡', label: 'Come over?' },
  flirt: { icon: '😘', label: 'Flirt' },
  sorry: { icon: '🙏', label: 'Say sorry' },
};

const OUT_TEXT: Record<TextKind, string[]> = {
  chat: ['Hiya! How are you doing? 😊', 'Ey up! What you up to?', "How's things? Not seen you in ages!", 'Hope you are having a good day! ☀️'],
  meme: ['[😂 meme of a cat falling off a sofa]', '[🐸 "me on a Monday" meme]', '[🍟 a seagull stealing chips video]', '[🐕 dog wearing sunglasses]'],
  invite: ['Fancy coming round to mine? ☕', 'Do you want to come over for a bit?', "Kettle's on, come round! 🫖"],
  flirt: ["Can't stop thinking about you 😊", 'You looked nice today 😘', 'Fancy a date sometime? ❤️'],
  sorry: ["I'm really sorry about before 🙏", 'Sorry, I was out of order. Friends?'],
};

export interface Service { name: string; icon: string }
export const SERVICES: Record<string, Service> = {
  boss: { name: 'Work', icon: '💼' },
  bank: { name: 'Bank', icon: '🏦' },
  shop: { name: 'Deliveries', icon: '🚚' },
  vet: { name: 'Ashton Vets', icon: '🩺' },
};

export const SHOP_ITEMS: Record<string, { name: string; icon: string; price: number; hours: number; desc: string }> = {
  groceries: { name: 'Aldi online food shop', icon: '🛒', price: 45, hours: 3, desc: '+25 food, delivered in 3 hours' },
  petfood: { name: 'Pet food (big bag)', icon: '🦴', price: 12, hours: 3, desc: '+15 pet food' },
  treats: { name: 'Pet treats', icon: '🍪', price: 6, hours: 3, desc: '+10 treats for the pets' },
};

const MAX_MSGS = 60;

export function phoneOf(sim: Sim): NonNullable<Sim['phone']> {
  sim.phone ??= { msgs: [], readUpTo: 0 };
  return sim.phone;
}

export function unreadCount(sim: Sim): number {
  const p = sim.phone;
  if (!p) return 0;
  return p.msgs.filter((m) => !m.out && m.id > p.readUpTo).length;
}

/** People this Sim can text: everyone they've met who doesn't live with them. */
export function contacts(game: Game, sim: Sim): Sim[] {
  const st = game.state;
  return st.sims
    .filter((o) => o.id !== sim.id && !game.isHousehold(o) && findRel(st, sim.id, o.id)?.met)
    .sort((a, b) => (findRel(st, sim.id, b.id)?.friendship ?? 0) - (findRel(st, sim.id, a.id)?.friendship ?? 0));
}

export function senderName(game: Game, from: number | string): string {
  if (typeof from === 'number') return game.sim(from)?.name ?? 'Unknown';
  return SERVICES[from]?.name ?? from;
}

function addMsg(game: Game, sim: Sim, msg: Omit<PhoneMsg, 'id' | 'time'>): PhoneMsg {
  const p = phoneOf(sim);
  const m: PhoneMsg = { id: game.nextId(), time: game.state.time, ...msg };
  p.msgs.push(m);
  if (p.msgs.length > MAX_MSGS) p.msgs.splice(0, p.msgs.length - MAX_MSGS);
  return m;
}

/** A message arrives on a Sim's phone. */
export function receive(game: Game, sim: Sim, from: number | string, text: string, offer?: PhoneOffer, quiet = false): PhoneMsg {
  const m = addMsg(game, sim, { from, text, offer });
  if (!quiet) {
    const first = sim.name.split(' ')[0];
    game.notify(`💬 ${first} got a message from ${senderName(game, from)}${offer ? '. They need an answer!' : ''}`, '📱', 'info');
    game.sound('notify');
  }
  return m;
}

// ---------- Texting and calling ----------

export interface PhoneResult { ok: boolean; why?: string }

function canUsePhone(sim: Sim): PhoneResult {
  if (sim.location === 'work') return { ok: false, why: `${sim.name} is at work. No phones at work!` };
  if (sim.current?.anim === 'sleep' && sim.current.phase === 'perform') return { ok: false, why: `${sim.name} is asleep.` };
  return { ok: true };
}

export function sendText(game: Game, sim: Sim, toId: number, kind: TextKind): PhoneResult {
  const st = game.state;
  const to = game.sim(toId);
  if (!to || !TEXT_KINDS[kind]) return { ok: false };
  const can = canUsePhone(sim);
  if (!can.ok) return can;
  if (kind === 'flirt' && !st.settings.romance) return { ok: false, why: 'Romance is switched off in Settings.' };
  if (kind === 'flirt' && ((sim.age ?? 'adult') !== 'adult' || (to.age ?? 'adult') !== 'adult')) return { ok: false, why: 'Flirting is for grown-ups.' };
  const rel = findRel(st, sim.id, to.id);
  const f = rel?.friendship ?? 0;
  const r = rel?.romance ?? 0;
  addMsg(game, sim, { from: to.id, text: pick(st, OUT_TEXT[kind]), out: true });
  // A quick tap-tap on the phone (only when at home: out and about, it just sends).
  if (sim.location === 'lot') {
    enqueue(game, sim, { kind: 'self', selfId: 'text', label: `Texting ${to.name.split(' ')[0]}`, icon: '💬', userQueued: true, targetSimId: to.id });
  }
  const delay = 5 + random(st) * 40;
  const reply = (text: string, extra: Partial<Parameters<typeof queueReply>[1]> = {}) => queueReply(game, { at: st.time + delay, to: sim.id, from: to.id, text, ...extra });
  const night = game.hour >= 22 || game.hour < 7;
  switch (kind) {
    case 'chat':
      if (f < -25) reply(pick(st, ['Leave me alone.', 'Not now.', '👍']), { friendship: -1 });
      else if (!rel?.met || f < 5) reply(pick(st, ['Oh hi 🙂', 'Hey! Who is this? 😅 Oh hi!', 'Hiya, all good thanks!']), { friendship: 3 });
      else reply(pick(st, ['Aww hiya! All good here, you? 😊', 'Was just thinking about you!', 'Ey up! Not bad thanks, bit tired 😴', 'Good thanks! Did you see the weather? ☔']), { friendship: 4 });
      break;
    case 'meme':
      if (chance(st, 0.25)) reply(pick(st, ['Seen it 🙄', '...', 'Old one that 😅']), { friendship: 1 });
      else reply(pick(st, ['😂😂😂', "STOP I'm crying 🤣", "That's literally you", 'Hahaha sending this to everyone']), { friendship: 5, moodlet: 'lol_meme' });
      break;
    case 'invite': {
      const already = to.location === 'lot' || st.pendingVisits.some((v) => v.simId === to.id);
      if (already) { reply(to.location === 'lot' ? "I'm already at yours, silly! 😂" : 'Already on my way! 🚶'); break; }
      if (night) { reply("It's a bit late now! Another day? 😴", { friendship: 1 }); break; }
      const p = clamp(0.35 + f / 120, 0.1, 0.95);
      if (to.location === 'home' && chance(st, p)) reply(pick(st, ['Yeah go on, be there soon! 🚶', 'Put the kettle on, on my way! ☕', 'Ooh yes! See you in a bit']), { friendship: 3, visit: true });
      else reply(pick(st, ["Can't today, sorry! 😕", 'Busy right now, another time?', "I'm out at the minute! x"]));
      break;
    }
    case 'flirt': {
      if (f >= 30 || r >= 15) reply(pick(st, ['😳 Stop it, you! ❤️', "You're so sweet 🙈 x", 'Aww 😊 Me too x', 'A date? Yes please! ❤️']), { friendship: 2, romance: 6, moodlet: 'flirty' });
      else reply(pick(st, ['Erm... ok 😬', "Let's just be friends x", "Haha, you're funny 😅"]), { friendship: -3, romance: -3, moodlet: 'embarrassed' });
      break;
    }
    case 'sorry':
      reply(f < 0 ? pick(st, ["Ok. Thanks for saying sorry.", "It's fine, forget it 🤗"]) : pick(st, ['Sorry for what? 😂', "Don't be daft, we're fine x"]), { friendship: f < 20 ? 7 : 2 });
      break;
  }
  return { ok: true };
}

function queueReply(game: Game, p: NonNullable<Game['state']['phoneQueue']>[number]): void {
  const q = (game.state.phoneQueue ??= []);
  q.push(p);
  if (q.length > 40) q.shift();
}

/** Ring someone for a natter. */
export function startCall(game: Game, sim: Sim, toId: number): PhoneResult {
  const to = game.sim(toId);
  if (!to) return { ok: false };
  const can = canUsePhone(sim);
  if (!can.ok) return can;
  if (sim.location !== 'lot') return { ok: false, why: `${sim.name} can call when they're home.` };
  if (to.location === 'lot') return { ok: false, why: `${to.name} is here! Just go and talk to them.` };
  const f = findRel(game.state, sim.id, to.id)?.friendship ?? 0;
  if (f < -30) return { ok: false, why: `${to.name} won't pick up.` };
  enqueue(game, sim, { kind: 'self', selfId: 'call', label: `Call ${to.name.split(' ')[0]}`, icon: '📞', userQueued: true, targetSimId: to.id });
  return { ok: true };
}

/** A phone call finished (made or answered). */
export function callDone(game: Game, sim: Sim, otherId: number | undefined): void {
  const st = game.state;
  const other = otherId !== undefined ? game.sim(otherId) : undefined;
  if (!other) return;
  changeRel(st, sim.id, other.id, 6, 0);
  addMoodlet(sim, 'nice_call', st.time);
  game.think(sim, '📞', 10);
}

export function textDone(game: Game, sim: Sim): void {
  game.think(sim, '💬', 8);
}

export function answerCall(game: Game, sim: Sim, yes: boolean): PhoneResult {
  const call = sim.call;
  if (!call) return { ok: false, why: 'The phone stopped ringing.' };
  sim.call = null;
  const caller = game.sim(call.from);
  if (!yes) {
    if (caller) changeRel(game.state, sim.id, caller.id, -2, 0);
    addMsg(game, sim, { from: call.from, text: '📞 Declined call' });
    return { ok: true };
  }
  if (sim.current && !sim.current.userQueued && sim.current.anim !== 'sleep') interrupt(game, sim);
  enqueue(game, sim, { kind: 'self', selfId: 'call', label: `On the phone to ${caller?.name.split(' ')[0] ?? 'a friend'}`, icon: '📞', userQueued: true, targetSimId: call.from }, true);
  return { ok: true };
}

/** Say yes or no to an invitation, an extra shift or a bill. */
export function answerOffer(game: Game, sim: Sim, msgId: number, yes: boolean): PhoneResult {
  const st = game.state;
  const msg = sim.phone?.msgs.find((m) => m.id === msgId);
  const offer = msg?.offer;
  if (!msg || !offer) return { ok: false };
  if (offer.answer) return { ok: false, why: 'Already answered.' };
  if (offer.until < st.time) return { ok: false, why: 'Too late, that was a while ago!' };
  const from = typeof msg.from === 'number' ? game.sim(msg.from) : undefined;
  switch (offer.kind) {
    case 'visit':
      if (yes) {
        if (!from) return { ok: false };
        if (from.location !== 'lot' && !st.pendingVisits.some((v) => v.simId === from.id)) st.pendingVisits.push({ simId: from.id, at: st.time + 15 + random(st) * 25 });
        addMsg(game, sim, { from: msg.from, text: 'Yes! Come round 😊', out: true });
        receive(game, sim, msg.from, 'On my way! 🚶', undefined, true);
        changeRel(st, sim.id, from.id, 3, 0);
      } else addMsg(game, sim, { from: msg.from, text: 'Not today sorry! x', out: true });
      break;
    case 'walk':
      if (yes) {
        if (sim.location !== 'lot') return { ok: false, why: `${sim.name} isn't home.` };
        addMsg(game, sim, { from: msg.from, text: 'Yes! Meet you there 🌳', out: true });
        enqueue(game, sim, { kind: 'outing', selfId: 'walk', label: OUTINGS.walk?.name ?? 'Go for a walk', icon: '🌳', userQueued: true });
        if (from) changeRel(st, sim.id, from.id, 6, 0);
      } else addMsg(game, sim, { from: msg.from, text: "Can't right now, sorry!", out: true });
      break;
    case 'shift':
      if (yes) {
        if (!sim.career) return { ok: false, why: 'No job any more!' };
        sim.career.bonus = (sim.career.bonus ?? 0) + (offer.pay ?? 0);
        sim.career.performance = clamp(sim.career.performance + 6, -100, 100);
        addMsg(game, sim, { from: msg.from, text: 'Yes, no problem 👍', out: true });
      } else addMsg(game, sim, { from: msg.from, text: "Sorry, I can't this time.", out: true });
      break;
    case 'bills':
      // Paying happens through the normal bill command (it may need a money manager).
      break;
  }
  offer.answer = yes ? 'yes' : 'no';
  return { ok: true };
}

export function markRead(sim: Sim): void {
  const p = phoneOf(sim);
  p.readUpTo = p.msgs.reduce((m, x) => Math.max(m, x.id), p.readUpTo);
}

// ---------- Shopping ----------

export function order(game: Game, item: string): PhoneResult {
  const it = SHOP_ITEMS[item];
  const st = game.state;
  if (!it) return { ok: false };
  if (st.household.funds < it.price) return { ok: false, why: `That costs £${it.price}.` };
  game.addFunds(-it.price);
  (st.deliveries ??= []).push({ at: st.time + it.hours * 60, item });
  game.sound('cash');
  return { ok: true };
}

function deliver(game: Game, item: string): void {
  const h = game.state.household;
  if (item === 'groceries') h.groceries = Math.min(200, h.groceries + 25);
  if (item === 'petfood') h.petFood += 15;
  if (item === 'treats') h.petTreats = (h.petTreats ?? 0) + 10;
  const it = SHOP_ITEMS[item];
  game.notify(`🚚 Your delivery arrived: ${it?.name.toLowerCase() ?? item}.`, it?.icon ?? '📦', 'good');
  game.sound('doorbell');
  const who = game.household().find((s) => s.location === 'lot') ?? game.household()[0];
  if (who) receive(game, who, 'shop', `Your ${it?.name ?? item} has been delivered. Thank you for shopping with us!`, undefined, true);
}

// ---------- Every minute and every hour ----------

export function phoneTick(game: Game): void {
  const st = game.state;
  const now = st.time;
  if (st.phoneQueue?.length) {
    const due = st.phoneQueue.filter((p) => p.at <= now);
    if (due.length) {
      st.phoneQueue = st.phoneQueue.filter((p) => p.at > now);
      for (const p of due) {
        const to = game.sim(p.to);
        if (!to) continue;
        receive(game, to, p.from, p.text);
        if (p.friendship || p.romance) changeRel(st, p.to, p.from, p.friendship ?? 0, p.romance ?? 0);
        if (p.moodlet) addMoodlet(to, p.moodlet, now);
        const friend = game.sim(p.from);
        if (p.visit && friend && friend.location === 'home' && !st.pendingVisits.some((v) => v.simId === friend.id)) st.pendingVisits.push({ simId: friend.id, at: now + 15 + random(st) * 20 });
      }
    }
  }
  if (st.deliveries?.length) {
    const due = st.deliveries.filter((d) => d.at <= now);
    if (due.length) {
      st.deliveries = st.deliveries.filter((d) => d.at > now);
      for (const d of due) deliver(game, d.item);
    }
  }
  for (const sim of game.household()) {
    const call = sim.call;
    if (!call) continue;
    const idle = !sim.current || (!sim.current.userQueued && sim.current.anim !== 'sleep');
    // Left ringing: Sims with free will pick up themselves.
    if (now >= call.until - 10 && st.settings.freeWill === 'full' && idle && sim.location === 'lot') { answerCall(game, sim, true); continue; }
    if (now >= call.until) {
      sim.call = null;
      addMsg(game, sim, { from: call.from, text: '📞 Missed call' });
      changeRel(st, sim.id, call.from, -1, 0);
    }
  }
}

const INCOMING = {
  hello: ['Hiya! What you up to? 😊', 'Did you see the match last night? ⚽', 'Morning! Lovely day for it ☀️', 'Mum says hi 👋', 'Are you going to the market on Saturday?', "Guess who I just saw in Aldi 👀", "It's chucking it down here ☔ typical!", "Can't wait for the weekend 🙌"],
  visit: ['Fancy a brew at yours later? ☕', 'Can I pop round for a bit?', "I'm bored! Can I come over? 😅"],
  walk: ['Going for a walk round Town Green, coming? 🌳', 'Fancy a stroll? Lovely out!'],
  love: ['Miss you ❤️', 'Thinking about you 😊', 'Night night ❤️ x'],
  dog: ['Saw your dog earlier, so cute! 🐕', 'How is the dog doing? 🐾'],
};

export function phoneHour(game: Game, hour: number): void {
  const st = game.state;
  const now = st.time;
  // Old invitations lapse.
  for (const sim of game.household()) for (const m of sim.phone?.msgs ?? []) if (m.offer && !m.offer.answer && m.offer.until < now) m.offer.answer = 'no';
  if (hour < 8 || hour > 21) return;
  for (const sim of game.household()) {
    if (sim.current?.anim === 'sleep' && sim.current.phase === 'perform') continue;
    const friends = contacts(game, sim).filter((o) => (findRel(st, sim.id, o.id)?.friendship ?? 0) > -10);
    if (sim.location !== 'work' && friends.length && chance(st, 0.07)) {
      const weights = friends.map((o) => 10 + Math.max(0, findRel(st, sim.id, o.id)?.friendship ?? 0));
      let r = random(st) * weights.reduce((a, b) => a + b, 0);
      let who = friends[0];
      for (let i = 0; i < friends.length; i++) { r -= weights[i]; if (r <= 0) { who = friends[i]; break; } }
      const rel = findRel(st, sim.id, who.id);
      const roll = random(st);
      if ((rel?.romance ?? 0) >= 30 && roll < 0.3) receive(game, sim, who.id, pick(st, INCOMING.love));
      else if (roll < 0.3 && who.location === 'home' && sim.location === 'lot' && hour <= 19) receive(game, sim, who.id, pick(st, INCOMING.visit), { kind: 'visit', until: now + 120 });
      else if (roll < 0.45 && sim.location === 'lot' && hour >= 9 && hour <= 18 && OUTINGS.walk) receive(game, sim, who.id, pick(st, INCOMING.walk), { kind: 'walk', until: now + 90 });
      else receive(game, sim, who.id, st.pets.some((p) => p.species === 'dog') && chance(st, 0.25) ? pick(st, INCOMING.dog) : pick(st, INCOMING.hello));
    }
    // Someone rings.
    const callers = friends.filter((o) => (findRel(st, sim.id, o.id)?.friendship ?? 0) >= 15 && o.location !== 'lot');
    if (sim.location === 'lot' && !sim.call && callers.length && chance(st, 0.03)) {
      const who = pick(st, callers);
      sim.call = { from: who.id, until: now + 25 };
      game.sound('phone');
      game.notify(`📞 ${who.name} is calling ${sim.name.split(' ')[0]}!`, '📞', 'info');
    }
    // The boss asks about extra hours.
    if (hour === 18 && sim.career && !sim.career.bonus && chance(st, 0.12)) {
      const lvl = CAREERS[sim.career.id]?.levels[sim.career.level];
      if (lvl) {
        const pay = Math.round(lvl.pay * 3);
        receive(game, sim, 'boss', `Hi ${sim.name.split(' ')[0]}, can you do 3 extra hours on your next shift? You'd get an extra £${pay}.`, { kind: 'shift', until: now + 240, pay });
      }
    }
  }
}

/** The weekly bills arrive by text too, with a Pay button. */
export function billsText(game: Game, amount: number): void {
  const who = game.household()[0];
  if (who) receive(game, who, 'bank', `Your weekly bills of £${amount} are due within 3 days.`, { kind: 'bills', until: game.state.time + 3 * 1440 }, true);
}

/** The boss's extra-shift pay, added when the shift ends. */
export function takeBonus(sim: Sim): number {
  const b = sim.career?.bonus ?? 0;
  if (sim.career) sim.career.bonus = 0;
  return b;
}

