/**
 * Standing defenses, senses, speeds and save proficiencies that subclass features
 * and optional features state only in prose. Unlike a curated row (`CURATED`), a
 * row here adds to what the prose scan reads from the same feature: the scan keeps
 * its actions and pools (Wind Soul's flight for others, Guarded Mind's die), and
 * this adds the resistance or speed the scan does not read. Keys as in `CURATED`:
 *   - subclass features: `featureName|subclassName` (lowercased)
 *   - optional features: `name|source` (lowercased)
 * `level` is the level the feature is gained at, which tells apart option features
 * of one name (Storm Herald's Desert at 3, 6 and 14).
 */
import type { Collector } from '../effects/base';
import { ABILITIES, type Ability, type EffectOrigin, type WhileState } from '../types';

type StandingFn = (
  col: Collector,
  origin: EffectOrigin,
  from: string | undefined,
  level: number,
) => void;

const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;
const PHYSICAL = ['bludgeoning', 'piercing', 'slashing'];

const RAGING: readonly WhileState[] = [{ state: 'effect', name: 'Rage' }];

/** The 2024 printing of a feature whose subclass shares its name with the 2014 one. */
const printed2024 = (origin: EffectOrigin, from?: string) =>
  origin.uid.endsWith('|xphb') || from === 'xphb';

/** Resistance to each type, held while `held` says (always when empty). */
const resists =
  (types: readonly string[], note?: string, held?: readonly WhileState[]): StandingFn =>
  (col, origin) => {
    for (const damageType of types) {
      col.add({
        kind: 'resist',
        damageType,
        ...(note !== undefined ? { note } : {}),
        ...(held !== undefined ? { while: held } : {}),
        origin,
      });
    }
  };

const immunities =
  (types: readonly string[]): StandingFn =>
  (col, origin) => {
    for (const damageType of types) col.add({ kind: 'immune', damageType, origin });
  };

const conditionImmunities =
  (conditions: readonly string[], note?: string, held?: readonly WhileState[]): StandingFn =>
  (col, origin) => {
    for (const condition of conditions) {
      col.add({
        kind: 'conditionImmune',
        condition,
        ...(note !== undefined ? { note } : {}),
        ...(held !== undefined ? { while: held } : {}),
        origin,
      });
    }
  };

const sense =
  (name: string, range: number): StandingFn =>
  (col, origin) =>
    col.add({ kind: 'sense', sense: name, range, origin });

const swim =
  (speed: number | 'walk'): StandingFn =>
  (col, origin) =>
    col.add({ kind: 'moveSpeed', mode: 'swim', speed, origin });

/** The longest darkvision collected so far (the race's is in by now), from `from` alone if given. */
function darkvisionSoFar(col: Collector, from?: EffectOrigin['type']): number {
  let best = 0;
  for (const e of col.effects) {
    if (e.kind !== 'sense' || e.sense.toLowerCase() !== 'darkvision') continue;
    if (from !== undefined && e.origin.type !== from) continue;
    best = Math.max(best, e.range);
  }
  return best;
}

/**
 * Darkvision of `range`, or what the character has plus `more` when it has some
 * already ("its range increases by 60 feet"). `raceOnly`: only a race's counts
 * (the 2014 Gloom Stalker's "from your race").
 */
const darkvisionOrMore =
  (range: number, more: number, raceOnly = false): StandingFn =>
  (col, origin) => {
    const had = darkvisionSoFar(col, raceOnly ? 'race' : undefined);
    col.add({ kind: 'sense', sense: 'darkvision', range: had > 0 ? had + more : range, origin });
  };

const hasSave = (col: Collector, ability: Ability) =>
  col.effects.some((e) => e.kind === 'saveProf' && e.ability === ability);

/**
 * Proficiency in `ability` saves, or, when the character has it already, a pick
 * among `instead` (every ability it lacks when `instead` is empty).
 */
const saveOrPick =
  (ability: Ability, instead: readonly Ability[] = []): StandingFn =>
  (col, origin) => {
    if (!hasSave(col, ability)) {
      col.add({ kind: 'saveProf', ability, origin });
      return;
    }
    const options = (instead.length > 0 ? instead : ABILITIES).filter((a) => !hasSave(col, a));
    if (options.length === 0) return;
    col.choice(
      {
        id: `${origin.type}:${origin.uid}:save:${origin.label.toLowerCase()}`,
        origin,
        kind: 'generic',
        label: `${origin.label}: saving throw`,
        count: 1,
        options: options.map((a) => ({ id: a, label: a.toUpperCase() })),
      },
      (selected) => {
        for (const a of selected) {
          if ((ABILITIES as readonly string[]).includes(a)) {
            col.add({ kind: 'saveProf', ability: a as Ability, origin });
          }
        }
      },
    );
  };

