/** Short human labels for character history snapshots. */
import type { CharacterDoc } from '@/engine/types';

/** Multiset difference of two display-name lists. */
function nameDiff(prev: string[], next: string[]): { added: string[]; removed: string[] } {
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
function firstWithMore(names: string[]): string {
  const first = names[0] ?? '';
  return names.length > 1 ? `${first} +${names.length - 1} more` : first;
}

function equipmentLabel(prev: CharacterDoc, next: CharacterDoc): string | undefined {
  const nameOf = (e: CharacterDoc['equipment'][number]) => e.ref?.name ?? e.custom?.name ?? 'item';
  const { added, removed } = nameDiff(prev.equipment.map(nameOf), next.equipment.map(nameOf));
  if (added.length > 0 && removed.length > 0) return `Gear: +${added[0]} −${removed[0]}`;
  if (added.length > 0) return `Added ${firstWithMore(added)}`;
  if (removed.length > 0) return `Removed ${firstWithMore(removed)}`;
  // Same items — only qty/equipped/attuned/location changed.
  if (JSON.stringify(prev.equipment) !== JSON.stringify(next.equipment)) return 'Equipment';
  return undefined;
}

function spellNames(doc: CharacterDoc): { known: string[]; prepared: string[] } {
  const known: string[] = [];
  const prepared: string[] = [];
  for (const block of Object.values(doc.spellcasting)) {
    for (const s of block.known) known.push(s.name);
    for (const s of block.prepared) prepared.push(s.name);
  }
  return { known, prepared };
}

function spellsLabel(prev: CharacterDoc, next: CharacterDoc): string | undefined {
  if (JSON.stringify(prev.spellcasting) === JSON.stringify(next.spellcasting)) return undefined;
  const p = spellNames(prev);
  const n = spellNames(next);
  const prep = nameDiff(p.prepared, n.prepared);
  if (prep.added.length > 0) return `Prepared ${firstWithMore(prep.added)}`;
  if (prep.removed.length > 0) return `Unprepared ${firstWithMore(prep.removed)}`;
  const kn = nameDiff(p.known, n.known);
  if (kn.added.length > 0) return `Learned ${firstWithMore(kn.added)}`;
  if (kn.removed.length > 0) return `Unlearned ${firstWithMore(kn.removed)}`;
  return 'Spells';
}

function conditionsLabel(prev: CharacterDoc, next: CharacterDoc): string | undefined {
  const ids = (doc: CharacterDoc) => doc.play.conditions.map((c) => c.id);
  const { added, removed } = nameDiff(ids(prev), ids(next));
  if (added.length > 0) return `${firstWithMore(added)} added`;
  if (removed.length > 0) return `${firstWithMore(removed)} removed`;
  // Same set of conditions — a level changed (e.g. Exhaustion 2 → 3). Without
  // this, a level bump is invisible (ids match here, and `otherPlayChanged`
  // strips conditions), so it would mislabel as "Edited".
  const prevLevel = new Map(prev.play.conditions.map((c) => [c.id, c.level]));
  for (const c of next.play.conditions) {
    if (c.level !== prevLevel.get(c.id)) return `${c.id} → ${c.level ?? 0}`;
  }
  return undefined;
}

/** True when play state changed in a way not already captured by HP or conditions. */
function otherPlayChanged(prev: CharacterDoc, next: CharacterDoc): boolean {
  const strip = (play: CharacterDoc['play']): Record<string, unknown> => {
    const clone: Record<string, unknown> = { ...play };
    delete clone.currentHp;
    delete clone.conditions;
    return clone;
  };
  return JSON.stringify(strip(prev.play)) !== JSON.stringify(strip(next.play));
}

export function historyLabel(prev: CharacterDoc | undefined, next: CharacterDoc): string {
  if (prev === undefined) return 'Snapshot';
  const labels: string[] = [];

  if (prev.name !== next.name) labels.push(`Renamed to ${next.name}`);
  if (prev.rulesVersion !== next.rulesVersion) labels.push(`Rules → ${next.rulesVersion}`);

  // Classes: level changes / additions / removals / subclass
  const prevByUid = new Map(prev.classes.map((c) => [`${c.ref.name}|${c.ref.source}`, c]));
  for (const c of next.classes) {
    const uid = `${c.ref.name}|${c.ref.source}`;
    const p = prevByUid.get(uid);
    if (p === undefined) labels.push(`Added ${c.ref.name}`);
    else {
      if (p.levels !== c.levels)
        labels.push(
          c.levels > p.levels
            ? `Level up: ${c.ref.name} ${c.levels}`
            : `${c.ref.name} → ${c.levels}`,
        );
      if (p.subclass?.name !== c.subclass?.name)
        labels.push(c.subclass !== undefined ? `Subclass: ${c.subclass.name}` : 'Subclass cleared');
      prevByUid.delete(uid);
    }
  }
  for (const [, p] of prevByUid) labels.push(`Removed ${p.ref.name}`);

  if (prev.race?.name !== next.race?.name) labels.push(`Race: ${next.race?.name ?? 'none'}`);
  if (prev.subrace?.name !== next.subrace?.name)
    labels.push(`Subrace: ${next.subrace?.name ?? 'none'}`);
  if (prev.background?.name !== next.background?.name)
    labels.push(`Background: ${next.background?.name ?? 'none'}`);
  if ((prev.hpMethod ?? 'average') !== (next.hpMethod ?? 'average'))
    labels.push(`HP rule: ${next.hpMethod ?? 'average'}`);

  if (JSON.stringify(prev.abilities) !== JSON.stringify(next.abilities))
    labels.push('Ability scores');
  if (Object.keys(prev.choices).length !== Object.keys(next.choices).length) labels.push('Choices');
  else if (JSON.stringify(prev.choices) !== JSON.stringify(next.choices)) labels.push('Choices');

  const eq = equipmentLabel(prev, next);
  if (eq !== undefined) labels.push(eq);
  const sp = spellsLabel(prev, next);
  if (sp !== undefined) labels.push(sp);

  if (JSON.stringify(prev.overrides) !== JSON.stringify(next.overrides)) labels.push('Overrides');
  if (JSON.stringify(prev.customEffects) !== JSON.stringify(next.customEffects))
    labels.push('Modifiers');
  if (prev.notes !== next.notes) labels.push('Notes');

  // Play state — most frequent; keep it specific for HP and conditions.
  if (prev.play.currentHp !== next.play.currentHp)
    labels.push(`HP ${prev.play.currentHp}→${next.play.currentHp}`);
  const cond = conditionsLabel(prev, next);
  if (cond !== undefined) labels.push(cond);
  if (otherPlayChanged(prev, next)) labels.push('Play state');

  if (labels.length === 0) return 'Edited';
  return labels.slice(0, 3).join(' · ') + (labels.length > 3 ? ' · …' : '');
}
