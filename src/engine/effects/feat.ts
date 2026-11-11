import { emitCuratedEffects, hasCuratedRow } from '../curated/curatedEffects';
import { emitRollAdvantages } from '../curated/rollAdvantages';
import { emitRollExtras } from '../curated/rollExtras';
import { linkSpend } from '../curated/spendLinks';
import { type DataEntity, type EffectOrigin, refUid, SKILLS } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, num, str } from './base';
import { isRepeatableFeat, readFeatOptionalFeatures, readProsePick } from './featPicks';
import { entryKeys, mechanicsOf, officialOf } from './mechanics';
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
  const printed = officialOf(e)?.source.toLowerCase();
  mechanicsOf(col, {
    entry: e,
    label: origin.label,
    origin,
    target: uid,
    ruleKeys: uids,
    inCode: hasCuratedRow,
    inherited: (builtIn) => {
      const curated =
        builtIn !== undefined
          ? builtIn.scan === 'replace'
          : uids.some((key) =>
              emitCuratedEffects(col, key, origin, key === uid ? undefined : printed),
            );
      if (!curated) proseScanFeature(col, origin.label, e.entries, origin);
      emitRollAdvantages(col, uids, origin);
      emitRollExtras(col, uids, origin);
      uids.some((key) => linkSpend(col, key, origin.label, origin));
    },
  });
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
