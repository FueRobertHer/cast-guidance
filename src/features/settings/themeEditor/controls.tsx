import { Minus, Plus } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useThemeFonts } from '@/lib/useThemeFonts';
import { announce } from '@/stores/announcer';
import { isLight, parseHex, toHex } from '@/theme/colour';
import type { TokenValue } from '@/theme/file';
import { THEME_FONTS, themeFont } from '@/theme/fonts';
import { CHOICES, type TokenKind } from '@/theme/vocabulary';
import { buttonClass } from '@/ui/Button';
import { fieldClass } from '@/ui/TextField';

/**
 * The theme editor's controls, one per kind of token (docs/theming-plan.md,
 * phase 4). A map, so a new kind (phase 5's decor) adds one entry. Each hands
 * its raw value to `onChange`, which checks it as a theme file would and
 * returns why it was refused, or null.
 */

export interface ControlProps {
  name: string;
  /** The token's name as the row shows it, for the names of the parts. */
  label: string;
  /** The row's label element, for `aria-labelledby`. */
  labelId: string;
  value: TokenValue;
  /** Returns why the value was refused, or null. `key` groups a drag into one undo step. */
  onChange: (raw: unknown, key?: string) => string | null;
  /** What the controls need of the rest of the draft. */
  context: ControlContext;
  /** Hands the token back to the base (or what it follows). */
  onReset: () => void;
}

export interface ControlContext {
  /** The body font in the draft, whose weights are offered. */
  bodyFont: string;
  /** The page, the ink and the outline colour in the draft, for the shadow presets. */
  bg: string;
  ink: string;
  lineStrong: string;
}

const STEPPER = `${buttonClass({ variant: 'outline', size: 'icon' })} shrink-0`;

/** A number with − and + beside it, and an optional slider: sliders get nudged while scrolling. */
function Stepped({
  label,
  labelId,
  value,
  min,
  max,
  step,
  unit,
  slider,
  onChange,
  name,
}: {
  label: string;
  labelId: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  slider: boolean;
  /** `dragged` for the slider, whose run of changes is one undo step; each tap is its own. */
  onChange: (n: number, dragged: boolean) => void;
  name: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  // Said once per tap, by the announcer: a live region on every row would
  // read every value out when a new base changed them all at once.
  const tap = (n: number) => {
    onChange(n, false);
    announce(`${label} ${n} ${unit}`, { key: 'theme-stepper' });
  };
  // The buttons are described by the value, so a screen reader hears it
  // before a tap too: the edges have no slider to say it.
  const valueId = useId();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={STEPPER}
        aria-label={`Less ${label}`}
        aria-describedby={valueId}
        disabled={value <= min}
        onClick={() => tap(clamp(value - step))}
      >
        <Minus size={18} aria-hidden="true" />
      </button>
      {slider && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-labelledby={labelId}
          aria-valuetext={`${value} ${unit}`}
          data-token={name}
          onChange={(e) => onChange(Number(e.target.value), true)}
          className="h-tap min-w-0 flex-1 accent-brand"
        />
      )}
      <span
        id={valueId}
        aria-hidden="true"
        className="min-w-14 text-center text-body-strong tabular-nums"
      >
        {value} {unit}
      </span>
      <button
        type="button"
        className={STEPPER}
        aria-label={`More ${label}`}
        aria-describedby={valueId}
        disabled={value >= max}
        onClick={() => tap(clamp(value + step))}
      >
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/** The tokens that take an opacity: the scrim behind a sheet and the glint. */
const WITH_ALPHA = new Set(['scrim', 'hp-sheen']);

function ColourControl({ name, label, labelId, value, onChange }: ControlProps) {
  const text = String(value);
  const rgb = parseHex(text);
  const [typed, setTyped] = useState(text);
  const [error, setError] = useState<string | null>(null);
  // A new value from outside (the swatch, undo, a new base) replaces what is
  // typed. Set while rendering, not from an effect: a mount effect that ran
  // late, after a first keystroke, would put the old value back over it.
  const [from, setFrom] = useState(text);
  if (from !== text) {
    setFrom(text);
    setTyped(text);
    setError(null);
  }
  const alpha = rgb?.a ?? 0;
  const swatch = rgb === null ? '#000000' : toHex({ ...rgb, a: 1 });
  const take = () => {
    if (typed.trim() === text) return;
    setError(onChange(typed.trim()));
  };
  const hexId = useId();
  const errorId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={swatch}
          aria-labelledby={labelId}
          aria-describedby={hexId}
          data-token={name}
          onChange={(e) => {
            // A new hue keeps the opacity it had, a clear one included.
            const picked = parseHex(e.target.value);
            setError(
              onChange(
                picked === null
                  ? e.target.value
                  : toHex({ ...picked, a: rgb === null ? 1 : alpha }),
                name,
              ),
            );
          }}
          className="size-tap shrink-0 cursor-pointer rounded-control bg-surface-raised p-1 ring ring-line-strong ring-inset"
        />
        <input
          id={hexId}
          type="text"
          value={typed}
          aria-label={`${label}, hex code`}
          aria-invalid={error !== null || undefined}
          aria-describedby={error === null ? undefined : errorId}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={take}
          onKeyDown={(e) => {
            if (e.key === 'Enter') take();
          }}
          className={`${fieldClass} font-mono`}
        />
      </div>
      {WITH_ALPHA.has(name) && rgb !== null && (
        <label className="flex items-center gap-3 text-caption text-ink-muted">
          Opacity
          <input
            type="range"
            aria-label={`${label}, opacity`}
            min={0}
            max={100}
            value={Math.round(alpha * 100)}
            aria-valuetext={`${Math.round(alpha * 100)}%`}
            onChange={(e) =>
              setError(onChange(toHex({ ...rgb, a: Number(e.target.value) / 100 }), `${name}:a`))
            }
            className="h-tap min-w-0 flex-1 accent-brand"
          />
          <span className="w-10 text-right tabular-nums">{Math.round(alpha * 100)}%</span>
        </label>
      )}
      {error !== null && (
        <p id={errorId} role="alert" className="text-caption text-danger">
          That is not a colour the theme can use ({error}).
        </p>
      )}
    </div>
  );
}

