/**
 * What + Effect finds when you search it (the buffs canvas, Catalog board):
 * the results for the words typed, and the one tapped, with the questions it
 * asks before it lands and what it will do on this character. Before anything
 * is typed, the effects of the tab it was opened on (the rolls and casting
 * canvas, Effects C). It and the table it reads load in a chunk of their own
 * when the Effects sheet opens.
 */
import { ArrowLeft, ChevronDown, Dices, PencilLine } from 'lucide-react';
import { type Ref, useEffect, useId, useMemo, useRef, useState } from 'react';
import { roll } from '@/dice/roll';
import { countsAs, namedEffect } from '@/engine/activeEffects';
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
import type {
  ActiveEffect,
  CharacterDoc,
  DerivedSheet,
  EffectPart,
  KeptEffect,
} from '@/engine/types';
import { randomId } from '@/lib/randomId';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { fieldClass } from '@/ui/TextField';
import { keptEffects } from './describedEffect';
import { EffectBuilder } from './EffectBuilder';
import { Line, toneOf } from './effectLines';
import { effectsInPlay, partLine, restLasts } from './effectsInPlay';
import { type NamedStart, namedStart, STARTERS } from './namedStarts';

/** At most this many results show; typing more narrows the rest. */
export const RESULTS_SHOWN = 6;

/** A sheet tab whose + Effect leads with its own kind of effect. Build has none. */
export type EffectTab = 'play' | 'stats' | 'spells' | 'items' | 'features';

/** At most this many of a tab's own effects show at first, so Conditions stay near. */
export const TAB_SHOWN = 3;

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

/** "Spell, 2nd level. Concentration, up to 1 hour." */
const metaOf = (e: CatalogEntry) => (e.own === true ? e.what : `${e.what}. ${e.lastsSay}.`);

/** A kept description's id in the search, apart from the catalog's. */
const KEPT = 'kept:';

/** A description the character kept, as the search lists it beside the catalog's entries. */
export function keptEntry(k: KeptEffect, who: string): CatalogEntry {
  const lines = k.parts.map((p) => partLine(p));
  if (k.tempHp !== undefined) lines.push(`${k.tempHp} temporary hit points`);
  const sum =
    lines.slice(0, 2).join(', ') + (lines.length > 2 ? `, and ${lines.length - 2} more` : '');
  return {
    id: `${KEPT}${k.id}`,
    name: k.name,
    what: `Described for ${who}`,
    keywords: 'described kept homebrew',
    sum: sum === '' ? 'Nothing it changes' : sum,
    lastsSay: restLasts(
      { id: k.id, name: k.name, parts: k.parts, ...(k.lasts ? { lasts: k.lasts } : {}) },
      true,
    ),
    lasts: k.lasts ?? {},
    asks: [],
    build: () => ({
      parts: structuredClone(k.parts),
      ...(k.tempHp !== undefined ? { tempHp: k.tempHp } : {}),
    }),
  };
}

/** What a tab's own effects are called, over their list. */
export function tabGroupTitle(tab: EffectTab, who: string): string {
  switch (tab) {
    case 'play':
      return 'For attacks and damage';
    case 'stats':
      return 'For checks and saves';
    case 'spells':
      return `Spells cast on ${who}`;
    case 'items':
      return 'Potions';
    case 'features':
      return 'Features';
  }
}

/** The answers an entry is looked at with before any is given: each question's own choice, else its first. */
function firstAnswers(entry: CatalogEntry): Answers {
  const out: Record<string, string> = {};
  for (const q of entry.asks) {
    if (q.kind === 'pick') {
      const v = q.initial ?? q.options[0]?.value;
      if (v !== undefined) out[q.key] = v;
    } else if (q.kind === 'roll') out[q.key] = String(rollRange(q.dice).min);
  }
  return out;
}

/** The d20 rolls a part changes, when it changes some. */
const rollsOf = (p: EffectPart): readonly string[] =>
  p.kind === 'rollDie' || p.kind === 'rollOffer' || p.kind === 'rollAdvantage' ? p.on.rolls : [];

/** A line on what helps that says what it helps with: "+1d6 damage when you hit your quarry". */
const helpSays = (p: EffectPart, words: RegExp) =>
  p.kind === 'cue' && p.tone === 'help' && words.test(p.text);

