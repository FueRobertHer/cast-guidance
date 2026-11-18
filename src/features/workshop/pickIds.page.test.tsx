// @vitest-environment jsdom
// The Workshop page tells an entry's Pick cards the versions of it the editor
// knows (rule pack port 4g): a pick added where one was taken out takes an id
// of its own, whether the one taken out was in the entry as it opened or as
// last saved, so answers saved for the old one are never read as the new one's.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homebrewRepo } from '@/db/homebrewRepo';
import { isRecord } from '@/engine/castGuidance';
import {
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  sorcerer,
} from '../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

/** How long a lazily loaded page or an IndexedDB write may take on a loaded runner. */
const WAIT = 30_000;

const SKILL = { kind: 'skillProf', skill: '{pick}', level: 1 };

/** The ids of the picks the saved Gift holds. */
async function savedIds(fileId: string): Promise<unknown[]> {
  const { file } = await homebrewRepo.getSafe(fileId);
  const feats = Array.isArray(file?.json.feat) ? file.json.feat : [];
  const gift = feats.find((f) => isRecord(f) && f.name === 'Gift');
  const guidance = isRecord(gift) && isRecord(gift.castGuidance) ? gift.castGuidance : {};
  const effects = Array.isArray(guidance.effects) ? guidance.effects : [];
  return effects
    .filter((e) => isRecord(e) && e.kind === 'pick')
    .map((e) => (e as { id: unknown }).id);
}

describe('a pick added where one was taken out, on the Workshop page', () => {
  it('takes an id the entry had neither as it opened nor as last saved', async () => {
    const row = await homebrewRepo.createEditable('My Brews', 'HBX');
    await homebrewRepo.saveEditable(row.id, {
      ...(row.json as Record<string, unknown>),
      feat: [
        {
          name: 'Gift',
          source: 'HBX',
          entries: ['A gift.'],
          castGuidance: {
            v: 1,
            effects: [{ kind: 'pick', id: 'choice', ask: 'skill', gives: [SKILL] }],
          },
        },
      ],
    });
    const sheet = await renderSheet(sorcerer());
    await sheet.visit(`/homebrew/edit/${row.id}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Edit Gift' }, { timeout: WAIT }));
    /** Take the pick out, add a new one, and save. */
    const replace = async (ids: string[]) => {
      fireEvent.click(
        await screen.findByRole('button', { name: 'Remove Asks for a skill' }, { timeout: WAIT }),
      );
      // The effect cards' More, not the page header's menu of the same name.
      const more = screen
        .getAllByRole('button', { name: 'More' })
        .find((b) => !b.hasAttribute('aria-label'));
      if (more === undefined) throw new Error('no More beside the effect cards');
      fireEvent.click(more);
      fireEvent.click(await screen.findByRole('button', { name: 'Pick' }));
      await screen.findByLabelText('Pick: Asks for');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(async () => expect(await savedIds(row.id)).toEqual(ids), { timeout: WAIT });
    };
    // Taken out of the entry as it opened.
    await replace(['choice-2']);
    // Taken out of the entry as last saved.
    await replace(['choice-3']);
  });
});
