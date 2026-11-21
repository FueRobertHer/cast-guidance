import { describe, expect, it } from 'vitest';
import { analyticsPath, scrubAnalyticsEvent } from './analyticsUrl';

const ORIGIN = 'https://cast.example';
const sent = (path: string) => scrubAnalyticsEvent({ type: 'pageview', url: `${ORIGIN}${path}` });

describe('analyticsPath', () => {
  it.each([
    ['/', '/'],
    ['/settings', '/settings'],
    ['/settings/', '/settings'],
    ['/create', '/create'],
    ['/library', '/library'],
    ['/workshop', '/workshop'],
    ['/workshop/rules', '/workshop/rules'],
  ])('keeps a page that holds nothing but its name: %s', (path, want) => {
    expect(analyticsPath(path)).toBe(want);
  });

  it('cuts the character id out of the sheet and each of its tabs', () => {
    expect(analyticsPath('/c/0f1e2d3c-aaaa')).toBe('/c/[character]');
    for (const tab of ['stats', 'inventory', 'spells', 'features', 'build'])
      expect(analyticsPath(`/c/0f1e2d3c-aaaa/${tab}`)).toBe(`/c/[character]/${tab}`);
  });

  it('cuts entry uids and collection ids, keeping the app-defined section', () => {
    expect(analyticsPath('/library/spell')).toBe('/library/spell');
    expect(analyticsPath('/library/spell/my%20secret%20spell%7Chomebrew')).toBe(
      '/library/spell/[entry]',
    );
    expect(analyticsPath('/workshop/collection/col-123')).toBe('/workshop/collection/[id]');
    expect(analyticsPath('/workshop/new')).toBe('/workshop/new');
    expect(analyticsPath('/workshop/new/item')).toBe('/workshop/new/item');
    expect(analyticsPath('/workshop/edit/item/Ring%20of%20Kel%7Cmine')).toBe(
      '/workshop/edit/item/[entry]',
    );
    expect(analyticsPath('/workshop/change/spell/fireball%7Cphb')).toBe(
      '/workshop/change/spell/[entry]',
    );
  });

  it.each([
    '/c',
    '/c/',
    '/c/abc/unknown-tab',
    '/c/abc/stats/extra',
    '/library/not-a-type',
    '/library/not-a-type/x',
    '/library/spell/x/y',
    '/workshop/collection',
    '/workshop/collection/a/b',
    '/workshop/unknown/item',
    '/workshop/edit/not-a-type/x',
    '/homebrew/anything',
    '/some-made-up-page',
  ])('drops an address no route claims, rather than sending it: %s', (path) => {
    expect(analyticsPath(path)).toBeUndefined();
  });
});

describe('scrubAnalyticsEvent', () => {
  it('sends the route on the same origin, with no query or hash', () => {
    expect(sent('/c/char-42/spells?tab=1#slot')).toEqual({
      type: 'pageview',
      url: `${ORIGIN}/c/[character]/spells`,
    });
    expect(sent('/settings?from=roster#storage')).toEqual({
      type: 'pageview',
      url: `${ORIGIN}/settings`,
    });
  });

  it('cancels an event whose address is unknown or unreadable', () => {
    expect(sent('/homebrew/old')).toBeNull();
    expect(scrubAnalyticsEvent({ type: 'event', url: 'not a url' })).toBeNull();
  });
});
