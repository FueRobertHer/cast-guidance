/**
 * A Fight Club 5e compendium (`<compendium>`, the format Game Master 5e and
 * Encounter+ read too) into one 5etools homebrew file.
 *
 * Every entry goes to its kind's converter, which places it in the book its
 * `Source:` line names (`books.ts`). What comes back is checked before it is
 * kept, because a compendium is mostly copies of official entries, and the
 * app never makes a copy of one:
 *
 * - An entry the installed game data has in its book is left out; the
 *   installed one is the better copy. So is one from a book the data holds
 *   that the data has under the same name in that edition, since Fight Club
 *   sometimes cites another book than the data does. Text that differs is not
 *   a reason to keep a copy: every difference seen so far was a slip in the
 *   file (a flail listed as simple, Divine Smite as transmutation).
 * - An entry from a book the data does not hold is kept, under a source named
 *   after its book, as another printing of anything official of that name.
 * - Fight Club splits some feats per choice (`Resilient (Strength)`). Copies
 *   of an official feat are left out; a homebrew feat's copies become one feat
 *   with the choice in it.
 * - A starred spell (`Hold Person*`) repeats a spell to add subclass lists,
 *   which go to that spell; a `(Ritual Only)` spell repeats one for ritual
 *   casters. Both are left out.
 * - Class options stored as spells become optional features (`classOption.ts`).
 * - A second copy of the same entry in the same book is left out.
 *
 * Every entry left out, and every one that lost something on the way, is
 * reported, so the import preview can say exactly what the file brings. The
 * file's `_meta.sources` has one source per book its kept entries come from,
 * and `_meta.convertedFrom` records the format and converter version. Nothing
 * depends on the time or the device, so the same file converts to the same
 * JSON and a second import is caught as a duplicate.
 */
import type { RulesVersion } from '../../data5e/rulesVersion';
import type {
  ConversionReport,
  ConversionResult,
  ConvertedKind,
  ConvertOptions,
  EntryNote,
  OfficialFeat,
} from '../types';
import { childElements, childText, type XmlElement } from '../xml';
import { addFeatSource, convertBackground } from './background';
import { bookSource, codeEdition, type HomebrewSource, readSourceLine } from './books';
import { convertClassOption, isClassOption, isOnOfficialList } from './classOption';
import {
  extraClassKey,
  type Fc5Context,
  type Fc5Result,
  type FeatRef,
  type Placement,
  printingRef,
} from './context';
import { convertFeat } from './feat';
import { convertItem } from './item';
import { convertRace } from './race';
import { nameVariants } from './renames';
import { convertSpell, readClasses } from './spell';
import { abilityKey, entryName, lastGroup, sourceLineEdition, splitName } from './text';

export const FC5_FORMAT = 'fc5-compendium';
export const FC5_FORMAT_NAME = 'Fight Club 5e';
/** Bump when the same file would convert differently, so old imports can be told apart. */
export const FC5_CONVERTER_VERSION = 3;

const CONVERTERS: Record<string, (el: XmlElement, ctx: Fc5Context) => Fc5Result> = {
  spell: convertSpell,
  item: convertItem,
  feat: convertFeat,
  background: convertBackground,
  race: convertRace,
};

/**
 * Whether the converter reads an entry of this kind. One it does not is only
 * counted, so a reader that goes entry by entry need not build it.
 */
export function fc5Converts(name: string): boolean {
  return Object.hasOwn(CONVERTERS, name);
}

/** Kinds the format has that are left out on purpose, and why, in words. */
const LEFT_OUT: Record<string, { plural: string; why: string }> = {
  class: { plural: 'classes', why: 'classes cannot be converted yet' },
  monster: { plural: 'creatures', why: 'this app does not use creatures' },
};

const KIND_ORDER: readonly ConvertedKind[] = [
  'spell',
  'item',
  'feat',
  'optionalfeature',
  'background',
  'race',
];

/** Why an entry was left out, in words for the player. */
const WHY = {
  installed: 'your game data already has it',
  choiceOfficial: 'a copy per choice of a feat your game data already has, choices included',
  starredOfficial: 'a copy that adds subclass lists to a spell your game data already has',
  ritualOfficial: 'a ritual-only copy of a spell your game data already has',
  repeated: 'the file has it more than once, and the first one is kept',
  starred: 'a copy that adds subclass lists to a spell in the file, which gets them',
  ritual: 'a ritual-only copy of a spell in the file',
  choice: 'a copy per choice of a feat, and the copies are one feat with the choice here',
  choiceWhole: 'a copy per choice of a feat the file has whole',
} as const;

