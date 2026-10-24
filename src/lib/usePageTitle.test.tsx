// @vitest-environment jsdom
// UX-003: every screen names itself in the document title, which is what the
// tab strip, browser history, and a screen reader's page announcement read.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_NAME, pageTitle, usePageTitle } from './usePageTitle';

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('pageTitle', () => {
  it('puts the most specific part first and the app name last', () => {
    expect(pageTitle(['Spells', 'Aria'])).toBe('Spells · Aria · Cast Guidance');
  });

  it('drops parts that are not known yet', () => {
    expect(pageTitle([null, undefined, false, '', '   ', ' Spells '])).toBe(
      'Spells · Cast Guidance',
    );
    expect(pageTitle([])).toBe(APP_NAME);
  });
});

function Probe({ parts }: { parts: string[] }) {
  usePageTitle(...parts);
  return null;
}
function Other() {
  usePageTitle('Settings');
  return null;
}

describe('usePageTitle', () => {
  it('sets the title, follows its parts, and puts the app name back on unmount', () => {
    const { rerender, unmount } = render(<Probe parts={['Library']} />);
    expect(document.title).toBe('Library · Cast Guidance');

    rerender(<Probe parts={['Spells', 'Library']} />);
    expect(document.title).toBe('Spells · Library · Cast Guidance');

    unmount();
    expect(document.title).toBe(APP_NAME);
  });

  it('leaves the incoming screen its title when one screen replaces another', () => {
    // The outgoing screen's reset has to run before the incoming screen's set,
    // or every navigation would end on the bare app name.
    const { rerender } = render(<Probe parts={['Library']} />);
    rerender(<Other />);
    expect(document.title).toBe('Settings · Cast Guidance');
  });
});
