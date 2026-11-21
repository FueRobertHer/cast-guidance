import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import type { TableRuleChoices, TableRuleId } from '@/engine/castGuidance';
import { appRulesFor, asWritten } from '@/engine/rules';
import { type AppTableRules, useAppTableRules } from '@/stores/tableRules';
import { listClass, listRowClass } from '@/ui/surfaces';
import { choiceTitle, RULE_ORDER, RULE_TITLES, RuleSheet } from './RuleSheet';
import { useRegistryRead } from './registryRead';

/**
 * One rule as a row (the Rules board, A): its name over the value it plays
 * by, and what decides it when that is not the app's choice, opening its
 * option sheet. The Rules page and the Build tab both list them.
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

/** The table rules every character plays by, and where each comes from. */
export interface AppRules {
  /** The value of each rule: a choice made, else an every-character pack's, else as written. */
  rules: TableRuleChoices;
  /** The choices made, as stored. */
  chosen: AppTableRules;
  /** The every-character pack that sets a rule, by name, where it does. */
  packs: Partial<Record<TableRuleId, string>>;
  /**
   * Whether this screen's own read of the packs is in (or failed). Before it,
   * `rules` and `packs` come from the shared registry, which may have been
   * read before a pack change, or from the choices alone while there is no
   * registry: a screen says Loading rather than state them.
   */
  ready: boolean;
}

/**
 * The table rules as every character plays them, read one way for every
 * screen that shows them (the Rules page, Settings' row, Write a rule pack),
 * so they never disagree. The registry is read again for the rules whenever
 * a pack is turned on or off, moved or applied (`useRegistryRead`).
 */
export function useAppRules(): AppRules {
  const { registry, ready } = useRegistryRead();
  const chosen = useAppTableRules();
  const app = appRulesFor(
    {
      byType: registry === null ? () => [] : (type) => registry.byType(type as never),
      rules: chosen,
    },
    '2024',
  );
  return { rules: app.rules, chosen, packs: app.packs, ready };
}

/** Whether a rule plays as written. */
export const isAsWritten = (id: TableRuleId, rules: TableRuleChoices): boolean =>
  rules[id] === asWritten('2024')[id];

/**
 * The house rules in a line, as Settings' row says them: each rule that is
 * not as written, by name and value, in the screens' order.
 */
export function houseRulesWords(rules: TableRuleChoices): string {
  const house = RULE_ORDER.filter((id) => !isAsWritten(id, rules));
  if (house.length === 0) return 'Every rule as written';
  return house.map((id) => `${RULE_TITLES[id]}: ${choiceTitle(id, rules[id])}`).join('. ');
}

/**
 * The table rules as a list (the Rules board, B, on the Workshop's Rules
 * page): a row per rule with the value the app plays by, which every
 * character follows unless one sets its own on its Build tab. A rule chosen
 * nowhere shows as written, or as a rule pack applied to every character
 * says, naming it.
 */
export function HouseRulesSection({
  heading,
  title = 'House rules',
  aside,
}: {
  /** The heading's classes. */
  heading: string;
  title?: string;
  /** Said at the heading's end ("Every character"). */
  aside?: string;
}) {
  const { rules, chosen, packs, ready } = useAppRules();
  const [open, setOpen] = useState<TableRuleId | null>(null);
  const label = useId();
  return (
    <section aria-labelledby={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 id={label} className={heading}>
          {title}
        </h2>
        {aside !== undefined && <span className="px-1 text-caption text-ink-muted">{aside}</span>}
      </div>
      <p className="px-1 text-caption text-ink-muted">
        For every character, unless one sets its own on its Build tab.
      </p>
      {/* Not before the packs are read: a rule a pack applied to every
          character sets would read as written, here and in its sheet. */}
      {ready ? (
        <div className={listClass}>
          {RULE_ORDER.map((id) => (
            <RuleRow
              key={id}
              id={id}
              value={choiceTitle(id, rules[id])}
              from={chosen[id] === undefined ? packs[id] : undefined}
              onOpen={setOpen}
            />
          ))}
        </div>
      ) : (
        <p className="px-1 text-body text-ink-muted">Loading…</p>
      )}
      <RuleSheet rule={open} onClose={() => setOpen(null)} />
    </section>
  );
}
