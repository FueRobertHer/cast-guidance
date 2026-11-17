/**
 * Curated mechanics for high-frequency features whose numbers exist only in
 * prose (verified against the dataset: e.g. Alert's +5 initiative has no
 * structured field). Keys:
 *   - feats / optional features: `name|source` (entity uid, lowercased)
 *   - class/subclass features:   `featureName|classLabel` (lowercased)
 * These are facts of the game rules — fine to commit.
 */
import { isProficient } from '../calc/attacks';
import { parseSpellRef, savedPicks } from '../effects/additionalSpells';
import { asEntityArray, type Collector } from '../effects/base';
import { basedOn } from '../effects/mechanics';
import { skillOptions, toolOptions, weaponMasteryOptions } from '../effects/readers';
import { reskinOf } from '../effects/reskin';
import {
  type ChoiceOption,
  type DataEntity,
  type EffectOrigin,
  type EntityRef,
  refUid,
} from '../types';
import { DRACONIC_ANCESTRY, DRAGONS, dragonOptions } from './draconicAncestry';

/**
 * `from` is the printing of the feature itself, lowercase, where it can differ from
 * the card's: a class or subclass feature (see `printedIn`).
 */
type CuratedFn = (col: Collector, origin: EffectOrigin, from?: string) => void;

const proficient = (col: Collector, skill: string, origin: EffectOrigin) =>
  col.add({ kind: 'skillProf', skill, level: 1, origin });

/**
 * A skill a feature both grants and doubles. The proficiency is its own effect,
 * since that is what tells another pick the skill is already taken.
 */
function skillAtExpertise(col: Collector, skill: string, origin: EffectOrigin): void {
  proficient(col, skill, origin);
  col.add({ kind: 'skillProf', skill, level: 2, origin });
}

/**
 * A feature's pick among skills (every skill when `from` is empty), under its
 * class or subclass, so removing the class or swapping the subclass clears it.
 */
function featureSkillPick(
  col: Collector,
  origin: EffectOrigin,
  count: number,
  from: readonly string[],
  grant = (skill: string) => proficient(col, skill, origin),
  label = count > 1 ? 'Skill proficiencies' : 'Skill proficiency',
  extra: ChoiceOption[] = [],
): void {
  col.choice(
    {
      id: `${origin.type}:${origin.uid}:skill:${origin.label.toLowerCase()}`,
      origin,
      kind: 'skill',
      label,
      count,
      options: [...skillOptions(from), ...extra],
    },
    (selected) => selected.forEach(grant),
  );
}

/**
 * Armor, weapons and tools a feature grants in prose, named as the class lists
 * name them ("heavy", "martial"), so the sheet's list shows each once and an
 * attack finds its category. `filter` is a weapon grant no category or name can
 * say: the words the sheet shows, and the filter attacks match.
 */
interface Kit {
  armor?: string[];
  weapons?: string[];
  tools?: string[];
  filter?: [shown: string, filter: string];
}

function grantKit(col: Collector, origin: EffectOrigin, kit: Kit): void {
  for (const name of kit.armor ?? []) col.add({ kind: 'armorProf', name, origin });
  for (const name of kit.weapons ?? []) col.add({ kind: 'weaponProf', name, origin });
  for (const name of kit.tools ?? []) col.add({ kind: 'toolProf', name, origin });
  if (kit.filter !== undefined) {
    col.add({ kind: 'weaponProf', name: kit.filter[0], origin });
    col.add({ kind: 'weaponProfFilter', filter: kit.filter[1], origin });
  }
}

/** Each of a feature's parts, in order. */
const all =
  (...parts: CuratedFn[]): CuratedFn =>
  (col, origin) => {
    for (const fn of parts) fn(col, origin);
  };

/** A kit, then whatever else the feature does. */
const kit = (grants: Kit, ...rest: CuratedFn[]): CuratedFn =>
  all((col, origin) => grantKit(col, origin, grants), ...rest);

const heldTools = (col: Collector) =>
  new Set(col.effects.flatMap((e) => (e.kind === 'toolProf' ? [e.name.toLowerCase()] : [])));

/**
 * A pick of tools, among `from` (category words such as "artisan's tools" expand).
 * A tool collected so far is offered disabled, since the pick is for one the
 * character lacks.
 */
