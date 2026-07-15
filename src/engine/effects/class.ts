import { calcAbilities } from '../calc/abilities';
import { classSpellcastingMode } from '../calc/slots';
import { emitCuratedEffects as emitCurated } from '../curated/curatedEffects';
import { summarizeEntries } from '../summarize';
import { ABILITIES, type Ability, type DataEntity, type EffectOrigin, refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, str } from './base';
import { collectFeatEntity } from './feat';
import { proseScanFeature } from './proseScan';
import { expertiseOptions, readProficiencyList, skillOptions } from './readers';

/** Name of a race/feat/background prerequisite entry (string `name|source` or object). */
function prereqRefName(x: unknown): string | undefined {
  if (typeof x === 'string') {
    const name = (x.split('#')[0] ?? x).split('|')[0]?.trim();
    return name !== undefined && name !== '' ? name : undefined;
  }
  if (x !== null && typeof x === 'object') {
    const o = x as { name?: unknown; subrace?: unknown; displayEntry?: unknown };
    if (typeof o.displayEntry === 'string' && o.displayEntry !== '') return o.displayEntry;
    if (typeof o.name === 'string' && o.name !== '') {
      // Keep the subrace qualifier so a race gate reads "high elf", not "elf".
      return typeof o.subrace === 'string' && o.subrace !== '' ? `${o.subrace} ${o.name}` : o.name;
    }
  }
  return undefined;
}

/** AND-joined summary of one requirement set (one element of a prerequisite array). */
function summarizeReqSet(r: Record<string, unknown>): string {
  const parts: string[] = [];
  const ability = r.ability;
  if (Array.isArray(ability)) {
    for (const a of ability) {
      if (a !== null && typeof a === 'object') {
        for (const [k, v] of Object.entries(a)) parts.push(`${k.toUpperCase()} ${v}`);
      }
    }
  }
  if (typeof r.level === 'number') parts.push(`level ${r.level}`);
  else if (r.level !== null && typeof r.level === 'object') {
    const lv = (r.level as { level?: number }).level;
    if (typeof lv === 'number') parts.push(`level ${lv}`);
  }
  // Warlock invocation gates: Pact Boon, patron, and known-spell prerequisites.
  if (typeof r.pact === 'string') parts.push(`Pact of the ${r.pact}`);
  if (typeof r.patron === 'string') parts.push(`${r.patron.split('|')[0]} patron`);
  if (Array.isArray(r.spell)) {
    const spells = r.spell
      .map((s) => (typeof s === 'string' ? (s.split('#')[0] ?? s).split('|')[0] : undefined))
      .filter((s): s is string => s !== undefined);
    if (spells.length > 0) parts.push(`knows ${spells.join(' or ')}`);
  }
  // Requirement kinds that were previously dropped entirely (e.g. Prodigy's
  // race gate, Strixhaven Mascot's feat gate).
  if (Array.isArray(r.race)) {
    const names = r.race.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0) parts.push(`race ${names.join('/')}`);
  }
  if (Array.isArray(r.feat)) {
    const names = r.feat.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0) parts.push(`${names.join('/')} feat`);
  }
  if (Array.isArray(r.background)) {
    const names = r.background.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0) parts.push(`${names.join('/')} background`);
  }
  if (Array.isArray(r.proficiency)) {
    for (const p of r.proficiency) {
      if (p !== null && typeof p === 'object') {
        for (const [k, v] of Object.entries(p)) {
          if (typeof v === 'string') parts.push(`${v} ${k}`);
        }
      }
    }
  }
  if (typeof r.other === 'string') parts.push(r.other);
  if (Array.isArray(r.spellcasting2020) || r.spellcasting === true) parts.push('spellcasting');
  return parts.join(', ');
}

/**
 * "STR 13" / "INT 13, level 4 or WIS 13, level 4" from a feat/entity prerequisite
 * array. Each array element is an alternative requirement SET (OR); fields within
 * a set are all required (AND). Alternatives are joined with " or " rather than
 * flattened into one misleading AND list.
 */
export function summarizePrerequisite(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw
    .filter((req): req is Record<string, unknown> => req !== null && typeof req === 'object')
    .map(summarizeReqSet)
    .filter((s) => s !== '')
    .join(' or ');
}

