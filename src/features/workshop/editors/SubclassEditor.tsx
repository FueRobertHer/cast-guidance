/**
 * Subclasses (the Subclass board's A, ADR-001 D1 and D3): a copy shows the
 * whole subclass by level, each feature Kept, Changed, Removed or New, with
 * Keep, Change and Remove, its editor in place, and features added at a level.
 *
 * A subclass's features are entries of their own (`subclassFeature`), found
 * through the refs its `subclassFeatures` lists and the refs a feature's text
 * holds to the ones under it (Oath of Devotion's level 3 feature holds Sacred
 * Weapon). The draft keeps the subclass and, under `_features`, only what the
 * player did to them; Save writes the subclass and each feature it touches as
 * changes only:
 *
 * - a kept feature is not written: its ref stays, so the sheet finds the
 *   original, curated rows and spend links included (the subclass's
 *   `castGuidance.basedOn` names the subclass they are keyed under);
 * - a changed one is the player's own entry, `_copy` of the original with its
 *   changes and a `basedOn` of its own;
 * - a feature whose text holds one that was changed or removed is written too,
 *   with those refs taken out (`removeArr`), and what it held is listed on the
 *   subclass itself, so nothing is matched by position;
 * - a new one is a whole entry, listed after the last feature of its level.
 *
 * The copy keeps its original's short name, which a third caster's spell list
 * is found by, unless another subclass of the player's for that class has it.
 */
import { Info, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EntityRegistry } from '@/data5e/normalize';
import { isRecord, own } from '@/engine/castGuidance';
import { Button } from '@/ui/Button';
import { askConfirm } from '@/ui/dialogs';
import { listClass } from '@/ui/surfaces';
import { changeCount, copiedFrom, readStored, writeEntry } from '../copyWriter';
import type { EditorProps, EditorSpec, Json, WriteContext, Written } from '../editorTypes';
import { FeatureRow, type FeatureStatus } from '../FeatureRow';
import { Field, Section, Select } from '../fields';

const KEY = '_features';
const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
const REF = 'refSubclassFeature';
const FEATURE = 'subclassFeature';

/** What the player did to a subclass's features, kept in its draft. */
export interface FeatureEdits {
  /** Original features changed, by ref: each as it now stands, refs to those under it taken out. */
  changed: Record<string, Json>;
  /** Original features taken out, by ref. */
  removed: string[];
  /** Features the player added, each with its `level`, in order. */
  added: Json[];
}

/** One of the original's features, where it sits. */
export interface FeatureNode {
  ref: string;
  /** The ref of the feature whose text holds this one. */
  parent?: string;
  level: number;
  /** As the data holds it; undefined when the data does not have it. */
  entity?: Json;
  /** The entity with the refs to the features under it taken out. */
  base: Json;
  kids: string[];
}

const lower = (v: unknown) => String(v ?? '').toLowerCase();
const eq = (a: unknown, b: unknown) => lower(a) === lower(b);

/** "Name|Class|ClassSource|Short|ShortSource|Level": an empty book is PHB. */
export function parseRef(raw: string) {
  const [name = '', className = '', , shortName = '', shortSource, level] = raw.split('|');
  return {
    name,
    className,
    shortName,
    shortSource: shortSource || 'PHB',
    level: Number.parseInt(level ?? '', 10) || 1,
  };
}

/** Whether a feature is the one a ref names, as the sheet tells. */
function isAt(f: Json, raw: string): boolean {
  const r = parseRef(raw);
  return (
    eq(f.name, r.name) &&
    eq(f.className, r.className) &&
    eq(f.subclassShortName, r.shortName) &&
    eq(f.subclassSource, r.shortSource) &&
    Number(f.level) === r.level
  );
}

/** The feature a ref names, found as the sheet finds it. */
function findFeature(registry: EntityRegistry, raw: string): Json | undefined {
  return registry.byType(FEATURE).find((f) => isAt(f as Json, raw)) as Json | undefined;
}

