import { Check, Info, TriangleAlert } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { POINT_BUY_BUDGET, POINT_BUY_COSTS, STANDARD_ARRAY } from '@/engine/calc/abilities';
import { ABILITIES, type Ability, type CharacterDoc, type DerivedAbility } from '@/engine/types';
import { listJoin } from '@/lib/describeRemoval';
import {
  ABILITY_NAMES,
  allAt,
  holderOf,
  isStandardArray,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  type PointBuyStatus,
  pointBuyStatus,
  type Scores,
  scoresLine,
  standardInOrder,
  stepCost,
  swapStandard,
} from './abilityMethods';
import { classAbilityHint, pointBuyFocusFor, standardArrayFor } from './pickerHints';

export type ShownMethod = 'standard' | 'pointbuy' | 'manual';

const METHOD_LABELS: Readonly<Record<ShownMethod, string>> = {
  standard: 'Standard array',
  pointbuy: 'Point buy',
  manual: 'Manual',
};

/** The line under the method row: what the picked method is, in one breath. */
const METHOD_NOTES: Readonly<Record<ShownMethod, string>> = {
  standard: `Recommended: ${STANDARD_ARRAY.join(' ')}, each once.`,
  pointbuy: `${POINT_BUY_BUDGET} points to spend, every score from ${POINT_BUY_MIN} to ${POINT_BUY_MAX}.`,
  manual: 'Manual: rolled or house-rule scores. No budget or array checks.',
};

const SECONDARY =
  'self-start rounded-lg bg-surface-2 px-3 py-1.5 text-left text-xs font-semibold text-ink';

/** The point-buy status in words, for the summary line and the live region. */
export function pointBuyText(status: PointBuyStatus): string {
  switch (status.kind) {
    case 'range':
      return `Not a point-buy spread: ${listJoin(
        status.out.map(
          (o) =>
            `${o.ability.toUpperCase()} ${o.value} is ${
              o.side === 'high' ? `above ${POINT_BUY_MAX}` : `below ${POINT_BUY_MIN}`
            }`,
        ),
      )}.`;
    case 'over':
      return `Over budget: ${status.spent} of ${POINT_BUY_BUDGET} points (${status.over} over).`;
    case 'under':
      return `${status.spent} of ${POINT_BUY_BUDGET} points spent, ${status.left} left to spend.`;
    case 'exact':
      return `All ${POINT_BUY_BUDGET} points spent.`;
  }
}

/**
 * The creator's abilities step (UX-001). Standard array is the recommended
 * path and gets a real allocator: one labelled select per ability, where
 * picking a value another ability holds swaps the two. Point buy and Manual
 * keep the steppers, and only they can move a score off the array; reaching
 * Manual is an explicit switch, after which nothing nags.
 *
 * The page owns the draft: `onScores` is a plain edit, `onReplace` an
 * overwrite it offers to undo, `onMethod` a method switch.
 */
