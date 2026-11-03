import type { ComponentProps } from 'react';

/**
 * A brief confirmation of something that changed, with at most one action,
 * usually Undo (DS-001). It inverts the theme (`ink` ground, `bg` text,
 * `shadow-overlay`) so it reads as temporary, and is never used for an error
 * (that is a banner) or a roll (the roll toast).
 *
 * Spread `snackbarProps(withAction)` on the container: it also marks the ink
 * ground, on which the gold focus ring would vanish (see `data-ground` in
 * app.css). With an action, the action's own tap area is the right padding.
 */
export function snackbarProps(withAction: boolean): { className: string; 'data-ground': 'ink' } {
  return {
    className: `flex min-h-12 items-center gap-3 rounded-control bg-ink text-[0.875rem] text-bg leading-5 shadow-overlay ${withAction ? 'py-1 pr-1 pl-4' : 'px-4 py-2.5'}`,
    'data-ground': 'ink',
  };
}

/** The second, smaller line: what it was before. */
export const snackbarDetailClass = 'block text-[0.75rem] leading-4 opacity-75';

/** The one action: an underlined word, 36px to the eye and a 44px tap. */
export function SnackbarAction({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-[0.75rem] border-4 border-transparent bg-clip-padding [--tap-inset:0.25rem] px-2 font-bold underline underline-offset-3 hover:bg-bg/10 ${className ?? ''}`}
      {...props}
    />
  );
}
