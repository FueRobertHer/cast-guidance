import type { Ability, ChoiceOption } from '../types';

/**
 * The Draconic Ancestry tables (curated): the dragon fixes the damage type, and
 * in the 2014 Player's Handbook the breath weapon's area and save too. The
 * Dragonborn of both Player's Handbooks and the 2014 Draconic Bloodline sorcerer
 * share the ten chromatic and metallic dragons; Fizban's splits them into its
 * Chromatic and Metallic Dragonborn and adds the gem dragons.
 */
export const DRACONIC_ANCESTRY: Readonly<
  Record<string, { type: string; area?: string; targetAbility?: Ability }>
> = {
  black: { type: 'acid', area: '5 by 30 ft line', targetAbility: 'dex' },
  blue: { type: 'lightning', area: '5 by 30 ft line', targetAbility: 'dex' },
  brass: { type: 'fire', area: '5 by 30 ft line', targetAbility: 'dex' },
  bronze: { type: 'lightning', area: '5 by 30 ft line', targetAbility: 'dex' },
  copper: { type: 'acid', area: '5 by 30 ft line', targetAbility: 'dex' },
  gold: { type: 'fire', area: '15 ft cone', targetAbility: 'dex' },
  green: { type: 'poison', area: '15 ft cone', targetAbility: 'con' },
  red: { type: 'fire', area: '15 ft cone', targetAbility: 'dex' },
  silver: { type: 'cold', area: '15 ft cone', targetAbility: 'con' },
  white: { type: 'cold', area: '15 ft cone', targetAbility: 'con' },
  amethyst: { type: 'force' },
  crystal: { type: 'radiant' },
  emerald: { type: 'psychic' },
  sapphire: { type: 'thunder' },
  topaz: { type: 'necrotic' },
};

const CHROMATIC = ['black', 'blue', 'green', 'red', 'white'];
const METALLIC = ['brass', 'bronze', 'copper', 'gold', 'silver'];
const GEM = ['amethyst', 'crystal', 'emerald', 'sapphire', 'topaz'];
/** The Player's Handbooks' ten, in their tables' order. */
export const DRAGONS = [...CHROMATIC, ...METALLIC].sort();

/**
 * The dragons a Dragonborn of this name can descend from, or nothing for a race
 * that is no Dragonborn. Fizban's names its kinds in the race's name
 * ("Dragonborn (Gem; Topaz)"); every other Dragonborn draws on all ten.
 */
export function ancestryDragons(raceName: string): readonly string[] | undefined {
  const name = raceName.toLowerCase();
  if (!name.includes('dragonborn')) return undefined;
  if (/\bgem\b/.test(name)) return GEM;
  if (/\bchromatic\b/.test(name)) return CHROMATIC;
  if (/\bmetallic\b/.test(name)) return METALLIC;
  return DRAGONS;
}

/** The dragon a name states, among those given ("Dragonborn (Blue)", "Ravenite; Red"). */
export function namedDragon(names: string, among: readonly string[]): string | undefined {
  const words: string[] = names.toLowerCase().match(/[a-z]+/g) ?? [];
  return among.find((d) => words.includes(d));
}

/** A pick of a dragon, each labelled with its damage type: "Red (fire)". */
export function dragonOptions(among: readonly string[]): ChoiceOption[] {
  return among.map((d) => ({
    id: d,
    label: `${d[0]?.toUpperCase() ?? ''}${d.slice(1)} (${DRACONIC_ANCESTRY[d]?.type ?? ''})`,
  }));
}
