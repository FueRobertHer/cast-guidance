// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONDITION_MOTION_KEY, setAnimateConditions } from '@/lib/conditionMotion';
import { conditionSheetStore } from '@/stores/conditionSheet';
import { rollLogStore } from '@/stores/rollLog';
import {
  ChipFace,
  type ChipLook,
  type ChipWear,
  isChipLook,
  nextMoments,
  restingMoments,
  TOTAL_MS,
  useRollMoment,
  type WearSurface,
} from './ChipFace';
import { RollChip } from './RollChip';

const worn = (...looks: ChipLook[]): ChipWear => ({ looks, ignored: false });
const PLAIN = worn();
const POISONED = worn('Poisoned');
const ARMED: ChipWear = { looks: ['Poisoned'], ignored: true };

const ALL_LOOKS: readonly ChipLook[] = [
  'Poisoned',
  'Blinded',
  'Restrained',
  'Grappled',
  'Exhaustion',
  'Invisible',
  'Frightened',
  'Prone',
  'Paralyzed',
  'Stunned',
  'Unconscious',
  'Incapacitated',
  'Petrified',
];

function face(wear: ChipWear, { rolls = 0, showing = false } = {}) {
  return (
    <ChipFace wear={wear} rolls={rolls} showing={showing}>
      +5
    </ChipFace>
  );
}

/** Renders a chip, with what it now wears and what it is doing to ask about. */
function chip(wear: ChipWear, options?: { rolls?: number; showing?: boolean }) {
  const { container, rerender } = render(face(wear, options));
  const root = () => container.querySelector('.cx') as HTMLElement;
  return {
    container,
    root,
    has: (name: string) => root().classList.contains(name),
    surging: () => container.querySelector('.cx-surge') !== null,
    wearing: (next: ChipWear, nextOptions?: { rolls?: number; showing?: boolean }) =>
      rerender(face(next, nextOptions)),
  };
}

const advance = (time: number) => act(() => vi.advanceTimersByTime(time));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  act(() => {
    setAnimateConditions(true);
    conditionSheetStore.setState({ open: false });
  });
  rollLogStore.getState().clear();
});

describe('ChipFace, at rest', () => {
  it('is plain blue with nothing to wear, and draws no effect at all', () => {
    const c = chip(PLAIN);
    expect(c.has('cx-on')).toBe(false);
    expect(c.container.querySelector('.cx-mat')).toBeNull();
    expect(c.container.querySelector('.cx-over')).toBeNull();
    expect(c.container.textContent).toBe('+5');
  });

  it('shows what it mounted with at rest: no arrival on a load or a tab change', () => {
    const c = chip(POISONED);
    expect(c.has('cx-on')).toBe(true);
    expect(c.has('cx-poisoned')).toBe(true);
    expect(c.has('cx-arrive')).toBe(false);
    expect(c.surging()).toBe(false);
  });

  it('gives each condition a look of at most 4 pieces, moving the face or not', () => {
    for (const look of ALL_LOOKS) {
      expect(isChipLook(look), look).toBe(true);
      const c = chip(worn(look));
      const pieces = c.container.querySelectorAll('.cx-layer .cx-p').length;
      const body = c.container.querySelector('.cx-face')?.className.includes('cx-body-') ? 1 : 0;
      expect(pieces, look).toBeGreaterThan(0);
      expect(pieces + body, look).toBeLessThanOrEqual(4);
      cleanup();
    }
    expect(isChipLook('Charmed')).toBe(false);
    expect(isChipLook('constructor')).toBe(false);
  });

  it('splits between the two newest, ringed and moved by the newest that moves', () => {
    const c = chip(worn('Prone', 'Poisoned', 'Blinded'));
    expect(c.has('cx-two')).toBe(true);
    expect(c.has('cx-prone')).toBe(true);
    const layers = c.container.querySelectorAll('.cx-mat > .cx-layer');
    expect([...layers].map((l) => l.className)).toEqual([
      'cx-layer cx-prone',
      'cx-layer cx-poisoned',
    ]);
    expect(c.container.querySelector('.cx-face')?.className).toContain('cx-body-fallen');
    // The third is only a count.
    expect(c.container.querySelector('.cx-more')?.textContent).toBe('+1');

    cleanup();
    const body = chip(worn('Poisoned', 'Frightened'));
    expect(body.container.querySelector('.cx-face')?.className).toContain('cx-body-cower');
  });

  it('counts past the third: a fourth condition is +2', () => {
    const c = chip(worn('Prone', 'Poisoned', 'Blinded', 'Restrained'));
    expect(c.container.querySelector('.cx-more')?.textContent).toBe('+2');
  });

  it('rings every condition but Invisible, which draws its own', () => {
    expect(chip(POISONED).container.querySelector('.cx-ring')).not.toBeNull();
    cleanup();
    const glass = chip(worn('Invisible'));
    expect(glass.container.querySelector('.cx-ring')).toBeNull();
    expect(glass.container.querySelector('.cx-ghost')).not.toBeNull();
  });

  it('tags 2024 exhaustion with its penalty, in a true minus sign', () => {
    const c = chip({ looks: ['Exhaustion'], ignored: false, penalty: -4 });
    expect(c.container.querySelector('.cx-tag')?.textContent).toBe('−4');
    cleanup();
    expect(chip(worn('Exhaustion')).container.querySelector('.cx-tag')).toBeNull();
  });
});

