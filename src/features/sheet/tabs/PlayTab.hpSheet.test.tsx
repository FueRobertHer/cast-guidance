// @vitest-environment jsdom
// The HP sheet from the card's own controls, over the real character session
// and dialog host: damage reaches temp HP first, each way in opens the right
// mode, the confirm says what happens, and the change lands in history.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rollLogStore } from '@/stores/rollLog';
import {
  classEntry,
  dialog,
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
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetSheetHarness();
});

/** A level-3 warrior, down from full, holding some temp HP. */
function warrior(currentHp: number, tempHp = 0) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { con: 14 });
  doc.play.currentHp = currentHp;
  doc.play.tempHp = tempHp;
  doc.play.hpInitialized = true;
  return doc;
}

const cardButton = (name: string | RegExp) => screen.getByRole('button', { name });
const hpNumber = () => cardButton(/\/ \d+\s*hit points/);
const sheetDialog = () => screen.findByRole('dialog', { name: 'Hit points' });
const isClosed = () =>
  waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hit points' })).toBeNull());

/** Keys pressed one by one on the sheet's keypad. */
function key(sheet: HTMLElement, keys: string) {
  const pad = within(sheet).getByRole('group', { name: 'Keypad' });
  for (const k of keys) fireEvent.click(within(pad).getByRole('button', { name: k }));
}
const quickKey = (sheet: HTMLElement, amount: string) =>
  within(within(sheet).getByRole('group', { name: 'Add to the amount' })).getByRole('button', {
    name: amount,
  });
const quick = (sheet: HTMLElement, amount: string) => fireEvent.click(quickKey(sheet, amount));
const undo = (sheet: HTMLElement) =>
  fireEvent.click(
    within(within(sheet).getByRole('group', { name: 'Keypad' })).getByRole('button', {
      name: 'Undo',
    }),
  );
/** The confirm is the sheet's last button. */
const confirm = (sheet: HTMLElement) => within(sheet).getAllByRole('button').at(-1) as HTMLElement;
const pressedMode = (sheet: HTMLElement) =>
  within(within(sheet).getByRole('group', { name: 'Change hit points' })).getByRole('button', {
    pressed: true,
  }).textContent;

