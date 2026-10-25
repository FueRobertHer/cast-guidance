import type { Page } from '@playwright/test';
import {
  createBlankCharacter,
  gotoRosterSettled,
  gotoSheetTab,
  skipOfflineReadyNotice,
} from '../support/app.ts';
import { expect, test } from '../support/test.ts';

/**
 * Reduced motion (A11Y-003): with the device asking for less motion, the
 * stylesheet's `prefers-reduced-motion` block takes every animation and
 * transition down to 0.01 ms, so a sheet appears instead of sliding. The same
 * flow is run without the preference first, as the canary: it must animate,
 * or the reduced run would pass for want of anything to stop.
 *
 * Every animation and transition that starts is recorded from its start
 * event, with its computed duration, so nothing depends on catching one
 * mid-flight.
 */

interface Motion {
  kind: 'animation' | 'transition';
  name: string;
  ms: number;
}

declare global {
  interface Window {
    __motion?: Motion[];
  }
}

async function recordMotion(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: Motion[] = [];
    window.__motion = seen;
    // A computed duration list ("0.5s, 0.01ms") as its longest entry, in ms.
    const longest = (list: string) =>
      Math.max(
        ...list.split(',').map((d) => {
          const v = Number.parseFloat(d);
          return d.trim().endsWith('ms') ? v : v * 1000;
        }),
      );
    const style = (e: AnimationEvent | TransitionEvent) =>
      getComputedStyle(e.target as Element, e.pseudoElement === '' ? null : e.pseudoElement);
    document.addEventListener('animationstart', (e) => {
      seen.push({
        kind: 'animation',
        name: e.animationName,
        ms: longest(style(e).animationDuration),
      });
    });
    document.addEventListener('transitionrun', (e) => {
      seen.push({
        kind: 'transition',
        name: e.propertyName,
        ms: longest(style(e).transitionDuration),
      });
    });
  });
}

/** Opens and closes the dice tray and the history drawer, and rolls a die. */
async function moveThroughTheSheet(page: Page): Promise<Motion[]> {
  await skipOfflineReadyNotice(page);
  await recordMotion(page);
  await gotoRosterSettled(page);
  const id = await createBlankCharacter(page);
  await gotoSheetTab(page, id, 'Play');
  await page.evaluate(() => {
    (window.__motion as Motion[]).length = 0;
  });

  await page.getByRole('button', { name: 'Dice tray' }).click();
  const dice = page.getByRole('dialog', { name: 'Dice' });
  await expect(dice).toBeVisible();
  await dice.getByRole('button', { name: 'd20', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dice).toBeHidden();

  await page.getByRole('button', { name: 'Character history' }).click();
  const history = page.getByRole('dialog', { name: 'History' });
  await expect(history).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();

  return page.evaluate(() => [...(window.__motion as Motion[])]);
}

test.describe('motion, as the device asks', () => {
  test('without a preference, sheets slide (the canary)', async ({ page }) => {
    const motion = await moveThroughTheSheet(page);
    expect(motion.filter((m) => m.ms >= 100).length).toBeGreaterThan(0);
  });

  test.describe(() => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('with reduced motion, nothing moves', async ({ page }) => {
      const motion = await moveThroughTheSheet(page);
      expect(
        await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(true);
      // Not vacuous: the sheets still run their (now instant) animations,
      // which is what lets Radix finish opening and closing them.
      expect(motion.length).toBeGreaterThan(0);
      expect(motion.filter((m) => m.ms > 0.01)).toEqual([]);
    });
  });
});
