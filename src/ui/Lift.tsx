import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAnimateConditions } from '@/lib/conditionMotion';
import './lift.css';

/**
 * The lift mark: two chevrons whose ink, strokes included, is centred in its
 * circle (the buffs canvas, Wear A). Lucide's chevrons-up sits a pixel high.
 * `down` turns them over, for a number an effect lowered.
 */
export function LiftIcon({ className, down = false }: { className?: string; down?: boolean }) {
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
      {down ? (
        <>
          <path d="m18 4.5-6 6-6-6" />
          <path d="m18 13.5-6 6-6-6" />
        </>
      ) : (
        <>
          <path d="m18 10.5-6-6-6 6" />
          <path d="m18 19.5-6-6-6 6" />
        </>
      )}
    </svg>
  );
}

/** How long the ring takes to draw in. */
const ARRIVE_MS = 480;

/**
 * Whether a ring is drawing in: for its first 480ms after `on` turns true while
 * on screen, unless condition motion is off. One that mounts on does not.
 */
export function useLiftArrival(on: boolean): boolean {
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
  return arriving;
}

/**
 * The lift mark in its circle, which the ring's control places: heal green, or
 * danger red with its chevrons down inside an `fx-down` edge. The icon is in px
 * as its 16px circle is, so larger text cannot push it out.
 */
export function LiftMark({ down = false }: { down?: boolean }) {
  return (
    <span className="fx-lift-mark" aria-hidden="true">
      <LiftIcon className="size-[10px]" down={down} />
    </span>
  );
}

/**
 * A number an effect in play raised: a ring in heal green around its control
 * and a small lift mark at its bottom right (the buffs canvas, Wear A). One an
 * effect lowered (`down`) wears the same edge in danger red, its chevrons
 * pointing down: the default look for a homebrew condition's penalty. A
 * condition owns a chip's face; a buff or a debuff owns its edge, so a chip can
 * wear both. It sits still, drawing in only as the effect arrives, so it is for
 * a control nothing moves: a control a condition can move draws its ring on
 * `ChipFace` (`lift`), which moves it with the face. The mark says nothing to a
 * screen reader: the control names what raised or lowered it.
 */
export function Lift({
  on,
  down = false,
  className = '',
  children,
}: {
  on: boolean;
  /** An effect lowered it: the red edge, chevrons down. */
  down?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const arriving = useLiftArrival(on);
  return (
    <span
      className={`fx-lift ${on ? 'fx-lift-on' : ''} ${on && down ? 'fx-down' : ''} ${arriving ? 'fx-lift-arrive' : ''} ${className}`}
    >
      {children}
      {on && <LiftMark down={down} />}
    </span>
  );
}
