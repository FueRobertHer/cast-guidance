import {
  type ComponentProps,
  cloneElement,
  isValidElement,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from 'react';
import { type DialogProps, Drawer } from 'vaul';

/**
 * The app's bottom sheet: vaul's `Drawer` with its iOS scroll lock turned off.
 *
 * vaul's `preventScrollMobileSafari` records the scroll position, calls
 * `window.scrollTo(0, 0)`, and pins the page there with a scroll listener that
 * re-runs it, then scrolls back on close. Its own comments say a negative
 * margin on the body makes that invisible, but the shipped code never applies
 * one, so on iOS every sheet yanks the page to the top, holds it there, and
 * drops it back on dismiss. Tapping a spell for its description should not move
 * the list underneath it.
 *
 * `disablePreventScroll` is inverted: `true` (vaul's runtime default) runs that
 * hook and `false` skips it. vaul's own `.d.ts` documents the default as
 * `false`, which is wrong, so don't "correct" this from the hover text.
 *
 * Skipping it does not leave the page unlocked. Radix's dialog under vaul wraps
 * the sheet in react-remove-scroll, and that is what actually holds the
 * background still. It rides on the overlay, so a sheet has to render
 * `Sheet.Overlay` and stay `modal` to keep it. In a plain Safari tab vaul also
 * sets `position: fixed` on the body with a compensating `top` offset, but it
 * deliberately skips that in an installed PWA (`display-mode: standalone`),
 * which is the case where the jump was worst and nothing masked it.
 *
 * Keyboard handling is a separate prop (`repositionInputs`) and stays on, so a
 * sheet still lifts its input clear of the keyboard.
 *
 * `autoFocus` defaults to on (A11Y-003). vaul turns Radix's open-time focus
 * off unless asked, which left focus on the opener, now aria-hidden behind the
 * overlay, so a keyboard or screen-reader user had to Tab to find the sheet.
 * With it, focus moves to the sheet's first control (or the sheet itself) as
 * it opens. A sheet that wants focus elsewhere uses `onOpenAutoFocus` on its
 * `Sheet.Content` (Add item does, on touch screens).
 */
// The two props sit on opposite sides of the spread on purpose.
// `autoFocus` comes before it, so it is only a default: a sheet can pass
// `autoFocus={false}`. `disablePreventScroll` comes after it, so it always
// wins: no call site should want the broken hook back, and a passed-through
// `undefined` would restore it silently.
function SheetRoot(props: DialogProps) {
  return <Drawer.Root autoFocus {...props} disablePreventScroll={false} />;
}

// Unused today, but a nested sheet needs this more than a plain one does: vaul
// skips the `position: fixed` fallback entirely when `nested`.
function SheetNestedRoot(props: DialogProps) {
  return <Drawer.NestedRoot autoFocus {...props} disablePreventScroll={false} />;
}

/**
 * The look every bottom sheet shares (DS-001), so a sheet's own file only
 * holds what goes inside it:
 *
 *   <Sheet.Portal>
 *     <Sheet.Scrim />
 *     <Sheet.Panel aria-describedby={undefined}>
 *       <Sheet.Heading aside="Level 3">Fireball</Sheet.Heading>
 *       …
 *     </Sheet.Panel>
 *   </Sheet.Portal>
 *
 * `Scrim` is the overlay (it is what holds the page still; see SheetRoot), in
 * `scrim`. `Panel` is the content: `surface`, `sheet` top corners,
 * `shadow-overlay` and the grab handle, one column wide at most, its bottom
 * padding clear of the home indicator. vaul slides it up; reduced motion turns
 * that off app-wide. `Heading` is the sheet's title (its accessible name) in
 * `title-sheet`, with optional context on the right in `caption`. The confirm
 * goes last, as a `lg` block button in reach of a thumb, saying exactly what
 * will happen ("Take 7 damage").
 */
const SCRIM = 'fixed inset-0 z-40 bg-scrim';

function SheetScrim({ className, ...props }: ComponentProps<typeof Drawer.Overlay>) {
  return <Drawer.Overlay className={className ? `${SCRIM} ${className}` : SCRIM} {...props} />;
}

const PANEL =
  'fixed inset-x-0 bottom-0 z-50 mx-auto max-w-content rounded-t-sheet bg-surface px-4 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-ink shadow-overlay';

function SheetPanel({ className, children, ...props }: ComponentProps<typeof Drawer.Content>) {
  return (
    <Drawer.Content className={className ? `${PANEL} ${className}` : PANEL} {...props}>
      <div
        aria-hidden="true"
        className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-line-strong"
      />
      {children}
    </Drawer.Content>
  );
}

function SheetHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <Drawer.Title className="min-w-0 font-display text-title-sheet">{children}</Drawer.Title>
      {aside !== undefined && <span className="shrink-0 text-caption text-ink-muted">{aside}</span>}
    </div>
  );
}

