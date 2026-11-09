import type { Locator, Page } from '@playwright/test';
import {
  createBlankCharacter,
  gotoRosterSettled,
  gotoSheetTab,
  openHistory,
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

  const history = await openHistory(page);
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();

  return page.evaluate(() => [...(window.__motion as Motion[])]);
}

/**
 * Puts Poisoned and Paralyzed on a new character, through the picker, and lands
 * on its attack chip: the kind of thing in the app that moves at rest.
 */
async function afflictAChip(page: Page) {
  await skipOfflineReadyNotice(page);
  await recordMotion(page);
  await gotoRosterSettled(page);
  const id = await createBlankCharacter(page);
  await gotoSheetTab(page, id, 'Play');

  await page.getByRole('button', { name: 'Add an effect', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Effects' });
  await picker.getByRole('button', { name: 'Poisoned', exact: true }).click();
  await picker.getByRole('button', { name: 'Paralyzed', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();

  return page.getByTitle('Unarmed Strike attack');
}

/**
 * Puts Grappled and Frightened on a new character: claws on its Speed cell, and
 * on the Stats tab a tile's number moved, and motion in the Skills card's strip.
 */
async function afflictTheOtherRolls(page: Page) {
  await skipOfflineReadyNotice(page);
  await recordMotion(page);
  await gotoRosterSettled(page);
  const id = await createBlankCharacter(page);
  await gotoSheetTab(page, id, 'Play');

  await page.getByRole('button', { name: 'Add an effect', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Effects' });
  await picker.getByRole('button', { name: 'Grappled', exact: true }).click();
  await picker.getByRole('button', { name: 'Frightened', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  return id;
}

/** The Stats tab's tiles and Skills card, with what wears them. */
const statsSurfaces = (page: Page) => ({
  tile: page.locator('.cx-at-tile.cx-frightened').first(),
  card: page.locator('.cx-at-card.cx-frightened'),
});

/** The names of the CSS animations running on the chip: its loops, not a passing transition. */
const running = (chip: Locator) =>
  chip.evaluate((el) =>
    el
      .getAnimations({ subtree: true })
      .filter((a) => a instanceof CSSAnimation && a.playState === 'running')
      .map((a) => (a as CSSAnimation).animationName),
  );

test.describe('motion, as the device asks', () => {
  test('without a preference, sheets slide (the canary)', async ({ page }) => {
    const motion = await moveThroughTheSheet(page);
    expect(motion.filter((m) => m.ms >= 100).length).toBeGreaterThan(0);
  });

  test('without a preference, an afflicted chip keeps moving (the canary)', async ({ page }) => {
    const chip = await afflictAChip(page);
    await expect(chip.locator('.cx-on')).toHaveClass(/cx-paralyzed/);
    await expect.poll(() => running(chip)).toContain('cx-bolt-a');
  });

  test('without a preference, the other surfaces keep moving (the canary)', async ({ page }) => {
    const id = await afflictTheOtherRolls(page);
    const speed = page.locator('.cx-at-cell.cx-grappled');
    await expect.poll(() => running(speed)).toContain('cx-snap');
    await gotoSheetTab(page, id, 'Stats');
    const { tile, card } = statsSurfaces(page);
    await expect.poll(() => running(tile.locator('.cx-move'))).toContain('cx-tremble');
    await expect.poll(() => running(card.locator('.cx-strip'))).toContain('cx-flinch');
  });

  test('with the switch off in Settings, an afflicted chip holds still', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cast-guidance:condition-motion', 'off');
    });
    const chip = await afflictAChip(page);
    await expect(chip.locator('.cx-on')).toHaveClass(/cx-still/);
    await expect(chip.locator('.cx-bolt').first()).toHaveCSS('opacity', '0.8');
    await expect.poll(() => running(chip)).toEqual([]);
  });

  test('with the switch off in Settings, the other surfaces hold still', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cast-guidance:condition-motion', 'off');
    });
    const id = await afflictTheOtherRolls(page);
    const speed = page.locator('.cx-at-cell.cx-grappled');
    await expect(speed.locator('.cx-prong').first()).toHaveCSS('opacity', '0.45');
    await expect.poll(() => running(speed)).toEqual([]);
    await gotoSheetTab(page, id, 'Stats');
    const { tile, card } = statsSurfaces(page);
    await expect(tile).toHaveClass(/cx-still/);
    await expect.poll(() => running(tile.locator('.cx-move'))).toEqual([]);
    await expect.poll(() => running(card.locator('.cx-strip'))).toEqual([]);
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

    test('with reduced motion, an afflicted chip keeps its look and holds still', async ({
      page,
    }) => {
      const chip = await afflictAChip(page);
      await expect(chip.locator('.cx-on')).toHaveClass(/cx-paralyzed/);
      await expect(chip.locator('.cx-bolt').first()).toBeAttached();
      // The arrival and each loop run once, instantly, and leave the still pose.
      await expect.poll(() => running(chip)).toEqual([]);
      const motion = await page.evaluate(() => [...(window.__motion as Motion[])]);
      expect(motion.filter((m) => m.name.startsWith('cx-')).length).toBeGreaterThan(0);
      expect(motion.filter((m) => m.ms > 0.01)).toEqual([]);
      // Paralyzed's still pose: both bolts at 80%, not the 0 of the last keyframe.
      await expect(chip.locator('.cx-bolt').first()).toHaveCSS('opacity', '0.8');
    });

    test('with reduced motion, the other surfaces keep their looks and hold still', async ({
      page,
    }) => {
      const id = await afflictTheOtherRolls(page);
      const speed = page.locator('.cx-at-cell.cx-grappled');
      await expect(speed.locator('.cx-prong')).toHaveCount(4);
      await expect.poll(() => running(speed)).toEqual([]);
      await gotoSheetTab(page, id, 'Stats');
      const { tile, card } = statsSurfaces(page);
      await expect(tile).toHaveClass(/cx-on/);
      await expect(card.locator('.cx-strip')).toBeAttached();
      await expect.poll(() => running(tile.locator('.cx-move'))).toEqual([]);
      await expect.poll(() => running(card.locator('.cx-strip'))).toEqual([]);
      const motion = await page.evaluate(() => [...(window.__motion as Motion[])]);
      expect(motion.filter((m) => m.ms > 0.01)).toEqual([]);
    });
  });
});
