import { subraceBelongsTo } from '../../data5e/subraceOptions';
import { emitCuratedTrait } from '../curated/curatedEffects';
import {
  type Ability,
  type CharacterDoc,
  type DataEntity,
  type EffectOrigin,
  type EngineContext,
  refUid,
} from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, num, str } from './base';
import { basedOn, mechanicsOf } from './mechanics';
import { proseScanFeature } from './proseScan';
import {
  genericOptions,
  languageOptions,
  readAbilityBlock,
  readDefenses,
  readProficiencyList,
  skillOptions,
  toolOptions,
  weaponOptions,
} from './readers';

/**
 * The character's subrace. Subraces are found by name and source, and two
 * races can each have one of the same name and source (Ixalan|PSX for the
 * Goblin and the Vampire), so the one that belongs to the character's race
 * wins. A pick that belongs to neither is found as before.
 */
export function subraceFor(
  ctx: EngineContext,
  doc: Pick<CharacterDoc, 'race' | 'subrace'>,
): DataEntity | undefined {
  const ref = doc.subrace;
  if (ref === undefined) return undefined;
  const first = ctx.get('subrace', ref.name, ref.source);
  const race = doc.race;
  if (first === undefined || race === undefined || subraceBelongsTo(first, race)) return first;
  const uid = refUid(ref);
  const sameRef = (s: DataEntity) => `${String(s.name)}|${String(s.source)}`.toLowerCase() === uid;
  return ctx.byType('subrace').find((s) => sameRef(s) && subraceBelongsTo(s, race)) ?? first;
}

/**
 * The race's nameless subrace, when the character takes no named one. A
 * nameless subrace is the race's own base entry: 5etools lists a race with
 * subraces only merged with each of them (`Renderer.race._getMergedSubraces`),
 * so "Human" on its site is the race merged with this one, and the PHB Human's
 * +1 to every score lives here. A named subrace is merged instead, never both.
 */
export function baseSubraceFor(
  ctx: EngineContext,
  doc: Pick<CharacterDoc, 'race' | 'subrace'>,
): DataEntity | undefined {
  const race = doc.race;
  if (race === undefined || doc.subrace !== undefined) return undefined;
  return ctx.byType('subrace').find((s) => typeof s.name !== 'string' && subraceBelongsTo(s, race));
}

function raceEntity(col: Collector): { race?: DataEntity; subrace?: DataEntity } {
  const doc = col.doc;
  const race = doc.race ? col.ctx.get('race', doc.race.name, doc.race.source) : undefined;
  if (doc.race && race === undefined) {
    col.warn(`Race not found: ${refUid(doc.race)} (data pack missing or renamed)`);
  }
  const subrace = subraceFor(col.ctx, doc);
  if (doc.subrace && subrace === undefined) {
    col.warn(`Subrace not found: ${refUid(doc.subrace)}`);
  }
  return { race, subrace };
}

/**
 * Keys 5etools adds to the race's own rather than replacing them, unless the
 * subrace's `overwrite` object flags the key: ability scores and skills key by
 * key, languages and trait tags beside the race's.
 */
const ADDED_KEYS = new Set(['ability', 'skillProficiencies', 'languageProficiencies', 'traitTags']);

const isEntity = (v: unknown): v is DataEntity => typeof v === 'object' && v !== null;

/** How 5etools matches a trait to the name in `data.overwrite`. */
const traitKey = (name: string) => name.toLowerCase().trim();

/** The keys the ability reader asks a pick for. */
const abilityPick = (key: string) => key === 'choose';
/** The keys the skill reader asks a pick for. */
const skillPick = (key: string) => key === 'choose' || key.startsWith('any');

/**
 * An ability list whose entries are all weighted choices: the reader reads
 * them as alternatives and asks which one applies.
 */
function arrangements(list: unknown): boolean {
  const entries = asEntityArray(list);
  return (
    entries.length > 1 && entries.every((e) => isEntity(e.choose) && isEntity(e.choose.weighted))
  );
}

/**
 * The race's list with the keys the subrace's entry at the same place sets
 * taken out of the first `places` entries, since 5etools assigns the
 * subrace's over the race's there. The readers number a list's picks in
 * reading order, so a pick the subrace also sets stays (and the race still
 * asks it) wherever taking it out would renumber a later pick the player may
 * have answered.
 */
