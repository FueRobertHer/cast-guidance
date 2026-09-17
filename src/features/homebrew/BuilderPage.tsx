import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { invalidateRegistry } from '@/data5e/registry';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { ABILITIES, type Ability } from '@/engine/types';
import { DMG_TYPES, SCHOOLS } from '@/features/library/fmt';
import { entriesToText, textToEntries } from '@/lib/entriesText';
import { errorText, notify } from '@/stores/notices';
import { DecodeBoundary } from '@/ui/DecodeBoundary';
import {
  DEFAULT_RIDER_TYPE,
  damagePatch,
  defaultDamageType,
  isArmorType,
  isWeaponType,
  nextRiders,
  pruneItemFields,
} from './itemFields';
import { COMPLEX, readSpellGrant, type SpellGrant, writeSpellGrant } from './spellGrant';

type Json = Record<string, unknown>;

/** Builder v1 covers the flat schemas; the rest still import fine. */
const BUILDABLE = [
  ['item', 'Item'],
  ['feat', 'Feat'],
  ['spell', 'Spell'],
] as const;
type BuildType = (typeof BUILDABLE)[number][0];

const ITEM_TYPES: Array<[string, string]> = [
  ['M', 'Melee weapon'],
  ['R', 'Ranged weapon'],
  ['LA', 'Light armor'],
  ['MA', 'Medium armor'],
  ['HA', 'Heavy armor'],
  ['S', 'Shield'],
  ['RG', 'Ring'],
  ['W', 'Wondrous item'],
  ['P', 'Potion'],
  ['SC', 'Scroll'],
  ['WD', 'Wand'],
  ['G', 'Adventuring gear'],
];