/** Highest numeric level prerequisite (used to gate optional-feature picks). */
export function requiredLevel(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined;
  let need: number | undefined;
  for (const req of raw) {
    if (req === null || typeof req !== 'object') continue;
    const lvRaw = (req as Record<string, unknown>).level;
    const lv =
      typeof lvRaw === 'number'
        ? lvRaw
        : lvRaw !== null && typeof lvRaw === 'object'
          ? (lvRaw as { level?: number }).level
          : undefined;
    if (typeof lv === 'number') need = need === undefined ? lv : Math.max(need, lv);
  }
  return need;
}

// ---------------------------------------------------------------------------
// Prerequisite evaluation (advisory — GAME-005)
//
// Whether a feat/optional-feature prerequisite is *likely* met by the character
// so far. This drives an advisory cue, never a block: "guidance, not
// gatekeeping" means a table-approved pick must stay selectable. So the
// evaluator is deliberately conservative — it only flags a requirement it can
// affirmatively judge as unmet, and treats anything it can't evaluate (pact,
// patron, known-spell, free-text `other`) as satisfied to avoid false flags.
// Scores come from effects collected up to this point (race/background/earlier
// levels), which is exact for the common case; a later ASI is not yet folded in.
// ---------------------------------------------------------------------------

export interface PrereqContext {
  abilityScores: Record<Ability, number>;
  totalLevel: number;
  /** Combined, lowercased race + subrace name (empty when no race chosen). */
  raceName: string;
  /** Lowercased feat names the character already has (granted, chosen, declared). */
  featNames: Set<string>;
  backgroundName?: string;
  /** Lowercased skill/tool/armor/weapon proficiency names collected so far. */
  proficiencies: Set<string>;
  hasSpellcasting: boolean;
}

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Lenient two-way token-subset match, biased toward "matches" to avoid false flags. */
function nameMatches(prereqName: string, candidate: string): boolean {
  const p = nameTokens(prereqName);
  const c = nameTokens(candidate);
  if (p.length === 0 || c.length === 0) return true;
  return p.every((t) => c.includes(t)) || c.every((t) => p.includes(t));
}

export function buildPrereqContext(col: Collector): PrereqContext {
  const doc = col.doc;
  const abilities = calcAbilities(doc, col.effects);
  const abilityScores = {} as Record<Ability, number>;
  for (const a of ABILITIES) abilityScores[a] = abilities[a].value;

  const featNames = new Set<string>();
  const addFeatName = (uidOrName: string) => {
    const name = uidOrName.split('|')[0]?.trim().toLowerCase();
    if (name !== undefined && name !== '') featNames.add(name);
  };
  for (const f of doc.feats) addFeatName(f.ref.name);
  for (const uid of col.collectedFeats) addFeatName(uid);
  for (const [key, val] of Object.entries(doc.choices)) {
    if (!key.endsWith(':feat')) continue; // ASI-chosen feats picked at any level
    for (const v of Array.isArray(val) ? val : [val]) {
      if (typeof v === 'string') addFeatName(v);
    }
  }

  const proficiencies = new Set<string>();
  for (const e of col.effects) {
    if (e.kind === 'skillProf') proficiencies.add(e.skill.toLowerCase());
    else if (e.kind === 'toolProf' || e.kind === 'armorProf' || e.kind === 'weaponProf') {
      proficiencies.add(e.name.toLowerCase());
    }
  }

  const hasSpellcasting = doc.classes.some(
    (c) => classSpellcastingMode(col.ctx.get('class', c.ref.name, c.ref.source)) !== 'none',
  );

  return {
    abilityScores,
    totalLevel: doc.classes.reduce((s, c) => s + c.levels, 0),
    raceName: `${doc.race?.name ?? ''} ${doc.subrace?.name ?? ''}`.trim(),
    featNames,
    backgroundName: doc.background?.name.toLowerCase(),
    proficiencies,
    hasSpellcasting,
  };
}

function hasProficiency(value: string, ctx: PrereqContext): boolean {
  const v = value.toLowerCase();
  for (const p of ctx.proficiencies) {
    if (p === v || p.includes(v) || v.includes(p)) return true;
  }
  return false;
}

