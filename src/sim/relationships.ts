// Friendship and romance between pairs of Sims.
import type { GameState, Relationship } from './types';
import { clamp } from './mood';

export function getRel(state: GameState, a: number, b: number): Relationship {
  const [x, y] = a < b ? [a, b] : [b, a];
  let rel = state.relationships.find((r) => r.a === x && r.b === y);
  if (!rel) {
    rel = { a: x, b: y, friendship: 0, romance: 0, partners: false, met: false };
    state.relationships.push(rel);
  }
  return rel;
}

export function findRel(state: GameState, a: number, b: number): Relationship | undefined {
  const [x, y] = a < b ? [a, b] : [b, a];
  return state.relationships.find((r) => r.a === x && r.b === y);
}

export function changeRel(state: GameState, a: number, b: number, friendship: number, romance: number): Relationship {
  const rel = getRel(state, a, b);
  rel.met = true;
  rel.friendship = clamp(rel.friendship + friendship, -100, 100);
  rel.romance = clamp(rel.romance + romance, -100, 100);
  return rel;
}

export function friendshipLabel(f: number): string {
  if (f >= 80) return 'Best friend';
  if (f >= 55) return 'Good friend';
  if (f >= 35) return 'Friend';
  if (f >= 10) return 'Acquaintance';
  if (f > -20) return 'Stranger';
  if (f > -55) return 'Disliked';
  return 'Rival';
}

export function romanceLabel(rel: Relationship): string | null {
  if (rel.partners) return 'Partner';
  if (rel.romance >= 50) return 'Sweetheart';
  if (rel.romance >= 20) return 'Crush';
  return null;
}

export function relationshipsOf(state: GameState, simId: number): { other: number; rel: Relationship }[] {
  return state.relationships
    .filter((r) => (r.a === simId || r.b === simId) && r.met)
    .map((rel) => ({ other: rel.a === simId ? rel.b : rel.a, rel }));
}

export function friendCount(state: GameState, simId: number, min: number): number {
  return relationshipsOf(state, simId).filter((r) => r.rel.friendship >= min).length;
}
