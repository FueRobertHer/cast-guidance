/**
 * 5etools `additionalSpells` — innate / always-known spells granted by races,
 * feats, and subraces. Format (simplified):
 *   [{ ability: "cha" | { choose: [...] },
 *      known:  { "1": ["thaumaturgy"], "_": [...] },
 *      innate: { "3": { daily: { "1": ["hellish rebuke"] } } } }]
 * Level keys gate by character level. `{ choose: "..." }` filter grants need a
 * picker we don't build yet — those surface as a note.
 */
import { ABILITIES, type Ability, type EffectOrigin } from '../types';
import { asEntityArray, type Collector } from './base';

function totalLevelOf(col: Collector): number {
  return col.doc.classes.reduce((s, c) => s + c.levels, 0);
}

function parseSpellRef(s: string): { name: string; source: string } {
  // 5etools appends a cast-level hint like "hellish rebuke#2" or "guidance#c".
  const [namePart, source] = s.split('|');
  const name = (namePart ?? s).split('#')[0]?.trim() ?? s;
  return { name, source: source ?? '' };
}

/** Push plain spell-name strings, skipping `{choose}` filter objects. */
function collectStrings(val: unknown, out: string[], sawChoose: { v: boolean }): void {
  if (typeof val === 'string') {
    out.push(val);
  } else if (Array.isArray(val)) {
    for (const v of val) collectStrings(v, out, sawChoose);
  } else if (val !== null && typeof val === 'object') {
    if ('choose' in val) {
      sawChoose.v = true;
      return;
    }
    for (const v of Object.values(val)) collectStrings(v, out, sawChoose);
  }
}

function gatherByLevel(map: unknown, totalLevel: number, out: string[], sawChoose: { v: boolean }) {
  if (map === null || typeof map !== 'object') return;
  for (const [key, val] of Object.entries(map)) {
    const gate = key === '_' ? 0 : Number.parseInt(key, 10);
    if (!Number.isNaN(gate) && gate <= totalLevel) collectStrings(val, out, sawChoose);
  }
}

export function collectAdditionalSpells(col: Collector, raw: unknown, origin: EffectOrigin): void {
  const entries = asEntityArray(raw);
  if (entries.length === 0) return;
  const totalLevel = totalLevelOf(col);

  for (const entry of entries) {
    let ability: Ability | undefined;
    const ab = entry.ability;
    if (typeof ab === 'string' && (ABILITIES as readonly string[]).includes(ab)) {
      ability = ab as Ability;
    } else if (
      ab !== null &&
      typeof ab === 'object' &&
      Array.isArray((ab as { choose?: unknown[] }).choose)
    ) {
      const opts = (ab as { choose: unknown[] }).choose.map(String);
      ability = opts[0] as Ability | undefined; // reasonable default; note the rest
      col.warn(`${origin.label}: spellcasting ability is your choice of ${opts.join('/')}.`);
    }

    const names: string[] = [];
    const sawChoose = { v: false };
    gatherByLevel(entry.known, totalLevel, names, sawChoose);
    gatherByLevel(entry.innate, totalLevel, names, sawChoose);

    for (const name of new Set(names)) {
      col.add({ kind: 'grantSpell', spell: parseSpellRef(name), ability, origin });
    }
    if (sawChoose.v) {
      col.warn(`${origin.label}: also lets you choose a spell — see the trait text.`);
    }
  }
}