/** One requirement set (AND of its fields). Unevaluable fields count as met. */
function meetsReqSet(r: Record<string, unknown>, ctx: PrereqContext): boolean {
  if (Array.isArray(r.ability)) {
    for (const obj of r.ability) {
      if (obj !== null && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          const a = k.toLowerCase();
          if ((ABILITIES as readonly string[]).includes(a) && typeof v === 'number') {
            if ((ctx.abilityScores[a as Ability] ?? 0) < v) return false;
          }
        }
      }
    }
  }
  const lvl =
    typeof r.level === 'number'
      ? r.level
      : r.level !== null && typeof r.level === 'object'
        ? (r.level as { level?: number }).level
        : undefined;
  if (typeof lvl === 'number' && ctx.totalLevel < lvl) return false;

  if ((r.spellcasting === true || Array.isArray(r.spellcasting2020)) && !ctx.hasSpellcasting) {
    return false;
  }

  // race/feat/background lists are satisfied by ANY match (OR within the list).
  if (Array.isArray(r.race) && ctx.raceName !== '') {
    const names = r.race.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0 && !names.some((n) => nameMatches(n, ctx.raceName))) return false;
  }
  if (Array.isArray(r.feat)) {
    const names = r.feat.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0 && !names.some((n) => ctx.featNames.has(n.toLowerCase()))) return false;
  }
  if (Array.isArray(r.background) && ctx.backgroundName !== undefined) {
    const names = r.background.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0 && !names.some((n) => nameMatches(n, ctx.backgroundName ?? ''))) {
      return false;
    }
  }
  if (Array.isArray(r.proficiency)) {
    for (const p of r.proficiency) {
      if (p !== null && typeof p === 'object') {
        for (const v of Object.values(p)) {
          if (typeof v === 'string' && v !== '' && !hasProficiency(v, ctx)) return false;
        }
      }
    }
  }
  // pact / patron / spell / other are intentionally not evaluated (treated as met).
  return true;
}

/** True if the character likely satisfies the prerequisite (OR across sets). */
export function meetsPrerequisite(raw: unknown, ctx: PrereqContext): boolean {
  if (!Array.isArray(raw)) return true;
  const sets = raw.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
  if (sets.length === 0) return true;
  return sets.some((set) => meetsReqSet(set, ctx));
}

/** "Rage|Barbarian||1" or "...|1|TCE" -> parts. Empty classSource = PHB. */
export interface ClassFeatureRef {
  name: string;
  className: string;
  classSource: string;
  level: number;
  featureSource?: string;
}

export function parseClassFeatureRef(raw: string): ClassFeatureRef | undefined {
  const parts = raw.split('|');
  const [name, className, classSource, levelStr, featureSource] = parts;
  if (name === undefined || className === undefined) return undefined;
  const level = Number.parseInt(levelStr ?? '', 10);
  return {
    name,
    className,
    classSource: classSource !== undefined && classSource !== '' ? classSource : 'PHB',
    level: Number.isNaN(level) ? 1 : level,
    featureSource: featureSource !== undefined && featureSource !== '' ? featureSource : undefined,
  };
}

/** "Name|Class|ClassSource|Short|ShortSource|Level|Source?" for subclasses. */
export function parseSubclassFeatureRef(
  raw: string,
): (ClassFeatureRef & { shortName: string; shortSource: string }) | undefined {
  const parts = raw.split('|');
  const [name, className, classSource, shortName, shortSource, levelStr, featureSource] = parts;
  if (name === undefined || className === undefined || shortName === undefined) return undefined;
  const level = Number.parseInt(levelStr ?? '', 10);
  return {
    name,
    className,
    classSource: classSource !== undefined && classSource !== '' ? classSource : 'PHB',
    shortName,
    shortSource: shortSource !== undefined && shortSource !== '' ? shortSource : 'PHB',
    level: Number.isNaN(level) ? 1 : level,
    featureSource: featureSource !== undefined && featureSource !== '' ? featureSource : undefined,
  };
}

function findClassFeature(col: Collector, ref: ClassFeatureRef): DataEntity | undefined {
  return col.ctx
    .byType('classFeature')
    .find(
      (f) =>
        str(f.name)?.toLowerCase() === ref.name.toLowerCase() &&
        str(f.className)?.toLowerCase() === ref.className.toLowerCase() &&
        str(f.classSource)?.toLowerCase() === ref.classSource.toLowerCase() &&
        f.level === ref.level &&
        (ref.featureSource === undefined ||
          str(f.source)?.toLowerCase() === ref.featureSource.toLowerCase()),
    );
}

function findSubclassFeature(
  col: Collector,
  ref: ClassFeatureRef & { shortName: string; shortSource: string },
): DataEntity | undefined {
  return col.ctx
    .byType('subclassFeature')
    .find(
      (f) =>
        str(f.name)?.toLowerCase() === ref.name.toLowerCase() &&
        str(f.className)?.toLowerCase() === ref.className.toLowerCase() &&
        str(f.subclassShortName)?.toLowerCase() === ref.shortName.toLowerCase() &&
        str(f.subclassSource)?.toLowerCase() === ref.shortSource.toLowerCase() &&
        f.level === ref.level,
    );
}