function lessSubraceKeys(
  raceList: unknown,
  subList: unknown,
  places: number,
  asksAPick: (key: string) => boolean,
): unknown {
  if (!Array.isArray(raceList) || !Array.isArray(subList)) return raceList;
  const dropped = raceList.map(() => new Set<string>());
  let pickAfter = false;
  for (let i = raceList.length - 1; i >= 0; i--) {
    const entry: unknown = raceList[i];
    const over: unknown = subList[i];
    if (!isEntity(entry)) continue;
    const shared = new Set(i < places && isEntity(over) ? Object.keys(over) : []);
    for (const key of Object.keys(entry).reverse()) {
      if (shared.has(key) && !(pickAfter && asksAPick(key))) dropped[i]?.add(key);
      else if (asksAPick(key)) pickAfter = true;
    }
  }
  return raceList.map((entry, i) => {
    const drop = dropped[i];
    if (!isEntity(entry) || drop === undefined || drop.size === 0) return entry;
    return Object.fromEntries(Object.entries(entry).filter(([key]) => !drop.has(key)));
  });
}

/**
 * The race as a subrace leaves it. 5etools merges the two into one entity
 * (`Renderer.race._getMergedSubrace` in its render.js); the engine collects
 * them apart, so each keeps its own origin and prompt ids, and takes off the
 * race what that merge would replace:
 * - a subrace trait with `data.overwrite` replaces the race trait of that name
 *   (Mammon's Legacy of Minauros for the Tiefling's Infernal Legacy);
 * - ability scores and the first skill entry take the subrace's value for any
 *   key both set, languages add to the race's, and the subrace's `overwrite`
 *   flag on one of these replaces the race's outright;
 * - every other key the subrace sets replaces the race's, spells included,
 *   and a `null` one removes it (a Winged tiefling casts none of the race's),
 *   `entries` too: the subrace's own traits go on its own card.
 */
export function raceUnderSubrace(race: DataEntity, subrace: DataEntity): DataEntity {
  const view: DataEntity = { ...race };
  const flags = isEntity(subrace.overwrite) ? subrace.overwrite : {};
  for (const [key, value] of Object.entries(subrace)) {
    // An `undefined` key is one the subrace does not set (JSON has no such value).
    if (value === undefined || key === 'name' || key === 'source') continue;
    if (key === 'entries') {
      if (value === null) delete view.entries;
      continue;
    }
    if (value === null || !ADDED_KEYS.has(key) || flags[key] === true) delete view[key];
    else if (key === 'ability') {
      // Emptying one of the race's alternative arrangements would make it
      // read the rest as all applying at once, so they stay whole.
      if (!arrangements(view.ability)) {
        view.ability = lessSubraceKeys(view.ability, value, Infinity, abilityPick);
      }
    } else if (key === 'skillProficiencies') {
      view.skillProficiencies = lessSubraceKeys(view.skillProficiencies, value, 1, skillPick);
    }
  }
  const replaced = new Set<string>();
  for (const entry of asEntityArray(subrace.entries)) {
    const name = isEntity(entry.data) ? str(entry.data.overwrite) : undefined;
    if (name !== undefined) replaced.add(traitKey(name));
  }
  if (replaced.size > 0 && Array.isArray(view.entries)) {
    view.entries = view.entries.filter((entry: unknown) => {
      const name = isEntity(entry) ? str(entry.name) : undefined;
      return name === undefined || !replaced.has(traitKey(name));
    });
  }
  return view;
}