/** A touch screen, where focusing a text box pops the on-screen keyboard up. */
export function touchScreen(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Where a sheet whose first control is a search box puts focus as it opens
 * (A11Y-003): Add item, + Effect. The box suits a keyboard; on a touch screen
 * focusing it pops the on-screen keyboard over the list it filters before
 * anyone asked to type. There the sheet itself takes focus instead, as a
 * screen reader expects, and a tap on the box brings the keyboard up. Pass it
 * as the panel's `onOpenAutoFocus`.
 */
export function focusSheetOnTouch(event: Event): void {
  if (!touchScreen()) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}

export const Sheet = {
  ...Drawer,
  Root: SheetRoot,
  NestedRoot: SheetNestedRoot,
  Scrim: SheetScrim,
  Panel: SheetPanel,
  Heading: SheetHeading,
};

/**
 * A sheet's trigger, standing in for the sheet itself until it is first used.
 *
 * Every mounted `Drawer.Root` costs a `window` scroll listener and a `window`
 * resize listener, installed by vaul's `usePositionFixed` with empty deps and
 * no check on whether the drawer is open. The info sheets are rendered one per
 * row, so a Play tab listing two hundred spells held two hundred scroll
 * listeners, every one of them reading `window.scrollY` on every scroll event.
 * That is what made scrolling stutter, and it cost the same again in React:
 * a Radix dialog context and, for the sheets that resolve their own content, a
 * registry subscription per row.
 *
 * A row the player never opens should cost a button. Pairing this with the
 * sheet's own body in a separate component is what keeps the hooks out of the
 * unopened case: hooks in the outer component run whether or not it is armed.
 *
 * The sheet mounts already open, because the arming click cannot also reach a
 * trigger that did not exist when it was pressed. Arming earlier, on pointer
 * down, does not work: the trigger moves from here into `Sheet.Trigger`, React
 * rebuilds the button, and the click never lands on the element that received
 * the press.
 */
export function SheetStandIn({ trigger, onArm }: { trigger: ReactNode; onArm: () => void }) {
  if (isValidElement<{ onClick?: (event: ReactMouseEvent) => void }>(trigger)) {
    return cloneElement(trigger, {
      // What Radix's own trigger advertises while its sheet is closed, so
      // deferring the sheet does not cost the button its announced role.
      'aria-haspopup': 'dialog',
      'aria-expanded': false,
      onClick: (event: ReactMouseEvent) => {
        trigger.props.onClick?.(event);
        onArm();
      },
    } as Partial<{ onClick?: (event: ReactMouseEvent) => void }>);
  }
  // Non-element triggers are not something the call sites pass, but a sheet
  // that cannot be opened at all is a worse failure than an extra wrapper.
  // Both rules below are about an element that is itself the control; here the
  // control is whatever the caller put inside, which keeps its own semantics.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the trigger inside carries the interaction
    // biome-ignore lint/a11y/noStaticElementInteractions: same, this span only forwards it
    <span className="contents" onClick={onArm}>
      {trigger}
    </span>
  );
}

/**
 * Open state for a sheet that only exists because it is being opened.
 *
 * `defaultOpen` looks like the obvious way to do this and is a trap: vaul
 * starts `shouldAnimate` at `!defaultOpen` and renders
 * `data-vaul-animate="false"`, which its own stylesheet turns into
 * `animation: none !important`. A sheet mounted with `defaultOpen` therefore
 * appears instantly, with no slide-up at all.
 *
 * `shouldAnimate` flips to true in a `requestAnimationFrame` registered when
 * the root mounts. Opening from a frame later means vaul's callback has
 * already run, so the sheet animates exactly as one whose trigger was on
 * screen all along. The cost is a single frame between the press and the
 * slide starting, which is below noticing.
 */
export function useSheetOpenOnMount(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return [open, setOpen];
}