/** ASI feature at a class level -> asiOrFeat prompt (+ follow-up prompts). */
function handleAsi(col: Collector, origin: EffectOrigin, classUid: string, level: number): void {
  const baseId = `class:${classUid}:asi:${level}`;
  col.choice(
    {
      id: baseId,
      origin,
      kind: 'asiOrFeat',
      label: `Level ${level}: Ability Score Improvement or Feat`,
      count: 1,
      options: [
        { id: 'asi', label: 'Ability Score Improvement' },
        { id: 'feat', label: 'Feat' },
      ],
    },
    (selected) => {
      if (selected[0] === 'asi') {
        col.choice(
          {
            id: `${baseId}:abilities`,
            origin,
            kind: 'ability',
            label: `Level ${level}: +1 to two abilities (pick the same twice for +2)`,
            count: 2,
            allowRepeat: true,
            options: ABILITIES.map((a) => ({ id: a, label: a.toUpperCase() })),
          },
          (picked) => {
            for (const a of picked) {
              if ((ABILITIES as string[]).includes(a)) {
                col.add({ kind: 'abilityBonus', ability: a as Ability, amount: 1, origin });
              }
            }
          },
        );
      } else if (selected[0] === 'feat') {
        // Feats picked at other ASI levels — a non-repeatable feat shouldn't be
        // offered again (it would be deduped on collection anyway). The current
        // prompt's own pick is excluded so it still reads as selected.
        const takenElsewhere = new Set<string>();
        for (const [key, val] of Object.entries(col.doc.choices)) {
          if (key === `${baseId}:feat` || !key.endsWith(':feat')) continue;
          for (const v of Array.isArray(val) ? val : [val]) {
            if (typeof v === 'string') takenElsewhere.add(v.toLowerCase());
          }
        }
        const prereqCtx = buildPrereqContext(col);
        col.choice(
          {
            id: `${baseId}:feat`,
            origin,
            kind: 'feat',
            label: `Level ${level}: choose a feat`,
            count: 1,
            options: col.ctx
              .byType('feat')
              .filter((f) => str(f.name) !== undefined)
              .map((f) => {
                const prereq = summarizePrerequisite(f.prerequisite);
                const summary = summarizeEntries(f.entries);
                const optId = `${str(f.name)}|${str(f.source)}`.toLowerCase();
                const alreadyTaken = f.repeatable !== true && takenElsewhere.has(optId);
                // Advisory (never a block): flag an unmet prerequisite so the
                // player notices, but keep the feat selectable for table rulings.
                const unmet = prereq !== '' && !meetsPrerequisite(f.prerequisite, prereqCtx);
                return {
                  id: optId,
                  label: `${str(f.name)} (${str(f.source)})`,
                  description: prereq !== '' ? `Prereq: ${prereq}. ${summary}` : summary,
                  ...(alreadyTaken
                    ? { disabled: { reason: 'Already taken (not repeatable)' } }
                    : unmet
                      ? { advisory: 'You may not meet this prerequisite.' }
                      : {}),
                };
              }),
          },
          (picked) => {
            const uid = picked[0];
            if (uid === undefined) return;
            const [name, source] = uid.split('|');
            const feat = name !== undefined ? col.ctx.get('feat', name, source) : undefined;
            if (feat === undefined) {
              col.warn(`Chosen feat not found: ${uid}`);
              return;
            }
            collectFeatEntity(col, feat, uid, `asi${level}`);
          },
        );
      }
    },
  );
}

