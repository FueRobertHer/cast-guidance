/**
 * Rule packs (ADR-001, D5): a homebrew file whose `_meta.castGuidance` is a
 * `StoredPackGuidance`. It holds data only (table rules, changes to entries,
 * moments and cues), which the engine reads by known keys; nothing in it is run.
 * It may hold content too, which merges as any homebrew file's does.
 *
 * Who a pack reaches, and its place among the player's packs, belong to this
 * device: they are kept on the stored file's row (`HomebrewFileRow.pack`),
 * never in its JSON, so the file stays what came from its link, an update of
 * it keeps them (ADR-002, D4), and nothing that leaves the device carries
 * them. Before that they were kept in the file's `_meta.castGuidanceLocal`;
 * a file that arrives holding such a block is read as any other, so it
 * reaches nobody until the player applies it here.
 *
 * Pure, as `normalize.ts` is: the registry reads packs through `rulePackEntries`.
 */
import {
  formulaNamesFor,
  isRecord,
  CAST_GUIDANCE_LIMITS as L,
  own,
  type PackAppliesTo,
  type RulePackEntry,
} from '../engine/castGuidance';
import { parseFormula } from '../engine/formula';

/**
 * Where in `_meta` a pack's Apply to was kept before it moved onto the row.
 * Nothing reads it now; a file leaving the device is still sent without it.
 */
export const PACK_LOCAL_KEY = 'castGuidanceLocal';

/** A pack's Apply to and its place in the player's list, on this device. */
export interface PackLocal {
  appliesTo: PackAppliesTo;
  /** Its place among the packs, the later winning; absent, after every placed one. */
  order?: number;
}

/** A stored file as the packs are read from it: its id, its content and its row's settings. */
export interface PackFile {
  id: string;
  json: unknown;
  pack?: PackLocal;
}

function metaOf(json: unknown): Record<string, unknown> | undefined {
  const meta = isRecord(json) ? own(json, '_meta') : undefined;
  return isRecord(meta) ? meta : undefined;
}

/** The pack a homebrew file holds (`_meta.castGuidance`), or undefined for plain content. */
export function packGuidance(json: unknown): Record<string, unknown> | undefined {
  const guidance = own(metaOf(json) ?? {}, 'castGuidance');
  return isRecord(guidance) ? guidance : undefined;
}

export const isRulePack = (json: unknown): boolean => packGuidance(json) !== undefined;

/** The book a file declares first: its id and, when it has one, its full name. */
function firstSource(json: unknown): { id?: string; full?: string } {
  const sources = own(metaOf(json) ?? {}, 'sources');
  const first = Array.isArray(sources) && isRecord(sources[0]) ? sources[0] : {};
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  const id = text(own(first, 'json'));
  const full = text(own(first, 'full'));
  return { ...(id === undefined ? {} : { id }), ...(full === undefined ? {} : { full }) };
}

/** A pack's name, as the sheet and the review show it: its book's full name, else its id. */
export function packName(json: unknown, fallback = 'A rule pack'): string {
  const { id, full } = firstSource(json);
  return (full ?? id ?? fallback).slice(0, L.labelLength);
}

/**
 * A stored row's pack settings, read as every stored value is: each character
 * a label, at most a pack's worth, and an order only when it is a number.
 * Undefined for a row with none.
 */
export function readPackLocal(raw: unknown): PackLocal | undefined {
  if (!isRecord(raw)) return undefined;
  const to = own(raw, 'appliesTo');
  const listed = isRecord(to) ? own(to, 'characters') : undefined;
  const characters = Array.isArray(listed)
    ? listed
        .slice(0, L.charactersPerPack)
        .filter((c): c is string => typeof c === 'string' && c !== '' && c.length <= L.labelLength)
    : [];
  const order = own(raw, 'order');
  return {
    appliesTo: {
      characters,
      ...(isRecord(to) && own(to, 'appDefault') === true ? { appDefault: true } : {}),
    },
    ...(typeof order === 'number' && Number.isFinite(order) ? { order } : {}),
  };
}

/** True when a pack applied this way reaches anybody. */
export const reachesAnyone = (to: PackAppliesTo | undefined): boolean =>
  to !== undefined && (to.appDefault === true || to.characters.length > 0);

