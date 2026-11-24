import { HeartCrack, Shield } from 'lucide-react';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import { type HpChange, type HpPoint, hpChange } from './hpChange';
import './hpCues.css';

/*
 * The HP card's cues for damage, healing and temp HP (reviewed as mocks, the
 * "recommended" set). Motion confirms a result here, as the design system asks:
 * each cue sits on what already carries HP, the number, the bar and the Temp
 * chip, and says how much moved.
 *
 * - Damage: the lost piece of the bar lingers in pale red and drains (D2); the
 *   number dips and goes red, and a tally drifts down beside it (D3); a big hit
 *   jolts the number and bar (D4).
 * - Healing: the gained piece of the bar arrives bright (H2); the number swells
 *   and goes green, and a tally rises beside it (H3).
 * - Temp HP: a glint across the chip and its striped piece, the shield pops (T2).
 * - Moments: a hit temp HP soaks stays cyan (M1); the shield breaks when the
 *   last temp HP goes (M2); a cracked heart and the jolt at 0 (M3); a stronger
 *   glow back from 0 (M4); the bar thickens for a beat as it changes colour
 *   (M5); taps in a row count up in one tally (M6).
 *
 * They play through the Web Animations API, so a tap mid-cue restarts it from
 * where it is rather than stacking, and where the API is missing (jsdom)
 * nothing plays. Reduced motion is asked here because app.css stops CSS motion
 * only: nothing moves or fades, and a cue holds its colour for a moment instead.
 * Screen readers hear none of it: the settled HP line says the result.
 */

type Part =
  | 'readout'
  | 'number'
  | 'tally-damage'
  | 'tally-heal'
  | 'tally-ward'
  | 'heart'
  | 'meter'
  | 'trail'
  | 'bloom'
  | 'cap-flash'
  | 'cap-sheen'
  | 'chip'
  | 'chip-flash'
  | 'chip-sheen'
  | 'shield'
  | 'glow';

/** Marks an element of the HP card as one a cue moves. */
export const cuePart = (name: Part) => ({ 'data-hp-cue': name }) as const;

const MINUS = '−';
/**
 * How long a tally shows after its last change: the second the HP line waits
 * before it is said (HP_SETTLE_MS), so taps in a row count up in one tally.
 */
const TALLY_MS = 1000;
/** How long a colour holds under reduced motion. */
const HOLD_MS = 600;
/**
 * A change made in the HP sheet plays this long after the sheet starts to go:
 * it takes half a second, and covers the card until about half of it has.
 */
export const AFTER_SHEET_MS = 250;

/** The animation each element plays, by what it is for: a new one of a kind replaces the last. */
const playing = new WeakMap<Element, Map<string, Animation>>();
/** A tally's running total while it shows. */
const totals = new WeakMap<Element, number>();
/** Where the bloom starts while it shows. */
const bloomFrom = new WeakMap<Element, number>();

function play(
  el: Element | null,
  key: string,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): void {
  if (el === null) return;
  let mine = playing.get(el);
  if (mine === undefined) {
    mine = new Map();
    playing.set(el, mine);
  }
  mine.get(key)?.cancel();
  mine.set(key, el.animate(frames, options));
}

const showing = (el: Element, key: string) => playing.get(el)?.get(key)?.playState === 'running';

interface Stage {
  readonly root: HTMLElement;
  readonly at: (name: Part) => HTMLElement | null;
  /** Reduced motion. */
  readonly still: boolean;
  readonly maxHp: number;
}

/** The bar's width for an amount of HP, in percent, as the fill draws it. */
const share = (s: Stage, hp: number) =>
  s.maxHp > 0 ? Math.max(0, Math.min(1, hp / s.maxHp)) * 100 : 0;

/**
 * A glow that is already showing is held, not fired again, so a run of taps
 * never flashes more than three times a second (WCAG 2.3.1).
 */
function glow(el: HTMLElement | null, peak: number, rise: number, hold: number, fall: number) {
  if (el === null) return;
  const from = Number.parseFloat(getComputedStyle(el).opacity) || 0;
  const total = rise + hold + fall;
  play(
    el,
    'glow',
    [
      { opacity: from },
      { opacity: peak, offset: rise / total },
      { opacity: peak, offset: (rise + hold) / total },
      { opacity: 0 },
    ],
    { duration: total },
  );
}

