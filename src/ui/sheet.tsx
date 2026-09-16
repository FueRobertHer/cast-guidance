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
 */
// After the spread, not before: there is no reason for a call site to want the
// broken hook back, and a passed-through `undefined` would restore it silently.
function SheetRoot(props: DialogProps) {
  return <Drawer.Root {...props} disablePreventScroll={false} />;
}

// Unused today, but a nested sheet needs this more than a plain one does: vaul
// skips the `position: fixed` fallback entirely when `nested`.
function SheetNestedRoot(props: DialogProps) {
  return <Drawer.NestedRoot {...props} disablePreventScroll={false} />;
}

export const Sheet = { ...Drawer, Root: SheetRoot, NestedRoot: SheetNestedRoot };