/** The refs a feature's text holds to features under it, at its top level only. */
function kidRefs(f: Json): string[] {
  // The Armorer's models are a pick, not features under it (`PICK_ONE` on the sheet).
  if (eq(f.name, 'armor model') && eq(f.subclassShortName, 'armorer')) return [];
  const list = Array.isArray(f.entries) ? f.entries : [];
  return list.flatMap((b) =>
    isRecord(b) && b.type === REF && typeof b.subclassFeature === 'string'
      ? [b.subclassFeature]
      : [],
  );
}

const refsOf = (sub: Json | undefined): string[] =>
  Array.isArray(sub?.subclassFeatures)
    ? sub.subclassFeatures.filter((r): r is string => typeof r === 'string')
    : [];

/**
 * A subclass's features in the order the sheet collects them: each listed
 * one, then those its text holds. A ref the list itself names is the list's
 * (as on the sheet), so it is never also counted under another.
 */
export function featureTree(sub: Json, registry: EntityRegistry): FeatureNode[] {
  const nodes: FeatureNode[] = [];
  const listed = refsOf(sub);
  const seen = new Set(listed.map(lower));
  const visit = (ref: string, parent?: string) => {
    const entity = findFeature(registry, ref);
    const kids = entity === undefined ? [] : kidRefs(entity).filter((k) => !seen.has(lower(k)));
    for (const k of kids) seen.add(lower(k));
    const kidSet = new Set(kids);
    const base =
      entity === undefined || kids.length === 0
        ? (entity ?? {})
        : {
            ...entity,
            entries: (entity.entries as unknown[]).filter(
              (b) => !(isRecord(b) && b.type === REF && kidSet.has(String(b.subclassFeature))),
            ),
          };
    nodes.push({ ref, parent, level: parseRef(ref).level, entity, base, kids });
    for (const k of kids) visit(k, ref);
  };
  for (const ref of listed) visit(ref);
  return nodes;
}

export function editsOf(draft: Json): FeatureEdits {
  const e = isRecord(draft[KEY]) ? (draft[KEY] as Partial<FeatureEdits>) : {};
  return {
    changed: isRecord(e.changed) ? (e.changed as Record<string, Json>) : {},
    removed: Array.isArray(e.removed) ? e.removed : [],
    added: Array.isArray(e.added) ? e.added : [],
  };
}

/** A changed feature as it stands, when it differs from the original's. */
function changedOf(edits: FeatureEdits, n: FeatureNode): Json | undefined {
  const now = edits.changed[n.ref];
  return now !== undefined && changeCount(n.base, now) > 0 ? now : undefined;
}

function statusOf(edits: FeatureEdits, n: FeatureNode): FeatureStatus {
  if (edits.removed.includes(n.ref)) return 'removed';
  return changedOf(edits, n) !== undefined ? 'changed' : 'kept';
}

/** The keys that place a feature in a subclass, which the writer sets. */
const PLACE = ['source', 'className', 'classSource', 'subclassShortName', 'subclassSource'];

/** `castGuidance` without the pointer the writer works out again. */
function ownGuidance(f: Json): Json {
  const g = own(f, 'castGuidance');
  if (!isRecord(g)) return f;
  const { basedOn: _, basedOnFingerprint: __, ...rest } = g;
  const { castGuidance: ___, ...out } = f;
  return Object.keys(rest).some((k) => k !== 'v') ? { ...out, castGuidance: rest } : out;
}

/**
 * The draft a subclass opens on: `_features` worked out by walking what the
 * entry lists against the original's features. One of the player's features
 * that names an original one (`basedOn`) is that one changed; one that names
 * none is new; an original one nowhere in the entry was removed.
 */
