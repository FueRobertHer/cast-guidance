/**
 * What + Effect finds when you search it (the buffs canvas, Catalog board):
 * the results for the words typed, and the one tapped, with the questions it
 * asks before it lands and what it will do on this character. It and the
 * table it reads load in a chunk of their own when the Effects sheet opens.
 */
import { AlertTriangle, ArrowLeft, ChevronsUp, Dices, Info, ShieldHalf } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { roll } from '@/dice/roll';
import { countsAs } from '@/engine/activeEffects';
import {
  type Answers,
  asksShown,
  type CatalogAsk,
  type CatalogEntry,
  catalogFor,
  initialAnswers,
  landEntry,
  rollRange,
  searchCatalog,
  unanswered,
} from '@/engine/curated/effectCatalog';
import { heldByMe } from '@/engine/effectLife';
import type { ActiveEffect, CharacterDoc, DerivedSheet, EffectPart } from '@/engine/types';
import { randomId } from '@/lib/randomId';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { fieldClass } from '@/ui/TextField';
import { effectsInPlay, partLine } from './effectsInPlay';
import { namedStart } from './namedStarts';

/** At most this many results show; typing more narrows the rest. */
export const RESULTS_SHOWN = 6;

/** How long typing rests before the count is said, as the Library's search waits. */
const SEARCH_SETTLE_MS = 750;

const lower = (s: string) => s.trim().toLowerCase();

/** A weapon an effect on one weapon can take, or why it cannot. */
interface WeaponChoice {
  id: string;
  name: string;
  /** Why it is not offered: already magical, or another effect is on it. */
  not?: string;
}

/** The parts of effects in play that sit on one weapon, by the weapon's id. */
function weaponsTaken(effects: readonly ActiveEffect[]): Map<string, string> {
  const taken = new Map<string, string>();
  for (const e of effects) {
    for (const p of e.parts) {
      if (
        (p.kind === 'attackBonus' || p.kind === 'damageBonus' || p.kind === 'damageDie') &&
        p.weapon !== undefined &&
        !taken.has(p.weapon)
      ) {
        taken.set(p.weapon, e.name);
      }
    }
  }
  return taken;
}

/** The character's carried weapons, each free for a spell that needs a nonmagical one or not. */
export function weaponChoices(
  sheet: Pick<DerivedSheet, 'attacks'>,
  effects: readonly ActiveEffect[],
): WeaponChoice[] {
  const taken = weaponsTaken(effects);
  const seen = new Set<string>();
  const out: WeaponChoice[] = [];
  for (const row of sheet.attacks) {
    if (row.weaponId === undefined || seen.has(row.weaponId)) continue;
    seen.add(row.weaponId);
    const by = taken.get(row.weaponId);
    out.push({
      id: row.weaponId,
      name: row.label,
      ...(row.magical === true
        ? { not: 'already magical' }
        : by !== undefined
          ? { not: `${by} is on it` }
          : {}),
    });
  }
  return out;
}

/** The spells the character can cast: known, prepared or granted. */
function spellsOf(doc: CharacterDoc, sheet: DerivedSheet): Set<string> {
  const names = new Set<string>();
  for (const block of Object.values(doc.spellcasting)) {
    for (const r of [...block.known, ...block.prepared]) names.add(lower(r.name));
  }
  for (const g of sheet.grantedSpells) names.add(lower(g.name));
  return names;
}

/** How a part reads on the detail: what helps, protects, warns or only informs. */
function toneOf(p: EffectPart): 'help' | 'ward' | 'warn' | 'info' {
  switch (p.kind) {
    case 'cue':
      return p.tone;
    case 'resist':
    case 'immune':
    case 'conditionImmune':
      return 'ward';
    case 'vulnerable':
      return 'warn';
    case 'rollAdvantage':
      return p.mode === 'dis' ? 'warn' : 'help';
    default:
      return 'help';
  }
}

