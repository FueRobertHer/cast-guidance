/**
 * Generic prose scanner — broad automation for the long tail of traits and
 * features whose mechanics exist only in text. Detects limited-use wording
 * ("once per long rest", "a number of times equal to your proficiency bonus"),
 * action economy ("as a bonus action"), and per-level HP riders, then emits
 * the matching effects. The curated table stays the precision override: call
 * this only when no curated entry handled the feature.
 */
import type { EffectOrigin } from '../types';
import type { Collector } from './base';

/** Recursively flatten an entries tree to plain lowercase text. */
export function flattenEntries(entries: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      parts.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      walk(o.entries);
      walk(o.entry);
      walk(o.items);
    }
  };
  walk(entries);
  // {@dice 1d12}, {@spell bless|phb} … → keep the display text
  return parts
    .join(' ')
    .replaceAll(/\{@\w+ ([^}|]*)(?:\|[^}]*)?\}/g, '$1')
    .replaceAll('’', "'")
    .toLowerCase();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

/**
 * Limited-use wording → how many uses between rests. When several counts are
 * mentioned, the SMALLEST wins: higher counts are level-scaling text
 * ("at 18th level, three times") that doesn't apply at the base level.
 */
function detectUses(text: string): number | 'profBonus' | undefined {
  if (/number of times equal to your proficiency bonus/.test(text)) return 'profBonus';
  const counts: number[] = [];
  if (
    /once per (?:short|long) rest/.test(text) ||
    /you can'?t (?:use (?:it|this (?:trait|feature))|do so) again until you (?:finish|complete)/.test(
      text,
    ) ||
    /must (?:then )?(?:finish|complete) a (?:short or long|short|long) rest (?:before you can use|to use)/.test(
      text,
    )
  ) {
    counts.push(1);
  }
  if (/use (?:this (?:trait|feature)|it|your [\w\s]{1,30}?) twice/.test(text)) counts.push(2);
  if (/use (?:this (?:trait|feature)|it|your [\w\s]{1,30}?) three times/.test(text)) {
    counts.push(3);
  }
  return counts.length > 0 ? Math.min(...counts) : undefined;
}

/**
 * Scan one named trait/feature and emit resource / action / HP effects.
 * Safe to call on anything — no-ops when no usage wording is found.
 */
export function proseScanFeature(
  col: Collector,
  name: string,
  entries: unknown,
  origin: EffectOrigin,
): void {
  const text = flattenEntries(entries);
  if (text.length === 0) return;

  const uses = detectUses(text);
  if (uses !== undefined) {
    const resetOn =
      /short or long rest/.test(text) || /finish a short rest/.test(text) ? 'short' : 'long';
    col.add({ kind: 'resource', key: slug(name), label: name, max: uses, resetOn, origin });
  }

  // Compact, high-signal chips only: bonus/reaction always; plain actions
  // only when limited-use (otherwise every prose "as an action" is noise).
  // Limited-use features also get their first dice expression as a roll chip.
  const dice = uses !== undefined ? text.match(/\b(\d{0,2}d\d{1,3}(?: ?[+-] ?\d+)?)\b/) : null;
  const roll =
    dice?.[1] !== undefined ? dice[1].replace(/^d/, '1d').replaceAll(' ', '') : undefined;
  if (/as a bonus action/.test(text)) {
    col.add({ kind: 'action', economy: 'bonus', label: name, roll, origin });
  } else if (/as a reaction|use your reaction/.test(text)) {
    col.add({ kind: 'action', economy: 'reaction', label: name, roll, origin });
  } else if (uses !== undefined && /as an action|use your action/.test(text)) {
    col.add({ kind: 'action', economy: 'action', label: name, roll, origin });
  }

  const hp = text.match(
    /hit point maximum increases by (\d+)[^.]*?(?:every time|whenever|when) you gain a level/,
  );
  if (hp?.[1] !== undefined) {
    col.add({ kind: 'hpPerLevel', amount: Number(hp[1]), origin });
  }
}
