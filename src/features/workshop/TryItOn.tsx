/**
 * Try it on (ADR-002 D1, board 3): the entry being made, on a character, before
 * it is saved. The sheet is worked out twice, as the character stands and with
 * the entry (an item worn and attuned, a feat taken, a species or background in
 * place of theirs, a condition put on), and what moved is listed: "Strength 19,
 * was 8". Nothing is saved to the character.
 *
 * The entry reaches the engine through the registry's lookups with the entry in
 * front (`withEntry`), keyed by the name and book Save would store it under, so
 * what is tried on is what Save would write, not the copy's original.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useTypePacks } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { characterRepo } from '@/db/characterRepo';
import { hasMissingData, missingCharacterData } from '@/engine/dataNeeds';
import { deriveSheet } from '@/engine/derive';
import { needsAttunement } from '@/engine/effects/item';
import {
  ABILITIES,
  type Ability,
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
  SKILLS,
} from '@/engine/types';
import { errorText } from '@/stores/notices';
import type { Json } from './editorTypes';
import { Field, Section, Select } from './fields';

/** The kinds a character can be tried in: each is held one way (`wearing`). */
export const TRY_ON_TYPES: ReadonlySet<string> = new Set([
  'item',
  'feat',
  'race',
  'background',
  'condition',
]);

const lower = (v: unknown) => String(v ?? '').toLowerCase();

/**
 * The engine's lookups with `entry` in front for its type: found by its name
 * and book before anything the registry holds, and first in its type's list
 * (a homebrew condition is found by name in that list). Rules, rule sets and
 * packs come through as they are.
 */
export function withEntry(ctx: EngineContext, type: string, entry: Json): EngineContext {
  const name = lower(entry.name);
  const source = lower(entry.source);
  const isIt = (e: DataEntity) => lower(e.name) === name && lower(e.source) === source;
  let list: readonly DataEntity[] | undefined;
  return {
    ...ctx,
    get: (t, n, s) =>
      t === type && lower(n) === name && (s === undefined || lower(s) === source)
        ? entry
        : ctx.get(t, n, s),
    byType: (t) => {
      if (t !== type) return ctx.byType(t);
      list ??= [entry, ...ctx.byType(t).filter((e) => !isIt(e))];
      return list;
    },
  };
}

const sameRef = (a: EntityRef | undefined, b: EntityRef) =>
  a !== undefined && lower(a.name) === lower(b.name) && lower(a.source) === lower(b.source);

/** `doc` holding `entry` as a character holds one of its kind; undefined for a kind it cannot. */
export function wearing(doc: CharacterDoc, type: string, entry: Json): CharacterDoc | undefined {
  const ref = { name: String(entry.name ?? ''), source: String(entry.source ?? '') };
  const next = structuredClone(doc);
  switch (type) {
    case 'item': {
      const attune = needsAttunement(entry);
      const held = next.equipment.find((e) => sameRef(e.ref, ref));
      if (held !== undefined) {
        held.equipped = true;
        held.attuned = held.attuned || attune;
      } else {
        next.equipment.push({ id: 'try-it-on', ref, qty: 1, equipped: true, attuned: attune });
      }
      return next;
    }
    case 'feat':
      if (!next.feats.some((f) => sameRef(f.ref, ref)))
        next.feats.push({ ref, instanceId: 'try-it-on' });
      return next;
    case 'race':
      next.race = ref;
      delete next.subrace;
      return next;
    case 'background':
      next.background = ref;
      return next;
    case 'condition':
      if (!next.play.conditions.some((c) => lower(c.id) === lower(ref.name)))
        next.play.conditions.push({ id: ref.name });
      return next;
    default:
      return undefined;
  }
}

/** How the entry is held, as the result says it. */
const HELD: Readonly<Record<string, (entry: Json) => string>> = {
  item: (e) => (needsAttunement(e) ? 'Worn and attuned.' : 'Worn.'),
  feat: () => 'Taken as a feat.',
  race: () => 'As their species, in place of their own.',
  background: () => 'As their background, in place of their own.',
  condition: () => 'With the condition on.',
};

/** One number or list that the entry moves. */
export interface Change {
  label: string;
  now: string;
  was: string;
  /** Up or down, for a number; absent for a list. */
  way?: 'up' | 'down';
}

const ABILITY_NAMES: Readonly<Record<Ability, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};
const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const plain = (n: number) => String(n);
const listed = (xs: readonly string[]) => (xs.length === 0 ? 'none' : xs.join(', '));
const skillName = (key: string) =>
  SKILLS.find((s) => s.name.toLowerCase() === key.toLowerCase())?.name ?? key;

