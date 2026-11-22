// Core simulation types. Nothing in src/sim may import Babylon.js or touch the DOM.

export type NeedId = 'hunger' | 'energy' | 'hygiene' | 'bladder' | 'fun' | 'social' | 'comfort' | 'room';
export const NEED_IDS: NeedId[] = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'comfort', 'room'];
export type Needs = Record<NeedId, number>;

export type SkillId = 'cooking' | 'fitness' | 'creativity' | 'music' | 'logic' | 'charisma' | 'gardening';
export const SKILL_IDS: SkillId[] = ['cooking', 'fitness', 'creativity', 'music', 'logic', 'charisma', 'gardening'];

/** Animation names understood by the view. */
export type AnimId =
  | 'idle' | 'walk' | 'sit' | 'sleep' | 'eat' | 'talk' | 'dance' | 'workout' | 'use' | 'cook'
  | 'guitar' | 'piano' | 'paint' | 'read' | 'watch' | 'shower' | 'garden' | 'phone' | 'wave' | 'think'
  | 'sad' | 'cheer' | 'run' | 'hoover';

export type FreeWill = 'off' | 'low' | 'full';

export interface Point { x: number; z: number }

export interface Appearance {
  body: 'slim' | 'average' | 'broad';
  height: number;          // 0.9 .. 1.1
  skin: string;            // hex colour
  hairStyle: string;
  hairColor: string;
  eyeColor: string;
  face: number;            // face shape preset 0..3
  freckles: boolean;
  top: string;             // tshirt | longsleeve | hoodie | dress | jumper
  topColor: string;
  bottom: string;          // trousers | jeans | joggers | leggings | shorts | skirt
  bottomColor: string;
  shoeColor: string;
  // Added later; filled in by normalizeAppearance for older saves.
  figure?: 'straight' | 'curvy';
  eyeSize?: number;        // 0.8 .. 1.2
  eyeSpacing?: number;     // 0.85 .. 1.15
  noseSize?: number;       // 0.75 .. 1.3
  mouthWidth?: number;     // 0.8 .. 1.25
  brows?: 'thin' | 'medium' | 'thick';
  lashes?: boolean;
  lipColor?: string;
  blush?: boolean;
  shoes?: 'trainers' | 'boots' | 'shoes';
  accessory?: 'none' | 'glasses' | 'sunglasses' | 'earrings' | 'beanie' | 'cap';
  accessoryColor?: string;
}

export interface ActiveMoodlet { id: string; expires: number }

export type ActionKind = 'object' | 'seat' | 'social' | 'self' | 'goto' | 'work' | 'leave' | 'respond' | 'outing';

export interface QueuedAction {
  uid: number;
  kind: ActionKind;
  label: string;
  icon: string;
  userQueued: boolean;
  objectId?: number;
  interactionId?: string;
  targetSimId?: number;
  socialId?: string;
  selfId?: string;
  dest?: Point;
  /** Inline definition for 'seat' follow-ups (eat a cooked meal, etc). */
  inline?: InlineAction;
}

export interface InlineAction {
  anim: AnimId;
  duration: number;
  effects: Partial<Record<NeedId, number>>;
  moodlet?: string;
  counter?: string;
  tags?: string[];
}

export interface RunningAction extends QueuedAction {
  phase: 'route' | 'walk' | 'perform';
  path: Point[];
  pathIndex: number;
  elapsed: number;
  duration: number;
  /** Need change per game minute while performing. */
  rates: Partial<Record<NeedId, number>>;
  anim: AnimId;
  untilFull: NeedId[];
  tags?: string[];
  /** Object + spot this action has reserved (may differ from objectId when sitting near a TV). */
  reserved?: { objectId: number; spot: number };
  /** Where the Sim stands/sits while performing. */
  pose?: { x: number; z: number; facing: number; objectId?: number };
  /** Where to put the Sim back afterwards (when the pose is inside furniture). */
  returnTo?: Point;
  skill?: string;
  skillRate?: number;
  waitTime: number;
  partnerOk?: boolean;
}

export interface CareerState { id: string; level: number; performance: number; daysWorked: number; workedToday: boolean }

