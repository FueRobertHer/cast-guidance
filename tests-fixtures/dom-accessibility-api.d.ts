// dom-accessibility-api ships its own types, but its package.json "exports"
// has no "types" condition, so bundler resolution cannot reach them. This is
// the one function the a11y helper calls, as the package declares it.
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(
    root: Element,
    options?: {
      compute?: 'description' | 'name';
      computedStyleSupportsPseudoElements?: boolean;
      getComputedStyle?: typeof window.getComputedStyle;
      hidden?: boolean;
    },
  ): string;
}
