// Typed access to the JSON content files. New content means editing data, not code.
import type { AnimId, NeedId, SkillId } from './types';
import needsData from './data/needs.json';
import objectsData from './data/objects.json';
import traitsData from './data/traits.json';
import moodletsData from './data/moodlets.json';
import socialsData from './data/socials.json';
import selfData from './data/selfActions.json';
import careersData from './data/careers.json';
import aspirationsData from './data/aspirations.json';
import buildData from './data/build.json';
import namesData from './data/names.json';
import petsData from './data/pets.json';

export type Effects = Partial<Record<NeedId, number>>;

export interface FollowUpDef {
  label: string; anim: AnimId; duration: number; effects: Effects;
  tags?: string[]; moodlet?: string; moodletMinSkill?: number;
}

export interface InteractionDef {
  id: string; name: string; icon: string; duration: number; anim: AnimId;
  effects?: Effects; untilFull?: boolean;
  skill?: SkillId; skillRate?: number; minSkill?: { skill: SkillId; level: number };
  tags?: string[]; moodlet?: string; counter?: string;
  money?: number; moneyPerLevel?: number;
  /** false = only when the player asks. */
  auto?: boolean;
  visitor?: boolean;
  condition?: 'dirty' | 'grown' | 'growing' | 'empty' | 'bills' | 'lightOn' | 'lightOff' | 'night'
    | 'once' | 'uncarved' | 'carved' | 'nightOnce' | 'canDrive'
    | 'notWinter' | 'broken' | 'working' | 'netflix' | 'sky' | 'binsIn' | 'binsBack' | 'overflowing'
    | 'laundry' | 'wetWashing' | 'canHang' | 'dryWashing' | 'dirtyClothes' | 'hasTreats'
    | 'hasPet' | 'petHungry' | 'cageDirty' | 'bowlLow';
  /** Groceries used from the household's food supply. */
  food?: number;
  dirties?: number; cleans?: boolean; cleansRoom?: boolean;
  seatNear?: boolean; shared?: boolean; seated?: boolean; poseless?: boolean;
  then?: FollowUpDef;
  special?: string;
  ui?: string;
}

export interface SpotDef { at: [number, number]; alt?: [number, number][]; pose?: [number, number]; face?: 'in' | 'out' }

export interface ObjectDef {
  id: string; name: string; category: string; price: number; description: string;
  footprint: [number, number]; decor: number;
  seat?: boolean; dining?: boolean; surface?: boolean; walkable?: boolean;
  seatHeight?: number; market?: boolean; reward?: boolean;
  /** Seasonal decoration placed and removed automatically. */
  temp?: boolean;
  /** Drains that can get blocked. */
  canBlock?: boolean;
  light?: { color: string; intensity: number; range: number };
  spots: SpotDef[];
  interactions: InteractionDef[];
}

export interface TraitDef {
  id: string; name: string; icon: string; desc: string; cost?: number;
  needDecay?: Partial<Record<NeedId, number>>;
  sittingDecay?: Partial<Record<NeedId, number>>;
  tagWeight?: Record<string, number>;
  tagEffects?: Record<string, Effects>;
  skillRate?: Partial<Record<SkillId, number>>;
  skillRateAll?: number;
  socialGain?: number; socialChance?: number;
  romanceChance?: number; romanceGain?: number;
  moodBonus?: number; workPerformance?: number; growthBonus?: number;
  messMood?: number; makingMoney?: number;
}

export interface MoodletDef { id: string; name: string; icon: string; value: number; duration: number }

export interface SocialDef {
  id: string; name: string; icon: string; duration: number;
  social: number; fun?: number; friendship?: number; romance?: number;
  chance: number; minFriendship?: number; maxFriendship?: number; minRomance?: number;
  romanceAction?: boolean; failMoodlet?: string; successMoodlet?: string;
  special?: string; tags?: string[]; anim?: AnimId; auto?: boolean;
}

export interface SelfDef {
  id: string; name: string; icon: string; duration: number; anim: AnimId;
  effects?: Effects; skill?: SkillId; skillRate?: number; special?: string; ui?: string; auto?: boolean; tags?: string[];
  cost?: number; condition?: 'noFood' | 'dusty' | 'weedy'; moodlet?: string;
  /** Walk to a spot indoors / in the garden first. */
  indoors?: boolean; outdoors?: boolean;
}

