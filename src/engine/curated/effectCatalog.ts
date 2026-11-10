/**
 * The effects + Effect can search (the buffs canvas, Catalog board): spells,
 * potions, an ally's features and actions, each in the character's rules
 * version, with the questions it asks before it lands (a slot level, a damage
 * type, the bard's die). A result lands as an ordinary effect in play, its
 * answers already applied: the stored effect never points back here, so this
 * table can change without touching any character.
 *
 * It is loaded in a chunk of its own when the Effects sheet opens, so the
 * sheet's first load stays as it was. The words come from each entry's text
 * in the pinned data, 2014 and 2024 checked apart: fifteen or so change what
 * the effect does between them. An entry another one grants (a Potion of
 * Speed is Haste) builds from that one's parts rather than copying them.
 */
import { storedInPlay } from '../activeEffects';
import { CAST_GUIDANCE_LIMITS, guidanceVersion, isRecord, own } from '../castGuidance';
import type { Ability, ActiveEffect, EffectDuration, EffectPart } from '../types';
import { BARDIC_DICE, bardicEffect, blessEffect, guidanceEffect } from './namedEffects';

export type Edition = '2014' | '2024';

/** The answers to an entry's questions, by each question's key. */
export type Answers = Readonly<Record<string, string | undefined>>;

/** A question an entry asks before it lands. */
export type CatalogAsk = {
  key: string;
  /** "Cast with a spell slot of". */
  label: string;
  /** Asked only when the answers so far call for it (Bear's Endurance's temp HP). */
  showIf?: (a: Answers) => boolean;
} & (
  | {
      kind: 'pick';
      options: ReadonlyArray<{ label: string; value: string }>;
      /** The choice made for you; none when no answer is likelier (a skill, a damage type). */
      initial?: string;
    }
  /** A roll the player can make here or type in: Heroes' Feast's 2d10. */
  | { kind: 'roll'; dice: string }
  /** One of the character's carried weapons that is not magical yet, by its equipment id. */
  | { kind: 'weapon' }
);

export interface CatalogEntry {
  id: string;
  /** Its name in the books: "Protection from Energy". */
  name: string;
  /** What it is: "Spell, 3rd level", "Potion", "Paladin feature, from an ally". */
  what: string;
  /** Words it is found by beside its name: what it does and what it is about. */
  keywords: string;
  /** What it does, in one line. */
  sum: string;
  /** How long it lasts, as its result says: "Concentration, up to 1 hour". */
  lastsSay: string;
  lasts: EffectDuration;
  /** New turns until it ends (Shield: the start of your next turn). */
  turnsLeft?: number;
  /** It lands only on its caster (Shield): the character must have the spell, and it is theirs. */
  self?: true;
  /** One of the character's own features (Rage): started from Play, where it spends a use. */
  own?: true;
  /** The entry whose effect it gives, when it is another's (a Potion of Speed: Haste). */
  borrows?: string;
  asks: readonly CatalogAsk[];
  /** What it does once its questions are answered, and anything it gives as it lands. */
  build: (a: Answers) => Built;
}

/** An entry's effect, worked out from its answers. */
export interface Built {
  parts: EffectPart[];
  /** The chip's name when it is not the entry's: "Protection: fire". */
  name?: string;
  /** The named effect it counts as, when that is not its name. */
  same?: string;
  /** Temporary hit points it gives as it lands, which go when it ends. */
  tempHp?: number;
}

type Spec = Omit<CatalogEntry, 'lastsSay' | 'asks'> & { asks?: readonly CatalogAsk[] };

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
const spell = (level: number) => (level === 0 ? 'Cantrip' : `Spell, ${ORDINAL[level]} level`);
const SELF = ', on its caster only';

const MINUTE = 1;
const HOUR = 60;
const conc = (minutes: number): EffectDuration => ({ minutes, concentration: true });
const timed = (minutes: number): EffectDuration => ({ minutes });

const lower = (s: string) => s.toLowerCase();
const options = (labels: readonly string[]) => labels.map((l) => ({ label: l, value: l }));

