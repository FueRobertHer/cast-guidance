// A subclass saved with its own features, as one write (Homebrew Workshop phase 6).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { homebrewRepo, ownsEntries, WORKSHOP_SOURCE } from './homebrewRepo';

type Json = Record<string, unknown>;

const sub = (name: string, shortName = 'Devotion', extra: Json = {}) => ({
  name,
  source: WORKSHOP_SOURCE,
  className: 'Paladin',
  classSource: 'XPHB',
  shortName,
  ...extra,
});
const feature = (name: string, level: number, shortName = 'Devotion'): Json => ({
  name,
  source: WORKSHOP_SOURCE,
  className: 'Paladin',
  classSource: 'XPHB',
  subclassShortName: shortName,
  subclassSource: WORKSHOP_SOURCE,
  level,
  entries: [`${name} helps.`],
});

async function stored(fileId: string) {
  const file = (await homebrewRepo.ownedSafe()).files.find((f) => f.id === fileId);
  return file?.json ?? {};
}
const names = (list: unknown) => (list as Json[]).map((e) => e.name);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('homebrewRepo.saveEntry with owned features', () => {
  it('says which types own others', () => {
    expect(ownsEntries('subclass')).toBe(true);
    expect(ownsEntries('feat')).toBe(false);
  });

  it('saves a subclass and its features in one write, and replaces them on the next', async () => {
    const lantern = sub('Oath of the Lantern');
    const { fileId, created } = await homebrewRepo.saveEntry('subclass', lantern, {
      owned: [feature('Aura of the Lantern', 7), feature("Lantern's Reach", 3)],
    });
    expect(created).toBe(true);
    let json = await stored(fileId);
    expect(names(json.subclass)).toEqual(['Oath of the Lantern']);
    expect(names(json.subclassFeature)).toEqual(['Aura of the Lantern', "Lantern's Reach"]);

    // Renamed, with one feature dropped: the old features go, the new ones come.
    await homebrewRepo.saveEntry('subclass', sub('Oath of the Lamp'), {
      fileId,
      replaces: { name: 'Oath of the Lantern', source: WORKSHOP_SOURCE },
      owned: [feature("Lantern's Reach", 3)],
    });
    json = await stored(fileId);
    expect(names(json.subclass)).toEqual(['Oath of the Lamp']);
    expect(names(json.subclassFeature)).toEqual(["Lantern's Reach"]);
  });

  it("leaves another subclass's features alone", async () => {
    const { fileId } = await homebrewRepo.saveEntry('subclass', sub('Oath of Embers', 'Embers'), {
      owned: [feature('Ember Aura', 7, 'Embers')],
    });
    await homebrewRepo.saveEntry('subclass', sub('Oath of the Lantern'), {
      fileId,
      owned: [feature('Aura of the Lantern', 7)],
    });
    await homebrewRepo.saveEntry('subclass', sub('Oath of the Lantern'), {
      fileId,
      replaces: { name: 'Oath of the Lantern', source: WORKSHOP_SOURCE },
      owned: [],
    });
    expect(names((await stored(fileId)).subclassFeature)).toEqual(['Ember Aura']);
  });

  it('refuses a subclass whose features could not be told from another one, and two alike', async () => {
    const { fileId } = await homebrewRepo.saveEntry('subclass', sub('Oath of the Lantern'), {
      owned: [feature('Aura of the Lantern', 7)],
    });
    await expect(
      homebrewRepo.saveEntry('subclass', sub('Oath of the Torch'), { fileId, owned: [] }),
    ).rejects.toThrow('has its short name');
    await expect(
      homebrewRepo.saveEntry('subclass', sub('Oath of the Torch', 'Torch'), {
        fileId,
        owned: [feature('Torch', 3, 'Torch'), feature('TORCH', 3, 'Torch')],
      }),
    ).rejects.toThrow('two of its features at one level are called TORCH');
    const json = await stored(fileId);
    expect(names(json.subclass)).toEqual(['Oath of the Lantern']);
    expect(names(json.subclassFeature)).toEqual(['Aura of the Lantern']);
  });

  it('refuses owned entries for a type that owns none', async () => {
    await expect(
      homebrewRepo.saveEntry('feat', { name: 'Steady', source: WORKSHOP_SOURCE }, { owned: [] }),
    ).rejects.toThrow('owns no other entries');
  });
});

describe('homebrewRepo.removeEntry with owned features', () => {
  it('takes the features out with their subclass', async () => {
    const { fileId } = await homebrewRepo.saveEntry('subclass', sub('Oath of Embers', 'Embers'), {
      owned: [feature('Ember Aura', 7, 'Embers')],
    });
    await homebrewRepo.saveEntry('subclass', sub('Oath of the Lantern'), {
      fileId,
      owned: [feature('Aura of the Lantern', 7)],
    });
    await homebrewRepo.removeEntry(fileId, 'subclass', {
      name: 'Oath of the Lantern',
      source: WORKSHOP_SOURCE,
    });
    const json = await stored(fileId);
    expect(names(json.subclass)).toEqual(['Oath of Embers']);
    expect(names(json.subclassFeature)).toEqual(['Ember Aura']);
  });
});
