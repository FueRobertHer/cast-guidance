/**
 * Whether the device asks for reduced motion (A11Y-003). The stylesheet's
 * `prefers-reduced-motion` block stops CSS motion, but a smooth scroll asked
 * for from script (`scrollIntoView({ behavior: 'smooth' })`) is not CSS, so
 * the call site has to ask. False where `matchMedia` is missing.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** `smooth`, unless the device asks for reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
