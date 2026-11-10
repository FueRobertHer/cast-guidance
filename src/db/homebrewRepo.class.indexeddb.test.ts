// A class saved with its own features, as one write, and its subclasses kept
// with it when it is renamed (Homebrew Workshop phase 9).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { homebrewRepo, ownsEntries, WORKSHOP_SOURCE } from './homebrewRepo';

type Json = Record<string, unknown>;

const cls = (name: string) => ({ name, source: WORKSHOP_SOURCE, hd: { number: 1, faces: 10 } });
const feature = (name: string, level: number, className = 'Warden'): Json => ({
  name,
  source: WORKSHOP_SOURCE,
  className,
  classSource: WORKSHOP_SOURCE,
  level,
  entries: [`${name} helps.`],
});
const order = (name: string, className = 'Warden') => ({
  name,
  shortName: name,
  source: WORKSHOP_SOURCE,
  className,
  classSource: WORKSHOP_SOURCE,
  subclassFeatures: [`${name}|${className}|${WORKSHOP_SOURCE}|${name}|${WORKSHOP_SOURCE}|3`],
});
const orderFeature = (name: string, className = 'Warden'): Json => ({
  name,
  source: WORKSHOP_SOURCE,
  className,
  classSource: WORKSHOP_SOURCE,
  subclassShortName: name,
  subclassSource: WORKSHOP_SOURCE,
  level: 3,
  entries: ['Stand watch.'],
});

async function stored(fileId: string) {
  const file = (await homebrewRepo.ownedSafe()).files.find((f) => f.id === fileId);
  return file?.json ?? {};
}
const names = (list: unknown) => (list as Json[]).map((e) => e.name);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('homebrewRepo.saveEntry with a class', () => {
  it('owns its features: saved with it, replaced on the next save, gone with it', async () => {
    expect(ownsEntries('class')).toBe(true);
    const { fileId } = await homebrewRepo.saveEntry('class', cls('Warden'), {
      owned: [feature("Warden's Vigil", 1), feature('Watchful Step', 2)],
    });
    await homebrewRepo.saveEntry('class', cls('Ranger Two'), {
      fileId,
      owned: [feature('Trail', 1, 'Ranger Two')],
    });
    await homebrewRepo.saveEntry('class', cls('Warden'), {
      fileId,
      replaces: { name: 'Warden', source: WORKSHOP_SOURCE },
      owned: [feature('Watchful Step', 2)],
    });
    expect(names((await stored(fileId)).classFeature)).toEqual(['Trail', 'Watchful Step']);
    await homebrewRepo.removeEntry(fileId, 'class', { name: 'Warden', source: WORKSHOP_SOURCE });
    const json = await stored(fileId);
    expect(names(json.class)).toEqual(['Ranger Two']);
    expect(names(json.classFeature)).toEqual(['Trail']);
  });

  it('refuses two of its features at one level with one name', async () => {
    await expect(
      homebrewRepo.saveEntry('class', cls('Warden'), {
        owned: [feature('Vigil', 1), feature('vigil', 1)],
      }),
    ).rejects.toThrow('two of its features at one level are called vigil');
  });

  it('takes the file’s subclasses of it along when it is renamed, and leaves others alone', async () => {
    const { fileId } = await homebrewRepo.saveEntry('class', cls('Warden'), {
      owned: [feature('Vigil', 1)],
    });
    await homebrewRepo.saveEntry('subclass', order('Lantern Order'), {
      fileId,
      owned: [orderFeature('Lantern Order')],
    });
    await homebrewRepo.saveEntry('subclass', order('Oath of Embers', 'Paladin'), {
      fileId,
      owned: [orderFeature('Oath of Embers', 'Paladin')],
    });
    await homebrewRepo.saveEntry('class', cls('Sentinel'), {
      fileId,
      replaces: { name: 'Warden', source: WORKSHOP_SOURCE },
      owned: [feature('Vigil', 1, 'Sentinel')],
    });
    const json = await stored(fileId);
    const [lantern, embers] = json.subclass as Json[];
    expect(lantern).toMatchObject({
      className: 'Sentinel',
      subclassFeatures: [
        `Lantern Order|Sentinel|${WORKSHOP_SOURCE}|Lantern Order|${WORKSHOP_SOURCE}|3`,
      ],
    });
    expect(embers?.className).toBe('Paladin');
    expect((json.subclassFeature as Json[]).map((f) => f.className)).toEqual([
      'Sentinel',
      'Paladin',
    ]);
    // A subclass's own save still finds its features under the new name.
    await homebrewRepo.saveEntry('subclass', { ...lantern, name: 'Lantern Order' } as never, {
      fileId,
      replaces: { name: 'Lantern Order', source: WORKSHOP_SOURCE },
      owned: [orderFeature('Lantern Order', 'Sentinel')],
    });
    expect(((await stored(fileId)).subclassFeature as Json[]).length).toBe(2);
  });
});
