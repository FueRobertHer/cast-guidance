// @vitest-environment jsdom
// A11Y-001: the active preset chip was shown only by its border colour.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// No stored policy and no homebrew: the section reads "allow everything".
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));
vi.mock('@/data5e/hooks', () => ({ useRegistry: () => null }));
// The section reads the registry for itself, with the stored rows it read it for.
vi.mock('@/data5e/registry', () => ({
  getRegistry: () => Promise.resolve({ sourceCounts: () => new Map() }),
}));
vi.mock('@/data5e/sourceFilter', async (actual) => ({
  ...(await actual<typeof import('@/data5e/sourceFilter')>()),
  useSourcePolicy: () => ({ mode: 'all', except: [] }),
}));

import { SourcesSection } from './SourcesSection';

afterEach(cleanup);

describe('SourcesSection presets', () => {
  it('reports the matching preset as pressed and the rest as not', async () => {
    render(<SourcesSection />);
    expect(await screen.findByRole('button', { name: 'Everything', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2014 core only', pressed: false })).toBeTruthy();
  });
});