function featureToolPick(
  col: Collector,
  origin: EffectOrigin,
  count: number,
  from: readonly string[],
  label = count > 1 ? 'Tool proficiencies' : 'Tool proficiency',
): void {
  const held = heldTools(col);
  const options = toolOptions(from).map((o) =>
    held.has(o.id.toLowerCase())
      ? { ...o, disabled: { reason: `You already have ${o.label}` } }
      : o,
  );
  col.choice(
    {
      id: `${origin.type}:${origin.uid}:tool:${origin.label.toLowerCase()}`,
      origin,
      kind: 'tool',
      label,
      count,
      options,
    },
    (selected) => {
      for (const id of selected) {
        const name = options.find((o) => o.id === id)?.label ?? id;
        col.add({ kind: 'toolProf', name, origin });
      }
    },
  );
}

/**
 * The artificer subclasses' tools: each one the character already has turns into
 * a pick of another artisan's tool. Like Royal Envoy, only what is collected so far
 * counts (species, background, an earlier class, and a feat from any of this
 * class's ability score improvements, which are all collected before the
 * subclass); the artificer's own "one type of artisan's tools of your choice" is
 * words in the class data, not a pick, so it never does.
 */
const toolsOrAnother =
  (...tools: string[]): CuratedFn =>
  (col, origin) => {
    const held = heldTools(col);
    const known = tools.filter((t) => held.has(t.toLowerCase()));
    for (const name of tools) {
      if (!known.includes(name)) col.add({ kind: 'toolProf', name, origin });
    }
    if (known.length > 0) {
      featureToolPick(
        col,
        origin,
        known.length,
        ["artisan's tools"],
        `Tool in place of ${known.join(' and ')}`,
      );
    }
  };

/**
 * The character's class of this name, or else the class reskinning it (a
 * Warrior for "Fighter"), or else the class copying it (a Workshop copy of the
 * Fighter), in that order, whose features are that class's and read its level
 * as theirs. Each class is checked for both, in that order.
 */
function classEntry(col: Collector, className: string) {
  const name = className.toLowerCase();
  const by = (of: (cls: DataEntity | undefined) => EntityRef | undefined) =>
    col.doc.classes.find(
      (c) => of(col.ctx.get('class', c.ref.name, c.ref.source))?.name.toLowerCase() === name,
    );
  return (
    col.doc.classes.find((c) => c.ref.name.toLowerCase() === name) ?? by(reskinOf) ?? by(basedOn)
  );
}

/**
 * How many kinds of weapon a class's Weapon Mastery covers at its level: the
 * class table's Weapon Mastery column (Barbarian, Fighter and the WoW classes
 * that carry one), else two.
 */
function masteryCount(col: Collector, origin: EffectOrigin): number {
  const entry = col.doc.classes.find((c) => refUid(c.ref) === origin.uid);
  const cls = entry && col.ctx.get('class', entry.ref.name, entry.ref.source);
  for (const group of asEntityArray(cls?.classTableGroups)) {
    const labels = Array.isArray(group.colLabels) ? group.colLabels.map(String) : [];
    const at = labels.findIndex((l) => /weapon mastery/i.test(l));
    const row = Array.isArray(group.rows) ? group.rows[(entry?.levels ?? 1) - 1] : undefined;
    const count = at >= 0 && Array.isArray(row) ? Number(row[at]) : Number.NaN;
    if (count > 0) return count;
  }
  return 2;
}

/**
 * The 2024 Weapon Mastery: a pick of kinds of weapon whose mastery properties the
 * character can use, swapped on a long rest. `melee`: melee kinds alone (the
 * Barbarian's). `proficient`: kinds the character is proficient with (the Paladin's,
 * Ranger's and Rogue's), by the proficiencies collected so far.
 */
const weaponMastery =
  (opts: { melee?: boolean; proficient?: boolean } = {}): CuratedFn =>
  (col, origin) =>
    // Asked once the build is in: a feat at a later level, or a later class, can
    // add the proficiency a kind needs.
    col.afterAll.push(() => {
      const profs = col.effects.flatMap((e) => (e.kind === 'weaponProf' ? [e.name] : []));
      const filters = col.effects.flatMap((e) => (e.kind === 'weaponProfFilter' ? [e.filter] : []));
      col.choice(
        {
          id: `${origin.type}:${origin.uid}:weapon-mastery`,
          origin,
          kind: 'generic',
          label: 'Weapon Mastery',
          count: masteryCount(col, origin),
          options: weaponMasteryOptions(
            col.ctx,
            (e, ranged) =>
              (opts.melee !== true || !ranged) &&
              (opts.proficient !== true || isProficient(e, profs, filters)),
          ),
        },
        (selected) => {
          for (const name of selected) col.add({ kind: 'weaponMastery', name, origin });
        },
      );
    });