/** A pick of one damage type among `types`, resisted while it stands. */
const resistPick =
  (slug: string, label: string, types: readonly string[], note?: string): StandingFn =>
  (col, origin) =>
    col.choice(
      {
        id: `${origin.type}:${origin.uid}:${slug}`,
        origin,
        kind: 'generic',
        label,
        count: 1,
        options: types.map((t) => ({ id: t, label: `${t[0]?.toUpperCase() ?? ''}${t.slice(1)}` })),
      },
      (selected) => resists(selected, note)(col, origin, undefined, 0),
    );

/** The subclass branch picked (a Genie's kind, a 2024 Land druid's land), lowercased. */
function branchOf(col: Collector, origin: EffectOrigin): string | undefined {
  const picked = col.doc.choices[`${origin.type}:${origin.uid}:branch`];
  return Array.isArray(picked) ? picked[0]?.toLowerCase() : undefined;
}

/** Several rows on one feature. */
const all =
  (...fns: StandingFn[]): StandingFn =>
  (col, origin, from, level) => {
    for (const fn of fns) fn(col, origin, from, level);
  };

/** A row for the option feature gained at `at` alone (Storm Soul's Desert, not Storm Aura's). */
const atLevel =
  (at: number, fn: StandingFn): StandingFn =>
  (col, origin, from, level) => {
    if (level === at) fn(col, origin, from, level);
  };

/** "From nonmagical attacks" in 2014; plain in 2024. */
const physicalResists =
  (note2014: string): StandingFn =>
  (col, origin, from, level) =>
    printed2024(origin, from)
      ? resists(PHYSICAL)(col, origin, from, level)
      : resists(PHYSICAL, note2014)(col, origin, from, level);

/** A paladin's own place in its aura: while conscious (2014), not while incapacitated (2024). */
const auraNote = (origin: EffectOrigin, from?: string) =>
  printed2024(origin, from) ? 'not while incapacitated' : 'while conscious';