const ATTACK_PARTS = new Set<EffectPart['kind']>([
  'attackBonus',
  'damageBonus',
  'damageDie',
  'critRange',
  // Haste's action: one attack is among what it may be spent on.
  'extraAction',
]);
const TEST_PARTS = new Set<EffectPart['kind']>([
  'saveBonus',
  'checkBonus',
  'abilityMin',
  'initiativeBonus',
]);

/** It changes an attack roll or its damage, or gives an action to attack with. */
const forAttacks = (p: EffectPart) =>
  ATTACK_PARTS.has(p.kind) || rollsOf(p).includes('attack') || helpSays(p, /\b(attack|damage)\b/i);

/**
 * It changes a check or a save, or the score they are made with. Its parts
 * alone say so: a line's words name a save another makes too (Dragon's Breath).
 */
const forTests = (p: EffectPart) =>
  TEST_PARTS.has(p.kind) || rollsOf(p).some((r) => r !== 'attack');

/** The entry is of the tab's kind: by what it is, or by what its effect changes. */
function belongs(tab: EffectTab, entry: CatalogEntry, effect: ActiveEffect): boolean {
  switch (tab) {
    case 'play':
      return effect.parts.some(forAttacks);
    case 'stats':
      return effect.parts.some(forTests);
    case 'spells':
      return /^(spell|cantrip)\b/i.test(entry.what);
    case 'items':
      return entry.what === 'Potion';
    case 'features':
      return /\bfeature\b/i.test(entry.what);
  }
}

/** The names an effect counts as: its own, the named effect it is, and each part's. */
const namesOf = (e: ActiveEffect): string[] =>
  [e.name, ...(e.same !== undefined ? [e.same] : []), ...e.parts.map((p) => namedEffect(e, p))].map(
    lower,
  );

/** A name in its words, so "Potion of Hill Giant Strength" is seen to hold "Potion of Giant Strength". */
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '');

/** The character carries this potion: an item named with every word of its name ("Potion of Fire Resistance"). */
export function carries(entry: CatalogEntry, carried: readonly string[]): boolean {
  if (entry.what !== 'Potion') return false;
  const need = wordsOf(entry.name);
  return carried.some((name) => {
    const has = new Set(wordsOf(name));
    return need.every((w) => has.has(w));
  });
}

/** What a tab's list reads of the character, beside the catalog. */
export interface TabCharacter {
  /** The effects on the character now: none of them, nor one of their names, is offered again. */
  effects: readonly ActiveEffect[];
  /** The spells the character has, by lowercase name: a spell on its caster only needs one. */
  spells: ReadonlySet<string>;
  /** The names of the items the character carries. */
  carried: readonly string[];
  /** What each of the character's own features starts (Rage), by lowercase name. */
  starts: ReadonlyMap<string, NamedStart>;
}

/**
 * The effects + Effect leads with on a tab, before anything is typed (the
 * rolls and casting canvas, Effects C), read from what the catalog already
 * says of each entry: what it is (a spell, a potion, a feature) and what its
 * parts change (an attack or its damage, a check or a save). The character's
 * own come first: their features, the spells only they can cast on themselves,
 * the potions they carry. Left out: the starters (Bless, Guidance, Bardic
 * Inspiration), whose chips follow in the same sheet; a spell only its caster
 * gets, when the character lacks it; and anything on the character now, or of
 * a name one on now counts as (a Potion of Speed while Hasted). Search still
 * finds every one of them.
 */
export function tabEffects(
  tab: EffectTab,
  entries: readonly CatalogEntry[],
  who: TabCharacter,
): CatalogEntry[] {
  const on = new Set(who.effects.flatMap(namesOf));
  const starters = new Set(STARTERS.map((s) => lower(s.name)));
  const kept = entries.filter((e) => {
    const name = lower(e.name);
    if (starters.has(name)) return false;
    if (e.self === true && !who.spells.has(name)) return false;
    // An own feature's catalog entry does nothing by itself: what it starts does.
    const own = who.starts.get(name)?.build('');
    // What it counts as before any answer is given: a choice with no likelier
    // answer (a potion's damage type) names nothing yet, so an Acid potion on
    // does not hide the Potion of Resistance, of which a Fire one still adds.
    const as = own ?? landEntry(e, initialAnswers(e), '').effect;
    if ([name, ...namesOf(as)].some((n) => on.has(n))) return false;
    // What it does, each question answered with its first choice.
    return belongs(tab, e, own ?? landEntry(e, firstAnswers(e), '').effect);
  });
  const mine = (e: CatalogEntry) => e.own === true || e.self === true || carries(e, who.carried);
  return [...kept.filter(mine), ...kept.filter((e) => !mine(e))];
}