describe('the HP sheet', () => {
  it('takes damage from temp HP first, and says so before it does', async () => {
    const harness = await renderSheet(warrior(19, 5));
    expect(hp()).toMatchObject({ current: 19, temp: 5 });

    fireEvent.click(cardButton('Damage'));
    const sheet = await sheetDialog();
    expect(pressedMode(sheet)).toBe('Damage');
    expect(sheet.textContent).toContain('19 / ');
    expect(sheet.textContent).toContain('+5 temp');

    key(sheet, '7');
    expect(confirm(sheet).textContent).toBe('Take 7 damage');
    expect(sheet.textContent).toContain('Temp HP absorbs damage first: 5 temp, then 2 from 19.');

    fireEvent.click(confirm(sheet));
    await isClosed();
    expect(hp()).toMatchObject({ current: 17, temp: 0 });
    const saved = await harness.saved();
    expect(saved.play.currentHp).toBe(17);
    expect(saved.play.tempHp).toBe(0);
    expect((await harness.history())[0]).toBe('HP 19→17 · Temp HP → 0');
  });

  it('leaves current HP alone when temp HP covers it all', async () => {
    await renderSheet(warrior(19, 10));
    fireEvent.click(cardButton('Damage'));
    const sheet = await sheetDialog();
    quick(sheet, '+5');
    fireEvent.click(confirm(sheet));
    await isClosed();
    expect(hp()).toMatchObject({ current: 19, temp: 5 });
  });

  it('heals from the Heal button, up to the maximum and no further', async () => {
    const doc = warrior(1);
    const harness = await renderSheet(doc);
    const { max } = hp();
    fireEvent.click(cardButton('Heal'));
    const sheet = await sheetDialog();
    expect(pressedMode(sheet)).toBe('Heal');
    key(sheet, '999');
    expect(confirm(sheet).textContent).toBe(`Heal ${max - 1} HP`);
    fireEvent.click(confirm(sheet));
    await isClosed();
    expect(hp().current).toBe(max);
    expect((await harness.history())[0]).toBe(`HP 1→${max}`);
  });

  it('opens on the keypad from the number, with nothing keyed, and the tip goes', async () => {
    await renderSheet(warrior(19));
    expect(screen.getByText('Tap the number to type an exact amount.')).toBeTruthy();
    fireEvent.click(hpNumber());
    const sheet = await sheetDialog();
    expect(screen.queryByText('Tap the number to type an exact amount.')).toBeNull();
    expect(pressedMode(sheet)).toBe('Damage');
    expect(confirm(sheet).textContent).toBe('Enter an amount');
    expect(confirm(sheet).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(confirm(sheet));
    // Nothing to do yet, so it stays up and changes nothing.
    expect(screen.getByRole('dialog', { name: 'Hit points' })).toBe(sheet);
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await isClosed();
    expect(hp().current).toBe(19);
  });

  it('opens on Temp HP from the chip, where a new value replaces the old', async () => {
    const harness = await renderSheet(warrior(19));
    fireEvent.click(cardButton('Temp HP'));
    let sheet = await sheetDialog();
    expect(pressedMode(sheet)).toBe('Temp HP');
    key(sheet, '8');
    expect(confirm(sheet).textContent).toBe('Set temp HP to 8');
    fireEvent.click(confirm(sheet));
    await isClosed();
    expect(hp()).toMatchObject({ current: 19, temp: 8 });
    expect((await harness.history())[0]).toBe('+8 temp HP');

    fireEvent.click(cardButton('+8 temporary hit points'));
    sheet = await sheetDialog();
    expect(confirm(sheet).getAttribute('aria-disabled')).toBe('true');
    key(sheet, '3');
    fireEvent.click(confirm(sheet));
    await isClosed();
    expect(hp().temp).toBe(3);

    fireEvent.click(cardButton('+3 temporary hit points'));
    sheet = await sheetDialog();
    key(sheet, '0');
    expect(confirm(sheet).textContent).toBe('Clear 3 temp HP');
    fireEvent.click(confirm(sheet));
    await isClosed();
    expect(hp().temp).toBe(0);
  });

  it('adds quick amounts to what was typed, and Undo takes back the last tap', async () => {
    await renderSheet(warrior(5));
    fireEvent.click(cardButton('Damage'));
    const sheet = await sheetDialog();
    expect(quickKey(sheet, '+1')).toBeTruthy();
    expect(quickKey(sheet, '+10')).toBeTruthy();
    key(sheet, '10');
    quick(sheet, '+5');
    expect(confirm(sheet).textContent).toBe('Take 15 damage');
    // A digit after a quick amount starts a number of its own: 18, never 153.
    key(sheet, '3');
    expect(confirm(sheet).textContent).toBe('Take 18 damage');
    undo(sheet);
    expect(confirm(sheet).textContent).toBe('Take 15 damage');
    // The whole +5 at once, not one of its digits.
    undo(sheet);
    expect(confirm(sheet).textContent).toBe('Take 10 damage');
    undo(sheet);
    expect(confirm(sheet).textContent).toBe('Take 1 damage');
    undo(sheet);
    expect(confirm(sheet).textContent).toBe('Enter an amount');
    // Nothing left to take back.
    undo(sheet);
    expect(confirm(sheet).textContent).toBe('Enter an amount');
  });

  it('keeps the amount through a change of mode, until Clear', async () => {
    await renderSheet(warrior(5));
    fireEvent.click(cardButton('Damage'));
    const sheet = await sheetDialog();
    quick(sheet, '+10');
    quick(sheet, '+10');
    expect(confirm(sheet).textContent).toBe('Take 20 damage');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Temp HP' }));
    expect(confirm(sheet).textContent).toBe('Set temp HP to 20');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Clear' }));
    expect(confirm(sheet).textContent).toBe('Enter an amount');
  });

  it('goes no further than 999, and says so on the quick amounts that would', async () => {
    await renderSheet(warrior(19));
    fireEvent.click(cardButton('Damage'));
    const sheet = await sheetDialog();
    key(sheet, '990');
    expect(quickKey(sheet, '+10').getAttribute('aria-disabled')).toBe('true');
    expect(quickKey(sheet, '+5').getAttribute('aria-disabled')).toBe('false');
    quick(sheet, '+10');
    expect(confirm(sheet).textContent).toBe('Take 990 damage');
    quick(sheet, '+5');
    expect(confirm(sheet).textContent).toBe('Take 995 damage');
    expect(quickKey(sheet, '+5').getAttribute('aria-disabled')).toBe('true');
    quick(sheet, '+5');
    key(sheet, '9');
    expect(confirm(sheet).textContent).toBe('Take 995 damage');
    // The +10 the cap turned away is not there to take back: Undo goes to 990.
    undo(sheet);
    expect(confirm(sheet).textContent).toBe('Take 990 damage');
  });

  it('starts fresh each time it opens', async () => {
    await renderSheet(warrior(19));
    fireEvent.click(cardButton('Damage'));
    let sheet = await sheetDialog();
    key(sheet, '7');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await isClosed();
    expect(hp().current).toBe(19);

    fireEvent.click(cardButton('Heal'));
    sheet = await sheetDialog();
    expect(pressedMode(sheet)).toBe('Heal');
    expect(confirm(sheet).textContent).toBe('Enter an amount');
  });

  it('hears digits and Backspace from a keyboard, while focus is in the sheet', async () => {
    await renderSheet(warrior(19));
    fireEvent.click(cardButton('Damage'));
    const sheet = await sheetDialog();
    const control = within(sheet).getByRole('button', { name: 'Heal' });
    fireEvent.keyDown(control, { key: '1' });
    fireEvent.keyDown(control, { key: '3' });
    fireEvent.keyDown(control, { key: '9' });
    expect(confirm(sheet).textContent).toBe('Take 139 damage');
    fireEvent.keyDown(control, { key: 'Backspace' });
    expect(confirm(sheet).textContent).toBe('Take 13 damage');
    // Backspace is Undo too, so it takes back a whole quick amount.
    quick(sheet, '+10');
    expect(confirm(sheet).textContent).toBe('Take 23 damage');
    fireEvent.keyDown(control, { key: 'Backspace' });
    expect(confirm(sheet).textContent).toBe('Take 13 damage');
    // A browser shortcut is not a digit.
    fireEvent.keyDown(control, { key: '1', ctrlKey: true });
    expect(confirm(sheet).textContent).toBe('Take 13 damage');
  });

  it('applies once and rolls one concentration save, however fast the taps', async () => {
    const doc = warrior(19);
    doc.play.concentratingOn = { label: 'Bless' };
    await renderSheet(doc);
    fireEvent.click(cardButton('Damage'));
    const sheet = await sheetDialog();
    key(sheet, '7');
    const take = confirm(sheet);
    fireEvent.click(take);
    fireEvent.click(take);
    await isClosed();
    expect(hp().current).toBe(12);
    const saves = rollLogStore
      .getState()
      .rolls.filter((r) => /Concentration save/.test(r.label ?? ''));
    expect(saves).toHaveLength(1);
  });

  it('asks about Relentless Endurance over the sheet, then closes both', async () => {
    const doc = warrior(3);
    doc.race = { name: 'Testfolk', source: 'TST' };
    const harness = await renderSheet(doc);
    fireEvent.click(cardButton('Damage'));
    const sheet = await sheetDialog();
    key(sheet, '50');
    fireEvent.click(confirm(sheet));

    const relentless = await dialog('Relentless Endurance');
    await relentless.press('Stay at 1 HP');
    expect(hp().current).toBe(1);
    const saved = await harness.saved();
    expect(saved.play.resources.find((r) => r.key === 'relentless-endurance')?.used).toBe(1);
  });

  it('puts focus back on what opened it', async () => {
    await renderSheet(warrior(19));
    for (const opener of [cardButton('Heal'), cardButton('Temp HP'), hpNumber()]) {
      opener.focus();
      fireEvent.click(opener);
      const sheet = await sheetDialog();
      fireEvent.keyDown(sheet, { key: 'Escape' });
      await isClosed();
      await waitFor(() => expect(document.activeElement).toBe(opener));
    }
  });

  it('keeps the steppers on the card, beside the two new buttons', async () => {
    await renderSheet(warrior(19));
    fireEvent.click(cardButton('Damage 1 hit point'));
    fireEvent.click(cardButton('Damage 5 hit points'));
    fireEvent.click(cardButton('Heal 1 hit point'));
    fireEvent.click(cardButton('Heal 5 hit points'));
    expect(hp().current).toBe(19);
    expect(cardButton('Damage').getAttribute('aria-haspopup')).toBe('dialog');
    expect(cardButton('Heal').getAttribute('aria-haspopup')).toBe('dialog');
  });
});
