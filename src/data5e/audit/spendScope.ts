/**
 * Which pool each feature spends. An action on the Play tab spends a pool only
 * when the two share a name, so Cutting Words never touches Bardic Inspiration
 * and a monk's Flurry of Blows never touches Focus. A regex finds the pool's name
 * but cannot tell spending it from regaining it, defining it, or casting "without
 * expending a spell slot". So the net is every feature that names a pool, and Jev
 * sorts it, one set per pool: it ignores context in `state`, so the question has
 * to name the pool itself.
 *
 * A feature that spends a pool without naming it is out of the net, and no answer
 * about its own prose could find it: 2024 Turn Undead and Divine Spark are options
 * of Channel Divinity only because the parent feature says so. Those are linked by
 * hand.
 *
 * Like a scoping set, nothing here gates a check. The answers fed `SPEND_LINKS`
 * once; the report and the audit's count say what is still outside it.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import { SPEND_LINKS } from '../../engine/curated/spendLinks';
import { chipPhrase } from '../../engine/effects/proseScan';
import { answersFor, type JudgeSet, type JudgeSubject, type JudgmentFile } from './judgments';
import { type ByType, type ProseSubject, proseSubjects } from './proseSubjects';
import { type Answers, pOf, reportSection, saysYes, showP, YES_MEANS } from './scoping';

export interface SpendPool {
  /** The set is `spend-<id>`. */
  id: string;
  /** One of it, and several of it, as the questions say them. */
  one: string;
  many: string;
  /** Prose that names the pool, whatever it then does with it. */
  names: RegExp;
  /** A narrower net, for a pool that a lot of prose names without spending it. */
  inNet?: (state: string) => boolean;
  /**
   * Its keys in `SPEND_LINKS`. None: there is no row to spend from, because using one
   * means choosing a slot's level or a die's size.
   */
  resources: readonly string[];
}

const SLOT = /\bspell slots?\b/i;
const NO_SLOT = /\bwithout (?:expending|using|needing|requiring|spending)\b[^.]*\bspell slots?\b/i;
const SPEND_VERB = /\b(?:expend|expends|expending|spend|spends|spending)\b/i;

/**
 * About 250 of the 327 features that name a spell slot only say it costs none, say
 * a granted spell can also be cast with one, which its spell row already handles,
 * or describe the slot table. This keeps a sentence that names a slot and spends.
 */
function spendsSlotWording(state: string): boolean {
  return state
    .split(/(?<=[.!?])\s+|\n/)
    .some((line) => SLOT.test(line) && !NO_SLOT.test(line) && SPEND_VERB.test(line));
}

export const SPEND_POOLS: readonly SpendPool[] = [
  {
    id: 'focus',
    one: 'one Focus Point or ki point',
    many: 'Focus Points or ki points',
    names: /\bfocus points?\b|\bki\b/i,
    resources: ['focus'],
  },
  {
    id: 'slots',
    one: 'one spell slot',
    many: 'spell slots',
    names: SLOT,
    inNet: spendsSlotWording,
    resources: [],
  },
  {
    id: 'sorcery',
    one: 'one Sorcery Point',
    many: 'Sorcery Points',
    names: /\bsorcery points?\b/i,
    resources: ['sorcery-points'],
  },
  {
    id: 'superiority',
    one: 'one Superiority Die',
    many: 'Superiority Dice',
    names: /\bsuperiority di(?:e|ce)\b/i,
    resources: ['superiority-dice'],
  },
  {
    id: 'channel',
    one: 'one use of Channel Divinity',
    many: 'uses of Channel Divinity',
    names: /\bchannel divinity\b/i,
    resources: ['channel-divinity', 'channel-divinity-paladin'],
  },
  {
    id: 'psionic',
    one: 'one Psionic Energy Die',
    many: 'Psionic Energy Dice',
    names: /\bpsionic energy\b/i,
    resources: ['psi-warrior-dice', 'soulknife-dice'],
  },
  {
    id: 'bardic',
    one: 'one use of Bardic Inspiration',
    many: 'uses of Bardic Inspiration',
    names: /\bbardic inspiration\b/i,
    resources: ['bardic-inspiration'],
  },
  {
    id: 'wildshape',
    one: 'one use of Wild Shape',
    many: 'uses of Wild Shape',
    names: /\bwild shape\b/i,
    resources: ['wild-shape'],
  },
  {
    id: 'hitdice',
    one: 'one Hit Point Die',
    many: 'Hit Point Dice',
    names: /\bhit (?:point )?di(?:e|ce)\b/i,
    resources: [],
  },
  {
    id: 'rage',
    one: 'one use of Rage',
    many: 'uses of Rage',
    names: /\brage\b/i,
    resources: ['rage'],
  },
  {
    id: 'layonhands',
    one: 'one point from the Lay on Hands pool',
    many: 'points from the Lay on Hands pool',
    names: /\blay on hands\b/i,
    resources: ['lay-on-hands'],
  },
];

