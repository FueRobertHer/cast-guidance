import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAnimateConditions } from '@/lib/conditionMotion';
import './lift.css';

/**
 * The lift mark: two chevrons whose ink, strokes included, is centred in its
 * circle (the buffs canvas, Wear A). Lucide's chevrons-up sits a pixel high.
 */
export function LiftIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m18 10.5-6-6-6 6" />
      <path d="m18 19.5-6-6-6 6" />
    </svg>
  );
}

/** How long the ring takes to draw in. */
const ARRIVE_MS = 480;

/**
 * A number an effect in play raised: a ring in heal green around its control
 * and a small lift mark at its bottom right (the buffs canvas, Wear A). A
 * condition owns a chip's face; a buff owns its edge, so a chip can wear both.
 * It sits still, drawing in only as the effect arrives. The mark says nothing
 * to a screen reader: the control names what raised it.
 */
export function Lift({
  on,
  className = '',
  children,
}: {
  on: boolean;
  className?: string;
  children: ReactNode;
}) {
  const animate = useAnimateConditions();
  const was = useRef(on);
  const [arriving, setArriving] = useState(false);
  useEffect(() => {
    const came = on && !was.current;
    was.current = on;
    if (!came || !animate) return;
    setArriving(true);
    const timer = setTimeout(() => setArriving(false), ARRIVE_MS);
    return () => clearTimeout(timer);
  }, [on, animate]);
  return (
    <span
      className={`fx-lift ${on ? 'fx-lift-on' : ''} ${arriving ? 'fx-lift-arrive' : ''} ${className}`}
    >
      {children}
      {on && (
        <span className="fx-lift-mark" aria-hidden="true">
          <LiftIcon className="size-2.5" />
        </span>
      )}
    </span>
  );
}
