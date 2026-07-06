/**
 * Pure dataset normalization: raw 5etools JSON files -> typed entity lists
 * with `_copy` resolved and `_versions` expanded. No browser/DB imports, so
 * the data-audit script exercises exactly the code the app runs.
 */
import {
  type CopyModWarning,
  type CopyRef,
  type Entity,
  expandVersions,
  resolveCopies,
  uidOf,
} from './copyMod';

export type EntityType =
  | 'race'
  | 'subrace'
  | 'background'
  | 'feat'
  | 'optionalfeature'
  | 'item'
  | 'itemGroup'
  | 'baseitem'
  | 'itemProperty'
  | 'itemType'
  | 'magicvariant'
  | 'skill'
  | 'language'
  | 'sense'
  | 'action'
  | 'condition'
  | 'disease'
  | 'status'
  | 'variantrule'
  | 'book'
  | 'class'
  | 'subclass'
  | 'classFeature'
  | 'subclassFeature'
  | 'spell';

export class EntityRegistry {
  private readonly types = new Map<EntityType, Entity[]>();
  private readonly index = new Map<EntityType, Map<string, Entity>>();
  readonly warnings: CopyModWarning[] = [];

  addAll(type: EntityType, entities: Entity[]): void {
    const list = this.types.get(type) ?? [];
    const idx = this.index.get(type) ?? new Map<string, Entity>();
    for (const e of entities) {
      list.push(e);
      const uid = uidOf(e);
      if (!idx.has(uid)) idx.set(uid, e);
    }
    this.types.set(type, list);
    this.index.set(type, idx);
  }

  byType(type: EntityType): readonly Entity[] {
    return this.types.get(type) ?? [];
  }

  get(type: EntityType, name: string, source?: string): Entity | undefined {
    const idx = this.index.get(type);
    if (!idx) return undefined;
    if (source !== undefined) return idx.get(`${name}|${source}`.toLowerCase());
    const lower = `${name}|`.toLowerCase();
    for (const [uid, e] of idx) {
      if (uid.startsWith(lower)) return e;
    }
    return undefined;
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [type, list] of this.types) out[type] = list.length;
    return out;
  }
}

function entityArray(files: ReadonlyMap<string, unknown>, path: string, key: string): Entity[] {
  const json = files.get(path);
  if (json === null || typeof json !== 'object') return [];
  const arr = (json as Record<string, unknown>)[key];
  if (!Array.isArray(arr)) return [];
  return arr.filter((e): e is Entity => typeof e === 'object' && e !== null);
}

const byNameSource =
  (...lists: Entity[][]) =>
  (copy: CopyRef): Entity | undefined => {
    const uid = `${String(copy.name)}|${String(copy.source)}`.toLowerCase();
    for (const list of lists) {
      const hit = list.find((e) => uidOf(e) === uid);
      if (hit) return hit;
    }
    return undefined;
  };

/** Subraces are keyed by (name, source) plus the race they attach to. */
const subraceLookup =
  (subraces: Entity[]) =>
  (copy: CopyRef): Entity | undefined => {
    const matches = subraces.filter(
      (e) =>
        String(e.name).toLowerCase() === String(copy.name).toLowerCase() &&
        String(e.source).toLowerCase() === String(copy.source).toLowerCase(),
    );
    if (matches.length <= 1) return matches[0];
    const withRace = matches.find(
      (e) =>
        copy.raceName === undefined ||
        (String(e.raceName).toLowerCase() === String(copy.raceName).toLowerCase() &&
          (copy.raceSource === undefined ||
            String(e.raceSource).toLowerCase() === String(copy.raceSource).toLowerCase())),
    );
    return withRace ?? matches[0];
  };