function handleOptionalFeatureProgression(
  col: Collector,
  cls: DataEntity,
  origin: EffectOrigin,
  classUid: string,
  classLevel: number,
): void {
  for (const prog of asEntityArray(cls.optionalfeatureProgression)) {
    const name = str(prog.name) ?? 'Optional feature';
    const featureTypes = Array.isArray(prog.featureType) ? prog.featureType.map(String) : [];
    // progression: {"1": 1, "10": 2} or an array indexed by level-1
    let count = 0;
    const progression = prog.progression;
    if (Array.isArray(progression)) {
      for (let lvl = 0; lvl < Math.min(classLevel, progression.length); lvl++) {
        const v = progression[lvl];
        if (typeof v === 'number') count = Math.max(count, v);
      }
    } else if (typeof progression === 'object' && progression !== null) {
      for (const [lvlStr, v] of Object.entries(progression)) {
        const lvl = Number.parseInt(lvlStr, 10);
        if (!Number.isNaN(lvl) && lvl <= classLevel && typeof v === 'number') {
          count = Math.max(count, v);
        }
      }
    }
    if (count === 0) continue;

    const prereqCtx = buildPrereqContext(col);
    const options = col.ctx
      .byType('optionalfeature')
      .filter((of) => {
        const types = Array.isArray(of.featureType) ? of.featureType.map(String) : [];
        return types.some((t) => featureTypes.includes(t));
      })
      .map((of) => {
        const prereq = summarizePrerequisite(of.prerequisite);
        const summary = summarizeEntries(of.entries);
        // Level is deterministic from this class entry, so disable options the
        // character can't take yet. Other gates (ability/race/feat/proficiency/
        // spellcasting) are advisory: flag them but keep the option selectable.
        const need = requiredLevel(of.prerequisite);
        const disabled =
          need !== undefined && classLevel < need
            ? { reason: `Requires level ${need}` }
            : undefined;
        const unmet =
          disabled === undefined && prereq !== '' && !meetsPrerequisite(of.prerequisite, prereqCtx);
        return {
          id: `${str(of.name)}|${str(of.source)}`.toLowerCase(),
          label: `${str(of.name)} (${str(of.source)})`,
          description: prereq !== '' ? `Prereq: ${prereq}. ${summary}` : summary,
          ...(disabled !== undefined
            ? { disabled }
            : unmet
              ? { advisory: 'You may not meet this prerequisite.' }
              : {}),
        };
      });

    col.choice(
      {
        id: `class:${classUid}:optfeature:${featureTypes.join('+')}`,
        origin,
        kind: 'optionalfeature',
        label: name,
        count,
        options,
      },
      (selected) => {
        for (const uid of selected) {
          const [ofName, ofSource] = uid.split('|');
          const of =
            ofName !== undefined ? col.ctx.get('optionalfeature', ofName, ofSource) : undefined;
          if (of === undefined) {
            col.warn(`Optional feature not found: ${uid}`);
            continue;
          }
          const ofOrigin: EffectOrigin = {
            label: `${name}: ${str(of.name) ?? uid}`,
            uid,
            type: 'class',
          };
          col.features.push({ name: ofOrigin.label, origin: ofOrigin, entries: of.entries });
          if (!emitCurated(col, uid, ofOrigin)) {
            proseScanFeature(col, str(of.name) ?? uid, of.entries, ofOrigin);
          }
        }
      },
    );
  }
}

