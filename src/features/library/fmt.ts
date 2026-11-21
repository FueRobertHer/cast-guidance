/** Tolerant display formatting for 5etools entity fields. */
import type { Entity } from '@/data5e/copyMod';
import { SPELL_SCHOOLS } from '@/engine/spellQuery';
import { signed } from '@/lib/signed';

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

/**
 * 5etools item-type codes. The names live in `items-base.json`'s `itemType`
 * list, but this runs without the registry, and "Type: M" tells a player
 * nothing. Codes are stable across printings; an unknown one falls through to
 * itself, which is what was shown before.
 */
export const ITEM_TYPES: Record<string, string> = {
  $: 'Treasure',
  $A: 'Treasure (art object)',
  $C: 'Treasure (coinage)',
  $G: 'Treasure (gemstone)',
  A: 'Ammunition',
  AF: 'Ammunition (firearm)',
  AIR: 'Vehicle (air)',
  AT: "Artisan's tools",
  EXP: 'Explosive',
  FD: 'Food and drink',
  G: 'Adventuring gear',
  GS: 'Gaming set',
  GV: 'Generic variant',
  HA: 'Heavy armor',
  INS: 'Instrument',
  LA: 'Light armor',
  M: 'Melee weapon',
  MA: 'Medium armor',
  MNT: 'Mount',
  OTH: 'Other',
  P: 'Potion',
  R: 'Ranged weapon',
  RD: 'Rod',
  RG: 'Ring',
  S: 'Shield',
  SC: 'Scroll',
  SCF: 'Spellcasting focus',
  SHP: 'Vehicle (water)',
  SPC: 'Vehicle (space)',
  T: 'Tool',
  TAH: 'Tack and harness',
  TB: 'Trade bar',
  TG: 'Trade good',
  VEH: 'Vehicle (land)',
  WD: 'Wand',
};

/** Expand an item's `type` field ("M|XPHB") to a readable name. */
export function itemTypeName(type: unknown): string | undefined {
  if (typeof type !== 'string' || type === '') return undefined;
  const code = type.split('|')[0] ?? type;
  return Object.hasOwn(ITEM_TYPES, code) ? ITEM_TYPES[code] : code;
}

export const SCHOOLS = SPELL_SCHOOLS;

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

/**
 * A spell's components as the book lists them. Royalty (`r`) comes last,
 * priced at a gold piece a spell level as 5etools prices it, or the letter
 * alone without a `level`.
 */
