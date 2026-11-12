import { subraceBelongsTo } from '../../data5e/subraceOptions';
import { emitCuratedTrait, hasCuratedRow } from '../curated/curatedEffects';
import {
  ancestryDragons,
  DRACONIC_ANCESTRY,
  dragonOptions,
  namedDragon,
} from '../curated/draconicAncestry';
import { emitRollAdvantages } from '../curated/rollAdvantages';
import { emitRollExtras } from '../curated/rollExtras';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectOrigin,
  type EngineContext,
  refUid,
} from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, num, str } from './base';
import { basedOn, mechanicsOf } from './mechanics';
import { DAMAGE_TYPES, proseScanFeature } from './proseScan';
import {
  genericOptions,
  languageOptions,
  readAbilityBlock,
  readDefenses,
  readProficiencyList,
  readSkillOrToolChoice,
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
 *   (Mammon's Legacy of Minauros for the Tiefling's Infernal Legacy), and a
 *   subrace version drops the race traits its `_mod` removed or rewrote
 *   (`_raceTraitsRemoved`: a Dragonborn colour's Breath Weapon);
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
  // A subrace version's `_mod` removed or rewrote these race traits (see
  // `applySubraceMod` in copyMod.ts); what it rewrote is on the subrace's card.
  if (Array.isArray(subrace._raceTraitsRemoved)) {
    for (const name of subrace._raceTraitsRemoved) {
      if (typeof name === 'string') replaced.add(traitKey(name));
    }
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
  // A pick of skills and tools in any mix (the Tajuru Nation, a Githyanki's
  // Decadent Mastery, the Nephalia), as the Skilled feat asks.
  readSkillOrToolChoice(col, e.skillToolLanguageProficiencies, origin, `${idBase}:skillTool`);
  readDefenses(col, e, origin, idBase);
  collectAdditionalSpells(col, e.additionalSpells, origin, undefined, idBase);

  // Named traits (Relentless Endurance, Breath Weapon, …) carry their mechanics
  // only in prose: the curated table first (by its name, or the trait a homebrew
  // copy is `basedOn`), the generic prose scan for the long tail.
  for (const entry of asEntityArray(e.entries)) {
    const traitName = str(entry.name);
    if (traitName === undefined) continue;
    const based = basedOn(entry);
    const names = [traitName, based?.name].filter((n) => n !== undefined);
    mechanicsOf(col, {
      entry,
      label: traitName,
      origin,
      target: `${traitName}|${origin.label}`,
      ruleKeys: names.map((n) => `trait:${n}`),
      inCode: hasCuratedRow,
      inherited: (builtIn) => {
        const curated =
          builtIn !== undefined
            ? builtIn.scan === 'replace'
            : names.some((n) => emitCuratedTrait(col, n, origin));
        if (!curated) proseScanFeature(col, traitName, entry.entries, origin);
        // What the trait adds to rolls, named for the trait (Brave), not the race.
        const rollKeys = [
          `${traitName}|${str(e.name)}|${str(e.source)}`,
          `${traitName}|${str(e.source)}`,
          ...(based !== undefined ? [`${based.name}|${based.source}`] : []),
        ];
        const traitOrigin = { ...origin, label: traitName };
        emitRollAdvantages(col, rollKeys, traitOrigin);
        emitRollExtras(col, rollKeys, traitOrigin);
      },
    });
  }
}

/** A Dragonborn's dragon, whether it was asked for, and the dragons it could be. */
type Ancestry = { dragon?: string; asked: boolean; among: readonly string[] };

/**
 * A Dragonborn's dragon: the one its race or subrace names (2014 color
 * subraces, the 2024 and Fizban's versions), else the one picked when neither
 * names one. A Dragonborn with no named dragon is asked for it: the bare race,
 * or a Draconblood or Ravenite with no color.
 */
function draconicAncestry(col: Collector, origin: EffectOrigin): Ancestry {
  const raceName = col.doc.race?.name ?? '';
  const among = ancestryDragons(raceName);
  if (among === undefined || col.doc.race === undefined) return { asked: false, among: [] };
  const named = namedDragon(`${raceName} ${col.doc.subrace?.name ?? ''}`, among);
  if (named !== undefined) return { dragon: named, asked: false, among };
  let dragon: string | undefined;
  col.choice(
    {
      id: `race:${refUid(col.doc.race)}:ancestry`,
      origin,
      kind: 'generic',
      label: 'Draconic Ancestry',
      count: 1,
      options: dragonOptions(among),
    },
    (selected) => {
      dragon = selected[0];
    },
  );
  return { dragon, asked: true, among };
}

/**
 * A Dragonborn's resistance follows its dragon. The data gives some a free
 * pick among the types even where the dragon fixes it (Fizban's Chromatic
 * versions) or where the dragon is still to be picked (the bare race): a known
 * dragon fixes it, and an unknown one leaves it to the ancestry pick, unless a
 * resistance was picked before that pick was asked. A pick that leaves out a
 * type of the race's dragons is the race's own (a homebrew Dragonborn's), and
 * stays.
 */
function resistOfAncestry(
  col: Collector,
  own: DataEntity,
  idBase: string,
  ancestry: Ancestry,
): DataEntity {
  if (!Array.isArray(own.resist) || (ancestry.dragon === undefined && !ancestry.asked)) return own;
  const type = ancestry.dragon !== undefined ? DRACONIC_ANCESTRY[ancestry.dragon]?.type : undefined;
  const picked = Object.keys(col.doc.choices).some((k) => k.startsWith(`${idBase}:resist:`));
  const resist = own.resist.flatMap((entry: unknown) => {
    if (!isEntity(entry) || !isEntity(entry.choose)) return [entry];
    const from = Array.isArray(entry.choose.from) ? entry.choose.from.map(String) : [];
    const ofTheDragons = ancestry.among.every((d) => {
      const t = DRACONIC_ANCESTRY[d]?.type;
      return t === undefined || from.includes(t);
    });
    if (!ofTheDragons) return [entry];
    if (type !== undefined) return from.includes(type) ? [type] : [entry];
    return picked ? [entry] : [];
  });
  return { ...own, resist };
}

/**
 * The breath weapon a Dragonborn's dragon shapes. A *fallback* for printings
 * whose prose can't be scanned (the PHB Dragonborn with no colour subrace names
 * its type via a table; the 2024 XPHB race states a save but no single area to
 * breathe in). Printings that DO state everything inline (every Fizban's (FTD)
 * Chromatic/Metallic/Gem variant and every PHB or EGW colour subrace, whose
 * `_versions` substitute the real damage type) are left to the prose scanner,
 * so this must never clobber a value it already produced, on a character under
 * either rules version.
 */
const NAMES_A_TYPE = new RegExp(`\\b(?:${DAMAGE_TYPES})\\b`, 'i');

function linkDraconicAncestry(
  col: Collector,
  dragon: string | undefined,
  race: DataEntity | undefined,
): void {
  const ancestry = dragon !== undefined ? DRACONIC_ANCESTRY[dragon] : undefined;
  if (ancestry === undefined) return;
  // 2024 breath weapon is a DEX save and the player picks cone or line each
  // use; 2014 fixes the shape and save per ancestry. A 2024 race keeps its
  // own on a character under 2014 rules.
  const is2024 = col.doc.rulesVersion === '2024' || race?.edition === 'one';
  const eitherShape = `${ancestry.type} · 15 ft cone or 30 ft line`;
  const note =
    is2024 || ancestry.area === undefined ? eitherShape : `${ancestry.type} · ${ancestry.area}`;
  const targetAbility = is2024 ? ('dex' as const) : (ancestry.targetAbility ?? 'dex');
  for (const e of col.effects) {
    if (e.kind === 'action' && e.label.toLowerCase() === 'breath weapon') {
      // Fill only gaps: a prose-scanned FTD variant already carries the correct
      // (often different, e.g. a chromatic LINE where this table says cone)
      // damage type, area, and save, and must not be overwritten. A note holding
      // only the type this table already knows still has a gap, and that means
      // the XPHB printing: it names the type but lets the player pick the shape
      // ("in either a 15-foot cone or a 30-foot line"), which the scanner does
      // not read as one area. That holds on a character switched to 2014 rules,
      // who keeps the race. A note with the shape alone and no damage type (a
      // Fizban's race whose dragon was picked) gains the type.
      if (e.note === undefined) e.note = note;
      else if (e.note === ancestry.type) e.note = eitherShape;
      else if (!NAMES_A_TYPE.test(e.note)) e.note = `${ancestry.type} · ${e.note}`;
      if (e.save?.dcAbility === undefined) e.save = { targetAbility, ...e.save, dcAbility: 'con' };
    }
  }
}

export function collectRace(col: Collector): void {
  const { race, subrace } = raceEntity(col);
  let ancestry: Ancestry = { asked: false, among: [] };
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
    ancestry = draconicAncestry(col, origin);
    const own = resistOfAncestry(
      col,
      over !== undefined ? raceUnderSubrace(race, over) : race,
      `race:${origin.uid}`,
      ancestry,
    );
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
  linkDraconicAncestry(col, ancestry.dragon, race);
}
