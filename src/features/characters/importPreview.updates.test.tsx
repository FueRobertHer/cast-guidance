// @vitest-environment jsdom
// The character import preview names a file that updates a collection here
// (ADR-002, D4) before anything is written.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import CharacterImportPreview from './CharacterImportPreview';
import type { CharacterPreview, EmbeddedFilePreview } from './importPreview';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(cleanup);

function show(file: Partial<EmbeddedFilePreview>) {
  const preview: CharacterPreview = {
    name: newCharacterDoc('osk', 'Osk', 'tag').name,
    classLabel: '',
    importsAsCopy: false,
    bytes: 100,
    files: [
      {
        fileName: 'ember (1).json',
        status: 'updates',
        counts: { spell: 2 },
        sourceIds: ['EMB'],
        localFiles: [],
        existingEnabled: true,
        updates: 'ember.json',
        ...file,
      },
    ],
    missingSources: [],
    notDownloadedSources: [],
    disabledSources: [],
    officialCoverage: 'complete',
    notes: [],
  };
  render(
    <CharacterImportPreview
      preview={preview}
      sourceSpellingOf={(s) => s}
      onImport={() => undefined}
      onCancel={() => undefined}
    />,
  );
  return screen.getByRole('dialog').textContent ?? '';
}

describe('a character file that updates a collection here', () => {
  it('names the file it takes the place of, and says it keeps its switch and place', () => {
    const text = show({});
    expect(text).toContain('Updates "ember.json".');
    expect(text).toContain('It keeps its switch and its place in the order.');
    expect(text).not.toContain('New.');
  });

  it('says it stays off when the file here is off, and who still wins', () => {
    const text = show({
      existingEnabled: false,
      localFiles: [{ id: 'b', fileName: 'before.json', enabled: true }],
    });
    expect(text).toContain('Updates "ember.json", turned off.');
    expect(text).toContain('it stays off until you turn it on');
    expect(text).toContain('"before.json" was imported before it, so its entries still win');
  });
});
