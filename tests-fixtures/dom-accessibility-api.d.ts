// dom-accessibility-api ships its own types, but its package.json "exports"
// has no "types" condition, so bundler resolution cannot reach them. These are
// the functions the tests call, as the package declares them.
declare module 'dom-accessibility-api' {
  interface ComputeTextAlternativeOptions {
    compute?: 'description' | 'name';
    computedStyleSupportsPseudoElements?: boolean;
    getComputedStyle?: typeof window.getComputedStyle;
    hidden?: boolean;
  }
  export function computeAccessibleName(
    root: Element,
    options?: ComputeTextAlternativeOptions,
  ): string;
  export function computeAccessibleDescription(
    root: Element,
    options?: ComputeTextAlternativeOptions,
  ): string;
}
