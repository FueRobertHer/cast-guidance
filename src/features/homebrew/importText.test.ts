// The step file and URL imports share: JSON as it is, another app's XML through
// a converter checked against the game data, and a converted file with nothing
// to add refused with the reason. The registry is a small stand-in holding the
// official entries below, sealed as the real build seals it before homebrew.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registry } = vi.hoisted(() => ({ registry: { fail: false } }));

vi.mock('@/data5e/registry', async () => {
  const { EntityRegistry } = await import('@/data5e/normalize');
  return {
    getRegistry: async () => {
      if (registry.fail) throw new Error('no game data');
      const reg = new EntityRegistry();
      reg.addAll('spell', [
        { name: 'Fire Bolt', source: 'PHB', level: 0 },
        { name: 'Frost Ray', source: 'XPHB', level: 0 },
      ]);
      reg.addAll('baseitem', [{ name: 'Longsword', source: 'PHB' }]);
      reg.sealOfficial();
      // Homebrew merged after the seal is not game data.
      reg.addAll('spell', [{ name: 'Ember Lance', source: 'HB', level: 1 }]);
      return reg;
    },
  };
});

import { ResponseTooLargeError } from '@/lib/boundedRead';
import { IMPORT_LIMITS } from '@/lib/guards';
import { dataStatusStore } from '@/stores/dataStatus';
import { InlineImportWorker } from '../../../tests-fixtures/importWorker';
import {
  ImportCancelledError,
  NothingToImportError,
  parseImportFile,
  parseImportText,
} from './importText';

vi.stubGlobal('Worker', InlineImportWorker);

beforeEach(() => {
  registry.fail = false;
  dataStatusStore.getState().setPhase('done');
});

const spell = (name: string, extra = '') =>
  `<spell><name>${name}</name><level>0</level><school>EV</school><time>1 action</time>
    <range>60 feet</range><components>V</components><duration>Instantaneous</duration>
    <text>A spark.</text>${extra}</spell>`;

describe('parseImportText', () => {
  it('parses JSON as it is, with no conversion', async () => {
    const parsed = await parseImportText('{"_meta":{"sources":[]}}', 'brew.json');
    expect(parsed).toEqual({ raw: { _meta: { sources: [] } } });
  });

  it('throws the JSON parser error for text that is neither', async () => {
    await expect(parseImportText('{ not json', 'brew.json')).rejects.toBeInstanceOf(SyntaxError);
  });

  it('decides by the text, not the file name', async () => {
    const parsed = await parseImportText(
      `﻿  <compendium>${spell('Ember Lance')}</compendium>`,
      'download',
    );
    expect(parsed.conversion?.converted).toEqual({ spell: 1 });
    expect((parsed.raw as { spell: { name: string }[] }).spell[0]?.name).toBe('Ember Lance');
  });

  it('leaves out what the game data has, by name and edition, and only official entries', async () => {
    const parsed = await parseImportText(
      `<compendium>${spell('Fire Bolt')}${spell('Frost Ray')}${spell('Frost Ray [2024]')}${spell('Ember Lance')}</compendium>`,
      'mixed.xml',
    );
    const report = parsed.conversion;
    // Fire Bolt (2014) and the 2024 Frost Ray are installed; the 2014 Frost Ray
    // is not, and Ember Lance is only homebrew.
    expect(report?.notes.filter((n) => n.status === 'installed').map((n) => n.name)).toEqual([
      'Fire Bolt',
      'Frost Ray',
    ]);
    expect((parsed.raw as { spell: { name: string }[] }).spell.map((s) => s.name)).toEqual([
      'Frost Ray',
      'Ember Lance',
    ]);
    expect(report?.warnings).toEqual([]);
  });

  it('checks items against base items too', async () => {
    const parsed = await parseImportText(
      `<compendium>
        <item><name>Longsword</name><type>M</type><dmg1>1d8</dmg1><dmgType>S</dmgType></item>
        <item><name>Ember Blade</name><type>M</type><dmg1>1d8</dmg1><dmgType>S</dmgType></item>
      </compendium>`,
      'blades.xml',
    );
    expect((parsed.raw as { item: { name: string }[] }).item.map((i) => i.name)).toEqual([
      'Ember Blade',
    ]);
  });

  it('says when game data is still downloading', async () => {
    dataStatusStore.getState().setPhase('working');
    const parsed = await parseImportText(
      `<compendium>${spell('Ember Lance')}</compendium>`,
      'a.xml',
    );
    expect(parsed.conversion?.warnings).toEqual([
      'Not all game data is on this device yet, so entries it does not have yet were converted as well.',
    ]);
  });

  it('converts everything when game data cannot be read, and says so', async () => {
    registry.fail = true;
    const parsed = await parseImportText(`<compendium>${spell('Fire Bolt')}</compendium>`, 'a.xml');
    expect(parsed.conversion?.converted).toEqual({ spell: 1 });
    expect(parsed.conversion?.warnings).toEqual([
      'Game data could not be read, so entries it already has were converted as well.',
    ]);
  });
});

