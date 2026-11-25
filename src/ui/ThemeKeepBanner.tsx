import { Palette } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  endPreview,
  keepPreview,
  readThemeChoice,
  resolveTheme,
  TRY_SECONDS,
  usePreview,
} from '@/lib/theme';
import { announce } from '@/stores/announcer';
import { Banner, BannerAction } from './Banner';

/**
 * Keep the theme being tried, or go back (docs/theming-plan.md, phase 3). A
 * theme someone made can be anything, unreadable included, so this asks
 * before the choice is stored and goes back by itself after `TRY_SECONDS`;
 * a reload meanwhile goes back too, since nothing was stored.
 *
 * Drawn in the stored choice's built-in theme (a subtree with its own
 * `data-theme`, which every built-in fills completely), so it can be read
 * whatever the theme being tried does to the rest of the page. The seconds
 * are a plain visual; a screen reader hears the offer once, not each tick.
 */
export function ThemeKeepBanner() {
  const theme = usePreview();
  const [left, setLeft] = useState(TRY_SECONDS);

  useEffect(() => {
    if (theme === null) return;
    setLeft(TRY_SECONDS);
    announce(
      `Trying the theme ${theme.file.name}. It goes back in ${TRY_SECONDS} seconds unless you keep it.`,
      { key: 'theme-try' },
    );
    const started = Date.now();
    const timer = setInterval(() => {
      const remaining = TRY_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (remaining > 0) {
        setLeft(remaining);
        return;
      }
      clearInterval(timer);
      endPreview();
      announce('Went back to the theme before.', { key: 'theme-try' });
    }, 250);
    return () => clearInterval(timer);
  }, [theme]);

  if (theme === null) return null;
  return (
    <div data-theme={resolveTheme(readThemeChoice())} className="font-sans text-ink">
      <Banner
        tone="guide"
        icon={Palette}
        data-theme-keep=""
        actions={
          <>
            <BannerAction tone="guide" onClick={keepPreview}>
              Keep
            </BannerAction>
            <BannerAction tone="guide" emphasis="secondary" onClick={endPreview}>
              Go back
            </BannerAction>
          </>
        }
      >
        Keep the theme {theme.file.name}?{' '}
        <span aria-hidden="true" className="tabular-nums">
          Going back in {left} s.
        </span>
      </Banner>
    </div>
  );
}
