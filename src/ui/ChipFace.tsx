import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useAnimateConditions } from '@/lib/conditionMotion';
import { useConditionSheetOpen } from '@/stores/conditionSheet';
import './chipFace.css';
import { LiftMark, useLiftArrival } from './Lift';

export type ChipLook =
  | 'Poisoned'
  | 'Blinded'
  | 'Restrained'
  | 'Grappled'
  | 'Exhaustion'
  | 'Invisible'
  | 'Frightened'
  | 'Prone'
  | 'Paralyzed'
  | 'Stunned'
  | 'Unconscious'
  | 'Incapacitated'
  | 'Petrified';

/**
 * What a condition looks like on a control: the pieces inside it, the pieces
 * over it (the only ones that leave its edge), and how the face itself moves.
 * Their looks and keyframes are in `chipFace.css`.
 */
const LOOKS: Readonly<
  Record<ChipLook, { parts: readonly string[]; over?: readonly string[]; body?: string }>
> = {
  Poisoned: { parts: ['cx-liquid', 'cx-bubble', 'cx-bubble cx-bubble2'] },
  Blinded: { parts: ['cx-fog', 'cx-fog cx-fog2'] },
  Restrained: { parts: ['cx-chain', 'cx-chain cx-chain2'] },
  // Its two wrists stay still, so they are the layer's own, not moving pieces.
  Grappled: {
    parts: [
      'cx-prong',
      'cx-prong cx-prong-below',
      'cx-prong cx-prong-right',
      'cx-prong cx-prong-right cx-prong-below',
    ],
  },
  Exhaustion: { parts: ['cx-charge'] },
  Invisible: { parts: ['cx-ghost', 'cx-glint'] },
  Frightened: { parts: ['cx-vignette'], body: 'cx-body-cower' },
  Prone: { parts: ['cx-pile'], body: 'cx-body-fallen' },
  Paralyzed: { parts: ['cx-lit', 'cx-bolt', 'cx-bolt cx-bolt2'], body: 'cx-body-rigid' },
  Stunned: { parts: ['cx-wash'], over: ['cx-star', 'cx-star cx-star2', 'cx-star cx-star3'] },
  Unconscious: { parts: ['cx-dusk'], over: ['cx-z', 'cx-z cx-z2', 'cx-z cx-z3'] },
  Incapacitated: { parts: ['cx-strike'] },
  Petrified: {
    parts: ['cx-course', 'cx-course cx-course2', 'cx-course cx-course3'],
    body: 'cx-body-thud',
  },
};

export function isChipLook(id: string): id is ChipLook {
  return Object.hasOwn(LOOKS, id);
}

/** What a control wears, worked out by whoever knows what reaches it. */
export interface ChipWear {
  /** Every condition that reaches it, newest first. */
  looks: readonly ChipLook[];
  /** "Ignore once" is armed for its roll. */
  ignored: boolean;
  /** 2024 exhaustion's penalty on the roll: a negative amount. */
  penalty?: number;
}

/**
 * For a control that wears nothing for now but can again, such as a casting chip
 * while its spell runs: its face stays on, so what it wore fades.
 */
export const NOT_WORN: ChipWear = { looks: [], ignored: false };

/**
 * The controls a face can fill, each sized in `chipFace.css`:
 *
 * - `chip`: a roll chip, in its own tone.
 * - `cast`: a small outline button.
 * - `save`: a button with a label at one end and a number at the other.
 * - `cell`: a cell of the Play tab's stat strip, in a strip that clips.
 * - `tile`: a whole ability tile, which holds buttons of its own, so only its
 *   number (`cx-move`) moves.
 * - `card`: a list card. It takes the tint and ring, and the motion and the flash
 *   run in a slim strip above its first row.
 */
export type WearSurface = 'chip' | 'cast' | 'save' | 'cell' | 'tile' | 'card';

/** How long the arrival and the roll's flash take, and removal. */
const MOMENT_MS = 480;
const LEAVE_MS = 200;
/** How long a roll's total stays on a chip. */
export const TOTAL_MS = 1600;

/** What a control is doing, kept between renders. */
export interface ChipMoments {
  shown: ChipWear;
  rolls: number;
  /** Its own roll spent "Ignore once": it stays plain until its total clears. */
  spent: boolean;
  arriving: boolean;
  flashing: boolean;
  /** Restarts the flash, by keying it. */
  flash: number;
  /** What it wore before it lost its last condition, while that fades. */
  leaving: ChipWear | null;
}

