/**
 * A stored pick (`{ "kind": "pick" }`, rule pack port phase 4): a prompt an
 * entry asks, and what each answer gives. `mechanics.ts` reads it into a
 * `PickRule`; this file asks it under the ids the code rows it replaced asked
 * theirs, so the answers characters saved before the port keep reading.
 */
import { isProficient } from '../calc/attacks';
import {
  ABILITIES,
  type ChoiceOption,
  type ChoicePrompt,
  type DataEntity,
  type EffectOrigin,
  type EntityRef,
  refUid,
} from '../types';
import { parseSpellRef, savedPicks } from './additionalSpells';
import { asEntityArray, type Collector } from './base';
import {
  LANGUAGE_OPTIONS,
  markKnownLanguages,
  skillOptions,
  toolOptions,
  weaponMasteryOptions,
  weaponOptions,
} from './readers';
import { reskinOf } from './reskin';

/** What a pick asks for, which sets its options and how its answer is spelled. */
export const PICK_ASKS = [
  'skill',
  'tool',
  'weapon',
  'weaponMastery',
  'save',
  'damage',
  'option',
  'spell',
] as const;
export type PickAsk = (typeof PICK_ASKS)[number];

/** The asks a pick may take "in place of" what is held: those the build can already hold. */
export const IN_PLACE_ASKS: ReadonlySet<PickAsk> = new Set(['skill', 'tool', 'save']);