export interface EffectFinderProps {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  query: string;
  /** The entry being looked at, by id; none while the results show. */
  picked: string | null;
  onPick: (id: string | null) => void;
  /** Put it on the character, with any temporary hit points it gives and, described, what to keep. */
  onAdd: (effect: ActiveEffect, tempHp?: number, kept?: KeptEffect) => void;
  /** The name a description starts with while one is being made; none otherwise. */
  describing: string | null;
  onDescribe: (name: string | null) => void;
  /** Takes a kept description off the character, by its id; its name is the one shown. */
  onForget: (id: string, name: string) => void;
  /** The tab + Effect was opened on: with nothing typed, its own effects are listed. */
  tab?: EffectTab;
  /** The tab's whole list shows, not only its first few; kept while an entry is open. */
  allShown?: boolean;
  onShowAll?: () => void;
  /** Takes, once, the entry the tab's list opened, so Back puts focus on its row again. */
  takeReturn?: () => string | null;
}

export default function EffectFinder({
  doc,
  sheet,
  query,
  picked,
  onPick,
  onAdd,
  describing,
  onDescribe,
  onForget,
  tab,
  allShown = false,
  onShowAll,
  takeReturn,
}: EffectFinderProps) {
  const edition = doc.rulesVersion;
  const entries = useMemo(() => catalogFor(edition), [edition]);
  const effects = effectsInPlay(doc.play);
  // What each of the character's own features starts, by name (Rage).
  const starts = useMemo(() => {
    const out = new Map<string, NamedStart>();
    for (const a of sheet.actions) {
      const start = namedStart(a, doc);
      if (start !== undefined) out.set(lower(start.name), start);
    }
    return out;
  }, [sheet.actions, doc]);
  const who = doc.name || 'you';
  // A feature that is not the character's own never lands on them, so it is not found.
  const catalog = useMemo(
    () => entries.filter((e) => e.own !== true || starts.has(lower(e.name))),
    [entries, starts],
  );
  // What the character described and kept is found first, then the catalog.
  const kept = useMemo(() => keptEffects(doc.keptEffects), [doc.keptEffects]);
  const findable = useMemo(
    () => [...kept.map((k) => keptEntry(k, who)), ...catalog],
    [kept, who, catalog],
  );
  const entry = picked === null ? undefined : findable.find((e) => e.id === picked);
  const found = useMemo(() => searchCatalog(findable, query), [findable, query]);
  const trimmed = query.trim();
  // What the words found, said once typing settles: a count for the word, not
  // one per letter. A repeat, since a new query with the same count is a new
  // answer. A count still settling is dropped when an entry opens, the words
  // change or the search goes away: it is about results nobody is on any more.
  useEffect(() => {
    if (picked !== null || describing !== null || trimmed === '') return;
    announce(
      found.length === 0
        ? `Nothing called ${trimmed} that can land on ${who}`
        : `${found.length} found`,
      { key: 'effect-search', settleMs: SEARCH_SETTLE_MS, repeat: true },
    );
    return () => cancelAnnouncement('effect-search');
  }, [picked, describing, trimmed, found.length, who]);
  if (describing !== null) {
    return (
      <EffectBuilder
        name={describing}
        who={who}
        effects={effects}
        onBack={() => onDescribe(null)}
        onAdd={onAdd}
      />
    );
  }
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
        onForget={
          entry.id.startsWith(KEPT)
            ? () => onForget(entry.id.slice(KEPT.length), entry.name)
            : undefined
        }
      />
    );
  }

  // Nothing typed: the tab's own effects, which the sheet's other lists follow.
  if (trimmed === '') {
    if (tab === undefined) return null;
    const carried = doc.equipment.flatMap((i) => {
      const name = i.ref?.name ?? i.custom?.name;
      return i.qty > 0 && name !== undefined ? [name] : [];
    });
    return (
      <TabGroup
        key={tab}
        title={tabGroupTitle(tab, who)}
        entries={tabEffects(tab, catalog, {
          effects,
          spells: spellsOf(doc, sheet),
          carried,
          starts,
        })}
        carried={carried}
        onPick={onPick}
        allShown={allShown}
        onShowAll={onShowAll}
        takeReturn={takeReturn}
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
              <EntryButton entry={e} onClick={() => onPick(e.id)} />
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
      {/* Not in the books, or not as your table plays it: describe it. */}
      <Button variant="outline" block onClick={() => onDescribe(trimmed)}>
        <PencilLine size={18} aria-hidden="true" />
        Describe “{trimmed}”
      </Button>
    </div>
  );
}

