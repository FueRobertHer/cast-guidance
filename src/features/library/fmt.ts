/** Tolerant display formatting for 5etools entity fields. */
import type { Entity } from '@/data5e/copyMod';

export const DMG_TYPES: Record<string, string> = {
  A: 'acid',
  B: 'bludgeoning',
  C: 'cold',
  F: 'fire',
  O: 'force',
  L: 'lightning',
  N: 'necrotic',
  P: 'piercing',
  I: 'poison',
  Y: 'psychic',
  R: 'radiant',
  S: 'slashing',
  T: 'thunder',
};

export const SCHOOLS: Record<string, string> = {
  A: 'Abjuration',
  C: 'Conjuration',
  D: 'Divination',
  E: 'Enchantment',
  V: 'Evocation',
  I: 'Illusion',
  N: 'Necromancy',
  T: 'Transmutation',
  P: 'Psionic',
};

const ABILITIES: Record<string, string> = {
  str: 'Str',
  dex: 'Dex',
  con: 'Con',
  int: 'Int',
  wis: 'Wis',
  cha: 'Cha',
};

export function spellLevel(level: unknown): string {
  if (level === 0) return 'Cantrip';
  if (typeof level !== 'number') return '?';
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th';
  return `${level}${suffix} level`;
}

export function castingTime(time: unknown): string {
  if (!Array.isArray(time) || time.length === 0) return '?';
  const t = time[0] as { number?: number; unit?: string };
  return `${t.number ?? 1} ${t.unit ?? ''}`.trim();
}

export function spellRange(range: unknown): string {
  if (typeof range !== 'object' || range === null) return '?';
  const r = range as { type?: string; distance?: { type?: string; amount?: number } };
  const d = r.distance;
  if (d === undefined) return r.type ?? '?';
  if (d.type === 'self' || d.type === 'touch' || d.type === 'sight' || d.type === 'unlimited') {
    return d.type.charAt(0).toUpperCase() + d.type.slice(1);
  }
  const dist = `${d.amount ?? ''} ${d.type ?? ''}`.trim();
  return r.type === 'point' ? dist : `Self (${dist} ${r.type})`;
}

export function spellComponents(comp: unknown): string {
  if (typeof comp !== 'object' || comp === null) return '?';
  const c = comp as { v?: boolean; s?: boolean; m?: unknown };
  const parts: string[] = [];
  if (c.v) parts.push('V');
  if (c.s) parts.push('S');
  if (c.m !== undefined && c.m !== false) {
    const text =
      typeof c.m === 'string'
        ? c.m
        : typeof c.m === 'object'
          ? (c.m as { text?: string }).text
          : undefined;
    parts.push(text !== undefined ? `M (${text})` : 'M');
  }
  return parts.join(', ') || '—';
}

export function spellDuration(duration: unknown): string {
  if (!Array.isArray(duration) || duration.length === 0) return '?';
  const d = duration[0] as {
    type?: string;
    duration?: { type?: string; amount?: number };
    concentration?: boolean;
  };
  if (d.type === 'instant') return 'Instantaneous';
  if (d.type === 'permanent') return 'Permanent';
  if (d.type === 'special') return 'Special';
  const inner = d.duration;
  const base =
    inner !== undefined
      ? `${inner.amount ?? ''} ${inner.type ?? ''}${(inner.amount ?? 0) > 1 ? 's' : ''}`.trim()
      : (d.type ?? '?');
  return d.concentration === true ? `Concentration, up to ${base}` : base;
}

export function abilitySummary(ability: unknown): string {
  if (!Array.isArray(ability) || ability.length === 0) return '';
  const parts: string[] = [];
  for (const entry of ability) {
    if (typeof entry !== 'object' || entry === null) continue;
    for (const [k, v] of Object.entries(entry)) {
      if (k === 'choose') {
        const c = v as { from?: unknown[]; count?: number; amount?: number };
        parts.push(
          `Choose ${c.count ?? 1} +${c.amount ?? 1}${
            Array.isArray(c.from) && c.from.length < 6
              ? ` (${c.from
                  .map(String)
                  .map((a) => ABILITIES[a] ?? a)
                  .join('/')})`
              : ''
          }`,
        );
      } else if (typeof v === 'number') {
        parts.push(`${ABILITIES[k] ?? k} ${v >= 0 ? '+' : ''}${v}`);
      }
    }
  }
  return parts.join(', ');
}