export function AbilitiesStep({
  abilities,
  finals,
  className,
  onMethod,
  onScores,
  onReplace,
}: {
  abilities: CharacterDoc['abilities'];
  finals?: Record<Ability, DerivedAbility>;
  className?: string;
  onMethod: (m: ShownMethod) => void;
  onScores: (base: Scores) => void;
  onReplace: (base: Scores, title: string) => void;
}) {
  const { base } = abilities;
  // The doc type also allows "roll", which nothing offers: it reads as Manual.
  const method: ShownMethod = abilities.method === 'roll' ? 'manual' : abilities.method;
  // Mounted empty, so each change is announced as it lands.
  const [announce, setAnnounce] = useState('');
  const hint = className !== undefined ? classAbilityHint(className) : undefined;
  const autoArray = className !== undefined ? standardArrayFor(className) : undefined;
  const focus = className !== undefined ? pointBuyFocusFor(className) : undefined;
  const status = method === 'pointbuy' ? pointBuyStatus(base) : undefined;

  const step = (a: Ability, delta: 1 | -1) => {
    const next = { ...base, [a]: Math.min(18, Math.max(3, base[a] + delta)) };
    onScores(next);
    const said = `${a.toUpperCase()} ${next[a]}.`;
    setAnnounce(method === 'pointbuy' ? `${said} ${pointBuyText(pointBuyStatus(next))}` : said);
  };

  const keepAsManual = (label: string) => (
    <button type="button" onClick={() => onMethod('manual')} className={SECONDARY}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {hint !== undefined && (
        <p className="rounded-lg bg-surface p-3 text-sm text-ink-muted">
          💡 As a <strong className="text-ink">{className}</strong>, put your highest score in{' '}
          <strong className="text-ink">{hint}</strong>: they power your attacks and key features.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          {(['standard', 'pointbuy', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              onClick={() => onMethod(m)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                method === m
                  ? 'border-accent bg-accent-deep/40 font-semibold'
                  : 'border-surface-2 text-ink-muted'
              }`}
            >
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">{METHOD_NOTES[method]}</p>
      </div>

      {method === 'standard' && autoArray !== undefined && (
        <button
          type="button"
          onClick={() => onReplace(autoArray, `Applied the standard array for a ${className}`)}
          className="rounded-lg bg-accent-fill px-4 py-2.5 text-sm font-semibold text-white"
        >
          Auto-assign the standard array for a {className}
        </button>
      )}

      {method === 'standard' && isStandardArray(base) && (
        <>
          <StandardAllocator
            base={base}
            finals={finals}
            onScores={onScores}
            onAnnounce={setAnnounce}
          />
          <p className="flex items-center gap-1.5 text-sm text-emerald-300">
            <Check size={16} aria-hidden className="shrink-0" /> Standard array: each value used
            once
          </p>
        </>
      )}

      {method === 'standard' && !isStandardArray(base) && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface p-3">
          <p className="flex items-start gap-1.5 text-sm">
            <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-ink-muted" />
            {allAt(base, 10)
              ? `Assign each of ${STANDARD_ARRAY.join(', ')} once.`
              : `Your scores (${scoresLine(base)}) aren't the standard array.`}
          </p>
          <button
            type="button"
            onClick={() => onReplace(standardInOrder(), 'Placed the standard array in order')}
            className={SECONDARY}
          >
            Place 15 down to 8 in order (STR to CHA), then swap
          </button>
          {!allAt(base, 10) && keepAsManual('Keep these as Manual scores')}
        </div>
      )}

      {status !== undefined && (
        <div className="flex flex-col gap-2">
          <PointBuySummary status={status} />
          {(status.kind === 'range' || status.kind === 'over') &&
            keepAsManual('Keep as Manual scores')}
          {focus !== undefined && (
            <button
              type="button"
              onClick={() => onReplace(focus, `Focused a ${className}`)}
              className={SECONDARY}
            >
              Focus a {className} (15/15/15 in key abilities)
            </button>
          )}
        </div>
      )}

      {method !== 'standard' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ABILITIES.map((a) => (
            <StepperCard
              key={a}
              ability={a}
              score={base[a]}
              final={finals?.[a]}
              pointBuy={method === 'pointbuy'}
              onStep={(delta) => step(a, delta)}
            />
          ))}
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}

/** The point-buy line: an icon and words for every state, never colour alone. */
function PointBuySummary({ status }: { status: PointBuyStatus }) {
  const text = pointBuyText(status);
  let icon: ReactNode;
  let tone: string;
  let after: string | undefined;
  switch (status.kind) {
    case 'range':
      icon = <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />;
      tone = 'border border-amber-300/40 bg-amber-300/10 text-amber-200';
      break;
    case 'over':
      icon = <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />;
      tone = 'border border-amber-300/40 bg-amber-300/10 text-amber-200';
      after = 'Lower a score, or keep them as Manual scores.';
      break;
    case 'under':
      icon = <Info size={16} aria-hidden className="mt-0.5 shrink-0" />;
      tone = 'bg-surface text-ink-muted';
      break;
    case 'exact':
      icon = <Check size={16} aria-hidden className="mt-0.5 shrink-0" />;
      tone = 'bg-surface text-emerald-300';
      break;
  }
  return (
    <p className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm ${tone}`}>
      {icon}
      <span>
        {text}
        {after !== undefined && ` ${after}`}
      </span>
    </p>
  );
}

/** The score with racial and other bonuses applied, under each card. */
function FinalLine({ score, final }: { score: number; final?: DerivedAbility }) {
  if (final === undefined) return null;
  const mod = `${final.mod >= 0 ? '+' : ''}${final.mod}`;
  return final.value !== score ? (
    <span className="text-xs text-emerald-300">
      → {final.value} ({mod})
    </span>
  ) : (
    <span className="text-xs text-ink-muted">mod {mod}</span>
  );
}

/**
 * Whether a key steps a closed select to another option: the arrows, Home,
 * End, Page Up and Down, and type-ahead. Alt+Arrow, Space, Enter and F4 open
 * the list instead.
 */
function isNavigationKey(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  return (
    [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ].includes(e.key) ||
    (e.key.length === 1 && e.key !== ' ')
  );
}

/**
 * One select per ability, each listing the six array values. A value another
 * ability holds reads "14 (swap with DEX)", and picking it swaps the two.
 *
 * A closed native select fires a change per option as it is arrowed through
 * (Windows does), so those changes are worked out from the scores as they were
 * when that run began, not from the last change: arrowing STR through every
 * value moves only STR and whichever ability held the value it lands on. The
 * option labels read from that snapshot too.
 *
 * What opens the list differs by platform (on a Mac a plain arrow does), so
 * the run is told apart by what caused the change, not by how the list was
 * opened: a change in the same task as a navigation key on the select is a
 * closed select stepping, and works from the snapshot; any other change is a
 * pick from the open list, which works from the current scores and ends the
 * run, so the next pick builds on it. Blur ends the run too.
 */
function StandardAllocator({
  base,
  finals,
  onScores,
  onAnnounce,
}: {
  base: Scores;
  finals?: Record<Ability, DerivedAbility>;
  onScores: (base: Scores) => void;
  onAnnounce: (text: string) => void;
}) {
  const id = useId();
  const snapshot = useRef<Scores | null>(null);
  // The same snapshot for rendering the labels; the ref is what a change
  // reads, since two changes can land before a render.
  const [shown, setShown] = useState<Scores | null>(null);
  const labels = shown ?? base;
  // Set by a navigation key until the end of its task: a change that lands
  // while it is set came from that key on a closed select.
  const stepping = useRef(false);
  const endRun = () => {
    snapshot.current = null;
    setShown(null);
  };
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {ABILITIES.map((a) => (
        <div key={a} className="flex flex-col gap-1 rounded-lg bg-surface p-3">
          <label htmlFor={`${id}-${a}`} className="text-xs font-semibold text-ink-muted">
            {ABILITY_NAMES[a]} ({a.toUpperCase()})
          </label>
          <select
            id={`${id}-${a}`}
            value={base[a]}
            onKeyDown={(e) => {
              if (!isNavigationKey(e)) return;
              if (snapshot.current === null) {
                snapshot.current = { ...base };
                setShown(snapshot.current);
              }
              stepping.current = true;
              setTimeout(() => {
                stepping.current = false;
              }, 0);
            }}
            onBlur={endRun}
            onChange={(e) => {
              const fromRun = stepping.current ? snapshot.current : null;
              const from = fromRun ?? base;
              const next = swapStandard(from, a, Number(e.target.value));
              if (fromRun === null) endRun();
              onScores(next);
              // Said against the scores just before this change, which is
              // what the player last heard.
              const moved = ABILITIES.filter((b) => next[b] !== base[b]);
              onAnnounce(
                (moved.length > 0 ? moved : [a])
                  .map((b) => `${b.toUpperCase()} ${next[b]}`)
                  .join(', '),
              );
            }}
            className="rounded-lg bg-surface-2 px-2 py-1.5 text-lg font-bold outline-none"
          >
            {STANDARD_ARRAY.map((v) => {
              const holder = holderOf(labels, v);
              return (
                <option key={v} value={v}>
                  {v}
                  {holder !== undefined && holder !== a
                    ? ` (swap with ${holder.toUpperCase()})`
                    : ''}
                </option>
              );
            })}
          </select>
          <FinalLine score={base[a]} final={finals?.[a]} />
        </div>
      ))}
    </div>
  );
}

/**
 * A score with its steppers, for Point buy and Manual. In point buy the card
 * shows what the score costs and, to a screen reader, what one more point
 * costs; a score outside 8 to 15 gets a dashed border and a worded badge. The
 * steppers stay live at 8 and 15, so a deviation is always possible: the cue
 * says what it is, and "Keep as Manual scores" makes it a choice.
 */
function StepperCard({
  ability,
  score,
  final,
  pointBuy,
  onStep,
}: {
  ability: Ability;
  score: number;
  final?: DerivedAbility;
  pointBuy: boolean;
  onStep: (delta: 1 | -1) => void;
}) {
  const id = useId();
  const label = ability.toUpperCase();
  const cost = POINT_BUY_COSTS[score];
  const out =
    pointBuy && cost === undefined
      ? score > POINT_BUY_MAX
        ? `Above ${POINT_BUY_MAX}`
        : `Below ${POINT_BUY_MIN}`
      : undefined;
  const next = stepCost(score);
  // From below 8, one up can land back in range: say so, with what it costs.
  const landing = POINT_BUY_COSTS[score + 1];
  const upNote =
    next !== undefined
      ? `+1 costs ${next} more`
      : landing !== undefined
        ? `+1 brings ${label} back into point-buy range at ${score + 1}, costing ${landing}`
        : `${label} ${score + 1} is outside point buy (${POINT_BUY_MIN} to ${POINT_BUY_MAX})`;
  const badgeId = `${id}-badge`;
  const upId = `${id}-up`;
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-lg bg-surface p-3 ${
        out !== undefined ? 'border border-dashed border-amber-300/60' : ''
      }`}
    >
      <span className="text-xs font-semibold uppercase text-ink-muted">{ability}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          aria-describedby={out !== undefined ? badgeId : undefined}
          onClick={() => onStep(-1)}
          className="h-8 w-8 rounded-full bg-surface-2"
        >
          <span aria-hidden="true">−</span>
        </button>
        <span className="w-7 text-center text-lg font-bold">{score}</span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          aria-describedby={
            pointBuy ? [out !== undefined ? badgeId : '', upId].join(' ').trim() : undefined
          }
          onClick={() => onStep(1)}
          className="h-8 w-8 rounded-full bg-surface-2"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      {pointBuy && cost !== undefined && (
        <span className="text-xs text-ink-muted">
          {cost} {cost === 1 ? 'pt' : 'pts'}
        </span>
      )}
      {out !== undefined && (
        <span
          id={badgeId}
          className="flex items-center gap-1 rounded bg-amber-300/10 px-1.5 text-xs font-semibold text-amber-200"
        >
          <TriangleAlert size={12} aria-hidden /> {out}
        </span>
      )}
      {pointBuy && (
        <span id={upId} className="sr-only">
          {upNote}
        </span>
      )}
      <FinalLine score={score} final={final} />
    </div>
  );
}
