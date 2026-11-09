/**
 * A Fight Club 5e `<item>` into a 5etools item. The weapon and armor columns
 * map almost one to one (type, damage, properties, AC, strength, stealth);
 * rarity and attunement come from `<detail>`; flat bonuses from `<modifier>`.
 */
import { childElements, childText, childTexts, textContent, type XmlElement } from '../xml';
import { citationEntry, type Fc5Context, type Fc5Result, placeEntity } from './context';
import { abilityKey, entryName, own, plainText, readText, SKILLS } from './text';

/** Fight Club type codes the 5etools data shares as they are. */
const SAME_TYPES = new Set([
  'LA',
  'MA',
  'HA',
  'S',
  'M',
  'R',
  'A',
  'RD',
  'WD',
  'RG',
  'P',
  'SC',
  'G',
  '$',
]);

/** Fight Club damage codes where 5etools differs: force, poison, psychic. */
const DAMAGE_CODES: Record<string, string> = { FC: 'O', PS: 'I', PY: 'Y' };

/** Properties Fight Club and 5etools spell the same. `M` (martial) is a category instead. */
const PROPERTIES = new Set(['A', 'F', 'H', 'L', 'LD', 'R', 'S', 'T', '2H', 'V']);

const RARITY = /\b(very rare|uncommon|common|rare|legendary|artifact|varies|unknown rarity)\b/i;

/** "rare (requires attunement by a cleric)" into a rarity and the attunement 5etools records. */
export function readDetail(detail: string): { rarity?: string; reqAttune?: true | string } {
  const out: { rarity?: string; reqAttune?: true | string } = {};
  const rarity = RARITY.exec(detail)?.[1];
  if (rarity !== undefined) out.rarity = rarity.toLowerCase();
  const attune = /requires attunement(?:\s+(by [^)]+))?/i.exec(detail);
  if (attune !== null) out.reqAttune = attune[1]?.trim() ?? true;
  return out;
}

/** A signed bonus as 5etools writes it: "+1", "-2". */
function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

interface Bonuses {
  fields: Record<string, unknown>;
  reasons: string[];
}

/** `<modifier category="bonus">melee attacks +1</modifier>` and friends. */
export function readModifiers(el: XmlElement): Bonuses {
  const fields: Record<string, unknown> = {};
  const reasons: string[] = [];
  const weapon: Record<string, number> = {};
  const abilities: Record<string, number> = {};
  const skills = new Map<string, number>();
  for (const mod of childElements(el, 'modifier')) {
    // One space between words, so the pattern below never backtracks over a run.
    const raw = textContent(mod).replace(/\s+/g, ' ').trim();
    const m = /^(.+?)\s*([+-]\s*\d+)$/.exec(raw);
    const what = m?.[1]?.trim().toLowerCase();
    const amount = m?.[2] === undefined ? undefined : Number(m[2].replace(/\s+/g, ''));
    const category = (mod.attrs.category ?? 'bonus').toLowerCase();
    if (what === undefined || amount === undefined || !Number.isFinite(amount)) {
      reasons.push(`the modifier "${raw}" is kept as text`);
      continue;
    }
    if (category === 'ability score') {
      const key = abilityKey(what);
      if (key !== undefined) {
        abilities[key] = (abilities[key] ?? 0) + amount;
        continue;
      }
    }
    if (category === 'skill' && (SKILLS as readonly string[]).includes(what)) {
      skills.set(what, amount);
      continue;
    }
    if (category === 'bonus') {
      if (/^(?:melee|ranged|weapon) (?:attacks?|damage)$/.test(what)) {
        weapon[what.replace(/s$/, '')] = amount;
        continue;
      }
      const field: Record<string, string> = {
        ac: 'bonusAc',
        'armor class': 'bonusAc',
        'saving throws': 'bonusSavingThrow',
        'spell attack': 'bonusSpellAttack',
        'spell dc': 'bonusSpellSaveDc',
        'proficiency bonus': 'bonusProficiencyBonus',
      };
      const key = field[what];
      if (key !== undefined) {
        fields[key] = signed(amount);
        continue;
      }
    }
    reasons.push(`the bonus "${raw}" is kept as text`);
  }

  // One weapon bonus when attack and damage agree, as on a +1 sword. A bonus
  // to damage alone (Bracers of Archery) must not add to the attack roll.
  const attack = weapon['melee attack'] ?? weapon['ranged attack'] ?? weapon['weapon attack'];
  const damage = weapon['melee damage'] ?? weapon['ranged damage'] ?? weapon['weapon damage'];
  const weaponValues = Object.values(weapon);
  if (attack !== undefined && damage !== undefined && weaponValues.every((v) => v === attack)) {
    fields.bonusWeapon = signed(attack);
  } else {
    if (attack !== undefined) fields.bonusWeaponAttack = signed(attack);
    if (damage !== undefined) fields.bonusWeaponDamage = signed(damage);
  }
  if (Object.keys(abilities).length > 0) fields.ability = abilities;

  // The same bonus on every skill is a bonus to ability checks (Stone of Good Luck).
  const skillValues = [...skills.values()];
  const firstSkill = skillValues[0];
  if (
    firstSkill !== undefined &&
    skills.size === SKILLS.length &&
    skillValues.every((v) => v === firstSkill)
  ) {
    fields.bonusAbilityCheck = signed(firstSkill);
  } else if (skills.size > 0) {
    const listed = [...skills].map(([s, v]) => `${s} ${signed(v)}`).join(', ');
    reasons.push(`skill bonuses (${listed}) are kept as text`);
  }
  return { fields, reasons };
}

