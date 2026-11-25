import { Minus, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { isLight, parseHex, toHex } from '@/theme/colour';
import type { TokenValue } from '@/theme/file';
import { THEME_FONTS } from '@/theme/fonts';
import type { TokenKind } from '@/theme/vocabulary';
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
  /** The row's label element, for `aria-labelledby`. */
  labelId: string;
  value: TokenValue;
  /** Returns why the value was refused, or null. `key` groups a drag into one undo step. */
  onChange: (raw: unknown, key?: string) => string | null;
  /** What the controls need of the rest of the draft. */
  context: ControlContext;
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
  labelId: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  slider: boolean;
  onChange: (n: number) => void;
  name: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={STEPPER}
        aria-label="Less"
        aria-describedby={labelId}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
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
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-tap min-w-0 flex-1 accent-brand"
        />
      )}
      <output aria-live="polite" className="min-w-14 text-center text-body-strong tabular-nums">
        {value} {unit}
      </output>
      <button
        type="button"
        className={STEPPER}
        aria-label="More"
        aria-describedby={labelId}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/** The tokens that take an opacity: the scrim behind a sheet and the glint. */
const WITH_ALPHA = new Set(['scrim', 'hp-sheen']);

function ColourControl({ name, labelId, value, onChange }: ControlProps) {
  const text = String(value);
  const rgb = parseHex(text);
  const [typed, setTyped] = useState(text);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTyped(text);
    setError(null);
  }, [text]);
  const alpha = rgb?.a ?? 0;
  const swatch = rgb === null ? '#000000' : toHex({ ...rgb, a: 1 });
  const take = () => {
    if (typed.trim() === text) return;
    setError(onChange(typed.trim()));
  };
  const hexId = useId();
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
            const picked = parseHex(e.target.value);
            setError(
              onChange(
                picked === null ? e.target.value : toHex({ ...picked, a: alpha || 1 }),
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
          aria-label="Hex"
          aria-invalid={error !== null || undefined}
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
        <p className="text-caption text-danger">
          That is not a colour the theme can use ({error}).
        </p>
      )}
    </div>
  );
}

function FontControl({ name, labelId, value, onChange }: ControlProps) {
  return (
    <select
      value={String(value)}
      aria-labelledby={labelId}
      data-token={name}
      onChange={(e) => onChange(e.target.value)}
      className={fieldClass}
    >
      {THEME_FONTS.map((f) => (
        <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
          {f.label}
        </option>
      ))}
    </select>
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

function RadiusControl({ name, labelId, value, onChange }: ControlProps) {
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
      {!round && (
        <Stepped
          name={name}
          labelId={labelId}
          value={px}
          min={0}
          max={48}
          step={1}
          unit="px"
          slider
          onChange={(n) => onChange(`${n}px`, name)}
        />
      )}
    </div>
  );
}

function EdgeControl({ name, labelId, value, onChange }: ControlProps) {
  const [error, setError] = useState<string | null>(null);
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
        onChange={(n) => setError(onChange(`${n}px`))}
      />
      {error !== null && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}

function StrokeControl({ name, labelId, value, onChange }: ControlProps) {
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
      onChange={(n) => onChange(n, name)}
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

function ShadowControl({ name, labelId, value, onChange, context }: ControlProps) {
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
        const key = e.target.value as keyof typeof presets;
        if (key in presets) onChange(presets[key]);
      }}
      className={fieldClass}
    >
      {current === undefined && <option value="as-is">As it is now</option>}
      {(Object.keys(presets) as (keyof typeof presets)[]).map((k) => (
        <option key={k} value={k}>
          {SHADOW_NAMES[k]}
        </option>
      ))}
    </select>
  );
}

export const CONTROLS: Readonly<Record<TokenKind, (props: ControlProps) => ReactNode>> = {
  colour: ColourControl,
  font: FontControl,
  weight: WeightControl,
  radius: RadiusControl,
  border: EdgeControl,
  stroke: StrokeControl,
  shadow: ShadowControl,
};