function Line({ tone, children }: { tone: 'help' | 'ward' | 'warn' | 'info'; children: string }) {
  const icon =
    tone === 'ward' ? (
      <ShieldHalf size={16} aria-hidden="true" className="mt-px shrink-0 text-ward" />
    ) : tone === 'warn' ? (
      <AlertTriangle size={16} aria-hidden="true" className="mt-px shrink-0 text-guide" />
    ) : tone === 'info' ? (
      <Info size={16} aria-hidden="true" className="mt-px shrink-0 text-ink-muted" />
    ) : (
      <ChevronsUp size={16} aria-hidden="true" className="mt-px shrink-0 text-heal" />
    );
  return (
    <li className={`flex gap-1.5 text-caption ${tone === 'info' ? 'text-ink-muted' : 'text-ink'}`}>
      {icon}
      <span>{children}</span>
    </li>
  );
}

/** "Spell, 2nd level. Concentration, up to 1 hour." */
const metaOf = (e: CatalogEntry) => (e.own === true ? e.what : `${e.what}. ${e.lastsSay}.`);

export interface EffectFinderProps {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  query: string;
  /** The entry being looked at, by id; none while the results show. */
  picked: string | null;
  onPick: (id: string | null) => void;
  /** Put it on the character, with any temporary hit points it gives. */
  onAdd: (effect: ActiveEffect, tempHp?: number) => void;
}

export default function EffectFinder({
  doc,
  sheet,
  query,
  picked,
  onPick,
  onAdd,
}: EffectFinderProps) {
  const edition = doc.rulesVersion;
  const entries = useMemo(() => catalogFor(edition), [edition]);
  const effects = effectsInPlay(doc.play);
  const ownNames = useMemo(
    () =>
      new Set(
        sheet.actions.flatMap((a) => {
          const start = namedStart(a, doc);
          return start === undefined ? [] : [lower(start.name)];
        }),
      ),
    [sheet.actions, doc],
  );
  // A feature that is not the character's own never lands on them, so it is not found.
  const findable = useMemo(
    () => entries.filter((e) => e.own !== true || ownNames.has(lower(e.name))),
    [entries, ownNames],
  );
  const entry = picked === null ? undefined : findable.find((e) => e.id === picked);
  const found = useMemo(() => searchCatalog(findable, query), [findable, query]);
  const trimmed = query.trim();
  const who = doc.name || 'you';
  // What the words found, said once typing settles: a count for the word, not
  // one per letter. A repeat, since a new query with the same count is a new
  // answer. A count still settling is dropped when an entry opens, the words
  // change or the search goes away: it is about results nobody is on any more.
  useEffect(() => {
    if (picked !== null || trimmed === '') return;
    announce(
      found.length === 0
        ? `Nothing called ${trimmed} that can land on ${who}`
        : `${found.length} found`,
      { key: 'effect-search', settleMs: SEARCH_SETTLE_MS, repeat: true },
    );
    return () => cancelAnnouncement('effect-search');
  }, [picked, trimmed, found.length, who]);
  if (entry !== undefined) {
    return (
      <EntryDetail
        key={entry.id}
        entry={entry}
        entries={entries}
        doc={doc}
        sheet={sheet}
        effects={effects}
        onBack={() => onPick(null)}
        onAdd={onAdd}
      />
    );
  }

  const shown = found.slice(0, RESULTS_SHOWN);
  const more = found.length - shown.length;
  return (
    <div className="flex flex-col gap-2">
      {shown.length > 0 ? (
        <ul aria-label="Effects found" className="flex flex-col gap-1.5">
          {shown.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onPick(e.id)}
                className="flex min-h-tap w-full flex-col items-start gap-0.5 rounded-control bg-surface-raised px-3 py-2.5 text-left hover:bg-surface-hover"
              >
                {/* The spaces part the lines when the button's name is read out. */}
                <span className="font-semibold text-body text-ink">{e.name}</span>{' '}
                <span className="text-caption text-ink-muted">{metaOf(e)}</span>{' '}
                <span
                  className={`text-caption ${e.own === true || e.self === true ? 'text-ink-muted' : 'text-heal'}`}
                >
                  {e.sum}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink">
          Nothing called “{trimmed}” that can land on {who}.
        </p>
      )}
      {more > 0 && (
        <p className="text-caption text-ink-muted">{more} more. Keep typing to narrow them.</p>
      )}
    </div>
  );
}

/** "2d10" rolled: a number the field starts with, and the button rolls again. */
const rollOf = (dice: string) => String(roll(dice).total);