/** The homebrew source of entries that cite no book, named after the file. */
export function sourceFor(fileName: string): HomebrewSource {
  const base =
    fileName
      .replace(/^.*[\\/]/, '')
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .trim() || 'Compendium';
  const camel = base
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
    .slice(0, 28);
  const json = `FC${camel || 'Compendium'}`;
  return { json, abbreviation: json, full: `${base} (Fight Club 5e)` };
}

/** A spell entry that only adds class lists to a spell defined elsewhere. */
export function isSpellStub(el: XmlElement): boolean {
  return (
    el.name === 'spell' && childElements(el).every((c) => c.name === 'name' || c.name === 'classes')
  );
}

/** `Hold Person*`: a subclass-list copy of a spell. */
function isStarred(el: XmlElement): boolean {
  return splitName(childText(el, 'name') ?? '').name.endsWith('*');
}

/** The spell a `(Ritual Only)` copy repeats, or undefined for any other name. */
function ritualBase(name: string): string | undefined {
  const group = lastGroup(name);
  return group !== undefined && /^ritual only$/i.test(group.inner) ? group.base : undefined;
}

/** `spells_5.5e.xml` says 2024; most names say nothing. Only for entries that cite no book. */
function fileEdition(fileName: string): RulesVersion | undefined {
  return /5\.5e|2024|xphb/i.test(fileName) ? '2024' : undefined;
}

/**
 * Where an entry belongs, from its `Source:` line and what its name says of
 * its edition (see {@link Fc5Context.place}).
 */
function placer(
  fileSource: HomebrewSource,
  fileEd: RulesVersion | undefined,
  rulesBooks: ReadonlySet<string> | undefined,
): Fc5Context['place'] {
  return (line, own) => {
    const books = line === undefined ? [] : readSourceLine(line);
    const first = books[0];
    if (first === undefined) {
      const edition =
        own ?? (line === undefined ? undefined : sourceLineEdition(line)) ?? fileEd ?? '2014';
      const placement: Placement = { source: fileSource, edition, books, fields: {} };
      if (line !== undefined && line.trim() !== '') placement.citation = line;
      return placement;
    }
    // A book the app knows has its edition; another may say it in its title.
    const bookEdition =
      first.code !== undefined
        ? codeEdition(first.code, rulesBooks)
        : sourceLineEdition(first.title);
    // A free rules text that names no version is the file's.
    const edition = own ?? bookEdition ?? (first.reference === true ? fileEd : undefined) ?? '2014';
    const split = first.code === undefined && edition === '2024' && bookEdition !== '2024';
    const placement: Placement = {
      source: bookSource(first.title, split),
      edition,
      book: first,
      books,
      fields: first.page === undefined ? {} : { page: first.page },
    };
    if (first.code !== undefined && edition === bookEdition) placement.officialBook = first.code;
    if (books.length > 1) placement.citation = line;
    return placement;
  };
}

/** A kept entry with the official entry it prints, if any (see {@link printingRef}). */
function withPrinting(
  kind: ConvertedKind,
  entity: Record<string, unknown>,
  placement: Placement,
): Record<string, unknown> {
  const ref = printingRef(kind, entity, placement);
  if (ref !== undefined) entity.printingOf = [ref];
  return entity;
}

/** One converted entry, before the checks decide whether it is kept. */
interface Converted {
  /** The element's name, for the report. */
  tag: string;
  result: Extract<Fc5Result, { kind: ConvertedKind }>;
}

/**
 * Feats the file splits per choice, for the homebrew ones: `Dragon Fear
 * (Charisma)`, `Dragon Fear (Strength)` from one book are one feat, `Dragon
 * Fear`, with an ability choice built from all of them. What else differs
 * between the copies (a skill, the text) is kept from the first, and said.
 */