export const SPENDS = 'spends';
export const FREE = 'free';
export const ONE = 'one';
export const TWO = 'two';
export const VARIES = 'varies';

/** Bump when any question below changes: every pool's set moves together. */
const SPEND_VERSION = 1;

export function spendSet(pool: SpendPool): JudgeSet {
  return {
    id: `spend-${pool.id}`,
    version: SPEND_VERSION,
    questions: [
      {
        id: SPENDS,
        instructions: `Does using this feature, or an option it describes, spend ${pool.many}? Regaining them, having them, or acting without spending them does not count.`,
      },
      {
        // 2024 Patient Defense: free to use, with a paid upgrade. Tapping it must not spend.
        id: FREE,
        instructions: `Can the character use this feature without spending any ${pool.many}?`,
      },
      {
        // "Each use" read a free base use as spending none, so these say "when it does".
        id: ONE,
        instructions: `When this feature spends ${pool.many}, does it always spend exactly ${pool.one}?`,
      },
      {
        id: TWO,
        instructions: `When this feature spends ${pool.many}, does it always spend exactly two?`,
      },
      {
        id: VARIES,
        instructions: `When this feature spends ${pool.many}, can how many it spends change, because the character chooses, because of the option taken or because of a spell's level?`,
      },
    ],
  };
}

const inNet = (pool: SpendPool, state: string) =>
  pool.names.test(state) && (pool.inNet === undefined || pool.inNet(state));

/** One run per pool: the features that name it, and that pool's questions. */
export function spendRuns(registry: ByType): Array<{ set: JudgeSet; subjects: JudgeSubject[] }> {
  const subjects = proseSubjects(registry);
  return SPEND_POOLS.map((pool) => ({
    set: spendSet(pool),
    subjects: subjects.filter((s) => inNet(pool, s.state)),
  }));
}

const DEFINES = 'defines, grows or converts the pool';
const HEADING = 'a heading: its options have the rows';
const UPGRADES = 'improves features that spend it, and spends nothing itself';
const OTHERS = 'another creature spends it';
const FOLLOWS = 'follows from spending, and spends nothing itself';
const AT_THE_CAST = 'pays for a spell, which is a choice at the cast';
const FLAVOUR = 'flavour text, which does nothing with the pool';
const PASSING = 'names the pool in passing';
const WHILE_ON = 'a benefit while the feature runs, and spends nothing itself';
const OWN_ENTRY = "the pool's curated entry already does this";
const DIE_SIZE = 'grows the die, which the sheet does not show yet';
const TRIGGERED = 'regains on a trigger, which stays a pip tap for the player';
const SLOT_BACK = 'buys a use back with a spell slot';
const ROLLS = 'rolls a d6 instead of spending it';

/**
 * Features that name a pool and are no cost on an action, per pool. Each was read,
 * so what the report still lists stays worth reading. The two pools no action can
 * spend hold only the lines Jev was unsure of: their confident spenders and buy-backs
 * stay listed until those costs have a way onto the sheet. That work needs `SLOT_BACK`
 * too, since those are real buy-backs that the report's buy-back list does not show.
 */