/** The 13 damage types, a `damage` pick's options when it names none. */
export const DAMAGE_TYPES = [
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

/**
 * The prompt ids the code rows asked, after the origin, which a built-in rule
 * set's pick may keep so the answers saved under them still read. `{feature}`
 * is the origin's label, lowercased. Every other pick's id is `pick-<slug>`,
 * which none of these starts with.
 */
export const CODE_PICK_IDS: ReadonlySet<string> = new Set([
  'skill:{feature}',
  'tool:{feature}',
  'weapon:{feature}',
  'save:{feature}',
  'weapon-mastery',
  'cantrip',
  'signature',
  'ancestor',
  'affinity',
  'elemental-shielding',
  'fiendish-resilience',
  'bestial-soul',
  'aspect-of-the-wilds',
]);

/** How many it asks: a number, by the giving class's level, or by its class table's column. */
export type PickCount =
  | number
  | { byLevel: ReadonlyArray<readonly [number, number]> }
  | { tableColumn: string; else: number };

/** What fills a pick's stored effects: the answer, and for a spell its name's forms. */
export interface PickFill {
  pick: string;
  slug?: string;
  title?: string;
  /** `{picks}`: every answer (a spell's name, lowercased). */
  picks?: readonly string[];
}

/**
 * Stored effects read again with a pick filled in (`{pick}` and the rest), so
 * each field reads the answer as it reads words an author wrote. What does not
 * read is a problem for the sheet.
 */
export type PickGives<T> = (fill: PickFill) => {
  effects: readonly T[];
  problems: readonly string[];
};

export interface PickOption<T> {
  id: string;
  label: string;
  gives?: readonly T[];
}

/** A stored pick, read (`mechanics.ts`). `T` is a stored effect, read. */
export interface PickRule<T> {
  /** The prompt id after the origin: `pick-<slug>`, or one of `CODE_PICK_IDS`. */
  id: string;
  ask: PickAsk;
  count: PickCount;
  /** The prompt's words: `{feature}` is the entry's name, `{held}` what it is in place of. */
  label?: string;
  /** The options it narrows to (skills, tools, abilities, damage types, weapons). */
  from?: readonly string[];
  /** A skill pick also offers the giving class's skill list. */
  classSkills?: true;
  /** A skill pick also offers languages: a language picked is spoken. */
  orLanguage?: true;
  /** An `option` pick's options, each with what it gives. */
  options?: readonly PickOption<T>[];
  /**
   * Held so far, each of these turns into a pick of another (Royal Envoy's
   * Persuasion); not held, each is given as the pick would give it.
   */
  inPlaceOf?: readonly string[];
  /** Asked once the build is in, since its options read the whole build (Weapon Mastery). */
  afterBuild?: true;
  /** A weapon mastery pick: melee kinds alone, or kinds the character is proficient with. */
  melee?: true;
  proficient?: true;
  /** A weapon pick's base items: by filter, less those with any of `without`'s properties. */
  weapons?: { filter: string; without?: readonly string[] };
  /** A spell pick's spells. */
  spells?: { levels: readonly number[]; classes: readonly string[] };
  /** What each pick gives. */
  gives?: PickGives<T>;
  /** What the picks give once, together (`{picks}`). */
  givesAll?: PickGives<T>;
  /** With `inPlaceOf`, given whether or not it is held, before the pick. */
  always?: readonly T[];
}

/** Where a pick is asked, and how its answers' effects are emitted. */
export interface PickAt<T> {
  origin: EffectOrigin;
  classLevel: number;
  /** The class that gives it (`MechanicsSubject.className`): whose skill list `classSkills` reads. */
  className?: string;
  emit: (effects: readonly T[]) => void;
  /** What a `pick-` id starts with in place of the origin's (`MechanicsSubject.pickBase`). */
  base?: string;
}

/**
 * The character's class of this name, or else the class reskinning it (a
 * Warrior for "Fighter"), or else the class copying it (a Workshop copy of the
 * Fighter), in that order, whose features are that class's and read its level
 * as theirs. Each class is checked for both, in that order.
 */
export function classEntry(
  col: Collector,
  className: string,
  copyOf: (cls: DataEntity | undefined) => EntityRef | undefined,
) {
  const name = className.toLowerCase();
  const by = (of: (cls: DataEntity | undefined) => EntityRef | undefined) =>
    col.doc.classes.find(
      (c) => of(col.ctx.get('class', c.ref.name, c.ref.source))?.name.toLowerCase() === name,
    );
  return (
    col.doc.classes.find((c) => c.ref.name.toLowerCase() === name) ?? by(reskinOf) ?? by(copyOf)
  );
}

/** "The skills available to Fighters at level 1": that class's own list, in the printing taken. */
export function classSkillList(
  col: Collector,
  className: string,
  copyOf: (cls: DataEntity | undefined) => EntityRef | undefined,
): string[] {
  const entry = classEntry(col, className, copyOf);
  const cls = entry && col.ctx.get('class', entry.ref.name, entry.ref.source);
  const lists = (cls?.startingProficiencies as DataEntity | undefined)?.skills;
  return asEntityArray(lists).flatMap((s) => {
    const from = (s.choose as DataEntity | undefined)?.from;
    return Array.isArray(from) ? from.map(String) : [];
  });
}

/**
 * A number from the class table of the class whose feature this is (its
 * origin), at that class's level: the first column whose label holds
 * `column`, as the Weapon Mastery column counts kinds of weapon.
 */
export function tableColumnCount(col: Collector, origin: EffectOrigin, column: string): number {
  const entry = col.doc.classes.find((c) => refUid(c.ref) === origin.uid);
  const cls = entry && col.ctx.get('class', entry.ref.name, entry.ref.source);
  const wanted = column.toLowerCase();
  for (const group of asEntityArray(cls?.classTableGroups)) {
    const labels = Array.isArray(group.colLabels) ? group.colLabels.map(String) : [];
    const at = labels.findIndex((l) => l.toLowerCase().includes(wanted));
    const row = Array.isArray(group.rows) ? group.rows[(entry?.levels ?? 1) - 1] : undefined;
    const count = at >= 0 && Array.isArray(row) ? Number(row[at]) : Number.NaN;
    if (count > 0) return count;
  }
  return 0;
}

function countOf<T>(col: Collector, count: PickCount, at: PickAt<T>): number {
  if (typeof count === 'number') return count;
  if ('byLevel' in count) {
    let n = 0;
    for (const [level, value] of count.byLevel) if (level <= at.classLevel) n = value;
    return n;
  }
  const n = tableColumnCount(col, at.origin, count.tableColumn);
  return n > 0 ? n : count.else;
}

const heldTools = (col: Collector) =>
  new Set(col.effects.flatMap((e) => (e.kind === 'toolProf' ? [e.name.toLowerCase()] : [])));

const hasSave = (col: Collector, ability: string) =>
  col.effects.some((e) => e.kind === 'saveProf' && e.ability === ability);

/** Whether the build so far holds `name`, as an `inPlaceOf` pick reads it. */
function holds(col: Collector, ask: PickAsk, name: string): boolean {
  const n = name.toLowerCase();
  if (ask === 'skill') return col.proficientSkills().some((s) => s.toLowerCase() === n);
  if (ask === 'tool') return heldTools(col).has(n);
  return ask === 'save' && hasSave(col, n);
}

const capitalized = (t: string) => `${t[0]?.toUpperCase() ?? ''}${t.slice(1)}`;

/** The base items with any of `without`'s properties, by lowercased name: what a weapon pick leaves out. */
function withoutProperties(col: Collector, without: readonly string[]): Set<string> {
  const codes = new Set(without.map((w) => w.toUpperCase()));
  return new Set(
    col.ctx
      .byType('baseitem')
      .filter((e) =>
        (Array.isArray(e.property) ? e.property : []).some((p) =>
          codes.has(
            String(typeof p === 'string' ? p : (p as DataEntity).uid)
              .split('|')[0]
              ?.toUpperCase() ?? '',
          ),
        ),
      )
      .map((e) => String(e.name).toLowerCase()),
  );
}

/** What a skill-or-language pick offers beside its skills: a language picked is spoken. */
const LANGUAGE_IDS: ReadonlySet<string> = new Set(LANGUAGE_OPTIONS.map((o) => o.id.toLowerCase()));

/** The prompt's options, and its kind, as the code rows built them. */
function optionsOf<T>(
  col: Collector,
  rule: PickRule<T>,
  at: PickAt<T>,
  id: string,
  copyOf: (cls: DataEntity | undefined) => EntityRef | undefined,
): Pick<ChoicePrompt, 'kind' | 'options' | 'spellQuery'> {
  const from = rule.from ?? [];
  switch (rule.ask) {
    case 'skill': {
      // A skill in `from` and the class's list is offered once.
      const seen = new Set<string>();
      const list = [
        ...from,
        ...(rule.classSkills === true && at.className !== undefined
          ? classSkillList(col, at.className, copyOf)
          : []),
      ].filter((s) => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()) !== undefined);
      const languages = rule.orLanguage === true ? markKnownLanguages(col, LANGUAGE_OPTIONS) : [];
      return { kind: 'skill', options: [...skillOptions(list), ...languages] };
    }
    case 'tool': {
      // A tool collected so far is offered disabled: the pick is for one the character lacks.
      const held = heldTools(col);
      const options = toolOptions(from).map((o) =>
        held.has(o.id.toLowerCase())
          ? { ...o, disabled: { reason: `You already have ${o.label}` } }
          : o,
      );
      return { kind: 'tool', options };
    }
    case 'weapon': {
      const options =
        rule.weapons === undefined
          ? weaponOptions(col.ctx)(from)
          : weaponOptions(col.ctx)(undefined, rule.weapons.filter);
      const without = rule.weapons?.without;
      const left = without === undefined ? undefined : withoutProperties(col, without);
      const out =
        left === undefined ? options : options.filter((o) => !left.has(o.id.toLowerCase()));
      return { kind: 'generic', options: out };
    }
    case 'weaponMastery': {
      const profs = col.effects.flatMap((e) => (e.kind === 'weaponProf' ? [e.name] : []));
      const filters = col.effects.flatMap((e) => (e.kind === 'weaponProfFilter' ? [e.filter] : []));
      const options = weaponMasteryOptions(
        col.ctx,
        (e, ranged) =>
          (rule.melee !== true || !ranged) &&
          (rule.proficient !== true || isProficient(e, profs, filters)),
      );
      return { kind: 'generic', options };
    }
    case 'save': {
      // A save held already is left out: the pick is for one the character lacks.
      const among = from.length > 0 ? from : ABILITIES;
      const options = among
        .filter((a) => !hasSave(col, a))
        .map((a) => ({ id: a, label: a.toUpperCase() }));
      return { kind: 'generic', options };
    }
    case 'damage': {
      const among = from.length > 0 ? from : DAMAGE_TYPES;
      return { kind: 'generic', options: among.map((t) => ({ id: t, label: capitalized(t) })) };
    }
    case 'option':
      return {
        kind: 'generic',
        options: (rule.options ?? []).map((o): ChoiceOption => ({ id: o.id, label: o.label })),
      };
    case 'spell': {
      const spellQuery = {
        levels: [...(rule.spells?.levels ?? [])],
        classes: [...(rule.spells?.classes ?? [])],
        schools: [],
        ritual: false,
        attacks: [],
      };
      return { kind: 'spell', options: savedPicks(col, id, spellQuery), spellQuery };
    }
  }
}