export function openSubclass(
  entry: Json,
  { original, registry, file }: { original?: Json; registry: EntityRegistry; file?: Json },
): Json {
  if (isRecord(entry[KEY])) return entry;
  // A copy whose original is not loaded is shown as it is stored.
  if (original === undefined && isRecord(own(entry, '_copy'))) return entry;
  const nodes = original === undefined ? [] : featureTree(original, registry);
  // The player's features, from the file the subclass is kept in: the
  // registry leaves out a file the player turned off. One saved as changes is
  // read onto the original it names, as the registry would.
  const stored = Array.isArray(file?.[FEATURE])
    ? (file[FEATURE] as unknown[]).filter(isRecord)
    : [];
  const featureOf = (ref: string): Json | undefined => {
    const raw = stored.find((f) => isAt(f, ref));
    const copy = raw === undefined ? undefined : own(raw, '_copy');
    if (raw === undefined || !isRecord(copy)) return raw ?? findFeature(registry, ref);
    const target = nodes.find(
      (n) =>
        eq(n.entity?.name, copy.name) &&
        eq(n.entity?.source, copy.source) &&
        n.level === Number(copy.level ?? raw.level),
    )?.entity;
    return target === undefined ? findFeature(registry, ref) : readStored(raw, target).entry;
  };
  const edits: FeatureEdits = { changed: {}, removed: [], added: [] };
  const present = new Set<string>();
  const keep = (n: FeatureNode) => {
    present.add(n.ref);
    for (const k of nodes) if (k.parent === n.ref) keep(k);
  };
  const seen = new Set<string>();
  const visit = (ref: string) => {
    if (seen.has(lower(ref))) return;
    seen.add(lower(ref));
    const node = nodes.find((n) => eq(n.ref, ref));
    if (node !== undefined) return keep(node);
    const f = featureOf(ref);
    if (f === undefined) return;
    const g = own(f, 'castGuidance');
    const [name, source] = String(isRecord(g) ? own(g, 'basedOn') : '').split('|');
    // Save keeps a changed feature at its original's level, and some subclasses
    // repeat a name at several (Battle Master's Additional Maneuvers).
    const from = nodes.find(
      (n) =>
        !present.has(n.ref) &&
        eq(n.entity?.name, name) &&
        eq(n.entity?.source, source) &&
        n.level === Number(f.level),
    );
    // A changed one's pointer is worked out again at Save; a new one keeps any
    // it has (a full copy reopened without its original).
    const now = from?.entity !== undefined ? ownGuidance(structuredClone(f)) : structuredClone(f);
    for (const k of PLACE) delete now[k];
    if (from?.entity !== undefined) {
      present.add(from.ref);
      for (const k of PLACE) if (from.entity[k] !== undefined) now[k] = from.entity[k];
      if (changeCount(from.base, now) > 0) edits.changed[from.ref] = now;
    } else edits.added.push(now);
    for (const k of kidRefs(f)) visit(k);
  };
  for (const ref of refsOf(entry)) visit(ref);
  edits.removed = nodes
    .filter((n) => n.entity !== undefined && !present.has(n.ref))
    .map((n) => n.ref);
  return { ...entry, [KEY]: edits };
}

/**
 * The short name a copy saves under: its own, unless another subclass of the
 * player's for the same class has it (their features would mix), then its name.
 */
function shortNameFor(at: WriteContext): string {
  const { draft, registry, source, stored, storedAs = [] } = at;
  const want = String(draft.shortName ?? draft.name ?? '').trim();
  // This one, under any name it had since the registry was built.
  const mine = [...storedAs, ...(stored !== undefined ? [stored] : [])];
  const taken = registry
    .byType('subclass')
    .some(
      (s) =>
        eq(s.source, source) &&
        eq(s.className, draft.className) &&
        eq(s.shortName, want) &&
        !mine.some((m) => eq(s.name, m.name) && eq(s.source, m.source)),
    );
  return taken ? String(draft.name).trim() : want;
}

