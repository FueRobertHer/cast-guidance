/**
 * What differs between two versions of a character, as short human lines
 * (UX-005). History restore previews these before applying a snapshot, and the
 * session uses their kinds to decide which rapid edits belong to one entry.
 *
 * Lines read "from → to", neutral about direction, so the same helper serves a
 * restore preview (current → snapshot) and an undo (now → before).
 */
import { characterSourceList } from '@/data5e/sourceNames';
import { ABILITIES, type CharacterDoc, type EntityRef } from '@/engine/types';

export type ChangeKind =
  | 'name'
  | 'rules'
  | 'sources'
  | 'dataTag'
  | 'class'
  | 'species'
  | 'background'
  | 'hpRule'
  | 'feats'
  | 'abilities'
  | 'choices'
  | 'equipment'
  | 'spells'
  | 'modifiers'
  | 'overrides'
  | 'notes'
  | 'hp'
  | 'tempHp'
  | 'conditions'
  | 'slots'
  | 'hitDice'
  | 'resources'
  | 'deathSaves'
  | 'concentration'
  | 'inspiration'
  | 'currency'
  | 'xp'
  | 'turn'
  | 'other';

export interface DocChange {
  kind: ChangeKind;
  /** "HP 12 → 20", "Gear: +Shield, −Longsword". */
  line: string;
  /** A change that reshapes the character; never merged with other edits. */
  structural: boolean;
}

/**
 * Which edits count as "the same thing" for merging. Damage with temp HP up
 * moves hp and tempHp, without it only hp, and dropping to 0 can touch death
 * saves or concentration; all of that is one run of taking hits, so they share
 * a family rather than each kind keying its own burst.
 */
const FAMILY: Record<ChangeKind, string | undefined> = {
  name: 'text',
  notes: 'text',
  abilities: 'abilities',
  choices: 'choices',
  equipment: 'gear',
  currency: 'gear',
  spells: 'spells',
  modifiers: 'tuning',
  overrides: 'tuning',
  sources: 'sources',
  hp: 'vitals',
  tempHp: 'vitals',
  deathSaves: 'vitals',
  concentration: 'vitals',
  conditions: 'conditions',
  slots: 'spend',
  hitDice: 'spend',
  resources: 'spend',
  inspiration: 'inspiration',
  xp: 'xp',
  turn: 'turn',
  // Structural: no family, so they never merge.
  rules: undefined,
  dataTag: undefined,
  class: undefined,
  species: undefined,
  background: undefined,
  hpRule: undefined,
  feats: undefined,
  other: undefined,
};

/** Multiset difference of two display-name lists. */
export function nameDiff(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const count = (list: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
    return m;
  };
  const p = count(prev);
  const n = count(next);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [name, c] of n) for (let i = 0; i < c - (p.get(name) ?? 0); i++) added.push(name);
  for (const [name, c] of p) for (let i = 0; i < c - (n.get(name) ?? 0); i++) removed.push(name);
  return { added, removed };
}

/** "Bless +2 more" style summary for a list of changed names. */
export function firstWithMore(names: string[]): string {
  const first = names[0] ?? '';
  return names.length > 1 ? `${first} +${names.length - 1} more` : first;
}

export function spellNames(doc: CharacterDoc): { known: string[]; prepared: string[] } {
  const known: string[] = [];
  const prepared: string[] = [];
  for (const block of Object.values(doc.spellcasting)) {
    for (const s of block.known) known.push(s.name);
    for (const s of block.prepared) prepared.push(s.name);
  }
  return { known, prepared };
}

/** 'relentless-endurance' -> 'relentless endurance'. Resource keys are kebab-case. */
export function humanKey(key: string): string {
  return key.replace(/-/g, ' ');
}

/** Bookkeeping that says nothing about the character itself. */
const IGNORED_TOP = ['id', 'createdAt', 'updatedAt', 'schemaVersion', 'homebrewDeps'] as const;

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