/** The prompt's words when the pick names none, by what it asks and how many. */
export function defaultLabel(ask: PickAsk, count: number, feature: string): string {
  const many = count > 1;
  switch (ask) {
    case 'skill':
      return many ? 'Skill proficiencies' : 'Skill proficiency';
    case 'tool':
      return many ? 'Tool proficiencies' : 'Tool proficiency';
    case 'weapon':
      return many ? 'Weapon proficiencies' : 'Weapon proficiency';
    case 'save':
      return `${feature}: saving throw`;
    default:
      return feature;
  }
}

/** A spell's name with its word starts capitalized, so "Leomund's" keeps its lowercase s. */
const spellTitle = (name: string) =>
  name.replace(/(^|[\s/-])([a-z])/g, (_, at: string, c: string) => at + c.toUpperCase());

/** A spell answer's fill: the saved `name|source`, its name as a key's slug, and as a title. */
export function spellFill(pick: string): PickFill | undefined {
  const { name } = parseSpellRef(pick);
  if (name === '') return undefined;
  return { pick, slug: name.toLowerCase().replace(/\W+/g, '-'), title: spellTitle(name) };
}

/** Prompt ids of `pick-` picks asked in each derive: a second ask of one would share its answer. */
const ASKED = new WeakMap<Collector, Set<string>>();