function collectFrom(col: Collector, e: DataEntity, origin: EffectOrigin, idBase: string): void {
  readAbilityBlock(col, e.ability, origin, `${idBase}:ability`);

  // Walking speed is read straight from the entities in calc/speed; the other
  // ways to move become effects, `true` meaning as fast as the character walks.
  if (typeof e.speed === 'object' && e.speed !== null) {
    const speed = e.speed as Record<string, unknown>;
    for (const mode of ['fly', 'climb', 'swim'] as const) {
      const raw = speed[mode];
      const value =
        raw === true ? 'walk' : (num(raw) ?? num((raw as { number?: unknown } | null)?.number));
      if (value !== undefined) col.add({ kind: 'moveSpeed', mode, speed: value, origin });
    }
  }

  const darkvision = num(e.darkvision);
  if (darkvision !== undefined) {
    col.add({ kind: 'sense', sense: 'darkvision', range: darkvision, origin });
  }
  if (num(e.blindsight) !== undefined) {
    col.add({ kind: 'sense', sense: 'blindsight', range: num(e.blindsight) ?? 0, origin });
  }

  readProficiencyList(
    col,
    e.skillProficiencies,
    origin,
    `${idBase}:skill`,
    'skill',
    'Skill proficiency',
    (name) => col.add({ kind: 'skillProf', skill: name, level: 1, origin }),
    skillOptions,
  );
  readProficiencyList(
    col,
    e.languageProficiencies,
    origin,
    `${idBase}:lang`,
    'language',
    'Language',
    (name) => col.add({ kind: 'language', name, origin }),
    languageOptions,
  );
  readProficiencyList(
    col,
    e.toolProficiencies,
    origin,
    `${idBase}:tool`,
    'tool',
    'Tool proficiency',
    (name) => col.add({ kind: 'toolProf', name, origin }),
    toolOptions,
  );
  readProficiencyList(
    col,
    e.weaponProficiencies,
    origin,
    `${idBase}:weapon`,
    'generic',
    'Weapon proficiency',
    (name) => col.add({ kind: 'weaponProf', name, origin }),
    weaponOptions(col.ctx),
  );
  readProficiencyList(
    col,
    e.armorProficiencies,
    origin,
    `${idBase}:armor`,
    'generic',
    'Armor proficiency',
    (name) => col.add({ kind: 'armorProf', name, origin }),
    genericOptions,
  );
  readDefenses(col, e, origin, idBase);
  collectAdditionalSpells(col, e.additionalSpells, origin, undefined, idBase);

  // Named traits (Relentless Endurance, Breath Weapon, …) carry their mechanics
  // only in prose — curated table first (by its name, or the trait a homebrew
  // copy is `basedOn`), generic prose scan for the long tail.
  for (const entry of asEntityArray(e.entries)) {
    const traitName = str(entry.name);
    if (traitName === undefined) continue;
    const names = [traitName, basedOn(entry)?.name].filter((n) => n !== undefined);
    mechanicsOf(col, {
      entry,
      label: traitName,
      origin,
      target: `${traitName}|${origin.label}`,
      inherited: () => {
        if (!names.some((n) => emitCuratedTrait(col, n, origin))) {
          proseScanFeature(col, traitName, entry.entries, origin);
        }
      },
    });
  }
}

/**
 * PHB Draconic Ancestry table (curated): the ancestry color fixes the breath
 * weapon's damage type, area, and save. This is a *fallback* for printings
 * whose prose can't be scanned (base PHB Dragonborn names its type via a table;
 * the 2024 XPHB race states a save but no single area to breathe in). Printings
 * that DO state everything inline — every Fizban's (FTD) Chromatic/Metallic/Gem
 * variant, whose `_versions` substitute the real damage type — are left to the
 * prose scanner, so this table must never clobber a value it already produced.
 */
const DRACONIC_ANCESTRY: Record<string, { type: string; area: string; targetAbility: Ability }> = {
  black: { type: 'acid', area: '5 by 30 ft line', targetAbility: 'dex' },
  blue: { type: 'lightning', area: '5 by 30 ft line', targetAbility: 'dex' },
  brass: { type: 'fire', area: '5 by 30 ft line', targetAbility: 'dex' },
  bronze: { type: 'lightning', area: '5 by 30 ft line', targetAbility: 'dex' },
  copper: { type: 'acid', area: '5 by 30 ft line', targetAbility: 'dex' },
  gold: { type: 'fire', area: '15 ft cone', targetAbility: 'dex' },
  green: { type: 'poison', area: '15 ft cone', targetAbility: 'con' },
  red: { type: 'fire', area: '15 ft cone', targetAbility: 'dex' },
  silver: { type: 'cold', area: '15 ft cone', targetAbility: 'con' },
  white: { type: 'cold', area: '15 ft cone', targetAbility: 'con' },
};

