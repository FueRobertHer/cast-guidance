import { useId, useState } from 'react';
import { useRegistry } from '@/data5e/hooks';
import { TABLE_RULES, type TableRuleChoices, type TableRuleId } from '@/engine/castGuidance';
import { appRulesFor, ownRule, restTakes, ruleSources, rulesFor, setOwnRule } from '@/engine/rules';
import type { CharacterDoc, EngineContext } from '@/engine/types';
import { ONE_USE_DICE_WHY } from '@/lib/oneUseDice';
import type { DocUpdater } from '@/stores/characterSession';
import { setAppTableRule, useAppTableRules } from '@/stores/tableRules';
import { Button } from '@/ui/Button';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Sheet } from '@/ui/sheet';
import { OneUseDiceNotes } from './OneUseDiceSetting';

/** The rules in the order the screens list them (the Rules board, A). */
export const RULE_ORDER: readonly TableRuleId[] = [
  'critDamage',
  'restLength',
  'hpEachLevel',
  'hpOnLongRest',
  'flanking',
  'oneUseDice',
];

/** Each rule's title on its row and its sheet. */
export const RULE_TITLES: Readonly<Record<TableRuleId, string>> = {
  critDamage: 'Critical hits',
  restLength: 'Rest length',
  hpEachLevel: 'HP each level',
  hpOnLongRest: 'HP on a long rest',
  flanking: 'Flanking',
  oneUseDice: 'Guidance and Bardic Inspiration',
};

interface Choice {
  /** What it is, as its row says it. */
  t: string;
  /** Where it comes from, or what it means at the table. */
  m: string;
  /** What it does to a real roll. */
  ex?: string;
}

const rests = (length: TableRuleChoices['restLength']) =>
  `Short ${restTakes(length, 'short')}, long ${restTakes(length, 'long')}`;

/** Every value of every rule, in words (the Rules board's option sheet). */
const CHOICES: { readonly [K in TableRuleId]: Readonly<Record<TableRuleChoices[K], Choice>> } = {
  critDamage: {
    doubleDice: { t: 'Double the dice', m: 'As written', ex: 'A 1d8 + 3 hit rolls 2d8 + 3' },
    maxPlusRoll: {
      t: 'Max the dice, then roll them',
      m: 'A house rule',
      ex: 'A 1d8 + 3 hit is 8 + 1d8 + 3',
    },
    doubleTotal: { t: 'Double the total', m: 'A house rule', ex: 'A 1d8 + 3 hit is (1d8 + 3) × 2' },
  },
  restLength: {
    standard: { t: rests('standard'), m: 'As written' },
    gritty: { t: rests('gritty'), m: 'Slow healing, long journeys' },
    heroic: { t: rests('heroic'), m: 'Fast recovery, more fights a day' },
  },
  hpEachLevel: {
    average: {
      t: 'The fixed amount',
      m: 'As written, unless a player rolls',
      ex: 'A d10 class: 6 + Con',
    },
    rolled: { t: 'Roll each level', m: 'As written, the other way', ex: 'A d10 class: 1d10 + Con' },
    max: { t: "The die's maximum", m: 'A house rule', ex: 'A d10 class: 10 + Con' },
    rolledAtLeastAverage: {
      t: 'Roll, never under the fixed amount',
      m: 'A house rule',
      ex: 'A d10 class: 1d10 + Con, at least 6',
    },
  },
  hpOnLongRest: {
    all: { t: 'All of it', m: 'As written' },
    half: { t: 'Half your maximum', m: 'Slower healing' },
    hitDice: { t: 'None: spend hit dice to heal', m: 'Slowest healing' },
  },
  flanking: {
    off: { t: 'Off', m: 'As written' },
    advantage: { t: 'Advantage', m: "An optional rule in the 2014 Dungeon Master's Guide" },
    plusTwo: { t: '+2 to hit', m: 'A house rule' },
  },
  oneUseDice: {
    after: { t: 'Offered after the roll too', m: ONE_USE_DICE_WHY.after },
    before: { t: 'Named before the roll', m: ONE_USE_DICE_WHY.before },
  },
};

