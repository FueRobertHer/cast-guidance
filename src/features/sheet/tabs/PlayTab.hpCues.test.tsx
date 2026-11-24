// @vitest-environment jsdom
// The HP card's cues on the real card: its controls reach the parts the cues
// move (HpCues.tsx), and the number is red while dying. jsdom has no Web
// Animations, so `animate` is stubbed; what each change plays is HpCues.test.tsx's.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rollLogStore } from '@/stores/rollLog';
import {
  classEntry,
  HARNESS_TIMEOUT,
  hp,
  renderSheet,
  resetSheetHarness,
  testCharacter,
} from '../../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

beforeEach(() => {
  localStorage.clear();
  rollLogStore.getState().clear();
  Element.prototype.animate = vi.fn(
    () => ({ cancel: vi.fn(), playState: 'running' }) as unknown as Animation,
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).animate;
  await resetSheetHarness();
});

function warrior(currentHp: number, tempHp = 0) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { con: 14 });
  doc.play.currentHp = currentHp;
  doc.play.tempHp = tempHp;
  doc.play.hpInitialized = true;
  return doc;
}

const part = (name: string) => document.querySelector(`[data-hp-cue="${name}"]`);

describe('the HP card’s cues', () => {
  it('tallies taps on the card beside the number, and soaks in cyan beside the Temp chip', async () => {
    await renderSheet(warrior(19, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Damage 5 hit points' }));
    await waitFor(() => expect(hp()).toMatchObject({ current: 17, temp: 0 }));
    expect(part('tally-ward')?.textContent).toBe('−3');
    expect(part('tally-damage')?.textContent).toBe('−2');

    fireEvent.click(screen.getByRole('button', { name: 'Heal 1 hit point' }));
    await waitFor(() => expect(hp().current).toBe(18));
    expect(part('tally-heal')?.textContent).toBe('+1');
  });

  it('keeps the cue layers out of what the card’s controls are called', async () => {
    await renderSheet(warrior(19, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Damage 5 hit points' }));
    await waitFor(() => expect(hp().temp).toBe(0));
    expect(screen.getByRole('button', { name: 'Temp HP' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^17 \/ \d+ hit points$/ })).toBeTruthy();
  });

  it('plays nothing while current HP still follows max HP', async () => {
    const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { con: 14 });
    doc.play.hpInitialized = false;
    await renderSheet(doc);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Damage 1 hit point' }));
    await waitFor(() => expect(part('tally-damage')?.textContent).toBe('\u22121'));
  });

  it('turns the number red while dying, and back once healed', async () => {
    await renderSheet(warrior(3));
    expect(part('number')?.className).not.toMatch(/text-danger/);
    fireEvent.click(screen.getByRole('button', { name: 'Damage 5 hit points' }));
    await waitFor(() => expect(hp().current).toBe(0));
    expect(part('number')?.className).toMatch(/text-danger/);
    fireEvent.click(screen.getByRole('button', { name: 'Heal 1 hit point' }));
    await waitFor(() => expect(hp().current).toBe(1));
    expect(part('number')?.className).not.toMatch(/text-danger/);
  });
});
