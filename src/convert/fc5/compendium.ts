/**
 * A Fight Club 5e compendium (`<compendium>`, the format Game Master 5e and
 * Encounter+ read too) into one 5etools homebrew file.
 *
 * Every entry goes to its kind's converter. What comes back is checked twice
 * before it is kept: a second copy in the same file is left out (the registry
 * would hide it anyway), and so is an entry the installed game data already
 * has, because the installed one is the better copy. Both are reported, as is
 * every entry that lost something on the way, so the import preview can say
 * exactly what the file brings.
 *
 * The file gets one homebrew source named after it, and `_meta.convertedFrom`
 * records the format and converter version. Nothing in it depends on the time
 * or the device, so the same file converts to the same JSON and a second
 * import is caught as a duplicate.
 */
import type { RulesVersion } from '../../data5e/rulesVersion';
import type {
  ConversionReport,
  ConversionResult,
  ConvertedKind,
  ConvertOptions,
  EntryNote,
} from '../types';
import { childElements, childText, type XmlElement } from '../xml';
import { convertBackground } from './background';
import type { Fc5Context, Fc5Result } from './context';
import { convertFeat } from './feat';
import { convertItem } from './item';
import { convertRace } from './race';
import { convertSpell } from './spell';
import { splitName } from './text';

export const FC5_FORMAT = 'fc5-compendium';
export const FC5_FORMAT_NAME = 'Fight Club 5e';
/** Bump when the same file would convert differently, so old imports can be told apart. */
export const FC5_CONVERTER_VERSION = 1;

const CONVERTERS: Record<string, (el: XmlElement, ctx: Fc5Context) => Fc5Result> = {
  spell: convertSpell,
  item: convertItem,
  feat: convertFeat,
  background: convertBackground,
  race: convertRace,
};

/** Kinds the format has that are left out on purpose, and why, in words. */
const LEFT_OUT: Record<string, { plural: string; why: string }> = {
  class: { plural: 'classes', why: 'classes cannot be converted yet' },
  monster: { plural: 'creatures', why: 'this app does not use creatures' },
};

const KIND_ORDER: readonly ConvertedKind[] = ['spell', 'item', 'feat', 'background', 'race'];

/** The homebrew source a file's entries carry, named after the file. */
export function sourceFor(fileName: string): { json: string; abbreviation: string; full: string } {
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

/**
 * Class lists from stub entries, for spells this file defines in full. A stub
 * for a spell the file does not have cannot be applied: Fight Club merges it
 * into another file's spell, and a homebrew file cannot add to official data.
 */
function stubClasses(root: XmlElement): { extra: Map<string, string[]>; unmatched: number } {
  const spells = childElements(root, 'spell');
  const full = new Set(
    spells
      .filter((s) => !isSpellStub(s))
      .map((s) => splitName(childText(s, 'name') ?? '').name.toLowerCase()),
  );
  const extra = new Map<string, string[]>();
  let unmatched = 0;
  for (const stub of spells.filter(isSpellStub)) {
    const name = splitName(childText(stub, 'name') ?? '').name.toLowerCase();
    const classes = childText(stub, 'classes');
    if (!full.has(name)) unmatched += 1;
    else if (classes !== undefined) {
      const list = extra.get(name);
      if (list === undefined) extra.set(name, [classes]);
      else list.push(classes);
    }
  }
  return { extra, unmatched };
}

/** `spells_5.5e.xml` says 2024; most names say nothing. */
function fileEdition(fileName: string): RulesVersion | undefined {
  return /5\.5e|2024|xphb/i.test(fileName) ? '2024' : undefined;
}

export function convertFc5Compendium(root: XmlElement, opts: ConvertOptions): ConversionResult {
  const source = sourceFor(opts.fileName);
  const edition = fileEdition(opts.fileName);
  const stubs = stubClasses(root);
  // Filled below, before any background reads it.
  const featNames = new Set<string>();
  const ctx: Fc5Context = { source: source.json, featNames, extraClasses: stubs.extra };
  if (edition !== undefined) ctx.fileEdition = edition;

  // Feats first: a background's feat grant names this file's source only for
  // a feat the converted file will hold. One the game data already has is
  // left out, so its grant must name the installed copy instead.
  const featResults = new Map<XmlElement, Fc5Result>();
  for (const el of childElements(root, 'feat')) {
    const result = convertFeat(el, ctx);
    featResults.set(el, result);
    if (!('skip' in result) && opts.isInstalled?.('feat', result.name, result.edition) !== true) {
      featNames.add(result.name.toLowerCase());
    }
  }

  const out: Record<ConvertedKind, Record<string, unknown>[]> = {
    spell: [],
    item: [],
    feat: [],
    background: [],
    race: [],
  };
  const notes: EntryNote[] = [];
  const seen = new Set<string>();
  const leftOut = new Map<string, number>();
  const unknown = new Map<string, number>();

  for (const el of childElements(root)) {
    if (isSpellStub(el)) continue;
    // Element names come from the file, so `constructor` is not a converter.
    const convert = Object.hasOwn(CONVERTERS, el.name) ? CONVERTERS[el.name] : undefined;
    if (convert === undefined) {
      const counts = Object.hasOwn(LEFT_OUT, el.name) ? leftOut : unknown;
      counts.set(el.name, (counts.get(el.name) ?? 0) + 1);
      continue;
    }
    const result = featResults.get(el) ?? convert(el, ctx);
    if ('skip' in result) {
      const name = childText(el, 'name') ?? '(no name)';
      notes.push({ kind: el.name, name, status: 'skipped', reasons: [result.skip] });
      continue;
    }
    const key = `${result.kind}|${result.name.toLowerCase()}|${result.edition}`;
    if (seen.has(key)) {
      notes.push({
        kind: el.name,
        name: result.name,
        status: 'duplicate',
        reasons: ['the file has it more than once, and the first one is kept'],
      });
      continue;
    }
    seen.add(key);
    if (opts.isInstalled?.(result.kind, result.name, result.edition) === true) {
      notes.push({
        kind: el.name,
        name: result.name,
        status: 'installed',
        reasons: ['your game data already has it'],
      });
      continue;
    }
    out[result.kind].push(result.entity);
    const reasons = [...new Set(result.reasons)];
    if (reasons.length > 0) {
      notes.push({ kind: el.name, name: result.name, status: 'partial', reasons });
    }
  }

  const warnings: string[] = [];
  if (stubs.unmatched > 0) {
    warnings.push(
      `${stubs.unmatched} spell ${stubs.unmatched === 1 ? 'entry' : 'entries'} left out: ${stubs.unmatched === 1 ? 'it only adds' : 'they only add'} class lists to spells this file does not include.`,
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
      sources: [source],
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
}
