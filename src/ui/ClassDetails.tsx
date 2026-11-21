import type { Entity } from '@/data5e/copyMod';
import { plainEntryText } from '@/data5e/entries/plainText';

/**
 * What a class gives at the start and as it levels, for a player choosing one
 * (review item 5): its proficiencies and its features by level. Exported for
 * any page that describes a class (the creator's info sheet now; the Library
 * may use it too).
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const SKILL_WORDS: Readonly<Record<string, string>> = {
  'animal handling': 'Animal Handling',
  'sleight of hand': 'Sleight of Hand',
};

/** "sleight of hand" -> "Sleight of Hand", "arcana" -> "Arcana". */
const skillName = (s: string) =>
  SKILL_WORDS[s.toLowerCase()] ?? s.replace(/\b\w/g, (c) => c.toUpperCase());

/** One armor, weapon or tool entry as words: a string, or `{ proficiency }` and the like. */
function profWords(v: unknown): string | undefined {
  if (typeof v === 'string') return plainEntryText(v);
  if (!isRecord(v)) return undefined;
  if (typeof v.proficiency === 'string') return plainEntryText(v.proficiency);
  // A tool list can be `{ "thieves' tools": true }`.
  const keys = Object.entries(v)
    .filter(([, on]) => on === true)
    .map(([k]) => plainEntryText(k));
  return keys.length > 0 ? keys.join(', ') : undefined;
}

/** A class's skill block in words: "Choose 2: Arcana, History" or "Any 3". */
function skillWords(list: unknown): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const parts = list.flatMap((block): string[] => {
    if (!isRecord(block)) return [];
    const out: string[] = [];
    for (const [key, value] of Object.entries(block)) {
      if (key === 'choose' && isRecord(value)) {
        const from = Array.isArray(value.from) ? value.from.map((s) => skillName(String(s))) : [];
        const count = typeof value.count === 'number' ? value.count : 1;
        out.push(from.length > 0 ? `choose ${count}: ${from.join(', ')}` : `choose ${count}`);
      } else if (key === 'any' && typeof value === 'number') {
        out.push(`any ${value}`);
      } else if (value === true) {
        out.push(skillName(key));
      }
    }
    return out;
  });
  if (parts.length === 0) return undefined;
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Label and value rows for a class's starting proficiencies, the ones it has. */
export function classProficiencies(entity: Entity): Array<[string, string]> {
  const sp = entity.startingProficiencies;
  if (!isRecord(sp)) return [];
  const rows: Array<[string, string]> = [];
  const list = (label: string, v: unknown) => {
    if (!Array.isArray(v)) return;
    const words = v.flatMap((x) => profWords(x) ?? []).filter((w) => w !== '');
    if (words.length > 0) rows.push([label, words.join(', ')]);
  };
  list('Armor', sp.armor);
  list('Weapons', sp.weapons);
  list('Tools', sp.tools);
  const skills = skillWords(sp.skills);
  if (skills !== undefined) rows.push(['Skills', skills]);
  return rows;
}

/** A class's features, grouped by the level they arrive at, in order. */
export function classFeaturesByLevel(entity: Entity): Array<{ level: number; names: string[] }> {
  const features = Array.isArray(entity.classFeatures) ? entity.classFeatures : [];
  const byLevel = new Map<number, string[]>();
  for (const f of features) {
    const ref = typeof f === 'string' ? f : isRecord(f) ? f.classFeature : undefined;
    if (typeof ref !== 'string') continue;
    // "Name|Class|ClassSource|Level|Source", the source left out when it is the class's.
    const [name, , , levelText, source] = ref.split('|');
    const level = Number(levelText);
    if (name === undefined || name === '' || !Number.isInteger(level)) continue;
    const subclass = isRecord(f) && f.gainSubclassFeature === true;
    // A feature from another book in a class's own list is an optional one
    // (Tasha's on a 2014 class), there only when the table turns that rule on.
    const optional =
      source !== undefined &&
      source !== '' &&
      typeof entity.source === 'string' &&
      source.toLowerCase() !== entity.source.toLowerCase();
    const shown = `${plainEntryText(name)}${subclass ? ' (subclass)' : optional ? ' (optional)' : ''}`;
    byLevel.set(level, [...(byLevel.get(level) ?? []), shown]);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, names]) => ({ level, names }));
}

/** Proficiencies, then features by level, as the class info sheet lists them. */
export function ClassDetails({ entity }: { entity: Entity }) {
  const profs = classProficiencies(entity);
  const levels = classFeaturesByLevel(entity);
  if (profs.length === 0 && levels.length === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-3 text-caption">
      {profs.length > 0 && (
        <section className="flex flex-col gap-0.5">
          <h3 className="text-label text-ink">Proficiencies</h3>
          {profs.map(([label, value]) => (
            <div key={label} className="text-ink-muted">
              <span className="font-semibold text-ink">{label}:</span> {value}
            </div>
          ))}
        </section>
      )}
      {levels.length > 0 && (
        <section className="flex flex-col gap-0.5">
          <h3 className="text-label text-ink">Features by level</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {levels.map(({ level, names }) => (
              <div key={level} className="contents">
                <dt className="font-semibold text-ink tabular-nums">{level}</dt>
                <dd className="text-ink-muted">{names.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