/**
 * Ask a stored pick, where the code row it stands in for asked its prompt: at
 * once, or once the build is in (`afterBuild`). `copyOf` is the copy a class
 * names (`basedOn`), passed in since it is read in `mechanics.ts`.
 */
export function askPick<T>(
  col: Collector,
  rule: PickRule<T>,
  at: PickAt<T>,
  copyOf: (cls: DataEntity | undefined) => EntityRef | undefined,
): void {
  if (rule.afterBuild === true) col.afterAll.push(() => ask(col, rule, at, copyOf));
  else ask(col, rule, at, copyOf);
}

function ask<T>(
  col: Collector,
  rule: PickRule<T>,
  at: PickAt<T>,
  copyOf: (cls: DataEntity | undefined) => EntityRef | undefined,
): void {
  const { origin } = at;
  const fill = (gives: PickGives<T> | undefined, f: PickFill) => {
    if (gives === undefined) return;
    const read = gives(f);
    for (const problem of read.problems) col.warn(`${origin.label}: ${problem}`);
    at.emit(read.effects);
  };
  let count = countOf(col, rule.count, at);
  let held: string[] = [];
  if (rule.inPlaceOf !== undefined) {
    held = rule.inPlaceOf.filter((name) => holds(col, rule.ask, name));
    for (const name of rule.inPlaceOf) if (!held.includes(name)) fill(rule.gives, { pick: name });
    if (rule.always !== undefined) at.emit(rule.always);
    if (held.length === 0) return;
    count = held.length;
  }
  if (count < 1) return;
  // A `pick-` id files under the entry's instance where it has one (a feat's).
  const base =
    at.base !== undefined && rule.id.startsWith('pick-') ? at.base : `${origin.type}:${origin.uid}`;
  // Functions, so a `$` in a name is the name's, not a replacement pattern.
  const id = `${base}:${rule.id.replace('{feature}', () => origin.label.toLowerCase())}`;
  if (rule.id.startsWith('pick-')) {
    const asked = ASKED.get(col) ?? new Set<string>();
    ASKED.set(col, asked);
    if (asked.has(id)) {
      col.warn(
        `${origin.label}: asks its pick "${rule.id.slice(5)}" twice; the second is left out.`,
      );
      return;
    }
    asked.add(id);
  }
  const { kind, options, spellQuery } = optionsOf(col, rule, at, id, copyOf);
  // A save pick with nothing left to pick asks nothing, as the code rows did.
  if (rule.ask === 'save' && options.length === 0) return;
  const label = (rule.label ?? defaultLabel(rule.ask, count, origin.label))
    .replace('{feature}', () => origin.label)
    .replace('{held}', () => held.join(' and '));
  col.choice(
    {
      id,
      origin,
      kind,
      label,
      count,
      options,
      ...(spellQuery === undefined ? {} : { spellQuery }),
    },
    (selected) => {
      const names: string[] = [];
      // What `{picks}` lists: each answer as its pick fills `{pick}` (a tool by its name).
      const values: string[] = [];
      for (const pick of selected) {
        if (
          rule.ask === 'skill' &&
          rule.orLanguage === true &&
          LANGUAGE_IDS.has(pick.toLowerCase())
        ) {
          // A language picked in a skill's place is spoken, whatever the pick gives.
          col.add({ kind: 'language', name: pick, origin });
          continue;
        }
        if (rule.ask === 'spell') {
          const f = spellFill(pick);
          if (f === undefined) continue;
          names.push(parseSpellRef(pick).name.toLowerCase());
          fill(rule.gives, f);
          continue;
        }
        const option = options.find((o) => o.id === pick);
        // A tool is given by its name as the sheet shows it; anything else by its id.
        const value = rule.ask === 'tool' ? (option?.label ?? pick) : pick;
        if (rule.ask === 'option') {
          const gives = rule.options?.find((o) => o.id === pick)?.gives;
          if (gives !== undefined) at.emit(gives);
        }
        values.push(value);
        fill(rule.gives, { pick: value });
      }
      if (
        rule.givesAll !== undefined &&
        selected.length > 0 &&
        (rule.ask !== 'spell' || names.length > 0)
      ) {
        // `{pick}` is the first answer as `gives` has it: a spell's `name|source`.
        const first = rule.ask === 'spell' ? selected[0] : values[0];
        fill(rule.givesAll, { pick: first ?? '', picks: rule.ask === 'spell' ? names : values });
      }
    },
  );
}