export const SPEND_SKIPPED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  focus: {
    'ki|monk|phb': DEFINES,
    "monk's focus|monk|xphb": DEFINES,
    'mystic focus|warrior of the mystic arts|au': DEFINES,
    'disciple of the elements|way of the four elements|phb': HEADING,
    'heightened focus|monk|xphb': UPGRADES,
    'ki-fueled attack|monk|tce': FOLLOWS,
    'open hand technique|way of the open hand|phb': FOLLOWS,
    'way of the four elements|way of the four elements|phb': FLAVOUR,
    'way of the open hand|way of the open hand|phb': FLAVOUR,
    'way of the astral self|way of the astral self|tce': FLAVOUR,
  },
  slots: {
    'pact magic|warlock|phb': DEFINES,
    'arcane dabbler|order of the wu jen|uathemysticclass': DEFINES,
    'empowered spells|spellcaster sidekick|tce': FOLLOWS,
    'awakened spellbook|order of scribes|tce': FOLLOWS,
    'twinned spell|xphb': PASSING,
    'fortified position|artillerist|efa': SLOT_BACK,
    'reanimated companion|reanimator|rhw': SLOT_BACK,
    'divine reaper|grave domain|rhw': SLOT_BACK,
    'distant transposition|conjurer|au': SLOT_BACK,
    'splintered summons|conjurer|au': SLOT_BACK,
  },
  hitdice: {
    'trait:black blood healing': FOLLOWS,
    'song of rest (d6)|bard|phb': FOLLOWS,
    'boon of bountiful health|frhof': FOLLOWS,
    'chef|tce': FOLLOWS,
    'chef|xphb': FOLLOWS,
    'vigor of the hill giant|bgg': FOLLOWS,
    'healer|xphb': OTHERS,
  },
  sorcery: {
    'sorcery points|sorcerer|phb': DEFINES,
    'lunar boons|lunar sorcery|dsotdq': 'takes a point off Metamagic, which the player taps back',
    'absorb spells|spellfire sorcery|frhof': TRIGGERED,
    'flexible casting|sorcerer|phb': DEFINES,
    'font of magic|sorcerer|phb': DEFINES,
    'font of magic|sorcerer|xphb': DEFINES,
    'metamagic adept|tce': DEFINES,
    'metamagic|sorcerer|xphb': HEADING,
    'spellfire burst|spellfire sorcery|frhof': FOLLOWS,
    'psionic sorcery|aberrant mind|tce': AT_THE_CAST,
    'psionic sorcery|aberrant sorcery|xphb': AT_THE_CAST,
  },
  superiority: {
    'combat superiority|battle master|phb': DEFINES,
    'combat superiority|battle master|xphb': DEFINES,
    'martial adept|phb': DEFINES,
    'superior technique|tce': DEFINES,
    'improved combat superiority (d10)|battle master|phb': OWN_ENTRY,
    'improved combat superiority (d12)|battle master|phb': OWN_ENTRY,
    'improved combat superiority|battle master|xphb': OWN_ENTRY,
  },
  channel: {
    'channel divinity|cleric|phb': DEFINES,
    'channel divinity|cleric|xphb': DEFINES,
    'channel divinity|paladin|phb': DEFINES,
    'channel divinity|paladin|xphb': DEFINES,
    'channel divinity|oath of glory|tce': HEADING,
    'channel divinity|oathbreaker|dmg': HEADING,
    'channel divinity|oath of the ancients|phb': HEADING,
    'channel divinity|oath of devotion|phb': HEADING,
    'channel divinity|oath of vengeance|phb': HEADING,
    'channel divinity|oath of the crown|scag': HEADING,
    'channel divinity|oath of conquest|xge': HEADING,
    'channel divinity|oath of redemption|xge': HEADING,
    'channel divinity|oath of the watchers|tce': HEADING,
    'elder champion|oath of the ancients|phb': PASSING,
    'sacred oath|paladin|phb': PASSING,
    'inescapable destruction|death domain|dmg': PASSING,
    'supreme healing|life domain|xphb': PASSING,
  },
  psionic: {
    'soul blades|soulknife|tce': HEADING,
    'psionic power|psi warrior|tce': DEFINES,
    'psionic power|psi warrior|xphb': DEFINES,
    'psionic power|soulknife|tce': DEFINES,
    'psionic power|soulknife|xphb': DEFINES,
    'order of the awakened|order of the awakened|uathemysticclass': FLAVOUR,
    'order of the immortal|order of the immortal|uathemysticclass': FLAVOUR,
    'aberrant sorcery|aberrant sorcery|xphb': FLAVOUR,
  },
  bardic: {
    'bardic inspiration|bard|phb': DEFINES,
    'bardic inspiration|bard|xphb': DEFINES,
    'bardic inspiration (d8)|bard|phb': DIE_SIZE,
    'bardic inspiration (d10)|bard|phb': DIE_SIZE,
    'bardic inspiration (d12)|bard|phb': DIE_SIZE,
    'font of inspiration|bard|phb': OWN_ENTRY,
    'magical inspiration|bard|tce': OTHERS,
    'combat inspiration|college of valor|phb': OTHERS,
    'combat inspiration|college of valor|xphb': OTHERS,
    'mote of potential|college of creation|tce': OTHERS,
    'unfailing inspiration|college of eloquence|tce': FOLLOWS,
    'animating performance|college of creation|tce': SLOT_BACK,
    "master's flourish|college of swords|xge": ROLLS,
    "eventide's splendor|college of the moon|frhof": ROLLS,
  },
  wildshape: {
    'wild shape|druid|phb': DEFINES,
    'wild shape|druid|xphb': DEFINES,
    'archdruid|druid|xphb': DEFINES,
    'wild resurgence|druid|xphb': DEFINES,
    'circle forms|circle of the moon|phb': DEFINES,
    'wild shape improvement|druid|phb': UPGRADES,
    'circle forms|circle of the moon|xphb': UPGRADES,
    'beast spells|druid|xphb': WHILE_ON,
  },
  rage: {
    'rage|barbarian|phb': DEFINES,
    'rage|barbarian|xphb': DEFINES,
    'rage of the gods|path of the zealot|xphb':
      'its own uses and a reaction that spends Rage share one chip, so a cost would mislead',
    'persistent rage|barbarian|xphb': TRIGGERED,
    'feral instinct|barbarian|phb': PASSING,
    'instinctive pounce|barbarian|xphb': FOLLOWS,
    'frenzy|path of the berserker|phb': FOLLOWS,
    'wild surge|path of wild magic|tce': FOLLOWS,
    "giant's havoc|path of the giant|bgg": WHILE_ON,
    'demiurgic colossus|path of the giant|bgg': WHILE_ON,
    'mindless rage|path of the berserker|phb': WHILE_ON,
    'reckless abandon|path of the battlerager|scag': WHILE_ON,
    'form of the beast|path of the beast|tce': WHILE_ON,
    'ancestral protectors|path of the ancestral guardian|xge': WHILE_ON,
    'rage of the wilds|path of the wild heart|xphb': WHILE_ON,
    'power of the wilds|path of the wild heart|xphb': WHILE_ON,
    'vitality of the tree|path of the world tree|xphb': WHILE_ON,
    'travel along the tree|path of the world tree|xphb': WHILE_ON,
    'path of the giant|path of the giant|bgg': FLAVOUR,
    'path of the berserker|path of the berserker|phb': FLAVOUR,
    'path of the berserker|path of the berserker|xphb': FLAVOUR,
    'path of the totem warrior|path of the totem warrior|phb': FLAVOUR,
    'path of the beast|path of the beast|tce': FLAVOUR,
    'path of the storm herald|path of the storm herald|xge': FLAVOUR,
    'path of the zealot|path of the zealot|xge': FLAVOUR,
    'path of the zealot|path of the zealot|xphb': FLAVOUR,
    'path of the wild heart|path of the wild heart|xphb': FLAVOUR,
    'path of the world tree|path of the world tree|xphb': FLAVOUR,
  },
};

