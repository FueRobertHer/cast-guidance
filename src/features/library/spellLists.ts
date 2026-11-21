/**
 * The class and subclass lists a spell is on, for its Library page (review
 * finding 43). The book's spells keep their lists outside the spell, in the
 * generated lookup (`src/data5e/spellLookup.ts`); a homebrew spell declares
 * its own inline, as `classes.fromClassList` and `classes.fromSubclass`.
 */
import type { Entity } from '@/data5e/copyMod';
import type { SpellClassLookup } from '@/data5e/spellLookup';

export interface ListedClass {
  name: string;
  source: string;
}

export interface ListedSubclass {
  /** The subclass's full name ("College of Lore"), else its short one. */
  name: string;
  shortName: string;
  source: string;
  className: string;
  classSource: string;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The lookup's row for a spell, found however its book and name are cased. */
function lookupRow(lookup: SpellClassLookup, spell: Entity): Record<string, unknown> | undefined {
  const source = String(spell.source ?? '').toLowerCase();
  const name = String(spell.name ?? '').toLowerCase();
  const byName = Object.entries(lookup).find(([s]) => s.toLowerCase() === source)?.[1];
  if (!isObject(byName)) return undefined;
  const row = Object.entries(byName).find(([n]) => n.toLowerCase() === name)?.[1];
  return isObject(row) ? row : undefined;
}

/** Every class whose list holds the spell, the lookup's and the spell's own. */
export function spellClasses(lookup: SpellClassLookup, spell: Entity): ListedClass[] {
  const out: ListedClass[] = [];
  const classes = lookupRow(lookup, spell)?.class;
  if (isObject(classes)) {
    for (const [source, byName] of Object.entries(classes)) {
      if (!isObject(byName)) continue;
      for (const name of Object.keys(byName)) out.push({ name, source });
    }
  }
  const own = isObject(spell.classes) ? spell.classes.fromClassList : undefined;
  if (Array.isArray(own)) {
    for (const c of own) {
      const name = isObject(c) ? str(c.name) : undefined;
      if (name !== undefined) out.push({ name, source: str((c as Entity).source) ?? '' });
    }
  }
  return dedupe(out, (c) => `${c.name}|${c.source}`);
}

/** Every subclass whose own list holds the spell (an Eldritch Knight's), the lookup's and the spell's own. */
export function spellSubclasses(lookup: SpellClassLookup, spell: Entity): ListedSubclass[] {
  const out: ListedSubclass[] = [];
  const subs = lookupRow(lookup, spell)?.subclass;
  if (isObject(subs)) {
    for (const [classSource, byClass] of Object.entries(subs)) {
      if (!isObject(byClass)) continue;
      for (const [className, bySource] of Object.entries(byClass)) {
        if (!isObject(bySource)) continue;
        for (const [source, byShort] of Object.entries(bySource)) {
          if (!isObject(byShort)) continue;
          for (const [shortName, info] of Object.entries(byShort)) {
            const name = (isObject(info) ? str(info.name) : undefined) ?? shortName;
            out.push({ name, shortName, source, className, classSource });
          }
        }
      }
    }
  }
  const own = isObject(spell.classes) ? spell.classes.fromSubclass : undefined;
  if (Array.isArray(own)) {
    for (const e of own) {
      if (!isObject(e) || !isObject(e.class) || !isObject(e.subclass)) continue;
      const className = str(e.class.name);
      const shortName = str(e.subclass.shortName) ?? str(e.subclass.name);
      if (className === undefined || shortName === undefined) continue;
      out.push({
        name: str(e.subclass.name) ?? shortName,
        shortName,
        source: str(e.subclass.source) ?? '',
        className,
        classSource: str(e.class.source) ?? '',
      });
    }
  }
  return dedupe(out, (s) => `${s.shortName}|${s.className}|${s.classSource}|${s.source}`);
}

function dedupe<T>(list: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = key(t).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
