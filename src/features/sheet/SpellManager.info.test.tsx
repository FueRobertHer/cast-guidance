// @vitest-environment jsdom
// A spell's name on the Spells tab opens its rules text in place, the same
// sheet the Play tab uses, rather than leaving the character for the Library.
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('a spell on the Spells tab', () => {
  it('opens its rules text in place and stays on the tab', async () => {
    const doc = sorcerer(1);
    doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
    const sheet = await renderSheet(doc, {
      path: 'spells',
      lists: { 'Guidance|TST': ['Sorcerer'] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Guidance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Guidance' });
    expect(await within(dialog).findByText('+1d4 to a check.')).toBeTruthy();
    expect(within(dialog).getByText('Sorcerer spell')).toBeTruthy();
    expect(sheet.router.state.location.pathname).toBe(`/c/${doc.id}/spells`);
  });
});