/** The font list's groups, by where a font's faces come from (fonts.ts). */
const FONT_SOURCES = [
  { source: 'app', label: 'With the app' },
  { source: 'library', label: 'Downloaded when first used' },
  { source: 'device', label: 'This device’s own' },
] as const;

/**
 * A font, with a line drawn in it below. Titles-only faces are offered for
 * titles only. A library font is fetched as soon as it is chosen; offline,
 * before its first use, the control says so. Its options draw no font of
 * their own, so opening the list fetches nothing.
 */
function FontControl({ name, labelId, value, onChange }: ControlProps) {
  const id = String(value);
  const font = themeFont(id);
  const missing = useThemeFonts([id]) === 'missing';
  const noteId = useId();
  const forTitles = name === 'font-display';
  return (
    <div className="flex flex-col gap-2">
      <select
        value={id}
        aria-labelledby={labelId}
        aria-describedby={missing ? noteId : undefined}
        data-token={name}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
      >
        {FONT_SOURCES.map(({ source, label }) => (
          <optgroup key={source} label={label}>
            {THEME_FONTS.filter((f) => f.source === source && (forTitles || !f.titlesOnly)).map(
              (f) => (
                <option
                  key={f.id}
                  value={f.id}
                  style={f.source === 'library' ? undefined : { fontFamily: f.stack }}
                >
                  {f.label}
                </option>
              ),
            )}
          </optgroup>
        ))}
      </select>
      {font !== undefined && (
        <p
          aria-hidden="true"
          style={{ fontFamily: font.stack }}
          className={`truncate text-ink ${forTitles ? 'font-display text-title-card' : 'text-body'}`}
        >
          Sphinx of black quartz, judge my vow
        </p>
      )}
      {missing && (
        <p id={noteId} className="text-caption text-ink-muted">
          Not on this device yet: it downloads the next time you’re online.
        </p>
      )}
    </div>
  );
}

function WeightControl({ name, labelId, value, onChange, context }: ControlProps) {
  const offered = THEME_FONTS.find((f) => f.id === context.bodyFont)?.weights ?? [400, 600, 700];
  const options = [...new Set([...offered, Number(value)])].sort((a, b) => a - b);
  return (
    <select
      value={String(value)}
      aria-labelledby={labelId}
      data-token={name}
      onChange={(e) => onChange(Number(e.target.value))}
      className={fieldClass}
    >
      {options.map((w) => (
        <option key={w} value={w} style={{ fontWeight: w }}>
          {w}
          {offered.includes(w) ? '' : ' (not in this font)'}
        </option>
      ))}
    </select>
  );
}

function RadiusControl({ name, label, labelId, value, onChange }: ControlProps) {
  const round = value === 'full';
  const px = round ? 24 : Number.parseFloat(String(value));
  return (
    <div className="flex flex-col gap-2">
      {name === 'radius-pill' && (
        <label className="flex min-h-tap items-center gap-3 text-body">
          <input
            type="checkbox"
            checked={round}
            onChange={(e) => onChange(e.target.checked ? 'full' : '6px')}
            className="size-5 accent-brand"
          />
          Round ends
        </label>
      )}
      {round && name !== 'radius-pill' && (
        <p className="text-caption text-ink-muted">Fully round now. Set a size to change it.</p>
      )}
      {(!round || name !== 'radius-pill') && (
        <Stepped
          name={name}
          labelId={labelId}
          value={px}
          min={0}
          max={48}
          step={1}
          unit="px"
          slider
          label={label}
          onChange={(n, dragged) => onChange(`${n}px`, dragged ? name : undefined)}
        />
      )}
    </div>
  );
}

