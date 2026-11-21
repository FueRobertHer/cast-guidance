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

describe('homebrewRepo.renameEntry', () => {
  /** Every ref a class lists, found as the sheet finds it (`findClassFeature`), by name. */
  const found = (json: Json): (string | undefined)[] => {
    const [c] = json.class as Json[];
    return (c?.classFeatures as unknown[]).map((item) => {
      const ref = typeof item === 'string' ? item : String((item as Json).classFeature);
      const [name, className, classSource, level] = ref.split('|');
      const f = (json.classFeature as Json[]).find(
        (x) =>
          String(x.name).toLowerCase() === name?.toLowerCase() &&
          String(x.className).toLowerCase() === className?.toLowerCase() &&
          String(x.classSource).toLowerCase() === (classSource || 'PHB').toLowerCase() &&
          x.level === Number(level),
      );
      return f === undefined ? undefined : String(f.name);
    });
  };

  it('renames a class with its own features, the refs to them and its subclasses', async () => {
    const ref = (n: string, level: number, c = 'Warden') =>
      `${n}|${c}|${WORKSHOP_SOURCE}|${level}|${WORKSHOP_SOURCE}`;
    const held = {
      ...feature('Focus', 2),
      entries: ['Hold steady.', { type: 'refClassFeature', classFeature: ref('Flurry', 2) }],
    };
    const { fileId } = await homebrewRepo.saveEntry(
      'class',
      { ...cls('Warden'), classFeatures: [ref('Vigil', 1), { classFeature: ref('Focus', 2) }] },
      { owned: [feature('Vigil', 1), held, feature('Flurry', 2)] },
    );
    const vow = `Vow|Warden|${WORKSHOP_SOURCE}|Oath|${WORKSHOP_SOURCE}|3`;
    await homebrewRepo.saveEntry('subclass', order('Oath'), {
      fileId,
      owned: [
        {
          ...orderFeature('Oath'),
          entries: ['Stand.', { type: 'refSubclassFeature', subclassFeature: vow }],
        },
        { ...orderFeature('Oath'), name: 'Vow' },
      ],
    });
    await homebrewRepo.saveEntry('class', cls('Other'), {
      fileId,
      owned: [feature('Trail', 1, 'Other')],
    });

    await homebrewRepo.renameEntry(
      fileId,
      'class',
      { name: 'Warden', source: WORKSHOP_SOURCE },
      'Keeper',
    );

    const json = await stored(fileId);
    expect(names(json.class)).toEqual(['Keeper', 'Other']);
    expect(found(json)).toEqual(['Vigil', 'Focus']);
    const features = json.classFeature as Json[];
    expect(features.map((f) => `${String(f.name)}:${String(f.className)}`).sort()).toEqual([
      'Flurry:Keeper',
      'Focus:Keeper',
      'Trail:Other',
      'Vigil:Keeper',
    ]);
    const focus = features.find((f) => f.name === 'Focus');
    expect((focus?.entries as unknown[])[1]).toEqual({
      type: 'refClassFeature',
      classFeature: ref('Flurry', 2, 'Keeper'),
    });
    const [sub] = json.subclass as Json[];
    expect(sub?.className).toBe('Keeper');
    const [oath] = json.subclassFeature as Json[];
    expect(oath?.className).toBe('Keeper');
    // What its text holds is found by the class's new name too.
    expect((oath?.entries as unknown[])[1]).toEqual({
      type: 'refSubclassFeature',
      subclassFeature: vow.replace('|Warden|', '|Keeper|'),
    });
  });

  it('renames a subclass and keeps its features, which find it by its short name', async () => {
    const { fileId } = await homebrewRepo.saveEntry('class', cls('Warden'));
    await homebrewRepo.saveEntry('subclass', order('Oath'), {
      fileId,
      owned: [orderFeature('Oath')],
    });
    await homebrewRepo.renameEntry(
      fileId,
      'subclass',
      { name: 'Oath', source: WORKSHOP_SOURCE },
      'Oath of Ash',
    );
    const json = await stored(fileId);
    const [sub] = json.subclass as Json[];
    expect(sub).toMatchObject({ name: 'Oath of Ash', shortName: 'Oath' });
    expect(names(json.subclassFeature)).toEqual(['Oath']);
  });

  it('refuses an entry that is no longer in the file', async () => {
    const { fileId } = await homebrewRepo.saveEntry('class', cls('Warden'));
    await expect(
      homebrewRepo.renameEntry(fileId, 'class', { name: 'Gone', source: WORKSHOP_SOURCE }, 'X'),
    ).rejects.toThrow('Gone is no longer in');
  });
});