/** The number in a role's colour for a beat, then back to its own. */
function tint(s: Stage, role: 'danger' | 'heal', ms: number) {
  const colour = getComputedStyle(s.root).getPropertyValue(`--cg-${role}`).trim();
  if (colour === '') return;
  play(
    s.at('number'),
    'tint',
    s.still
      ? [{ color: colour }, { color: colour }]
      : [{ color: colour }, { color: colour, offset: 0.45 }],
    { duration: s.still ? HOLD_MS : ms, easing: 'ease-out' },
  );
}

const dip = (px: number): Keyframe[] => [
  { transform: 'translateY(0)' },
  { transform: `translateY(${px}px)`, offset: 0.3 },
  { transform: 'translateY(0)' },
];
const swell = (scale: number): Keyframe[] => [
  { transform: 'scale(1)' },
  { transform: `scale(${scale})`, offset: 0.35 },
  { transform: 'scale(1)' },
];

/** Added to whatever else moves the same element, so a dip and a jolt together still add up. */
function nudge(els: readonly (HTMLElement | null)[], key: string, frames: Keyframe[], ms: number) {
  for (const el of els) {
    play(el, key, frames, { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)', composite: 'add' });
  }
}

/** The tally across the number from each: one direction shows there at a time. */
const OPPOSITE = { 'tally-damage': 'tally-heal', 'tally-heal': 'tally-damage' } as const;

/**
 * Counts up in place while it shows (M6), and drifts away once the taps stop.
 * One beside the number cuts the other direction's short: they share the spot.
 */
function tally(
  s: Stage,
  name: 'tally-damage' | 'tally-heal' | 'tally-ward',
  amount: number,
  sign: string,
  dx: number,
  dy: number,
) {
  const el = s.at(name);
  if (el === null) return;
  if (name !== 'tally-ward') {
    const other = s.at(OPPOSITE[name]);
    if (other !== null) playing.get(other)?.get('tally')?.cancel();
  }
  const again = showing(el, 'tally');
  const total = (again ? (totals.get(el) ?? 0) : 0) + amount;
  totals.set(el, total);
  el.textContent = `${sign}${total}`;
  if (s.still) {
    play(el, 'tally', [{ opacity: 1 }, { opacity: 1 }], { duration: TALLY_MS });
    return;
  }
  const at = (p: number, scale = 1) => `translate(${dx * p}px, ${dy * p}px) scale(${scale})`;
  play(
    el,
    'tally',
    [
      again ? { opacity: 1, transform: at(0.3, 1.18) } : { opacity: 0, transform: at(0, 0.8) },
      { opacity: 1, transform: at(0.3), offset: again ? 0.14 : 0.16 },
      { opacity: 1, transform: at(0.5), offset: 0.6 },
      { opacity: 0, transform: at(1) },
    ],
    { duration: TALLY_MS, easing: 'ease-out' },
  );
}

/** The lost piece of the bar lingers, then drains. Taps in a row extend one trail from its top. */
function trail(s: Stage, before: HpPoint, after: HpPoint) {
  const el = s.at('trail');
  const meter = s.at('meter');
  if (el === null || meter === null) return;
  let from = share(s, before.currentHp);
  if (showing(el, 'trail')) {
    from = Math.max(from, (el.getBoundingClientRect().width / (meter.clientWidth || 1)) * 100);
  }
  const to = share(s, after.currentHp);
  const held = { width: `${from}%`, opacity: 1 };
  play(
    el,
    'trail',
    s.still
      ? [held, held]
      : [
          held,
          { ...held, offset: 0.54, easing: 'cubic-bezier(.4,0,.2,1)' },
          { width: `${to}%`, opacity: 1, offset: 0.97 },
          { width: `${to}%`, opacity: 0 },
        ],
    { duration: s.still ? 500 : 740 },
  );
}

/** The gained piece of the bar arrives bright and settles into the fill. */
function bloom(s: Stage, before: HpPoint, after: HpPoint) {
  const el = s.at('bloom');
  if (el === null) return;
  const to = share(s, after.currentHp);
  let from = share(s, before.currentHp);
  if (showing(el, 'bloom')) from = Math.min(from, bloomFrom.get(el) ?? from);
  bloomFrom.set(el, from);
  el.style.left = `${from}%`;
  el.style.width = `${Math.max(0, to - from)}%`;
  play(
    el,
    'bloom',
    s.still
      ? [{ opacity: 1 }, { opacity: 1 }]
      : [{ opacity: 1 }, { opacity: 1, offset: 0.36 }, { opacity: 0 }],
    { duration: s.still ? 500 : 560, easing: 'ease-out' },
  );
}

/** The chip's shield cracks in two and falls away (M2). */
function shatter(s: Stage) {
  const shield = s.at('shield');
  if (shield === null) return;
  play(
    shield.querySelector(':scope > svg'),
    'hide',
    [{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }],
    {
      duration: 520,
    },
  );
  shield.querySelectorAll('.hp-shard').forEach((el, i) => {
    const side = i === 0 ? -1 : 1;
    play(
      el,
      'shard',
      [
        { opacity: 1, transform: 'translate(0, 0) rotate(0deg)' },
        {
          opacity: 1,
          transform: `translate(${side * 2}px, 0) rotate(${side * 6}deg)`,
          offset: 0.25,
        },
        { opacity: 0, transform: `translate(${side * 7}px, 6px) rotate(${side * 24}deg)` },
      ],
      { duration: 480, easing: 'cubic-bezier(.3,.6,.4,1)' },
    );
  });
}

const pop = (el: HTMLElement | null, scale: number, ms: number) =>
  play(el, 'pop', swell(scale), { duration: ms, easing: 'ease-out' });

const sweep = (el: HTMLElement | null, delay: number) =>
  play(el, 'sweep', [{ transform: 'translateX(-110%)' }, { transform: 'translateX(110%)' }], {
    duration: 560,
    delay,
    easing: 'cubic-bezier(.4,0,.2,1)',
  });

/** Plays what one change to HP says, on the card `root` marks with `cuePart`. */
export function playHpCues(
  root: HTMLElement,
  before: HpPoint,
  after: HpPoint,
  change: HpChange,
  maxHp: number,
  still: boolean,
): void {
  // Without Web Animations nothing plays, and no tally text is left standing.
  if (typeof root.animate !== 'function') return;
  const s: Stage = {
    root,
    still,
    maxHp,
    at: (name) => root.querySelector<HTMLElement>(`[data-hp-cue="${name}"]`),
  };
  const moving = !still;

  // Temp HP took it: cyan, never red, as current HP held (M1).
  if (change.soaked > 0) {
    if (moving) {
      pop(s.at('chip'), 1.1, 240);
      glow(s.at('chip-flash'), 0.4, 60, 100, 260);
      glow(s.at('cap-flash'), 0.9, 60, 100, 260);
    }
    tally(s, 'tally-ward', change.soaked, MINUS, -12, 0);
  }
  if (change.shieldBroke && moving) shatter(s);

  if (change.lost > 0) {
    trail(s, before, after);
    if (moving) nudge([s.at('readout')], 'knock', dip(3), 240);
    tint(s, 'danger', 560);
    tally(s, 'tally-damage', change.lost, MINUS, 0, 14);
  }
  if (change.big && moving) nudge([s.at('readout'), s.at('meter')], 'recoil', dip(4), 200);
  if (change.down) {
    play(
      s.at('heart'),
      'heart',
      still
        ? [{ opacity: 1 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'scale(.5)' },
            { opacity: 1, transform: 'scale(1.2)', offset: 0.18 },
            { opacity: 1, transform: 'scale(1)', offset: 0.3 },
            { opacity: 1, transform: 'scale(1)', offset: 0.75 },
            { opacity: 0, transform: 'scale(1)' },
          ],
      { duration: 1100, easing: 'ease-out' },
    );
  }

  if (change.gained > 0) {
    bloom(s, before, after);
    if (moving) {
      play(s.at('number'), 'lift', swell(change.up ? 1.1 : 1.06), {
        duration: change.up ? 380 : 320,
        easing: 'cubic-bezier(.2,.8,.3,1)',
      });
      if (change.up) glow(s.at('glow'), 1, 120, 200, 420);
    }
    tint(s, 'heal', change.up ? 800 : 560);
    tally(s, 'tally-heal', change.gained, '+', 0, -14);
  }

  if (change.warded && moving) {
    sweep(s.at('chip-sheen'), 0);
    sweep(s.at('cap-sheen'), 80);
    pop(s.at('shield'), 1.3, 260);
  }

  // The colour change is the cue: one beat of thickness so it is seen (M5).
  if (change.bandChanged && moving) {
    play(
      s.at('meter'),
      'beat',
      [
        { transform: 'scaleY(1)' },
        { transform: 'scaleY(1.8)', offset: 0.35 },
        { transform: 'scaleY(1)' },
      ],
      { duration: 260, easing: 'ease-out', composite: 'add' },
    );
  }
}

/**
 * Max HP as the card's meter states it, so the hook can run before the sheet
 * that works it out has loaded. 0 without a meter (no max HP yet).
 */
const maxOf = (root: HTMLElement) =>
  Number(root.querySelector('[data-hp-cue="meter"]')?.getAttribute('aria-valuemax')) || 0;

/**
 * Cues the card marked by the returned ref whenever HP changes, from what
 * changed. The first reading for a character, the one after switching
 * character, and any while current HP still follows max HP (`follows`: not yet
 * in play, so a new maximum is not healing) only set the baseline. While `hold`
 * is on (the HP sheet is up) the change waits, and plays as the sheet goes.
 */
export function useHpCues({
  id,
  currentHp,
  tempHp,
  follows,
  hold,
}: {
  id: string;
  currentHp: number;
  tempHp: number;
  follows: boolean;
  hold: boolean;
}): RefObject<HTMLElement | null> {
  const root = useRef<HTMLElement>(null);
  const seen = useRef<{ id: string; at: HpPoint } | null>(null);
  const waited = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const now: HpPoint = { currentHp, tempHp };
    const last = seen.current;
    if (last === null || last.id !== id || follows) {
      seen.current = { id, at: now };
      waited.current = false;
      return;
    }
    if (last.at.currentHp === currentHp && last.at.tempHp === tempHp) {
      if (!hold) waited.current = false;
      return;
    }
    if (hold) {
      waited.current = true;
      return;
    }
    seen.current = { id, at: now };
    const el = root.current;
    if (el === null) return;
    const maxHp = maxOf(el);
    const change = hpChange(last.at, now, maxHp);
    if (change === null) return;
    const go = () => playHpCues(el, last.at, now, change, maxHp, prefersReducedMotion());
    if (waited.current) {
      waited.current = false;
      clearTimeout(timer.current);
      timer.current = setTimeout(go, AFTER_SHEET_MS);
    } else go();
  }, [id, currentHp, tempHp, follows, hold]);
  return root;
}

