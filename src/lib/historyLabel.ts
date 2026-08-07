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

/**
 * True when play state changed at all, ignoring what HP and conditions already
 * report and the `hpInitialized` bookkeeping flag the reader can't act on.
 *
 * Deliberately NOT a list of "everything playLabels doesn't name": such a list
 * has to be edited in lockstep with playLabels, and getting it wrong silently
 * hides changes. The caller pairs this with playLabels instead, so 'Play state'
 * fires exactly when something moved that nothing else managed to name.
 */
function playChanged(prev: CharacterDoc, next: CharacterDoc): boolean {
  const strip = (play: CharacterDoc['play']): Record<string, unknown> => {
    const clone: Record<string, unknown> = { ...play };
    delete clone.currentHp;
    delete clone.conditions;
    delete clone.hpInitialized;
    return clone;
  };
  return JSON.stringify(strip(prev.play)) !== JSON.stringify(strip(next.play));
}

/** 'relentless-endurance' -> 'relentless endurance'. Resource keys are kebab-case. */
function humanKey(key: string): string {
  return key.replace(/-/g, ' ');
}

/** The first spell-slot level whose spent count moved, as a spent/regained label. */
function slotsLabel(prev: CharacterDoc, next: CharacterDoc): string | undefined {
  const p = prev.play.slotsSpent;
  const n = next.play.slotsSpent;
  for (let i = 0; i < Math.max(p.length, n.length); i++) {
    const was = p[i] ?? 0;
    const now = n[i] ?? 0;
    if (was !== now) return `${now > was ? 'Spent' : 'Regained'} a level ${i + 1} slot`;
  }
  return undefined;
}

function hitDiceLabel(prev: CharacterDoc, next: CharacterDoc): string | undefined {
  const p = prev.play.hitDiceSpent;
  const n = next.play.hitDiceSpent;
  for (const die of new Set([...Object.keys(p), ...Object.keys(n)])) {
    const was = p[die] ?? 0;
    const now = n[die] ?? 0;
    if (was !== now) return `${now > was ? 'Spent' : 'Regained'} a hit die (${die})`;
  }
  return undefined;
}

function resourcesLabel(prev: CharacterDoc, next: CharacterDoc): string | undefined {
  const used = (doc: CharacterDoc) =>
    new Map(doc.play.resources.map((r) => [r.key, r.used] as const));
  const p = used(prev);
  const n = used(next);
  for (const key of new Set([...p.keys(), ...n.keys()])) {
    const was = p.get(key) ?? 0;
    const now = n.get(key) ?? 0;
    if (was !== now) {
      return now > was ? `Used ${humanKey(key)}` : `Restored ${humanKey(key)}`;
    }
  }
  return undefined;
}

function deathSavesLabel(prev: CharacterDoc, next: CharacterDoc): string | undefined {
  const p = prev.play.deathSaves;
  const n = next.play.deathSaves;
  if (p.success === n.success && p.fail === n.fail) return undefined;
  if (n.success === 0 && n.fail === 0) return 'Death saves cleared';
  if (n.fail > p.fail) return `Death save failed (${n.fail}/3)`;
  if (n.success > p.success) return `Death save succeeded (${n.success}/3)`;
  // A pip was un-ticked. Spell it out: "1/2" reads as "1 of 2", not 1 up 2 down.
  return `Death saves ${n.success} ok / ${n.fail} failed`;
}

/**
 * Specific labels for the play-state fields that change most often. These are
 * inferred from the diff, so they cover every caller; a named action (a rest, an
 * attack, a spell) passes an explicit label instead, since the diff alone can't
 * tell a Longsword swing from any other use of your action.
 */
function playLabels(prev: CharacterDoc, next: CharacterDoc): string[] {
  const out: string[] = [];
  const p = prev.play;
  const n = next.play;

  // Ordered by what a player scanning the drawer cares about. historyLabel keeps
  // only the first three and HistoryDrawer truncates, so expiring temp HP must
  // not crowd out the spell slot that went with it.
  const slots = slotsLabel(prev, next);
  if (slots !== undefined) out.push(slots);
  if (p.pactSlotsSpent !== n.pactSlotsSpent)
    out.push(n.pactSlotsSpent > p.pactSlotsSpent ? 'Spent a pact slot' : 'Regained a pact slot');

  const dice = hitDiceLabel(prev, next);
  if (dice !== undefined) out.push(dice);
  const res = resourcesLabel(prev, next);
  if (res !== undefined) out.push(res);

  const death = deathSavesLabel(prev, next);
  if (death !== undefined) out.push(death);

  if (p.concentratingOn?.label !== n.concentratingOn?.label)
    out.push(
      n.concentratingOn !== undefined
        ? `Concentrating on ${n.concentratingOn.label}`
        : 'Concentration ended',
    );

  if (p.inspiration !== n.inspiration)
    out.push(n.inspiration ? 'Inspiration gained' : 'Inspiration used');

  if (p.tempHp !== n.tempHp)
    out.push(n.tempHp > p.tempHp ? `+${n.tempHp - p.tempHp} temp HP` : `Temp HP → ${n.tempHp}`);
  if (JSON.stringify(p.currency) !== JSON.stringify(n.currency)) out.push('Currency');
  if (p.xp !== n.xp) out.push(`XP → ${n.xp}`);

  // Turn economy. Clearing slices is NOT inferred as "Turn ended": un-ticking a
  // used pip and pressing End turn produce identical diffs, so the End turn
  // button labels itself and anything reaching here is an undo.
  const pt = p.turn ?? { action: false, bonus: false, reaction: false };
  const nt = n.turn ?? { action: false, bonus: false, reaction: false };
  if (JSON.stringify(pt) !== JSON.stringify(nt)) {
    const slices = ['action', 'bonus', 'reaction'] as const;
    const spent = slices.filter((k) => nt[k] && !pt[k]);
    const freed = slices.filter((k) => pt[k] && !nt[k]);
    if (spent.length > 0) out.push(`Used ${spent.join(' + ')}`);
    else if (freed.length > 0) out.push(`Freed ${freed.join(' + ')}`);
  }

  return out;
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

  // Play state: most frequent, so it stays the most specific.
  if (prev.play.currentHp !== next.play.currentHp)
    labels.push(`HP ${prev.play.currentHp}→${next.play.currentHp}`);
  const cond = conditionsLabel(prev, next);
  if (cond !== undefined) labels.push(cond);
  const named = playLabels(prev, next);
  labels.push(...named);
  // Something moved that nothing above could name: still better than 'Edited'.
  if (named.length === 0 && playChanged(prev, next)) labels.push('Play state');

  if (labels.length === 0) return 'Edited';
  return labels.slice(0, 3).join(' · ') + (labels.length > 3 ? ' · …' : '');
}