/** A rule's value as its row says it ("Double the dice"). */
export function choiceTitle<K extends TableRuleId>(id: K, value: TableRuleChoices[K]): string {
  return (CHOICES[id] as Readonly<Record<string, Choice>>)[value]?.t ?? String(value);
}

/** What each rule adds under its choices, said once. */
const AFTER: Partial<Record<TableRuleId, string>> = {
  hpEachLevel: 'Level 1 of your first class is always the full die.',
  flanking:
    'Offered in the roll prompt on melee attacks, since the app cannot see who stands where.',
  restLength: 'The Rest buttons on the Play tab end effects by these lengths.',
};

/** The character a sheet opened on their own page can set a rule for. */
export interface RuleCharacter {
  doc: CharacterDoc;
  update: DocUpdater;
}

/** The context the rules read through: the registry's rule packs and the app's choices. */
function useRuleContext(): Pick<EngineContext, 'byType' | 'rules'> {
  const registry = useRegistry();
  const rules = useAppTableRules();
  return { byType: registry === null ? () => [] : (type) => registry.byType(type as never), rules };
}

/**
 * The option sheet for one table rule (the Rules board, A, with C's chip
 * mixed in): every value as a radio card with what it means and what it does
 * to a roll, the choice taking hold as it is made. Opened from Settings it
 * sets the app's rule, which every character without its own follows; opened
 * where a character is (their Build tab, a roll's chip, the rest card) it can
 * also give that character a rule of their own, or take it back.
 *
 * A choice in Settings is stored as made, as written too, so it outranks a
 * rule pack made the app's default; until one is made, the pack's rule shows.
 */