/** "The skills available to Fighters at level 1": that class's own list, in the printing taken. */
function classSkillList(col: Collector, className: string): string[] {
  const entry = classEntry(col, className);
  const cls = entry && col.ctx.get('class', entry.ref.name, entry.ref.source);
  const lists = (cls?.startingProficiencies as DataEntity | undefined)?.skills;
  return asEntityArray(lists).flatMap((s) => {
    const from = (s.choose as DataEntity | undefined)?.from;
    return Array.isArray(from) ? from.map(String) : [];
  });
}

/** The 2014 Draconic Bloodline's dragon, beside the subclass's other picks. */
const dragonAncestorId = (origin: EffectOrigin) => `${origin.type}:${origin.uid}:ancestor`;

/**
 * Whether a class or subclass feature comes from the printing in `source`. Its
 * origin uid is the class's or subclass's (`bard|xphb`, `champion|phb`), and a
 * 2014 subclass kept under a 2024 class still carries its own 2014 source. `from`
 * is the feature's own printing, which says it for a book that lends another's
 * features: a reskinned class (`warrior|wow`) or a subclass copied from a 2024 one
 * (`champion|wow`) holds the 2024 features as printed.
 */
function printedIn(origin: EffectOrigin, source: string, from?: string): boolean {
  return origin.uid.endsWith(`|${source}`) || from === source;
}

/**
 * The 2024 Agonizing Blast: Charisma on the damage of a Warlock cantrip the
 * player picks. The pick sits beside the invocations' prompt, not under it, so
 * saving that prompt keeps it. The picker lists every Warlock cantrip; the label
 * says it must deal damage, which the spell lists cannot filter by.
 */
const agonizingPick: CuratedFn = (col, origin) => {
  const id = `${origin.type}:${origin.uid}:cantrip`;
  const spellQuery = { levels: [0], classes: ['Warlock'], schools: [], ritual: false, attacks: [] };
  col.choice(
    {
      id,
      origin,
      kind: 'spell',
      label: 'Agonizing Blast: a Warlock cantrip that deals damage',
      count: 1,
      options: savedPicks(col, id, spellQuery),
      spellQuery,
    },
    (selected) => {
      const spells = selected.map((ref) => parseSpellRef(ref).name.toLowerCase());
      if (spells.length === 0) return;
      col.add({ kind: 'spellDamageBonus', amount: 'abilityMod:cha', spells, origin });
    },
  );
};

/**
 * Signature Spells: two level 3 Wizard spells, always prepared, each cast once a
 * short rest at level 3 without a slot, as a limited innate spell is. The pick
 * sits beside the class's prompts (`class:wizard|xphb:signature`), not under one,
 * so saving another prompt keeps it, and a saved pick resolves before the spell
 * files load.
 */
const signatureSpells: CuratedFn = (col, origin) => {
  const id = `${origin.type}:${origin.uid}:signature`;
  const spellQuery = { levels: [3], classes: ['Wizard'], schools: [], ritual: false, attacks: [] };
  col.choice(
    {
      id,
      origin,
      kind: 'spell',
      label: 'Signature Spells: two level 3 Wizard spells from your spellbook',
      count: 2,
      options: savedPicks(col, id, spellQuery),
      spellQuery,
    },
    (selected) => {
      for (const ref of selected) {
        const spell = parseSpellRef(ref);
        if (spell.name === '') continue;
        const key = `signature-spells-${spell.name.toLowerCase().replace(/\W+/g, '-')}`;
        // Capitalized at word starts only, so "Leomund's" keeps its lowercase s.
        const label = spell.name.replace(/(^|[\s/-])([a-z])/g, (_, at, c) => at + c.toUpperCase());
        col.add({ kind: 'resource', key, label, max: 1, resetOn: 'short', origin });
        col.add({
          kind: 'grantSpell',
          spell,
          ability: 'int',
          usage: 'prepared',
          slotsOnly: true,
          origin,
        });
        col.add({
          kind: 'grantSpell',
          spell,
          ability: 'int',
          usage: '1/rest',
          resourceKey: key,
          origin,
        });
      }
    },
  );
};

