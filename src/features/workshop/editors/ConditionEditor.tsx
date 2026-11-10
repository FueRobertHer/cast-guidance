/**
 * Conditions (ADR-001, H5): a condition's text, and what it does on the sheet
 * while it is on a character, as effect cards. The condition strip offers it
 * beside the built-in ones, and derive counts its effects like any effect in
 * play. Only numbers and rolls count on a condition; a card that would not
 * count says why under the list.
 *
 * A built-in condition is the app's own to count, by its own rules, so a
 * homebrew one takes another name. A copy of a built-in one can start from
 * what the app does for it, as cards the player can change.
 */
import { CircleAlert, Info } from 'lucide-react';
import { editionOf } from '@/data5e/rulesVersion';
import { isRecord } from '@/engine/castGuidance';
import { builtInConditionParts, conditionMechanics, isBuiltInCondition } from '@/engine/conditions';
import { Button } from '@/ui/Button';
import { EffectCards, guidanceWith } from '../EffectCards';
import type { EditorProps, EditorSpec } from '../editorTypes';
import { Section, TextBlocks } from '../fields';

const BOX = 'flex items-start gap-2 rounded-control bg-surface-raised px-3 py-2 text-caption';

function ConditionBody({ draft, change, original, readOnly }: EditorProps) {
  const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
  const effects = Array.isArray(g.effects) ? g.effects : [];
  const setEffects = (next: unknown[]) =>
    change({
      castGuidance: guidanceWith(draft.castGuidance, {
        effects: next.length > 0 ? next : undefined,
      }),
    });
  // What a built-in original does in the app, for a copy to start from.
  const from = original !== undefined ? String(original.name) : undefined;
  const builtIn =
    original !== undefined && from !== undefined && isBuiltInCondition(from)
      ? builtInConditionParts(from, editionOf(original))
      : [];
  // Offered until every one of them is on the list, so a second press adds nothing twice.
  const have = new Set(effects.map((e) => JSON.stringify(e)));
  const missing = builtIn.filter((p) => !have.has(JSON.stringify(p)));
  // The cards say why the stored reader refuses one; this says what a
  // condition in particular cannot count.
  const problems = conditionMechanics(draft).problems.filter((p) => p.unreadable !== true);
  return (
    <>
      <Section title="Text">
        <TextBlocks
          label="Paragraphs"
          entries={draft.entries}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      <Section title="What it does on the sheet">
        <p className="text-caption text-ink-muted">
          While it is on a character, the sheet counts these. Add it from + Effect on the sheet.
        </p>
        {builtIn.length > 0 && (
          <div className={BOX}>
            <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-ink-muted" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p>
                The app counts {from} by its own rules. Your copy counts only what you add here, so
                start from what {from} does and change it.
              </p>
              {!readOnly && missing.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => setEffects([...effects, ...missing])}
                >
                  Add what {from} does
                </Button>
              )}
            </div>
          </div>
        )}
        <EffectCards effects={effects} readOnly={readOnly} onChange={setEffects} />
        {problems.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="What does not count on a condition">
            {problems.map((p) => (
              <li
                key={`${p.place ?? 0}:${p.why}`}
                className="flex items-start gap-1.5 text-caption text-danger"
              >
                <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  {p.place === undefined ? '' : `Card ${p.place} does not count: `}
                  {p.why}.
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export const editor: EditorSpec = {
  noun: 'condition',
  blank: () => ({ entries: [] }),
  Body: ConditionBody,
  check: (draft) =>
    typeof draft.name === 'string' && isBuiltInCondition(draft.name)
      ? `${draft.name.trim()} is a condition the app counts by its own rules. Give yours another name.`
      : undefined,
};
