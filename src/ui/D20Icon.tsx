import type { LucideProps } from 'lucide-react';

/**
 * The d20, the one icon Lucide does not have (DS-001): rolling is a d20, not
 * Lucide's `Dices` (two six-sided dice), since the d20 is the die this game
 * turns on. Drawn on Lucide's 24px grid from its own hexagon, with round caps
 * and joins and `currentColor`, so it sits beside the others and takes the
 * colour of the text next to it.
 *
 * It takes a Lucide icon's `size`, `strokeWidth`, `absoluteStrokeWidth` and
 * `className`. Where Lucide uses one weight it uses three: the outline at the
 * stroke width, the front face at three quarters of it, the nine facet lines
 * at half (2, 1.5 and 1 by default), which keeps a fully faceted die open at
 * 16px. Use it at 14px and up. It has no spark, so it never reads as the logo.
 */
export function D20Icon({
  size = 24,
  strokeWidth = 2,
  absoluteStrokeWidth = false,
  color = 'currentColor',
  className,
  ...props
}: LucideProps) {
  const px = Number(size);
  // As Lucide does: an absolute width stays that many pixels at any size.
  const outline = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / px : Number(strokeWidth);
  // Decorative, as a Lucide icon is, unless the caller names it.
  const named = props['aria-label'] !== undefined || props['aria-labelledby'] !== undefined;
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: hidden unless named by aria-label or aria-labelledby, which the rule cannot see through
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={named ? undefined : true}
      role={named ? 'img' : undefined}
      className={className}
      {...props}
    >
      <path
        strokeWidth={outline}
        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
      />
      <path strokeWidth={outline * 0.75} d="M12 7.5 16.5 15.3H7.5Z" />
      <path
        strokeWidth={outline * 0.5}
        d="M12 2.5v5M3.6 16.8l3.9-1.5M20.4 16.8l-3.9-1.5M3.6 7.2 12 7.5l8.4-.3M3.6 7.2l3.9 8.1L12 21.5l4.5-6.2 3.9-8.1"
      />
    </svg>
  );
}
