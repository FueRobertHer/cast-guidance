/**
 * A spell's text, read and kept (ADR-001; the Spell board's B as a head start).
 *
 * The sheet reads a spell's dice from its text (`{@damage 3d8}` and `{@dice 2d8}`
 * in `entries`, `{@scaledamage}` in `entriesHigherLevel`: `spellRolls.ts`), so
 * the spell editor's cards are a view of those tags and of the standard fields
 * beside them. This module is the part with no React:
 *
 * - `readSpellText` runs the readers the Fight Club converter turns a printed
 *   spell into fields with over what the author wrote, and returns what they
 *   found as offers. Nothing is applied until the editor accepts one.
 * - `wordsOf` and `retag` let the author edit the text as plain words while the
 *   tags they accepted stay on the words they were on.
 * - `tagFirst`, `swapTag` and `untag` are the edits the cards make to the text.
 */
import { ATTACK, SAVE, textCantripScaling, textUpcastTag } from '@/convert/fc5/spell';
import { DAMAGE_TYPES, type Entry, inlineText, plainText } from '@/convert/fc5/text';
import { isRecord } from '@/engine/castGuidance';

type Json = Record<string, unknown>;

/** The tags the sheet reads in a spell's text, which editing keeps on their words. */
const KEPT = /\{@(damage|dice|condition|scaledamage|scaledice) ([^{}]{1,200})\}/g;
const ANY_TAG = /(\{@[^{}]*\})/;
const TYPE_AFTER = new RegExp(`^\\s+(${DAMAGE_TYPES.join('|')})\\b`, 'i');
const HEALS = /\bregains?\b|\bhealing\b/i;
const CONDITIONS =
  /\b(blinded|charmed|deafened|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)\b/gi;
/** A paragraph that says what a higher slot does, as both books lead it in. */
const HIGHER_LEAD = /^(at higher levels|using a higher-level spell slot|cantrip upgrade)[.:]\s+/i;
/** A paragraph that says it with no lead: the 2014 cantrips' ladder, a slot's step. */
const HIGHER_WORDS =
  /\bincreases? by \S+ when you reach (?:5th level|levels? 5)\b|\bfor each (?:spell )?slot level above\b/i;
const DAMAGE_TAG = new RegExp(`\\{@damage [^{}]*\\}\\s+(${DAMAGE_TYPES.join('|')})\\b`, 'gi');

export interface Tag {
  /** The tag as written: `{@damage 3d8}`. */
  full: string;
  kind: string;
  /** What it reads as: `3d8`. */
  words: string;
}

/** What a kept tag reads as: its dice, a condition's name, a scaling tag's step. */
function tagWords(kind: string, body: string): string {
  const args = body.split('|');
  if (kind === 'condition') return args[2] || (args[0] ?? '');
  if (kind.startsWith('scale')) return args[3] || (args[2] ?? '');
  return args[1] || (args[0] ?? '');
}

/** The kept tags in a text, in order. */
export function tagsIn(text: string): Tag[] {
  return [...text.matchAll(KEPT)].map((m) => ({
    full: m[0],
    kind: m[1] ?? '',
    words: tagWords(m[1] ?? '', m[2] ?? ''),
  }));
}

/** The text with its kept tags as the words they read as; other tags stay as written. */
export function wordsOf(text: string): string {
  return text.replace(KEPT, (_, kind: string, body: string) => tagWords(kind, body));
}

/** `s` as a pattern that matches it literally. */
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `words` as a pattern: whole words, any case, a sign in a roll with or without spaces. */
const wordsPattern = (words: string) =>
  new RegExp(`(?<![\\w@])${escapeRe(words).replace(/\\\+|-/g, '\\s?$&\\s?')}(?!\\w)`, 'gi');

/** Where `words` stand in `text` at or after `from`, outside any tag. */
function findWords(text: string, words: string, from: number): RegExpExecArray | undefined {
  const re = wordsPattern(words);
  re.lastIndex = from;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const open = text.lastIndexOf('{@', m.index);
    if (open === -1 || text.lastIndexOf('}', m.index) > open) return m;
  }
  return undefined;
}

/** A tag of `kind` on `words` as found: a condition keeps the case it was typed in. */
function tagged(kind: string, words: string, full?: string): string {
  return full ?? `{@${kind} ${words}}`;
}

/**
 * `typed` with each of `tags` put back on its words, in order, where they still
 * stand. A tag whose words were deleted goes with them, so a card never
 * outlives the words it reads.
 */