/** `spends` hedged, `free` sure: buying back this feature's own use, which is no cost on it. */
function looksLikeRestore(answers: Answers): boolean {
  const spends = pOf(answers, SPENDS);
  return spends >= 0.25 && spends < 0.8 && pOf(answers, FREE) >= 0.85;
}

/** The amount and slot a new table row would start from. */
function proposal(state: string, answers: Answers): string {
  const amount = saysYes(answers, ONE)
    ? '1'
    : saysYes(answers, TWO)
      ? '2'
      : saysYes(answers, VARIES)
        ? 'varies'
        : '?';
  const slot = chipPhrase(state.toLowerCase().replace(/\s+/g, ' '), true)?.economy ?? 'none';
  return `${amount} ${slot}${pOf(answers, FREE) >= 0.8 ? ' free base use' : ''}`;
}

/** A link or a reason counts for its own pool: a feature can name several. */
const isLinked = (s: ProseSubject, pool: SpendPool) =>
  s.spendKeys.some((k) => {
    const link = SPEND_LINKS[k];
    return link !== undefined && pool.resources.includes(link.resource);
  });
const skipReason = (s: ProseSubject, pool: SpendPool) =>
  s.spendKeys.map((k) => SPEND_SKIPPED[pool.id]?.[k]).find((r) => r !== undefined);