/** What moved from `was` to `now`, in the order the sheet shows it. */
export function changesOn(was: DerivedSheet, now: DerivedSheet): Change[] {
  const out: Change[] = [];
  const number = (label: string, a: number, b: number, show = plain) => {
    if (a !== b) out.push({ label, now: show(b), was: show(a), way: b > a ? 'up' : 'down' });
  };
  const list = (label: string, a: readonly string[], b: readonly string[]) => {
    const x = [...new Set(a)].sort();
    const y = [...new Set(b)].sort();
    if (x.join('|') !== y.join('|')) out.push({ label, now: listed(y), was: listed(x) });
  };
  for (const ab of ABILITIES)
    number(ABILITY_NAMES[ab], was.abilities[ab].value, now.abilities[ab].value);
  number('Armor Class', was.ac.value, now.ac.value);
  number('Hit point maximum', was.maxHp.value, now.maxHp.value);
  number('Speed', was.speedWalk.value, now.speedWalk.value, (n) => `${n} ft.`);
  number('Initiative', was.initiative.value, now.initiative.value, signed);
  number('Proficiency bonus', was.profBonus.value, now.profBonus.value, signed);
  for (const ab of ABILITIES)
    number(
      `${ABILITY_NAMES[ab]} saves`,
      was.saves[ab].total.value,
      now.saves[ab].total.value,
      signed,
    );
  for (const key of Object.keys(now.skills)) {
    const a = was.skills[key]?.total.value;
    const b = now.skills[key]?.total.value;
    if (a !== undefined && b !== undefined) number(skillName(key), a, b, signed);
  }
  number('Passive Perception', was.passivePerception.value, now.passivePerception.value);
  for (const block of now.spellcasting) {
    const before = was.spellcasting.find((b) => b.classUid === block.classUid);
    if (before === undefined) continue;
    number(`${block.className} spell save DC`, before.saveDc.value, block.saveDc.value);
    number(
      `${block.className} spell attacks`,
      before.attackMod.value,
      block.attackMod.value,
      signed,
    );
  }
  const speeds = (s: DerivedSheet) => s.otherSpeeds.map((x) => `${x.mode} ${x.value} ft.`);
  list('Other speeds', speeds(was), speeds(now));
  const senses = (s: DerivedSheet) => s.senses.map((x) => `${x.sense} ${x.range} ft.`);
  list('Senses', senses(was), senses(now));
  list(
    'Resistances',
    was.resists.map((r) => r.damageType),
    now.resists.map((r) => r.damageType),
  );
  list(
    'Immunities',
    was.immunities.map((r) => r.damageType),
    now.immunities.map((r) => r.damageType),
  );
  list(
    'Condition immunities',
    was.conditionImmunities.map((r) => r.condition),
    now.conditionImmunities.map((r) => r.condition),
  );
  list('Languages', was.languages, now.languages);
  list('Armor', was.armorProfs, now.armorProfs);
  list('Weapons', was.weaponProfs, now.weaponProfs);
  list('Tools', was.toolProfs, now.toolProfs);
  return out;
}

/** Someone to try the entry on: a sample, or one of the player's characters. */
export interface Wearer {
  key: string;
  label: string;
  /** What the result says about them. */
  note: string;
  doc: CharacterDoc;
}

const SAMPLE_SCORES = {
  martial: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  // Strength 8, so an item that sets a score shows what it does.
  caster: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
} as const;

/** The class a sample is made of: one by these names first (the 2024 printing first), else `fits`. */
function pickClass(
  classes: readonly DataEntity[],
  names: readonly string[],
  fits: (c: DataEntity) => boolean,
): DataEntity | undefined {
  for (const name of names) {
    const named = classes.filter((c) => lower(c.name) === name);
    const found = named.find((c) => lower(c.source) === 'xphb') ?? named[0];
    if (found !== undefined) return found;
  }
  return classes.find(fits);
}

function sample(
  key: string,
  cls: DataEntity | undefined,
  scores: CharacterDoc['abilities']['base'],
) {
  const doc = newCharacterDoc(`try-it-on-${key}`, 'Sample', '');
  doc.abilities.method = 'manual';
  doc.abilities.base = { ...scores };
  if (cls !== undefined) {
    const ability = cls.spellcastingAbility;
    if (typeof ability === 'string' && ability in doc.abilities.base)
      doc.abilities.base[ability as Ability] = 16;
    doc.rulesVersion = lower(cls.source) === 'xphb' || cls.edition === 'one' ? '2024' : '2014';
    doc.classes = [
      {
        ref: { name: String(cls.name), source: String(cls.source) },
        levels: 5,
        hp: ['avg', 'avg', 'avg', 'avg', 'avg'],
      },
    ];
  }
  const label = cls === undefined ? 'A sample character' : `A level 5 ${lower(cls.name)}`;
  const base = doc.abilities.base;
  const note = `A sample, with ${ABILITIES.map((a) => `${ABILITY_NAMES[a]} ${base[a]}`).join(', ')}.`;
  return { key, label, note, doc };
}