const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
const CASTER_CLASSES = [
  'Bard',
  'Cleric',
  'Druid',
  'Paladin',
  'Ranger',
  'Sorcerer',
  'Warlock',
  'Wizard',
  'Artificer',
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children is always a form control (input/select/textarea)
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * A checkbox is a 20px square, so stacking it under a label the way a text
 * field does leaves it stranded in a cell sized for an input. It reads as a
 * setting only when the words sit beside the box, on a row of its own.
 */
function CheckField({
  label,
  checked,
  wide,
  onChange,
}: {
  label: string;
  checked: boolean;
  /** Spans both columns. For the last field on a form, where nothing pairs. */
  wide?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5 text-sm ${
        wide === true ? 'col-span-2' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      {label}
    </label>
  );
}

const inputCls =
  'rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-muted';

/**
 * The spell an item grants: a wand's cantrip, a cloak's daily misty step.
 *
 * Three boxes for the common case, and only after a spell is named, since a
 * usage count and a casting ability have nothing to describe until then. A file
 * that says more than these boxes can is reported rather than edited: the form
 * would have to throw away the rest of it to write its own answer back.
 */
function SpellGrantFields({ raw, onChange }: { raw: unknown; onChange: (v: unknown) => void }) {
  const parsed = readSpellGrant(raw);
  const [grant, setGrant] = useState<SpellGrant>(() =>
    parsed !== undefined && parsed !== COMPLEX ? parsed : { spell: '' },
  );
  if (parsed === COMPLEX) {
    return (
      <p className="col-span-2 rounded-lg border border-dashed border-surface-2 px-3 py-2 text-xs text-ink-muted">
        This item's spells were written by hand, and say more than these boxes can hold (several
        spells, or a level gate). Edit the file itself to change them.
      </p>
    );
  }
  const push = (next: SpellGrant) => {
    setGrant(next);
    onChange(writeSpellGrant(next));
  };
  return (
    <>
      <Field label="Grants spell">
        <input
          value={grant.spell}
          onChange={(e) => push({ ...grant, spell: e.target.value })}
          placeholder="misty step"
          className={inputCls}
        />
      </Field>
      {grant.spell.trim() !== '' && (
        <>
          <Field label="Uses per day">
            <input
              inputMode="numeric"
              value={grant.perDay ?? ''}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                push({ ...grant, perDay: Number.isNaN(n) || n <= 0 ? undefined : n });
              }}
              placeholder="blank = at will"
              className={inputCls}
            />
          </Field>
          <Field label="Spell ability">
            <select
              value={grant.ability ?? 'none'}
              onChange={(e) =>
                push({
                  ...grant,
                  ability: e.target.value === 'none' ? undefined : (e.target.value as Ability),
                })
              }
              className={inputCls}
            >
              <option value="none">none</option>
              {ABILITIES.map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </>
  );
}

/**
 * The file stores 5etools codes, but a dropdown reading "B / P / S / A / C"
 * asks the author to have memorized them. Spelled out to pick, code to save.
 */
function DamageTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {Object.entries(DMG_TYPES).map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** One form for create-or-edit of a single entity. */
function EntityForm({
  type,
  source,
  initial,
  onSave,
  onCancel,
  busy,
}: {
  type: BuildType;
  source: string;
  initial?: Json;
  /** Resolves when the write has settled; the form stays open until it does. */
  onSave: (entity: Json) => Promise<void>;
  onCancel: () => void;
  /** True while the page is writing anything, including a delete elsewhere. */
  busy: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(String(initial?.name ?? ''));
  const [text, setText] = useState(initial !== undefined ? entriesToText(initial.entries) : '');
  const [extra, setExtra] = useState<Json>(() => {
    const e: Json = {};
    if (initial === undefined) return e;
    for (const [k, v] of Object.entries(initial)) {
      if (k !== 'name' && k !== 'source' && k !== 'entries') e[k] = v;
    }
    return e;
  });

  /** Applies a patch; `undefined`, `''`, and `false` remove their key. */
  const setMany = (patch: Json) =>
    setExtra((x) => {
      const next = { ...x };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '' || value === false) delete next[key];
        else next[key] = value;
      }
      return next;
    });

  const set = (key: string, value: unknown) => setMany({ [key]: value });

  const riders: Json[] = Array.isArray(extra.extraDamage) ? (extra.extraDamage as Json[]) : [];
  const setRider = (key: 'dmg' | 'dmgType', value: string) =>
    set('extraDamage', nextRiders(riders, key, value));

  const spellClasses = Array.isArray(
    (extra.classes as { fromClassList?: unknown[] } | undefined)?.fromClassList,
  )
    ? ((extra.classes as { fromClassList: Array<{ name: string }> }).fromClassList.map(
        (c) => c.name,
      ) ?? [])
    : [];

  /**
   * Saving is a database write that can fail, so the form waits for it rather
   * than assuming it worked: the button says what it is doing and refuses a
   * second press, and a failure leaves every field exactly where it was
   * instead of closing over lost edits.
   */
  const save = async () => {
    if (name.trim() === '' || busy) return;
    const fields = type === 'item' ? pruneItemFields(extra) : extra;
    setSaving(true);
    await onSave({ name: name.trim(), source, ...fields, entries: textToEntries(text) });
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-purple-300/30 bg-surface p-3">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>

      {/*
       * `items-end` pins every control to the bottom of its row, so a label
       * that wraps to two lines pushes its own text up rather than shoving its
       * input out of line with the one beside it. Hints live in placeholders
       * for the same reason: a label long enough to wrap is what broke the
       * alignment in the first place.
       */}
      {type === 'item' && (
        <div className="grid grid-cols-2 items-end gap-2">
          <Field label="Type">
            <select
              value={String(extra.type ?? 'G')}
              onChange={(e) => set('type', e.target.value)}
              className={inputCls}
            >
              {ITEM_TYPES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rarity">
            <select
              value={String(extra.rarity ?? 'none')}
              onChange={(e) =>
                set('rarity', e.target.value === 'none' ? undefined : e.target.value)
              }
              className={inputCls}
            >
              <option value="none">mundane</option>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          {isWeaponType(extra.type) && (
            <>
              {/* Dice and type pair up on a row, twice: the weapon's own damage,
                  then the rider it carries. Anything else side by side asks the
                  reader to work out which box belongs to which. */}
              <Field label="Damage">
                <input
                  value={String(extra.dmg1 ?? '')}
                  onChange={(e) => setMany(damagePatch(e.target.value, extra.dmgType, extra.type))}
                  placeholder="1d8"
                  className={inputCls}
                />
              </Field>
              <Field label="Damage type">
                <DamageTypeSelect
                  value={String(extra.dmgType ?? defaultDamageType(extra.type))}
                  onChange={(v) => set('dmgType', v)}
                />
              </Field>
              {/* Extra damage of a second type, the flaming-sword case. Rolled
                  apart from the weapon die and without your ability modifier,
                  so it can't be folded into the damage box above. */}
              <Field label="Extra damage">
                <input
                  value={String(riders[0]?.dmg ?? '')}
                  onChange={(e) => setRider('dmg', e.target.value)}
                  placeholder="1d4"
                  className={inputCls}
                />
              </Field>
              <Field label="Extra damage type">
                <DamageTypeSelect
                  value={String(riders[0]?.dmgType ?? DEFAULT_RIDER_TYPE)}
                  onChange={(v) => setRider('dmgType', v)}
                />
              </Field>
              <Field label="Attack/damage bonus">
                <input
                  value={String(extra.bonusWeapon ?? '')}
                  onChange={(e) => set('bonusWeapon', e.target.value)}
                  placeholder="+1"
                  className={inputCls}
                />
              </Field>
            </>
          )}
          {isArmorType(extra.type) && (
            <Field label="AC">
              <input
                inputMode="numeric"
                value={String(extra.ac ?? '')}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  set('ac', Number.isNaN(n) ? undefined : n);
                }}
                className={inputCls}
              />
            </Field>
          )}
          {/* Magic armor and shields add their bonus on top of the base AC
              above, so this box belongs to every type: hiding it for armor was
              what let a stale bonus keep counting from off screen. */}
          <Field label="AC bonus">
            <input
              value={String(extra.bonusAc ?? '')}
              onChange={(e) => set('bonusAc', e.target.value)}
              placeholder={isArmorType(extra.type) ? '+1 (magic armor)' : '+1 (rings, cloaks)'}
              className={inputCls}
            />
          </Field>
          <SpellGrantFields
            raw={extra.additionalSpells}
            onChange={(v) => set('additionalSpells', v)}
          />
          <CheckField
            label="Requires attunement"
            wide
            checked={extra.reqAttune === true}
            onChange={(v) => set('reqAttune', v)}
          />
        </div>
      )}

      {type === 'feat' && (
        <div className="grid grid-cols-2 items-end gap-2">
          <Field label="Ability bonus">
            <select
              value={
                Array.isArray(extra.ability) && extra.ability[0] !== undefined
                  ? Object.keys(extra.ability[0] as Json)[0]
                  : 'none'
              }
              onChange={(e) =>
                set('ability', e.target.value === 'none' ? undefined : [{ [e.target.value]: 1 }])
              }
              className={inputCls}
            >
              <option value="none">none</option>
              {['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()} +1
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <input
              value={String(extra.category ?? '')}
              onChange={(e) => set('category', e.target.value || undefined)}
              placeholder="2024: G/O/FS/EB"
              className={inputCls}
            />
          </Field>
        </div>
      )}

      {type === 'spell' && (
        <div className="grid grid-cols-2 items-end gap-2">
          <Field label="Level">
            <input
              inputMode="numeric"
              placeholder="0 = cantrip"
              value={String(extra.level ?? 0)}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                set('level', Number.isNaN(n) ? 0 : Math.max(0, Math.min(9, n)));
              }}
              className={inputCls}
            />
          </Field>
          <Field label="School">
            <select
              value={String(extra.school ?? 'V')}
              onChange={(e) => set('school', e.target.value)}
              className={inputCls}
            >
              {Object.entries(SCHOOLS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Range">
            <input
              inputMode="numeric"
              placeholder="feet, 0 = self/touch"
              value={String(
                (extra.range as { distance?: { amount?: number } } | undefined)?.distance?.amount ??
                  '',
              )}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                set(
                  'range',
                  Number.isNaN(n) || n <= 0
                    ? { type: 'point', distance: { type: 'touch' } }
                    : { type: 'point', distance: { type: 'feet', amount: n } },
                );
              }}
              className={inputCls}
            />
          </Field>
          <CheckField
            label="Concentration"
            checked={
              Array.isArray(extra.duration) &&
              (extra.duration[0] as { concentration?: boolean } | undefined)?.concentration === true
            }
            onChange={(v) =>
              set(
                'duration',
                v
                  ? [
                      {
                        type: 'timed',
                        duration: { type: 'minute', amount: 10 },
                        concentration: true,
                      },
                    ]
                  : [{ type: 'instant' }],
              )
            }
          />
          <div className="col-span-2">
            <Field label="Class lists (who can learn it)">
              <div className="flex flex-wrap gap-1.5">
                {CASTER_CLASSES.map((c) => {
                  const active = spellClasses.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? spellClasses.filter((x) => x !== c)
                          : [...spellClasses, c];
                        set(
                          'classes',
                          next.length === 0
                            ? undefined
                            : { fromClassList: next.map((n) => ({ name: n, source: 'PHB' })) },
                        );
                      }}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        active
                          ? 'border-purple-300 text-purple-300'
                          : 'border-surface-2 text-ink-muted'
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      )}

      <Field label="Description">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={
            "Blank line = new paragraph\nLines starting '- ' = list\n{@dice 1d6} and other tags work"
          }
          className={inputCls}
        />
      </Field>

      {/* Live preview through the real renderer */}
      <div className="rounded-lg bg-surface-2/50 p-3">
        <div className="mb-1 text-xs font-semibold uppercase text-ink-muted">Preview</div>
        <div className="text-sm font-bold">{name || '…'}</div>
        <div className="text-sm">
          <EntriesView entries={textToEntries(text)} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={name.trim() === '' || busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg bg-surface-2 px-4 py-2 text-sm disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * What a record is called, or `undefined` when it has no usable name.
 *
 * The file is data the app did not write: an entity can be missing, a string,
 * a list, or an object whose `name` is a number. `String(e.name)` turned every
 * one of those into a plausible-looking label ("undefined", "[object Object]")
 * that then acted as identity for saves and deletes. A record without a name
 * is identified by its position instead, and says so on screen.
 */
function entityName(e: unknown): string | undefined {
  return isRecord(e) && typeof e.name === 'string' ? e.name : undefined;
}

/** What the slot holds, for a value the builder cannot show as an entry. */
function describeValue(v: unknown): string {
  if (v === null || v === undefined) return 'the entry is empty';
  if (Array.isArray(v)) return 'it holds a list, not an entry';
  return `it holds a ${typeof v}, not an entry`;
}

/**
 * How a row or an open form says which record it is about.
 *
 * A name survives the file moving underneath; a position does not, and a
 * record with no name has nothing else. So a nameless record carries the value
 * the row was showing as well, and that is what the position is checked
 * against.
 */
interface EntityRef {
  /** Where the record was when the row rendered or the form opened. */
  index?: number;
  /** What it was called, when the file gives it a usable name. */
  name?: string;
  /** What the slot held. Read only when there is no name to match on. */
  value: unknown;
}

/**
 * Structural equality for two values that came out of the same JSON file.
 * `JSON.stringify` is enough here because that is what these are: data read
 * from IndexedDB and copied with `structuredClone`, both of which keep key
 * order, and neither of which can produce a cycle.
 */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Where a record lives now. The row list is a live query, so a position
 * captured when a form or a row was opened can point at a different record by
 * the time the write happens: the position is right in the ordinary case and
 * is checked first, the name is what settles it when the file changed
 * underneath us.
 *
 * With no name, content is the identity and the rule is otherwise the same: a
 * position that still holds *some* nameless record is not the same as one that
 * still holds *this* record. Two unreadable entries side by side, an entry
 * removed ahead of them, and a delete aimed at the first would take the
 * second. So the slot has to hold what the row was showing, and if it does not
 * the record is looked for where it moved to. Records with identical content
 * are indistinguishable, so matching either of them is the same write.
 */
function entityIndex(arr: unknown[], ref: EntityRef): number {
  if (ref.name === undefined) {
    const matches = (e: unknown) => entityName(e) === undefined && sameJson(e, ref.value);
    if (ref.index !== undefined && ref.index < arr.length && matches(arr[ref.index])) {
      return ref.index;
    }
    return arr.findIndex(matches);
  }
  if (ref.index !== undefined && entityName(arr[ref.index]) === ref.name) return ref.index;
  return arr.findIndex((e) => entityName(e) === ref.name);
}

/** What a record is called in a message about it. */
function refLabel(ref: EntityRef): string {
  if (ref.name !== undefined) return ref.name;
  return isRecord(ref.value) ? 'that unnamed entry' : 'that unreadable entry';
}

export function Component() {
  const { fileId } = useParams();
  const row = useLiveQuery(
    async () => (fileId !== undefined ? db.homebrewFiles.get(fileId) : undefined),
    [fileId],
  );
  /** `ref` is how the form finds its subject again; null means a new entity. */
  const [editing, setEditing] = useState<{ type: BuildType; ref: EntityRef | null } | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The last write that was refused. `retryDelete` is a description of the
   * work, not a closure over it: a stored closure would keep writing the
   * document as it looked when the write failed, so a Retry pressed after the
   * page moved on would quietly undo whatever happened in between.
   */
  const [failure, setFailure] = useState<{
    text: string;
    hint: string;
    retryDelete?: { type: BuildType; ref: EntityRef };
  }>();

  if (row === undefined) return <main className="p-4 text-sm text-ink-muted">Loading…</main>;
  if (!row.editable) {
    return (
      <main className="p-4 text-sm text-ink-muted">
        This file was imported, not built here. Only in-app creations are editable.
      </main>
    );
  }

  const json = row.json as Json;
  const sourceId = row.sourceIds[0] ?? 'HB';
  const retryDelete = failure?.retryDelete;

  /**
   * Opening or closing the form retires the last failure with it: "your edits
   * are still here" stops being true the moment the form holding them goes.
   */
  const openEditor = (next: { type: BuildType; ref: EntityRef | null } | null) => {
    setFailure(undefined);
    setEditing(next);
  };

  /**
   * Every edit goes through one write, and the write is awaited.
   *
   * Both editors used to fire the save and move on: the form closed, the row
   * disappeared, and a rejected write took the edit with it in silence. What
   * makes that worse than a lost keystroke is that the screen still showed the
   * change, so the only way to find out was to come back later and find the
   * entity as it was. Now a failure keeps the work on screen, says what went
   * wrong, and offers the same write again.
   */
  const write = async (
    next: Json,
    opts: {
      done: string;
      failed: string;
      hint: string;
      retryDelete?: { type: BuildType; ref: EntityRef };
      after?: () => void;
    },
  ) => {
    setBusy(true);
    setFailure(undefined);
    try {
      await homebrewRepo.saveEditable(row.id, next);
      invalidateRegistry();
      notify({ title: opts.done, tone: 'good' });
      opts.after?.();
    } catch (err) {
      setFailure({
        text: `${opts.failed}: ${errorText(err)}`,
        hint: opts.hint,
        retryDelete: opts.retryDelete,
      });
    } finally {
      setBusy(false);
    }
  };

  const saveEntity = async (type: BuildType, ref: EntityRef | null, entity: Json) => {
    const next = structuredClone(json);
    const arr = Array.isArray(next[type]) ? (next[type] as unknown[]) : [];
    // Same identity rule as delete, for the same reason: the position the form
    // was opened at can point at a different entity by the time it is saved,
    // and overwriting an innocent entry is worse than adding one. An edit whose
    // subject has since been removed is kept rather than dropped: the edit in
    // front of the user is the thing that must not be lost.
    const at = ref === null ? -1 : entityIndex(arr, ref);
    if (at === -1) arr.push(entity);
    else arr[at] = entity;
    next[type] = arr;
    await write(next, {
      done: `Saved ${String(entity.name)}`,
      failed: `Could not save ${String(entity.name)}`,
      // No Retry button for a save: the form is still open with the fields in
      // it, so Save is the retry, and it writes what is on screen now rather
      // than what was on screen when the write was refused.
      hint: 'Nothing was changed on this device. Your edits are still here: press Save to try again.',
      // Only on success: a failed save keeps the form, and the edits in it.
      after: () => setEditing(null),
    });
  };

  const deleteEntity = async (type: BuildType, ref: EntityRef) => {
    const next = structuredClone(json);
    const arr = Array.isArray(next[type]) ? (next[type] as unknown[]) : [];
    const at = entityIndex(arr, ref);
    const label = refLabel(ref);
    if (at === -1) {
      // Either it is gone, or the file moved and a nameless record can no
      // longer be told apart from its neighbours. Both end here: doing nothing
      // is the only answer that cannot destroy the wrong record. The failure
      // that offered this retry is over either way.
      setFailure(undefined);
      notify({
        title:
          ref.name === undefined ? 'That entry can no longer be found' : `${label} is already gone`,
        tone: 'info',
      });
      return;
    }
    arr.splice(at, 1);
    next[type] = arr;
    await write(next, {
      done: `Deleted ${label}`,
      failed: `Could not delete ${label}`,
      hint: 'Nothing was changed on this device.',
      retryDelete: { type, ref },
    });
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <Link to="/homebrew" className="text-ink-muted hover:text-ink">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold">
            {String(
              (json._meta as { sources?: Array<{ full?: string }> } | undefined)?.sources?.[0]
                ?.full ?? row.fileName.replace(/\.json$/, ''),
            )}
          </h1>
          <p className="text-xs text-ink-muted">
            source: {sourceId}. Everything you build is instantly usable on characters, and exports
            as a standard 5etools file.
          </p>
        </div>
      </header>

      {failure !== undefined && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-deep px-3 py-2"
          role="alert"
        >
          <p className="min-w-0 flex-1 text-xs">
            {failure.text}
            <span className="block text-ink-muted">{failure.hint}</span>
          </p>
          {retryDelete !== undefined && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteEntity(retryDelete.type, retryDelete.ref)}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </div>
      )}

      {BUILDABLE.map(([type, label]) => {
        // Whatever the file holds, not whatever the type says it holds: these
        // entries come back from IndexedDB and were only ever checked for
        // `_meta`, so a slot can hold null, a string, or a list.
        const entities: unknown[] = Array.isArray(json[type]) ? (json[type] as unknown[]) : [];
        const lower = label.toLowerCase();
        // The form seeds from the record the row was showing, not from whatever
        // now sits at that position: the file is a live query and can move
        // while the form is open.
        const editingRef = editing?.type === type ? editing.ref : null;
        const editingInitial =
          editingRef !== null && isRecord(editingRef.value) ? editingRef.value : undefined;
        return (
          <section key={type} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {label}s{' '}
                <span className="text-xs font-normal text-ink-muted">{entities.length}</span>
              </h2>
              <button
                type="button"
                onClick={() => openEditor({ type, ref: null })}
                className="flex items-center gap-1 rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold"
              >
                <Plus size={14} /> New {lower}
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {entities.map((e, i) => {
                const name = entityName(e);
                const ref: EntityRef = { index: i, name, value: e };
                const remove = (
                  <button
                    type="button"
                    title="Delete"
                    disabled={busy}
                    onClick={() => void deleteEntity(type, ref)}
                    className="shrink-0 text-ink-muted hover:text-accent disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                );
                const key = `${name ?? 'unnamed'}-${String(i)}`;
                // A slot that isn't an object has nothing to open, name, or
                // link to. It is still in the user's file, so it gets a row
                // that says so and offers the one action that helps.
                if (!isRecord(e)) {
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 rounded-lg border border-amber-300/40 bg-surface px-3 py-2"
                    >
                      <p className="min-w-0 flex-1 text-xs text-ink-muted">
                        This {lower} could not be read ({describeValue(e)}). Deleting it leaves the
                        rest of the file alone.
                      </p>
                      {remove}
                    </div>
                  );
                }
                return (
                  // One bad record fails in its own row rather than taking the
                  // file's other entities, and the delete, down with it.
                  <DecodeBoundary
                    key={key}
                    // The keys here are positional, so a record removed ahead
                    // of this one hands its boundary to a different record.
                    resetKey={entities.length}
                    label={`This ${lower}`}
                    action={remove}
                  >
                    <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
                      <button
                        type="button"
                        onClick={() => openEditor({ type, ref })}
                        className="min-w-0 flex-1 truncate text-left hover:text-purple-300"
                      >
                        {name ?? `Unnamed ${lower}`}
                      </button>
                      {name !== undefined && (
                        <Link
                          to={`/library/${type}/${encodeURIComponent(`${name}|${sourceId}`.toLowerCase())}`}
                          className="shrink-0 text-xs text-ink-muted hover:text-ink"
                        >
                          view
                        </Link>
                      )}
                      {remove}
                    </div>
                  </DecodeBoundary>
                );
              })}
            </div>
            {editing?.type === type && (
              // The form reads far more of a record than the row does: a field
              // that chokes on what it finds closes the form, not the page.
              <DecodeBoundary
                // Keyed with the record: a form that failed for one entry must
                // not keep the next one from opening.
                key={`form:${type}:${editing.ref?.index ?? 'new'}`}
                resetKey={entities.length}
                label="This entry's form"
                action={
                  <button
                    type="button"
                    onClick={() => openEditor(null)}
                    className="shrink-0 rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold"
                  >
                    Close
                  </button>
                }
              >
                <EntityForm
                  // Every field seeds its state from `initial` once. Without a key
                  // tying the instance to the entity, editing a second item of the
                  // same type reuses the form and shows the first one's values.
                  key={`${type}:${editing.ref?.index ?? 'new'}`}
                  type={type}
                  source={sourceId}
                  initial={editingInitial}
                  onSave={(entity) => saveEntity(type, editing.ref, entity)}
                  onCancel={() => openEditor(null)}
                  busy={busy}
                />
              </DecodeBoundary>
            )}
          </section>
        );
      })}

      <p className="text-xs text-ink-muted">
        Races, backgrounds, subclasses, and classes: import them as JSON for now. Form editors for
        those are on the roadmap.
      </p>
    </main>
  );
}