/** "1 minute", "8 hours", "24 hours". */
function span(minutes: number): string {
  if (minutes >= HOUR && minutes % HOUR === 0) {
    const h = minutes / HOUR;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** How long it lasts, said the way a result says it. */
function lastsWords(e: Spec): string {
  if (e.turnsLeft === 1) return 'Until the start of your next turn';
  if (e.turnsLeft === 2) return 'Until the end of your next turn';
  const m = e.lasts.minutes;
  const time = m === undefined ? '' : e.lasts.concentration ? `up to ${span(m)}` : span(m);
  const once = e.build({}).parts.some((p) => p.kind === 'rollOffer' && p.once === true);
  const said = e.lasts.concentration
    ? `Concentration${time === '' ? '' : `, ${time}`}`
    : time === ''
      ? 'Until you end it'
      : time.charAt(0).toUpperCase() + time.slice(1);
  return once ? `${said}, or once used` : said;
}

const cue = (tone: 'help' | 'ward' | 'warn' | 'info', text: string): EffectPart => ({
  kind: 'cue',
  tone,
  text,
});

const ENERGY = ['Acid', 'Cold', 'Fire', 'Lightning', 'Thunder'];
/** The ten Potions of Resistance in the books: none for weapon damage. */
const POTION_TYPES = [
  'Acid',
  'Cold',
  'Fire',
  'Force',
  'Lightning',
  'Necrotic',
  'Poison',
  'Psychic',
  'Radiant',
  'Thunder',
];
/** The types 2024 Resistance can cut. */
const CUT_TYPES = [
  'Acid',
  'Bludgeoning',
  'Cold',
  'Fire',
  'Lightning',
  'Necrotic',
  'Piercing',
  'Poison',
  'Radiant',
  'Slashing',
  'Thunder',
];

const typeAsk = (types: readonly string[], label = 'Which damage type'): CatalogAsk => ({
  key: 'type',
  kind: 'pick',
  label,
  options: options(types),
});

const slotAsk = (rows: ReadonlyArray<[string, string]>): CatalogAsk => ({
  key: 'slot',
  kind: 'pick',
  label: 'Cast with a spell slot of',
  options: rows.map(([label, value]) => ({ label, value })),
  initial: rows[0]?.[1],
});

const num = (s: string | undefined, fallback: number) => {
  const n = Number(s);
  return Number.isFinite(n) && s !== undefined && s !== '' ? n : fallback;
};

// ---------------------------------------------------------------------------
// Effects other entries borrow
// ---------------------------------------------------------------------------

/** Haste, as the spell gives it; a 2014 Potion of Speed keeps its lethargy, a 2024 one does not. */
function hasteParts(edition: Edition, lethargy: boolean): EffectPart[] {
  const parts: EffectPart[] = [
    { kind: 'acBonus', amount: 2 },
    { kind: 'speedMultiplier', factor: 2 },
    { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'], abilities: ['dex'] } },
    {
      kind: 'extraAction',
      label: 'Haste action',
      note:
        edition === '2024'
          ? 'Attack (one attack only), Dash, Disengage, Hide or Utilize'
          : 'Attack (one weapon attack only), Dash, Disengage, Hide or Use an Object',
    },
  ];
  if (lethargy) {
    parts.push(
      cue(
        'warn',
        edition === '2024'
          ? 'When it ends, you are Incapacitated with a speed of 0 until the end of your next turn'
          : 'When it ends, you cannot move or take actions until after your next turn',
      ),
    );
  }
  return parts;
}

/** Enlarge/Reduce, enlarged: the spell's and a Potion of Growth's. */
function enlargeParts(edition: Edition): EffectPart[] {
  return [
    { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check', 'save'], abilities: ['str'] } },
    // 2024 adds the die to Unarmed Strikes too; 2014 to weapons only, which
    // the sheet cannot tell apart from a punch, so both reach every attack row.
    { kind: 'damageDie', scope: 'all', dice: '1d4' },
    cue(
      'info',
      edition === '2024'
        ? 'You are one size larger'
        : 'You are one size larger, and your weapons with you',
    ),
  ];
}

/** Invisible, as the condition: Greater Invisibility, Invisibility and the potion. */
function invisibleParts(edition: Edition): EffectPart[] {
  return [
    { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['attack'] } },
    cue(
      'ward',
      edition === '2024'
        ? 'Attack rolls against you have disadvantage, unless the attacker can see you'
        : 'Attack rolls against you have disadvantage',
    ),
  ];
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const GIANTS: ReadonlyArray<[string, number]> = [
  ['Hill', 21],
  ['Stone', 23],
  ['Frost', 23],
  ['Fire', 25],
  ['Cloud', 27],
  ['Storm', 29],
];

const ENHANCE_2014: ReadonlyArray<[string, Ability]> = [
  ["Bear's Endurance", 'con'],
  ["Bull's Strength", 'str'],
  ["Cat's Grace", 'dex'],
  ["Eagle's Splendor", 'cha'],
  ["Fox's Cunning", 'int'],
  ["Owl's Wisdom", 'wis'],
];
const ENHANCE_2024: ReadonlyArray<[string, Ability]> = [
  ['Strength', 'str'],
  ['Dexterity', 'dex'],
  ['Intelligence', 'int'],
  ['Wisdom', 'wis'],
  ['Charisma', 'cha'],
];

/** Every entry, in the rules version given. */
function specs(edition: Edition): Spec[] {
  const is24 = edition === '2024';
  // Where a paladin's aura reaches you, and when it lapses: 2014 needs the
  // paladin conscious, 2024 has it go quiet while they are Incapacitated.
  const auraWhere = is24
    ? "Only within the paladin's aura (10 ft., or 30 ft. from 18th level), and not while they are incapacitated"
    : "Only within the paladin's aura while they are conscious: 10 ft., or 30 ft. from 18th level";
  return [
    // --- Spells cast on you -------------------------------------------------
    {
      id: 'bless',
      name: 'Bless',
      what: spell(1),
      keywords: 'd4 die attack save',
      sum: '+d4 on attacks and saves',
      lasts: conc(MINUTE),
      build: () => ({ parts: blessEffect('', false).parts }),
    },
    {
      id: 'shield-of-faith',
      name: 'Shield of Faith',
      what: spell(1),
      keywords: 'ac armor class',
      sum: '+2 to AC',
      lasts: conc(10),
      build: () => ({ parts: [{ kind: 'acBonus', amount: 2 }] }),
    },
    {
      id: 'guidance',
      name: 'Guidance',
      what: spell(0),
      keywords: 'd4 die check skill',
      sum: is24
        ? 'A d4 on your skill checks, after you see the d20'
        : 'A d4 for one ability check, after you see the d20',
      lasts: conc(MINUTE),
      build: () => ({ parts: guidanceEffect('', edition).parts }),
    },
    is24
      ? {
          id: 'resistance',
          name: 'Resistance',
          what: spell(0),
          keywords: 'd4 damage reduce cut',
          sum: 'Cuts damage of one type by 1d4, once a turn',
          lasts: conc(MINUTE),
          asks: [typeAsk(CUT_TYPES)],
          build: (a) => ({
            parts: [
              cue(
                'ward',
                `When you take ${lower(a.type ?? 'that')} damage, it is cut by 1d4, once a turn`,
              ),
            ],
            name: `Resistance: ${lower(a.type ?? '')}`,
            same: 'Resistance',
          }),
        }
      : {
          id: 'resistance',
          name: 'Resistance',
          what: spell(0),
          keywords: 'd4 die save',
          sum: 'A d4 for one saving throw, after you see the d20',
          lasts: conc(MINUTE),
          build: () => ({
            parts: [{ kind: 'rollOffer', dice: '1d4', on: { rolls: ['save'] }, once: true }],
          }),
        },
    {
      id: 'heroism',
      name: 'Heroism',
      what: spell(1),
      keywords: 'frightened fear temporary hit points temp hp',
      sum: 'Cannot be frightened, and temp HP each turn',
      lasts: conc(MINUTE),
      asks: [
        {
          key: 'mod',
          kind: 'pick',
          label: "The caster's spellcasting modifier",
          options: options(['+1', '+2', '+3', '+4', '+5']),
          initial: '+3',
        },
      ],
      build: (a) => ({
        parts: [
          { kind: 'conditionImmune', condition: 'Frightened' },
          { kind: 'tempHpEachTurn', amount: num(a.mod, 3) },
        ],
      }),
    },
    {
      id: 'longstrider',
      name: 'Longstrider',
      what: spell(1),
      keywords: 'speed fast move walk',
      sum: '+10 ft. walking speed',
      lasts: timed(HOUR),
      build: () => ({ parts: [{ kind: 'speedBonus', amount: 10 }] }),
    },
    {
      id: 'mage-armor',
      name: 'Mage Armor',
      what: spell(1),
      keywords: 'ac armor class unarmored',
      sum: 'AC 13 + Dexterity, in no armor',
      lasts: timed(8 * HOUR),
      build: () => ({
        parts: [
          { kind: 'acFormula', label: 'Mage Armor', base: 13, addAbilities: ['dex'] },
          cue('info', 'It ends if you put on armor'),
        ],
      }),
    },
    {
      id: 'protection-from-evil-and-good',
      name: 'Protection from Evil and Good',
      what: spell(1),
      keywords:
        'aberration celestial elemental fey fiend undead disadvantage charmed frightened possessed',
      sum: 'Six kinds of creature attack you at disadvantage, and cannot charm, frighten or possess you',
      lasts: conc(10),
      build: () => ({
        parts: [
          cue(
            'ward',
            'Aberrations, celestials, elementals, fey, fiends and undead have disadvantage on attacks against you, and cannot charm, frighten or possess you',
          ),
        ],
        name: 'Protection from Evil',
      }),
    },
    {
      id: 'aid',
      name: 'Aid',
      what: spell(2),
      keywords: 'hit points maximum hp',
      sum: 'Raises your hit point maximum, and your hit points with it',
      lasts: timed(8 * HOUR),
      asks: [slotAsk(ORDINAL.slice(2).map((o, i) => [o, String(5 + 5 * i)] as [string, string]))],
      build: (a) => ({ parts: [{ kind: 'maxHpBonus', amount: num(a.slot, 5) }] }),
    },
    {
      id: 'barkskin',
      name: 'Barkskin',
      what: spell(2),
      keywords: 'ac armor class',
      sum: is24 ? 'AC 17 if yours is lower' : "AC can't be less than 16",
      lasts: is24 ? timed(HOUR) : conc(HOUR),
      build: () => ({ parts: [{ kind: 'acMin', min: is24 ? 17 : 16 }] }),
    },
    is24
      ? {
          id: 'enhance-ability',
          name: 'Enhance Ability',
          what: spell(2),
          keywords: 'advantage check ability',
          sum: 'Advantage on checks with one ability',
          lasts: conc(HOUR),
          asks: [
            {
              key: 'ability',
              kind: 'pick',
              label: 'Which ability',
              options: options(ENHANCE_2024.map(([n]) => n)),
            },
          ],
          build: (a) => {
            const ability = ENHANCE_2024.find(([n]) => n === a.ability);
            return {
              parts:
                ability === undefined
                  ? []
                  : [
                      {
                        kind: 'rollAdvantage',
                        mode: 'adv',
                        on: { rolls: ['check'], abilities: [ability[1]] },
                      },
                    ],
              name: `Enhance: ${a.ability ?? ''}`,
              same: 'Enhance Ability',
            };
          },
        }
      : {
          id: 'enhance-ability',
          name: 'Enhance Ability',
          what: spell(2),
          keywords:
            "advantage check bear's endurance bull's strength cat's grace eagle's splendor fox's cunning owl's wisdom",
          sum: "Advantage on one ability's checks",
          lasts: conc(HOUR),
          asks: [
            {
              key: 'which',
              kind: 'pick',
              label: 'Which one',
              options: options(ENHANCE_2014.map(([n]) => n)),
            },
            {
              key: 'temp',
              kind: 'roll',
              dice: '2d6',
              label: 'Your 2d6 temporary hit points',
              showIf: (a) => a.which === "Bear's Endurance",
            },
          ],
          build: (a) => {
            const which = ENHANCE_2014.find(([n]) => n === a.which);
            if (which === undefined) return { parts: [] };
            return {
              parts: [
                {
                  kind: 'rollAdvantage',
                  mode: 'adv',
                  on: { rolls: ['check'], abilities: [which[1]] },
                },
              ],
              name: which[0],
              same: 'Enhance Ability',
              ...(which[1] === 'con' ? { tempHp: num(a.temp, 7) } : {}),
            };
          },
        },
    {
      id: 'enlarge',
      name: 'Enlarge/Reduce, enlarged',
      what: spell(2),
      keywords: 'enlarge advantage strength damage d4 large size grow',
      sum: 'Advantage on Strength checks and saves, +1d4 weapon damage',
      lasts: conc(MINUTE),
      build: () => ({ parts: enlargeParts(edition), name: 'Enlarge' }),
    },
    {
      id: 'magic-weapon',
      name: 'Magic Weapon',
      what: spell(2),
      keywords: 'attack damage weapon magical',
      sum: "+1 to a weapon's attack and damage, more from higher slots",
      lasts: is24 ? timed(HOUR) : conc(HOUR),
      asks: [
        { key: 'weapon', kind: 'weapon', label: 'On which weapon' },
        slotAsk(
          is24
            ? [
                ['2nd', '1'],
                ['3rd to 5th', '2'],
                ['6th or higher', '3'],
              ]
            : [
                ['2nd or 3rd', '1'],
                ['4th or 5th', '2'],
                ['6th or higher', '3'],
              ],
        ),
      ],
      build: (a) => {
        const amount = num(a.slot, 1);
        const weapon = a.weapon;
        return {
          parts: [
            { kind: 'attackBonus', scope: 'all', amount, ...(weapon ? { weapon } : {}) },
            { kind: 'damageBonus', scope: 'all', amount, ...(weapon ? { weapon } : {}) },
          ],
        };
      },
    },
    {
      id: 'protection-from-poison',
      name: 'Protection from Poison',
      what: spell(2),
      keywords: 'poison poisoned resist advantage',
      sum: 'Half poison damage, advantage on saves against being poisoned',
      lasts: timed(HOUR),
      build: () => ({
        parts: [
          { kind: 'resist', damageType: 'poison' },
          cue(
            'ward',
            is24
              ? 'Advantage on saves to avoid or end the Poisoned condition'
              : 'Advantage on saves against being poisoned',
          ),
        ],
      }),
    },
    {
      id: 'darkvision',
      name: 'Darkvision',
      what: spell(2),
      keywords: 'see dark sense vision',
      sum: `Darkvision ${is24 ? 150 : 60} ft.`,
      lasts: timed(8 * HOUR),
      build: () => ({ parts: [{ kind: 'sense', sense: 'darkvision', range: is24 ? 150 : 60 }] }),
    },
    {
      id: 'spider-climb',
      name: 'Spider Climb',
      what: spell(2),
      keywords: 'climb speed move wall ceiling',
      sum: 'A climbing speed equal to your walking speed',
      lasts: conc(HOUR),
      build: () => ({ parts: [{ kind: 'moveSpeed', mode: 'climb', speed: 'walk' }] }),
    },
    {
      id: 'warding-bond',
      name: 'Warding Bond',
      what: spell(2),
      keywords: 'ac armor class save resist all damage',
      sum: '+1 to AC and saves, half damage of every type',
      lasts: timed(HOUR),
      build: () => ({
        parts: [
          { kind: 'acBonus', amount: 1 },
          { kind: 'saveBonus', amount: 1 },
          { kind: 'resist', damageType: 'all' },
          cue('info', 'Only within 60 ft. of the caster, who takes the same damage you do'),
        ],
      }),
    },
    {
      id: 'invisibility',
      name: 'Invisibility',
      what: spell(2),
      keywords: 'invisible hide unseen advantage condition',
      sum: 'You are invisible until you attack or cast a spell',
      lasts: conc(HOUR),
      build: () => ({
        parts: [
          ...invisibleParts(edition),
          cue(
            'warn',
            is24
              ? 'It ends once you make an attack roll, deal damage or cast a spell'
              : 'It ends once you attack or cast a spell',
          ),
        ],
      }),
    },
    {
      id: 'dragons-breath',
      name: "Dragon's Breath",
      what: spell(2),
      keywords: 'action breath cone acid cold fire lightning poison damage',
      sum: 'A breath you can use as an action',
      lasts: conc(MINUTE),
      asks: [
        typeAsk(['Acid', 'Cold', 'Fire', 'Lightning', 'Poison'], 'Which energy'),
        {
          key: 'dc',
          kind: 'pick',
          label: "The caster's spell save DC",
          options: options(['11', '12', '13', '14', '15', '16', '17', '18', '19']),
          initial: '13',
        },
        slotAsk(ORDINAL.slice(2).map((o, i) => [o, `${3 + i}d6`] as [string, string])),
      ],
      build: (a) =>
        a.type === undefined
          ? { parts: [] }
          : {
              parts: [
                cue(
                  'help',
                  `${is24 ? 'Magic action' : 'Action'}: exhale a 15-foot cone, DC ${a.dc ?? '13'} Dexterity save, ${a.slot ?? '3d6'} ${lower(a.type)} damage, half on a success`,
                ),
              ],
            },
    },
    {
      id: 'haste',
      name: 'Haste',
      what: spell(3),
      keywords: 'ac speed action advantage dexterity fast quick',
      sum: '+2 to AC, double speed, advantage on Dexterity saves, an extra action',
      lasts: conc(MINUTE),
      build: () => ({ parts: hasteParts(edition, true) }),
    },
    {
      id: 'fly',
      name: 'Fly',
      what: spell(3),
      keywords: 'fly flying speed move air',
      sum: 'A flying speed of 60 ft.',
      lasts: conc(10),
      build: () => ({ parts: [{ kind: 'moveSpeed', mode: 'fly', speed: 60 }] }),
    },
    {
      id: 'protection-from-energy',
      name: 'Protection from Energy',
      what: spell(3),
      keywords: 'resist acid cold fire lightning thunder damage',
      sum: 'Half damage of one type: acid, cold, fire, lightning or thunder',
      lasts: conc(HOUR),
      asks: [typeAsk(ENERGY)],
      build: (a) =>
        a.type === undefined
          ? { parts: [] }
          : {
              parts: [{ kind: 'resist', damageType: lower(a.type) }],
              name: `Protection: ${lower(a.type)}`,
              same: 'Protection from Energy',
            },
    },
    {
      id: 'water-breathing',
      name: 'Water Breathing',
      what: spell(3),
      keywords: 'breathe underwater swim',
      sum: 'You can breathe underwater',
      lasts: timed(24 * HOUR),
      build: () => ({ parts: [cue('info', 'You can breathe underwater')] }),
    },
    {
      id: 'beacon-of-hope',
      name: 'Beacon of Hope',
      what: spell(3),
      keywords: 'advantage wisdom death save healing',
      sum: 'Advantage on Wisdom and death saves, healing at its most',
      lasts: conc(MINUTE),
      build: () => ({
        parts: [
          { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'], abilities: ['wis'] } },
          cue('help', 'Advantage on death saving throws'),
          cue('info', 'Healing you get restores the most it can, every die at its highest'),
        ],
      }),
    },
    {
      id: 'elemental-weapon',
      name: 'Elemental Weapon',
      what: spell(3),
      keywords: 'attack damage weapon magical acid cold fire lightning thunder',
      sum: '+1 to hit with a weapon, and +1d4 damage of a type you pick',
      lasts: conc(HOUR),
      asks: [
        { key: 'weapon', kind: 'weapon', label: 'On which weapon' },
        typeAsk(ENERGY),
        slotAsk([
          ['3rd or 4th', '1'],
          ['5th or 6th', '2'],
          ['7th or higher', '3'],
        ]),
      ],
      build: (a) => {
        if (a.type === undefined) return { parts: [] };
        const n = num(a.slot, 1);
        const weapon = a.weapon;
        return {
          parts: [
            { kind: 'attackBonus', scope: 'all', amount: n, ...(weapon ? { weapon } : {}) },
            {
              kind: 'damageDie',
              scope: 'all',
              dice: `${n}d4`,
              damageType: lower(a.type),
              ...(weapon ? { weapon } : {}),
            },
          ],
        };
      },
    },
    {
      id: 'death-ward',
      name: 'Death Ward',
      what: spell(4),
      keywords: 'hit points 0 dying death',
      sum: 'The first time you would drop to 0 HP, you drop to 1',
      lasts: timed(8 * HOUR),
      build: () => ({
        parts: [
          cue(
            'ward',
            'The first time you would drop to 0 hit points, you drop to 1 instead, and it ends. An effect that would kill you outright without damage fails, and it ends',
          ),
        ],
      }),
    },
    {
      id: 'freedom-of-movement',
      name: 'Freedom of Movement',
      what: spell(4),
      keywords: 'paralyzed restrained grappled speed move swim difficult terrain',
      sum: is24
        ? 'Magic cannot paralyze, restrain or slow you, and you swim at your speed'
        : 'Magic cannot paralyze, restrain or slow you',
      lasts: timed(HOUR),
      build: () => ({
        parts: [
          cue(
            'ward',
            'Spells and other magic cannot reduce your speed, paralyze you or restrain you; difficult terrain does not slow you',
          ),
          ...(is24 ? [{ kind: 'moveSpeed', mode: 'swim', speed: 'walk' } as EffectPart] : []),
        ],
      }),
    },
    {
      id: 'stoneskin',
      name: 'Stoneskin',
      what: spell(4),
      keywords: 'resist bludgeoning piercing slashing damage stone',
      sum: is24
        ? 'Half bludgeoning, piercing and slashing damage'
        : 'Half nonmagical bludgeoning, piercing and slashing damage',
      lasts: conc(HOUR),
      build: () => ({
        parts: ['bludgeoning', 'piercing', 'slashing'].map(
          (t): EffectPart => ({
            kind: 'resist',
            damageType: t,
            ...(is24 ? {} : { note: 'nonmagical' }),
          }),
        ),
      }),
    },
    {
      id: 'greater-invisibility',
      name: 'Greater Invisibility',
      what: spell(4),
      keywords: 'invisible hide unseen advantage disadvantage condition',
      sum: 'You are invisible, and stay so as you attack',
      lasts: conc(MINUTE),
      build: () => ({ parts: invisibleParts(edition) }),
    },
    {
      id: 'heroes-feast',
      name: "Heroes' Feast",
      what: spell(6),
      keywords: 'hit points maximum hp poison frightened fear immune advantage wisdom',
      sum: is24
        ? 'Half poison damage, cannot be frightened or poisoned, 2d10 more hit points'
        : 'Immune to poison and fear, advantage on Wisdom saves, 2d10 more hit points',
      lasts: timed(24 * HOUR),
      asks: [{ key: 'hp', kind: 'roll', dice: '2d10', label: 'Your 2d10 more hit points' }],
      build: (a) => ({
        parts: [
          is24
            ? { kind: 'resist', damageType: 'poison' }
            : { kind: 'immune', damageType: 'poison' },
          { kind: 'conditionImmune', condition: 'Frightened' },
          { kind: 'conditionImmune', condition: 'Poisoned' },
          ...(is24
            ? []
            : [
                {
                  kind: 'rollAdvantage',
                  mode: 'adv',
                  on: { rolls: ['save'], abilities: ['wis'] },
                } as EffectPart,
              ]),
          { kind: 'maxHpBonus', amount: num(a.hp, 11) },
        ],
        name: 'Feast',
        same: "Heroes' Feast",
      }),
    },
    {
      id: 'foresight',
      name: 'Foresight',
      what: spell(9),
      keywords: 'advantage disadvantage surprise d20',
      sum: 'Advantage on attacks, checks and saves; disadvantage on attacks against you',
      lasts: timed(8 * HOUR),
      build: () => ({
        parts: [
          { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['attack', 'check', 'save'] } },
          cue('ward', 'Other creatures have disadvantage on attack rolls against you'),
          ...(is24 ? [] : [cue('ward', 'You cannot be surprised')]),
        ],
      }),
    },

    // --- Spells only their caster gets ------------------------------------------
    {
      id: 'shield',
      name: 'Shield',
      what: `${spell(1)}${SELF}`,
      keywords: 'ac armor class reaction magic missile',
      sum: '+5 to AC until the start of your next turn',
      self: true,
      lasts: {},
      turnsLeft: 1,
      build: () => ({
        parts: [{ kind: 'acBonus', amount: 5 }, cue('ward', 'No damage from Magic Missile')],
      }),
    },
    {
      id: 'blur',
      name: 'Blur',
      what: `${spell(2)}${SELF}`,
      keywords: 'disadvantage attack against you',
      sum: 'Attackers have disadvantage on attacks against you',
      self: true,
      lasts: conc(MINUTE),
      build: () => ({
        parts: [
          cue(
            'ward',
            is24
              ? 'Attack rolls against you have disadvantage, unless the attacker has blindsight or truesight'
              : 'Attack rolls against you have disadvantage, unless the attacker does not rely on sight or sees through illusions',
          ),
        ],
      }),
    },
    {
      id: 'see-invisibility',
      name: 'See Invisibility',
      what: `${spell(2)}${SELF}`,
      keywords: 'see invisible sense ethereal',
      sum: 'You see invisible creatures, and into the Ethereal Plane',
      self: true,
      lasts: timed(HOUR),
      build: () => ({
        parts: [
          cue('info', 'You see invisible creatures and objects, and into the Ethereal Plane'),
        ],
      }),
    },
    {
      id: 'hunters-mark',
      name: "Hunter's Mark",
      what: `${spell(1)}${SELF}`,
      keywords: 'damage d6 target quarry mark',
      sum: 'Extra 1d6 damage when you hit your quarry',
      self: true,
      lasts: conc(HOUR),
      build: () => ({
        parts: [
          cue(
            'help',
            is24
              ? '+1d6 force damage when you hit your quarry with an attack roll'
              : '+1d6 damage when you hit your quarry with a weapon attack',
          ),
          cue('help', 'Advantage on Perception and Survival checks to find your quarry'),
        ],
      }),
    },

    // --- Potions ---------------------------------------------------------------
    {
      id: 'potion-of-heroism',
      name: 'Potion of Heroism',
      what: 'Potion',
      keywords: 'temporary hit points temp hp bless d4',
      sum: '10 temporary hit points, and Bless',
      lasts: timed(HOUR),
      borrows: 'bless',
      build: () => ({
        parts: blessEffect('', false).parts.map((p) => ({ ...p, same: 'Bless' })),
        name: 'Heroism potion',
        tempHp: 10,
      }),
    },
    {
      id: 'potion-of-giant-strength',
      name: 'Potion of Giant Strength',
      what: 'Potion',
      keywords: 'strength hill stone frost fire cloud storm giant',
      sum: "Your Strength becomes the giant's, when that is higher",
      lasts: timed(HOUR),
      asks: [
        {
          key: 'giant',
          kind: 'pick',
          label: 'Which giant',
          options: GIANTS.map(([g, n]) => ({ label: `${g} (${n})`, value: g })),
        },
      ],
      build: (a) => {
        const giant = GIANTS.find(([g]) => g === a.giant);
        return giant === undefined
          ? { parts: [] }
          : {
              parts: [{ kind: 'abilityMin', ability: 'str', min: giant[1] }],
              name: `${giant[0]} Giant Strength`,
              same: 'Potion of Giant Strength',
            };
      },
    },
    {
      id: 'potion-of-resistance',
      name: 'Potion of Resistance',
      what: 'Potion',
      keywords: 'resist damage',
      sum: 'Half damage of the type the potion names',
      lasts: timed(HOUR),
      asks: [typeAsk(POTION_TYPES, "The potion's type")],
      build: (a) =>
        a.type === undefined
          ? { parts: [] }
          : {
              parts: [{ kind: 'resist', damageType: lower(a.type) }],
              name: `${a.type} potion`,
              same: `Potion of ${a.type} Resistance`,
            },
    },
    {
      id: 'potion-of-speed',
      name: 'Potion of Speed',
      what: 'Potion',
      keywords: 'haste ac speed action fast quick',
      sum: is24
        ? 'Haste for a minute, with no one concentrating and no lethargy after'
        : 'Haste for a minute, with no one concentrating',
      lasts: timed(MINUTE),
      borrows: 'haste',
      build: () => ({ parts: hasteParts(edition, !is24), name: 'Speed potion', same: 'Haste' }),
    },
    {
      id: 'potion-of-invulnerability',
      name: 'Potion of Invulnerability',
      what: 'Potion',
      keywords: 'resist all damage',
      sum: 'Half damage of every type',
      lasts: timed(MINUTE),
      build: () => ({ parts: [{ kind: 'resist', damageType: 'all' }], name: 'Invulnerability' }),
    },
    {
      id: 'potion-of-flying',
      name: 'Potion of Flying',
      what: 'Potion',
      keywords: 'fly flying speed move air',
      sum: 'A flying speed equal to your walking speed',
      lasts: timed(HOUR),
      build: () => ({
        parts: [{ kind: 'moveSpeed', mode: 'fly', speed: 'walk' }],
        name: 'Flying potion',
      }),
    },
    {
      id: 'potion-of-growth',
      name: 'Potion of Growth',
      what: 'Potion',
      keywords: 'enlarge advantage strength damage large size grow',
      sum: 'Enlarged, as the spell, with no one concentrating',
      // 2014 lasts 1d4 hours: the longest, so a rest ends it no sooner than it could.
      lasts: timed(is24 ? 10 : 4 * HOUR),
      borrows: 'enlarge',
      build: () => ({ parts: enlargeParts(edition), name: 'Growth', same: 'Enlarge' }),
    },
    {
      id: 'potion-of-water-breathing',
      name: 'Potion of Water Breathing',
      what: 'Potion',
      keywords: 'breathe underwater swim',
      sum: 'You can breathe underwater',
      lasts: timed(is24 ? 24 * HOUR : HOUR),
      borrows: 'water-breathing',
      build: () => ({
        parts: [cue('info', 'You can breathe underwater')],
        name: 'Water breathing',
        same: 'Water Breathing',
      }),
    },
    {
      id: 'potion-of-invisibility',
      name: 'Potion of Invisibility',
      what: 'Potion',
      keywords: 'invisible hide unseen advantage condition',
      sum: 'You are invisible until you attack or cast a spell',
      lasts: timed(HOUR),
      borrows: 'invisibility',
      build: () => ({
        parts: [
          ...invisibleParts(edition),
          cue(
            'warn',
            is24
              ? 'It ends once you make an attack roll, deal damage or cast a spell'
              : 'It ends once you attack or cast a spell',
          ),
        ],
        name: 'Invisible',
        same: 'Invisibility',
      }),
    },

    // --- From an ally ----------------------------------------------------------
    {
      id: 'bardic-inspiration',
      name: 'Bardic Inspiration',
      what: 'Bard feature, from an ally',
      keywords: 'die d6 d8 d10 d12 attack check save bard inspire',
      sum: is24
        ? 'A die for one d20 test you fail'
        : 'A die for one attack, check or save, after you see the d20',
      lasts: timed(is24 ? HOUR : 10),
      asks: [
        {
          key: 'die',
          kind: 'pick',
          label: "The bard's die, by their level",
          options: options(BARDIC_DICE),
          initial: 'd8',
        },
      ],
      build: (a) => {
        const die = BARDIC_DICE.find((d) => d === a.die) ?? 'd8';
        return { parts: bardicEffect('', edition, die).parts };
      },
    },
    {
      id: 'aura-of-protection',
      name: 'Aura of Protection',
      what: 'Paladin feature, from an ally',
      keywords: 'save charisma paladin aura',
      sum: "The paladin's Charisma on your saves",
      lasts: {},
      asks: [
        {
          key: 'cha',
          kind: 'pick',
          label: "The paladin's Charisma modifier",
          options: options(['+1', '+2', '+3', '+4', '+5']),
          initial: '+3',
        },
      ],
      build: (a) => ({
        parts: [{ kind: 'saveBonus', amount: num(a.cha, 3) }, cue('info', auraWhere)],
        name: 'Aura',
        same: 'Aura of Protection',
      }),
    },
    {
      id: 'aura-of-courage',
      name: 'Aura of Courage',
      what: 'Paladin feature, from an ally',
      keywords: 'frightened fear paladin aura',
      sum: 'You cannot be frightened',
      lasts: {},
      build: () => ({
        parts: [{ kind: 'conditionImmune', condition: 'Frightened' }, cue('info', auraWhere)],
      }),
    },
    {
      id: 'help',
      name: 'Help',
      what: 'Action, from an ally',
      keywords: 'advantage attack check assist',
      sum: 'Advantage on your next attack or check',
      lasts: {},
      turnsLeft: 2,
      asks: [
        {
          key: 'on',
          kind: 'pick',
          label: 'What they helped with',
          options: options(['An attack', 'A check']),
          initial: 'An attack',
        },
      ],
      build: (a) => ({
        parts: [
          cue(
            'help',
            a.on === 'A check'
              ? is24
                ? 'Advantage on your next check with the skill or tool they chose'
                : 'Advantage on your next check for the task they helped with'
              : 'Advantage on your next attack roll against the enemy they distracted',
          ),
        ],
      }),
    },
    {
      id: 'dodge',
      name: 'Dodge',
      what: 'Action',
      keywords: 'disadvantage advantage dexterity defend',
      sum: 'Attackers you can see have disadvantage; advantage on Dexterity saves',
      lasts: {},
      turnsLeft: 1,
      build: () => ({
        parts: [
          { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'], abilities: ['dex'] } },
          cue('ward', 'Attack rolls against you have disadvantage, if you can see the attacker'),
          cue('warn', 'It ends if you are incapacitated or your speed drops to 0'),
        ],
      }),
    },

    // --- Your own --------------------------------------------------------------
    {
      id: 'rage',
      name: 'Rage',
      what: 'Barbarian feature',
      keywords: 'damage resist advantage strength barbarian',
      sum: 'Your own: start it from Play, where it spends a use',
      own: true,
      lasts: {},
      build: () => ({ parts: [] }),
    },
    {
      id: 'innate-sorcery',
      name: 'Innate Sorcery',
      what: 'Sorcerer feature',
      keywords: 'spell save dc advantage sorcerer',
      sum: 'Your own: start it from Play, where it spends a use',
      own: true,
      lasts: {},
      build: () => ({ parts: [] }),
    },
  ];
}

/** The whole table in a rules version, in a fixed order. */
export function catalogFor(edition: Edition): CatalogEntry[] {
  return specs(edition).map((s) => ({ ...s, asks: s.asks ?? [], lastsSay: lastsWords(s) }));
}

// ---------------------------------------------------------------------------
// Homebrew spells and potions (H6)
// ---------------------------------------------------------------------------

/** What the entries come from: the registry, or anything that lists entries by type. */
export interface EntriesByType {
  byType(type: string): readonly unknown[];
}

/** Minutes in each unit a spell's duration is written in. A round is too short to count. */
const UNIT_MINUTES: ReadonlyMap<unknown, number> = new Map([
  ['minute', 1],
  ['hour', HOUR],
  ['day', 24 * HOUR],
]);

/** How long a spell lasts by its own duration field: its first timed duration. */
function spellLasts(entry: Record<string, unknown>): EffectDuration {
  const durations = own(entry, 'duration');
  const first = Array.isArray(durations) ? durations[0] : undefined;
  if (!isRecord(first) || own(first, 'type') !== 'timed') return {};
  const out: EffectDuration = {};
  const span = own(first, 'duration');
  const unit = isRecord(span) ? own(span, 'type') : undefined;
  const amount = isRecord(span) ? own(span, 'amount') : undefined;
  const per = UNIT_MINUTES.get(unit);
  if (per !== undefined && typeof amount === 'number' && Number.isInteger(amount) && amount > 0) {
    out.minutes = Math.min(amount * per, CAST_GUIDANCE_LIMITS.amountLimit);
  }
  if (own(first, 'concentration') === true) out.concentration = true;
  return out;
}

/** The first sentence of an entry's text, its tags read as their words, for a result's line. */
function firstLine(entry: Record<string, unknown>): string {
  const entries = own(entry, 'entries');
  const text = Array.isArray(entries) ? entries.find((x) => typeof x === 'string') : undefined;
  if (typeof text !== 'string') return 'What its maker says it does';
  const plain = text
    .slice(0, 600)
    .replaceAll(/\{@\w+ ([^|}]*)[^}]*\}/g, '$1')
    .replaceAll(/\s+/g, ' ')
    .trim();
  const sentence = /^.*?[.!?](\s|$)/.exec(plain)?.[0].trim() ?? plain;
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}...` : sentence;
}

/** A homebrew spell or potion that puts an effect on a target, read; or why it is not offered. */
export interface HomebrewLanding {
  entry?: CatalogEntry;
  problems: string[];
}

/** A potion, by its item type ("P", or "P|XDMG" in newer data): drunk, not worn. */
function isPotion(entry: Record<string, unknown>): boolean {
  const type = own(entry, 'type');
  return typeof type === 'string' && (type === 'P' || type.startsWith('P|'));
}

/** A spell whose range is Self lands only on its caster (Shield). */
function onSelfOnly(entry: Record<string, unknown>): boolean {
  const range = own(entry, 'range');
  const distance = isRecord(range) ? own(range, 'distance') : undefined;
  return isRecord(distance) && own(distance, 'type') === 'self';
}

/**
 * One homebrew spell or potion as + Effect offers it: what its own
 * `castGuidance.effects` put on a target (`storedInPlay`, so only what an
 * effect in play holds), for as long as a spell's own duration says. A spell
 * with a range of Self lands only on its caster. Any other item's effects are
 * what it does while worn, which the sheet already counts, so it is not one.
 */
export function homebrewLanding(raw: unknown, type: 'spell' | 'item'): HomebrewLanding {
  const problems: string[] = [];
  if (!isRecord(raw) || (type === 'item' && !isPotion(raw))) return { problems };
  const name = own(raw, 'name');
  const source = own(raw, 'source');
  const guidance = own(raw, 'castGuidance');
  if (typeof name !== 'string' || name.trim() === '' || !isRecord(guidance)) return { problems };
  const stored = own(guidance, 'effects');
  if (stored === undefined) return { problems };
  const say = (why: string) => problems.push(`${name.trim()}: ${why}.`);
  const version = guidanceVersion(guidance);
  if ('problem' in version) {
    say(version.problem);
    return { problems };
  }
  const read = storedInPlay(stored, 'an effect on a target');
  for (const p of read.problems) {
    say(p.place === undefined ? p.why : `effect ${p.place} does not count: ${p.why}`);
  }
  if (read.parts.length === 0) return { problems };
  const level = own(raw, 'level');
  const what =
    type === 'item'
      ? 'Potion'
      : typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 9
        ? spell(level)
        : 'Spell';
  const parts = read.parts;
  const spec: Spec = {
    id: `homebrew:${type}:${lower(name.trim())}|${lower(String(source ?? ''))}`,
    name: name.trim(),
    what,
    keywords: `homebrew ${typeof source === 'string' ? source : ''}`,
    sum: firstLine(raw),
    lasts: type === 'spell' ? spellLasts(raw) : {},
    ...(type === 'spell' && onSelfOnly(raw) ? { self: true as const } : {}),
    // A fresh copy each time, so one landed effect never shares parts with the next.
    build: () => ({ parts: structuredClone(parts) }),
  };
  return { entry: { ...spec, asks: [], lastsSay: lastsWords(spec) }, problems };
}

/**
 * + Effect's entries for the homebrew spells and potions that put an effect
 * on a target (H6), found by their own `castGuidance.effects`: official
 * entries have none. One per name and kind, the first found, as the registry
 * keeps one copy per name and book. Problems are for whoever wants to say them.
 */
export function homebrewCatalog(data: EntriesByType | null | undefined): {
  entries: CatalogEntry[];
  problems: string[];
} {
  const entries: CatalogEntry[] = [];
  const problems: string[] = [];
  if (data === null || data === undefined) return { entries, problems };
  const seen = new Set<string>();
  for (const type of ['spell', 'item'] as const) {
    for (const raw of data.byType(type)) {
      if (!isRecord(raw)) continue;
      if (own(raw, 'castGuidance') === undefined) continue;
      const read = homebrewLanding(raw, type);
      problems.push(...read.problems);
      const key = `${type}:${read.entry?.name.toLowerCase()}`;
      if (read.entry === undefined || seen.has(key)) continue;
      seen.add(key);
      entries.push(read.entry);
    }
  }
  return { entries, problems };
}

/** The questions an entry asks with these answers: one shown only for some answers comes and goes. */
export function asksShown(entry: CatalogEntry, answers: Answers): CatalogAsk[] {
  return entry.asks.filter((q) => q.showIf === undefined || q.showIf(answers));
}

/** The answers an entry starts with: each question's own choice, where it has one. */
export function initialAnswers(entry: CatalogEntry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of entry.asks) {
    if (q.kind === 'pick' && q.initial !== undefined) out[q.key] = q.initial;
  }
  return out;
}

/** The least and most a roll like "2d10" can come to. */
export function rollRange(dice: string): { min: number; max: number } {
  const m = /^(\d*)d(\d+)$/i.exec(dice.trim());
  const count = m?.[1] ? Number(m[1]) : 1;
  const sides = m?.[2] ? Number(m[2]) : 1;
  return { min: count, max: count * sides };
}

/**
 * The questions still unanswered, which hold the entry back from landing. A
 * roll typed in counts only when the dice could have rolled it.
 */
export function unanswered(entry: CatalogEntry, answers: Answers): CatalogAsk[] {
  return asksShown(entry, answers).filter((q) => {
    const v = answers[q.key];
    if (v === undefined || v === '') return true;
    if (q.kind !== 'roll') return false;
    const n = Number(v);
    const { min, max } = rollRange(q.dice);
    return !Number.isInteger(n) || n < min || n > max;
  });
}

/** The effect an entry lands as, with its answers, for this character. */
export function landEntry(
  entry: CatalogEntry,
  answers: Answers,
  id: string,
): { effect: ActiveEffect; tempHp?: number } {
  const built = entry.build(answers);
  const name = built.name ?? entry.name;
  const effect: ActiveEffect = {
    id,
    name,
    ...(built.same !== undefined && built.same !== name ? { same: built.same } : {}),
    parts: built.parts,
    ...(Object.keys(entry.lasts).length > 0 ? { lasts: { ...entry.lasts } } : {}),
    ...(entry.turnsLeft !== undefined ? { turnsLeft: entry.turnsLeft } : {}),
    ...(entry.self === true ? { mine: true } : {}),
  };
  return built.tempHp !== undefined && built.tempHp > 0
    ? { effect, tempHp: built.tempHp }
    : { effect };
}

/** Folds case and quote marks, so "heroes feast" finds "Heroes' Feast". */
const fold = (s: string) => s.toLowerCase().replace(/[’'`]/g, '').replace(/\s+/g, ' ').trim();

/**
 * What a search finds: names first, then what an entry does or is (its
 * keywords, line, kind and the choices it offers), each word of the query
 * matching somewhere. An empty query finds nothing.
 */
export function searchCatalog(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const q = fold(query);
  if (q === '') return [];
  const words = q.split(' ');
  // The name first: all of it, then its start, then a word's start, then
  // anywhere in it, so "rage" finds Rage before Aura of Courage.
  const nameRank = (name: string) =>
    name === q ? 0 : name.startsWith(q) ? 1 : name.includes(` ${q}`) ? 2 : 3;
  const byName = entries
    .map((e) => ({ e, name: fold(e.name) }))
    .filter((x) => x.name.includes(q))
    .sort((a, b) => nameRank(a.name) - nameRank(b.name))
    .map((x) => x.e);
  const byWhat = entries.filter((e) => {
    if (byName.includes(e)) return false;
    // Its choices count as what it does: a fire Potion of Resistance is one.
    const picks = e.asks.flatMap((q) => (q.kind === 'pick' ? q.options.map((o) => o.label) : []));
    const hay = fold(`${e.name} ${e.keywords} ${e.sum} ${e.what} ${picks.join(' ')}`);
    return words.every((w) => hay.includes(w));
  });
  return [...byName, ...byWhat];
}
