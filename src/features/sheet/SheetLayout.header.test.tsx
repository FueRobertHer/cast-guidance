// @vitest-environment jsdom
// UX-004: the sheet header sticks on top of the page, so a tab's own sticky bar
// (the build page's undo bar) has to sit under it. The header publishes its
// height for that; a bar at top-0 hid behind it once the page scrolled.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHeaderHeight } from './SheetLayout';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe() {
  const { header, style } = useHeaderHeight();
  return (
    <div data-testid="root" style={style}>
      <header ref={header}>Name</header>
    </div>
  );
}

describe('useHeaderHeight', () => {
  it('publishes the header height for a tab bar to stick under', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(68);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('root').style.getPropertyValue('--sheet-header-h')).toBe('68px');
  });
});