/** What Save stores: the subclass, and every feature of its own (see the top of this file). */
export function writeSubclass(at: WriteContext): Written {
  const { draft, source, mode, registry, copied } = at;
  const nodes = copied === undefined ? [] : featureTree(copied, registry);
  const edits = editsOf(draft);
  const short = shortNameFor(at);
  const className = String(draft.className ?? '');
  const classSource = String(draft.classSource ?? '');
  const place = (level: unknown): Json => ({
    className,
    classSource,
    subclassShortName: short,
    subclassSource: source,
    level,
  });
  const owned: Json[] = [];
  const items: Array<{ ref: string; level: number }> = [];
  const ownRef = (f: Json) => {
    owned.push(f);
    return `${String(f.name)}|${className}|${classSource}|${short}|${source}|${String(f.level)}`;
  };

  const byRef = new Map(nodes.map((n) => [n.ref, n]));
  const touched = new Map<string, boolean>();
  const isTouched = (n: FeatureNode): boolean => {
    const known = touched.get(n.ref);
    if (known !== undefined) return known;
    const t =
      mode === 'full' ||
      statusOf(edits, n) !== 'kept' ||
      n.kids.some((k) => {
        const kid = byRef.get(k);
        return kid !== undefined && isTouched(kid);
      });
    touched.set(n.ref, t);
    return t;
  };

  for (const n of nodes) {
    const parent = n.parent === undefined ? undefined : byRef.get(n.parent);
    const listed = parent === undefined || isTouched(parent);
    if (!listed || edits.removed.includes(n.ref)) continue;
    if (n.entity === undefined || !isTouched(n)) {
      items.push({ ref: n.ref, level: n.level });
      continue;
    }
    const e = n.entity;
    const now = changedOf(edits, n) ?? n.base;
    // A copy is found by name and book alone; where two features share them,
    // it could find the other, so this one is written out whole. So is one the
    // data holds as a copy of another (the book's features are never resolved):
    // a copy of it would wait on that forever and lose its changes.
    const alone = registry.get(FEATURE, String(e.name), String(e.source)) === e;
    const f = writeEntry({
      original: e,
      draft: { ...now, ...place(n.level) },
      source,
      mode: mode === 'full' || !alone || isRecord(e._copy) ? 'full' : 'changes',
    });
    Object.assign(f, place(n.level));
    if (isRecord(f._copy)) {
      // Where the original sits, as other tools find a feature to copy.
      const { _mod, ...copy } = f._copy;
      const at = Object.fromEntries([...PLACE.slice(1), 'level'].map((k) => [k, e[k]]));
      f._copy = { ...copy, ...at, ...(_mod !== undefined ? { _mod } : {}) };
    }
    items.push({ ref: ownRef(f), level: n.level });
  }

  // A new feature goes after the last of its level.
  for (const a of edits.added) {
    const level = Number(a.level) || 1;
    const f = writeEntry({ draft: { ...a, ...place(level) }, source, mode: 'changes' });
    Object.assign(f, place(level));
    const after = items.findLastIndex((i) => i.level <= level);
    items.splice(after + 1, 0, { ref: ownRef(f), level });
  }

  const { [KEY]: _, ...rest } = draft;
  const entry = writeEntry({
    original: at.original,
    draft: { ...rest, shortName: short, subclassFeatures: items.map((i) => i.ref) },
    source,
    mode,
  }) as Written['entry'];
  Object.assign(entry, { className, classSource, shortName: short });
  if (isRecord(entry._copy) && copied !== undefined) {
    const { _mod, ...copy } = entry._copy;
    entry._copy = {
      ...copy,
      shortName: copied.shortName,
      className: copied.className,
      classSource: copied.classSource,
      ...(_mod !== undefined ? { _mod } : {}),
    };
  }
  return { entry, owned };
}

/** The Save bar's line: what happened to the features, the way the board counts them. */
export function summarize(draft: Json, original: Json, registry: EntityRegistry): string {
  const edits = editsOf(draft);
  const count: Record<FeatureStatus, number> = {
    kept: 0,
    changed: 0,
    removed: 0,
    new: edits.added.length,
    waiting: 0,
  };
  for (const n of featureTree(original, registry)) {
    if (n.entity !== undefined) count[statusOf(edits, n)] += 1;
  }
  // The list and the short name are the features' doing, counted above.
  const { [KEY]: _, ...rest } = draft;
  const own = {
    ...rest,
    subclassFeatures: original.subclassFeatures,
    shortName: original.shortName,
  };
  const of = String(original.name);
  if (count.changed + count.new + count.removed === 0 && changeCount(original, own) === 0) {
    return `No changes from ${of} yet. You can save it as it is.`;
  }
  const parts = (['changed', 'new', 'removed', 'kept'] as const)
    .filter((k) => count[k] > 0 || k === 'kept')
    .map((k) => `${count[k]} ${k}`);
  return `${parts.join(', ')}. Saved as changes from ${of}.`;
}