function EntryDetail({
  entry,
  entries,
  doc,
  sheet,
  effects,
  onBack,
  onAdd,
}: {
  entry: CatalogEntry;
  entries: readonly CatalogEntry[];
  doc: CharacterDoc;
  sheet: DerivedSheet;
  effects: readonly ActiveEffect[];
  onBack: () => void;
  onAdd: (effect: ActiveEffect, tempHp?: number) => void;
}) {
  const ids = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const weapons = weaponChoices(sheet, effects);
  const free = weapons.filter((w) => w.not === undefined);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const start = initialAnswers(entry);
    for (const q of entry.asks) {
      if (q.kind === 'roll') start[q.key] = rollOf(q.dice);
      // One weapon to put it on is the one it goes on.
      if (q.kind === 'weapon' && free.length === 1 && free[0] !== undefined)
        start[q.key] = free[0].id;
    }
    return start;
  });
  // Opening an entry moves focus to its name, so a screen reader starts there.
  useEffect(() => heading.current?.focus(), []);
  const set = (key: string, value: string) => setAnswers((was) => ({ ...was, [key]: value }));

  const asks = asksShown(entry, answers);
  const missing = unanswered(entry, answers);
  const castable = entry.self !== true || spellsOf(doc, sheet).has(lower(entry.name));
  const needsWeapon = asks.some((q) => q.kind === 'weapon');
  const noWeapon = needsWeapon && free.length === 0;
  const landed = landEntry(entry, answers as Answers, '');
  const weaponName = (id: string) => weapons.find((w) => w.id === id)?.name;
  const borrowed =
    entry.borrows === undefined ? undefined : entries.find((e) => e.id === entry.borrows);
  // Your own concentration spell cast again: the one already on ends, and
  // this takes its place.
  const recast =
    heldByMe(landed.effect) &&
    effects.find((e) => heldByMe(e) && lower(e.name) === lower(landed.effect.name));
  // Another of the same name already on counts instead: they never add up.
  // One switched off blocks nothing, one on another weapon is on another
  // target, and the one a recast replaces is gone.
  const groups = countsAs(landed.effect);
  const twin = effects.find(
    (e) => e !== recast && e.off !== true && [...countsAs(e)].some((g) => groups.has(g)),
  );
  const focus = doc.play.concentratingOn?.label;
  const endsFocus =
    entry.self === true &&
    entry.lasts.concentration === true &&
    focus !== undefined &&
    lower(focus) !== lower(landed.effect.name);
  const who = doc.name || 'you';
  const canAdd = entry.own !== true && castable && !noWeapon && missing.length === 0;

  const add = () => {
    if (!canAdd) return;
    const { effect, tempHp } = landEntry(entry, answers as Answers, randomId());
    onAdd(effect, tempHp);
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="-my-1.5 -ml-2 flex min-h-tap items-center gap-1.5 self-start px-2 font-semibold text-caption text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        All effects
      </button>
      <div>
        <h3 ref={heading} tabIndex={-1} className="font-semibold text-body text-ink outline-none">
          {entry.name}
        </h3>
        <p className="text-caption text-ink-muted">{metaOf(entry)}</p>
        {borrowed !== undefined && (
          <p className="text-caption text-ink-muted">Works as {borrowed.name} does.</p>
        )}
      </div>

      {entry.own !== true &&
        castable &&
        asks.map((q) => (
          <Ask
            key={q.key}
            ask={q}
            id={`${ids}-${q.key}`}
            value={answers[q.key]}
            onChange={(v) => set(q.key, v)}
            weapons={weapons}
          />
        ))}

      <div>
        <h4 className="mb-1 font-semibold text-caption text-ink-muted">On {who}</h4>
        <ul className="flex flex-col gap-1">
          {entry.own === true ? (
            <Line tone="info">
              {`${entry.name} is your own feature. Use it from Play: it spends a use there and lands here by itself, with its numbers.`}
            </Line>
          ) : !castable ? (
            <Line tone="info">
              {`${entry.name} lands only on its caster, and ${who === 'you' ? 'you do' : `${who} does`} not have the spell.`}
            </Line>
          ) : (
            <>
              {landed.effect.parts.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the parts have no id, and their order is the entry's own
                <Line key={i} tone={toneOf(p)}>
                  {partLine(p, weaponName)}
                </Line>
              ))}
              {landed.tempHp !== undefined && (
                <Line tone="help">
                  {`${landed.tempHp} temporary hit points now, gone when it ends`}
                </Line>
              )}
              {twin !== undefined && (
                <Line tone="warn">
                  {`${twin.name} is already on ${who}: effects of one name count once`}
                </Line>
              )}
              {recast && (
                <Line tone="warn">{`Casting it again ends the ${recast.name} already on ${who}`}</Line>
              )}
              {endsFocus && (
                <Line tone="warn">{`You are concentrating on ${focus}: this ends it`}</Line>
              )}
              {noWeapon && (
                <Line tone="warn">
                  {weapons.length === 0
                    ? 'It needs a nonmagical weapon, and you carry none'
                    : 'It needs a nonmagical weapon, and none of yours is free'}
                </Line>
              )}
            </>
          )}
        </ul>
      </div>

      {entry.own !== true && castable && (
        <Button variant="brand" block disabled={!canAdd} onClick={add}>
          {noWeapon
            ? 'No weapon to put it on'
            : missing.length > 0
              ? `Choose above to add it`
              : twin !== undefined
                ? `Add another to ${who}`
                : `Add to ${who}`}
        </Button>
      )}
    </div>
  );
}

