import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useRegistry } from '@/data5e/hooks';
import type { TableRuleId } from '@/engine/castGuidance';
import { appRulesFor } from '@/engine/rules';
import { useAppTableRules } from '@/stores/tableRules';
import { listClass, listRowClass } from '@/ui/surfaces';
import { choiceTitle, RULE_ORDER, RULE_TITLES, RuleSheet } from './RuleSheet';

/**
 * One rule as a row (the Rules board, A): its name over the value it plays
 * by, and what decides it when that is not the app's choice, opening its
 * option sheet. Settings and the Build tab both list them.
 */
export function RuleRow({
  id,
  value,
  from,
  onOpen,
}: {
  id: TableRuleId;
  /** The value's words ("Double the dice"). */
  value: string;
  /** What decides it, said after the value ("Your own", a pack's name). */
  from?: string | undefined;
  onOpen: (id: TableRuleId) => void;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => onOpen(id)}
      className={`${listRowClass} w-full text-left hover:bg-surface-hover`}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-strong">{RULE_TITLES[id]}</span>
        {/* A flex column draws no space between its items; a name read aloud needs one. */}
        <span className="sr-only">,</span>{' '}
        <span className="text-caption text-ink-muted">
          {value}
          {from === undefined ? '' : ` · ${from}`}
        </span>
      </span>
      <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-faint" />
    </button>
  );
}

/**
 * House rules in Settings (the Rules board, A): a row per rule with the value
 * the app plays by, which every character follows unless one sets its own on
 * its Build tab. A rule chosen nowhere shows as written, or as a rule pack made
 * the app's default says, naming it.
 */
export function HouseRulesSection({ heading }: { heading: string }) {
  const registry = useRegistry();
  const rules = useAppTableRules();
  const [open, setOpen] = useState<TableRuleId | null>(null);
  const app = appRulesFor(
    { byType: registry === null ? () => [] : (type) => registry.byType(type as never), rules },
    '2024',
  );
  return (
    <section className="flex flex-col gap-2">
      <h2 className={heading}>House rules</h2>
      <p className="px-1 text-caption text-ink-muted">
        For every character, unless one sets its own on its Build tab.
      </p>
      <div className={listClass}>
        {RULE_ORDER.map((id) => (
          <RuleRow
            key={id}
            id={id}
            value={choiceTitle(id, app.rules[id])}
            from={rules[id] === undefined ? app.packs[id] : undefined}
            onOpen={setOpen}
          />
        ))}
      </div>
      <RuleSheet rule={open} onClose={() => setOpen(null)} />
    </section>
  );
}
