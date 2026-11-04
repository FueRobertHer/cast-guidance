/**
 * One title in the library, however many books print it.
 *
 * Every entity is keyed `name|source`, so a spell reprinted in the 2024
 * Player's Handbook, a feat a supplement reworked, and a homebrew take on
 * either are separate entities. Listed as they are, each of those is a row
 * of its own beside its twin, and the list doubles without saying anything
 * new. The library lists titles instead, and an entry's page switches between
 * its printings, which is also the easy way to compare them.
 */
import type { Entity } from '@/data5e/copyMod';
import { type EntityType, isEntityType } from '@/data5e/normalize';
import { filterByRulesVersion } from '@/data5e/rulesVersion';
import { SOURCE_GROUPS, sourceGroup, sourceName } from '@/data5e/sourceNames';

export function nameOf(e: Entity): string {
  return typeof e.name === 'string' ? e.name : '?';
}
export function sourceOf(e: Entity): string {
  return typeof e.source === 'string' ? e.source : '?';
}
export function uidOf(e: Entity): string {
  return `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();
}

/**
 * What makes two entities printings of one title: the name, ignoring case.
 * A subclass is also its class's: homebrew gives two classes a subclass of the
 * same name, and those are two subclasses, not two printings of one.
 */
export function titleKey(type: EntityType, e: Entity): string {
  const name = nameOf(e).toLowerCase();
  if (type !== 'subclass') return name;
  const className = typeof e.className === 'string' ? e.className.toLowerCase() : '';
  return `${name}|${className}`;
}

/**
 * The order printings are offered in: the core books first, then by the
 * settings' groups (supplements, settings, adventures, playtests, everything
 * else, homebrew included), then by title, which puts each 2014 core book
 * before its 2024 revision.
 */
export function compareBooks(a: string, b: string): number {
  const group = (s: string) => SOURCE_GROUPS.indexOf(sourceGroup(s));
  return group(a) - group(b) || sourceName(a).localeCompare(sourceName(b));
}

/**
 * The printing a title opens to: the first, in book order, that no other one
 * here was reprinted as. 5etools marks the older printing (`reprintedAs`), and
 * the rules-version filter already reads that mark, so its 2024 reading is
 * exactly "what is left once the superseded ones go". A player who hides the
 * newer book in settings never has it in the list, and gets the older one.
 */
export function preferredPrinting(type: EntityType, printings: readonly Entity[]): Entity {
  const current = filterByRulesVersion([...printings], '2024', { holderType: type });
  // Never empty for a non-empty list: a reprint chain has a last link, and that
  // printing is kept. The fallback is for a cycle in hand-written homebrew.
  return (current[0] ?? printings[0]) as Entity;
}

export interface Title {
  /** Unique within the type, so it keys the title's row. */
  key: string;
  /** As the first printing in the list spells it. */
  name: string;
  /** In book order ({@link compareBooks}), one per source. */
  printings: readonly Entity[];
  /** What the title's row opens ({@link preferredPrinting}). */
  preferred: Entity;
}

/**
 * Group a list into titles, in the order each title first appears, so a list
 * sorted by name stays sorted.
 *
 * A second entity with a uid already seen is dropped, as the registry's index
 * drops it (`get` answers with the first), so the switch never offers a
 * printing that would open a different one.
 */
export function groupTitles(type: EntityType, entities: readonly Entity[]): Title[] {
  const byKey = new Map<string, { name: string; printings: Entity[]; uids: Set<string> }>();
  for (const e of entities) {
    const key = titleKey(type, e);
    let title = byKey.get(key);
    if (title === undefined) {
      title = { name: nameOf(e), printings: [], uids: new Set() };
      byKey.set(key, title);
    }
    const uid = uidOf(e);
    if (title.uids.has(uid)) continue;
    title.uids.add(uid);
    title.printings.push(e);
  }
  return [...byKey].map(([key, { name, printings }]) => {
    printings.sort((a, b) => compareBooks(sourceOf(a), sourceOf(b)));
    return { key, name, printings, preferred: preferredPrinting(type, printings) };
  });
}

/** How many titles a list holds: {@link groupTitles}'s length, without the grouping. */
export function countTitles(type: EntityType, entities: readonly Entity[]): number {
  return new Set(entities.map((e) => titleKey(type, e))).size;
}

/** A search hit, as far as grouping it goes. */
export interface Hit {
  type: string;
  uid: string;
  name: string;
  source: string;
}

export interface HitTitle {
  /** Unique across types, so it keys the title's row. */
  key: string;
  type: string;
  name: string;
  /** In book order, as a row of the type's list has them. */
  sources: readonly string[];
  /** The printing the row opens: the preferred one of these hits. */
  uid: string;
}

/**
 * Search hits grouped into titles, as the type lists group them, in the order
 * each title's best hit ranked. `resolve` finds a hit's entity, which says
 * which title it is (a subclass's class) and which printing it would open to;
 * a hit it cannot find is a title by its name alone, and opens to itself.
 */
export function groupHits(
  hits: readonly Hit[],
  resolve: (hit: Hit) => Entity | undefined,
): HitTitle[] {
  const byKey = new Map<string, { type: string; name: string; hits: Hit[]; entities: Entity[] }>();
  for (const hit of hits) {
    const entity = resolve(hit);
    const title =
      entity !== undefined && isEntityType(hit.type)
        ? titleKey(hit.type, entity)
        : hit.name.toLowerCase();
    const key = `${hit.type}:${title}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = { type: hit.type, name: hit.name, hits: [], entities: [] };
      byKey.set(key, group);
    }
    group.hits.push(hit);
    if (entity !== undefined) group.entities.push(entity);
  }
  return [...byKey].map(([key, { type, name, hits: group, entities }]) => {
    const first = group[0] as Hit;
    // The preference reads every printing's reprint marks, so it can only be
    // trusted when every hit was found.
    const opens =
      isEntityType(type) && entities.length === group.length
        ? uidOf(
            preferredPrinting(
              type,
              [...entities].sort((a, b) => compareBooks(sourceOf(a), sourceOf(b))),
            ),
          )
        : first.uid;
    return {
      key,
      type,
      name,
      sources: [...new Set(group.map((h) => h.source))].sort(compareBooks),
      uid: opens,
    };
  });
}
