// @vitest-environment jsdom
// The sheet header's overflow is a menu button (WAI-ARIA APG), not a sheet of
// choices: the keys a menu answers to, focus kept on the button or an item,
// and a picked item that runs with focus already back on the button, where
// the dialog it opens returns it.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Download, History, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetMenu, type SheetMenuItem } from './SheetMenu';

afterEach(cleanup);

function renderMenu(onSelect = vi.fn()) {
  const items: SheetMenuItem[] = [
    { label: 'History', icon: History, dialog: true, onSelect: () => onSelect('History') },
    { label: 'Export', icon: Download, onSelect: () => onSelect('Export') },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => onSelect('Delete') },
  ];
  function Harness() {
    const button = useRef<HTMLButtonElement>(null);
    return (
      <>
        <SheetMenu label="More: history, export, delete" items={items} buttonRef={button} />
        <p>Outside</p>
      </>
    );
  }
  render(<Harness />);
  return { button: screen.getByRole('button', { name: 'More: history, export, delete' }) };
}

const focused = () => document.activeElement?.textContent;
const key = (k: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key: k });

describe('the sheet overflow menu', () => {
  it('is a menu button that says whether it is open, and what it controls', () => {
    const { button } = renderMenu();
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(menu.getAttribute('aria-labelledby')).toBe(button.id);
    expect(screen.getByRole('menuitem', { name: 'History' }).getAttribute('aria-haspopup')).toBe(
      'dialog',
    );
  });

  // Enter and Space reach a native button as a click, which jsdom does not
  // synthesize from a key; e2e/a11y/keyboard.spec.ts presses them for real.
  it('opens on the first item from a click or Down, and on the last from Up', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    expect(focused()).toBe('History');
    key('Escape');

    button.focus();
    key('ArrowDown');
    expect(focused()).toBe('History');
    key('Escape');

    button.focus();
    key('ArrowUp');
    expect(focused()).toBe('Delete');
  });

  it('moves round the items with the arrows, Home, End and a first letter', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    key('ArrowDown');
    expect(focused()).toBe('Export');
    key('ArrowDown');
    key('ArrowDown');
    expect(focused()).toBe('History');
    key('ArrowUp');
    expect(focused()).toBe('Delete');
    key('Home');
    expect(focused()).toBe('History');
    key('End');
    expect(focused()).toBe('Delete');
    key('e');
    expect(focused()).toBe('Export');
    key('h');
    expect(focused()).toBe('History');
  });

  it('closes on Escape with focus back on the button', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Tab, and on a press outside it', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    key('Tab');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when its button is pressed again', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs a picked item with the menu closed and focus back on the button', () => {
    const seen: { item: string; focus: Element | null; menu: boolean }[] = [];
    const { button } = renderMenu(
      vi.fn((item: string) =>
        seen.push({
          item,
          focus: document.activeElement,
          menu: document.querySelector('[role="menu"]') !== null,
        }),
      ),
    );
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.item).toBe('Delete');
    // Focus is on the button before the item runs, so a dialog it opens keeps
    // the button as the place to return to.
    expect(seen[0]?.focus).toBe(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('picks the focused item with Enter', () => {
    const onSelect = vi.fn();
    const { button } = renderMenu(onSelect);
    fireEvent.click(button);
    key('ArrowDown');
    // A native button turns Enter into a click.
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('Export');
  });
});