export interface SpendCounts {
  /** Features the table covers, including the rows by hand that Jev was not sure of. */
  linked: number;
  /** Features read and left out, with a reason. */
  skipped: number;
  /** Confident spenders on a pool the table covers, with no row and no reason. */
  unlinked: number;
  /** Confident spenders of a pool no action can spend yet. */
  noCostYet: number;
  /** Subjects with no saved answers at all. */
  unasked: number;
}

interface PoolRow {
  subject: ProseSubject;
  answers: Answers;
}

/** Each pool's net, joined with today's saved answers. */
function poolRows(registry: ByType, file: JudgmentFile) {
  const subjects = proseSubjects(registry);
  return SPEND_POOLS.map((pool) => {
    const set = spendSet(pool);
    const net = subjects.filter((s) => inNet(pool, s.state));
    const rows: PoolRow[] = [];
    for (const subject of net) {
      const answers = answersFor(file, set, subject.key);
      if (answers !== undefined) rows.push({ subject, answers });
    }
    return { pool, rows, unasked: net.length - rows.length };
  });
}

export function spendCounts(registry: ByType, file: JudgmentFile): SpendCounts {
  const counts: SpendCounts = { linked: 0, skipped: 0, unlinked: 0, noCostYet: 0, unasked: 0 };
  for (const { pool, rows, unasked } of poolRows(registry, file)) {
    counts.unasked += unasked;
    for (const { subject, answers } of rows) {
      if (isLinked(subject, pool)) counts.linked++;
      else if (skipReason(subject, pool) !== undefined) counts.skipped++;
      else if (!saysYes(answers, SPENDS)) continue;
      else if (pool.resources.length === 0) counts.noCostYet++;
      else counts.unlinked++;
    }
  }
  return counts;
}

/** What is outside `SPEND_LINKS`, per pool, from saved answers. Never asks Jev. */
export function spendReport(registry: ByType, file: JudgmentFile): string {
  const out = [
    `# spend: which pool each feature spends. ${YES_MEANS}`,
    `Rows live in src/engine/curated/spendLinks.ts, reasons in SPEND_SKIPPED.`,
    '',
  ];
  for (const { pool, rows, unasked } of poolRows(registry, file)) {
    const unlinked: string[] = [];
    const skipped: string[] = [];
    const restores: string[] = [];
    const toRead: string[] = [];
    let linked = 0;
    for (const { subject, answers } of rows) {
      const line = `- ${showP(pOf(answers, SPENDS))} ${subject.label}`;
      const reason = skipReason(subject, pool);
      if (isLinked(subject, pool)) linked++;
      else if (reason !== undefined) skipped.push(`${line}: ${reason}`);
      else if (saysYes(answers, SPENDS))
        unlinked.push(`${line}: ${proposal(subject.state, answers)}`);
      else if (looksLikeRestore(answers)) restores.push(line);
      else if (pOf(answers, SPENDS) >= 0.25) toRead.push(line);
    }
    const noCost = pool.resources.length === 0 ? ' No action can spend this pool yet.' : '';
    out.push(
      `# ${pool.id}: ${rows.length} answered, ${unasked} not asked, ${linked} linked.${noCost}`,
    );
    out.push(reportSection('Spends, with no row', unlinked));
    out.push(reportSection('Left out, with a reason', skipped));
    out.push(reportSection('Looks like buying back its own use', restores));
    out.push(reportSection('Unsure, read by hand', toRead));
  }
  return out.join('\n');
}