describe('ChipFace, as a condition arrives and leaves', () => {
  it('floods and flashes for 480ms when a condition arrives on screen', () => {
    const c = chip(PLAIN);
    c.wearing(POISONED);
    expect(c.has('cx-arrive')).toBe(true);
    expect(c.surging()).toBe(true);
    advance(479);
    expect(c.has('cx-arrive')).toBe(true);
    advance(1);
    expect(c.has('cx-arrive')).toBe(false);
    expect(c.surging()).toBe(false);
    expect(c.has('cx-on')).toBe(true);
  });

  it('plays the arrival again for a second condition, and not for one that was hidden', () => {
    const c = chip(POISONED);
    c.wearing(worn('Blinded', 'Poisoned'));
    expect(c.has('cx-arrive')).toBe(true);
    advance(480);

    const three = worn('Prone', 'Blinded', 'Poisoned');
    c.wearing(three);
    advance(480);
    c.wearing(worn('Blinded', 'Poisoned'));
    expect(c.has('cx-arrive')).toBe(false);
    expect(c.container.querySelector('.cx-more')).toBeNull();
  });

  it('fades for 200ms when the last condition leaves, then is plain', () => {
    const c = chip(POISONED);
    c.wearing(PLAIN);
    expect(c.has('cx-rm')).toBe(true);
    expect(c.has('cx-poisoned')).toBe(true);
    advance(199);
    expect(c.has('cx-rm')).toBe(true);
    advance(1);
    expect(c.has('cx-rm')).toBe(false);
    expect(c.has('cx-on')).toBe(false);
    expect(c.container.querySelector('.cx-mat')).toBeNull();
  });

  it('plays nothing when one of two leaves', () => {
    const c = chip(worn('Blinded', 'Poisoned'));
    c.wearing(POISONED);
    expect(c.has('cx-arrive')).toBe(false);
    expect(c.has('cx-rm')).toBe(false);
    expect(c.has('cx-two')).toBe(false);
  });
});