const MASTERIES = ['Cleave', 'Graze', 'Nick', 'Push', 'Sap', 'Slow', 'Topple', 'Vex'];

/**
 * Fight Club types every tool, instrument, mount and trade good as plain gear
 * (`G`) and says what it is in `<detail>`; 5etools has a type for each, which
 * the sheet's tool proficiencies and labels read.
 */
const GEAR_KINDS: readonly [RegExp, string][] = [
  [/\bartisan'?s? tools?\b/i, 'AT'],
  [/\b(?:musical )?instrument\b/i, 'INS'],
  [/\bgaming set\b/i, 'GS'],
  [/\b(?:arcane|druidic) focus\b|\bholy symbol\b|\bspellcasting focus\b/i, 'SCF'],
  [/\btack and harness\b/i, 'TAH'],
  [/\bfood and drink\b/i, 'FD'],
  [/\btrade good\b/i, 'TG'],
  [/\bmount\b/i, 'MNT'],
  [/\bvehicle \(water\)/i, 'SHP'],
  [/\bvehicle \(air\)/i, 'AIR'],
  [/\bvehicle\b/i, 'VEH'],
  [/\bexplosive\b/i, 'EXP'],
  [/^tools?\b/i, 'T'],
];

function gearKind(detail: string): string | undefined {
  return GEAR_KINDS.find(([pattern]) => pattern.test(detail))?.[1];
}

export function convertItem(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const reasons: string[] = [];
  const named = entryName(rawName);
  const text = readText(childTexts(el, 'text'));
  const placement = ctx.place(text.sourceLine, named.edition);
  const edition = placement.edition;

  const item: Record<string, unknown> = { name: named.name };
  placeEntity(item, placement);

  const type = (childText(el, 'type') ?? '').toUpperCase();
  const rawDetail = childText(el, 'detail') ?? '';
  const codes = (childText(el, 'property') ?? '')
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p !== '');
  let dmg1 = childText(el, 'dmg1');
  let dmg2 = childText(el, 'dmg2');
  let dmgType = (childText(el, 'dmgtype') ?? '').toUpperCase();
  const poison = /^poison\b(?:\s*\(([a-z]+)\))?/i.exec(rawDetail);
  if (type === 'P' && poison !== null) {
    // 5etools files poisons as gear marked `poison`, not as potions.
    item.type = 'G';
    item.poison = true;
    if (poison[1] !== undefined) item.poisonTypes = [poison[1].toLowerCase()];
  } else if (type === 'G' || type === '') {
    const kind = gearKind(rawDetail);
    if (kind !== undefined) item.type = kind;
    else if (type === 'G') item.type = 'G';
  } else if (type === '$') item.type = '$C';
  else if (SAME_TYPES.has(type)) item.type = type;
  else if (type === 'W') item.wondrous = true;
  else if (type === 'ST') {
    // A Fight Club staff that has weapon traits is a quarterstaff, as the
    // magic staffs are; its file often leaves the dice to that convention.
    item.staff = true;
    if (dmg1 !== undefined || dmgType !== '' || codes.includes('V')) {
      item.type = 'M';
      dmg1 ??= '1d6';
      if (codes.includes('V')) dmg2 ??= '1d8';
      if (dmgType === '') dmgType = 'B';
    } else item.type = 'SCF';
  } else reasons.push(`its type "${type}" is not one this app knows`);

  // Fight Club's 2014 SRD gives mundane gear a rarity word ("common"), so a
  // rarity counts only for an item that is magic: marked so, needing
  // attunement, or of a kind that always is (wondrous items, rings, rods,
  // wands, potions, scrolls), unless it is a plain spellcasting focus (a wand
  // or staff an arcane caster holds).
  const magicText = (childText(el, 'magic') ?? '').toUpperCase();
  const detail = readDetail(rawDetail);
  const focus = gearKind(rawDetail) === 'SCF';
  const magic =
    magicText === 'YES' ||
    magicText === '1' ||
    detail.reqAttune !== undefined ||
    (['W', 'RG', 'RD', 'WD', 'P', 'SC'].includes(type) && item.poison !== true && !focus);
  if (magic) item.rarity = detail.rarity ?? 'unknown (magic)';
  else item.rarity = 'none';
  if (detail.reqAttune !== undefined) item.reqAttune = detail.reqAttune;

  const weight = Number(childText(el, 'weight'));
  if (Number.isFinite(weight) && weight > 0) item.weight = weight;
  // Fight Club prices in gold pieces; 5etools in copper, fractions allowed
  // (a sling bullet is 0.2 cp).
  const value = Number(childText(el, 'value'));
  if (Number.isFinite(value) && value > 0) item.value = Number((value * 100).toFixed(4));

  const ac = Number(childText(el, 'ac'));
  if (Number.isInteger(ac) && ac > 0) item.ac = ac;
  const strength = childText(el, 'strength');
  if (strength !== undefined && /^\d+$/.test(strength)) item.strength = strength;
  const stealth = (childText(el, 'stealth') ?? '').toUpperCase();
  if (stealth === 'YES' || stealth === '1') item.stealth = true;

  if (dmg1 !== undefined) item.dmg1 = dmg1.replace(/\s+/g, '');
  if (dmg2 !== undefined) item.dmg2 = dmg2.replace(/\s+/g, '');
  if (dmgType !== '' && (dmg1 !== undefined || dmg2 !== undefined)) {
    item.dmgType = own(DAMAGE_CODES, dmgType) ?? dmgType;
  }

  const properties = codes.filter((p) => PROPERTIES.has(p));
  if (properties.length > 0) item.property = properties;
  const unknown = codes.filter((p) => p !== 'M' && !PROPERTIES.has(p));
  if (unknown.length > 0) reasons.push(`unknown weapon properties ${unknown.join(', ')}`);

  const prose = plainText(text.entries);
  const isWeapon = item.type === 'M' || item.type === 'R';
  if (isWeapon) {
    // The raw text, not `prose`: a "Proficiency: martial" line on its own is
    // a named entry there, and its colon is gone.
    const martial =
      codes.includes('M') ||
      childTexts(el, 'text').some((t) => /\bProficiency:\s*martial\b/i.test(t));
    item.weaponCategory = martial ? 'martial' : 'simple';
    const mastery = MASTERIES.find((m) => new RegExp(`\\b${m} \\(Mastery\\)`).test(prose));
    if (mastery !== undefined) item.mastery = [`${mastery}|XPHB`];
  }
  const range = childText(el, 'range');
  if (range !== undefined && /^\d+\/\d+$/.test(range.replace(/\s+/g, ''))) {
    item.range = range.replace(/\s+/g, '');
  }

  const bonuses = readModifiers(el);
  Object.assign(item, bonuses.fields);
  reasons.push(...bonuses.reasons);

  item.entries = text.entries;
  const citation = citationEntry(placement);
  if (citation !== undefined) (item.entries as unknown[]).push(citation);
  if ((item.entries as unknown[]).length === 0) delete item.entries;

  return { kind: 'item', name: named.name, edition, entity: item, placement, reasons };
}
