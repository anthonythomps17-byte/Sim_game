// Walking a Sim directly with the joystick (or WASD). The Sim walks where the player points,
// bumping into walls and furniture, and steps between home and town at the front of the lot.
import type { Game } from './game';
import { interrupt } from './actions';
import { inLot, wallBetween } from './lot';
import { TOWN_ORIGIN, TOWN_D } from './town';
import type { Sim } from './types';
import { pooAt } from './pets';
import { addClothesDirt } from './clothes';
import { addMoodlet } from './mood';

const SPEED = 2.3; // tiles per game minute (a brisk walk)
/** How long free will leaves a steered Sim alone. */
const MANUAL_MINUTES = 45;

export function setSteer(game: Game, sim: Sim, dx: number, dz: number): void {
  const len = Math.hypot(dx, dz);
  if (len < 0.15) { sim.steer = null; sim.anim = 'idle'; return; }
  sim.steer = { dx: dx / Math.max(1, len), dz: dz / Math.max(1, len), until: game.state.time + 2.5 };
  sim.manualUntil = game.state.time + MANUAL_MINUTES;
}

function open(game: Game, x: number, z: number): boolean {
  const g = game.grid();
  if (!inLot(g.lot, x, z)) return false;
  return g.occ[z * g.lot.width + x] === -1;
}

function canMove(game: Game, fx: number, fz: number, tx: number, tz: number): boolean {
  if (fx === tx && fz === tz) return true;
  if (!open(game, tx, tz)) return false;
  const lot = game.grid().lot;
  if (fx !== tx && fz !== tz) {
    // Diagonal: both corners must be passable.
    return canMove(game, fx, fz, tx, fz) && canMove(game, tx, fz, tx, tz);
  }
  const wall = wallBetween(lot, fx, fz, tx, tz);
  return !wall || wall.kind === 'door';
}

/** Move a steered Sim. Returns true if the Sim is under direct control this minute. */
export function stepSteer(game: Game, sim: Sim, dt: number): boolean {
  const s = sim.steer;
  if (!s) return false;
  if (s.until < game.state.time) { sim.steer = null; sim.anim = 'idle'; return false; }
  if (sim.current) {
    if (sim.current.kind === 'respond' || sim.current.kind === 'work') return false;
    interrupt(game, sim);
    sim.current = null;
  }
  sim.queue = sim.queue.filter((q) => q.kind === 'work' || q.kind === 'respond');
  sim.poseObjectId = null;
  sim.anim = 'walk';
  sim.facing = Math.atan2(s.dx, s.dz);
  let remaining = SPEED * dt;
  while (remaining > 1e-4) {
    const step = Math.min(0.25, remaining);
    remaining -= step;
    if (!moveBy(game, sim, s.dx * step, s.dz * step)) {
      // Slide along walls.
      if (!moveBy(game, sim, s.dx * step, 0) && !moveBy(game, sim, 0, s.dz * step)) break;
    }
  }
  return true;
}

function moveBy(game: Game, sim: Sim, dx: number, dz: number): boolean {
  if (!dx && !dz) return false;
  const fx = Math.floor(sim.pos.x), fz = Math.floor(sim.pos.z);
  const nx = sim.pos.x + dx, nz = sim.pos.z + dz;
  const tx = Math.floor(nx), tz = Math.floor(nz);
  const area = game.areaOf(sim);
  // Stepping between the home lot and the street.
  if (area === 'home' && nz < 0) return cross(game, sim, 'town', { x: nx - TOWN_ORIGIN.x, z: nz - TOWN_ORIGIN.z });
  if (area === 'town' && nz >= TOWN_D) return cross(game, sim, 'home', { x: nx + TOWN_ORIGIN.x, z: nz + TOWN_ORIGIN.z });
  if (!canMove(game, fx, fz, tx, tz)) return false;
  sim.pos = { x: nx, z: nz };
  if (area === 'home' && (tx !== fx || tz !== fz) && game.isHousehold(sim)) treadIn(game, sim, tx, tz);
  return true;
}

function cross(game: Game, sim: Sim, to: 'home' | 'town', p: { x: number; z: number }): boolean {
  const ok = game.inArea(to, () => open(game, Math.floor(p.x), Math.floor(p.z)));
  if (!ok) return false;
  sim.location = to === 'town' ? 'town' : 'lot';
  if (to === 'town') { sim.counters.leftHomeAt = game.state.time; sim.counters.tripDay = game.day; if (game.isHousehold(sim)) addMoodlet(sim, 'fresh_air', game.state.time); }
  sim.pos = p;
  game.ctx = to;
  return true;
}

function treadIn(game: Game, sim: Sim, x: number, z: number): void {
  const poo = pooAt(game, x, z);
  if (!poo || poo.growth >= 1) return;
  poo.growth = 1;
  addClothesDirt(sim, 25);
  addMoodlet(sim, 'trod_in_poo', game.state.time);
  game.think(sim, '💩', 20);
  game.notify(`${sim.name} trod in poo! Yuck! 🤢`, '💩', 'bad');
  game.lotChanged();
}