/** Why it cannot be saved: a feature without a name, or two the sheet could not tell apart. */
function check(draft: Json): string | undefined {
  if (!draft.className) return 'Pick the class it belongs to.';
  const edits = editsOf(draft);
  const mine: Json[] = [
    ...Object.entries(edits.changed)
      .filter(([ref]) => !edits.removed.includes(ref))
      .map(([ref, f]) => ({ ...f, level: f.level ?? parseRef(ref).level })),
    ...edits.added,
  ];
  const names = new Set<string>();
  for (const f of mine) {
    const name = String(f.name ?? '').trim();
    if (name === '') return 'Every feature needs a name.';
    if (name.includes('|')) return 'A feature name cannot have | in it.';
    const key = `${lower(name)}|${String(f.level)}`;
    if (names.has(key)) return `Two features at level ${String(f.level)} are called ${name}.`;
    names.add(key);
  }
  return undefined;
}

/** A copy whose original is not loaded: what it lists, the original's waiting. */
function Waiting({ draft, registry }: Pick<EditorProps, 'draft' | 'registry'>) {
  const of = copiedFrom(draft)?.name ?? 'the original';
  const refs = refsOf(draft);
  if (refs.length === 0) {
    return <p className="text-body text-ink-muted">All of its features wait for {of}.</p>;
  }
  return (
    <ul aria-label="Features" className={listClass}>
      {refs.map((ref) => {
        const mine = eq(parseRef(ref).shortSource, draft.source)
          ? findFeature(registry, ref)
          : undefined;
        const g = mine !== undefined ? own(mine, 'castGuidance') : undefined;
        return (
          <FeatureRow
            key={ref}
            name={String(mine?.name ?? parseRef(ref).name)}
            noun="feature"
            meta={
              mine === undefined
                ? `Level ${parseRef(ref).level}. Shows when ${of} is loaded.`
                : `Level ${parseRef(ref).level}`
            }
            status={mine === undefined ? 'waiting' : isRecord(g) && g.basedOn ? 'changed' : 'new'}
            editing={false}
            readOnly
            onChange={() => undefined}
            onRename={() => undefined}
          />
        );
      })}
    </ul>
  );
}

