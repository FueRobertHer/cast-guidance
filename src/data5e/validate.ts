/**
 * What a complete, well-formed release looks like, checked before an install
 * is allowed to replace the release a device already has. Pure: no reads, no
 * writes, so the installer decides what a refusal costs.
 *
 * Deliberately stricter than the read path. `getFile` only refuses bodies that
 * are not data files at all (see `acceptDataFile`), because a cached row that
 * is merely thin still beats nothing. An install is different: the release it
 * replaces works, so anything short of a full, recognisable dataset is a
 * reason to keep it.
 */
import { ValidationError } from '@/lib/guards';
import { ESSENTIALS_FILES, ITEMS_FULL_FILES, LIBRARY_EXTRAS_FILES } from './packs';

/** A data file the installer will not accept, and why. */
export class InvalidDataFileError extends ValidationError {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`data file "${path}" failed validation: ${reason}; this app build will not install it`);
    this.name = 'InvalidDataFileError';
    this.path = path;
  }
}

/**
 * The key each static file must carry as a non-empty array: the list
 * `normalizeDataset` reads entities out of. Every one is populated in every
 * real release, so an empty one is a broken release, not a quiet one.
 */
export const FILE_SHAPES: Readonly<Record<string, string>> = {
  'races.json': 'race',
  'backgrounds.json': 'background',
  'feats.json': 'feat',
  'items-base.json': 'baseitem',
  'optionalfeatures.json': 'optionalfeature',
  'skills.json': 'skill',
  'languages.json': 'language',
  'senses.json': 'sense',
  'actions.json': 'action',
  'conditionsdiseases.json': 'condition',
  'items.json': 'item',
  'magicvariants.json': 'magicvariant',
  'variantrules.json': 'variantrule',
  'books.json': 'book',
};

const SPELL_LOOKUP = 'generated/gendata-spell-source-lookup.json';

/**
 * A file name an index may point at: one plain `.json` name inside its own
 * directory. Anything with a separator or a parent step would let an index
 * choose which keys the installer writes.
 */
const INDEXED_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIndexedFileName(value: unknown): value is string {
  return typeof value === 'string' && INDEXED_FILE.test(value) && !value.includes('..');
}

/**
 * The entries of a class or spell index whose file names are usable, in index
 * order. Lenient, for the read paths: a cached index with one bad entry still
 * resolves every good one, and one that is not an index at all resolves
 * nothing, rather than taking down every screen that asks for a pack list.
 */
export function indexEntries(index: unknown): Array<[key: string, file: string]> {
  if (!isPlainObject(index)) return [];
  return Object.entries(index).filter((e): e is [string, string] => isIndexedFileName(e[1]));
}

/**
 * Every file a class or spell index lists, as cache paths. Strict, for the
 * installer: an index that is not a non-empty object, or that names anything
 * but a plain `.json` file, is refused whole.
 */
export function indexedFiles(index: unknown, dir: 'class' | 'spells'): string[] {
  const path = `${dir}/index.json`;
  if (!isPlainObject(index)) throw new InvalidDataFileError(path, 'it is not an object');
  const values = Object.values(index);
  if (values.length === 0) throw new InvalidDataFileError(path, 'it lists no files');
  return values.map((v) => {
    if (!isIndexedFileName(v)) {
      throw new InvalidDataFileError(path, `${JSON.stringify(v)} is not a file name`);
    }
    return `${dir}/${v}`;
  });
}

/** The list key a file must carry, or undefined if it carries none. */
function shapeKeyFor(path: string): string | undefined {
  const known = FILE_SHAPES[path];
  if (known !== undefined) return known;
  if (path.startsWith('class/')) return 'class';
  if (path.startsWith('spells/')) return 'spell';
  return undefined;
}

/**
 * Throw an {@link InvalidDataFileError} unless `json` has the shape the app
 * reads out of `path`. The caller has already applied the structural limits
 * every data file gets; this is about content.
 */
export function validateDataFile(path: string, json: unknown): void {
  if (!isPlainObject(json)) throw new InvalidDataFileError(path, 'it is not an object');
  if (path === 'class/index.json') {
    indexedFiles(json, 'class');
    return;
  }
  if (path === 'spells/index.json') {
    indexedFiles(json, 'spells');
    return;
  }
  if (path === SPELL_LOOKUP) {
    if (Object.keys(json).length === 0) throw new InvalidDataFileError(path, 'it is empty');
    return;
  }
  const key = shapeKeyFor(path);
  if (key === undefined) throw new InvalidDataFileError(path, 'it is not a known data file');
  const list = json[key];
  if (!Array.isArray(list) || list.length === 0) {
    throw new InvalidDataFileError(path, `expected a non-empty "${key}" list`);
  }
}

/** Every file a complete release holds, given its two indexes. */
export function requiredFiles(classIndex: unknown, spellsIndex: unknown): string[] {
  return [
    ...ESSENTIALS_FILES,
    ...ITEMS_FULL_FILES,
    ...LIBRARY_EXTRAS_FILES,
    ...indexedFiles(classIndex, 'class'),
    ...indexedFiles(spellsIndex, 'spells'),
  ];
}

/** Throw unless every path in `required` is in `cached`. */
export function assertComplete(cached: ReadonlySet<string>, required: readonly string[]): void {
  const missing = required.filter((p) => !cached.has(p));
  if (missing.length > 0) {
    throw new ValidationError(
      `release is incomplete: ${missing.length} file(s) missing, including "${missing[0]}"`,
    );
  }
}