export interface Sim {
  id: number;
  name: string;
  isTownie: boolean;
  district?: string;
  appearance: Appearance;
  traits: string[];
  aspiration: string;
  aspirationStep: number;
  rewardPoints: number;
  needs: Needs;
  /** Skill experience points; level is derived in skills.ts. */
  skills: Record<SkillId, number>;
  career: CareerState | null;
  moodlets: ActiveMoodlet[];
  pos: Point;
  facing: number;
  anim: AnimId;
  /** Furniture the Sim is posed on (sitting, sleeping). */
  poseObjectId: number | null;
  location: 'lot' | 'work' | 'away' | 'home';
  awayUntil: number;
  awayReason?: string;
  queue: QueuedAction[];
  current: RunningAction | null;
  thinkCooldown: number;
  thought: { icon: string; until: number } | null;
  counters: Record<string, number>;
  visitUntil: number;
  /** Unlocked reward traits/perks. */
  perks: string[];
  /** Recently finished activities, so free will doesn't repeat itself. */
  recent: string[];
  driving: { lessons: number; licence: boolean };
}

export type WallKind = 'wall' | 'door' | 'window';
export interface Wall { kind: WallKind; paint: [string, string] }

export interface PlacedObject {
  id: number;
  defId: string;
  x: number;
  z: number;
  rot: 0 | 1 | 2 | 3;
  /** Which Sim is using each spot. */
  users: (number | null)[];
  dirt: number;
  growth: number;
  lightOn: boolean;
  bought: number;
  /** Seasonal objects disappear after this day. */
  expiresDay?: number;
  /** A car out on the road with this Sim. */
  outWith?: number | null;
  /** Blocked drain or broken boiler. */
  broken?: boolean;
  /** Wheelie bin out on the kerb, and where it lives the rest of the week. */
  atKerb?: boolean;
  /** Washing on the line (amount), and petrol in the car (0–100). */
  load?: number;
  fuel?: number;
  home?: { x: number; z: number };
}

export interface Lot {
  width: number;
  depth: number;
  walls: Record<string, Wall>;
  floors: (string | null)[];
  objects: PlacedObject[];
  /** Bumped whenever walls, floors or objects change, so the view knows to redraw. */
  version: number;
}

export interface Relationship { a: number; b: number; friendship: number; romance: number; partners: boolean; met: boolean }

export interface GameNotification {
  id: number;
  time: number;
  text: string;
  icon: string;
  kind: 'info' | 'good' | 'bad' | 'bills';
  read: boolean;
}

export interface Bills { amount: number; issued: number; dueBy: number }

export interface GameState {
  version: number;
  rng: number;
  time: number;           // game minutes since Monday of week 1 at 00:00
  speed: 0 | 1 | 2 | 3;
  household: {
    name: string;
    funds: number;
    memberIds: number[];
    rewardsUnlocked: string[];
    marketFinds: string[];
    paintingsSold: number;
    /** Units of food in the fridge. */
    groceries: number;
    /** 0–100. Late-night noise makes the neighbours unhappy. */
    neighbourMood: number;
    nextDoorId: number;
    /** 0–100 chores that build up. */
    dust: number;
    weeds: number;
    rubbish: number;
    subscriptions: { netflix: boolean; sky: boolean };
    /** One-off money off the next Buy mode purchase (0–1). */
    discount: number;
    /** Dirty clothes and bedding waiting to be washed (0–100), and a washed load waiting to dry. */
    laundry: number;
    wetWashing: number;
    /** Extra electricity this week (tumble dryer). */
    extraEnergy: number;
  };
  sims: Sim[];
  relationships: Relationship[];
  lot: Lot;
  bills: Bills | null;
  notifications: GameNotification[];
  settings: { freeWill: FreeWill; romance: boolean };
  nextId: number;
  selectedSimId: number;
  lastVisitDay: number;
  tutorialDone: boolean;
  pendingVisits: { simId: number; at: number }[];
  flags: { lastHour: number; nextVisitAt: number; lowFoodWarned?: boolean };
  party: Party | null;
  noise: { tonight: number; stage: number };
  fireworksUntil: number;
}

export interface Party {
  host: number;
  theme: 'karaoke' | 'dance' | 'bbq';
  start: number;
  end: number;
  guests: number[];
  started: boolean;
}

export type GameEvent =
  | { type: 'notify'; notification: GameNotification }
  | { type: 'sound'; sound: string }
  | { type: 'dayEnded'; day: number }
  | { type: 'lotChanged' }
  | { type: 'openPanel'; panel: string; simId: number }
  | { type: 'funds'; delta: number };
