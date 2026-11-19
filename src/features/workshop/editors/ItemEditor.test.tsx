// @vitest-environment jsdom
// Bug 10 of the One Workshop plan, struck: the item editor's Name box and its
// attunement checkbox, on the Workshop's own page as a player opens a new
// item, are named by the labels around them. The browser tool that reported
// them reads no name from a label around a control.
import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { namelessControls } from '../../../../tests-fixtures/a11y';
import {
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  sorcerer,
} from '../../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

/** How long a lazily loaded page may take on a loaded runner. */
const WAIT = 30_000;

describe('the item editor on its page', () => {
  it('names the Name box, the attunement checkbox and every other control', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new/item');
    expect(await screen.findByRole('textbox', { name: 'Name' }, { timeout: WAIT })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Requires attunement' })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
  });
});