export function retag(typed: string, tags: readonly Tag[]): string {
  let out = typed;
  let from = 0;
  for (const t of tags) {
    const m = findWords(out, t.words, from) ?? findWords(out, t.words, 0);
    if (m === undefined) continue;
    const same = m[0] === t.words;
    const put = tagged(t.kind, m[0], same ? t.full : undefined);
    out = out.slice(0, m.index) + put + out.slice(m.index + m[0].length);
    from = m.index + put.length;
  }
  return out;
}

/** Every string in `entries`, deep (lists, named parts), changed by `fn`. */
export function mapStrings(entries: unknown, fn: (s: string) => string): unknown {
  if (typeof entries === 'string') return fn(entries);
  if (Array.isArray(entries)) return entries.map((e) => mapStrings(e, fn));
  if (!isRecord(entries)) return entries;
  const out: Json = { ...entries };
  for (const key of ['entries', 'items'] as const) {
    if (Array.isArray(entries[key])) out[key] = mapStrings(entries[key], fn);
  }
  return out;
}

/** Every string in `entries`, deep, in order. */
export function stringsOf(entries: unknown): string[] {
  const out: string[] = [];
  mapStrings(entries, (s) => {
    out.push(s);
    return s;
  });
  return out;
}

/** `entries` with the first untagged `words` tagged `kind`; unchanged when they are not there. */
export function tagFirst(entries: unknown, words: string, kind: string): unknown {
  let done = false;
  return mapStrings(entries, (s) => {
    if (done) return s;
    const m = findWords(s, words, 0);
    if (m === undefined) return s;
    done = true;
    return (
      s.slice(0, m.index) + tagged(kind, m[0].replace(/\s+/g, '')) + s.slice(m.index + m[0].length)
    );
  });
}

/** `entries` with each `{@kind from…}` now `{@kind to…}`: a roll's dice changed. */
export function swapTag(entries: unknown, kind: string, from: string, to: string): unknown {
  const re = new RegExp(`\\{@${kind} ${escapeRe(from)}(?=[|}])`, 'g');
  return mapStrings(entries, (s) => s.replace(re, `{@${kind} ${to}`));
}

/** `entries` with each `{@kind body}` back to its words: a card taken off. */
export function untag(entries: unknown, kind: string, body: string): unknown {
  const re = new RegExp(`\\{@${kind} (${escapeRe(body)})(?:\\|[^{}]*)?\\}`, 'gi');
  return mapStrings(entries, (s) => s.replace(re, '$1'));
}

