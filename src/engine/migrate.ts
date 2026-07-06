import { CHARACTER_SCHEMA_VERSION, type CharacterDoc } from './types';

/** Ordered migrations; index N migrates schemaVersion N -> N+1. */
const MIGRATIONS: Array<(doc: Record<string, unknown>) => Record<string, unknown>> = [
  // v1 is current — future steps append here.
];

export class MigrationError extends Error {}

/** Run on every load and import. Throws only if the doc is beyond this app. */
export function migrateCharacter(raw: unknown): CharacterDoc {
  if (raw === null || typeof raw !== 'object') {
    throw new MigrationError('not a character document');
  }
  let doc = raw as Record<string, unknown>;
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;
  if (version > CHARACTER_SCHEMA_VERSION) {
    throw new MigrationError(
      `character schema v${version} is newer than this app supports (v${CHARACTER_SCHEMA_VERSION})`,
    );
  }
  for (let v = version; v < CHARACTER_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v - 1];
    if (step === undefined) throw new MigrationError(`missing migration from v${v}`);
    doc = step(doc);
    doc.schemaVersion = v + 1;
  }
  return doc as unknown as CharacterDoc;
}