describe('NothingToImportError', () => {
  const nothing = async (xml: string) => {
    try {
      await parseImportText(xml, 'x.xml');
    } catch (err) {
      if (err instanceof NothingToImportError) return err;
      throw err;
    }
    throw new Error('expected nothing to import');
  };

  it('is not a failure when every entry is already installed', async () => {
    const err = await nothing(`<compendium>${spell('Fire Bolt')}</compendium>`);
    expect(err.allInstalled).toBe(true);
    expect(err.message).toBe(
      'Every entry in this Fight Club 5e file is already in your game data, so there is nothing to add.',
    );
  });

  it('gives the reasons when nothing could be converted', async () => {
    const err = await nothing(
      `<compendium>${spell('Fire Bolt')}<class><name>Ember Knight</name></class><monster><name>Ash Wolf</name></monster></compendium>`,
    );
    expect(err.allInstalled).toBe(false);
    expect(err.message).toBe(
      'Nothing in this Fight Club 5e file could be converted. 1 is already in your game data. 1 class left out: classes cannot be converted yet. 1 monster left out: this app does not use creatures.',
    );
  });

  it('names a broken entry when that is all there is', async () => {
    const err = await nothing('<compendium><spell><level>1</level></spell></compendium>');
    expect(err.allInstalled).toBe(false);
    expect(err.message).toMatch(
      /^Nothing in this Fight Club 5e file could be converted\. .+ was left out: /,
    );
  });

  it('is an empty file with no entries at all', async () => {
    const err = await nothing('<compendium/>');
    expect(err.allInstalled).toBe(false);
    expect(err.message).toBe('Nothing in this Fight Club 5e file could be converted.');
  });
});

describe('coverage while game data is incomplete', () => {
  it('is not a failure when every entry is installed, even mid-download', async () => {
    dataStatusStore.getState().setPhase('working');
    await expect(
      parseImportText(`<compendium>${spell('Fire Bolt')}</compendium>`, 'a.xml'),
    ).rejects.toMatchObject({ allInstalled: true });
  });
});

describe('parseImportFile', () => {
  /** A file of `size` bytes that begins with `head`, nothing past the head ever read. */
  const sized = (head: string, size: number) =>
    ({
      name: 'big',
      size,
      slice: () => new Blob([head]),
      text: () => Promise.reject(new Error('read whole')),
      stream: () => {
        throw new Error('streamed');
      },
    }) as unknown as File;

  it('reads a JSON file whole, and converts an XML one on the worker', async () => {
    const json = new File(['{"_meta":{"sources":[]}}'], 'brew.json');
    expect(await parseImportFile(json)).toEqual({ raw: { _meta: { sources: [] } } });

    const started = InlineImportWorker.started.length;
    const xml = new File([`﻿\n<compendium>${spell('Ember Lance')}</compendium>`], 'embers');
    const parsed = await parseImportFile(xml);
    expect(parsed.conversion?.converted).toEqual({ spell: 1 });
    expect(InlineImportWorker.started.length).toBe(started + 1);
  });

  it('takes an XML file past the JSON limit, and refuses one past its own unread', async () => {
    const padding = ' '.repeat(IMPORT_LIMITS.maxImportBytes);
    const big = new File([`<compendium>${padding}${spell('Ember Lance')}</compendium>`], 'big.xml');
    expect((await parseImportFile(big)).conversion?.converted).toEqual({ spell: 1 });

    const started = InlineImportWorker.started.length;
    const over = sized('<compendium>', IMPORT_LIMITS.maxXmlImportBytes + 1);
    await expect(parseImportFile(over)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(InlineImportWorker.started.length).toBe(started);
  });

  it('keeps the JSON limit for JSON', async () => {
    const over = sized('{"_meta":', IMPORT_LIMITS.maxImportBytes + 1);
    await expect(parseImportFile(over)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('stops when cancelled, before or during the conversion', async () => {
    const xml = new File([`<compendium>${spell('Ember Lance')}</compendium>`], 'a.xml');
    const before = new AbortController();
    before.abort();
    await expect(parseImportFile(xml, { signal: before.signal })).rejects.toBeInstanceOf(
      ImportCancelledError,
    );

    // A worker that never answers, cancelled while it works.
    const silent: { terminated: boolean }[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        terminated = false;
        constructor() {
          silent.push(this);
        }
        postMessage() {}
        terminate() {
          this.terminated = true;
        }
      },
    );
    try {
      const during = new AbortController();
      const parsed = parseImportFile(xml, { signal: during.signal });
      await vi.waitFor(() => expect(silent).toHaveLength(1));
      during.abort();
      await expect(parsed).rejects.toBeInstanceOf(ImportCancelledError);
      expect(silent[0]?.terminated).toBe(true);
    } finally {
      vi.stubGlobal('Worker', InlineImportWorker);
    }
  });

  it('says a converter that stopped most likely ran out of memory', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        onerror: ((ev: { preventDefault(): void }) => void) | null = null;
        postMessage() {
          setTimeout(() => this.onerror?.({ preventDefault: () => undefined }));
        }
        terminate() {}
      },
    );
    try {
      const xml = new File([`<compendium>${spell('Ember Lance')}</compendium>`], 'a.xml');
      await expect(parseImportFile(xml)).rejects.toThrow(/ran out of memory/);
    } finally {
      vi.stubGlobal('Worker', InlineImportWorker);
    }
  });

  it('says how far the conversion has read, across both of its reads', async () => {
    const padding = ' '.repeat(3 * 1024 * 1024);
    const text = `<compendium>${padding}${spell('Ember Lance')}</compendium>`;
    const seen: [number, number][] = [];
    await parseImportText(text, 'a.xml', { onProgress: (done, total) => seen.push([done, total]) });
    expect(seen.length).toBeGreaterThanOrEqual(6);
    expect(seen.every(([, total]) => total === text.length * 2)).toBe(true);
    const done = seen.map(([d]) => d);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(done.at(-1)).toBeLessThanOrEqual(text.length * 2);
  });

  it('reports the converter`s own refusal by name and message', async () => {
    await expect(
      parseImportFile(new File(['<elements><element/></elements>'], 'aurora.xml')),
    ).rejects.toMatchObject({ name: 'UnsupportedFormatError' });
  });
});