export function normalizeDataset(files: ReadonlyMap<string, unknown>): EntityRegistry {
  const reg = new EntityRegistry();
  const warn = (w: CopyModWarning[]) => reg.warnings.push(...w);

  // Races + subraces (copies, then version expansion on both)
  const races = entityArray(files, 'races.json', 'race');
  const subraces = entityArray(files, 'races.json', 'subrace');
  warn(resolveCopies(races, byNameSource(races), 'race'));
  warn(resolveCopies(subraces, subraceLookup(subraces), 'subrace'));
  const raceVersions = races.flatMap((r) => expandVersions(r, reg.warnings));
  const subraceVersions = subraces.flatMap((r) => expandVersions(r, reg.warnings));
  reg.addAll('race', [...races, ...raceVersions]);
  reg.addAll('subrace', [...subraces, ...subraceVersions]);

  // Flat copy-within-type entity files
  const simple: Array<[EntityType, string, string]> = [
    ['background', 'backgrounds.json', 'background'],
    ['feat', 'feats.json', 'feat'],
    ['optionalfeature', 'optionalfeatures.json', 'optionalfeature'],
    ['skill', 'skills.json', 'skill'],
    ['language', 'languages.json', 'language'],
    ['sense', 'senses.json', 'sense'],
    ['action', 'actions.json', 'action'],
    ['condition', 'conditionsdiseases.json', 'condition'],
    ['disease', 'conditionsdiseases.json', 'disease'],
    ['status', 'conditionsdiseases.json', 'status'],
    ['variantrule', 'variantrules.json', 'variantrule'],
    ['book', 'books.json', 'book'],
  ];
  for (const [type, path, key] of simple) {
    const list = entityArray(files, path, key);
    warn(resolveCopies(list, byNameSource(list), type));
    reg.addAll(type, list);
  }

  // Items: base tables + items (item copies may point at baseitems/groups)
  const baseitems = entityArray(files, 'items-base.json', 'baseitem');
  const itemProperties = entityArray(files, 'items-base.json', 'itemProperty');
  const itemTypes = entityArray(files, 'items-base.json', 'itemType');
  const items = entityArray(files, 'items.json', 'item');
  const itemGroups = entityArray(files, 'items.json', 'itemGroup');
  const magicvariants = entityArray(files, 'magicvariants.json', 'magicvariant');
  warn(resolveCopies(baseitems, byNameSource(baseitems), 'baseitem'));
  warn(resolveCopies(items, byNameSource(items, baseitems, itemGroups), 'item'));
  reg.addAll('baseitem', baseitems);
  reg.addAll('itemProperty', itemProperties);
  reg.addAll('itemType', itemTypes);
  reg.addAll('item', items);
  reg.addAll('itemGroup', itemGroups);
  reg.addAll('magicvariant', magicvariants);

  // Classes (one file per class)
  const classes: Entity[] = [];
  const subclasses: Entity[] = [];
  const classFeatures: Entity[] = [];
  const subclassFeatures: Entity[] = [];
  for (const [path] of files) {
    if (!path.startsWith('class/class-')) continue;
    classes.push(...entityArray(files, path, 'class'));
    subclasses.push(...entityArray(files, path, 'subclass'));
    classFeatures.push(...entityArray(files, path, 'classFeature'));
    subclassFeatures.push(...entityArray(files, path, 'subclassFeature'));
  }
  warn(resolveCopies(classes, byNameSource(classes), 'class'));
  warn(resolveCopies(subclasses, byNameSource(subclasses), 'subclass'));
  reg.addAll('class', classes);
  reg.addAll('subclass', subclasses);
  reg.addAll('classFeature', classFeatures);
  reg.addAll('subclassFeature', subclassFeatures);

  // Spells (one file per source)
  const spells: Entity[] = [];
  for (const [path] of files) {
    if (!path.startsWith('spells/spells-')) continue;
    spells.push(...entityArray(files, path, 'spell'));
  }
  reg.addAll('spell', spells);

  return reg;
}

/** Homebrew JSON keys are the same as official entity-array keys. */
const HOMEBREW_TYPES: EntityType[] = [
  'race',
  'subrace',
  'background',
  'feat',
  'optionalfeature',
  'item',
  'baseitem',
  'itemGroup',
  'magicvariant',
  'spell',
  'class',
  'subclass',
  'classFeature',
  'subclassFeature',
  'language',
  'condition',
  'disease',
  'status',
  'action',
  'skill',
  'sense',
  'variantrule',
];

/**
 * Merge homebrew files into a built registry. Homebrew flows through the SAME
 * copy/mod machinery — `_copy` targets may be official entities.
 */
export function mergeHomebrew(
  reg: EntityRegistry,
  homebrew: ReadonlyMap<string, Record<string, unknown>>,
): void {
  for (const [, json] of homebrew) {
    for (const type of HOMEBREW_TYPES) {
      const arr = json[type];
      if (!Array.isArray(arr)) continue;
      const entities = arr.filter((e): e is Entity => typeof e === 'object' && e !== null);
      if (entities.length === 0) continue;
      reg.warnings.push(
        ...resolveCopies(
          entities,
          byNameSource(entities, [...reg.byType(type)]),
          `homebrew ${type}`,
        ),
      );
      if (type === 'race' || type === 'subrace') {
        const versions = entities.flatMap((e) => expandVersions(e, reg.warnings));
        reg.addAll(type, [...entities, ...versions]);
      } else {
        reg.addAll(type, entities);
      }
    }
  }
}
