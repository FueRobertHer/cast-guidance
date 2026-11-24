// @vitest-environment jsdom
// The HP card's cues over a stand-in card: what each change plays, and when.
// jsdom has no Web Animations, so `animate` is stubbed to record each call.
import { act, cleanup, render } from '@testing-library/react';
import type { CSSProperties } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AFTER_SHEET_MS,
  BloomCue,
  CapCues,
  ChipCues,
  CueShield,
  cuePart,
  GlowCue,
  NumberCues,
  TrailCue,
  useHpCues,
} from './HpCues';
import { fillShare } from './hpChange';

interface Call {
  part: string;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: Animation;
}
let calls: Call[] = [];

/** What an animated element is: its cue part, or its class, or its tag. */
const nameOf = (el: Element) =>
  el.getAttribute('data-hp-cue') ?? el.getAttribute('class') ?? el.tagName.toLowerCase();

beforeEach(() => {
  calls = [];
  Element.prototype.animate = vi.fn(function (
    this: Element,
    frames: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const animation = { cancel: vi.fn(), playState: 'running' } as unknown as Animation;
    calls.push({
      part: nameOf(this),
      frames: frames as Keyframe[],
      options: options as KeyframeAnimationOptions,
      animation,
    });
    return animation;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).animate;
});

const MAX = 42;
const ROLES = { '--cg-danger': '#ff8170', '--cg-heal': '#74d39f' } as CSSProperties;

function Card({
  id = 'a',
  hp,
  temp = 0,
  follows = false,
  hold = false,
}: {
  id?: string;
  hp: number;
  temp?: number;
  follows?: boolean;
  hold?: boolean;
}) {
  const root = useHpCues({ id, currentHp: hp, tempHp: temp, follows, hold });
  return (
    <section ref={root} style={ROLES}>
      <button type="button" {...cuePart('chip')}>
        <ChipCues />
        <CueShield />
        Temp HP
      </button>
      <div {...cuePart('readout')}>
        <span {...cuePart('number')}>
          {hp}
          <NumberCues />
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: the card's own meter is a div, for its temp HP cap */}
      <div {...cuePart('meter')} role="meter" aria-valuemax={MAX} aria-valuenow={hp}>
        <TrailCue />
        <div />
        <BloomCue />
        {temp > 0 && (
          <div>
            <CapCues />
          </div>
        )}
      </div>
      <GlowCue />
    </section>
  );
}

/** The card at one reading, then another: the cues the second one plays. */
function change(from: { hp: number; temp?: number }, to: { hp: number; temp?: number }) {
  const view = render(<Card {...from} />);
  view.rerender(<Card {...to} />);
  return view;
}

const parts = () => calls.map((c) => c.part);
const callsOn = (part: string) => calls.filter((c) => c.part === part);
const text = (view: ReturnType<typeof render>, part: string) =>
  view.container.querySelector(`[data-hp-cue="${part}"]`)?.textContent;
const moves = (c: Call) => c.frames.some((f) => f.transform !== undefined);
/** The newest animation an element was given. */
const newestOn = (part: string) => callsOn(part).at(-1)?.animation as Animation;
/** As the browser does when an animation ends, or is cancelled. */
const end = (animation: Animation, how: 'onfinish' | 'oncancel') =>
  animation[how]?.call(animation, {} as AnimationPlaybackEvent);

describe('useHpCues', () => {
  it('plays nothing for the first reading, which is only the baseline', () => {
    render(<Card hp={30} />);
    expect(calls).toEqual([]);
  });

  it('shows a hit: the trail, the dip, the number in red and a tally of what it took', () => {
    const view = change({ hp: 30 }, { hp: 25 });
    expect(parts()).toEqual(expect.arrayContaining(['trail', 'readout', 'number', 'tally-damage']));
    expect(text(view, 'tally-damage')).toBe('−5');
    const trail = callsOn('trail')[0];
    expect(trail?.frames[0]).toMatchObject({ width: `${(30 / MAX) * 100}%`, opacity: 1 });
    expect(trail?.frames.at(-1)).toMatchObject({ width: `${(25 / MAX) * 100}%`, opacity: 0 });
    expect(callsOn('number')[0]?.frames[0]).toMatchObject({ color: '#ff8170' });
    // Not a big hit: the bar itself stays put, and nothing is cyan.
    expect(parts()).not.toContain('meter');
    expect(text(view, 'tally-ward')).toBe('');
  });

  it('jolts the number and the bar for a hit of a quarter of max HP or more', () => {
    // 40 to 28 of 42 takes 12 and stays green, so the jolt is all the bar does.
    change({ hp: 40 }, { hp: 28 });
    const recoil = callsOn('meter');
    expect(recoil).toHaveLength(1);
    expect(recoil[0]?.options.composite).toBe('add');
  });

  it('counts taps in a row up in one tally', () => {
    const view = render(<Card hp={30} />);
    view.rerender(<Card hp={29} />);
    view.rerender(<Card hp={28} />);
    view.rerender(<Card hp={27} />);
    expect(text(view, 'tally-damage')).toBe('−3');
  });

  it('keeps a hit temp HP soaks cyan: the chip, its piece of the bar, no red', () => {
    const view = change({ hp: 30, temp: 8 }, { hp: 30, temp: 3 });
    expect(parts()).toEqual(
      expect.arrayContaining(['chip', 'chip-flash', 'cap-flash', 'tally-ward']),
    );
    expect(text(view, 'tally-ward')).toBe('−5');
    expect(parts()).not.toContain('trail');
    expect(parts()).not.toContain('number');
    expect(text(view, 'tally-damage')).toBe('');
  });

  it('breaks the shield when the last temp HP goes', () => {
    change({ hp: 30, temp: 3 }, { hp: 30, temp: 0 });
    expect(callsOn('hp-shard hp-shard-left')).toHaveLength(1);
    expect(callsOn('hp-shard hp-shard-right')).toHaveLength(1);
  });

  it('shows the cracked heart at 0', () => {
    change({ hp: 6 }, { hp: 0 });
    expect(parts()).toContain('heart');
    expect(parts()).toContain('meter');
  });

  it('shows healing: the bloom over the gained piece, the lift, green and a tally', () => {
    const view = change({ hp: 20 }, { hp: 25 });
    expect(parts()).toEqual(expect.arrayContaining(['bloom', 'number', 'tally-heal']));
    expect(text(view, 'tally-heal')).toBe('+5');
    const bloom = view.container.querySelector<HTMLElement>('[data-hp-cue="bloom"]');
    expect(Number.parseFloat(bloom?.style.left ?? '')).toBeCloseTo((20 / MAX) * 100);
    expect(Number.parseFloat(bloom?.style.width ?? '')).toBeCloseTo((5 / MAX) * 100);
    expect(parts()).not.toContain('glow');
  });

  it('glows the card back from 0', () => {
    change({ hp: 0 }, { hp: 7 });
    expect(parts()).toContain('glow');
  });

  it('glints across the chip and its piece of the bar as temp HP goes up', () => {
    change({ hp: 30 }, { hp: 30, temp: 8 });
    expect(parts()).toEqual(expect.arrayContaining(['chip-sheen', 'cap-sheen', 'shield']));
  });

  it('beats the bar once as it changes colour', () => {
    change({ hp: 24 }, { hp: 19 });
    const beat = callsOn('meter');
    expect(beat).toHaveLength(1);
    expect(beat[0]?.frames[1]).toMatchObject({ transform: 'scaleY(1.8)' });
  });

  it('waits while the HP sheet is up, and plays as it goes', () => {
    vi.useFakeTimers();
    const view = render(<Card hp={30} />);
    view.rerender(<Card hp={30} hold />);
    view.rerender(<Card hp={22} hold />);
    expect(calls).toEqual([]);
    view.rerender(<Card hp={22} />);
    expect(calls).toEqual([]);
    act(() => vi.advanceTimersByTime(AFTER_SHEET_MS));
    expect(text(view, 'tally-damage')).toBe('−8');
  });

  it('plays a change that lands as a sheet closes once the sheet has gone', () => {
    vi.useFakeTimers();
    const view = render(<Card hp={20} hold />);
    // A long rest: the HP and the sheet closing come in one update.
    view.rerender(<Card hp={42} />);
    expect(calls).toEqual([]);
    act(() => vi.advanceTimersByTime(AFTER_SHEET_MS));
    expect(text(view, 'tally-heal')).toBe('+22');
  });

  it('plays a change still waiting for a sheet before a newer one, which has the last word', () => {
    vi.useFakeTimers();
    const view = render(<Card hp={20} />);
    view.rerender(<Card hp={20} hold />);
    view.rerender(<Card hp={28} hold />);
    view.rerender(<Card hp={28} />);
    expect(calls).toEqual([]);
    // A tap before the heal from the sheet has played.
    view.rerender(<Card hp={27} />);
    expect(parts().filter((p) => p.startsWith('tally'))).toEqual(['tally-heal', 'tally-damage']);
    const played = calls.length;
    act(() => vi.advanceTimersByTime(AFTER_SHEET_MS));
    expect(calls).toHaveLength(played);
  });

  it('drops a change still waiting for a sheet on switching character', () => {
    vi.useFakeTimers();
    const view = render(<Card id="a" hp={30} />);
    view.rerender(<Card id="a" hp={30} hold />);
    view.rerender(<Card id="a" hp={22} hold />);
    view.rerender(<Card id="a" hp={22} />);
    view.rerender(<Card id="b" hp={12} />);
    act(() => vi.advanceTimersByTime(AFTER_SHEET_MS));
    expect(calls).toEqual([]);
  });

  it('lets one tally beside the number at a time: the newest direction', () => {
    const view = render(<Card hp={30} />);
    view.rerender(<Card hp={35} />);
    const heal = newestOn('tally-heal');
    view.rerender(<Card hp={33} />);
    expect(heal.cancel).toHaveBeenCalled();
    expect(text(view, 'tally-damage')).toBe('\u22122');
  });

  it('takes a tally\u2019s words away with it, not a newer count\u2019s', () => {
    const view = render(<Card hp={30} />);
    view.rerender(<Card hp={29} />);
    const first = newestOn('tally-damage');
    view.rerender(<Card hp={28} />);
    end(first, 'oncancel');
    expect(text(view, 'tally-damage')).toBe('\u22122');
    end(newestOn('tally-damage'), 'onfinish');
    expect(text(view, 'tally-damage')).toBe('');
  });

  it('raises the cyan glow at most three times a second, however fast the soaks come', () => {
    const view = render(<Card hp={30} temp={20} />);
    view.rerender(<Card hp={30} temp={19} />);
    view.rerender(<Card hp={30} temp={18} />);
    view.rerender(<Card hp={30} temp={17} />);
    expect(callsOn('chip-flash')).toHaveLength(1);
    expect(callsOn('cap-flash')).toHaveLength(1);
    expect(text(view, 'tally-ward')).toBe('\u22123');
  });

  it('places the bloom on the fill as drawn, squeezed by temp HP past the bar', () => {
    const view = change({ hp: 38, temp: 10 }, { hp: 40, temp: 10 });
    const bloom = view.container.querySelector<HTMLElement>('[data-hp-cue="bloom"]');
    const from = fillShare({ currentHp: 38, tempHp: 10, maxHp: MAX });
    const to = fillShare({ currentHp: 40, tempHp: 10, maxHp: MAX });
    expect(Number.parseFloat(bloom?.style.left ?? '')).toBeCloseTo(from);
    expect(Number.parseFloat(bloom?.style.width ?? '')).toBeCloseTo(to - from);
  });

  it('plays nothing while current HP follows max HP, which is not healing', () => {
    const view = render(<Card hp={0} follows />);
    view.rerender(<Card hp={42} follows />);
    expect(calls).toEqual([]);
    // The first change in play counts from where it follows to.
    view.rerender(<Card hp={37} />);
    expect(text(view, 'tally-damage')).toBe('\u22125');
  });

  it('still cues temp HP while current HP follows max HP', () => {
    const view = render(<Card hp={42} follows />);
    view.rerender(<Card hp={42} temp={8} follows />);
    expect(parts()).toEqual(expect.arrayContaining(['chip-sheen', 'cap-sheen', 'shield']));
  });

  it('plays nothing on switching character, only a new baseline', () => {
    const view = render(<Card id="a" hp={30} />);
    view.rerender(<Card id="b" hp={12} />);
    expect(calls).toEqual([]);
  });

  it('moves nothing under reduced motion: colours and tallies hold, then go', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const view = change({ hp: 30, temp: 0 }, { hp: 18, temp: 0 });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter(moves)).toEqual([]);
    expect(text(view, 'tally-damage')).toBe('−12');
    const tint = callsOn('number')[0];
    expect(tint?.frames).toEqual([{ color: '#ff8170' }, { color: '#ff8170' }]);
  });

  it('leaves no tally text where there are no Web Animations', () => {
    delete (Element.prototype as Partial<Element>).animate;
    const view = change({ hp: 30 }, { hp: 25 });
    expect(text(view, 'tally-damage')).toBe('');
  });
});
