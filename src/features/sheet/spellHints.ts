/**
 * Curated "good first picks" per class — decision support for new players who
 * face an alphabetical wall of spells with no idea which matter. These are
 * widely-agreed strong, low-trap starter choices (cantrips + 1st level), NOT an
 * exhaustive or "optimal" list; the full class list stays fully selectable. Keyed
 * by lowercase class name so 2014/2024 share an entry (spell names match on name
 * only, since a spell of a given name is the same spell across sources).
 */
interface Starters {
  cantrips: string[];
  level1: string[];
}

const RECOMMENDED: Record<string, Starters> = {
  artificer: {
    cantrips: ['Fire Bolt', 'Guidance', 'Mending'],
    level1: ['Cure Wounds', 'Faerie Fire', 'Absorb Elements'],
  },
  bard: {
    cantrips: ['Vicious Mockery', 'Minor Illusion'],
    level1: ['Healing Word', 'Faerie Fire', 'Dissonant Whispers', 'Tasha’s Hideous Laughter'],
  },
  cleric: {
    cantrips: ['Sacred Flame', 'Guidance'],
    level1: ['Healing Word', 'Bless', 'Cure Wounds', 'Guiding Bolt'],
  },
  druid: {
    cantrips: ['Produce Flame', 'Shillelagh', 'Guidance'],
    level1: ['Healing Word', 'Cure Wounds', 'Entangle', 'Goodberry'],
  },
  paladin: {
    cantrips: [],
    level1: ['Bless', 'Cure Wounds', 'Command', 'Shield of Faith'],
  },
  ranger: {
    cantrips: [],
    level1: ['Hunter’s Mark', 'Cure Wounds', 'Goodberry', 'Absorb Elements'],
  },
  sorcerer: {
    cantrips: ['Fire Bolt', 'Prestidigitation', 'Minor Illusion'],
    level1: ['Shield', 'Magic Missile', 'Chromatic Orb', 'Absorb Elements'],
  },
  warlock: {
    cantrips: ['Eldritch Blast', 'Minor Illusion'],
    level1: ['Hex', 'Armor of Agathys', 'Hellish Rebuke'],
  },
  wizard: {
    cantrips: ['Fire Bolt', 'Mage Hand', 'Prestidigitation', 'Minor Illusion'],
    level1: ['Shield', 'Magic Missile', 'Find Familiar', 'Sleep', 'Detect Magic'],
  },
};

/** Lowercase + fold curly/straight apostrophes so name matching is robust. */
const norm = (s: string) => s.toLowerCase().replaceAll('’', "'");

/** The suggested starter spells for a class, or undefined if none are curated. */
export function recommendedStarters(className: string): Starters | undefined {
  return RECOMMENDED[className.toLowerCase()];
}

/**
 * Whether a spell is a curated starter pick for the class. Only cantrips (lvl 0)
 * and 1st-level spells qualify — starter guidance, not a build for every level.
 */
export function isRecommendedStarter(className: string, spellName: string, level: number): boolean {
  const rec = RECOMMENDED[className.toLowerCase()];
  if (rec === undefined) return false;
  const pool = level === 0 ? rec.cantrips : level === 1 ? rec.level1 : [];
  const name = norm(spellName);
  return pool.some((n) => norm(n) === name);
}
