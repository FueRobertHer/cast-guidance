import { describe, expect, it } from 'vitest';
import { VALID_BODIES, VALID_PATHS } from '../../tests-fixtures/dataMirror';
import {
  assertComplete,
  indexEntries,
  indexedFiles,
  requiredFiles,
  validateDataFile,
} from './validate';

describe('indexedFiles (install)', () => {
  it('lists every file an index names, under its directory', () => {
    expect(
      indexedFiles({ Fighter: 'class-fighter.json', Wizard: 'class-wizard.json' }, 'class'),
    ).toEqual(['class/class-fighter.json', 'class/class-wizard.json']);
  });

  it.each([
    ['a string', 'abc'],
    ['an array', ['class-fighter.json']],
    ['an empty object', {}],
    ['a number for a file', { Fighter: 3 }],
    ['a path that leaves the directory', { Evil: '../x.json' }],
    ['a nested path', { Evil: 'sub/x.json' }],
    ['a double dot inside a name', { Evil: 'a..json' }],
    ['a name that is not json', { Evil: 'class-fighter.js' }],
  ])('refuses %s whole', (_name, index) => {
    expect(() => indexedFiles(index, 'class')).toThrow('failed validation');
  });
});

describe('indexEntries (reading)', () => {
  it('keeps the good entries of an index with bad ones in it', () => {
    expect(indexEntries({ Fighter: 'class-fighter.json', Evil: '../x.json', Odd: 3 })).toEqual([
      ['Fighter', 'class-fighter.json'],
    ]);
  });

  it('reads anything that is not an index as an empty one', () => {
    expect(indexEntries('abc')).toEqual([]);
    expect(indexEntries(null)).toEqual([]);
    expect(indexEntries(['class-fighter.json'])).toEqual([]);
  });
});

describe('validateDataFile', () => {
  it('accepts every file of a valid release', () => {
    for (const path of VALID_PATHS) {
      expect(() => validateDataFile(path, VALID_BODIES[path])).not.toThrow();
    }
  });

  it.each([
    ['races.json', { race: [] }],
    ['races.json', { subrace: [{ name: 'High' }] }],
    ['items.json', { item: 'not a list' }],
    ['class/class-fighter.json', {}],
    ['spells/spells-phb.json', { spell: [] }],
    ['generated/gendata-spell-source-lookup.json', {}],
    ['books.json', [{ book: [] }]],
    ['unknown.json', { thing: [1] }],
  ])('refuses %s shaped %j', (path, json) => {
    expect(() => validateDataFile(path, json)).toThrow(`data file "${path}" failed validation`);
  });
});

describe('completeness', () => {
  it('requires the static files and every file both indexes name', () => {
    const required = requiredFiles(
      VALID_BODIES['class/index.json'],
      VALID_BODIES['spells/index.json'],
    );
    expect(new Set(required)).toEqual(new Set(VALID_PATHS));
  });

  it('names a missing file', () => {
    const cached = new Set(VALID_PATHS.filter((p) => p !== 'books.json'));
    expect(() => assertComplete(cached, VALID_PATHS)).toThrow('"books.json"');
    expect(() => assertComplete(new Set(VALID_PATHS), VALID_PATHS)).not.toThrow();
  });
});