export function collectClasses(col: Collector): void {
  const doc = col.doc;
  doc.classes.forEach((entry, classIndex) => {
    const cls = col.ctx.get('class', entry.ref.name, entry.ref.source);
    if (cls === undefined) {
      col.warn(`Class not found: ${refUid(entry.ref)}`);
      return;
    }
    const classUid = refUid(entry.ref);
    const origin: EffectOrigin = {
      label: str(cls.name) ?? entry.ref.name,
      uid: classUid,
      type: 'class',
    };
    const isFirstClass = classIndex === 0;
    const classLevel = entry.levels;

    // First class: saving throws + full starting proficiencies.
    // Later classes: the reduced `multiclassing.proficienciesGained` list.
    if (isFirstClass) {
      const saves = Array.isArray(cls.proficiency) ? cls.proficiency.map(String) : [];
      for (const save of saves) {
        if ((ABILITIES as string[]).includes(save)) {
          col.add({ kind: 'saveProf', ability: save as Ability, origin });
        }
      }
    }
    const profSource = isFirstClass
      ? ((cls.startingProficiencies ?? {}) as DataEntity)
      : (((cls.multiclassing as DataEntity | undefined)?.proficienciesGained ?? {}) as DataEntity);
    {
      const sp = profSource;
      for (const armor of Array.isArray(sp.armor) ? sp.armor : []) {
        const label =
          typeof armor === 'string'
            ? armor
            : (str((armor as DataEntity).proficiency) ?? JSON.stringify(armor));
        col.add({ kind: 'armorProf', name: label, origin });
      }
      for (const weapon of Array.isArray(sp.weapons) ? sp.weapons : []) {
        const label =
          typeof weapon === 'string'
            ? weapon
            : (str((weapon as DataEntity).proficiency) ?? JSON.stringify(weapon));
        col.add({ kind: 'weaponProf', name: label, origin });
      }
      for (const tool of Array.isArray(sp.tools) ? sp.tools : []) {
        if (typeof tool === 'string') col.add({ kind: 'toolProf', name: tool, origin });
      }
      readProficiencyList(
        col,
        sp.skills,
        origin,
        `class:${classUid}:skill`,
        'skill',
        'Class skill proficiency',
        (name) => col.add({ kind: 'skillProf', skill: name, level: 1, origin }),
        skillOptions,
      );
    }

    // Class features up to the current level
    const featureRefs = Array.isArray(cls.classFeatures) ? cls.classFeatures : [];
    for (const rawRef of featureRefs) {
      const isGainSubclass =
        typeof rawRef === 'object' && rawRef !== null && 'gainSubclassFeature' in rawRef;
      const refStr = typeof rawRef === 'string' ? rawRef : str((rawRef as DataEntity).classFeature);
      if (refStr === undefined) continue;
      const ref = parseClassFeatureRef(refStr);
      if (ref === undefined || ref.level > classLevel) continue;

      if (isGainSubclass && entry.subclass === undefined) {
        col.pending.push({
          id: `class:${classUid}:subclass`,
          origin,
          kind: 'generic',
          label: `Choose a ${origin.label} subclass (level ${ref.level})`,
          count: 1,
          options: [],
        });
      }

      const feature = findClassFeature(col, ref);
      if (feature === undefined) {
        col.warn(`Class feature not found: ${refStr}`);
        continue;
      }
      col.features.push({ name: ref.name, level: ref.level, origin, entries: feature.entries });

      if (ref.name.startsWith('Ability Score Improvement')) {
        handleAsi(col, origin, classUid, ref.level);
      }
      // Rogue/Bard "Expertise" is prose-only in the data — emit the choice.
      if (ref.name === 'Expertise') {
        const featOrigin: EffectOrigin = { ...origin, label: `${origin.label} Expertise` };
        col.choice(
          {
            id: `class:${classUid}:expertise:${ref.level}`,
            origin: featOrigin,
            kind: 'expertise',
            label: `Expertise — 2 proficient skills (level ${ref.level})`,
            count: 2,
            options: expertiseOptions(col),
          },
          (selected) => {
            for (const s of selected) {
              col.add({ kind: 'skillProf', skill: s, level: 2, origin: featOrigin });
            }
          },
        );
      }
      const featureOrigin: EffectOrigin = { ...origin, label: ref.name };
      if (!emitCurated(col, `${ref.name}|${origin.label}`.toLowerCase(), featureOrigin)) {
        proseScanFeature(col, ref.name, feature.entries, featureOrigin);
      }
    }

    // Subclass features
    if (entry.subclass !== undefined) {
      const sub = col.ctx.get('subclass', entry.subclass.name, entry.subclass.source);
      if (sub === undefined) {
        col.warn(`Subclass not found: ${refUid(entry.subclass)}`);
      } else {
        const subOrigin: EffectOrigin = {
          label: str(sub.name) ?? entry.subclass.name,
          uid: refUid(entry.subclass),
          type: 'subclass',
        };
        // Domain / oath / circle "always prepared" spells live on the subclass
        // entity (not its features). Default their casting ability to the class's.
        const subAbility = str(cls.spellcastingAbility);
        collectAdditionalSpells(
          col,
          sub.additionalSpells,
          subOrigin,
          subAbility !== undefined && (ABILITIES as readonly string[]).includes(subAbility)
            ? (subAbility as Ability)
            : undefined,
          `subclass:${subOrigin.uid}`,
        );
        const subRefs = Array.isArray(sub.subclassFeatures) ? sub.subclassFeatures : [];
        for (const rawRef of subRefs) {
          if (typeof rawRef !== 'string') continue;
          const ref = parseSubclassFeatureRef(rawRef);
          if (ref === undefined || ref.level > classLevel) continue;
          const feature = findSubclassFeature(col, ref);
          if (feature === undefined) {
            col.warn(`Subclass feature not found: ${rawRef}`);
            continue;
          }
          col.features.push({
            name: ref.name,
            level: ref.level,
            origin: subOrigin,
            entries: feature.entries,
          });
          const subFeatureOrigin: EffectOrigin = { ...subOrigin, label: ref.name };
          if (!emitCurated(col, `${ref.name}|${subOrigin.label}`.toLowerCase(), subFeatureOrigin)) {
            proseScanFeature(col, ref.name, feature.entries, subFeatureOrigin);
          }
        }
      }
    }

    handleOptionalFeatureProgression(col, cls, origin, classUid, classLevel);
    emitCurated(col, `class:${classUid}`, origin);
  });
}