export function spellComponents(comp: unknown, level?: unknown): string {
  if (typeof comp !== 'object' || comp === null) return '?';
  const c = comp as { v?: boolean; s?: boolean; m?: unknown; r?: unknown };
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
  if (c.r !== undefined && c.r !== false) {
    parts.push(typeof level === 'number' ? `R (${level} gp)` : 'R');
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
        parts.push(`${ABILITIES[k] ?? k} ${signed(v)}`);
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
  const named = (dice: string, code: unknown) =>
    `${dice} ${typeof code === 'string' ? (DMG_TYPES[code] ?? code) : ''}`.trim();
  // Riders come along so a flaming sword reads as "1d6 slashing + 1d4 fire"
  // wherever the item is browsed, not only on the sheet that swings it.
  const riders = Array.isArray(e.extraDamage) ? e.extraDamage : [];
  return [
    named(dmg1, e.dmgType),
    ...riders.map((r) =>
      typeof r === 'object' && r !== null && typeof (r as Entity).dmg === 'string'
        ? named((r as Entity).dmg as string, (r as Entity).dmgType)
        : '',
    ),
  ]
    .filter((s) => s !== '')
    .join(' + ');
}

/** The common weapon properties by their code; any other is named by the data's own list. */
const PROPERTY_NAMES: Readonly<Record<string, string>> = {
  A: 'Ammunition',
  AF: 'Ammunition',
  BF: 'Burst fire',
  F: 'Finesse',
  H: 'Heavy',
  L: 'Light',
  LD: 'Loading',
  R: 'Reach',
  RLD: 'Reload',
  S: 'Special',
  T: 'Thrown',
  V: 'Versatile',
  '2H': 'Two-handed',
};

/** Names a property code the table above does not know, from the data's own list. */
export type PropertyNamer = (code: string, source: string | undefined) => string | undefined;

/** A `Name|SOURCE` reference's two halves; an object written with a `uid` counts too. */
function refParts(ref: unknown): [string, string | undefined] | undefined {
  const raw =
    typeof ref === 'string'
      ? ref
      : typeof ref === 'object' && ref !== null && typeof (ref as Entity).uid === 'string'
        ? ((ref as Entity).uid as string)
        : undefined;
  if (raw === undefined) return undefined;
  const [name = '', source] = raw.split('|');
  return name.trim() === '' ? undefined : [name.trim(), source];
}

/**
 * A weapon's properties as the book lists them, each with what it needs:
 * Versatile its two-handed die, Ammunition and Thrown their range.
 */
export function weaponProperties(e: Entity, name?: PropertyNamer): string | undefined {
  if (!Array.isArray(e.property)) return undefined;
  const range = typeof e.range === 'string' && e.range !== '' ? e.range : undefined;
  const named = e.property.flatMap((p) => {
    const parts = refParts(p);
    if (parts === undefined) return [];
    const [code, source] = parts;
    const label = PROPERTY_NAMES[code.toUpperCase()] ?? name?.(code, source) ?? code;
    const upper = code.toUpperCase();
    if (upper === 'V' && typeof e.dmg2 === 'string') return [`${label} (${e.dmg2})`];
    if ((upper === 'A' || upper === 'AF' || upper === 'T') && range !== undefined) {
      return [`${label} (range ${range} ft.)`];
    }
    return [label];
  });
  return named.length > 0 ? named.join(', ') : undefined;
}

/** A weapon's mastery properties (2024 rules), by name. */
export function weaponMastery(e: Entity): string | undefined {
  if (!Array.isArray(e.mastery)) return undefined;
  const names = e.mastery.flatMap((m) => {
    const parts = refParts(m);
    return parts === undefined ? [] : [parts[0]];
  });
  return names.length > 0 ? names.join(', ') : undefined;
}

/** "Martial weapon", from a weapon's category. */
function weaponCategory(e: Entity): string | undefined {
  const cat = e.weaponCategory;
  if (typeof cat !== 'string' || cat === '') return undefined;
  return `${cat.charAt(0).toUpperCase()}${cat.slice(1).toLowerCase()} weapon`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * "2014-08-19" -> "19 August 2014", without going through `Date`: the strings
 * in the data are plain calendar dates, and parsing one as a timestamp shifts
 * it a day backwards for anybody west of UTC.
 */
export function publishedDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m === null) return value;
  const month = MONTHS[Number(m[2]) - 1];
  return month === undefined ? value : `${Number(m[3])} ${month} ${m[1]}`;
}

/**
 * [label, value] fact rows for the detail header, per entity type. `property`
 * names a weapon property the common ones leave out, where a registry is to hand.
 */
export function headerFacts(
  type: string,
  e: Entity,
  property?: PropertyNamer,
): Array<[string, string]> {
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
      push('Components', spellComponents(e.components, e.level));
      push('Duration', spellDuration(e.duration));
      break;
    case 'item':
    case 'baseitem':
      push('Rarity', typeof e.rarity === 'string' && e.rarity !== 'none' ? e.rarity : undefined);
      push('Type', itemTypeName(e.type));
      push('Category', weaponCategory(e));
      push('AC', typeof e.ac === 'number' ? String(e.ac) : undefined);
      push('Damage', itemDamage(e));
      push('Properties', weaponProperties(e, property));
      push('Mastery', weaponMastery(e));
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
    case 'book':
      push('Published', publishedDate(e.published));
      push('Author', typeof e.author === 'string' ? e.author : undefined);
      break;
    default:
      break;
  }
  return facts;
}