export interface OutingDef {
  id: string; name: string; icon: string; duration: number; cost?: number;
  effects: Effects; skill?: SkillId; skillXp?: number; moodlet?: string;
  days?: number[]; hours?: [number, number]; special?: string; tags?: string[];
  /** Food added to the household supply. */
  groceries?: number;
  condition?: 'learner' | 'testReady' | 'canDrive' | 'hasDog';
  season?: string; seasonDays?: number[]; event?: string;
  /** The whole household goes together (holidays). */
  household?: boolean;
  /** Counts as time off work. */
  leave?: boolean;
  souvenir?: string;
}

export interface CareerLevel { title: string; pay: number; start: number; end: number; days: number[]; req: Partial<Record<SkillId, number>>; licence?: boolean }
export interface CareerDef { id: string; name: string; icon: string; desc: string; skills: SkillId[]; levels: CareerLevel[]; schoolHolidays?: boolean }

export type AspirationCond =
  | { type: 'skill'; skill: SkillId; level: number }
  | { type: 'counter'; key: string; count: number }
  | { type: 'career'; career: string; level: number }
  | { type: 'friends'; count: number; min: number }
  | { type: 'homeValue'; amount: number }
  | { type: 'rooms'; count: number };
export interface AspirationDef { id: string; name: string; icon: string; desc: string; steps: { desc: string; cond: AspirationCond; points: number }[] }

export interface SurfaceDef { id: string; name: string; color: string; pattern?: string; decor: number }

export interface NeedDef { name: string; icon: string; decayPerHour: number; weight: number }

function byId<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of list) out[item.id] = item;
  return out;
}

export const NEEDS = needsData.needs as Record<NeedId, NeedDef>;
export const NEED_TUNING = {
  sittingComfortPerHour: needsData.sittingComfortPerHour,
  sittingEnergyMult: needsData.sittingEnergyMult,
  sleepingDecayMult: needsData.sleepingDecayMult,
  workDecayMult: needsData.workDecayMult,
};

export const OBJECT_CATEGORIES = objectsData.categories as { id: string; name: string; icon: string; hidden?: boolean }[];
export const OBJECTS = byId(objectsData.objects as unknown as ObjectDef[]);
export const TRAITS = byId(traitsData.traits as TraitDef[]);
export const REWARD_TRAITS = byId(traitsData.rewardTraits as TraitDef[]);
export const ALL_TRAITS: Record<string, TraitDef> = { ...TRAITS, ...REWARD_TRAITS };
export const MOODLETS = byId(moodletsData.moodlets as MoodletDef[]);
export const SOCIALS = byId(socialsData.socials as SocialDef[]);
export const SELF_ACTIONS = byId(selfData.self as SelfDef[]);
export const OUTINGS = byId(selfData.outings as OutingDef[]);
export const CAREERS = byId(careersData.careers as CareerDef[]);
export const ASPIRATIONS = byId(aspirationsData.aspirations as AspirationDef[]);
export const REWARD_OBJECTS = aspirationsData.rewardObjects as { id: string; cost: number }[];
export const BUILD_PRICES = buildData.prices;
export const FLOORS = byId(buildData.floors as SurfaceDef[]);
export const PAINTS = byId(buildData.paints as SurfaceDef[]);
export const NAMES = namesData;

export interface PetActionDef {
  id: string; name: string; icon: string; duration: number; anim: AnimId;
  effects?: Effects; skill?: SkillId; skillRate?: number;
  pet: { fun?: number; clean?: number; energy?: number; hunger?: number; bond?: number };
  moodlet?: string; special?: string; petAnim?: string;
  /** 'fleas': only when the pet has fleas; 'treats': needs pet treats. */
  condition?: 'fleas' | 'treats';
  /** Costs money (flea treatment). */
  cost?: number;
}
export interface PetSpeciesDef {
  id: string; name: string; icon: string; price: number; weekly: number; roams: boolean; speed?: number;
  habitat?: string; colors: string[]; names: string[]; desc: string;
  decay: { hunger: number; fun: number; clean: number; energy: number };
  words?: string[]; actions: PetActionDef[];
}
export const PET_SPECIES = byId(petsData.species as unknown as PetSpeciesDef[]);

export function interaction(defId: string, interactionId: string): InteractionDef | undefined {
  return OBJECTS[defId]?.interactions.find((i) => i.id === interactionId);
}