function EdgeControl({ name, label, labelId, value, onChange }: ControlProps) {
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const strong = name === 'border-strong';
  return (
    <div className="flex flex-col gap-1">
      <Stepped
        name={name}
        labelId={labelId}
        value={Number.parseFloat(String(value))}
        min={strong ? 1 : 0}
        max={strong ? 4 : 3}
        step={0.5}
        unit="px"
        slider={false}
        label={label}
        onChange={(n) => setError(onChange(`${n}px`))}
      />
      {error !== null && (
        <p id={errorId} role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function TrackingControl({ name, label, labelId, value, onChange }: ControlProps) {
  return (
    <Stepped
      name={name}
      labelId={labelId}
      value={Number.parseFloat(String(value))}
      min={-0.05}
      max={0.2}
      step={0.01}
      unit="em"
      slider
      label={label}
      onChange={(n, dragged) => onChange(`${n}em`, dragged ? name : undefined)}
    />
  );
}

function StrokeControl({ name, label, labelId, value, onChange }: ControlProps) {
  return (
    <Stepped
      name={name}
      labelId={labelId}
      value={Number(value)}
      min={1}
      max={3}
      step={0.25}
      unit="px"
      slider
      label={label}
      onChange={(n, dragged) => onChange(n, dragged ? name : undefined)}
    />
  );
}

/** Shadow presets, drawn in the draft's own colours: a free value is for theme files. */
export function shadowPresets(
  name: string,
  { bg, ink, lineStrong }: ControlContext,
): Record<'none' | 'soft' | 'deep' | 'outline', string> {
  // On a light page the shade is the ink; on a dark one, black.
  const shade = (isLight(bg) ? ink : '#000000').slice(0, 7);
  const card = name === 'shadow-card';
  const float = name === 'shadow-float';
  return {
    none: 'none',
    soft: card
      ? `0px 1px 2px ${shade}1f`
      : float
        ? `0px 6px 16px ${shade}29, 0px 2px 4px ${shade}1a`
        : `0px 16px 40px ${shade}33, 0px 2px 6px ${shade}1a`,
    deep: card
      ? `0px 2px 6px ${shade}40`
      : float
        ? `0px 10px 24px ${shade}59, 0px 3px 6px ${shade}33`
        : `0px 24px 56px ${shade}66, 0px 4px 10px ${shade}33`,
    outline: card
      ? `0px 0px 0px 1px ${lineStrong.slice(0, 7)}`
      : `0px 0px 0px 2px ${ink.slice(0, 7)}`,
  };
}

const SHADOW_NAMES = { none: 'None', soft: 'Soft', deep: 'Deep', outline: 'Outline' } as const;

function ShadowControl({ name, labelId, value, onChange, onReset, context }: ControlProps) {
  const presets = shadowPresets(name, context);
  const current = (Object.keys(presets) as (keyof typeof presets)[]).find(
    (k) => presets[k] === value,
  );
  return (
    <select
      value={current ?? 'as-is'}
      aria-labelledby={labelId}
      data-token={name}
      onChange={(e) => {
        if (e.target.value === 'base') {
          onReset();
          return;
        }
        const key = e.target.value as keyof typeof presets;
        if (key in presets) onChange(presets[key]);
      }}
      className={fieldClass}
    >
      {current === undefined && <option value="as-is">As it is now</option>}
      <option value="base">The theme it starts from</option>
      {(Object.keys(presets) as (keyof typeof presets)[]).map((k) => (
        <option key={k} value={k}>
          {SHADOW_NAMES[k]}
        </option>
      ))}
    </select>
  );
}

/** What each look is called in the editor. */
const LOOK_NAMES: Readonly<Record<string, string>> = {
  none: 'None',
  paper: 'Paper',
  grain: 'Grain',
  plain: 'Plain',
  double: 'Double',
  stitched: 'Stitched',
};

/** A few named looks (decor.css): native radios, so arrow keys move between them. */
function ChoiceControl({ name, labelId, value, onChange }: ControlProps) {
  const group = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
      {(CHOICES[name] ?? []).map((look) => (
        <label
          key={look}
          className="relative inline-flex min-h-tap min-w-tap cursor-pointer items-center justify-center rounded-control px-4 text-body-strong text-ink ring ring-line-strong ring-inset has-checked:bg-ink has-checked:text-bg has-focus-visible:outline-2 has-focus-visible:outline-focus has-focus-visible:outline-offset-2"
        >
          <input
            type="radio"
            name={group}
            value={look}
            checked={value === look}
            data-token={name}
            onChange={() => onChange(look)}
            className="absolute inset-0 size-full cursor-pointer appearance-none rounded-control opacity-0"
          />
          {LOOK_NAMES[look] ?? look}
        </label>
      ))}
    </div>
  );
}

export const CONTROLS: Readonly<Record<TokenKind, (props: ControlProps) => ReactNode>> = {
  colour: ColourControl,
  font: FontControl,
  weight: WeightControl,
  radius: RadiusControl,
  border: EdgeControl,
  tracking: TrackingControl,
  stroke: StrokeControl,
  shadow: ShadowControl,
  choice: ChoiceControl,
};
