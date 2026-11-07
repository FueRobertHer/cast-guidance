import { type ReactNode, useEffect, useState } from 'react';
import { useAnimateConditions } from '@/lib/conditionMotion';
import { useConditionSheetOpen } from '@/stores/conditionSheet';
import './chipFace.css';

export type ChipLook =
  | 'Poisoned'
  | 'Blinded'
  | 'Restrained'
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
 * What a condition looks like on a chip: the pieces inside it, the pieces over
 * it (the only ones that leave its edge), and how the face itself moves. Their
 * looks and keyframes are in `chipFace.css`.
 */
const LOOKS: Readonly<
  Record<ChipLook, { parts: readonly string[]; over?: readonly string[]; body?: string }>
> = {
  Poisoned: { parts: ['cx-liquid', 'cx-bubble', 'cx-bubble cx-bubble2'] },
  Blinded: { parts: ['cx-fog', 'cx-fog cx-fog2'] },
  Restrained: { parts: ['cx-bands'] },
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

/** What a chip wears, worked out by whoever knows what reaches its roll. */
export interface ChipWear {
  /** Every condition that reaches the roll, newest first. */
  looks: readonly ChipLook[];
  /** "Ignore once" is armed for the roll. */
  ignored: boolean;
  /** 2024 exhaustion's penalty on the roll: a negative amount. */
  penalty?: number;
}

/** How long the arrival and the roll's flash take, and removal. */
const MOMENT_MS = 480;
const LEAVE_MS = 200;

/** What a chip is doing, kept between renders. */
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
 * The next state of a chip, or the same object when nothing changed. A wear it
 * mounted with never plays, so a tab change or a load shows it at rest; only a
 * change while it is on screen does.
 */
export function nextMoments(
  m: ChipMoments,
  input: {
    wear: ChipWear;
    rolls: number;
    /** The roll's total is on the chip. */
    showing: boolean;
    /** A condition sheet is over the page: the chip keeps what it showed. */
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
    // Spent by another chip's roll, or pressed off.
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

/** One piece of a signature. */
function Part({ className }: { className: string }) {
  return <i className={`cx-p ${className}`} />;
}

/**
 * Inside an attack chip's button: the face that wears its conditions, and the
 * moments they play, as `chipFace.css` draws them. The effect pieces are hidden
 * from assistive tech and take no taps, so what the chip means is still said by
 * its text and its cue (`RollEffectCue`), and the button never moves under a
 * finger.
 */
export function ChipFace({
  wear,
  rolls,
  showing,
  children,
}: {
  wear: ChipWear;
  /** How many rolls this chip has made. */
  rolls: number;
  showing: boolean;
  children: ReactNode;
}) {
  const animate = useAnimateConditions();
  const held = useConditionSheetOpen();
  const [state, setState] = useState(() => restingMoments(wear, rolls));
  // Worked out in render, as the chip draws: from an effect, the new look would
  // paint for a frame before its arrival started.
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
  // The newest condition that moves the chip moves it.
  const body = ignored ? undefined : looks.map((look) => LOOKS[look].body).find(Boolean);
  const extra = worn.looks.length - looks.length;
  const root = [
    'cx',
    lead !== undefined && `cx-on cx-${lead.toLowerCase()}`,
    looks.length > 1 && 'cx-two',
    m.arriving && 'cx-arrive',
    leaving !== null && 'cx-rm',
    ignored && 'cx-ig',
    !animate && 'cx-still',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={root}>
      <span className={body === undefined ? 'cx-face' : `cx-face ${body}`}>
        {lead !== undefined && (
          <span className="cx-mat" aria-hidden="true">
            {looks.map((look) => (
              <span key={look} className={`cx-layer cx-${look.toLowerCase()}`}>
                {LOOKS[look].parts.map((part) => (
                  <Part key={part} className={part} />
                ))}
              </span>
            ))}
            {lead !== 'Invisible' && <Part className="cx-ring" />}
            {m.flashing && <Part key={m.flash} className="cx-surge" />}
          </span>
        )}
        {ignored && <i className="cx-p cx-ignore-ring" aria-hidden="true" />}
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
    </span>
  );
}
