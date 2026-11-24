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

export type ActionKind = 'object' | 'seat' | 'social' | 'self' | 'goto' | 'work' | 'leave' | 'respond' | 'outing' | 'pet';

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
  petId?: number;
  petAction?: string;
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

export interface CareerState {
  id: string; level: number; performance: number; daysWorked: number; workedToday: boolean;
  /** Extra pay agreed by text for the next shift. */
  bonus?: number;
}

/** A text message on a Sim's phone. `from` is a townie's id, or a service ('boss', 'bank', 'shop', 'vet'). */
export interface PhoneMsg {
  id: number;
  from: number | string;
  text: string;
  time: number;
  /** Sent by this Sim (to `from`, the other person in the conversation). */
  out?: boolean;
  offer?: PhoneOffer;
}

export interface PhoneOffer {
  kind: 'visit' | 'walk' | 'shift' | 'bills';
  until: number;
  answer?: 'yes' | 'no';
  pay?: number;
}

/** A reply on its way (people take a while to text back). */
export interface PendingText {
  at: number;
  to: number;
  from: number;
  text: string;
  friendship?: number;
  romance?: number;
  visit?: boolean;
  moodlet?: string;
}

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
  /** 0 (fresh on) to 100 (filthy). */
  clothesDirt?: number;
  phone?: { msgs: PhoneMsg[]; readUpTo: number };
  /** Someone ringing this Sim's phone. */
  call?: { from: number; until: number } | null;
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
    petFood: number;
    /** Clean outfits in the wardrobes, and pet treats in the cupboard. */
    cleanClothes?: number;
    petTreats?: number;
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
  pets: Pet[];
  /** Family mode: several people sharing one household on one device. */
  family?: FamilyState;
  /** Spending requests waiting for a money manager (when playing on several devices). */
  approvals?: Approval[];
  /** Text replies on their way, and online shopping on its way. */
  phoneQueue?: PendingText[];
  deliveries?: { at: number; item: string }[];
  noise: { tonight: number; stage: number };
  fireworksUntil: number;
}

export type PlayerRole = 'manager' | 'member';

export interface Player {
  id: number;
  name: string;
  color: string;
  role: PlayerRole;
  /** Weekly spending allowance for members (managers can spend freely). */
  allowance: number;
  spent: number;
  /** Optional 4-digit PIN so players can't switch to each other (or approve their own spending). */
  pin: string;
}

export interface Approval {
  id: number;
  playerId: number;
  what: string;
  amount: number;
  household: boolean;
  reason: 'needsApproval' | 'managerOnly';
  cmd: import('./commands').Cmd;
  time: number;
}

export interface FamilyState {
  enabled: boolean;
  players: Player[];
  activeId: number;
  /** Which player looks after each Sim. Sims not listed can be played by anyone. */
  owners: Record<number, number>;
}

export type PetAnim = 'idle' | 'walk' | 'run' | 'sleep' | 'sit' | 'eat' | 'happy' | 'pounce' | 'hop';

export interface PetTask {
  kind: 'wander' | 'eat' | 'sleep' | 'follow' | 'withSim' | 'idle' | 'poo';
  path: Point[];
  i: number;
  until: number;
  targetId?: number;
}

export interface Pet {
  id: number;
  species: string;
  name: string;
  color: string;
  /** 0–100 needs, plus how attached the pet is to the family. */
  hunger: number;
  fun: number;
  clean: number;
  energy: number;
  bond: number;
  pos: Point;
  facing: number;
  anim: PetAnim;
  location: 'lot' | 'away';
  /** Cage, hutch or perch for pets that don't roam. */
  homeId: number | null;
  task: PetTask | null;
  words: number;
  tricks: number;
  say: { text: string; until: number } | null;
  warnedAt: number;
  adopted: number;
  /** Needs the toilet at 100. */
  poo?: number;
  fleas?: boolean;
  /** Flea treatment works until this time. */
  fleaGuard?: number;
  /** Poorly since this time (needs the vet), or undefined. */
  sickSince?: number;
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