function Ask({
  ask,
  id,
  value,
  onChange,
  weapons,
}: {
  ask: CatalogAsk;
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
  weapons: readonly WeaponChoice[];
}) {
  const head = (
    <h4 id={id} className="mb-1 font-semibold text-caption text-ink-muted">
      {ask.label}
    </h4>
  );
  if (ask.kind === 'roll') {
    const n = Number(value);
    const { min, max } = rollRange(ask.dice);
    const wrong = value !== undefined && value !== '' && !(n >= min && n <= max);
    return (
      <div>
        <label htmlFor={`${id}-n`} className="mb-1 block font-semibold text-caption text-ink-muted">
          {ask.label}
        </label>
        {/* The button keeps its words on one line, and drops below the field when they do not fit beside it. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-24 shrink-0">
            <input
              id={`${id}-n`}
              inputMode="numeric"
              value={value ?? ''}
              onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
              aria-invalid={wrong ? true : undefined}
              aria-describedby={`${id}-hint`}
              className={`${fieldClass} text-center tabular-nums`}
            />
          </div>
          <Button
            variant="outline"
            className="whitespace-nowrap"
            onClick={() => onChange(rollOf(ask.dice))}
          >
            <Dices size={18} aria-hidden="true" />
            Roll {ask.dice} again
          </Button>
        </div>
        <p
          id={`${id}-hint`}
          className={`mt-1 text-caption ${wrong ? 'text-danger' : 'text-ink-muted'}`}
        >
          Rolled here, or type your own: {min} to {max}.
        </p>
      </div>
    );
  }
  if (ask.kind === 'weapon') {
    const free = weapons.filter((w) => w.not === undefined);
    const not = weapons.filter((w) => w.not !== undefined);
    return (
      <div>
        {head}
        {free.length > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs
          <div role="group" aria-labelledby={id} className="-mx-1.5 flex flex-wrap">
            {free.map((w) => (
              <Chip key={w.id} pressed={value === w.id} onClick={() => onChange(w.id)}>
                {w.name}
              </Chip>
            ))}
          </div>
        )}
        {not.length > 0 && (
          <p className="mt-1 text-caption text-ink-muted">
            Not offered: {not.map((w) => `${w.name} (${w.not})`).join(', ')}.
          </p>
        )}
      </div>
    );
  }
  if (ask.options.length <= 4 && ask.initial !== undefined) {
    return (
      <div>
        {head}
        <SegmentedControl
          label={ask.label}
          options={ask.options}
          value={value ?? ask.initial}
          onChange={onChange}
          block
        />
      </div>
    );
  }
  return (
    <div>
      {head}
      {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
      <div role="group" aria-labelledby={id} className="-mx-1.5 flex flex-wrap">
        {ask.options.map((o) => (
          <Chip key={o.value} pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
