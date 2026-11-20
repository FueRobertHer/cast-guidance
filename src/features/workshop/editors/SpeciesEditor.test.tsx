// @vitest-environment jsdom
// The size chips offer every size the data writes: Tiny to Gargantuan, and
// Varies (the player's pick). A size code the chips do not know is kept when
// another is tapped: tapping a chip used to rewrite the list from the chips
// alone and drop it (bug 8, F1).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import type { Json } from '../editorTypes';
import { editor } from './SpeciesEditor';

afterEach(cleanup);

/** The species editor on screen; returns the draft as it stands. */
function mount(start: Json) {
  let latest = start;
  function Harness() {
    const [draft, setDraft] = useState(start);
    latest = draft;
    const change = (patch: Json) =>
      setDraft((d) => {
        const next = { ...d, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next;
      });
    return (
      <editor.Body draft={draft} change={change} registry={new EntityRegistry()} readOnly={false} />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return () => latest;
}

const tap = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Size' })).getByRole('button', { name }),
  );

describe('the size chips', () => {
  it('offer Huge, Gargantuan and Varies, in the data order', () => {
    const draft = mount({ name: 'Giantkin', size: ['L'], entries: [] });
    tap('Gargantuan');
    tap('Huge');
    expect(draft().size).toEqual(['L', 'H', 'G']);
    tap('Large');
    expect(draft().size).toEqual(['H', 'G']);
  });

  it('take Varies alone, and drop it for a size', () => {
    const draft = mount({ name: 'Shifter', size: ['S', 'M'], entries: [] });
    tap('Varies');
    expect(draft().size).toEqual(['V']);
    tap('Medium');
    expect(draft().size).toEqual(['M']);
  });

  it('keep a size they do not offer when another is tapped, and say so', () => {
    const draft = mount({ name: 'Oddling', size: ['M', 'X'], entries: [] });
    expect(screen.getByText(/also X, kept as it is/)).toBeTruthy();
    tap('Small');
    expect(draft().size).toEqual(['S', 'M', 'X']);
    tap('Small');
    tap('Medium');
    expect(draft().size).toEqual(['X']);
  });

  it('say nothing more when every size has a chip', () => {
    const draft = mount({ name: 'Folk', size: ['M', 'H', 'V'], entries: [] });
    expect(screen.queryByText(/kept as/)).toBeNull();
    tap('Medium');
    expect(draft().size).toEqual(['H', 'V']);
  });
});
