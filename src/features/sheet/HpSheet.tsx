import { ArrowLeft, HeartCrack, HeartPlus, Shield } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useRef, useState } from 'react';
import { Button, type ButtonVariant } from '@/ui/Button';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Sheet } from '@/ui/sheet';

/** What the HP sheet is about to do with the amount. */
export type HpMode = 'damage' | 'heal' | 'temp';

/** The hit points the sheet works from. */
export interface HpNow {
  currentHp: number;
  tempHp: number;
  maxHp: number;
}

const MODES: ReadonlyArray<{ value: HpMode; label: string }> = [
  { value: 'damage', label: 'Damage' },
  { value: 'heal', label: 'Heal' },
  { value: 'temp', label: 'Temp HP' },
];

const QUICK = ['1', '5', '10', '15'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * `damage` and `heal` are this sheet's own two hues (DS-001 Button). Temp HP has
 * none among the buttons, so its confirm is the sheet's one primary action.
 */
const CONFIRM: Record<HpMode, { variant: ButtonVariant; Icon: typeof Shield }> = {
  damage: { variant: 'damage', Icon: HeartCrack },
  heal: { variant: 'heal', Icon: HeartPlus },
  temp: { variant: 'brand', Icon: Shield },
};

/** 36px to the eye in a 44px tap, as the small button does it. */
const QUICK_KEY =
  'min-h-tap min-w-16 rounded-full border-4 border-transparent bg-clip-padding text-label tabular-nums ring-1 ring-line-strong ring-inset transition-colors duration-120 [--tap-inset:0.25rem] hover:bg-surface-raised';
const KEY =
  'flex min-h-13 items-center justify-center rounded-control bg-surface-raised px-1 transition-colors duration-120 hover:bg-surface-hover active:bg-surface-hover';
/** A key's digit: the keypad's own size, between `body` and `stat`. */
const DIGIT = 'font-semibold text-[1.375rem] tabular-nums';

/** A digit on the end of the amount: three at most, no leading zeros. */
export function typeDigit(amount: string, digit: string): string {
  return `${amount}${digit}`.replace(/^0+(?=\d)/, '').slice(0, 3);
}

/**
 * What the sheet says for an amount: the confirm's label, which says exactly
 * what will happen (DS-001 BottomSheet), whether it can run, and the line under
 * the keypad. `amount` is what was keyed: "" is nothing yet, "0" a deliberate
 * zero, which only means something for temp HP.
 */
export function hpSheetCopy(
  mode: HpMode,
  amount: string,
  { currentHp, tempHp, maxHp }: HpNow,
): { confirm: string; ready: boolean; line: string } {
  const n = Number(amount);
  const ask = 'Enter an amount';

  if (mode === 'damage') {
    const fromTemp = Math.min(tempHp, n);
    const fromHp = Math.min(currentHp, n - fromTemp);
    const first = 'Temp HP absorbs damage first';
    let line: string;
    if (tempHp === 0) {
      line =
        n === 0
          ? `${first}. You have none.`
          : `No temp HP to absorb it: ${currentHp} down to ${currentHp - fromHp}.`;
    } else if (n === 0) line = `${first}: you have ${tempHp}.`;
    else if (fromHp === 0)
      line = `${first}: ${fromTemp} of your ${tempHp}, none from ${currentHp}.`;
    else line = `${first}: ${fromTemp} temp, then ${fromHp} from ${currentHp}.`;
    return { confirm: n > 0 ? `Take ${n} damage` : ask, ready: n > 0, line };
  }

  if (mode === 'heal') {
    // Also where a house rule has left HP over the maximum: healing caps at the
    // maximum, so going ahead would lower it.
    const room = Math.max(0, maxHp - currentHp);
    if (room === 0) {
      return {
        confirm: 'Already at full HP',
        ready: false,
        line: `You are at your maximum of ${maxHp}.`,
      };
    }
    if (n === 0) {
      return { confirm: ask, ready: false, line: `${room} to reach your maximum of ${maxHp}.` };
    }
    return {
      confirm: `Heal ${Math.min(n, room)} HP`,
      ready: true,
      line:
        n > room
          ? `Only ${room} to reach your maximum of ${maxHp}.`
          : `${currentHp} up to ${currentHp + n} of ${maxHp}.`,
    };
  }

  const line =
    tempHp > 0
      ? `Temp HP doesn't stack: this replaces your ${tempHp}. Enter 0 to clear it.`
      : "Temp HP absorbs damage first. It doesn't stack: a new source replaces the old.";
  if (n > 0) return { confirm: `Set temp HP to ${n}`, ready: true, line };
  if (amount === '0' && tempHp > 0)
    return { confirm: `Clear ${tempHp} temp HP`, ready: true, line };
  return { confirm: ask, ready: false, line };
}

/**
 * The HP sheet (DS-001 HitPoints, BottomSheet): an exact change to hit points,
 * opened on Damage, Heal or Temp HP from the card. Quick amounts for the common
 * case, a keypad for anything else, and a confirm that says what it will do.
 *
 * It only asks. `onApply` makes the change, and the sheet stays up until that
 * is done, because damage can stop to ask about Relentless Endurance: that
 * dialog opens over this one, and focus goes back through it in order.
 */
export function HpSheet({
  open,
  mode,
  hp,
  onApply,
  onOpenChange,
  openedFrom,
}: {
  open: boolean;
  /** The mode it opens on; the player can change it from there. */
  mode: HpMode;
  hp: HpNow;
  onApply: (mode: HpMode, amount: number) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes back to: this sheet has no trigger of its own for Radix to use. */
  openedFrom: RefObject<HTMLElement | null>;
}) {
  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Portal>
        <Sheet.Scrim />
        {/* Taller than other sheets may be: all of this fits a 320 by 640 screen
            without scrolling at this height, and the confirm stays in reach when
            it does not (large text, a phone on its side). */}
        <Sheet.Panel
          aria-describedby={undefined}
          className="flex max-h-[calc(100dvh-1.5rem)] flex-col"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openedFrom.current?.focus({ preventScroll: true });
          }}
        >
          {/* Inside the panel, so each opening starts from nothing keyed. */}
          <HpSheetBody
            open={open}
            initialMode={mode}
            hp={hp}
            onApply={onApply}
            onClose={() => onOpenChange(false)}
          />
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

