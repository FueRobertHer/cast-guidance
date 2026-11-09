/**
 * The names an official entry could have where Fight Club words it another
 * way. Fight Club sorts its lists by the first word, so it writes `Elf,
 * Astral` for the Astral Elf, `Spell Gem, Amber` for Spell Gem (Amber),
 * `All-Purpose Tool, +1` for the +1 All-Purpose Tool and `Tiefling of
 * Asmodeus` for the Asmodeus tiefling; it adds the setting to a race
 * (`Centaur (Theros)`), the book's name to a background (`Strixhaven
 * Lorehold Student`) and both names where a race has two (`Elf, Drow /
 * Dark`).
 *
 * The converter tries these only against the books an entry cites, so a
 * loose match stays inside one book: `Centaur` in Mythic Odysseys of Theros
 * is the entry `Centaur (Theros)` copies, wherever else a centaur is.
 */
import type { ConvertedKind } from '../types';
import { lastGroup } from './text';

/** No entry is renamed in more ways than this; a name that would be is not read past it. */
const MAX_VARIANTS = 32;
/** Longer than any real entry's name; a longer one is looked for as it is. */
const MAX_NAME = 200;

/** `Elf, Drow / Dark` as `Elf, Drow` and `Elf, Dark`. */
function alternatives(name: string): string[] {
  const slash = name.indexOf(' / ');
  if (slash === -1) return [];
  const before = name.slice(0, slash);
  const after = name.slice(slash + 3);
  // The first name runs back to a comma or bracket, the second on to one.
  const comma = before.lastIndexOf(', ');
  const start = Math.max(comma === -1 ? 0 : comma + 2, before.lastIndexOf('(') + 1);
  let end = after.length;
  for (const stop of [',', ')']) {
    const at = after.indexOf(stop);
    if (at !== -1 && at < end) end = at;
  }
  return [before + after.slice(end), before.slice(0, start) + after];
}

/** The word a name starts with when the book's title has it too: `Strixhaven` of a Strixhaven background. */
function titleWord(name: string, titles: readonly string[]): string | undefined {
  const space = name.indexOf(' ');
  if (space <= 0) return undefined;
  const word = name.slice(0, space).toLowerCase();
  const inTitle = titles.some((title) =>
    title
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .includes(word),
  );
  return inTitle ? name.slice(space + 1) : undefined;
}

/** The renames of a name, one step each. */
function renamesOf(kind: ConvertedKind, name: string, titles: readonly string[]): string[] {
  const out: string[] = [];

  // `Centaur (Theros)`: `Centaur`, `Theros Centaur`, and `Elf (Zendikar,
  // Joraga Nation)` as 5etools shows a subrace, `Elf (Zendikar; Joraga Nation)`.
  const group = lastGroup(name);
  if (group !== undefined) {
    out.push(group.base, `${group.inner} ${group.base}`);
    if (group.inner.includes(', ')) out.push(`${group.base} (${group.inner.replace(', ', '; ')})`);
    // `Merfolk, Cosi Creed (Zendikar)` as `Merfolk (Zendikar; Cosi Creed)`.
    const comma = group.base.indexOf(', ');
    if (comma > 0) {
      out.push(`${group.base.slice(0, comma)} (${group.inner}; ${group.base.slice(comma + 2)})`);
    }
  }

  // `Elf, Astral` as `Astral Elf`, `Spell Gem, Amber` as `Spell Gem (Amber)`,
  // and a feat's `Dragonmark, Mark of Detection` as `Mark of Detection`.
  const comma = name.indexOf(', ');
  if (comma > 0 && !name.includes('(')) {
    const head = name.slice(0, comma);
    const rest = name.slice(comma + 2);
    if (!rest.includes(', ')) {
      out.push(`${rest} ${head}`, `${head} (${rest})`);
      if (kind === 'feat') out.push(rest);
    }
  }

  // `All-Purpose Tool, +1` and `Moon Sickle +2` as 5etools names them.
  const plus = / \+(\d)$/.exec(name);
  if (plus !== null) {
    const item = name.slice(0, plus.index).replace(/,$/, '');
    if (item !== '') out.push(`+${plus[1]} ${item}`);
  }

  if (kind === 'race') {
    // `Tiefling of Asmodeus` as the Asmodeus subrace, `Tiefling, Asmodeus`.
    const of = name.indexOf(' of ');
    if (of > 0 && !name.slice(0, of).includes(' ')) {
      out.push(`${name.slice(0, of)}, ${name.slice(of + 4)}`);
    }
    // `Half-Elf, Wood Elf Ancestry` as `Half-Elf, Wood Elf`.
    for (const suffix of [' Ancestry', ' Descent']) {
      if (name.endsWith(suffix)) out.push(name.slice(0, -suffix.length));
    }
  }

  // A feat's list name ahead of it: `Dark Gift: Echoing Soul`.
  if (kind === 'feat') {
    const colon = name.indexOf(': ');
    if (colon > 0) out.push(name.slice(colon + 2));
  }

  const untitled = titleWord(name, titles);
  if (untitled !== undefined) out.push(untitled);
  return out;
}

/**
 * The names to look for an entry under in the books it cites: its own, each
 * name of one with two (`Elf, Drow / Dark` is `Elf, Drow` and `Elf, Dark`),
 * and one rename of each. One step only: `Elf, Avariel` may be `Elf
 * (Avariel)`, but that is no reason to look for `Elf`.
 */
export function nameVariants(
  kind: ConvertedKind,
  name: string,
  titles: readonly string[],
): string[] {
  const own = name.trim();
  const seen = new Set([own]);
  if (own.length > MAX_NAME) return [own];
  for (const n of [own, ...alternatives(own)]) {
    for (const r of [n, ...renamesOf(kind, n, titles)]) {
      if (seen.size >= MAX_VARIANTS) break;
      const variant = r.trim();
      if (variant !== '') seen.add(variant);
    }
  }
  return [...seen];
}
