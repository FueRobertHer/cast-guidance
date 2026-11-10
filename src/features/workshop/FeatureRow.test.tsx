// @vitest-environment jsdom
// One feature as a row: its badge, Keep, Change and Remove, folding, and its editor.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureRow, type FeatureRowProps } from './FeatureRow';

afterEach(cleanup);

const AURA = { name: 'Aura of Devotion', entries: ['No charm near you.'] };

function show(props: Partial<FeatureRowProps> = {}) {
  const calls = { onMode: vi.fn(), onChange: vi.fn(), onRename: vi.fn() };
  render(
    <MemoryRouter>
      <ul>
        <FeatureRow
          name="Aura of Devotion"
          noun="feature"
          status="kept"
          value={AURA}
          editing={false}
          readOnly={false}
          onMode={calls.onMode}
          onChange={calls.onChange}
          onRename={calls.onRename}
          {...props}
        />
      </ul>
    </MemoryRouter>,
  );
  return calls;
}
const modes = () =>
  screen.queryByRole('group', { name: 'Aura of Devotion: keep, change or remove' });

describe('FeatureRow', () => {
  it.each([
    ['kept', 'Kept'],
    ['changed', 'Changed'],
    ['removed', 'Removed'],
    ['new', 'New'],
    ['waiting', 'Waiting'],
  ] as const)('badges a %s feature', (status, word) => {
    show({ status });
    expect(screen.getByText(word)).toBeTruthy();
  });

  it('says which mode it is in and passes on a new one', () => {
    const { onMode } = show();
    const group = modes();
    if (group === null) throw new Error('no modes');
    expect(within(group).getByRole('button', { name: 'Keep' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(group).getByRole('button', { name: 'Change' }));
    expect(onMode).toHaveBeenCalledWith('change');
    cleanup();
    show({ status: 'removed' });
    expect(screen.getByRole('button', { name: 'Remove' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens its editor while it is changed, and passes on a new name and text', () => {
    const { onRename, onChange } = show({ status: 'changed', editing: true });
    fireEvent.change(screen.getByLabelText('Feature name'), { target: { value: 'Aura of Light' } });
    expect(onRename).toHaveBeenCalledWith('Aura of Light');
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Light near you.' } });
    expect(onChange).toHaveBeenCalledWith({ ...AURA, entries: ['Light near you.'] });
  });

  it('shows no editor for a kept feature, and no controls when read only', () => {
    show();
    expect(screen.queryByLabelText('Feature name')).toBeNull();
    cleanup();
    show({ readOnly: true, status: 'changed', editing: true });
    expect(modes()).toBeNull();
    expect((screen.getByLabelText('Feature name') as HTMLInputElement).disabled).toBe(true);
  });

  it('folds to its name and badge until tapped', () => {
    show({ foldable: true });
    const header = screen.getByRole('button', { name: 'Aura of Devotion' });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(modes()).toBeNull();
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(modes()).not.toBeNull();
  });

  it('starts open when new, and can be taken out', () => {
    const onDelete = vi.fn();
    show({
      status: 'new',
      foldable: true,
      editing: true,
      onMode: undefined,
      onDelete,
      meta: 'Your own feature',
    });
    expect(screen.getByLabelText('Feature name')).toBeTruthy();
    expect(screen.getByText('Your own feature')).toBeTruthy();
    expect(modes()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Aura of Devotion' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('calls a row with no name by its noun', () => {
    show({ name: '', status: 'new', onMode: undefined });
    expect(screen.getByText('Unnamed feature')).toBeTruthy();
  });
});
