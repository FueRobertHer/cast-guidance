// A pick-one feature's choice lives in `doc.choices` like every other pick, so
// it must travel and be cleared the way they are: through an export, and with
// the class or subclass that raised it.
import { describe, expect, it } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { migrateCharacter } from '@/engine/migrate';
import { makePickOneContext, pickOneDoc } from '../../tests-fixtures/pickOneWorld';
import { assertCharacterExport, CHARACTER_EXPORT_FORMAT } from './guards';
import { pruneChoicesFor, pruneClass } from './pruneChoices';

const ctx = makePickOneContext();
const CLERIC = { name: 'Cleric', source: 'XPHB' };
const BLESSED = 'class:cleric|xphb:feature:blessed strikes:7';

describe('a feature pick in an export', () => {
  it('survives the round trip and still grants its branch', () => {
    const doc = pickOneDoc(CLERIC, 7, { choices: { [BLESSED]: ['divine strike'] } });
    // What `exportCharacter` writes and the importer reads back.
    const text = JSON.stringify({ $format: CHARACTER_EXPORT_FORMAT, character: doc, homebrew: [] });
    const imported = migrateCharacter(assertCharacterExport(JSON.parse(text)).character);

    expect(imported.choices[BLESSED]).toEqual(['divine strike']);
    const sheet = deriveSheet(imported, ctx);
    expect(sheet.features.map((f) => f.name)).toContain('Divine Strike');
    expect(sheet.pending.some((p) => p.id === BLESSED)).toBe(false);
  });
});

describe('a feature pick and its origin', () => {
  it('goes with its class', () => {
    const doc = pickOneDoc(CLERIC, 7, { choices: { [BLESSED]: ['divine strike'] } });
    const entry = doc.classes[0];
    if (entry === undefined) throw new Error('no class');
    doc.classes = [];
    expect(pruneClass(doc, entry)).toEqual([BLESSED]);
  });

  it('goes with its subclass when the subclass is swapped', () => {
    const hunter = { name: 'Hunter', source: 'PHB' };
    const doc = pickOneDoc({ name: 'Ranger', source: 'PHB' }, 3, { subclass: hunter });
    const prompt = deriveSheet(doc, ctx).pending.find((p) => p.kind === 'feature');
    expect(prompt?.id).toBe("subclass:hunter|phb:feature:hunter's prey:3");
    doc.choices[prompt?.id ?? ''] = ['giant killer'];
    expect(pruneChoicesFor(doc, 'subclass', hunter)).toEqual([prompt?.id]);
  });
});