/**
 * A file as it leaves this device (Share, Download, a character's export):
 * without a `_meta.castGuidanceLocal` block, which means nothing anywhere else.
 */
export function sharedFile<T>(json: T): T {
  const meta = metaOf(json);
  if (meta === undefined || !Object.hasOwn(meta, PACK_LOCAL_KEY)) return json;
  const { [PACK_LOCAL_KEY]: _, ...rest } = meta;
  return { ...(json as Record<string, unknown>), _meta: rest } as T;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** The most reasons a refusal lists; past it, one line says how many more. */
const MOST_REASONS = 5;
const ANY_NAME = formulaNamesFor('acBonus').names;
const LONG_TEXT = new Set(['text', 'note']);
/** Keys holding a `Name|Source` reference, which the effect reader takes up to twice a label. */
const REFS = new Set(['spell', 'basedOn']);
const REF_LENGTH = 2 * L.labelLength;
const n = (x: number) => x.toLocaleString('en-US');

/**
 * Why a pack cannot be added, worded for the player: each limit in
 * `CAST_GUIDANCE_LIMITS` it breaks. Empty when it keeps to all of them. A pack
 * within its limits may still hold values the app cannot read; those are the
 * readers' problems, shown in the review and on the sheet, and do not refuse it.
 */
export function packRefusals(guidance: Record<string, unknown>): string[] {
  const reasons = new Set<string>();
  const list = (key: string) => {
    const v = own(guidance, key);
    return Array.isArray(v) ? v : [];
  };
  const most = (key: string, max: number, what: string) => {
    const count = list(key).length;
    if (count > max) reasons.add(`it has ${n(count)} ${what}; a pack has at most ${n(max)}`);
  };
  most('patches', L.patchesPerPack, 'changes to entries');
  // Past the limit the merge would read only the first ones, so the pack is refused whole.
  most('replaces', L.replacesPerPack, 'entries it replaces');
  most('moments', L.momentsPerPack, 'moments');
  most('cues', L.cuesPerPack, 'cues');
  list('patches').forEach((p, i) => {
    for (const key of ['effects', 'add']) {
      const effects = isRecord(p) ? own(p, key) : undefined;
      if (Array.isArray(effects) && effects.length > L.effectsPerEntry) {
        reasons.add(
          `change ${i + 1} has ${n(effects.length)} effects; one change has at most ${L.effectsPerEntry}`,
        );
      }
    }
    const amend = isRecord(p) ? own(p, 'amend') : undefined;
    if (Array.isArray(amend) && amend.length > L.amendsPerEntry) {
      reasons.add(
        `change ${i + 1} has ${n(amend.length)} prices; one change has at most ${L.amendsPerEntry}`,
      );
    }
  });
  list('moments').forEach((m, i) => {
    const outcomes = isRecord(m) ? own(m, 'do') : undefined;
    if (!Array.isArray(outcomes)) return;
    if (outcomes.length > L.outcomesPerMoment) {
      reasons.add(
        `moment ${i + 1} does ${n(outcomes.length)} things; a moment does at most ${L.outcomesPerMoment}`,
      );
    }
    for (const o of outcomes) {
      const effects = isRecord(o) ? own(o, 'effects') : undefined;
      if (Array.isArray(effects) && effects.length > L.effectsPerEntry) {
        reasons.add(
          `moment ${i + 1} adds an effect of ${n(effects.length)} parts; one has at most ${L.effectsPerEntry}`,
        );
      }
    }
  });
  // Every value, wherever it sits: an explicit stack, as the file can be deep.
  const stack: Array<[value: unknown, key: string]> = [[guidance, '']];
  while (stack.length > 0) {
    const [value, key] = stack.pop() as [unknown, string];
    if (typeof value === 'number') {
      if (Math.abs(value) > L.amountLimit) {
        reasons.add(`a number is at most ${n(L.amountLimit)} either way, not ${n(value)}`);
      }
    } else if (typeof value === 'string') {
      const max = LONG_TEXT.has(key)
        ? L.textLength
        : key === 'target'
          ? L.targetLength
          : key === 'f'
            ? L.formulaLength
            : REFS.has(key)
              ? REF_LENGTH
              : L.labelLength;
      if (value.length > max) {
        reasons.add(
          key === 'f'
            ? `a formula is at most ${max} characters`
            : `${LONG_TEXT.has(key) ? 'a text' : key === 'target' ? 'a change’s target' : REFS.has(key) ? 'a reference to an entry' : 'a name or label'} is at most ${max} characters`,
        );
      } else if (key === 'f') {
        const read = parseFormula(value, ANY_NAME);
        if ('problem' in read && read.problem.startsWith('a formula is at most')) {
          reasons.add(read.problem);
        }
      }
    } else if (Array.isArray(value)) {
      if (key === 'while' && value.length > L.statesPerEffect) {
        reasons.add(`an effect holds while at most ${L.statesPerEffect} states`);
      }
      for (const v of value) stack.push([v, key]);
    } else if (isRecord(value)) {
      for (const k of Object.keys(value)) {
        const child = value[k];
        if (k === 'byLevel' && isRecord(child)) {
          if (Object.keys(child).length > L.byLevelRows) {
            reasons.add(`a level table has at most ${L.byLevelRows} levels`);
          }
          // A level table's rows are the values of the field that holds it: a note's are texts.
          for (const row of Object.values(child)) stack.push([row, key]);
        } else if (
          isRecord(child) &&
          (k === 'byGrant' || (k === 'values' && value.byAnswer !== undefined))
        ) {
          if (Object.keys(child).length > L.answerRows) {
            reasons.add(`a table by an answer or a spell granted has at most ${L.answerRows} rows`);
          }
          // As a level table's: its rows are the values of the field that holds it.
          for (const row of Object.values(child)) stack.push([row, key]);
        } else stack.push([child, k]);
      }
    }
  }
  const all = [...reasons];
  return all.length > MOST_REASONS
    ? [...all.slice(0, MOST_REASONS), `and ${all.length - MOST_REASONS} more`]
    : all;
}

// ---------------------------------------------------------------------------
// The registry's packs
// ---------------------------------------------------------------------------

/** A pack among the stored files, as `packsInOrder` finds it. */
export interface StoredPack {
  id: string;
  name: string;
  /** Its book's id, as the registry names a pack's source. */
  source: string;
  guidance: Record<string, unknown>;
  /** This device's Apply to and place, from the file's row. */
  local?: PackLocal;
  /** The limits it breaks (`packRefusals`); while any, it reaches nobody. */
  refusals: string[];
}

/**
 * The packs among homebrew files (in merge order), in the player's order: a
 * placed pack by its place and the rest after them as they merged, so a pack
 * added later wins.
 */
export function packsInOrder(files: Iterable<PackFile>): StoredPack[] {
  const found: Array<{ at: number; pack: StoredPack }> = [];
  for (const { id, json, pack: local } of files) {
    const guidance = packGuidance(json);
    if (guidance === undefined) continue;
    found.push({
      at: found.length,
      pack: {
        id,
        name: packName(json),
        source: firstSource(json).id ?? '',
        guidance,
        ...(local === undefined ? {} : { local }),
        refusals: packRefusals(guidance),
      },
    });
  }
  const place = (p: StoredPack) => p.local?.order ?? Number.POSITIVE_INFINITY;
  found.sort((a, b) => place(a.pack) - place(b.pack) || a.at - b.at);
  return found.map((f) => f.pack);
}

/** Who a stored pack reaches now: nobody while it breaks a limit or was never applied here. */
export const packReach = (pack: StoredPack): PackAppliesTo | undefined =>
  pack.refusals.length === 0 ? pack.local?.appliesTo : undefined;

/**
 * The packs as the registry lists them (`RULE_PACK_TYPE`), in the player's
 * order. A pack reaches only who this device applied it to.
 */
export function rulePackEntries(files: Iterable<PackFile>): RulePackEntry[] {
  return packsInOrder(files).map((p) => {
    const to = packReach(p);
    return {
      name: p.name,
      source: p.source,
      castGuidance: p.guidance as unknown as RulePackEntry['castGuidance'],
      ...(to === undefined ? {} : { appliesTo: to }),
    };
  });
}
