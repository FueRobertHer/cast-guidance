// @vitest-environment jsdom
// A11Y-001: the dialog sheets open without a trigger, so nothing put focus back
// when one closed: a keyboard or screen-reader user answering "Delete?" was
// dropped at the top of the page. The prompt's input had no name either.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { askConfirm, askText, DialogHost } from './dialogs';

// jsdom has no matchMedia and the drawer asks for one on mount.
beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(cleanup);

/** Tab to a button and press it, as a keyboard user would: focus moves first. */
async function press(name: string) {
  const button = await screen.findByRole('button', { name });
  button.focus();
  fireEvent.click(button);
}

function renderWithOpener() {
  render(
    <>
      <button type="button">Opener</button>
      <DialogHost />
    </>,
  );
  const opener = screen.getByRole('button', { name: 'Opener' });
  opener.focus();
  return opener;
}

describe('DialogHost', () => {
  it('puts focus back where it was when a dialog closes', async () => {
    const opener = renderWithOpener();
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = askConfirm({ title: 'Delete it?' });
    });
    await press('Cancel');

    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('keeps the first opener across a dialog that opens as another closes', async () => {
    const opener = renderWithOpener();
    act(() => {
      void askConfirm({ title: 'First?' }).then(() => askConfirm({ title: 'Second?' }));
    });
    await press('Confirm');
    await press('Cancel');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('names the prompt input after the question', async () => {
    renderWithOpener();
    act(() => {
      void askText({ title: 'Rename hero', placeholder: 'Name' });
    });
    expect(await screen.findByRole('textbox', { name: 'Rename hero' })).toBeTruthy();
  });
});
