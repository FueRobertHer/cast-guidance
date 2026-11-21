import { type DataEntity, type EffectOrigin, refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, str } from './base';
import { readFeatGrants } from './feat';
import { mechanicsOf } from './mechanics';
import {
  isLanguageOrToolMix,
  languageOptions,
  readAbilityBlock,
  readLanguageOrToolMix,
  readProficiencyList,
  skillOptions,
  toolOptions,
} from './readers';

export function collectBackground(col: Collector): void {
  const ref = col.doc.background;
  if (ref === undefined) return;
  const e = col.ctx.get('background', ref.name, ref.source);
  if (e === undefined) {
    col.warn(`Background not found: ${refUid(ref)}`);
    return;
  }
  const origin: EffectOrigin = {
    label: str(e.name) ?? ref.name,
    uid: refUid(ref),
    type: 'background',
  };
  const idBase = `background:${origin.uid}`;

  // What its data gives is what it inherits: its own `castGuidance` adds to it,
  // drops from it or replaces it, and a pack's patch reaches it by `name|source`.
  // Its moments count from here too (`subjectsWithMoments`).
  mechanicsOf(col, {
    entry: e,
    label: origin.label,
    origin,
    target: origin.uid,
    inherited: () => inheritBackground(col, e, origin, idBase),
  });

  // Its origin feats are feats of their own, after it: what it drops or
  // replaces never reaches a feat's effects. They keep their picks under the
  // background's uid, which is what every saved character uses.
  readFeatGrants(col, e.feats, origin, idBase, origin.uid);

  col.features.push({ name: origin.label, origin, entries: e.entries });
}

/** What a background's data gives: proficiencies, languages, tools, spells and ability scores. */
function inheritBackground(
  col: Collector,
  e: DataEntity,
  origin: EffectOrigin,
  idBase: string,
): void {
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
  // Custom Background's languages and tools are one grant, "two of your choice",
  // which `skillToolLanguageProficiencies` spells out and `languageProficiencies`
  // shortens to two languages, so the mix stands in for the languages' picks and
  // only a language named outright is still read. The pick keeps the id the two
  // languages had, so a saved pair still holds. The named ones come first, so the
  // mix marks them as spoken.
  const mixed = isLanguageOrToolMix(e.skillToolLanguageProficiencies);
  readProficiencyList(
    col,
    mixed ? namedOnly(e.languageProficiencies) : e.languageProficiencies,
    origin,
    `${idBase}:lang`,
    'language',
    'Language',
    (name) => col.add({ kind: 'language', name, origin }),
    languageOptions,
  );
  readLanguageOrToolMix(col, e.skillToolLanguageProficiencies, origin, `${idBase}:lang:0`);
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

  // Some backgrounds grant innate/always-prepared spells or widen a spell list
  // (e.g. Strixhaven student backgrounds' spell-level-keyed `expanded` lists);
  // without this those grants and notes were silently dropped.
  collectAdditionalSpells(col, e.additionalSpells, origin, undefined, idBase);

  // XPHB (2024) backgrounds: weighted ability bonuses (the origin feat follows).
  readAbilityBlock(col, e.ability, origin, `${idBase}:ability`);
}

/** A proficiency list without its picks (`choose`, `any…`): the grants it names outright. */
function namedOnly(raw: unknown): DataEntity[] {
  return asEntityArray(raw).map((entry) =>
    Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== 'choose' && !key.startsWith('any')),
    ),
  );
}