describe('ChipFace, as a roll lands', () => {
  it('flashes for 480ms, and the signature carries on without a new arrival', () => {
    const c = chip(POISONED);
    c.wearing(POISONED, { rolls: 1, showing: true });
    expect(c.surging()).toBe(true);
    expect(c.has('cx-arrive')).toBe(false);
    advance(480);
    expect(c.surging()).toBe(false);
    c.wearing(POISONED, { rolls: 1, showing: false });
    expect(c.surging()).toBe(false);
  });

  it('restarts the flash on another roll by giving it a new key', () => {
    const c = chip(POISONED);
    c.wearing(POISONED, { rolls: 1, showing: true });
    const first = c.container.querySelector('.cx-surge');
    advance(100);
    c.wearing(POISONED, { rolls: 2, showing: true });
    expect(c.container.querySelector('.cx-surge')).not.toBe(first);
    // The first roll's timer must not end the second's flash.
    advance(400);
    expect(c.surging()).toBe(true);
    advance(80);
    expect(c.surging()).toBe(false);
  });

  it('does not flash a chip with nothing on it', () => {
    const rolled = nextMoments(restingMoments(PLAIN, 0), {
      wear: PLAIN,
      rolls: 1,
      showing: true,
      held: false,
      animate: true,
    });
    expect(rolled.rolls).toBe(1);
    expect(rolled.flashing).toBe(false);
    expect(rolled.flash).toBe(0);
  });
});

describe('ChipFace, with Ignore once', () => {
  it('goes plain with a dashed ring, and shows no motion, tag or count', () => {
    const c = chip({ looks: ['Exhaustion', 'Prone', 'Blinded'], ignored: true, penalty: -2 });
    expect(c.has('cx-ig')).toBe(true);
    expect(c.container.querySelector('.cx-ignore-ring')).not.toBeNull();
    expect(c.container.querySelector('.cx-face')?.className).toBe('cx-face');
    expect(c.container.querySelector('.cx-tag')).toBeNull();
  });

  it('makes no ring when there is nothing to ignore', () => {
    const c = chip({ looks: [], ignored: true });
    expect(c.has('cx-ig')).toBe(false);
    expect(c.container.querySelector('.cx-ignore-ring')).toBeNull();
  });

  it('plays no arrival when it is pressed', () => {
    const c = chip(POISONED);
    c.wearing(ARMED);
    expect(c.has('cx-ig')).toBe(true);
    expect(c.has('cx-arrive')).toBe(false);
    expect(c.has('cx-rm')).toBe(false);
  });

  it('re-arrives straight away when pressed off, or on a chip another roll spent it from', () => {
    const c = chip(ARMED);
    c.wearing(POISONED);
    expect(c.has('cx-ig')).toBe(false);
    expect(c.has('cx-arrive')).toBe(true);
  });

  it('stays plain on the chip that rolled until its total clears, then re-arrives', () => {
    const c = chip(ARMED);
    c.wearing(POISONED, { rolls: 1, showing: true });
    // The roll was plain, and its total is on a plain chip.
    expect(c.has('cx-ig')).toBe(true);
    expect(c.surging()).toBe(false);
    advance(1000);
    expect(c.has('cx-ig')).toBe(true);
    c.wearing(POISONED, { rolls: 1, showing: false });
    expect(c.has('cx-ig')).toBe(false);
    expect(c.has('cx-arrive')).toBe(true);
    expect(c.surging()).toBe(true);
  });

  it('re-arrives on a second roll made before the first total cleared', () => {
    const c = chip(ARMED);
    c.wearing(POISONED, { rolls: 1, showing: true });
    c.wearing(POISONED, { rolls: 2, showing: true });
    expect(c.has('cx-ig')).toBe(false);
    expect(c.has('cx-arrive')).toBe(true);
  });

  it('does not fade the colour it was not showing when the condition leaves meanwhile', () => {
    const c = chip(ARMED);
    c.wearing(PLAIN);
    expect(c.has('cx-rm')).toBe(false);
    expect(c.has('cx-on')).toBe(false);
  });
});

