import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { invalidateRegistry } from '@/data5e/registry';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { SCHOOLS } from '@/features/library/fmt';
import { entriesToText, textToEntries } from '@/lib/entriesText';

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
const DMG_TYPES = ['B', 'P', 'S', 'A', 'C', 'F', 'O', 'L', 'N', 'I', 'Y', 'R', 'T'];
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
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-muted';

/** One form for create-or-edit of a single entity. */
function EntityForm({
  type,
  source,
  initial,
  onSave,
  onCancel,
}: {
  type: BuildType;
  source: string;
  initial?: Json;
  onSave: (entity: Json) => void;
  onCancel: () => void;
}) {
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

  const set = (key: string, value: unknown) =>
    setExtra((x) => {
      const next = { ...x };
      if (value === undefined || value === '' || value === false) delete next[key];
      else next[key] = value;
      return next;
    });

  const spellClasses = Array.isArray(
    (extra.classes as { fromClassList?: unknown[] } | undefined)?.fromClassList,
  )
    ? ((extra.classes as { fromClassList: Array<{ name: string }> }).fromClassList.map(
        (c) => c.name,
      ) ?? [])
    : [];

  const save = () => {
    if (name.trim() === '') return;
    onSave({ name: name.trim(), source, ...extra, entries: textToEntries(text) });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-purple-300/30 bg-surface p-3">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>

      {type === 'item' && (
        <div className="grid grid-cols-2 gap-2">
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
          {(extra.type === 'M' || extra.type === 'R') && (
            <>
              <Field label="Damage (e.g. 1d8)">
                <input
                  value={String(extra.dmg1 ?? '')}
                  onChange={(e) => set('dmg1', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Damage type">
                <select
                  value={String(extra.dmgType ?? 'S')}
                  onChange={(e) => set('dmgType', e.target.value)}
                  className={inputCls}
                >
                  {DMG_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Attack/damage bonus (e.g. +1)">
                <input
                  value={String(extra.bonusWeapon ?? '')}
                  onChange={(e) => set('bonusWeapon', e.target.value)}
                  placeholder="+1"
                  className={inputCls}
                />
              </Field>
            </>
          )}
          {(extra.type === 'LA' ||
            extra.type === 'MA' ||
            extra.type === 'HA' ||
            extra.type === 'S') && (
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
          {extra.type !== 'LA' &&
            extra.type !== 'MA' &&
            extra.type !== 'HA' &&
            extra.type !== 'S' && (
              <Field label="AC bonus (rings etc., e.g. +1)">
                <input
                  value={String(extra.bonusAc ?? '')}
                  onChange={(e) => set('bonusAc', e.target.value)}
                  placeholder="+1"
                  className={inputCls}
                />
              </Field>
            )}
          <Field label="Requires attunement">
            <input
              type="checkbox"
              checked={extra.reqAttune === true}
              onChange={(e) => set('reqAttune', e.target.checked)}
              className="h-5 w-5"
            />
          </Field>
        </div>
      )}

      {type === 'feat' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ability bonus (optional)">
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
          <Field label="Category (2024: G/O/FS/EB)">
            <input
              value={String(extra.category ?? '')}
              onChange={(e) => set('category', e.target.value || undefined)}
              placeholder="G"
              className={inputCls}
            />
          </Field>
        </div>
      )}

      {type === 'spell' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Level (0 = cantrip)">
            <input
              inputMode="numeric"
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
          <Field label="Range (feet, 0 = self/touch)">
            <input
              inputMode="numeric"
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
          <Field label="Concentration">
            <input
              type="checkbox"
              checked={
                Array.isArray(extra.duration) &&
                (extra.duration[0] as { concentration?: boolean } | undefined)?.concentration ===
                  true
              }
              onChange={(e) =>
                set(
                  'duration',
                  e.target.checked
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
              className="h-5 w-5"
            />
          </Field>
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

      <Field label="Description (blank line = new paragraph, lines with '- ' = list, {@dice 1d6} etc. work)">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
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
          onClick={save}
          disabled={name.trim() === ''}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-surface-2 px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Component() {
  const { fileId } = useParams();
  const row = useLiveQuery(
    async () => (fileId !== undefined ? db.homebrewFiles.get(fileId) : undefined),
    [fileId],
  );
  const [editing, setEditing] = useState<{ type: BuildType; index: number | null } | null>(null);

  if (row === undefined) return <main className="p-4 text-sm text-ink-muted">Loading…</main>;
  if (!row.editable) {
    return (
      <main className="p-4 text-sm text-ink-muted">
        This file was imported, not built here — only in-app creations are editable.
      </main>
    );
  }

  const json = row.json as Json;
  const sourceId = row.sourceIds[0] ?? 'HB';

  const saveEntity = (type: BuildType, index: number | null, entity: Json) => {
    const next = structuredClone(json);
    const arr = Array.isArray(next[type]) ? (next[type] as Json[]) : [];
    if (index === null) arr.push(entity);
    else arr[index] = entity;
    next[type] = arr;
    void homebrewRepo.saveEditable(row.id, next).then(() => invalidateRegistry());
    setEditing(null);
  };

  const deleteEntity = (type: BuildType, index: number) => {
    const next = structuredClone(json);
    const arr = Array.isArray(next[type]) ? (next[type] as Json[]) : [];
    arr.splice(index, 1);
    next[type] = arr;
    void homebrewRepo.saveEditable(row.id, next).then(() => invalidateRegistry());
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
            source: {sourceId} — everything you build is instantly usable on characters and exports
            as a standard 5etools file
          </p>
        </div>
      </header>

      {BUILDABLE.map(([type, label]) => {
        const entities = Array.isArray(json[type]) ? (json[type] as Json[]) : [];
        return (
          <section key={type} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {label}s{' '}
                <span className="text-xs font-normal text-ink-muted">{entities.length}</span>
              </h2>
              <button
                type="button"
                onClick={() => setEditing({ type, index: null })}
                className="flex items-center gap-1 rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold"
              >
                <Plus size={14} /> New {label.toLowerCase()}
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {entities.map((e, i) => (
                <div
                  key={`${String(e.name)}-${String(i)}`}
                  className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => setEditing({ type, index: i })}
                    className="min-w-0 flex-1 truncate text-left hover:text-purple-300"
                  >
                    {String(e.name)}
                  </button>
                  <Link
                    to={`/library/${type}/${encodeURIComponent(`${String(e.name)}|${sourceId}`.toLowerCase())}`}
                    className="shrink-0 text-xs text-ink-muted hover:text-ink"
                  >
                    view
                  </Link>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => deleteEntity(type, i)}
                    className="shrink-0 text-ink-muted hover:text-accent"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            {editing?.type === type && (
              <EntityForm
                type={type}
                source={sourceId}
                initial={editing.index !== null ? (entities[editing.index] as Json) : undefined}
                onSave={(entity) => saveEntity(type, editing.index, entity)}
                onCancel={() => setEditing(null)}
              />
            )}
          </section>
        );
      })}

      <p className="text-xs text-ink-muted">
        Races, backgrounds, subclasses, and classes: import them as JSON for now — form editors for
        those are on the roadmap.
      </p>
    </main>
  );
}
