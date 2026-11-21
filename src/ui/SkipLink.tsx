/**
 * "Skip to content" (WCAG 2.4.1): the first stop on every page, out of sight
 * until Tab lands on it. The tab bars come before the page in the DOM (they
 * are drawn at the bottom, or as the side rail), and the sheet header before
 * them, so a keyboard user would otherwise pass them all on every page.
 *
 * It moves focus to the page's `<main>`, whichever screen drew it: each
 * screen owns its own, so there is no one id to link to, which is also why it
 * is a button rather than a link to `#id`. `main` is made focusable for the
 * moment (tabindex -1) and Tab carries on from inside it.
 */
export function SkipLink() {
  const skip = () => {
    const main = document.querySelector('main');
    if (main === null) return;
    if (!main.hasAttribute('tabindex')) {
      main.tabIndex = -1;
      main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
    }
    main.focus();
  };
  return (
    <button
      type="button"
      onClick={skip}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3 focus:text-body-strong focus:text-ink focus:shadow-overlay"
    >
      Skip to content
    </button>
  );
}