describe('ChipFace, under a condition sheet', () => {
  it('keeps what it showed while the sheet is up, and arrives once it clears', () => {
    const c = chip(PLAIN);
    act(() => conditionSheetStore.setState({ open: true }));
    c.wearing(POISONED);
    expect(c.has('cx-on')).toBe(false);
    act(() => conditionSheetStore.setState({ open: false }));
    expect(c.has('cx-on')).toBe(true);
    expect(c.has('cx-arrive')).toBe(true);
  });

  it('fades only once it clears, too', () => {
    const c = chip(POISONED);
    act(() => conditionSheetStore.setState({ open: true }));
    c.wearing(PLAIN);
    expect(c.has('cx-on')).toBe(true);
    expect(c.has('cx-rm')).toBe(false);
    act(() => conditionSheetStore.setState({ open: false }));
    expect(c.has('cx-rm')).toBe(true);
  });

  it('plays nothing for a change undone before the sheet closed', () => {
    const c = chip(POISONED);
    act(() => conditionSheetStore.setState({ open: true }));
    c.wearing(worn('Blinded', 'Poisoned'));
    c.wearing(POISONED);
    act(() => conditionSheetStore.setState({ open: false }));
    expect(c.has('cx-arrive')).toBe(false);
    expect(c.has('cx-two')).toBe(false);
  });

  it('saves the re-arrival after Ignore once for when the sheet clears, too', () => {
    const c = chip(ARMED);
    c.wearing(POISONED, { rolls: 1, showing: true });
    act(() => conditionSheetStore.setState({ open: true }));
    // The total clears under the sheet: nobody would see the arrival.
    c.wearing(POISONED, { rolls: 1, showing: false });
    expect(c.has('cx-ig')).toBe(true);
    expect(c.has('cx-arrive')).toBe(false);
    act(() => conditionSheetStore.setState({ open: false }));
    expect(c.has('cx-ig')).toBe(false);
    expect(c.has('cx-arrive')).toBe(true);
  });
});

describe('ChipFace, with "Animate condition effects" off', () => {
  beforeEach(() => act(() => setAnimateConditions(false)));

  it('holds the still pose: colours and marks stay', () => {
    const c = chip(POISONED);
    expect(c.has('cx-still')).toBe(true);
    expect(c.has('cx-on')).toBe(true);
    expect(c.container.querySelector('.cx-liquid')).not.toBeNull();
  });

  it('lands every change at once, with no arrival, flash or fade', () => {
    const c = chip(PLAIN);
    c.wearing(POISONED);
    expect(c.has('cx-on')).toBe(true);
    expect(c.has('cx-arrive')).toBe(false);
    expect(c.surging()).toBe(false);

    c.wearing(POISONED, { rolls: 1, showing: true });
    expect(c.surging()).toBe(false);

    c.wearing(PLAIN, { rolls: 1, showing: true });
    expect(c.has('cx-rm')).toBe(false);
    expect(c.has('cx-on')).toBe(false);
  });

  it('does not wait for a condition sheet: there is nothing to save for it', () => {
    const c = chip(PLAIN);
    act(() => conditionSheetStore.setState({ open: true }));
    c.wearing(POISONED);
    expect(c.has('cx-on')).toBe(true);
    expect(c.has('cx-arrive')).toBe(false);
  });

  it('does not wait for one to end Ignore once, either', () => {
    const c = chip(ARMED);
    c.wearing(POISONED, { rolls: 1, showing: true });
    act(() => conditionSheetStore.setState({ open: true }));
    c.wearing(POISONED, { rolls: 1, showing: false });
    expect(c.has('cx-ig')).toBe(false);
    expect(c.has('cx-arrive')).toBe(false);
  });

  it('remembers it for this device', () => {
    expect(localStorage.getItem(CONDITION_MOTION_KEY)).toBe('off');
  });
});