export function speedSummary(speed: unknown): string {
  if (typeof speed === 'number') return `${speed} ft.`;
  if (typeof speed !== 'object' || speed === null) return '?';
  return Object.entries(speed as Record<string, unknown>)
    .map(([k, v]) => `${k === 'walk' ? '' : `${k} `}${typeof v === 'number' ? v : '?'} ft.`)
    .join(', ');
}

export function itemValue(value: unknown): string | undefined {
  if (typeof value !== 'number') return undefined;
  if (value >= 100) return `${value / 100} gp`;
  if (value >= 10) return `${value / 10} sp`;
  return `${value} cp`;
}

export function itemDamage(e: Entity): string | undefined {
  const dmg1 = e.dmg1;
  if (typeof dmg1 !== 'string') return undefined;
  const type = typeof e.dmgType === 'string' ? (DMG_TYPES[e.dmgType] ?? e.dmgType) : '';
  return `${dmg1} ${type}`.trim();
}

/** [label, value] fact rows for the detail header, per entity type. */
export function headerFacts(type: string, e: Entity): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  const push = (label: string, value: string | undefined) => {
    if (value !== undefined && value !== '') facts.push([label, value]);
  };
  switch (type) {
    case 'spell':
      push('Level', spellLevel(e.level));
      push('School', typeof e.school === 'string' ? (SCHOOLS[e.school] ?? e.school) : undefined);
      push('Casting time', castingTime(e.time));
      push('Range', spellRange(e.range));
      push('Components', spellComponents(e.components));
      push('Duration', spellDuration(e.duration));
      break;
    case 'item':
    case 'baseitem':
      push('Rarity', typeof e.rarity === 'string' && e.rarity !== 'none' ? e.rarity : undefined);
      push('Type', typeof e.type === 'string' ? e.type.split('|')[0] : undefined);
      push('AC', typeof e.ac === 'number' ? String(e.ac) : undefined);
      push('Damage', itemDamage(e));
      push('Weight', typeof e.weight === 'number' ? `${e.weight} lb.` : undefined);
      push('Value', itemValue(e.value));
      push(
        'Attunement',
        e.reqAttune !== undefined
          ? e.reqAttune === true
            ? 'required'
            : String(e.reqAttune)
          : undefined,
      );
      break;
    case 'race':
    case 'subrace':
      push('Ability', abilitySummary(e.ability));
      push('Size', Array.isArray(e.size) ? e.size.map(String).join(', ') : undefined);
      push('Speed', e.speed !== undefined ? speedSummary(e.speed) : undefined);
      push('Darkvision', typeof e.darkvision === 'number' ? `${e.darkvision} ft.` : undefined);
      break;
    case 'class': {
      const hd = e.hd as { number?: number; faces?: number } | undefined;
      push('Hit die', hd !== undefined ? `d${hd.faces ?? '?'}` : undefined);
      const prof = e.proficiency;
      push(
        'Saves',
        Array.isArray(prof)
          ? prof.map((p) => ABILITIES[String(p)] ?? String(p)).join(', ')
          : undefined,
      );
      push(
        'Spellcasting',
        typeof e.spellcastingAbility === 'string'
          ? (ABILITIES[e.spellcastingAbility] ?? e.spellcastingAbility)
          : undefined,
      );
      push(
        'Caster type',
        typeof e.casterProgression === 'string' ? e.casterProgression : undefined,
      );
      push(
        'Edition',
        typeof e.edition === 'string' ? (e.edition === 'one' ? '2024' : '2014') : undefined,
      );
      break;
    }
    case 'feat': {
      const cat = e.category;
      push('Category', typeof cat === 'string' ? cat : undefined);
      break;
    }
    default:
      break;
  }
  return facts;
}
