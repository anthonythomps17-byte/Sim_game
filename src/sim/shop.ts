// Shopping at Aldi: pick things off the shelves into a basket, then pay at the till.
import type { Game } from './game';
import { addMoodlet } from './mood';
import { addFood } from './life';
import { chance, pick } from './rng';
import type { Sim } from './types';

export interface Aisle { name: string; icon: string; food?: number; petFood?: number; treats?: number; cost: number; fun?: boolean }
export const AISLES: Record<string, Aisle> = {
  tins: { name: 'tins and pasta', icon: '🥫', food: 8, cost: 6 },
  snacks: { name: 'snacks and sweets', icon: '🍫', food: 3, cost: 3, fun: true },
  bakery: { name: 'bread and cakes', icon: '🥖', food: 4, cost: 4 },
  veg: { name: 'fruit and veg', icon: '🥕', food: 6, cost: 5 },
  fridge: { name: 'milk, cheese and meat', icon: '🧀', food: 8, cost: 9 },
  freezer: { name: 'frozen food', icon: '🧊', food: 8, cost: 7 },
  pets: { name: 'pet food and treats', icon: '🦴', petFood: 10, treats: 3, cost: 8 },
};

export function basketOf(sim: Sim) { return sim.basket; }

export function pickItem(game: Game, sim: Sim, aisle: string): void {
  const a = AISLES[aisle];
  if (!a || !game.isHousehold(sim)) return;
  const b = (sim.basket ??= { food: 0, petFood: 0, treats: 0, cost: 0, items: 0 });
  b.food += a.food ?? 0;
  b.petFood += a.petFood ?? 0;
  b.treats += a.treats ?? 0;
  b.cost += a.cost;
  b.items++;
  game.think(sim, a.icon, 6);
}

export function checkout(game: Game, sim: Sim): void {
  const b = sim.basket;
  if (!b || !game.isHousehold(sim)) return;
  sim.basket = null;
  const h = game.state.household;
  if (h.funds < b.cost) {
    addMoodlet(sim, 'embarrassed', game.state.time);
    game.notify(`${sim.name}'s card was declined at the till! 😳 The shopping went back on the shelves.`, '💳', 'bad');
    return;
  }
  game.addFunds(-b.cost);
  if (b.food) addFood(game, b.food);
  h.petFood += b.petFood;
  h.petTreats = (h.petTreats ?? 0) + b.treats;
  addMoodlet(sim, 'good_shop', game.state.time);
  const got = [b.food ? `+${b.food} food` : '', b.petFood ? `+${b.petFood} pet food` : '', b.treats ? `+${b.treats} treats` : ''].filter(Boolean).join(', ');
  game.notify(`${sim.name} paid £${b.cost} at the till (${got}).`, '🛒', 'good');
  game.sound('cash');
}

export function middleAisle(game: Game, sim: Sim): void {
  const st = game.state;
  if (!game.isHousehold(sim)) return;
  if (chance(st, 0.3) && !st.household.discount) {
    st.household.discount = 0.15;
    game.notify(`${sim.name} found a bargain voucher in the middle aisle: 15% off your next Buy mode purchase!`, '🏷️', 'good');
  } else {
    const finds = ['a paddling pool, a drill and a ukulele', 'a pizza oven, ski socks and a karaoke mic', 'a kayak, a bread maker and a garden gnome', 'a hedge trimmer, fairy lights and a unicorn onesie'];
    game.notify(`${sim.name} rummaged through ${pick(st, finds)} in the middle aisle. Bought nothing!`, '🛍️', 'info');
  }
  addMoodlet(sim, 'bargain_hunt', st.time);
}

/** Leaving the shop without paying: the basket goes back. */
export function dropBasket(game: Game, sim: Sim): void {
  if (!sim.basket) return;
  sim.basket = null;
  if (game.isHousehold(sim)) game.notify(`${sim.name} left without paying, so the shopping went back on the shelves.`, '🛒', 'info');
}
