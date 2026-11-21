import { linkSpend } from '../curated/spendLinks';
import { type DataEntity, type EffectOrigin, refUid, SKILLS } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, num, str } from './base';
import { isRepeatableFeat, readFeatOptionalFeatures, readProsePick } from './featPicks';
import { emitBuiltInRows, entryKeys, mechanicsOf } from './mechanics';
import { progressionCount } from './optionalFeatures';
import { buildPrereqContext, featChoiceOption } from './prerequisites';
import { proseScanFeature } from './proseScan';
import {
  expertiseOptions,
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
 * The name in a prerequisite's feat ref ("name|source", maybe "|display text").
 * Only the name, as the prerequisite's own check reads it: whichever printing
 * let the character take this feat is the one whose choice it inherits.
 */
function featNameOf(ref: unknown): string {
  return (String(ref).split(/[|#]/)[0] ?? '').trim().toLowerCase();
}

/** Collect one feat entity. `instanceId` keeps repeatable feats' choices apart. */
export function collectFeatEntity(
  col: Collector,
  e: DataEntity,
  uid: string,
  instanceId: string,
): void {
  // A non-repeatable feat applies at most once, even if it is both granted (by a
  // background) and chosen (via an ASI), or chosen at two different ASI levels.
  // Repeatable feats keep independent instances — their choices are namespaced
  // by instanceId — so they are never deduped.
  if (!isRepeatableFeat(e)) {
    if (col.collectedFeats.has(uid)) {
      col.warn(`${str(e.name) ?? uid}: not a repeatable feat, so the extra selection was ignored.`);
      return;
    }
    col.collectedFeats.add(uid);
  }
  const origin: EffectOrigin = { label: str(e.name) ?? uid, uid, type: 'feat' };
  const idBase = `feat:${uid}:${instanceId}`;

  const beforeAbility = col.effects.length;
  readAbilityBlock(col, e.ability, origin, `${idBase}:ability`);
  // What an `inherit` spell casts with. One built on another feat inherits that
  // feat's choice, not its own raise. Otherwise it is what this feat raised: one
  // that raised two names no one of them, and one still waiting on its pick has
  // none to hand on yet.
  const raised = new Set(
    col.effects.slice(beforeAbility).flatMap((x) => (x.kind === 'abilityBonus' ? [x.ability] : [])),
  );
  const builtOn = asEntityArray(e.prerequisite).flatMap((p) =>
    p.feat === undefined ? [] : [p.feat].flat().map(featNameOf),
  );
  const [ownRaise] = raised.size === 1 ? raised : [];
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
  readSkillOrToolChoice(col, e.skillToolLanguageProficiencies, origin, `${idBase}:skillTool`);
  readDefenses(col, e, origin, idBase);
  // A copy of an official feat (`officialOf`) reads that feat's rows after its own.
  const uids = entryKeys(e, uid);
  // Asked first, since an invocation Eldritch Adept gives casts with the ability it picks.
  const picked = readProsePick(col, uids, origin, idBase);
  readFeatOptionalFeatures(col, e, uids, origin, idBase, picked?.ability);

  // expertise: [{ anyProficientSkill: 1 }] — options limited at prompt-render
  // time is complex; offer all skills and validate visually via prof dots.
  for (const entry of asEntityArray(e.expertise)) {
    const count = num(entry.anyProficientSkill) ?? num(entry.any) ?? 0;
    if (count > 0) {
      col.choice(
        {
          id: `${idBase}:expertise`,
          origin,
          kind: 'expertise',
          label: 'Expertise',
          count,
          options: expertiseOptions(col),
        },
        (selected) => {
          for (const s of selected) col.add({ kind: 'skillProf', skill: s, level: 2, origin });
        },
      );
    }
    for (const [key, value] of Object.entries(entry)) {
      if (value === true) {
        const skill = SKILLS.find((s) => s.name.toLowerCase() === key.toLowerCase());
        if (skill) col.add({ kind: 'skillProf', skill: skill.name, level: 2, origin });
      }
    }
  }

  const senses = asEntityArray(e.senses);
  for (const s of senses) {
    for (const [key, value] of Object.entries(s)) {
      if (typeof value === 'number') col.add({ kind: 'sense', sense: key, range: value, origin });
    }
  }

  collectAdditionalSpells(
    col,
    e.additionalSpells,
    origin,
    undefined,
    idBase,
    undefined,
    builtOn.length > 0 ? { fromFeats: builtOn } : { ability: ownRaise },
  );

  col.features.push({
    name: picked !== undefined ? `${origin.label} (${picked.label})` : origin.label,
    origin,
    entries: e.entries,
  });
  mechanicsOf(col, {
    entry: e,
    label: origin.label,
    origin,
    target: uid,
    ruleKeys: uids,
    pickBase: idBase,
    inherited: (builtIn) => {
      if (builtIn?.scan !== 'replace') proseScanFeature(col, origin.label, e.entries, origin);
      emitBuiltInRows(col, 'rollAdvantage', uids, origin);
      emitBuiltInRows(col, 'rollExtra', uids, origin);
      linkSpend(col, uids, origin.label, origin);
    },
  });
  // Each named benefit's own effects (its cards in the Workshop). What the feat
  // inherits, its curated row and the scan of its text, is read once above for
  // the whole feat, so a benefit inherits nothing: no rule keys, no scan. Its
  // picks are the feat's, under the feat's own ids: the Workshop gives a new
  // pick an id no other part of the entry has, and a benefit renamed keeps its
  // answers.
  for (const part of asEntityArray(e.entries)) {
    const name = str(part.name);
    if (name === undefined) continue;
    mechanicsOf(col, {
      entry: part,
      label: `${origin.label}: ${name}`,
      origin,
      target: `${name}|${origin.label}`,
      pickBase: idBase,
    });
  }
}

/** The feat categories a grant names, lowercase: one code or a list ("O", ["FS", "FS:P"]). */
function categoriesOf(raw: unknown): string[] {
  return [raw].flat().flatMap((c) => (typeof c === 'string' && c !== '' ? [c.toLowerCase()] : []));
}

/** What a player calls each category the data names. */
const CATEGORY_NAMES: Record<string, string> = {
  o: 'an Origin feat',
  g: 'a General feat',
  fs: 'a Fighting Style feat',
  eb: 'an Epic Boon feat',
  dg: 'a Dark Gift feat',
  d: 'a Dragonmark feat',
};

/** "an Origin feat", or "a feat" for a list the table does not name or any feat. */
function featNoun(categories: readonly string[]): string {
  const [first] = categories;
  return (first !== undefined ? CATEGORY_NAMES[first] : undefined) ?? 'a feat';
}

/** A feat's uid as picks and `collectedFeats` hold it. */
const featUidOf = (f: DataEntity) => `${str(f.name)}|${str(f.source)}`.toLowerCase();

/** Whether a choice id holds feat picks: `…:feat`, or an origin's `…:feat:<n>`. */
const isFeatPick = (key: string) => /:feat(?::\d+)?$/.test(key);

/**
 * The feats a character already has or has picked anywhere but `ownId`: those
 * collected so far, every feat pick saved, and the feats the background names
 * outright, which are collected after the species picks. A non-repeatable one
 * among them cannot be picked again, whichever order the pickers come in.
 */
export function featsTakenElsewhere(col: Collector, ownId: string): Set<string> {
  const taken = new Set(col.collectedFeats);
  for (const [key, value] of Object.entries(col.doc.choices)) {
    if (key === ownId || !isFeatPick(key)) continue;
    for (const picked of Array.isArray(value) ? value : [value]) {
      if (typeof picked === 'string') taken.add(picked.toLowerCase());
    }
  }
  const bg = col.doc.background;
  const background = bg !== undefined ? col.ctx.get('background', bg.name, bg.source) : undefined;
  for (const grant of asEntityArray(background?.feats)) {
    for (const [key, value] of Object.entries(grant)) {
      const named = value === true ? namedFeat(key) : undefined;
      if (named !== undefined) taken.add(`${named.name}|${named.source}`.toLowerCase());
    }
  }
  return taken;
}

/**
 * A feat named outright, `name|source`, maybe with a "; option" suffix that
 * locks one of its picks: "magic initiate; cleric" (2024 Acolyte), "; wizard"
 * (Sage). The registry knows the feat by the name before it.
 */
function namedFeat(key: string): { name: string; source: string; locked: string } | undefined {
  const [rawName, source] = key.split('|');
  if (rawName === undefined || source === undefined || source === '') return undefined;
  const [baseName = rawName, ...optionParts] = rawName.split(';');
  return { name: baseName.trim(), source, locked: optionParts.join(';').trim() };
}

/** How a granted feat is asked for. */
interface FeatGrantPick {
  /** The prompt's id, and so where its answer is saved. */
  id: string;
  origin: EffectOrigin;
  label: string;
  count: number;
  /** The categories it may come from, lowercase; empty for any feat. */
  categories: readonly string[];
  /** What the picked feats keep their own picks under (`collectFeatEntity`). */
  instance: string;
}

/**
 * A pick of a feat a background, species or class grants, which collects the
 * feat it settles on as an ASI's feat pick does, with its prerequisites and
 * sub-choices. A non-repeatable feat taken elsewhere cannot be picked.
 */
function pickGrantedFeat(col: Collector, pick: FeatGrantPick): void {
  const taken = featsTakenElsewhere(col, pick.id);
  const prereqCtx = buildPrereqContext(col);
  const feats = col.ctx.byType('feat').filter((f) => {
    if (str(f.name) === undefined) return false;
    if (pick.categories.length === 0) return true;
    return categoriesOf(f.category).some((c) => pick.categories.includes(c));
  });
  if (feats.length === 0) {
    col.warn(
      `${pick.origin.label}: grants ${featNoun(pick.categories)}, but no matching feats are available.`,
    );
    return;
  }
  col.choice(
    {
      id: pick.id,
      origin: pick.origin,
      kind: 'feat',
      label: pick.label,
      count: pick.count,
      options: feats.map((f) =>
        featChoiceOption(f, prereqCtx, { taken: !isRepeatableFeat(f) && taken.has(featUidOf(f)) }),
      ),
    },
    (picked) => {
      for (const uid of picked) {
        const [name, source] = uid.split('|');
        const feat = name !== undefined ? col.ctx.get('feat', name, source) : undefined;
        if (feat === undefined) {
          col.warn(`Chosen feat not found: ${uid}`);
          continue;
        }
        collectFeatEntity(col, feat, uid, pick.instance);
      }
    },
  );
}

/**
 * The feats an origin's `feats` grants: one named outright is collected, and
 * `any` or `anyFromCategory` asks for one. Each pick gets its own indexed id,
 * `<idBase>:feat:<n>`, so two grants (or one beside a named feat) never share a
 * saved answer. The feats keep their own picks under `instance`.
 */
export function readFeatGrants(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  idBase: string,
  instance: string,
): void {
  let index = 0;
  for (const grant of asEntityArray(raw)) {
    for (const [key, value] of Object.entries(grant)) {
      if (value === true && key.includes('|')) {
        collectNamedFeat(col, key, origin, instance);
        continue;
      }
      if (key !== 'any' && key !== 'anyFromCategory') continue;
      let categories: string[] = [];
      let rawCount: unknown = 1;
      if (key === 'any') {
        rawCount = value;
      } else if (typeof value === 'string' || Array.isArray(value)) {
        categories = categoriesOf(value);
      } else if (value !== null && typeof value === 'object') {
        const v = value as { category?: unknown; count?: unknown };
        categories = categoriesOf(v.category);
        rawCount = v.count ?? 1;
      }
      const count = Math.max(1, Math.floor(num(rawCount) ?? 1));
      pickGrantedFeat(col, {
        id: `${idBase}:feat:${index}`,
        origin,
        label: `${origin.label}: choose ${count > 1 ? `${count} feats` : featNoun(categories)}`,
        count,
        categories,
        instance,
      });
      index += 1;
    }
  }
}

/** A feat a grant names outright, collected where it is read. */
function collectNamedFeat(
  col: Collector,
  key: string,
  parentOrigin: EffectOrigin,
  instance: string,
): void {
  const named = namedFeat(key);
  if (named === undefined) return;
  const e = col.ctx.get('feat', named.name, named.source);
  if (e === undefined) {
    col.warn(`Origin feat not found: ${named.name}|${named.source}`);
    return;
  }
  collectFeatEntity(col, e, `${named.name}|${named.source}`.toLowerCase(), instance);
  if (named.locked !== '') {
    // Surface the locked sub-choice; the feat's own spell/option picks still
    // follow its rules (a full picker for those is tracked separately).
    col.add({
      kind: 'note',
      text: `${str(e.name) ?? named.name}: locked to “${named.locked}” by this origin.`,
      origin: parentOrigin,
    });
  }
}

/** Where a class or subclass keeps its `featProgression` picks. */
export interface FeatProgressionSource {
  /** The class's or subclass's choice prefix, `class:<uid>` or `subclass:<uid>`. */
  idBase: string;
  /** Its uid, which the picked feats' own picks are kept under. */
  uid: string;
  origin: EffectOrigin;
  /** The class level that decides how many each progression gives. */
  level: number;
  /**
   * Whether a class feature asks for this progression already (Epic Boon), by
   * its lowercase name and the first level it gives a pick at.
   */
  skip?: (name: string, from: number | undefined) => boolean;
}

/**
 * A class's or subclass's `featProgression`: the 2024 Fighting Style feats
 * (Fighter 1, Paladin and Ranger 2, Champion 7), one pick of that category for
 * each, `<idBase>:feats:<name>:feat`. A feat picked keeps its own picks under
 * `feats:<name>@<uid>`, so a class's and its subclass's never meet.
 */
export function readFeatProgression(
  col: Collector,
  entity: DataEntity,
  { idBase, uid, origin, level, skip }: FeatProgressionSource,
): void {
  for (const prog of asEntityArray(entity.featProgression)) {
    const name = str(prog.name) ?? 'Feat';
    const key = name.toLowerCase();
    const from = firstLevelOf(prog.progression);
    if (skip?.(key, from) === true) continue;
    const count = progressionCount(prog.progression, level);
    if (count === 0) continue;
    const categories = categoriesOf(prog.category);
    pickGrantedFeat(col, {
      id: `${idBase}:feats:${key}:feat`,
      origin,
      label: `${from !== undefined ? `Level ${from}: ` : ''}${name}, choose ${
        count > 1 ? `${count} feats` : 'a feat'
      }`,
      count,
      categories,
      instance: `feats:${key}@${uid}`,
    });
  }
}

/** The first level a progression gives a pick at, if it names one. */
function firstLevelOf(progression: unknown): number | undefined {
  if (progression === null || typeof progression !== 'object' || Array.isArray(progression)) {
    return undefined;
  }
  const levels = Object.entries(progression)
    .filter(([k, v]) => k !== '*' && typeof v === 'number' && v > 0)
    .map(([k]) => Number.parseInt(k, 10))
    .filter((n) => !Number.isNaN(n));
  return levels.length > 0 ? Math.min(...levels) : undefined;
}

export function collectFeats(col: Collector): void {
  for (const { ref, instanceId } of col.doc.feats) {
    const e = col.ctx.get('feat', ref.name, ref.source);
    if (e === undefined) {
      col.warn(`Feat not found: ${refUid(ref)}`);
      continue;
    }
    collectFeatEntity(col, e, refUid(ref), instanceId);
  }
}
