/**
 * Rule packs (ADR-001, D5): a homebrew file whose `_meta.castGuidance` is a
 * `StoredPackGuidance`. It holds data only (table rules, changes to entries,
 * moments and cues), which the engine reads by known keys; nothing in it is run.
 * It may hold content too, which merges as any homebrew file's does.
 *
 * Who a pack reaches, and its place among the player's packs, belong to this
 * device: they are kept on the stored file under `_meta.castGuidanceLocal`,
 * bound to the file's own id, and dropped whenever a file leaves (Share,
 * Download, a character's export). A file that arrives holding them already is
 * bound to another id, so it reaches nobody until the player applies it here.
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
} from '@/engine/castGuidance';
import { parseFormula } from '@/engine/formula';

/** Where in `_meta` a stored pack keeps what is this device's alone. */
export const PACK_LOCAL_KEY = 'castGuidanceLocal';

/** A pack's Apply to and its place in the player's list, on this device. */
export interface PackLocal {
  /** The stored file's id: the block counts only on the file it was written for. */
  file: string;
  appliesTo: PackAppliesTo;
  /** Its place among the packs, the later winning; absent, after every placed one. */
  order?: number;
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

/** This device's Apply to and place for a pack, when they were written here for `fileId`. */
export function packLocal(json: unknown, fileId: string): PackLocal | undefined {
  const raw = own(metaOf(json) ?? {}, PACK_LOCAL_KEY);
  if (!isRecord(raw) || own(raw, 'file') !== fileId || fileId === '') return undefined;
  const to = own(raw, 'appliesTo');
  const listed = isRecord(to) ? own(to, 'characters') : undefined;
  const characters = Array.isArray(listed)
    ? listed
        .slice(0, L.charactersPerPack)
        .filter((c): c is string => typeof c === 'string' && c !== '' && c.length <= L.labelLength)
    : [];
  const order = own(raw, 'order');
  return {
    file: fileId,
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

/** `json` holding this device's Apply to and place for it. `json` itself is left as it is. */
export function withPackLocal(
  json: Record<string, unknown>,
  local: PackLocal,
): Record<string, unknown> {
  const block = {
    file: local.file,
    appliesTo: {
      characters: [...local.appliesTo.characters],
      ...(local.appliesTo.appDefault === true ? { appDefault: true } : {}),
    },
    ...(local.order === undefined ? {} : { order: local.order }),
  };
  return { ...json, _meta: { ...metaOf(json), [PACK_LOCAL_KEY]: block } };
}

/**
 * A file as it leaves this device (Share, Download, a character's export):
 * without who its pack is applied to here, which means nothing anywhere else.
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
            : L.labelLength;
      if (value.length > max) {
        reasons.add(
          key === 'f'
            ? `a formula is at most ${max} characters`
            : `${LONG_TEXT.has(key) ? 'a text' : key === 'target' ? 'a change’s target' : 'a name or label'} is at most ${max} characters`,
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
      if (key === 'byLevel' && Object.keys(value).length > L.byLevelRows) {
        reasons.add(`a level table has at most ${L.byLevelRows} levels`);
      }
      for (const k of Object.keys(value)) stack.push([value[k], k]);
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
  /** This device's Apply to and place, when written here for this file. */
  local?: PackLocal;
  /** The limits it breaks (`packRefusals`); while any, it reaches nobody. */
  refusals: string[];
}

/**
 * The packs among homebrew files (id to content, in merge order), in the
 * player's order: a placed pack by its place and the rest after them as they
 * merged, so a pack added later wins.
 */
export function packsInOrder(
  files: Iterable<readonly [string, Record<string, unknown>]>,
): StoredPack[] {
  const found: Array<{ at: number; pack: StoredPack }> = [];
  for (const [id, json] of files) {
    const guidance = packGuidance(json);
    if (guidance === undefined) continue;
    const local = packLocal(json, id);
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
export function rulePackEntries(
  files: Iterable<readonly [string, Record<string, unknown>]>,
): RulePackEntry[] {
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