/** One entry in a list: its name, what it is, and what it does, opening it when tapped. */
function EntryButton({
  entry,
  carried = false,
  onClick,
  buttonRef,
}: {
  entry: CatalogEntry;
  /** A potion the character carries, which its line says. */
  carried?: boolean;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className="flex min-h-tap w-full flex-col items-start gap-0.5 rounded-control bg-surface-raised px-3 py-2.5 text-left hover:bg-surface-hover"
    >
      {/* The spaces part the lines when the button's name is read out. */}
      <span className="font-semibold text-body text-ink">{entry.name}</span>{' '}
      <span className="text-caption text-ink-muted">
        {carried ? `${entry.what}, carried. ${entry.lastsSay}.` : metaOf(entry)}
      </span>{' '}
      <span
        className={`text-caption ${entry.own === true || entry.self === true ? 'text-ink-muted' : 'text-heal'}`}
      >
        {entry.sum}
      </span>
    </button>
  );
}

/**
 * The tab's own effects, first in the sheet: a few, so Conditions stay near,
 * and the rest a tap away. Showing them moves focus to the first one shown,
 * and Back from an entry it opened puts focus on that entry's row again.
 */
function TabGroup({
  title,
  entries,
  carried,
  onPick,
  allShown,
  onShowAll,
  takeReturn,
}: {
  title: string;
  entries: readonly CatalogEntry[];
  carried: readonly string[];
  onPick: (id: string) => void;
  allShown: boolean;
  onShowAll: (() => void) | undefined;
  takeReturn: (() => string | null) | undefined;
}) {
  const id = useId();
  const [all, setAll] = useState(allShown);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // The row to put focus on once it is drawn: the first shown by Show more.
  const toRow = useRef<string | null>(null);
  useEffect(() => {
    const back = takeReturn?.() ?? null;
    if (back !== null) toRow.current = back;
    if (toRow.current === null) return;
    rows.current.get(toRow.current)?.focus();
    toRow.current = null;
  });
  if (entries.length === 0) return null;
  const shown = all ? entries : entries.slice(0, TAB_SHOWN);
  const more = entries.length - shown.length;
  return (
    <div className="mb-3 flex flex-col gap-1">
      <h3 id={id} className="font-semibold text-caption text-ink-muted">
        {title}
      </h3>
      <ul aria-labelledby={id} className="flex flex-col gap-1.5">
        {shown.map((e) => (
          <li key={e.id}>
            <EntryButton
              entry={e}
              carried={carries(e, carried)}
              onClick={() => onPick(e.id)}
              buttonRef={(el) => {
                if (el === null) rows.current.delete(e.id);
                else rows.current.set(e.id, el);
              }}
            />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            toRow.current = entries[TAB_SHOWN]?.id ?? null;
            setAll(true);
            onShowAll?.();
          }}
        >
          <ChevronDown size={16} aria-hidden="true" />
          Show {more} more
        </Button>
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
  onForget,
}: {
  entry: CatalogEntry;
  entries: readonly CatalogEntry[];
  doc: CharacterDoc;
  sheet: DerivedSheet;
  effects: readonly ActiveEffect[];
  onBack: () => void;
  onAdd: (effect: ActiveEffect, tempHp?: number) => void;
  /** Takes it off the character's kept list, when it is a description kept there. */
  onForget?: () => void;
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
      {onForget !== undefined && (
        <Button variant="ghost" block onClick={onForget}>
          Forget it
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
