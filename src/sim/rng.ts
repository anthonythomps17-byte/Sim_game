// Seeded random numbers (mulberry32). The seed lives in the game state, so runs are repeatable.
import type { GameState } from './types';

export function random(state: GameState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(state: GameState, min: number, max: number): number {
  return min + Math.floor(random(state) * (max - min + 1));
}

export function pick<T>(state: GameState, list: readonly T[]): T {
  return list[Math.floor(random(state) * list.length)];
}

export function chance(state: GameState, p: number): boolean {
  return random(state) < p;
}