/** The tallies and the cracked heart, inside the span that holds the HP number. */
export function NumberCues() {
  return (
    <>
      <span {...cuePart('tally-damage')} aria-hidden="true" className="hp-tally hp-tally-damage" />
      <span {...cuePart('tally-heal')} aria-hidden="true" className="hp-tally hp-tally-heal" />
      <span {...cuePart('heart')} aria-hidden="true" className="hp-heart">
        <HeartCrack size={20} />
      </span>
    </>
  );
}

/** The Temp chip's flash and glint, clipped to its pill, and the tally of what it soaked. */
export function ChipCues() {
  return (
    <>
      <span aria-hidden="true" className="hp-clip">
        <span {...cuePart('chip-flash')} className="hp-flash" />
        <span {...cuePart('chip-sheen')} className="hp-sheen" />
      </span>
      <span {...cuePart('tally-ward')} aria-hidden="true" className="hp-tally hp-tally-ward" />
    </>
  );
}

/** The Temp chip's shield, with the two halves it breaks into. */
export function CueShield() {
  return (
    <span {...cuePart('shield')} className="relative inline-flex">
      <Shield size={14} aria-hidden="true" />
      <span aria-hidden="true" className="hp-shard hp-shard-left">
        <Shield size={14} />
      </span>
      <span aria-hidden="true" className="hp-shard hp-shard-right">
        <Shield size={14} />
      </span>
    </span>
  );
}

/** The striped temp piece's flash and glint. */
export function CapCues() {
  return (
    <>
      <span {...cuePart('cap-flash')} aria-hidden="true" className="hp-flash" />
      <span {...cuePart('cap-sheen')} aria-hidden="true" className="hp-sheen" />
    </>
  );
}

/** The pale trail under the bar's fill: first in the meter, so the fill covers it. */
export function TrailCue() {
  return <div {...cuePart('trail')} aria-hidden="true" className="hp-trail" />;
}

/** The bright piece over the bar's fill: after the fill in the meter. */
export function BloomCue() {
  return <div {...cuePart('bloom')} aria-hidden="true" className="hp-bloom" />;
}

/** The card's green edge, back from 0: last in the card. */
export function GlowCue() {
  return <div {...cuePart('glow')} aria-hidden="true" className="hp-glow" />;
}