/** A sentence added to the end of the text, for a card added by hand. */
export function withSentence(entries: unknown, sentence: string): unknown[] {
  return [...(Array.isArray(entries) ? entries : []), sentence];
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

export type FindingKind =
  | 'damage'
  | 'heal'
  | 'roll'
  | 'save'
  | 'attack'
  | 'condition'
  | 'higher'
  | 'cantrip';

/** Something the reader found, and the fields that take it if the author accepts. */
export interface Finding {
  kind: FindingKind;
  /** What it found, in words: "3d8 radiant damage". */
  what: string;
  /** The words it read it from. */
  quote: string;
  /** Top-level fields to set; `undefined` takes one out. */
  patch: Json;
}

const cap = (s: string) => `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`;
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The ordinal a slot level reads as: 1st, 2nd, 3rd, 4th. */
export function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

/** Text as the converter tags it: every roll a chip, the existing tags left alone. */
function asConverted(entries: unknown): Entry[] {
  return list(
    mapStrings(entries, (s) =>
      s
        .split(ANY_TAG)
        .map((p) => (p.startsWith('{@') ? p : inlineText(p)))
        .join(' '),
    ),
  ) as Entry[];
}

/** Whether a block is a paragraph about higher slots, led in as the books lead it. */
function isHigherBlock(e: unknown): boolean {
  if (typeof e === 'string') return HIGHER_LEAD.test(e);
  return isRecord(e) && typeof e.name === 'string' && HIGHER_LEAD.test(`${e.name}. `);
}

/** A paragraph about higher levels, led in or not: its rolls are steps, not the spell's own. */
function isHigherText(e: unknown): boolean {
  return isHigherBlock(e) || (typeof e === 'string' && HIGHER_WORDS.test(wordsOf(e)));
}

/**
 * The `nth` untagged `words` in the spell's own paragraphs tagged `kind`,
 * leaving what it says of higher levels alone: Flame Strike's second 4d6 is
 * its radiant damage, not its fire.
 */
function tagInMain(entries: unknown[], words: string, kind: string, nth = 0): unknown[] {
  let left = nth;
  let done = false;
  return entries.map((e) => {
    if (done || isHigherText(e)) return e;
    return mapStrings(e, (s) => {
      if (done) return s;
      for (let m = findWords(s, words, 0); m !== undefined; m = findWords(s, words, m.index + 1)) {
        if (left > 0) {
          left -= 1;
          continue;
        }
        done = true;
        return (
          s.slice(0, m.index) +
          tagged(kind, m[0].replace(/\s+/g, '')) +
          s.slice(m.index + m[0].length)
        );
      }
      return s;
    });
  });
}

/**
 * A paragraph that ends on how the spell grows, split there: "...3d8 fire
 * damage. The damage increases by 1d8 for each slot level above 1st." reads
 * as the spell's own sentence and its higher-level one, as the books print
 * them. A paragraph led in as the books lead it, or wholly about higher
 * levels, stays whole.
 */
function splitHigher(entries: unknown[]): unknown[] {
  return entries.flatMap((e) => {
    if (typeof e !== 'string' || isHigherBlock(e)) return [e];
    const m = HIGHER_WORDS.exec(e);
    if (m === null) return [e];
    const cut = e.slice(0, m.index).search(/[.!?]\s+(?=[^.!?]*$)/);
    if (cut === -1) return [e];
    return [e.slice(0, cut + 1), e.slice(cut + 1).trimStart()];
  });
}

/** `damageInflict` with the types the tagged damage in `entries` names added. */
function inflictWith(spell: Json, entries: unknown): unknown {
  const types = new Set(strings(spell.damageInflict));
  for (const s of stringsOf(entries))
    for (const m of s.matchAll(DAMAGE_TAG)) types.add((m[1] ?? '').toLowerCase());
  return types.size > 0 ? [...types] : undefined;
}

/** A higher-slot paragraph as the field holds one: a named block. */
function asHigherBlock(e: unknown, edition2024: boolean): unknown {
  if (typeof e !== 'string') return e;
  const lead = HIGHER_LEAD.exec(e);
  const name = /cantrip/i.test(lead?.[1] ?? '')
    ? 'Cantrip Upgrade'
    : edition2024
      ? 'Using a Higher-Level Spell Slot'
      : 'At Higher Levels';
  return { type: 'entries', name, entries: [e.slice(lead?.[0].length ?? 0)] };
}

/** The rolls a plain part of the text holds, as the converter reads them. */
function rollsIn(
  entries: unknown,
): Array<{ kind: 'damage' | 'dice'; dice: string; after: string; s: string }> {
  const out: Array<{ kind: 'damage' | 'dice'; dice: string; after: string; s: string }> = [];
  for (const s of stringsOf(entries)) {
    for (const part of s.split(ANY_TAG)) {
      if (part.startsWith('{@')) continue;
      const read = inlineText(part);
      for (const m of read.matchAll(/\{@(damage|dice) ([^{}|]+)\}/g)) {
        const end = (m.index ?? 0) + m[0].length;
        out.push({
          kind: m[1] as 'damage' | 'dice',
          dice: m[2] ?? '',
          after: read.slice(end, end + 60),
          s,
        });
      }
    }
  }
  return out;
}

/**
 * What the reader finds in a spell's text that its fields do not say yet: rolls
 * not tagged, saves and attacks not listed, conditions not named, and how it
 * grows at higher levels. Each comes with the fields that take it.
 */
export function readSpellText(spell: Json): Finding[] {
  // A finding taken writes the text with its higher-level sentence apart.
  const entries = splitHigher(list(spell.entries));
  const level = typeof spell.level === 'number' ? spell.level : 0;
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const key = `${f.kind}|${f.what}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  const main = entries.filter((e) => !isHigherText(e));
  const higherInText = entries.filter(isHigherText);

  const rolls = rollsIn(main);
  rolls.forEach((r, i) => {
    const type = TYPE_AFTER.exec(r.after)?.[1]?.toLowerCase();
    // Which of the untagged rolls of these dice this is, in reading order.
    const nth = rolls.slice(0, i).filter((x) => x.dice === r.dice).length;
    if (r.kind === 'damage') {
      const tagged = tagInMain(entries, r.dice, 'damage', nth);
      add({
        kind: 'damage',
        what: `${r.dice}${type ? ` ${type}` : ''} damage`,
        quote: r.dice,
        patch: {
          entries: tagged,
          damageInflict: inflictWith(spell, tagged),
        },
      });
    } else {
      const heal = HEALS.test(r.s);
      add({
        kind: heal ? 'heal' : 'roll',
        what: heal ? `${r.dice} healing` : `A roll of ${r.dice}`,
        quote: r.dice,
        patch: {
          entries: tagInMain(entries, r.dice, 'dice', nth),
          ...(heal ? { miscTags: [...new Set([...strings(spell.miscTags), 'HL'])] } : {}),
        },
      });
    }
  });

  const words = wordsOf(plainText(main as Entry[]));
  const saves = strings(spell.savingThrow);
  for (const m of words.matchAll(SAVE)) {
    const ability = (m[1] ?? '').toLowerCase();
    if (saves.includes(ability)) continue;
    add({
      kind: 'save',
      what: `${cap(ability)} save`,
      quote: m[0],
      patch: { savingThrow: [...saves, ability] },
    });
  }
  const attacks = strings(spell.spellAttack);
  for (const m of words.matchAll(ATTACK)) {
    const code = (m[1] ?? '').toLowerCase() === 'melee' ? 'M' : 'R';
    if (attacks.includes(code)) continue;
    add({
      kind: 'attack',
      what: `${code === 'M' ? 'Melee' : 'Ranged'} spell attack`,
      quote: m[0],
      patch: { spellAttack: [...attacks, code] },
    });
  }
  const conditions = strings(spell.conditionInflict);
  for (const m of words.matchAll(CONDITIONS)) {
    const condition = (m[1] ?? '').toLowerCase();
    if (conditions.includes(condition)) continue;
    add({
      kind: 'condition',
      what: cap(condition),
      quote: m[0],
      patch: {
        conditionInflict: [...conditions, condition],
        entries: tagInMain(entries, m[0], 'condition'),
      },
    });
  }

  // How it grows: the converter's own upcast and cantrip readers, over the
  // text with every roll read as a chip, as a printed spell would be.
  const higher = [...list(spell.entriesHigherLevel), ...higherInText];
  const tagsHigher = stringsOf(spell.entriesHigherLevel).some((s) => s.includes('{@scale'));
  if (higher.length > 0 && !tagsHigher && spell.scalingLevelDice === undefined) {
    const converted = asConverted(main);
    const convertedHigher = asConverted(higher);
    const quote = wordsOf(plainText(higher as Entry[]));
    if (level > 0) {
      const tag = textUpcastTag(converted, convertedHigher, level);
      const m =
        tag === undefined ? null : /^\{@scale(damage|dice) ([^|]+)\|[^|]+\|([^}]+)\}$/.exec(tag);
      if (tag !== undefined && m !== null) {
        const base = m[2] ?? '';
        const step = m[3] ?? '';
        const placed = higher.map((e) => asHigherBlock(e, spell.edition === 'one'));
        let done = false;
        const withTag = mapStrings(placed, (s) => {
          if (done) return s;
          const at = findWords(wordsOf(s), step, 0);
          if (at === undefined) return s;
          done = true;
          const plain = wordsOf(s);
          return plain.slice(0, at.index) + tag + plain.slice(at.index + at[0].length);
        });
        const tagged = tagInMain(main, base, m[1] === 'dice' ? 'dice' : 'damage');
        add({
          kind: 'higher',
          what: `${step} more for each slot level above ${ordinal(level)}`,
          quote,
          patch: {
            entries: tagged,
            entriesHigherLevel: withTag,
            damageInflict: inflictWith(spell, tagged),
          },
        });
      }
    } else {
      const scaling = textCantripScaling(converted, convertedHigher);
      const ladder = isRecord(scaling) && isRecord(scaling.scaling) ? scaling.scaling : undefined;
      const base = typeof ladder?.['1'] === 'string' ? ladder['1'] : undefined;
      if (scaling !== undefined && base !== undefined) {
        // A ladder led in as "Cantrip Upgrade." moves to its field; the 2014
        // books print it as a plain paragraph, which stays where it is.
        const moved = entries.filter(isHigherBlock);
        const tagged = tagInMain(
          entries.filter((e) => !moved.includes(e)),
          base,
          'damage',
        );
        add({
          kind: 'cantrip',
          what: `${base} more damage at levels 5, 11 and 17`,
          quote,
          patch: {
            scalingLevelDice: scaling,
            entries: tagged,
            damageInflict: inflictWith(spell, tagged),
            ...(moved.length > 0
              ? {
                  entriesHigherLevel: [
                    ...list(spell.entriesHigherLevel),
                    ...moved.map((e) => asHigherBlock(e, spell.edition === 'one')),
                  ],
                }
              : {}),
          },
        });
      }
    }
  }
  return out;
}