function linkDraconicAncestry(col: Collector): void {
  const raceName = col.doc.race?.name.toLowerCase() ?? '';
  if (!raceName.includes('dragonborn')) return;
  // The ancestry color lives in the subrace name (2014 PHB) or the race name
  // itself (2024 XPHB versioned races like "Dragonborn (Blue)").
  const hay = `${raceName} ${col.doc.subrace?.name.toLowerCase() ?? ''}`;
  const color = hay.match(/\b(black|blue|brass|bronze|copper|gold|green|red|silver|white)\b/)?.[1];
  const ancestry = color !== undefined ? DRACONIC_ANCESTRY[color] : undefined;
  if (ancestry === undefined) return;
  // 2024 breath weapon is a DEX save and the player picks cone or line each
  // use; 2014 fixes the shape and save per ancestry.
  const is2024 = col.doc.rulesVersion === '2024';
  const eitherShape = `${ancestry.type} · 15 ft cone or 30 ft line`;
  const note = is2024 ? eitherShape : `${ancestry.type} · ${ancestry.area}`;
  const targetAbility = is2024 ? ('dex' as const) : ancestry.targetAbility;
  for (const e of col.effects) {
    if (e.kind === 'action' && e.label.toLowerCase() === 'breath weapon') {
      // Fill only gaps: a prose-scanned FTD variant already carries the correct
      // (often different — e.g. a chromatic LINE where this table says cone)
      // damage type, area, and save, and must not be overwritten. A note holding
      // only the type this table already knows still has a gap, and that means
      // the XPHB printing: it names the type but lets the player pick the shape
      // ("in either a 15-foot cone or a 30-foot line"), which the scanner does
      // not read as one area. That holds on a character switched to 2014 rules,
      // who keeps the race.
      if (e.note === undefined) e.note = note;
      else if (e.note === ancestry.type) e.note = eitherShape;
      if (e.save?.dcAbility === undefined) e.save = { targetAbility, ...e.save, dcAbility: 'con' };
    }
  }
}

export function collectRace(col: Collector): void {
  const { race, subrace } = raceEntity(col);
  if (race !== undefined && col.doc.race !== undefined) {
    const origin: EffectOrigin = {
      label: str(race.name) ?? col.doc.race.name,
      uid: refUid(col.doc.race),
      type: 'race',
    };
    // A Dragonborn ancestry's fixed resistance replaces the race's choice here.
    // Only a subrace of this race reshapes it, not a pick another race's
    // subrace still holds. With no subrace taken, the race's nameless one
    // reshapes it the same way, and is part of the race: its effects carry
    // the race's name and its traits go on the race's card.
    const base = baseSubraceFor(col.ctx, col.doc);
    const over = subrace !== undefined && subraceBelongsTo(subrace, col.doc.race) ? subrace : base;
    const own = over !== undefined ? raceUnderSubrace(race, over) : race;
    collectFrom(col, own, origin, `race:${origin.uid}`);
    if (base !== undefined) collectFrom(col, base, origin, `race:${origin.uid}:base`);
    const entries =
      base !== undefined && Array.isArray(base.entries)
        ? [...(Array.isArray(own.entries) ? own.entries : []), ...base.entries]
        : own.entries;
    // A subrace that replaces every trait (Keldon's Human) leaves no card.
    const listsTraits = (list: unknown) => Array.isArray(list) && list.length > 0;
    const emptied = listsTraits(race.entries) && !listsTraits(entries);
    if (!emptied) col.features.push({ name: origin.label, origin, entries });
  }
  if (subrace !== undefined && col.doc.subrace !== undefined) {
    const origin: EffectOrigin = {
      label: str(subrace.name) ?? col.doc.subrace.name,
      uid: refUid(col.doc.subrace),
      type: 'race',
    };
    collectFrom(col, subrace, origin, `subrace:${origin.uid}`);
    if (subrace.entries !== undefined) {
      col.features.push({ name: origin.label, origin, entries: subrace.entries });
    }
  }
  linkDraconicAncestry(col);
}