export function restingMoments(wear: ChipWear, rolls: number): ChipMoments {
  return {
    shown: wear,
    rolls,
    spent: false,
    arriving: false,
    flashing: false,
    flash: 0,
    leaving: null,
  };
}

const sameWear = (a: ChipWear, b: ChipWear) =>
  a.ignored === b.ignored && a.penalty === b.penalty && a.looks.join() === b.looks.join();

/**
 * The next state of a control, or the same object when nothing changed. A wear
 * it mounted with never plays, so a tab change or a load shows it at rest; only
 * a change while it is on screen does.
 */
export function nextMoments(
  m: ChipMoments,
  input: {
    wear: ChipWear;
    rolls: number;
    /** The roll's total is on the control, or in the toast for it. */
    showing: boolean;
    /** A condition sheet is over the page: the control keeps what it showed. */
    held: boolean;
    /** Off in Settings: every change lands at once. */
    animate: boolean;
  },
): ChipMoments {
  // With nothing to play, there is nothing to wait for.
  const holding = input.held && input.animate;
  const wear = holding ? m.shown : input.wear;
  const had = m.shown;
  const has = wear.looks.length > 0;
  const rolled = input.rolls !== m.rolls;
  let spent = m.spent;
  let arrive = false;
  let flash = false;

  if (rolled) {
    if (had.ignored && !wear.ignored) spent = true;
    else if (spent) {
      // Rolled again before the total cleared, with the conditions back on.
      spent = false;
      arrive = true;
    } else flash = !wear.ignored;
  } else if (spent && !input.showing && !holding) {
    spent = false;
    arrive = true;
  } else if (had.ignored && !wear.ignored) {
    // Spent by another control's roll, or pressed off.
    arrive = true;
  }
  if (!spent && !wear.ignored && wear.looks.some((look) => !had.looks.includes(look))) {
    arrive = true;
  }
  arrive = arrive && has && input.animate && !wear.ignored;
  flash = flash && has && input.animate;

  const lostLast = !has && had.looks.length > 0;
  const fades = lostLast && input.animate && !had.ignored && !m.spent;
  const leaving = has ? null : fades ? had : m.leaving;

  const flashes = arrive || flash;
  if (!flashes && !rolled && spent === m.spent && leaving === m.leaving && sameWear(had, wear)) {
    return m;
  }
  return {
    shown: wear,
    rolls: input.rolls,
    spent,
    arriving: arrive || (m.arriving && has),
    flashing: flashes || (m.flashing && has),
    flash: flashes ? m.flash + 1 : m.flash,
    leaving,
  };
}

/**
 * The rolls of a control whose total lands in the toast, not on the control: it
 * counts them for the flash, and holds a spent "Ignore once" plain for as long
 * as a chip holds its total.
 */