/** Two sample characters from the classes the data has: a fighter, and a caster with Strength 8. */
export function samplesOf(ctx: Pick<EngineContext, 'byType'>): Wearer[] {
  const classes = ctx.byType('class');
  const casts = (c: DataEntity) => typeof c.spellcastingAbility === 'string';
  const martial = pickClass(classes, ['fighter', 'barbarian', 'warrior'], (c) => !casts(c));
  const caster = pickClass(classes, ['wizard', 'sorcerer'], casts);
  const out = [sample('martial', martial ?? classes[0], SAMPLE_SCORES.martial)];
  if (caster !== undefined && caster !== (martial ?? classes[0]))
    out.push(sample('caster', caster, SAMPLE_SCORES.caster));
  return out;
}

/** What trying `entry` on `doc` shows. */
export type Tried =
  | { state: 'changed'; changes: Change[]; missing: boolean }
  | { state: 'none'; missing: boolean }
  | { state: 'failed'; text: string };

export function tryOn(ctx: EngineContext, doc: CharacterDoc, type: string, entry: Json): Tried {
  try {
    const on = wearing(doc, type, entry);
    if (on === undefined) return { state: 'failed', text: 'this kind cannot be tried on yet' };
    const was = deriveSheet(doc, ctx);
    const withIt = withEntry(ctx, type, entry);
    const now = deriveSheet(on, withIt);
    const missing = hasMissingData(missingCharacterData(on, withIt));
    const changes = changesOn(was, now);
    return changes.length === 0
      ? { state: 'none', missing }
      : { state: 'changed', changes, missing };
  } catch (err) {
    return { state: 'failed', text: errorText(err) };
  }
}

/** The most rows the result lists before it says how many more there are. */
const SHOWN = 8;

export function TryItOn({
  type,
  entry,
  registry,
}: {
  /** The registry type: `race` for a species. */
  type: string;
  /** The entry as Save would store it, under the name and book it would have. */
  entry: Json;
  registry: EntityRegistry;
}) {
  // A sample's class may not have downloaded yet on this page.
  useTypePacks('class');
  const roster = useLiveQuery(
    () =>
      characterRepo
        .listSafe()
        .then((r) => r.characters)
        .catch(() => [] as CharacterDoc[]),
    [],
  );
  const ctx = useMemo(() => engineContextFor(registry), [registry]);
  const wearers = useMemo<Wearer[]>(
    () => [
      ...samplesOf(ctx),
      ...(roster ?? []).map((doc) => ({
        key: doc.id,
        label: doc.name.trim() || 'Unnamed character',
        note: `Your character. Nothing is saved to ${doc.name.trim() || 'them'} by trying it on.`,
        doc,
      })),
    ],
    [ctx, roster],
  );
  const [pick, setPick] = useState<string>();
  const who = wearers.find((w) => w.key === pick) ?? wearers[0];
  // The sheet is worked out twice for every key typed; the result may lag.
  const seen = useDeferredValue(entry);
  const tried = useMemo(
    () => (who === undefined ? undefined : tryOn(ctx, who.doc, type, seen)),
    [ctx, who, type, seen],
  );
  if (!TRY_ON_TYPES.has(type) || who === undefined || tried === undefined) return null;
  const name = who.key.startsWith('try-it-on') ? 'the sample' : who.label;
  const changes = tried.state === 'changed' ? tried.changes : [];
  return (
    <Section title="Try it on">
      <Field label="Try it on">
        <Select value={who.key} onChange={(e) => setPick(e.target.value)}>
          {wearers.map((w) => (
            <option key={w.key} value={w.key}>
              {w.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-2 rounded-card bg-surface p-3 ring-1 ring-line ring-inset">
        <p className="text-caption text-ink-muted">
          {HELD[type]?.(entry)} {who.note}
        </p>
        {tried.state === 'failed' && (
          <p className="text-body">The sheet could not be worked out with it: {tried.text}.</p>
        )}
        {tried.state === 'none' && (
          <p className="text-body">
            Nothing on {name}&rsquo;s sheet changes. An effect that counts only at some times (Only
            while, Counts when) shows on the sheet then.
          </p>
        )}
        {changes.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {changes.slice(0, SHOWN).map((c) => (
              <li
                key={c.label}
                className="flex min-w-0 flex-col rounded-control bg-surface-raised px-3 py-2"
              >
                <span className="text-label text-ink-muted">{c.label}</span>
                <span className="flex items-center gap-1 text-body-strong wrap-anywhere">
                  {c.way === 'up' && <ArrowUp size={14} aria-hidden className="shrink-0" />}
                  {c.way === 'down' && <ArrowDown size={14} aria-hidden className="shrink-0" />}
                  {c.now}
                </span>
                <span className="text-caption text-ink-muted wrap-anywhere">was {c.was}</span>
              </li>
            ))}
          </ul>
        )}
        {changes.length > SHOWN && (
          <p className="text-caption text-ink-muted">
            And {changes.length - SHOWN} more on the sheet.
          </p>
        )}
        {tried.state !== 'failed' && tried.missing && (
          <p className="text-caption text-ink-muted">
            Some of {name}&rsquo;s data has not downloaded yet, so a number here may be off.
          </p>
        )}
      </div>
    </Section>
  );
}