export const STANDING: Record<string, StandingFn> = {
  // --- Barbarian -------------------------------------------------------------
  // Chosen at each rest; the jump is a check, not a speed.
  'bestial soul|path of the beast': (col, origin) =>
    col.choice(
      {
        id: `${origin.type}:${origin.uid}:bestial-soul`,
        origin,
        kind: 'generic',
        label: 'Bestial Soul',
        count: 1,
        options: [
          { id: 'swim', label: 'Swimming speed' },
          { id: 'climb', label: 'Climbing speed' },
          { id: 'jump', label: 'Longer jumps' },
        ],
      },
      ([mode]) => {
        if (mode === 'swim' || mode === 'climb') {
          col.add({ kind: 'moveSpeed', mode, speed: 'walk', origin });
        }
      },
    ),
  'mindless rage|path of the berserker': conditionImmunities(
    ['charmed', 'frightened'],
    undefined,
    RAGING,
  ),
  // Totem Spirit at 3 and Totemic Attunement at 14 share option names with Aspect of the Beast.
  'bear|path of the totem warrior': atLevel(
    3,
    resists(
      DAMAGE_TYPES.filter((t) => t !== 'psychic'),
      undefined,
      RAGING,
    ),
  ),
  'elk|path of the totem warrior': atLevel(3, (col, origin) =>
    col.add({ kind: 'speedBonus', amount: 15, unless: 'heavyArmor', while: RAGING, origin }),
  ),
  'eagle|path of the totem warrior': atLevel(14, (col, origin) =>
    col.add({ kind: 'moveSpeed', mode: 'fly', speed: 'walk', while: RAGING, origin }),
  ),
  // Storm Soul's options, by the environment picked for Storm Aura.
  'desert|path of the storm herald': atLevel(6, resists(['fire'])),
  'sea|path of the storm herald': atLevel(6, all(resists(['lightning']), swim(30))),
  'tundra|path of the storm herald': atLevel(6, resists(['cold'])),
  'aspect of the wilds|path of the wild heart': (col, origin) =>
    col.choice(
      {
        id: `${origin.type}:${origin.uid}:aspect-of-the-wilds`,
        origin,
        kind: 'generic',
        label: 'Aspect of the Wilds',
        count: 1,
        options: [
          { id: 'owl', label: 'Owl (darkvision)' },
          { id: 'panther', label: 'Panther (climb speed)' },
          { id: 'salmon', label: 'Salmon (swim speed)' },
        ],
      },
      (selected) => {
        if (selected.includes('owl')) darkvisionOrMore(60, 60)(col, origin, undefined, 0);
        if (selected.includes('panther')) {
          col.add({ kind: 'moveSpeed', mode: 'climb', speed: 'walk', origin });
        }
        if (selected.includes('salmon')) swim('walk')(col, origin, undefined, 0);
      },
    ),
  'primordial bond|path of the elements': resists(['cold', 'fire', 'lightning'], undefined, RAGING),

  // --- Cleric ----------------------------------------------------------------
  'avatar of battle|war domain': physicalResists('nonmagical'),
  'avatar of battle|strength domain (psa)': resists(PHYSICAL, 'nonmagical'),
  'eyes of night|twilight domain': sense('darkvision', 300),
  'soul of the forge|forge domain': resists(['fire']),
  'saint of forge and fire|forge domain': all(
    immunities(['fire']),
    resists(PHYSICAL, 'nonmagical, in heavy armor'),
  ),
  'unfettered mind|knowledge domain': saveOrPick('int'),

  // --- Artificer -------------------------------------------------------------
  'chemical mastery|alchemist': all(resists(['acid', 'poison']), conditionImmunities(['poisoned'])),

  // --- Druid -----------------------------------------------------------------
  "nature's ward|circle of the land": (col, origin, from, level) => {
    if (printed2024(origin, from)) {
      conditionImmunities(['poisoned'])(col, origin, from, level);
      const land = branchOf(col, origin)?.split(' ')[0];
      const type = { arid: 'fire', polar: 'cold', temperate: 'lightning', tropical: 'poison' }[
        land ?? ''
      ];
      if (type !== undefined) resists([type])(col, origin, from, level);
      return;
    }
    immunities(['poison'])(col, origin, from, level);
    conditionImmunities(['poisoned', 'disease'])(col, origin, from, level);
    // Only a charm or fright from an elemental or fey: an immunity would hold off
    // every one in play, so it is said, not counted.
    col.add({
      kind: 'cue',
      tone: 'ward',
      text: "Can't be charmed or frightened by elementals or fey.",
      origin,
    });
  },
  'aquatic affinity|circle of the sea': swim('walk'),

  // --- Fighter ---------------------------------------------------------------
  'guarded mind|psi warrior': resists(['psychic']),
  // Its Persuasion bonus is a curated row.
  'elegant courtier|samurai': saveOrPick('wis', ['int', 'cha']),
  'inspiring commander|banneret': conditionImmunities(['charmed', 'frightened']),

  // --- Monk ------------------------------------------------------------------
  'darkvision|warrior of shadow': darkvisionOrMore(60, 60),
  'ascendant aspect|way of the ascendant dragon': sense('blindsight', 10),

  // --- Paladin ---------------------------------------------------------------
  'supernatural resistance|oathbreaker': resists(PHYSICAL, 'nonmagical weapons'),
  // The paladin is always inside its own aura, while it holds.
  'aura of warding|oath of the ancients': (col, origin, from, level) =>
    printed2024(origin, from)
      ? resists(['necrotic', 'psychic', 'radiant'], auraNote(origin, from))(
          col,
          origin,
          from,
          level,
        )
      : resists(['all'], 'from spells')(col, origin, from, level),
  'aura of devotion|oath of devotion': (col, origin, from, level) =>
    conditionImmunities(['charmed'], auraNote(origin, from))(col, origin, from, level),
  'aura of alacrity|oath of glory': (col, origin) =>
    col.add({ kind: 'speedBonus', amount: 10, origin }),
  'aura of elemental shielding|oath of the noble genies': (col, origin, from, level) =>
    resistPick(
      'elemental-shielding',
      'Aura of Elemental Shielding',
      ['acid', 'cold', 'fire', 'lightning', 'thunder'],
      auraNote(origin, 'xphb'),
    )(col, origin, from, level),
  'aura of deathly endurance|oath of the ebon blade': resists(
    ['cold', 'necrotic', 'psychic'],
    'not while incapacitated',
  ),

  // --- Ranger ----------------------------------------------------------------
  'umbral sight|gloom stalker': (col, origin, from, level) =>
    printed2024(origin, from)
      ? darkvisionOrMore(60, 60)(col, origin, from, level)
      : darkvisionOrMore(60, 30, true)(col, origin, from, level),
  'iron mind|gloom stalker': saveOrPick('wis', ['int', 'cha']),
  'frigid explorer|winter walker': resists(['cold']),
  'ancient might|hollow warden': conditionImmunities(['exhaustion']),

  // --- Rogue -----------------------------------------------------------------
  // The god chosen is the cantrip picked from its row of the table.
  'dread allegiance|scion of the three': (col, origin, from, level) => {
    const byCantrip: Record<string, string> = {
      'minor illusion': 'psychic',
      'blade ward': 'poison',
      'chill touch': 'necrotic',
    };
    const cantrip = col.effects.find(
      (e) =>
        e.kind === 'grantSpell' &&
        e.origin.uid === origin.uid &&
        byCantrip[e.spell.name.toLowerCase()] !== undefined,
    );
    const type =
      cantrip?.kind === 'grantSpell' ? byCantrip[cantrip.spell.name.toLowerCase()] : undefined;
    if (type !== undefined) resists([type])(col, origin, from, level);
  },
  'superior mobility|scout': (col, origin) => col.add({ kind: 'speedBonus', amount: 10, origin }),
  // 2014's climbing at no extra cost is not a climb speed of its own.
  'second-story work|thief': (col, origin, from) => {
    if (printed2024(origin, from)) {
      col.add({ kind: 'moveSpeed', mode: 'climb', speed: 'walk', origin });
    }
  },

  // --- Sorcerer --------------------------------------------------------------
  'fire in the veins|pyromancer (psk)': resists(['fire']),
  'fiery soul|pyromancer (psk)': immunities(['fire']),
  'eyes of the dark|shadow magic': sense('darkvision', 120),
  'heart of the storm|storm sorcery': resists(['lightning', 'thunder']),
  'wind soul|storm sorcery': all(immunities(['lightning', 'thunder']), (col, origin) =>
    col.add({ kind: 'moveSpeed', mode: 'fly', speed: 60, origin }),
  ),
  'psychic defenses|aberrant mind': resists(['psychic']),
  'psychic defenses|aberrant sorcery': resists(['psychic']),
  'power of shadow|shadow sorcery': all(sense('darkvision', 120), sense('blindsight', 10)),

  // --- Warlock ---------------------------------------------------------------
  'beguiling defenses|the archfey': conditionImmunities(['charmed']),
  'beguiling defenses|archfey patron': conditionImmunities(['charmed']),
  'fiendish resilience|the fiend': resistPick(
    'fiendish-resilience',
    'Fiendish Resilience',
    DAMAGE_TYPES,
    'not from magical or silver weapons',
  ),
  'fiendish resilience|fiend patron': resistPick(
    'fiendish-resilience',
    'Fiendish Resilience',
    DAMAGE_TYPES.filter((t) => t !== 'force'),
  ),
  'thought shield|the great old one': resists(['psychic']),
  'thought shield|great old one patron': resists(['psychic']),
  'radiant soul|the celestial': resists(['radiant']),
  'radiant soul|celestial patron': resists(['radiant']),
  'gift of the sea|the fathomless': swim(40),
  'oceanic soul|the fathomless': resists(['cold']),
  'elemental gift|the genie': (col, origin, from, level) => {
    const kind = branchOf(col, origin);
    const type = { dao: 'bludgeoning', djinni: 'thunder', efreeti: 'fire', marid: 'cold' }[
      kind ?? ''
    ];
    if (type !== undefined) resists([type])(col, origin, from, level);
  },
  'necrotic husk|the undead': resists(['necrotic']),
  'necrotic husk|undead patron': resists(['necrotic']),

  // --- Wizard ----------------------------------------------------------------
  'inured to undeath|school of necromancy': resists(['necrotic']),
  'necromancy spellbook|necromancer': resists(['necrotic']),
  'spell resistance|school of abjuration': resists(['all'], 'from spells'),
  'spell resistance|abjurer': resists(['all'], 'from spells'),

  // --- WoW -------------------------------------------------------------------
  'spectral sight|demon hunter': sense('blindsight', 10),

  // --- Optional features -----------------------------------------------------
  'beguiling influence|phb': (col, origin) => {
    for (const skill of ['Deception', 'Persuasion']) {
      col.add({ kind: 'skillProf', skill, level: 1, origin });
    }
  },
  'blind fighting|tce': sense('blindsight', 10),
  "devil's sight|phb": sense("devil's sight", 120),
  "devil's sight|xphb": sense("devil's sight", 120),
  'gift of the depths|xge': swim('walk'),
  'gift of the depths|xphb': swim('walk'),
  'stone rune|tce': sense('darkvision', 120),
  'hill rune|tce': resists(['poison']),
  'witch sight|xphb': sense('truesight', 30),
};

/**
 * Adds a feature's standing row, if it has one, beside the prose scan. Returns
 * whether it had one, so the caller stops at the first of its keys that does.
 */
export function emitStandingEffects(
  col: Collector,
  key: string,
  origin: EffectOrigin,
  from: string | undefined,
  level: number,
): boolean {
  const fn = STANDING[key];
  fn?.(col, origin, from, level);
  return fn !== undefined;
}