export const CURATED: Record<string, CuratedFn> = {
  // --- Feats ---------------------------------------------------------------
  // Every row of this section is data, in `src/rules/cast-guidance/curated.json`.

  // --- Fighting styles (2014 optional features; 2024 feats share names) ----
  // Every row of this section is data, in `src/rules/cast-guidance/curated.json`.

  // --- Class features ------------------------------------------------------
  // More of this section's rows are data, in `src/rules/cast-guidance/curated.json`.
  // --- Standing numbers: speeds, saves, scores and defenses ----------------
  // More of this section's rows are data, in `src/rules/cast-guidance/curated.json`.
  // The 2024 classes' (no 2014 class has the feature).
  'weapon mastery|barbarian': weaponMastery({ melee: true }),
  'weapon mastery|fighter': weaponMastery(),
  'weapon mastery|paladin': weaponMastery({ proficient: true }),
  'weapon mastery|ranger': weaponMastery({ proficient: true }),
  'weapon mastery|rogue': weaponMastery({ proficient: true }),
  // --- Always-on riders: damage every hit or every cast adds -----------------
  // More of this section's rows are data, in `src/rules/cast-guidance/curated.json`.
  'agonizing blast|xphb': agonizingPick,
  // Stunning Strike states its effect but leaves the DC to the "ki save DC"
  // defined in the Ki/Monk's Focus feature. The prose scanner can't resolve a
  // cross-feature DC, so its row pins it: Con save vs 8 + prof + Wis mod. It rides
  // on a hit, so it takes no slot of its own. Its cost is a `spend` row in
  // `src/rules/cast-guidance/spend.json`. The row is in
  // `src/rules/cast-guidance/curated.json`.
  // Second Wind, both Channel Divinities and Lay on Hands are data, by rules
  // version (`edition`). The Paladin's pool has a key of its own, not the
  // Cleric's: the 2024 text says "each time you use this class's Channel
  // Divinity", and a shared key made the uses depend on the class added first.
  // Tasha's Harness Divine Power is data too: uses of its own by class level, a
  // pool and chip named for their class beside the other class (`ownClassBeside`).
  // The scan read one pool for both spells, and nothing in the 2024 printing.
  'signature spells|wizard': signatureSpells,
  // Primal Knowledge and the sidekick classes' Bonus Proficiencies, picks, are
  // data too.

  // --- Subclass features (keyed by the subclass's full name) ---------------
  // More of this section's rows are data, in `src/rules/cast-guidance/curated.json`,
  // with every plain pick from a list (rule pack port 4b).
  // Persuasion is doubled however the fighter came by it, and having it already
  // swaps the proficiency for a plain one in another skill. Only what is collected
  // so far can say so: a later class's pick shows its own "already proficient" cue,
  // and a later fixed grant just overlaps.
  'royal envoy|purple dragon knight (banneret)': (col, origin) => {
    if (col.proficientSkills().some((s) => s.toLowerCase() === 'persuasion')) {
      col.add({ kind: 'skillProf', skill: 'Persuasion', level: 2, origin });
      featureSkillPick(
        col,
        origin,
        1,
        ['Animal Handling', 'Insight', 'Intimidation', 'Performance'],
        undefined,
        'Skill in place of Persuasion',
      );
    } else {
      skillAtExpertise(col, 'Persuasion', origin);
    }
  },
  // The skills, armor, weapons and tools these grant in prose alone. Languages
  // and cantrips beside them stay in the card.
  // XGE picks one. AU grants both, and each one already held turns into a pick
  // from the fighter's list; like Royal Envoy, only what is collected so far counts.
  'arcane archer lore|arcane archer': (col, origin, from) => {
    if (!printedIn(origin, 'au', from))
      return featureSkillPick(col, origin, 1, ['Arcana', 'Nature']);
    const held = col.proficientSkills().map((s) => s.toLowerCase());
    const known = ['Arcana', 'Nature'].filter((s) => held.includes(s.toLowerCase()));
    for (const skill of ['Arcana', 'Nature']) {
      if (!known.includes(skill)) proficient(col, skill, origin);
    }
    if (known.length > 0) {
      featureSkillPick(
        col,
        origin,
        known.length,
        classSkillList(col, 'Fighter'),
        undefined,
        `Skill in place of ${known.join(' and ')}`,
      );
    }
  },
  // The Cavalier's Bonus Proficiency, Master of Intrigue, the Alchemist's Tools
  // of the Trade and both Training in War and Song are picks in
  // `src/rules/cast-guidance/curated.json`.
  // The artificer subclasses (TCE and EFA share each subclass name).
  'tool proficiency|battle smith': toolsOrAnother("Smith's Tools"),
  'tool proficiency|alchemist': toolsOrAnother("Alchemist's Supplies"),
  'tool proficiency|artillerist': toolsOrAnother("Woodcarver's Tools"),
  'tools of the trade|armorer': kit({ armor: ['heavy'] }, toolsOrAnother("Smith's Tools")),
  'tools of the trade|battle smith': toolsOrAnother("Smith's Tools"),
  'tools of the trade|artillerist': kit(
    { filter: ['Martial Ranged weapons', 'type=martial weapon|type=ranged weapon'] },
    toolsOrAnother("Woodcarver's Tools"),
  ),
  'tools of the trade|cartographer': toolsOrAnother(
    "Calligrapher's Supplies",
    "Cartographer's Tools",
  ),
  // The scanner read Jolt to Life's uses before this row turned it off; keep them.
  "reanimator's skill set|reanimator": all(toolsOrAnother("Alchemist's Supplies"), (col, origin) =>
    col.add({
      kind: 'resource',
      key: 'reanimator-s-skill-set',
      label: "Reanimator's Skill Set",
      max: 'abilityMod:int',
      resetOn: 'long',
      origin,
    }),
  ),
  // The 2014 Dragon Ancestor: a dragon whose damage type later features use,
  // and Draconic. Its doubled proficiency with dragons stays in the card.
  'dragon ancestor|draconic bloodline': (col, origin) => {
    col.add({ kind: 'language', name: 'Draconic', origin });
    col.choice(
      {
        id: dragonAncestorId(origin),
        origin,
        kind: 'generic',
        label: 'Dragon Ancestor',
        count: 1,
        options: dragonOptions(DRAGONS),
      },
      () => {},
    );
  },
  // The 2014 Elemental Affinity, by the Dragon Ancestor's type: a sorcery point
  // (its spend link) for an hour's resistance, and a Charisma rider on spells.
  'elemental affinity|draconic bloodline': (col, origin) => {
    const picked = col.doc.choices[dragonAncestorId(origin)];
    const dragon = Array.isArray(picked) ? String(picked[0]).toLowerCase() : undefined;
    const type = dragon !== undefined ? DRACONIC_ANCESTRY[dragon]?.type : undefined;
    col.add({
      kind: 'action',
      economy: 'none',
      label: 'Elemental Affinity',
      ...(type !== undefined
        ? {
            note: `resistance to ${type} for 1 hour · ${type} spells add your Charisma modifier to one damage roll`,
          }
        : {}),
      origin,
    });
  },
  // The 2024 Elemental Affinity: a type of the five, resisted for good.
  'elemental affinity|draconic sorcery': (col, origin) => {
    col.choice(
      {
        id: `${origin.type}:${origin.uid}:affinity`,
        origin,
        kind: 'generic',
        label: 'Elemental Affinity',
        count: 1,
        options: ['acid', 'cold', 'fire', 'lightning', 'poison'].map((t) => ({
          id: t,
          label: `${t[0]?.toUpperCase() ?? ''}${t.slice(1)}`,
        })),
      },
      (selected) => {
        for (const damageType of selected) col.add({ kind: 'resist', damageType, origin });
      },
    );
  },
  // Performance, or a Monk skill in its place when it is held already. Like Royal
  // Envoy, only what is collected so far can say so.
  'bonus proficiencies|warrior of mystic brews': kit(
    { tools: ["Brewer's Supplies"] },
    (col, origin) => {
      if (col.proficientSkills().some((s) => s.toLowerCase() === 'performance')) {
        featureSkillPick(
          col,
          origin,
          1,
          classSkillList(col, 'Monk'),
          undefined,
          'Skill in place of Performance',
        );
      } else {
        proficient(col, 'Performance', origin);
      }
    },
  ),

  // --- Racial traits (keyed `trait:<traitName>`) ---------------------------
  // Most limited-use traits (Relentless Endurance, Breath Weapon, Fey Step,
  // Stone's Endurance, …) are handled per-source by the prose scanner, which
  // reads each printing's actual wording. Curated traits are what prose can't
  // see (passive numbers with no usage phrasing); every one is now data, in
  // `src/rules/cast-guidance/curated.json`, so none is left here.
};

/**
 * Racial traits live in `race.entries` by name — key them `trait:<name>`.
 * Returns whether a curated entry handled it (callers fall back to prose scan).
 */
export function emitCuratedTrait(col: Collector, traitName: string, origin: EffectOrigin): boolean {
  const fn = CURATED[`trait:${traitName.toLowerCase()}`];
  fn?.(col, origin);
  return fn !== undefined;
}

/** Whether `CURATED` has a row under a key, as `emitCuratedEffects` looks it up. */
export function hasCuratedRow(key: string): boolean {
  return CURATED[key] !== undefined;
}

/** Returns whether a curated entry handled the key (callers fall back to prose scan). */
export function emitCuratedEffects(
  col: Collector,
  key: string,
  origin: EffectOrigin,
  from?: string,
): boolean {
  const fn = CURATED[key];
  fn?.(col, origin, from);
  return fn !== undefined;
}