describe('ChipFace, as assistive tech meets it', () => {
  it('hides every effect piece, so only the chip’s own text is read', () => {
    const c = chip({ looks: ['Stunned', 'Exhaustion', 'Poisoned'], ignored: false, penalty: -2 });
    const pieces = c.container.querySelectorAll('.cx-mat, .cx-over, .cx-tag');
    expect(pieces.length).toBeGreaterThanOrEqual(4);
    for (const piece of pieces) expect(piece.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    const armed = chip(ARMED);
    expect(armed.container.querySelector('.cx-ignore-ring')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});

describe('ChipFace, on each surface', () => {
  const on = (surface: WearSurface, wear: ChipWear, rolls = 0, tone?: 'danger' | 'heal') => (
    <ChipFace wear={wear} rolls={rolls} showing={false} surface={surface} tone={tone}>
      +5
    </ChipFace>
  );

  it('names its surface, and adds nothing to a chip’s own classes', () => {
    const c = chip(POISONED);
    expect(c.root().className).toBe('cx cx-on cx-poisoned');
    cleanup();
    for (const surface of ['cast', 'save', 'cell', 'tile', 'card'] as const) {
      const { container } = render(on(surface, PLAIN));
      expect(container.querySelector('.cx')?.className).toBe(`cx cx-at-${surface}`);
      cleanup();
    }
  });

  it('keeps a damage or healing chip’s tone', () => {
    const { container } = render(on('chip', PLAIN, 0, 'danger'));
    expect(container.querySelector('.cx')?.className).toBe('cx cx-tone-danger');
  });

  it('draws each look on a save and a cell as on a chip, moving the face or not', () => {
    for (const surface of ['save', 'cell', 'cast'] as const) {
      const { container } = render(on(surface, worn('Paralyzed')));
      expect(container.querySelectorAll('.cx-mat .cx-bolt')).toHaveLength(2);
      expect(container.querySelector('.cx-face')?.className).toContain('cx-body-rigid');
      expect(container.querySelector('.cx-strip')).toBeNull();
      cleanup();
    }
  });

  it('flashes on a roll, and a control that never rolls never flashes', () => {
    const { container, rerender } = render(on('save', POISONED));
    rerender(on('save', POISONED, 1));
    expect(container.querySelector('.cx-surge')).not.toBeNull();
    advance(480);
    expect(container.querySelector('.cx-surge')).toBeNull();

    // Cast and Speed count no rolls, so a new render of the same wear is nothing.
    const cast = render(on('cast', POISONED));
    cast.rerender(on('cast', POISONED));
    expect(cast.container.querySelector('.cx-surge')).toBeNull();
  });

  it('gives Grappled four moving prongs and moves nothing else', () => {
    const { container } = render(on('cell', worn('Grappled')));
    expect(container.querySelectorAll('.cx-layer .cx-prong')).toHaveLength(4);
    expect(container.querySelectorAll('.cx-layer .cx-p')).toHaveLength(4);
    expect(container.querySelector('.cx-face')?.className).toBe('cx-face');
  });

  describe('on a card', () => {
    it('takes the tint and ring whole, and keeps every moving piece in its strip', () => {
      const { container } = render(on('card', POISONED));
      const card = container.querySelector('.cx-face > .cx-mat');
      const strip = container.querySelector('.cx-strip');
      expect(card?.querySelector('.cx-layer')?.className).toBe('cx-layer cx-poisoned');
      expect(card?.querySelector('.cx-ring')).not.toBeNull();
      expect(card?.querySelector('.cx-liquid')).toBeNull();
      expect(strip?.querySelector('.cx-liquid')).not.toBeNull();
      expect(strip?.getAttribute('aria-hidden')).toBe('true');
      // The rows are not in the strip.
      expect(strip?.textContent).toBe('');
    });

    it('moves the strip, never the card, under Frightened', () => {
      const { container } = render(on('card', worn('Frightened')));
      expect(container.querySelector('.cx-face')?.className).toBe('cx-face');
      expect(container.querySelector('.cx-strip')?.className).toContain('cx-body-cower');
    });

    it('floods the card as a condition arrives, and flashes only in the strip', () => {
      const { container, rerender } = render(on('card', PLAIN));
      expect(container.querySelector('.cx-strip')).toBeNull();
      rerender(on('card', POISONED));
      expect(container.querySelector('.cx')?.className).toContain('cx-arrive');
      expect(container.querySelector('.cx-strip .cx-surge')).not.toBeNull();
      expect(container.querySelector('.cx-face > .cx-mat .cx-surge')).toBeNull();
    });

    it('holds its tag at the strip’s corner', () => {
      const penalty: ChipWear = { looks: ['Exhaustion'], ignored: false, penalty: -2 };
      const { container } = render(on('card', penalty));
      expect(container.querySelector('.cx-strip .cx-tag')?.textContent).toBe('−2');
      expect(container.querySelectorAll('.cx-tag')).toHaveLength(1);
    });

    it('goes plain with a dashed ring when Ignore once is armed, and no row moves', () => {
      const { container } = render(on('card', ARMED));
      expect(container.querySelector('.cx-ignore-ring')).not.toBeNull();
      // The strip keeps its place, with nothing in it, so the rows stay where they are.
      const strip = container.querySelector('.cx-strip');
      expect(strip).not.toBeNull();
      expect(strip?.childElementCount).toBe(0);
    });

    it('keeps the same strip as a roll spends Ignore once and the conditions come back', () => {
      const rolled = (showing: boolean) => (
        <ChipFace wear={POISONED} rolls={1} showing={showing} surface="card">
          +5
        </ChipFace>
      );
      const { container, rerender } = render(on('card', ARMED));
      const strip = container.querySelector('.cx-strip');
      rerender(rolled(true));
      expect(container.querySelector('.cx-ig')).not.toBeNull();
      expect(container.querySelector('.cx-strip')).toBe(strip);
      rerender(rolled(false));
      expect(container.querySelector('.cx-ig')).toBeNull();
      expect(container.querySelector('.cx-strip')).toBe(strip);
      expect(strip?.querySelector('.cx-liquid')).not.toBeNull();
    });

    it('keeps its strip while the last condition fades, then lets it go', () => {
      const { container, rerender } = render(on('card', POISONED));
      rerender(on('card', PLAIN));
      expect(container.querySelector('.cx-strip')).not.toBeNull();
      advance(200);
      expect(container.querySelector('.cx-strip')).toBeNull();
    });
  });
});

describe('useRollMoment, for a control whose total lands in the toast', () => {
  it('counts each roll, and holds the moment as long as a chip holds its total', () => {
    const { result } = renderHook(() => useRollMoment());
    expect(result.current).toMatchObject({ rolls: 0, showing: false });
    act(() => result.current.rolled());
    expect(result.current).toMatchObject({ rolls: 1, showing: true });
    advance(TOTAL_MS - 1);
    expect(result.current.showing).toBe(true);
    // Another roll starts the wait again.
    act(() => result.current.rolled());
    advance(TOTAL_MS - 1);
    expect(result.current).toMatchObject({ rolls: 2, showing: true });
    advance(1);
    expect(result.current.showing).toBe(false);
  });
});

describe('ChipFace, raised by an effect in play', () => {
  const raised = (wear: ChipWear, lift?: boolean, surface: WearSurface = 'chip') => (
    <ChipFace wear={wear} rolls={0} showing={false} surface={surface} lift={lift}>
      +5
    </ChipFace>
  );

  it('draws the ring and, above it, the mark on layers that take the face’s motion', () => {
    const { container } = render(raised(worn('Prone'), true));
    expect(container.querySelector('.cx')?.classList.contains('cx-lifted')).toBe(true);
    expect(container.querySelector('.cx-face')?.className).toContain('cx-body-fallen');
    const [ring, mark] = [...container.querySelectorAll<HTMLElement>('.cx-lift')];
    for (const layer of [ring, mark]) {
      expect(layer?.className).toContain('cx-body-fallen');
      expect(layer?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(ring?.querySelector('.fx-lift-ring')).not.toBeNull();
    expect(ring?.querySelector('.fx-lift-mark')).toBeNull();
    // Its own layer, so a raised neighbour's ring is drawn under it.
    expect(mark?.classList.contains('cx-lift-top')).toBe(true);
    expect(mark?.querySelector('.fx-lift-mark')).not.toBeNull();
  });

  it('keeps the layers while not raised, so a ring that comes later keeps time', () => {
    const { container, rerender } = render(raised(worn('Frightened'), false));
    const layers = () => [...container.querySelectorAll<HTMLElement>('.cx-lift')];
    expect(layers()).toHaveLength(2);
    for (const layer of layers()) {
      expect(layer.className).toContain('cx-body-cower');
      expect(layer.childElementCount).toBe(0);
    }
    expect(container.querySelector('.cx')?.classList.contains('cx-lifted')).toBe(false);
    rerender(raised(worn('Frightened'), true));
    expect(container.querySelector('.fx-lift-ring')).not.toBeNull();
    expect(container.querySelector('.fx-lift-mark')).not.toBeNull();
    for (const layer of layers()) expect(layer.classList.contains('fx-lift-arrive')).toBe(true);
    advance(480);
    expect(container.querySelector('.fx-lift-arrive')).toBeNull();
  });

  it('draws the ring in at once with condition motion off', () => {
    act(() => setAnimateConditions(false));
    const { container, rerender } = render(raised(PLAIN, false));
    rerender(raised(PLAIN, true));
    expect(container.querySelector('.fx-lift-ring')).not.toBeNull();
    expect(container.querySelector('.fx-lift-arrive')).toBeNull();
  });

  it('draws no layer for a control nothing raises', () => {
    const { container } = render(raised(worn('Prone')));
    expect(container.querySelector('.cx-lift')).toBeNull();
  });
});

describe('RollChip, wearing conditions', () => {
  const props = {
    expr: '1d20+5',
    display: '+5',
    label: 'Longsword attack',
    variant: 'd20',
  } as const;

  it('keeps its name, its title and its roll', () => {
    render(<RollChip {...props} wear={{ looks: ['Exhaustion'], ignored: false, penalty: -4 }} />);
    const button = screen.getByRole('button', { name: '+5' });
    expect(button.getAttribute('title')).toBe('Longsword attack');
    fireEvent.click(button);
    expect(rollLogStore.getState().rolls).toHaveLength(1);
  });

  it('flashes as its total lands, and shows the total for 1600ms', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
      if (buf instanceof Uint32Array) buf[0] = 9;
      return buf;
    });
    const { container } = render(<RollChip {...props} wear={POISONED} />);
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('.cx-surge')).not.toBeNull();
    expect(screen.getByRole('button').textContent).toBe('15');
    advance(1600);
    expect(screen.getByRole('button').textContent).toBe('+5');
    vi.restoreAllMocks();
  });

  it('draws the plain chip as before when it wears nothing', () => {
    const { container } = render(<RollChip {...props} />);
    expect(container.querySelector('.cx')).toBeNull();
    expect(screen.getByRole('button').className).toContain('bg-roll-soft');
  });

  it('draws plain blue on the face instead when it could wear something', () => {
    const { container } = render(<RollChip {...props} wear={PLAIN} />);
    expect(container.querySelector('.cx-face')).not.toBeNull();
    expect(screen.getByRole('button').className).not.toContain('bg-roll-soft');
  });

  it('wears a raised ring on its face, which moves, and a still frame without one', () => {
    const { container } = render(<RollChip {...props} wear={worn('Prone')} raisedBy={['Rage']} />);
    expect(screen.getByRole('button').textContent).toBe('+5, raised by Rage');
    expect(container.querySelector('.fx-lift')).toBeNull();
    expect(container.querySelector('.cx-lift .fx-lift-ring')).not.toBeNull();
    cleanup();
    const plain = render(<RollChip expr="1d8+3" variant="damage" raisedBy={['Rage']} />);
    expect(plain.container.querySelector('.fx-lift-on')).not.toBeNull();
    expect(plain.container.querySelector('.cx-lift')).toBeNull();
  });

  it('keeps a casting chip’s damage or healing tone on the face', () => {
    const damage = render(<RollChip expr="1d6" variant="damage" wear={PLAIN} />);
    expect(damage.container.querySelector('.cx')?.className).toBe('cx cx-tone-danger');
    expect(screen.getByRole('button').className).not.toContain('bg-danger-soft');
    cleanup();
    const heal = render(<RollChip expr="1d6" variant="heal" wear={PLAIN} />);
    expect(heal.container.querySelector('.cx')?.className).toBe('cx cx-tone-heal');
  });
});
