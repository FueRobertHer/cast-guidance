// @vitest-environment jsdom
// A11Y-001: the active preset chip was shown only by its border colour.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// No stored policy and no homebrew: the section reads "allow everything".
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }));
vi.mock('@/data5e/hooks', () => ({ useRegistry: () => null }));

import { SourcesSection } from './SourcesSection';

afterEach(cleanup);

describe('SourcesSection presets', () => {
  it('reports the matching preset as pressed and the rest as not', () => {
    render(<SourcesSection />);
    expect(screen.getByRole('button', { name: 'Everything', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2014 core only', pressed: false })).toBeTruthy();
  });
});
