import { type ReactNode, useState } from 'react';
import type { DerivedValue } from '@/engine/types';
import { Button } from './Button';
import { Sheet, SheetStandIn, useSheetOpenOnMount } from './sheet';
import { fieldClass } from './TextField';

/** Bottom sheet showing how a derived number was computed, with optional override. */
export interface BreakdownSheetProps {
  title: string;
  value: DerivedValue;
  trigger: ReactNode;
  /** When provided, shows the manual-override editor. null clears. */
  onOverride?: (value: number | null) => void;
  /** Extra controls for this value, shown under the breakdown. */
  children?: ReactNode;
}

/** The labeled amounts behind a derived number. `children` adds rows to the same list. */
export function BreakdownParts({
  parts,
  children,
}: {
  parts: DerivedValue['parts'];
  children?: ReactNode;
}) {
  return (
    <dl className="flex flex-col gap-1 text-body">
      {parts.map((p, i) => (
        <div key={`${p.label}-${String(i)}`} className="flex justify-between gap-3">
          <dt className="text-ink-muted">{p.label}</dt>
          <dd className="font-semibold tabular-nums">
            {p.amount >= 0 ? '+' : ''}
            {p.amount}
          </dd>
        </div>
      ))}
      {children}
    </dl>
  );
}

/**
 * The trigger until the player asks how a number was reached, then the sheet.
 * Rendered once per derived value on the Play and Stats tabs, so the unopened
 * case has to stay cheap (see {@link SheetStandIn}).
 */
export function BreakdownSheet(props: BreakdownSheetProps) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <SheetStandIn trigger={props.trigger} onArm={() => setArmed(true)} />;
  }
  return <BreakdownSheetContent {...props} />;
}

function BreakdownSheetContent({
  title,
  value,
  trigger,
  onOverride,
  children,
}: BreakdownSheetProps) {
  const [draft, setDraft] = useState('');

  // Mounted by the press that opens it; see `useSheetOpenOnMount`.
  const [open, setOpen] = useSheetOpenOnMount();

  return (
    <Sheet.Root open={open} onOpenChange={setOpen}>
      <Sheet.Trigger asChild>{trigger}</Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel>
          {/* The total stays inside the title, so the sheet's name carries its
              result, as it always has: not `Sheet.Heading`, whose aside sits
              outside the name. */}
          <Sheet.Title className="mb-3 flex items-baseline justify-between gap-3">
            <span className="min-w-0 font-display text-title-sheet">{title}</span>
            <span className="shrink-0 text-stat tabular-nums">{value.value}</span>
          </Sheet.Title>
          <BreakdownParts parts={value.parts}>
            {value.overridden && (
              <div className="mt-1 flex justify-between gap-3 border-line border-t pt-2 text-guide">
                <dt>Manual override (computed: {value.base})</dt>
                <dd className="font-semibold tabular-nums">= {value.value}</dd>
              </div>
            )}
          </BreakdownParts>
          {children !== undefined && (
            <div className="mt-3 border-line border-t pt-3">{children}</div>
          )}
          {onOverride !== undefined && (
            <form
              className="mt-3 flex gap-2 border-line border-t pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number.parseInt(draft, 10);
                if (!Number.isNaN(n)) {
                  onOverride(n);
                  setDraft('');
                }
              }}
            >
              <input
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={`Override ${title}`}
                placeholder={`Override (${value.base})`}
                className={`${fieldClass} min-w-0 flex-1`}
              />
              <Button type="submit" variant="brand">
                Set
              </Button>
              {value.overridden && (
                <Button variant="secondary" onClick={() => onOverride(null)}>
                  Clear
                </Button>
              )}
            </form>
          )}
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
