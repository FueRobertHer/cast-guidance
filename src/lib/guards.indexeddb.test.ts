// @vitest-environment jsdom
// ADR-002 E2: a character's collection switches survive the real export
// (Download) to text to import path, through the guards and migration, and
// still narrow the imported copy's pickers the same way.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickPolicy, policyAllows } from '@/data5e/sourceFilter';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { newCharacterDoc } from '@/engine/types';
import { exportCharacter } from '@/features/characters/characterActions';

const downloaded = vi.hoisted(() => ({ payload: undefined as unknown }));
vi.mock('@/lib/download', () => ({
  downloadJson: (_name: string, payload: unknown) => {
    downloaded.payload = payload;
  },
}));

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  downloaded.payload = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collection switches through export and import', () => {
  it('keeps both lists, and the imported copy picks as the original did', async () => {
    const osk = newCharacterDoc('osk', 'Osk', 'tag');
    osk.allowedSources = ['PHB', 'XGE'];
    osk.sourceSwitches = { on: ['KIB'], off: ['XGE'] };
    await characterRepo.put(osk);

    await exportCharacter(osk);
    const text = JSON.stringify(downloaded.payload);
    expect(text).toContain('"sourceSwitches":{"on":["KIB"],"off":["XGE"]}');

    await characterRepo.importFromText(text);
    const copies = (await characterRepo.list()).filter((c) => c.id !== 'osk');
    expect(copies).toHaveLength(1);
    const copy = copies[0];
    expect(copy?.sourceSwitches).toEqual({ on: ['KIB'], off: ['XGE'] });
    expect(copy?.allowedSources).toEqual(['PHB', 'XGE']);

    const device = { mode: 'all', except: ['KIB'] } as const;
    const picked = pickPolicy(device, copy?.allowedSources, copy?.sourceSwitches);
    expect(picked).toEqual(pickPolicy(device, osk.allowedSources, osk.sourceSwitches));
    expect(policyAllows(picked.policy, 'KIB')).toBe(true);
    expect(policyAllows(picked.policy, 'XGE')).toBe(false);
    expect(policyAllows(picked.policy, 'PHB')).toBe(true);
  });

  it('refuses an export whose switches are not lists, writing nothing', async () => {
    const doc = { ...newCharacterDoc('bad', 'Bad', 'tag'), sourceSwitches: { off: 'XGE' } };
    const text = JSON.stringify({ $format: 'cast-guidance/character@1', character: doc });
    await expect(characterRepo.importFromText(text)).rejects.toThrow(/sourceSwitches\.off/);
    expect(await db.characters.count()).toBe(0);
  });
});
