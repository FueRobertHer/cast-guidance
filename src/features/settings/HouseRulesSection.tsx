import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useRegistry } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { getRegistry } from '@/data5e/registry';
import { homebrewRepo } from '@/db/homebrewRepo';
import type { TableRuleChoices, TableRuleId } from '@/engine/castGuidance';
import { appRulesFor, asWritten } from '@/engine/rules';
import { type AppTableRules, useAppTableRules } from '@/stores/tableRules';
import { listClass, listRowClass } from '@/ui/surfaces';
import { choiceTitle, RULE_ORDER, RULE_TITLES, RuleSheet } from './RuleSheet';

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
  /** Whether the packs have been read: before that, `rules` holds the choices alone. */
  ready: boolean;
}

/**
 * The registry as the rules read it. A pack turned on or off, moved, or
 * applied to every character changes the rules with no download, and a screen
 * already holding the registry hears of that only from the stored rows. Once
 * they change, it reads the registry again on each change there and on each
 * new shared read, the last read started winning: a read begun before a pack
 * change (the first build, a download landing) never has the last word.
 */
function useRulesRegistry(): EntityRegistry | null {
  const shared = useRegistry();
  const packs = useLiveQuery(
    async () =>
      JSON.stringify(
        (await homebrewRepo.listMetaSafe()).files.map((r) => [r.id, r.enabled, r.pack ?? null]),
      ),
    [],
  );
  const first = useRef<string>(undefined);
  const changed = useRef(false);
  const latest = useRef(0);
  const [own, setOwn] = useState<EntityRegistry>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new shared registry is a trigger, read again so an older read never wins
  useEffect(() => {
    if (packs === undefined) return;
    first.current ??= packs;
    if (packs !== first.current) changed.current = true;
    if (!changed.current) return;
    latest.current += 1;
    const read = latest.current;
    getRegistry().then(
      (registry) => {
        if (read === latest.current) setOwn(registry);
      },
      // The registry in hand stands: the shared read reports a failure.
      () => undefined,
    );
  }, [packs, shared]);
  return own ?? shared;
}

/**
 * The table rules as every character plays them, read one way for every
 * screen that shows them (the Rules page, Settings' row, Write a rule pack),
 * so they never disagree.
 */
export function useAppRules(): AppRules {
  const registry = useRulesRegistry();
  const chosen = useAppTableRules();
  const app = appRulesFor(
    {
      byType: registry === null ? () => [] : (type) => registry.byType(type as never),
      rules: chosen,
    },
    '2024',
  );
  return { rules: app.rules, chosen, packs: app.packs, ready: registry !== null };
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
  const { rules, chosen, packs } = useAppRules();
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
      <RuleSheet rule={open} onClose={() => setOpen(null)} />
    </section>
  );
}