function SubclassBody({ draft, change, original, registry, readOnly }: EditorProps) {
  const nodes = useMemo(
    () => (original === undefined ? [] : featureTree(original, registry)),
    [original, registry],
  );
  const [changing, setChanging] = useState<ReadonlySet<string>>(() => new Set());
  if (original === undefined && isRecord(own(draft, '_copy'))) {
    return (
      <Section title="Features">
        <Waiting draft={draft} registry={registry} />
      </Section>
    );
  }
  const edits = editsOf(draft);
  const set = (patch: Partial<FeatureEdits>) => change({ [KEY]: { ...edits, ...patch } });
  const mark = (ref: string, on: boolean) =>
    setChanging((s) => {
      const next = new Set(s);
      if (on) next.add(ref);
      else next.delete(ref);
      return next;
    });
  const withoutChange = (ref: string) => {
    const { [ref]: _, ...changed } = edits.changed;
    return changed;
  };

  const setMode = async (n: FeatureNode, mode: 'keep' | 'change' | 'remove') => {
    const name = String(n.entity?.name ?? '');
    if (mode === 'remove') {
      set({ removed: [...edits.removed, n.ref], changed: withoutChange(n.ref) });
      return mark(n.ref, false);
    }
    const removed = edits.removed.filter((r) => r !== n.ref);
    if (mode === 'keep' && changedOf(edits, n) !== undefined) {
      const ok = await askConfirm({
        title: `Go back to the original ${name}?`,
        detail: 'Your changes to it are lost.',
        confirmLabel: 'Go back',
      });
      if (!ok) return;
    }
    if (mode === 'keep') set({ removed, changed: withoutChange(n.ref) });
    else if (removed.length !== edits.removed.length) set({ removed });
    mark(n.ref, mode === 'change');
  };

  const levels = [
    ...new Set([
      ...nodes.filter((n) => n.entity !== undefined).map((n) => n.level),
      ...edits.added.map((a) => Number(a.level)),
    ]),
  ].sort((a, b) => a - b);
  const firstLevel = levels[0] ?? 3;
  const add = () => {
    const taken = new Set(edits.added.map((a) => String(a.name)));
    let k = 1;
    let name = 'New feature';
    while (taken.has(name)) name = `New feature ${++k}`;
    set({ added: [...edits.added, { name, level: firstLevel, entries: [] }] });
  };
  const setAdded = (i: number, next: Json) =>
    set({ added: edits.added.map((a, j) => (j === i ? next : a)) });

  const classes = registry.byType('class');
  return (
    <>
      {original === undefined && (
        <Section title="About it">
          <Field label="Class">
            <Select
              value={
                draft.className ? `${String(draft.className)}|${String(draft.classSource)}` : ''
              }
              disabled={readOnly}
              onChange={(e) => {
                const [className, classSource] = e.target.value.split('|');
                change({ className, classSource });
              }}
            >
              <option value="">Pick a class</option>
              {classes.map((c) => (
                <option
                  key={`${String(c.name)}|${String(c.source)}`}
                  value={`${String(c.name)}|${String(c.source)}`}
                >
                  {String(c.name)}, {String(c.source)}
                </option>
              ))}
            </Select>
          </Field>
        </Section>
      )}
      {original !== undefined && Array.isArray(original.additionalSpells) && (
        <p className="flex items-start gap-2 rounded-control bg-surface-raised px-3 py-2 text-caption">
          <Info size={16} aria-hidden className="mt-px shrink-0 text-ink-muted" />
          Its always-prepared spells are kept as {String(original.name)} has them.
        </p>
      )}
      <Section title="Features">
        {levels.map((level) => (
          <div key={level} className="flex flex-col gap-2">
            <h3 className="text-overline text-ink-muted uppercase">Level {level}</h3>
            <ul aria-label={`Level ${level}`} className={listClass}>
              {nodes
                .filter((n) => n.level === level && n.entity !== undefined)
                .map((n) => {
                  const status = statusOf(edits, n);
                  const value = edits.changed[n.ref] ?? n.base;
                  return (
                    <FeatureRow
                      key={n.ref}
                      name={String(status === 'removed' ? n.entity?.name : value.name)}
                      noun="feature"
                      status={status}
                      value={value}
                      editing={status === 'changed' || (status === 'kept' && changing.has(n.ref))}
                      readOnly={readOnly}
                      foldable
                      onMode={(m) => void setMode(n, m)}
                      withEffects
                      inherits={String(n.entity?.name)}
                      onChange={(next) => set({ changed: { ...edits.changed, [n.ref]: next } })}
                      onRename={(name) =>
                        set({ changed: { ...edits.changed, [n.ref]: { ...value, name } } })
                      }
                    />
                  );
                })}
              {edits.added.map((a, i) =>
                Number(a.level) === level ? (
                  <FeatureRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: added features have no other identity while their names are typed.
                    key={`new:${i}`}
                    name={String(a.name ?? '')}
                    noun="feature"
                    meta="Your own feature"
                    status="new"
                    value={a}
                    editing
                    readOnly={readOnly}
                    foldable
                    withEffects
                    onDelete={() => set({ added: edits.added.filter((_, j) => j !== i) })}
                    onChange={(next) => setAdded(i, next)}
                    onRename={(name) => setAdded(i, { ...a, name })}
                  >
                    <Field label="Level">
                      <Select
                        value={String(a.level)}
                        disabled={readOnly}
                        onChange={(e) => setAdded(i, { ...a, level: Number(e.target.value) })}
                      >
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </FeatureRow>
                ) : null,
              )}
            </ul>
          </div>
        ))}
        {!readOnly && (
          <Button variant="outline" size="sm" className="self-start" onClick={add}>
            <Plus size={16} aria-hidden />
            Add a feature
          </Button>
        )}
      </Section>
    </>
  );
}

export const editor: EditorSpec = {
  noun: 'subclass',
  blank: () => ({ [KEY]: { changed: {}, removed: [], added: [] }, subclassFeatures: [] }),
  Body: SubclassBody,
  check,
  open: openSubclass,
  write: writeSubclass,
  summary: summarize,
};