function mergeChoices(group: readonly Converted[], base: string): Converted {
  const first = group[0] as Converted;
  const entities = group.map((c) => c.result.entity);
  const choices = group.map((c) => lastGroup(c.result.name)?.inner ?? c.result.name);
  const merged: Record<string, unknown> = { ...first.result.entity, name: base };
  const reasons = [...first.result.reasons];

  // An ability per copy, by the same amount, is a choice between them.
  const fixed = entities.map((e) => {
    const ability = Array.isArray(e.ability) ? e.ability : [];
    const only = ability.length === 1 ? (ability[0] as Record<string, unknown>) : undefined;
    const keys = only === undefined ? [] : Object.keys(only);
    const key = keys[0];
    return keys.length === 1 && key !== undefined && typeof only?.[key] === 'number'
      ? { key, amount: only[key] as number }
      : undefined;
  });
  const sameJson = (key: string) =>
    entities.every((e) => JSON.stringify(e[key]) === JSON.stringify(entities[0]?.[key]));
  const from = [...new Set(fixed.map((f) => f?.key))];
  if (
    from.length > 1 &&
    fixed.every((f) => f !== undefined) &&
    new Set(fixed.map((f) => f?.amount)).size === 1
  ) {
    const amount = fixed[0]?.amount ?? 1;
    merged.ability = [{ choose: amount === 1 ? { from } : { from, amount } }];
  } else if (!sameJson('ability')) {
    delete merged.ability;
    reasons.push('its ability choice is kept as text');
  }

  const differs: string[] = [];
  const keys = new Set(entities.flatMap((e) => Object.keys(e)));
  for (const key of keys) {
    if (key === 'name' || key === 'ability' || key === 'entries' || key === 'page') continue;
    if (!sameJson(key)) {
      delete merged[key];
      differs.push(key);
    }
  }
  if (differs.length > 0) {
    reasons.push(`what differs per choice (${choices.join(', ')}) is kept as text`);
  }
  if (!sameJson('entries')) reasons.push('the copies per choice differ in text; the first is kept');
  return { ...first, result: { ...first.result, name: base, entity: merged, reasons } };
}

/** A context for converting entries one at a time, as the compendium does. */
export function fc5Context(
  fileName: string,
  more: {
    rulesBooks?: ReadonlySet<string>;
    featSources?: ReadonlyMap<string, readonly FeatRef[]>;
    extraClasses?: ReadonlyMap<string, readonly string[]>;
    officialFeat?: OfficialFeat;
  } = {},
): Fc5Context {
  const ctx: Fc5Context = {
    place: placer(sourceFor(fileName), fileEdition(fileName), more.rulesBooks),
    featSources: more.featSources ?? new Map(),
  };
  if (more.extraClasses !== undefined) ctx.extraClasses = more.extraClasses;
  if (more.officialFeat !== undefined) ctx.officialFeat = more.officialFeat;
  return ctx;
}

/** Whether the first pass reads an entry of this kind: spells and feats. */
export function fc5Indexes(name: string): boolean {
  return name === 'spell' || name === 'feat';
}

/**
 * A compendium converted in two passes over its entries, in file order both
 * times. The first ({@link Fc5Converter.index}) reads what converting any
 * entry depends on from the rest of the file: the spells it defines in full,
 * the class lists stubs and starred copies add to them, and its feats,
 * converted and decided. The second ({@link Fc5Converter.convert}) converts
 * each entry, so a reader that goes entry by entry can let each go once
 * converted. Every entry of the first pass comes before any of the second.
 */
export interface Fc5Converter {
  /** First pass. Reads spells and feats ({@link fc5Indexes}); other entries may come as stubs. */
  index(el: XmlElement): void;
  /** Second pass: every entry, whole. */
  convert(el: XmlElement): void;
  /** The file and its report. */
  finish(): ConversionResult;
}

/** A starred copy or a stub, for the class lists it adds to a spell. */
interface SpellCopy {
  name: string;
  edition: RulesVersion | undefined;
  classes: string | undefined;
  stub: boolean;
}