/**
 * A comparison key for a document's content. Key order, the bookkeeping fields,
 * and zero-valued entries the sheet treats as absent are ignored: the session's
 * copy keeps the `updatedAt` it loaded while the stored row gets a fresh stamp,
 * and ticking a resource pip then unticking it leaves `{used: 0}` where there
 * was no entry, so raw JSON calls two identical characters different.
 *
 * `hpInitialized` stays in: it decides whether current HP keeps following the
 * maximum, so a snapshot that differs there is not the same character.
 *
 * The save journal hashes this to recognise the stored row a snapshot was
 * built on (see `contentHash` in src/stores/saveJournal.ts). Hashes written by
 * the previous app are compared by the next one, so changing what this key
 * includes makes an edit cut off by the update reload drop instead of replay.
 */
export function contentKey(doc: CharacterDoc): string {
  const clone: Record<string, unknown> = { ...doc };
  for (const k of IGNORED_TOP) delete clone[k];
  const p = doc.play;
  const slots = [...p.slotsSpent];
  while (slots.length > 0 && slots[slots.length - 1] === 0) slots.pop();
  clone.play = {
    ...p,
    slotsSpent: slots,
    hitDiceSpent: Object.fromEntries(Object.entries(p.hitDiceSpent).filter(([, n]) => n !== 0)),
    resources: p.resources
      .filter((r) => r.used !== 0)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    conditions: p.conditions
      .map((c) => ({ id: c.id, level: c.level ?? 0 }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    // Older documents predate the turn tracker; absent means nothing used.
    turn: p.turn ?? { action: false, bonus: false, reaction: false },
    // Absent on older documents, which are left exactly as saved: settled.
    hpInitialized: p.hpInitialized !== false,
  };
  clone.hpMethod = doc.hpMethod ?? 'average';
  return sortedJson(clone);
}

export function sameContent(a: CharacterDoc, b: CharacterDoc): boolean {
  return contentKey(a) === contentKey(b);
}

function same(a: unknown, b: unknown): boolean {
  return sortedJson(a) === sortedJson(b);
}

function refName(ref: EntityRef | undefined): string {
  return ref?.name ?? 'none';
}

/** "+Shield, +Rope, −Longsword", at most three names then a count. */
function signedNames(added: string[], removed: string[]): string {
  const all = [...added.map((n) => `+${n}`), ...removed.map((n) => `−${n}`)];
  return all.length > 3 ? `${all.slice(0, 3).join(', ')} +${all.length - 3} more` : all.join(', ');
}

/**
 * The character's own book list. An empty list means no restriction, so going
 * to or from one is a change of kind, not a diff of names: turning a list on
 * writes every allowed book at once, and "+PHB +81 more" says nothing useful.
 */
function sourcesLine(from: unknown, to: unknown): string {
  // Read the way the pickers read it, so junk entries count for nothing and
  // a respelling ("phb" to "PHB") is not reported as a swap.
  const prev = characterSourceList(from);
  const next = characterSourceList(to);
  if (prev.length === 0 && next.length > 0)
    return `Sources: limited to ${next.length} book${next.length === 1 ? '' : 's'}`;
  if (prev.length > 0 && next.length === 0) return 'Sources: book restriction removed';
  const { added, removed } = nameDiff(prev, next);
  return added.length > 0 || removed.length > 0
    ? `Sources: ${signedNames(added, removed)}`
    : 'Source order';
}

function refChange(
  out: DocChange[],
  kind: ChangeKind,
  title: string,
  from: EntityRef | undefined,
  to: EntityRef | undefined,
): void {
  if (from?.name === to?.name && from?.source === to?.source) return;
  const show = (r: EntityRef | undefined) =>
    r !== undefined && from?.name === to?.name ? `${r.name} (${r.source})` : refName(r);
  out.push({ kind, line: `${title}: ${show(from)} → ${show(to)}`, structural: true });
}

function classChanges(out: DocChange[], from: CharacterDoc, to: CharacterDoc): void {
  const before = out.length;
  const uid = (c: CharacterDoc['classes'][number]) => `${c.ref.name}|${c.ref.source}`;
  const prev = new Map(from.classes.map((c) => [uid(c), c]));
  const push = (line: string) => out.push({ kind: 'class', line, structural: true });
  for (const c of to.classes) {
    const p = prev.get(uid(c));
    prev.delete(uid(c));
    if (p === undefined) {
      push(`Adds ${c.ref.name} ${c.levels}`);
      continue;
    }
    if (p.levels !== c.levels) push(`${c.ref.name} ${p.levels} → ${c.levels}`);
    if (p.subclass?.name !== c.subclass?.name)
      push(`${c.ref.name} subclass: ${refName(p.subclass)} → ${refName(c.subclass)}`);
    else if (p.levels === c.levels && !same(p.hp, c.hp)) push(`${c.ref.name} hit points per level`);
  }
  for (const p of prev.values()) push(`Removes ${p.ref.name} ${p.levels}`);
  // Same classes, same levels, something else moved (order: which one is primary).
  if (out.length === before && !same(from.classes, to.classes)) push('Class details');
}

function equipmentChanges(out: DocChange[], from: CharacterDoc, to: CharacterDoc): void {
  if (same(from.equipment, to.equipment)) return;
  const before = out.length;
  const nameOf = (e: CharacterDoc['equipment'][number]) => e.ref?.name ?? e.custom?.name ?? 'item';
  const prev = new Map(from.equipment.map((e) => [e.id, e]));
  const added: string[] = [];
  const details: string[] = [];
  for (const e of to.equipment) {
    const p = prev.get(e.id);
    prev.delete(e.id);
    if (p === undefined) {
      added.push(nameOf(e));
      continue;
    }
    if (same(p, e)) continue;
    const name = nameOf(e);
    if (p.qty !== e.qty) details.push(`${name} ×${p.qty} → ×${e.qty}`);
    if (p.equipped !== e.equipped)
      details.push(`${name} ${e.equipped ? 'equipped' : 'unequipped'}`);
    if (p.attuned !== e.attuned) details.push(`${name} ${e.attuned ? 'attuned' : 'unattuned'}`);
    if (p.location !== e.location)
      details.push(`${name} location: ${p.location ?? 'none'} → ${e.location ?? 'none'}`);
    if (
      p.qty === e.qty &&
      p.equipped === e.equipped &&
      p.attuned === e.attuned &&
      p.location === e.location
    )
      details.push(`${name} details`);
  }
  const removed = [...prev.values()].map(nameOf);
  if (added.length > 0 || removed.length > 0)
    out.push({
      kind: 'equipment',
      line: `Gear: ${signedNames(added, removed)}`,
      structural: false,
    });
  for (const line of details) out.push({ kind: 'equipment', line, structural: false });
  // Only the order moved.
  if (out.length === before) out.push({ kind: 'equipment', line: 'Gear order', structural: false });
}

function spellChanges(out: DocChange[], from: CharacterDoc, to: CharacterDoc): void {
  if (same(from.spellcasting, to.spellcasting)) return;
  const before = out.length;
  const p = spellNames(from);
  const n = spellNames(to);
  const prep = nameDiff(p.prepared, n.prepared);
  if (prep.added.length > 0 || prep.removed.length > 0)
    out.push({
      kind: 'spells',
      line: `Prepared: ${signedNames(prep.added, prep.removed)}`,
      structural: false,
    });
  const known = nameDiff(p.known, n.known);
  if (known.added.length > 0 || known.removed.length > 0)
    out.push({
      kind: 'spells',
      line: `Known: ${signedNames(known.added, known.removed)}`,
      structural: false,
    });
  if (out.length === before) out.push({ kind: 'spells', line: 'Spell details', structural: false });
}

function abilityChanges(out: DocChange[], from: CharacterDoc, to: CharacterDoc): void {
  if (same(from.abilities, to.abilities)) return;
  const push = (line: string) => out.push({ kind: 'abilities', line, structural: false });
  if (from.abilities.method !== to.abilities.method)
    push(`Ability method: ${from.abilities.method} → ${to.abilities.method}`);
  for (const a of ABILITIES) {
    const was = from.abilities.base[a];
    const now = to.abilities.base[a];
    if (was !== now) push(`${a.toUpperCase()} ${was} → ${now}`);
  }
}

function playChanges(out: DocChange[], from: CharacterDoc, to: CharacterDoc): void {
  const p = from.play;
  const n = to.play;
  const push = (kind: ChangeKind, line: string) => out.push({ kind, line, structural: false });

  if (p.currentHp !== n.currentHp) push('hp', `HP ${p.currentHp} → ${n.currentHp}`);
  if (p.tempHp !== n.tempHp) push('tempHp', `Temp HP ${p.tempHp} → ${n.tempHp}`);

  const ids = (doc: CharacterDoc) => doc.play.conditions.map((c) => c.id);
  const cond = nameDiff(ids(from), ids(to));
  if (cond.added.length > 0 || cond.removed.length > 0)
    push('conditions', `Conditions: ${signedNames(cond.added, cond.removed)}`);
  const prevLevel = new Map(p.conditions.map((c) => [c.id, c.level]));
  for (const c of n.conditions) {
    const was = prevLevel.get(c.id) ?? 0;
    if (prevLevel.has(c.id) && was !== (c.level ?? 0))
      push('conditions', `${c.id} ${was} → ${c.level ?? 0}`);
  }

  for (let i = 0; i < Math.max(p.slotsSpent.length, n.slotsSpent.length); i++) {
    const was = p.slotsSpent[i] ?? 0;
    const now = n.slotsSpent[i] ?? 0;
    if (was !== now) push('slots', `Level ${i + 1} slots spent ${was} → ${now}`);
  }
  if (p.pactSlotsSpent !== n.pactSlotsSpent)
    push('slots', `Pact slots spent ${p.pactSlotsSpent} → ${n.pactSlotsSpent}`);

  for (const die of new Set([...Object.keys(p.hitDiceSpent), ...Object.keys(n.hitDiceSpent)])) {
    const was = p.hitDiceSpent[die] ?? 0;
    const now = n.hitDiceSpent[die] ?? 0;
    if (was !== now) push('hitDice', `Hit dice (${die}) spent ${was} → ${now}`);
  }

  const used = (doc: CharacterDoc) => new Map(doc.play.resources.map((r) => [r.key, r.used]));
  const pr = used(from);
  const nr = used(to);
  for (const key of new Set([...pr.keys(), ...nr.keys()])) {
    const was = pr.get(key) ?? 0;
    const now = nr.get(key) ?? 0;
    if (was !== now) push('resources', `${humanKey(key)} used ${was} → ${now}`);
  }

  const saves = (d: CharacterDoc['play']['deathSaves']) =>
    d.success === 0 && d.fail === 0
      ? 'none'
      : `${d.success} ${d.success === 1 ? 'success' : 'successes'}, ${d.fail} ${d.fail === 1 ? 'failure' : 'failures'}`;
  if (p.deathSaves.success !== n.deathSaves.success || p.deathSaves.fail !== n.deathSaves.fail)
    push('deathSaves', `Death saves ${saves(p.deathSaves)} → ${saves(n.deathSaves)}`);

  if (p.concentratingOn?.label !== n.concentratingOn?.label)
    push(
      'concentration',
      `Concentrating: ${p.concentratingOn?.label ?? 'none'} → ${n.concentratingOn?.label ?? 'none'}`,
    );

  if (p.inspiration !== n.inspiration)
    push(
      'inspiration',
      `Inspiration ${p.inspiration ? 'yes' : 'no'} → ${n.inspiration ? 'yes' : 'no'}`,
    );

  for (const coin of ['pp', 'gp', 'ep', 'sp', 'cp'] as const) {
    if (p.currency[coin] !== n.currency[coin])
      push('currency', `${coin.toUpperCase()} ${p.currency[coin]} → ${n.currency[coin]}`);
  }
  if (p.xp !== n.xp) push('xp', `XP ${p.xp} → ${n.xp}`);

  const turn = (t: CharacterDoc['play']['turn']) => {
    const spent = (['action', 'bonus', 'reaction'] as const).filter((k) => t?.[k] === true);
    return spent.length === 0 ? 'fresh' : `${spent.join(' + ')} used`;
  };
  if (turn(p.turn) !== turn(n.turn)) push('turn', `Turn: ${turn(p.turn)} → ${turn(n.turn)}`);
}

/** Every difference from `from` to `to`, most identity-shaping first. */
export function diffDocs(from: CharacterDoc, to: CharacterDoc): DocChange[] {
  const out: DocChange[] = [];

  if (from.rulesVersion !== to.rulesVersion)
    out.push({
      kind: 'rules',
      line: `Rules ${from.rulesVersion} → ${to.rulesVersion}`,
      structural: true,
    });
  classChanges(out, from, to);
  refChange(out, 'species', 'Species', from.race, to.race);
  refChange(out, 'species', 'Subrace', from.subrace, to.subrace);
  refChange(out, 'background', 'Background', from.background, to.background);
  const hpRule = (d: CharacterDoc) => d.hpMethod ?? 'average';
  if (hpRule(from) !== hpRule(to))
    out.push({
      kind: 'hpRule',
      line: `HP rule: ${hpRule(from)} → ${hpRule(to)}`,
      structural: true,
    });
  if (!same(from.feats, to.feats)) {
    const names = (d: CharacterDoc) => d.feats.map((f) => f.ref.name);
    const { added, removed } = nameDiff(names(from), names(to));
    out.push({
      kind: 'feats',
      line:
        added.length > 0 || removed.length > 0
          ? `Feats: ${signedNames(added, removed)}`
          : 'Feat details',
      structural: true,
    });
  }
  if (from.dataTag !== to.dataTag)
    out.push({
      kind: 'dataTag',
      line: `Data version ${from.dataTag} → ${to.dataTag}`,
      structural: true,
    });

  if (from.name !== to.name)
    out.push({ kind: 'name', line: `Name: "${from.name}" → "${to.name}"`, structural: false });
  if (!same(from.allowedSources, to.allowedSources)) {
    out.push({
      kind: 'sources',
      line: sourcesLine(from.allowedSources, to.allowedSources),
      structural: false,
    });
  }
  abilityChanges(out, from, to);
  const keys = new Set([...Object.keys(from.choices), ...Object.keys(to.choices)]);
  const differing = [...keys].filter((k) => !same(from.choices[k], to.choices[k])).length;
  if (differing > 0)
    out.push({
      kind: 'choices',
      line: differing === 1 ? '1 choice differs' : `${differing} choices differ`,
      structural: false,
    });
  equipmentChanges(out, from, to);
  spellChanges(out, from, to);
  if (!same(from.customEffects, to.customEffects))
    out.push({
      kind: 'modifiers',
      line:
        from.customEffects.length !== to.customEffects.length
          ? `Modifiers ${from.customEffects.length} → ${to.customEffects.length}`
          : 'Modifiers edited',
      structural: false,
    });
  const paths = new Set([...Object.keys(from.overrides), ...Object.keys(to.overrides)]);
  for (const path of [...paths].sort()) {
    const a = from.overrides[path as keyof CharacterDoc['overrides']];
    const b = to.overrides[path as keyof CharacterDoc['overrides']];
    if (same(a, b)) continue;
    out.push({
      kind: 'overrides',
      line:
        a?.value !== b?.value
          ? `${path} override ${a?.value ?? 'none'} → ${b?.value ?? 'none'}`
          : `${path} override note`,
      structural: false,
    });
  }
  if (from.notes !== to.notes) out.push({ kind: 'notes', line: 'Notes edited', structural: false });

  playChanges(out, from, to);

  // Nothing above could name it, but the content still differs: say so rather
  // than report "no differences" for a snapshot that would change something.
  if (out.length === 0 && !sameContent(from, to))
    out.push({ kind: 'other', line: 'Other details differ', structural: true });
  return out;
}

/**
 * Which rapid edits a step can merge with: the sorted families it touched, or
 * undefined when it cannot merge at all (nothing changed, or it reshaped the
 * character).
 */
export function burstKey(changes: DocChange[]): string | undefined {
  if (changes.length === 0) return undefined;
  const families = new Set<string>();
  for (const c of changes) {
    const family = FAMILY[c.kind];
    if (c.structural || family === undefined) return undefined;
    families.add(family);
  }
  return [...families].sort().join('+');
}

/** The first `max` lines, then "…and N more". */
export function summarizeChanges(changes: DocChange[], max = 12): string[] {
  const lines = changes.map((c) => c.line);
  return lines.length > max ? [...lines.slice(0, max), `…and ${lines.length - max} more`] : lines;
}
