/**
 * Write a rule pack (board 10, B): from the table rules this device plays by
 * and the player's Changes to the books, a pack anyone can import. Three
 * steps: what goes in, its name and what it changes, then saved, with Export.
 *
 * The pack is a homebrew file like any other (`data5e/rulePack.ts`): its
 * table rules in `_meta.castGuidance.tableRules`, and each change as an entry
 * of its content that its `replaces` names, read against the entry below as
 * the player's own change is (ADR-002, D2), so it reaches only the
 * characters the pack applies to. It declares a source of its own, never a
 * book's, and is stamped as made in this app, so a copy of it imported
 * elsewhere is one collection there. It is stored as an import stores a file,
 * on and applying to no character: the player chooses who on its review.
 * Export sends the stored file as it leaves the device (`sharedFile`), so
 * importing that file lands it unchanged.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState } from 'react';
import { invalidateRegistry } from '@/data5e/registry';
import { packRefusals, sharedFile } from '@/data5e/rulePack';
import type { HomebrewFileRow } from '@/db/db';
import { CHANGES_SOURCE, COLLECTION_ID_KEY, WORKSHOP_SOURCE } from '@/db/homebrewOrder';
import { homebrewRepo } from '@/db/homebrewRepo';
import {
  CAST_GUIDANCE_VERSION,
  ENTRY_PARENT_KEYS,
  type StoredReplacedEntry,
  type TableRuleChoices,
  type TableRuleId,
} from '@/engine/castGuidance';
import { packReplaces } from '@/features/homebrew/importPreview';
import { isAsWritten, useAppRules } from '@/features/settings/HouseRulesSection';
import { choiceTitle, RULE_ORDER, RULE_TITLES } from '@/features/settings/RuleSheet';
import { downloadJson, jsonFilename } from '@/lib/download';
import { HOMEBREW_ENTITY_KEYS } from '@/lib/guards';
import { announce } from '@/stores/announcer';
import { errorText } from '@/stores/notices';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/sheet';
import { TextField } from '@/ui/TextField';
import { kindOf, newSource } from './yours';

/** One of the player's changes to the books, as a pack carries it. */
export interface PackChange {
  type: string;
  entry: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The entry a pack's `replaces` names for a change: the identity the merge
 * reads (its type, name, source and, for a feature or a subclass, its
 * parent's fields), from the change or else its `_copy`, so a Rage written as
 * changes still names its class and level.
 */
export function replacedRef(type: string, entry: Record<string, unknown>): StoredReplacedEntry {
  const copy = isRecord(entry._copy) ? entry._copy : {};
  const parents = Object.hasOwn(ENTRY_PARENT_KEYS, type) ? (ENTRY_PARENT_KEYS[type] ?? []) : [];
  const ref: Record<string, unknown> = { type };
  for (const key of ['name', 'source', ...parents]) {
    const v = Object.hasOwn(entry, key) ? entry[key] : copy[key];
    if (v !== undefined) ref[key] = v;
  }
  return ref as StoredReplacedEntry;
}

/** What a written pack is made of. */
export interface WrittenPackInput {
  name: string;
  /** Its own source code, which no stored file and no book has. */
  source: string;
  /** The id it is stamped with as made in this app. */
  stamp: string;
  rules: Partial<TableRuleChoices>;
  changes: readonly PackChange[];
}

/** The rule pack file a player writes: its book, its stamp, its rules and its changes. */
export function writtenPack({
  name,
  source,
  stamp,
  rules,
  changes,
}: WrittenPackInput): Record<string, unknown> {
  const tableRules: Record<string, string> = {};
  for (const id of RULE_ORDER) {
    const v = rules[id];
    if (v !== undefined) tableRules[id] = v;
  }
  const content: Record<string, unknown[]> = {};
  for (const c of changes) (content[c.type] ??= []).push(structuredClone(c.entry));
  return {
    _meta: {
      sources: [{ json: source, abbreviation: source, full: name, authors: [], version: '1.0.0' }],
      [COLLECTION_ID_KEY]: stamp,
      castGuidance: {
        v: CAST_GUIDANCE_VERSION,
        ...(Object.keys(tableRules).length === 0 ? {} : { tableRules }),
        ...(changes.length === 0
          ? {}
          : { replaces: changes.map((c) => replacedRef(c.type, c.entry)) }),
      },
    },
    ...content,
  };
}

/**
 * A source for a pack named `name`, as a collection started on the move
 * sheet gets one (`newSource`), with a number after it while a stored file
 * already declares it in any case. Two packs never share one, since a
 * character's switches are kept by source.
 */
export function packSource(name: string, taken: Iterable<string>): string {
  const used = new Set([WORKSHOP_SOURCE, CHANGES_SOURCE, ...taken].map((s) => s.toLowerCase()));
  const wanted = newSource(name);
  if (!used.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; ; n += 1) {
    const next = `${wanted}${n}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** The file name a pack downloads as ("my-table-rules.json"). */
export const packFileName = (name: string): string =>
  jsonFilename(
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'rule-pack',
  );

/**
 * Store a written pack as an import stores a file: on, applying to no
 * character until the player chooses who.
 */
export async function savePack(json: Record<string, unknown>, fileName: string) {
  const prepared = await homebrewRepo.prepare(json, fileName);
  const landed = await homebrewRepo.commit(prepared);
  invalidateRegistry();
  return landed;
}

/** Download a pack as it leaves this device. */
export function exportPack(row: Pick<HomebrewFileRow, 'fileName' | 'json'>): void {
  downloadJson(row.fileName, sharedFile(row.json));
}

/** Every entry of the player's Changes to the books, in the order the file keeps them. */
export function changesIn(json: Record<string, unknown> | undefined): PackChange[] {
  if (json === undefined) return [];
  const out: PackChange[] = [];
  for (const type of HOMEBREW_ENTITY_KEYS) {
    const list = json[type];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (isRecord(entry) && typeof entry.name === 'string' && typeof entry.source === 'string')
        out.push({ type, entry });
    }
  }
  return out;
}

/** What a change is, as its row says it ("Class feature, Barbarian level 1"). */
function changeKind({ type, entry }: PackChange): string {
  const ref = replacedRef(type, entry);
  const kind =
    type === 'classFeature'
      ? 'Class feature'
      : type === 'subclassFeature'
        ? 'Subclass feature'
        : kindOf(type);
  const of =
    type === 'subclassFeature'
      ? ref.subclassShortName
      : type === 'subrace'
        ? ref.raceName
        : ref.className;
  const level = ref.level === undefined ? '' : ` level ${String(ref.level)}`;
  return typeof of === 'string' && of !== '' ? `${kind}, ${of}${level}` : kind;
}

type Step = 'pick' | 'name' | 'done';
const NOTE = 'text-caption text-ink-muted';
const rulePick = (id: string) => `rule:${id}`;
const changePick = (i: number) => `change:${i}`;
const things = (n: number) => (n === 1 ? '1 thing' : `${n} things`);

function PickRow({
  title,
  caption,
  checked,
  onChange,
}: {
  title: string;
  caption: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex min-h-tap cursor-pointer items-start gap-3 px-3 py-2 hover:bg-surface-raised">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-5 shrink-0 accent-ink"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-body-strong break-words">{title}</span>
        <span className={NOTE}>{caption}</span>
      </span>
    </label>
  );
}

const LIST = 'flex flex-col divide-y divide-line rounded-control ring-1 ring-line ring-inset';

/**
 * The sheet itself. `onSaved` hears what was saved, as the page says it,
 * once the pack is stored; the sheet stays open on its last step for Export.
 */
export default function WritePackSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const ids = useId();
  const { rules, chosen, packs, ready } = useAppRules();
  const changesFile = useLiveQuery(
    async () => (await homebrewRepo.ownedSafe()).files.find((f) => f.role === 'changes') ?? null,
    [],
  );
  const changes = changesFile === undefined ? undefined : changesIn(changesFile?.json);
  // The picks start from what the rules and changes are, so none is shown, or
  // taken, before both are read.
  const loading = !ready || changes === undefined;
  const [step, setStep] = useState<Step>('pick');
  // Until the player picks, every house rule and every change is in.
  const [picked, setPicked] = useState<ReadonlySet<string>>();
  const [name, setName] = useState('My table rules');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [saved, setSaved] = useState<HomebrewFileRow>();
  const [exported, setExported] = useState(false);

  const defaults = new Set([
    ...RULE_ORDER.filter((id) => !isAsWritten(id, rules)).map(rulePick),
    ...(changes ?? []).map((_, i) => changePick(i)),
  ]);
  const picks = picked ?? defaults;
  const toggle = (key: string) => {
    const next = new Set(picks);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  // Where a rule's value comes from, as its pick says it.
  const whence = (id: TableRuleId) => {
    if (isAsWritten(id, rules)) return 'as written';
    const pack = chosen[id] === undefined ? packs[id] : undefined;
    return pack === undefined ? 'a house rule' : `from ${pack}`;
  };
  const pickedRules = RULE_ORDER.filter((id) => picks.has(rulePick(id)));
  const pickedChanges = (changes ?? []).filter((_, i) => picks.has(changePick(i)));
  const count = pickedRules.length + pickedChanges.length;
  const draft = (source: string, stamp: string) =>
    writtenPack({
      name: name.trim(),
      source,
      stamp,
      rules: Object.fromEntries(pickedRules.map((id) => [id, rules[id]])),
      changes: pickedChanges,
    });
  // What it would hold, checked against a pack's limits before it is saved.
  const check = draft('Check', 'check');
  const refusals = packRefusals(
    (check._meta as { castGuidance: Record<string, unknown> }).castGuidance,
  );
  const unplaced = (packReplaces(check)?.entries ?? []).filter((r) => !r.inPack);
  const nameMissing = name.trim() === '';

  const save = async () => {
    if (busy || nameMissing || refusals.length > 0) return;
    setBusy(true);
    setFailed(undefined);
    try {
      const stored = (await homebrewRepo.listMetaSafe()).files.flatMap((r) => r.sourceIds);
      const json = draft(packSource(name, stored), crypto.randomUUID());
      const { row } = await savePack(json, packFileName(name));
      setSaved(row);
      setStep('done');
      const text = `Saved ${name.trim()} to Rules. It changes ${things(count)}, for no character until you choose who.`;
      announce(text, { key: 'write-pack', repeat: true });
      onSaved(text);
    } catch (err) {
      setFailed(`Could not save the rule pack: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const inIt = [
    ...pickedRules.map((id) => ({
      key: rulePick(id),
      name: RULE_TITLES[id],
      now: choiceTitle(id, rules[id]),
      note: isAsWritten(id, rules)
        ? 'As written, kept so a table that changed it gets it back'
        : undefined,
    })),
    ...pickedChanges.map((c, i) => ({
      key: changePick(i),
      name: String(c.entry.name),
      now: `${changeKind(c)}: your version, in place of the one below it`,
      note: undefined,
    })),
  ];

  return (
    <Sheet.Root open onOpenChange={(open) => !open && onClose()}>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel aria-describedby={`${ids}-step`} className="flex max-h-[90dvh] flex-col">
          <Sheet.Heading>
            {step === 'done'
              ? saved === undefined
                ? 'Rule pack'
                : name.trim()
              : 'Write a rule pack'}
          </Sheet.Heading>
          <p id={`${ids}-step`} className={`-mt-2 mb-3 ${NOTE}`}>
            {step === 'pick'
              ? 'Step 1 of 3: what goes in'
              : step === 'name'
                ? 'Step 2 of 3: name and check'
                : 'Rule pack, saved'}
          </p>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-body">
            {step === 'pick' && (
              <>
                <p className={NOTE}>
                  Pick what goes in. Whoever imports it gets these rules for the characters they
                  turn it on for. Your own characters keep what they have.
                </p>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-body-strong">Your table rules</legend>
                  {loading ? (
                    <p className={NOTE}>Loading…</p>
                  ) : (
                    <div className={LIST}>
                      {RULE_ORDER.map((id) => (
                        <PickRow
                          key={id}
                          title={RULE_TITLES[id]}
                          caption={`${choiceTitle(id, rules[id])}, ${whence(id)}`}
                          checked={picks.has(rulePick(id))}
                          onChange={() => toggle(rulePick(id))}
                        />
                      ))}
                    </div>
                  )}
                </fieldset>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-body-strong">Your changes to the books</legend>
                  {loading || changes === undefined ? (
                    <p className={NOTE}>Loading…</p>
                  ) : changes.length === 0 ? (
                    <p className={NOTE}>
                      None yet. Change an entry for your table from the Library, and it shows here.
                    </p>
                  ) : (
                    <div className={LIST}>
                      {changes.map((c, i) => (
                        <PickRow
                          // biome-ignore lint/suspicious/noArrayIndexKey: the file's order, fixed while shown
                          key={i}
                          title={String(c.entry.name)}
                          caption={changeKind(c)}
                          checked={picks.has(changePick(i))}
                          onChange={() => toggle(changePick(i))}
                        />
                      ))}
                    </div>
                  )}
                </fieldset>
              </>
            )}

            {step === 'name' && (
              <>
                <TextField
                  label="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  error={nameMissing ? 'A rule pack needs a name.' : undefined}
                  maxLength={100}
                />
                <section aria-labelledby={`${ids}-changes`} className="flex flex-col gap-2">
                  <h3 id={`${ids}-changes`} className="text-body-strong">
                    What it changes, {things(count)}
                  </h3>
                  <dl className={LIST}>
                    {inIt.map((d) => (
                      <div key={d.key} className="flex flex-col px-3 py-2">
                        <dt className="text-body-strong break-words">{d.name}</dt>
                        <dd className="text-ink-muted break-words">{d.now}</dd>
                        {d.note !== undefined && <dd className={NOTE}>{d.note}</dd>}
                      </div>
                    ))}
                  </dl>
                </section>
                {refusals.length > 0 && (
                  <div role="alert" className="text-caption text-danger">
                    It goes past what a rule pack may hold: {refusals.join('; ')}.
                  </div>
                )}
                {unplaced.length > 0 && (
                  <p className="text-caption text-danger">
                    {unplaced.map((r) => r.words).join(', ')} would replace nothing.
                  </p>
                )}
                <p className={NOTE}>
                  Saving puts it on your Rules shelf, applying to no character. Export makes a file
                  anyone can import in their Workshop.
                </p>
              </>
            )}

            {step === 'done' && (
              <>
                <p>
                  Saved to Rules. {name.trim()} changes {things(count)}. It applies to no character
                  until you choose who on its review.
                </p>
                <dl className={LIST}>
                  {inIt.map((d) => (
                    <div key={d.key} className="flex flex-col px-3 py-2">
                      <dt className="text-body-strong break-words">{d.name}</dt>
                      <dd className="text-ink-muted break-words">{d.now}</dd>
                    </div>
                  ))}
                </dl>
                <p aria-live="polite" className={NOTE}>
                  {exported && saved !== undefined
                    ? `Saved ${saved.fileName}. Anyone can import it in their Workshop.`
                    : ''}
                </p>
              </>
            )}
            {failed !== undefined && (
              <p role="alert" className="text-caption text-danger">
                {failed}
              </p>
            )}
          </div>

          <div className="mt-3 flex shrink-0 flex-wrap gap-2">
            {step === 'pick' && (
              <>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="brand"
                  className="flex-1"
                  aria-disabled={loading || count === 0 ? true : undefined}
                  onClick={() => !loading && count > 0 && setStep('name')}
                >
                  {loading
                    ? 'Loading…'
                    : count === 0
                      ? 'Pick at least one'
                      : `Next: name it (${things(count)})`}
                </Button>
              </>
            )}
            {step === 'name' && (
              <>
                <Button variant="ghost" onClick={() => setStep('pick')}>
                  Back
                </Button>
                <Button
                  variant="brand"
                  className="flex-1"
                  aria-disabled={busy || nameMissing || refusals.length > 0 ? true : undefined}
                  aria-busy={busy}
                  onClick={() => void save()}
                >
                  {busy ? 'Saving…' : 'Save rule pack'}
                </Button>
              </>
            )}
            {step === 'done' && saved !== undefined && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    exportPack(saved);
                    setExported(true);
                  }}
                >
                  Export as a file
                </Button>
                <Button variant="brand" className="flex-1" onClick={onClose}>
                  Done
                </Button>
              </>
            )}
          </div>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