export function fc5Converter(opts: ConvertOptions): Fc5Converter {
  const fileSource = sourceFor(opts.fileName);
  // The class lists that stubs and starred copies add to spells, filled in
  // between the passes; the context hands them to the spells it converts.
  const extra = new Map<string, string[]>();
  const featSources = new Map<string, FeatRef[]>();
  const ctx = fc5Context(opts.fileName, {
    featSources,
    extraClasses: extra,
    ...(opts.rulesBooks === undefined ? {} : { rulesBooks: opts.rulesBooks }),
    ...(opts.officialFeat === undefined ? {} : { officialFeat: opts.officialFeat }),
  });

  // Whether the game data has an entry, when the data holds its book: in its
  // edition anywhere, for a book cited wrongly, or in any book it cites, under
  // its name or one Fight Club words differently. An entry from a book the
  // data does not hold is a printing of its own.
  const installed = (kind: ConvertedKind, name: string, placement: Placement): boolean => {
    const check = opts.isInstalled;
    if (check === undefined) return false;
    const book = placement.book;
    if (book === undefined) return check(kind, name, placement.edition);
    const held = (code: string | undefined): code is string =>
      code !== undefined && opts.hasBook?.(code) !== false;
    // A free rules text has its entries in the books the data has them under.
    if (!held(book.code)) return book.reference === true && check(kind, name, placement.edition);
    if (check(kind, name, placement.edition)) return true;
    // In the books it cites, under any name Fight Club gives it (`renames.ts`).
    const codes = [...new Set(placement.books.flatMap((b) => (held(b.code) ? [b.code] : [])))];
    const titles = placement.books.map((b) => b.title);
    return nameVariants(kind, name, titles).some((n) =>
      codes.some((code) => check(kind, n, placement.edition, code)),
    );
  };

  const notes: EntryNote[] = [];
  const leave = (c: Converted, status: EntryNote['status'], why: string) =>
    notes.push({ kind: c.tag, name: c.result.name, status, reasons: [why] });

  // First pass. The editions each full spell's name marks (undefined for
  // none), by name, and the copies that add lists to them.
  const isFull = (el: XmlElement) =>
    !isSpellStub(el) &&
    !isStarred(el) &&
    !isClassOption(el) &&
    ritualBase(entryName(childText(el, 'name') ?? '').name) === undefined;
  const fullEditions = new Map<string, Set<RulesVersion | undefined>>();
  const spellCopies: SpellCopy[] = [];
  // Feats before the rest: a background's feat grant names this file's source
  // only for a feat the converted file will hold. Each by its place among the
  // file's feats, which both passes count alike.
  const allFeats: (Converted & { at: number })[] = [];
  let featsIndexed = 0;

  const index = (el: XmlElement): void => {
    if (el.name === 'spell') {
      const named = entryName(childText(el, 'name') ?? '');
      if (isFull(el)) {
        const key = named.name.toLowerCase();
        const editions = fullEditions.get(key);
        if (editions === undefined) fullEditions.set(key, new Set([named.edition]));
        else editions.add(named.edition);
        return;
      }
      const stub = isSpellStub(el);
      if (stub || isStarred(el)) {
        spellCopies.push({
          name: named.name,
          edition: named.edition,
          classes: childText(el, 'classes'),
          stub,
        });
      }
    } else if (el.name === 'feat') {
      const at = featsIndexed;
      featsIndexed += 1;
      const result = convertFeat(el, ctx);
      if (!('skip' in result)) allFeats.push({ tag: el.name, result, at });
    }
  };

  // Between the passes.
  let fullSpells = new Set<string>();
  let unmatchedStubs = 0;
  const decided = new Map<number, Converted | undefined>();
  const featNotes = new Map<number, () => void>();
  let prepared = false;

  const prepare = (): void => {
    prepared = true;
    fullSpells = new Set(fullEditions.keys());
    for (const copy of spellCopies) {
      const editions = fullEditions.get(copy.name.toLowerCase());
      if (editions === undefined) {
        if (copy.stub) unmatchedStubs += 1;
        continue;
      }
      const { classes } = copy;
      if (classes === undefined) continue;
      // To the spell of the edition its name or class list marks; else to the
      // spell whose name marks none, as the other editions are marked; else,
      // when it cannot be told, to every one.
      const own = copy.edition ?? readClasses(classes).edition;
      const targets = editions.has(own)
        ? [own]
        : editions.has(undefined)
          ? [undefined]
          : [...editions];
      for (const target of targets) {
        const key = extraClassKey(copy.name, target);
        const list = extra.get(key);
        if (list === undefined) extra.set(key, [classes]);
        else list.push(classes);
      }
    }

    const featKey = (name: string, c: Converted) =>
      `${name.toLowerCase()}|${c.result.placement.source.json}|${c.result.edition}`;
    // A bracket is a choice when it names an ability, or when the book has the
    // feat with more than one: `Ember Fear (Strength)`, but not a lone
    // `Grappler (Revised)`, however often the file repeats it.
    const bracketed = new Map<string, Set<string>>();
    for (const c of allFeats) {
      const group = lastGroup(c.result.name);
      if (group !== undefined) {
        const key = featKey(group.base, c);
        const inners = bracketed.get(key);
        const inner = group.inner.toLowerCase();
        if (inners === undefined) bracketed.set(key, new Set([inner]));
        else inners.add(inner);
      }
    }
    const choiceOf = (c: Converted) => {
      const group = lastGroup(c.result.name);
      if (group === undefined) return undefined;
      const isChoice =
        abilityKey(group.inner) !== undefined ||
        (bracketed.get(featKey(group.base, c))?.size ?? 0) > 1;
      return isChoice ? group : undefined;
    };

    const feats: (Converted & { at: number })[] = [];
    const seenFeat = new Set<string>();
    for (const c of allFeats) {
      const key = featKey(c.result.name, c);
      if (seenFeat.has(key)) {
        featNotes.set(c.at, () => leave(c, 'duplicate', WHY.repeated));
        decided.set(c.at, undefined);
        continue;
      }
      seenFeat.add(key);
      if (installed('feat', c.result.name, c.result.placement)) {
        featNotes.set(c.at, () => leave(c, 'installed', WHY.installed));
        decided.set(c.at, undefined);
        continue;
      }
      const choice = choiceOf(c);
      if (choice !== undefined && installed('feat', choice.base, c.result.placement)) {
        featNotes.set(c.at, () => leave(c, 'installed', WHY.choiceOfficial));
        decided.set(c.at, undefined);
        continue;
      }
      feats.push(c);
    }
    // Homebrew copies per choice, grouped by the feat they split and its book.
    // Where the book has the feat whole too, the copies are left out for it.
    const groups = new Map<string, Converted[]>();
    for (const c of feats) {
      const choice = choiceOf(c);
      if (choice === undefined) continue;
      const key = featKey(choice.base, c);
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [c]);
      else group.push(c);
    }
    for (const c of feats) {
      const choice = choiceOf(c);
      const key = choice === undefined ? undefined : featKey(choice.base, c);
      const group = key === undefined ? undefined : groups.get(key);
      if (key !== undefined && seenFeat.has(key)) {
        featNotes.set(c.at, () => leave(c, 'duplicate', WHY.choiceWhole));
        decided.set(c.at, undefined);
      } else if (choice === undefined || group === undefined || group.length < 2) {
        decided.set(c.at, c);
        addFeatSource(featSources, c.result.name, c.result.placement.source.json);
      } else if (group[0] === c) {
        decided.set(c.at, mergeChoices(group, choice.base));
        addFeatSource(featSources, choice.base, c.result.placement.source.json);
      } else {
        featNotes.set(c.at, () => leave(c, 'duplicate', WHY.choice));
        decided.set(c.at, undefined);
      }
    }
    // Decided: nothing more is read from them.
    allFeats.length = 0;
    spellCopies.length = 0;
  };

  // Second pass.
  const out: Record<ConvertedKind, Record<string, unknown>[]> = {
    spell: [],
    item: [],
    feat: [],
    optionalfeature: [],
    background: [],
    race: [],
  };
  const sources = new Map<string, HomebrewSource>();
  const seen = new Set<string>();
  const leftOut = new Map<string, number>();
  const unknown = new Map<string, number>();
  const unofferedLists = new Set<string>();
  let unoffered = 0;
  let featsConverted = 0;

  const convert = (el: XmlElement): void => {
    if (!prepared) prepare();
    if (el.name === 'feat') {
      const at = featsConverted;
      featsConverted += 1;
      if (decided.has(at)) {
        featNotes.get(at)?.();
        const c = decided.get(at);
        if (c === undefined) return;
        out.feat.push(withPrinting('feat', c.result.entity, c.result.placement));
        sources.set(c.result.placement.source.json, c.result.placement.source);
        const reasons = [...new Set(c.result.reasons)];
        if (reasons.length > 0) {
          notes.push({ kind: 'feat', name: c.result.name, status: 'partial', reasons });
        }
        return;
      }
    }
    if (isSpellStub(el)) return;
    const option = isClassOption(el);
    // Element names come from the file, so `constructor` is not a converter.
    const converter = option
      ? convertClassOption
      : Object.hasOwn(CONVERTERS, el.name)
        ? CONVERTERS[el.name]
        : undefined;
    if (converter === undefined) {
      const counts = Object.hasOwn(LEFT_OUT, el.name) ? leftOut : unknown;
      counts.set(el.name, (counts.get(el.name) ?? 0) + 1);
      return;
    }
    const result = converter(el, ctx);
    if ('skip' in result) {
      const name = childText(el, 'name') ?? '(no name)';
      notes.push({ kind: el.name, name, status: 'skipped', reasons: [result.skip] });
      return;
    }
    const c: Converted = { tag: el.name, result };
    const { kind, name, placement } = result;

    if (kind === 'spell' && isStarred(el)) {
      if (fullSpells.has(name.toLowerCase())) {
        leave(c, 'duplicate', WHY.starred);
        return;
      }
      if (installed('spell', name, placement)) {
        leave(c, 'installed', WHY.starredOfficial);
        return;
      }
    }
    const ritual = kind === 'spell' ? ritualBase(name) : undefined;
    if (ritual !== undefined) {
      if (fullSpells.has(ritual.toLowerCase())) {
        leave(c, 'duplicate', WHY.ritual);
        return;
      }
      if (installed('spell', ritual, placement)) {
        leave(c, 'installed', WHY.ritualOfficial);
        return;
      }
    }

    const key = `${kind}|${name.toLowerCase()}|${placement.source.json}|${result.edition}`;
    if (seen.has(key)) {
      leave(c, 'duplicate', WHY.repeated);
      return;
    }
    seen.add(key);
    if (installed(kind, name, placement)) {
      leave(c, 'installed', WHY.installed);
      return;
    }
    out[kind].push(withPrinting(kind, result.entity, placement));
    sources.set(placement.source.json, placement.source);
    if (kind === 'optionalfeature' && !isOnOfficialList(result.entity)) {
      unoffered += 1;
      for (const t of result.entity.featureType as string[]) unofferedLists.add(t);
    }
    const reasons = [...new Set(result.reasons)];
    if (reasons.length > 0) {
      notes.push({ kind: el.name, name, status: 'partial', reasons });
    }
  };

  const finish = (): ConversionResult => {
    if (!prepared) prepare();
    const warnings: string[] = [];
    if (unmatchedStubs > 0) {
      warnings.push(
        `${unmatchedStubs} spell ${unmatchedStubs === 1 ? 'entry' : 'entries'} left out: ${unmatchedStubs === 1 ? 'it only adds' : 'they only add'} class lists to spells this file does not include.`,
      );
    }
    if (unoffered > 0) {
      const total = unoffered;
      const lists = [...unofferedLists];
      const named = lists.slice(0, 3).join('; ');
      warnings.push(
        `${total} class ${total === 1 ? 'option is' : 'options are'} for ${lists.length === 1 ? 'a class' : 'classes'} this app cannot convert yet (${named}${lists.length > 3 ? `, and ${lists.length - 3} more lists` : ''}). ${total === 1 ? 'It is' : 'They are'} in the Library under Optional features, but no character can pick ${total === 1 ? 'it' : 'them'} yet.`,
      );
    }
    for (const [name, count] of leftOut) {
      const what = LEFT_OUT[name];
      if (what !== undefined) {
        warnings.push(`${count} ${count === 1 ? name : what.plural} left out: ${what.why}.`);
      }
    }
    for (const [name, count] of unknown) {
      warnings.push(
        `${count} <${name}> ${count === 1 ? 'element' : 'elements'} left out: not part of this format.`,
      );
    }

    const converted: Partial<Record<ConvertedKind, number>> = {};
    const json: Record<string, unknown> = {
      _meta: {
        // A homebrew file needs a source even when nothing in it is kept.
        sources: sources.size > 0 ? [...sources.values()] : [fileSource],
        convertedFrom: {
          format: FC5_FORMAT,
          converterVersion: FC5_CONVERTER_VERSION,
          fileName: opts.fileName,
        },
      },
    };
    for (const kind of KIND_ORDER) {
      if (out[kind].length === 0) continue;
      json[kind] = out[kind];
      converted[kind] = out[kind].length;
    }

    const report: ConversionReport = {
      format: FC5_FORMAT,
      formatName: FC5_FORMAT_NAME,
      converterVersion: FC5_CONVERTER_VERSION,
      converted,
      notes,
      warnings,
    };
    return { json, report };
  };

  return { index, convert, finish };
}

export function convertFc5Compendium(root: XmlElement, opts: ConvertOptions): ConversionResult {
  const elements = childElements(root);
  const converter = fc5Converter(opts);
  for (const el of elements) converter.index(el);
  for (const el of elements) converter.convert(el);
  return converter.finish();
}
