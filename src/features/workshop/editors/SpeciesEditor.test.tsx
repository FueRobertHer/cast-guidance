// @vitest-environment jsdom
// The size chips offer Tiny to Large. A species from a file can be bigger
// (Huge, Gargantuan) or have a size that varies: tapping a chip used to
// rewrite the list from the chips alone and drop those.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const tap = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('the size chips', () => {
  it('keep a size they do not offer when another is tapped', () => {
    const draft = mount({ name: 'Giantkin', size: ['L', 'H'], entries: [] });
    tap('Medium');
    expect(draft().size).toEqual(['M', 'L', 'H']);
    tap('Large');
    expect(draft().size).toEqual(['M', 'H']);
  });

  it('keep it when the last size they offer is taken away', () => {
    const draft = mount({ name: 'Titanborn', size: ['L', 'G'], entries: [] });
    tap('Large');
    expect(draft().size).toEqual(['G']);
  });

  it('say which sizes are kept without a chip', () => {
    mount({ name: 'Shifter', size: ['M', 'H', 'V'], entries: [] });
    expect(screen.getByText(/Huge and Varies, kept as they are/)).toBeTruthy();
  });

  it('say nothing more when every size has a chip', () => {
    const draft = mount({ name: 'Folk', size: ['M'], entries: [] });
    expect(screen.queryByText(/kept as/)).toBeNull();
    tap('Medium');
    expect(draft().size).toBeUndefined();
  });
});