export function useRollMoment() {
  const [state, setState] = useState({ rolls: 0, showing: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const rolled = useCallback(() => {
    setState((s) => ({ rolls: s.rolls + 1, showing: true }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState((s) => ({ ...s, showing: false })), TOTAL_MS);
  }, []);
  return { ...state, rolled };
}

/** One piece of a signature. */
function Part({ className }: { className: string }) {
  return <i className={`cx-p ${className}`} />;
}

/**
 * Inside a control that a condition can reach: the face that wears its
 * conditions, and the moments they play, as `chipFace.css` draws them. The
 * effect pieces are hidden from assistive tech and take no taps, so what the
 * control means is still said by its text and its cue (`RollEffectCue`), and the
 * control never moves under a finger.
 *
 * A control an effect in play can raise passes `lift`: its heal-green ring and
 * lift mark (`Lift.tsx`) are drawn on a layer that a condition moves with the
 * face, so Prone tips all three as one (the buffs canvas, round 7). The layer is
 * there whenever `lift` is given, so its motion keeps time with the face's from
 * the moment a condition arrives, and a ring that comes later only draws in.
 * One an effect lowered passes `down` too: the same edge in danger red.
 */
export function ChipFace({
  wear,
  rolls,
  showing,
  surface = 'chip',
  tone,
  lift,
  down = false,
  children,
}: {
  wear: ChipWear;
  /** How many rolls this control has made. */
  rolls: number;
  showing: boolean;
  surface?: WearSurface;
  /** A chip's plain colour, when it is not the roll blue. */
  tone?: 'danger' | 'heal' | undefined;
  /** An effect in play raised or lowered it; left out for a control nothing moves. */
  lift?: boolean | undefined;
  /** With `lift`: an effect lowered it, so its edge is the red one, chevrons down. */
  down?: boolean | undefined;
  children: ReactNode;
}) {
  const animate = useAnimateConditions();
  const held = useConditionSheetOpen();
  const liftArriving = useLiftArrival(lift === true);
  const [state, setState] = useState(() => restingMoments(wear, rolls));
  // Worked out in render, as the control draws: from an effect, the new look
  // would paint for a frame before its arrival started.
  const m = nextMoments(state, { wear, rolls, showing, held, animate });
  if (m !== state) setState(m);

  const { flash, flashing, leaving } = m;
  useEffect(() => {
    if (!flashing) return;
    const timer = setTimeout(
      () => setState((s) => (s.flash === flash ? { ...s, flashing: false, arriving: false } : s)),
      MOMENT_MS,
    );
    return () => clearTimeout(timer);
  }, [flash, flashing]);
  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(() => setState((s) => ({ ...s, leaving: null })), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  const worn = leaving ?? m.shown;
  // The two newest show; the rest are a count at the corner.
  const looks = worn.looks.slice(0, 2);
  const lead = looks[0];
  const ignored = lead !== undefined && leaving === null && (m.shown.ignored || m.spent);
  // The newest condition that moves the control moves it.
  const body = ignored ? undefined : looks.map((look) => LOOKS[look].body).find(Boolean);
  const extra = worn.looks.length - looks.length;
  const root = [
    'cx',
    surface !== 'chip' && `cx-at-${surface}`,
    tone !== undefined && `cx-tone-${tone}`,
    lead !== undefined && `cx-on cx-${lead.toLowerCase()}`,
    looks.length > 1 && 'cx-two',
    m.arriving && 'cx-arrive',
    leaving !== null && 'cx-rm',
    ignored && 'cx-ig',
    !animate && 'cx-still',
    lift === true && 'cx-lifted',
  ]
    .filter(Boolean)
    .join(' ');

  const card = surface === 'card';
  const moved = (name: string) => (body === undefined ? name : `${name} ${body}`);
  const pieces = looks.map((look) => (
    <span key={look} className={`cx-layer cx-${look.toLowerCase()}`}>
      {LOOKS[look].parts.map((part) => (
        <Part key={part} className={part} />
      ))}
    </span>
  ));
  const surge = m.flashing && <Part key={m.flash} className="cx-surge" />;
  const tags = (
    <>
      {leaving === null && !ignored && m.shown.penalty !== undefined && (
        <span className="cx-tag cx-exhaustion text-overline" aria-hidden="true">
          {`−${Math.abs(m.shown.penalty)}`}
        </span>
      )}
      {!ignored && extra > 0 && (
        <span className="cx-tag cx-more text-overline" aria-hidden="true">
          {`+${extra}`}
        </span>
      )}
    </>
  );

  return (
    <span className={root}>
      <span className={card ? 'cx-face' : moved('cx-face')}>
        {lead !== undefined && (
          <span className="cx-mat" aria-hidden="true">
            {card
              ? looks.map((look) => (
                  <span key={look} className={`cx-layer cx-${look.toLowerCase()}`} />
                ))
              : pieces}
            {lead !== 'Invisible' && <Part className="cx-ring" />}
            {!card && surge}
          </span>
        )}
        {ignored && <i className="cx-p cx-ignore-ring" aria-hidden="true" />}
        {/* Armed for Ignore once it is empty, but keeps its place: the rows under it
            are targets, and a roll brings the strip back as a finger reaches for one. */}
        {card && lead !== undefined && (
          <span className={moved('cx-strip')} aria-hidden="true">
            {!ignored && (
              <span className="cx-mat">
                {pieces}
                {surge}
              </span>
            )}
            {tags}
          </span>
        )}
        <span className="cx-num">{children}</span>
      </span>
      {lead !== undefined && (
        <span className="cx-over" aria-hidden="true">
          {looks.map((look) => (
            <span key={look} className={`cx-layer cx-${look.toLowerCase()}`}>
              {LOOKS[look].over?.map((part) => (
                <Part key={part} className={part} />
              ))}
            </span>
          ))}
        </span>
      )}
      {/* The mark is a layer of its own, above every ring, so a raised
          neighbour's ring cannot cross it where it reaches over that neighbour. */}
      {lift !== undefined &&
        ['cx-lift', 'cx-lift cx-lift-top'].map((layer) => (
          <span
            key={layer}
            className={`${card ? layer : moved(layer)}${lift && down ? ' fx-down' : ''}${liftArriving ? ' fx-lift-arrive' : ''}`}
            aria-hidden="true"
          >
            {lift &&
              (layer === 'cx-lift' ? <i className="fx-lift-ring" /> : <LiftMark down={down} />)}
          </span>
        ))}
      {!card && tags}
    </span>
  );
}