function HpSheetBody({
  open,
  initialMode,
  hp,
  onApply,
  onClose,
}: {
  open: boolean;
  initialMode: HpMode;
  hp: HpNow;
  onApply: (mode: HpMode, amount: number) => void | Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [amount, setAmount] = useState('');
  // The numbers move behind the sheet the moment it applies. Sliding away it
  // keeps saying what it just did, not what a second go would.
  const shown = useRef(hp);
  if (open) shown.current = hp;
  const { currentHp, tempHp, maxHp } = shown.current;
  const { confirm, ready, line } = hpSheetCopy(mode, amount, shown.current);
  const { variant, Icon } = CONFIRM[mode];

  // The confirm is still there for the half second the sheet takes to go, and a
  // second tap in it must not take the damage twice.
  const applying = useRef(false);
  const run = async () => {
    if (!open || !ready || applying.current) return;
    applying.current = true;
    await onApply(mode, Number(amount));
    applying.current = false;
    onClose();
  };

  const press = (digit: string) => setAmount((a) => typeDigit(a, digit));
  // The keypad's keys for a keyboard: the prompt this replaced had a field to
  // type in. Enter is left alone, as it presses whichever key has focus.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[0-9]$/.test(event.key)) press(event.key);
    else if (event.key === 'Backspace') setAmount((a) => a.slice(0, -1));
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only hears digits typed while focus is on a control inside
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      {/* Wraps the context under the title where both do not fit (large text). */}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2">
        <Sheet.Title className="min-w-0 font-display text-title-sheet">Hit points</Sheet.Title>
        <span className="text-caption text-ink-muted tabular-nums">
          {currentHp} / {maxHp}
          {tempHp > 0 ? ` · +${tempHp} temp` : ''}
        </span>
      </div>

      {/* One scroll, its padding keeping focus rings in, and the confirm below
          it always on screen. */}
      <div className="-mx-4 -mt-1 min-h-0 flex-1 scroll-py-1 overflow-y-auto px-4 pt-1">
        <SegmentedControl
          label="Change hit points"
          options={MODES}
          value={mode}
          onChange={setMode}
          block
        />
        <output className="mt-2 flex items-baseline justify-center gap-2 pt-2 pb-3">
          <span className={`text-stat-hero tabular-nums ${amount === '' ? 'text-ink-faint' : ''}`}>
            {amount === '' ? '0' : amount}
          </span>
          <span className="text-body text-ink-muted">HP</span>
        </output>

        {/* A tap on a key that drifts downward would otherwise drag the sheet,
            and a quick one close it. The rest of the sheet still drags. */}
        <div data-vaul-no-drag="">
          {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
          <div
            role="group"
            aria-label="Quick amounts"
            className="mb-2 flex flex-wrap justify-center"
          >
            {QUICK.map((q) => (
              <button key={q} type="button" onClick={() => setAmount(q)} className={QUICK_KEY}>
                {q}
              </button>
            ))}
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
          <div role="group" aria-label="Keypad" className="mb-3 grid grid-cols-3 gap-2">
            {DIGITS.map((d) => (
              <button key={d} type="button" onClick={() => press(d)} className={`${KEY} ${DIGIT}`}>
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount('')}
              className={`${KEY} text-body-strong`}
            >
              Clear
            </button>
            <button type="button" onClick={() => press('0')} className={`${KEY} ${DIGIT}`}>
              0
            </button>
            <button
              type="button"
              aria-label="Delete"
              onClick={() => setAmount((a) => a.slice(0, -1))}
              className={KEY}
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* Two lines kept for it: it sits under the keypad in a sheet anchored
            to the bottom, so a line that grew as you typed would slide the keys
            out from under your finger. */}
        <p className="mb-3 min-h-[2lh] text-center text-caption text-ink-muted">{line}</p>
      </div>

      <Button
        variant={variant}
        size="lg"
        block
        data-vaul-no-drag=""
        // Not `disabled`: focus would fall out of the sheet if the amount were
        // deleted while the confirm had it.
        aria-disabled={!ready}
        onClick={() => void run()}
        className="shrink-0"
      >
        <Icon size={18} aria-hidden="true" className="shrink-0" />
        {confirm}
      </Button>
    </div>
  );
}
