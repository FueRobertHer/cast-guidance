import { emitCuratedEffects as emitCurated } from '../curated/curatedEffects';
import { ABILITIES, type Ability, type DataEntity, type EffectOrigin, refUid } from '../types';
import { asEntityArray, type Collector, str } from './base';
import { collectFeatEntity } from './feat';
import { readProficiencyList, skillOptions } from './readers';

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
              .map((f) => ({
                id: `${str(f.name)}|${str(f.source)}`.toLowerCase(),
                label: `${str(f.name)} (${str(f.source)})`,
              })),
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

    const options = col.ctx
      .byType('optionalfeature')
      .filter((of) => {
        const types = Array.isArray(of.featureType) ? of.featureType.map(String) : [];
        return types.some((t) => featureTypes.includes(t));
      })
      .map((of) => ({
        id: `${str(of.name)}|${str(of.source)}`.toLowerCase(),
        label: `${str(of.name)} (${str(of.source)})`,
      }));

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
          emitCurated(col, uid, ofOrigin);
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
      emitCurated(col, `${ref.name}|${origin.label}`.toLowerCase(), {
        ...origin,
        label: ref.name,
      });
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
          emitCurated(col, `${ref.name}|${subOrigin.label}`.toLowerCase(), {
            ...subOrigin,
            label: ref.name,
          });
        }
      }
    }

    handleOptionalFeatureProgression(col, cls, origin, classUid, classLevel);
    emitCurated(col, `class:${classUid}`, origin);
  });
}