export function RuleSheet({
  rule,
  onClose,
  character,
  mine,
  returnFocus,
}: {
  /** The rule shown, or `null` while closed. */
  rule: TableRuleId | null;
  onClose: () => void;
  character?: RuleCharacter | null | undefined;
  /** Open on the character's own rule; else on theirs only when they have one. */
  mine?: boolean;
  /** Where focus goes as it closes, when what opened it is gone (the roll toast's chip). */
  returnFocus?: HTMLElement | null | undefined;
}) {
  // The rule last shown, kept while the sheet slides away so it says the same.
  const [shown, setShown] = useState<TableRuleId>(rule ?? 'critDamage');
  const [openings, setOpenings] = useState(rule === null ? 0 : 1);
  const [was, setWas] = useState(rule);
  if (rule !== was) {
    setWas(rule);
    if (rule !== null) {
      setShown(rule);
      setOpenings((n) => n + 1);
    }
  }
  return (
    <Sheet.Root open={rule !== null} onOpenChange={(open) => !open && onClose()}>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel
          aria-describedby={undefined}
          className="flex max-h-[90dvh] flex-col"
          onCloseAutoFocus={(event) => {
            if (returnFocus?.isConnected === true) {
              event.preventDefault();
              returnFocus.focus();
            }
          }}
        >
          <Sheet.Heading>{RULE_TITLES[shown]}</Sheet.Heading>
          <RuleChoices
            key={`${shown} ${openings}`}
            id={shown}
            character={character ?? undefined}
            mine={mine}
          />
          <Button variant="secondary" size="lg" block className="mt-3 shrink-0" onClick={onClose}>
            Done
          </Button>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

/** A copy of `doc` without its own value for `id`, to read what it would follow instead. */
function withoutOwn(doc: CharacterDoc, id: TableRuleId): CharacterDoc {
  const copy: CharacterDoc =
    doc.tableRules === undefined ? { ...doc } : { ...doc, tableRules: { ...doc.tableRules } };
  setOwnRule(copy, id, undefined);
  return copy;
}

function RuleChoices({
  id,
  character,
  mine,
}: {
  id: TableRuleId;
  character: RuleCharacter | undefined;
  mine: boolean | undefined;
}) {
  const ctx = useRuleContext();
  const name = useId();
  const doc = character?.doc;
  const app = appRulesFor(ctx, doc?.rulesVersion ?? '2024');
  const own = doc === undefined ? undefined : ownRule(doc, id);
  const [scope, setScope] = useState<'all' | 'mine'>(
    doc !== undefined && (mine ?? own !== undefined) ? 'mine' : 'all',
  );
  const forMe = scope === 'mine' && character !== undefined;
  const from = doc === undefined ? undefined : ruleSources(doc, ctx)[id];
  const appPack = ctx.rules?.[id] === undefined ? app.packs[id] : undefined;
  const value = forMe ? rulesFor(character.doc, ctx)[id] : app.rules[id];
  const pick = (v: string) => {
    if (forMe) character.update((d) => setOwnRule(d, id, v as TableRuleChoices[typeof id]));
    else setAppTableRule(id, v as TableRuleChoices[typeof id]);
  };
  const who = doc?.name.trim() || 'This character';
  // What they follow without a rule of their own: a pack applied to them, else Settings.
  const under = doc === undefined ? undefined : ruleSources(withoutOwn(doc, id), ctx)[id];
  const settings = under?.from === 'pack' ? under.pack : 'Settings';
  const note = forMe
    ? own !== undefined
      ? `${who} has a rule of its own here. Other characters follow Settings.`
      : `${who} follows ${settings} here. Pick one to give ${who} a rule of its own.`
    : from?.from === 'own'
      ? `${who} has a rule of its own here, so this does not change ${who}.`
      : from?.from === 'pack'
        ? `${from.pack} sets this for ${who}, so this does not change ${who}.`
        : appPack !== undefined
          ? `${appPack} sets this for every character until you pick one here.`
          : doc !== undefined
            ? `Every character follows this, ${who} too.`
            : 'Every character follows this, unless one sets its own on its Build tab.';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-body">
      {character !== undefined && (
        <SegmentedControl
          label="Who this applies to"
          options={[
            { value: 'all', label: 'Every character' },
            { value: 'mine', label: `Only ${who}` },
          ]}
          value={scope}
          onChange={setScope}
          block
        />
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{RULE_TITLES[id]}</legend>
        {TABLE_RULES[id].map((v) => {
          const c = (CHOICES[id] as Readonly<Record<string, Choice>>)[v] as Choice;
          return (
            <label
              key={v}
              className="relative flex min-h-tap cursor-pointer items-start gap-3 rounded-control px-3 py-2.5 ring-1 ring-line ring-inset has-checked:ring-2 has-checked:ring-ink has-focus-visible:outline-2 has-focus-visible:outline-focus has-focus-visible:outline-offset-2"
            >
              <input
                type="radio"
                name={name}
                value={v}
                checked={value === v}
                onChange={() => pick(v)}
                // The value they already play by is checked, and a checked radio
                // fires no change: a click on it still makes it the choice here
                // (their own, or stored in Settings as made).
                onClick={() => value === v && pick(v)}
                className="mt-0.5 size-5 shrink-0 accent-ink"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-body-strong">{c.t}</span>
                <span className="text-caption text-ink-muted">{c.m}</span>
                {c.ex !== undefined && (
                  <span className="text-caption text-ink-muted tabular-nums">{c.ex}</span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="text-caption text-ink-muted">{note}</p>
      {forMe && own !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => character.update((d) => setOwnRule(d, id, undefined))}
        >
          Follow {settings} again
        </Button>
      )}
      {AFTER[id] !== undefined && <p className="text-caption text-ink-muted">{AFTER[id]}</p>}
      {id === 'oneUseDice' && <OneUseDiceNotes />}
    </div>
  );
}
