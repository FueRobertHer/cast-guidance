/**
 * A Fight Club 5e `<item>` into a 5etools item. The weapon and armor columns
 * map almost one to one (type, damage, properties, AC, strength, stealth);
 * rarity and attunement come from `<detail>`; flat bonuses and speed from
 * `<modifier>`; resistances and immunities from sentences that grant them
 * while you wear or hold the item ({@link itemDefenses}).
 */
import { childElements, childText, childTexts, textContent, type XmlElement } from '../xml';
import { citationEntry, type Fc5Context, type Fc5Result, placeEntity } from './context';
import {
  abilityKey,
  addDefenses,
  DAMAGE_TYPES,
  type Defenses,
  defenseSentence,
  entryName,
  NOT_STANDING,
  own,
  plainText,
  readText,
  SKILLS,
  sentences,
  standingDefenses,
  withRolls,
} from './text';

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
      // Fight Club keeps one speed, the walking one.
      if (what === 'speed') {
        fields.modifySpeed = { bonus: { walk: amount } };
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

const HOLD = '(?:wear|wearing|hold|holding|carry|carrying|wield|wielding|(?:are )?attuned to)';
// A second word is the item's name ("this magic sword"), never "and" or "or",
// so "while you wear this armor and you are raging" keeps its condition, nor
// how or where you hold it ("while wearing this cap underwater, you").
const THE_ITEM =
  "(?:(?:this|the|these) [a-z'-]{1,20}(?: (?!(?:and|or|underwater|upright|aloft|outdoors|indoors|two-handed|one-handed)\\b)[a-z'-]{1,20})?|it|them)";
/** "While the tattoo is on your skin": a worn item's own words for wearing it. */
const ON_YOU = "while (?:this|the|these) [a-z'-]{1,20} (?:is|are) on your skin";

/** A name's characters as a pattern that matches only them. */
function literal(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}

/**
 * The patterns for "while you wear it", with the item's own name among the
 * ways to say "it": "While attuned to Kyrzin's ooze", "while holding Matalotok".
 */
function wearing(name: string) {
  const own = name.length > 0 && name.length <= 60 ? `|${literal(name.toLowerCase())}` : '';
  const it = `(?:${THE_ITEM}${own})`;
  const held = `(?:while (?:you(?:'re| are)? )?${HOLD} ${it}|${ON_YOU})`;
  return {
    /** "While you wear this armor, you …": the rest of the sentence holds while you do. */
    lead: new RegExp(`^(?:(?:in addition|additionally), )?${held},? (?=you )`),
    /** "You have resistance to cold damage while you wear this armor." */
    tail: new RegExp(` ${held}$`),
    /** "While you wear this armor, you gain the following benefits:" over the sentence after it. */
    leadIn: new RegExp(
      `^(?:(?:in addition|additionally), )?(?:${held},? you gain the following (?:benefits|properties)|you gain the following (?:benefits|properties) ${held})$`,
    ),
  };
}
const DAMAGE_WORDS = `(?:${DAMAGE_TYPES.join('|')})(?:(?:,| and|, and) (?:${DAMAGE_TYPES.join('|')})){0,12}`;
/** "resistance to the following damage types: necrotic, poison, and psychic" said in one clause. */
const FOLLOWING_TYPES = new RegExp(
  `(resistance|immunity) to the following damage types: (${DAMAGE_WORDS})$`,
);
/** Words that make a whole sentence last only a while, whichever clause says them. */
const PASSING = /\b(?:until|lose|loses|no longer|minutes?|hours?|rounds?|duration|instead)\b/;

/**
 * The clauses of a sentence that holds while you wear the item: "you gain a
 * +3 bonus to AC, you are immune to fire damage, and you can understand and
 * speak Primordial" reads as three, the last no defense or bonus. A sentence
 * that opens on anything but "you" ("While raging, you", "If the wand has a
 * charge, you") has terms over all of it and gives none; a clause `reads`
 * does not take that sets terms ("you are raging", "you can use a bonus
 * action") ends the clauses read, since those after it may hang on it.
 */
function heldClauses(body: string, reads: (clause: string) => boolean): string[] {
  const clauses = body.split(/,? and (?=you )|, (?=you )/);
  if (!clauses[0]?.startsWith('you ')) return [];
  const out: string[] = [];
  for (const clause of clauses) {
    if (reads(clause)) out.push(clause);
    else if (NOT_STANDING.test(clause)) break;
  }
  return out;
}

/**
 * The defenses of a sentence that holds while you wear the item, clause by
 * clause ({@link heldClauses}); a word that makes any of it pass
 * ({@link PASSING}) reads none of it.
 */
function heldDefenses(body: string): Defenses | undefined {
  if (PASSING.test(body)) return undefined;
  let out: Defenses = {};
  for (const clause of heldClauses(body, (c) => defenseSentence(c) !== undefined)) {
    out = addDefenses(out, defenseSentence(clause));
  }
  return out;
}

/**
 * The parts of an item's text that hold while you wear, hold or are attuned
 * to it, without the words that say so: a sentence that says so itself ("you
 * have resistance to cold damage while you wear this armor", "while attuned to
 * Kyrzin's ooze, you have"), or one right after "while you wear this armor,
 * you gain the following benefits". What follows "When you attune to it,
 * choose one of the following:" hangs on that choice and is not read. `trim`
 * takes words off the end of a part before its "while you wear it" is looked for.
 */
function heldParts(
  prose: string,
  name: string,
  trim: (part: string) => string = (p) => p,
): string[] {
  const held = wearing(name);
  const out: string[] = [];
  let leadIn = false;
  for (const sentence of sentences(prose)) {
    const parts = sentence.replace(FOLLOWING_TYPES, '$1 to $2 damage').split(': ');
    for (const [i, raw] of parts.entries()) {
      const part = raw.replace(/[.:]$/, '');
      const lead = held.lead.exec(part);
      const rest = trim(lead === null ? part : part.slice(lead[0].length));
      const tail = held.tail.exec(rest);
      const body = tail === null ? rest : rest.slice(0, tail.index);
      if (lead !== null || tail !== null || leadIn) out.push(body);
      leadIn = held.leadIn.test(part);
      if (i < parts.length - 1 && !leadIn && NOT_STANDING.test(part)) break;
    }
  }
  return out;
}

/**
 * The resistances and immunities an item's text gives while you wear, hold or
 * are attuned to it ({@link heldParts}), in the book's own words
 * ({@link defenseSentence}). A defense the text gives only at other times (for
 * an hour, in a dormant state, as one of a choice) stays in the text. `name`
 * is the item's.
 */
export function itemDefenses(prose: string, name = ''): Defenses {
  let out: Defenses = {};
  for (const body of heldParts(prose, name)) out = addDefenses(out, heldDefenses(body));
  return out;
}

/**
 * "If you are wearing no armor and using no shield": the terms Bracers of
 * Defense set on their bonus, which the sheet, like the official data, leaves
 * to the reader.
 */
const NO_ARMOR =
  /,? (?:if|while) you (?:(?:are wearing|wear) no armor(?:,? and (?:are )?(?:using|use) no shield)?|(?:aren't|are not|do not|don't) (?:wearing|wear) armor(?:,? or (?:using|use) a shield)?)(?: at the same time)?$/;
/**
 * "You gain a +2 bonus to AC", alone or before what else it is a bonus to:
 * "and to saving throws", ", saving throws, and spell attack rolls".
 */
const AC_BONUS =
  /^you (?:have|gain) an? \+([1-5]) bonus to (?:your )?(?:ac|armor class)((?:,| and|, and) (?:to )?[a-z' ,]{1,80})?$/;
/** Words that put terms on a whole bonus: "and to saving throws while you are raging". */
const CLAUSE_TERMS = /\b(?:while|when|whenever|if|unless|until|only|once|but|for)\b/;
/** Those, and a time or place: "and saving throws in dim light", "during your turn". */
const TAIL_TERMS = /\b(?:in|during|within|as long as)\b/;
/** Those, and "against": "made with this weapon, but only against undead". */
const BONUS_TERMS = /\b(?:against|while|when|whenever|if|unless|until|only|once|but|for)\b/;

/**
 * The bonus to AC an item's text gives while you wear or hold it, as "+2",
 * when no `<modifier>` gives one: "While wearing this armor, you gain a +3
 * bonus to AC, you are immune to fire damage". A bonus with terms of its own
 * (against ranged attacks, for every two allies, until your next turn) or one
 * that lasts a while ({@link PASSING}) stays in the text.
 */
export function itemAcBonus(prose: string, name = ''): string | undefined {
  for (const body of heldParts(prose, name, (part) => part.replace(NO_ARMOR, ''))) {
    if (PASSING.test(body)) continue;
    // "And to saving throws against spells" is a second bonus with terms of its
    // own, as the official Leather Golem Armor reads it; "and saving throws
    // against undead" puts its terms on both.
    const bonusOf = (clause: string) => {
      const m = AC_BONUS.exec(clause);
      const tail = m?.[2] ?? '';
      const terms =
        NOT_STANDING.test(tail) ||
        CLAUSE_TERMS.test(tail) ||
        TAIL_TERMS.test(tail) ||
        (!tail.startsWith(' and to ') && /\bagainst\b/.test(tail));
      return m === null || terms ? undefined : m[1];
    };
    const [first] = heldClauses(body, (c) => bonusOf(c) !== undefined);
    const bonus = first === undefined ? undefined : bonusOf(first);
    if (bonus !== undefined) return `+${bonus}`;
  }
  return undefined;
}

/**
 * An attuned item's text without its "while you wear it" words, so a lead-in
 * that holds while you are attuned reads as one that holds for good
 * ({@link standingDefenses}): "While wearing this cloak, you gain the
 * following benefits:" over the list after it.
 */
function withoutWearing(entries: readonly unknown[], held: ReturnType<typeof wearing>): unknown[] {
  const strip = (text: string) => {
    const lower = text.toLowerCase();
    const lead = held.lead.exec(lower);
    return lead === null ? text : text.slice(lead[0].length);
  };
  return entries.map((e) => {
    if (typeof e === 'string') return strip(e);
    if (e === null || typeof e !== 'object') return e;
    const o = e as Record<string, unknown>;
    const out: Record<string, unknown> = { ...o };
    if (Array.isArray(o.entries)) out.entries = withoutWearing(o.entries, held);
    if (Array.isArray(o.items)) out.items = withoutWearing(o.items, held);
    return out;
  });
}

/**
 * An attuned item's entries up to a line that sets terms on what follows: a
 * bare heading ("SCARIFIED") or a lead-in that does not hold ("While in this
 * form:"). What comes after it is that state's, not the item's. A short line
 * ending in a colon is not one here: under "you gain the following
 * benefits:" it names a benefit ("Ember Resistance:").
 */
function untilTerms(entries: readonly unknown[], held: ReturnType<typeof wearing>): unknown[] {
  const out: unknown[] = [];
  for (const e of entries) {
    if (typeof e === 'string') {
      const line = e.trim();
      const heading = !/[.!?:)]$/.test(line) && line.split(' ').length <= 4;
      // The lead-in's own sentence, without its "while holding this rod" words:
      // "This rod can be used as an arcane focus. While holding this rod, you gain the following benefits:".
      const lower = line.toLowerCase();
      const last = lower.slice(lower.lastIndexOf('. ') + 1).trim();
      const lead = held.lead.exec(last);
      const leadIn = lead === null ? last : last.slice(lead[0].length);
      if (heading || (line.endsWith(':') && NOT_STANDING.test(leadIn))) break;
    }
    out.push(e);
  }
  return out;
}

/**
 * "Stirring (Rare):" on a line of its own: a label over the part after it,
 * which for a bonus is one of the item's states (a benefit's name is read
 * through its lead-in, by {@link heldParts}). "You gain these benefits:" is not one.
 */
function stateLabel(line: string): boolean {
  const t = line.trim();
  return t.endsWith(':') && t.split(' ').length <= 4 && !/[.!?]|\byou\b/i.test(t);
}

/**
 * An entry's own paragraphs up to a state's label ({@link stateLabel}): not
 * its lists' items or its tables' rows, nor a named part ("Stirring (Rare)",
 * "Transformed", "Dormant State"), which is for one of the item's states, nor
 * a line Fight Club begins with a bullet.
 */
function paragraphs(entries: readonly unknown[]): string {
  const out: string[] = [];
  for (const e of entries) {
    if (typeof e !== 'string') continue;
    if (stateLabel(e)) break;
    if (!/^\s*[•·*-]/.test(e)) out.push(e);
  }
  return out.join('\n');
}

const WEAPON_FIELDS = ['bonusWeapon', 'bonusWeaponAttack', 'bonusWeaponDamage'] as const;
/**
 * "You gain a +2 bonus to attack and damage rolls made with this magic
 * weapon", said on its own, or a staff "wielded as a magic quarterstaff that
 * grants a +2 bonus to attack and damage rolls made with it".
 */
const WEAPON_BONUS =
  /^(?:(?:in addition|additionally|further), )?(?:you (?:gain|have) an? \+([1-5]) bonus to attack and damage rolls made (?:with|using) (?:this|these|the|it)\b(?: magic)?(?: [a-z'-]{1,20}){0,2}|this staff can be wielded as a magic quarterstaff that grants an? \+([1-5]) bonus to attack and damage rolls made with it)(?:,|$)/;
/** Words that make a weapon's bonus last only a while. */
const WHILE_ONLY = /\b(?:until|minutes?|hours?|rounds?|duration)\b/;

/**
 * The bonus to attack and damage rolls a weapon's text states for good, as
 * "+2", for a file that gives no `<modifier>` for it. A bonus in a list is
 * not read: a vestige's list is for one of its states, and a list after a
 * condition is that condition's.
 */
export function itemWeaponBonus(prose: string): string | undefined {
  for (const line of prose.split('\n')) {
    if (/^\s*[•·*-]/.test(line)) continue;
    for (const sentence of sentences(line)) {
      // The rest of a paragraph after "When you speak its command word, …" hangs on it.
      if (OPENS_ON_TERMS.test(sentence)) break;
      if (WHILE_ONLY.test(sentence)) continue;
      const m = WEAPON_BONUS.exec(sentence);
      const bonus = m?.[1] ?? m?.[2];
      // "…made with this weapon, but only against undead": terms of its own.
      // A clause after the comma is another rule ("and you ignore the normal
      // penalties … while using this weapon underwater") unless it opens on terms.
      const after = sentence.slice(Math.max(0, sentence.indexOf(' rolls made ')));
      const comma = after.indexOf(',');
      const first = comma === -1 ? after : after.slice(0, comma);
      const next = comma === -1 ? '' : after.slice(comma + 1).trimStart();
      const terms = BONUS_TERMS.test(first) || NEXT_TERMS.test(next);
      if (bonus !== undefined && !terms) return `+${bonus}`;
    }
  }
  return undefined;
}

/** A sentence that opens on a condition or a time sets the terms of the rest of its paragraph. */
const OPENS_ON_TERMS =
  /^(?:when|whenever|while|if|unless|until|once|after|before|during|as an? (?:[a-z]+ )?(?:action|reaction)|you can (?:use|take) (?:a|an|your) (?:[a-z]+ )?(?:action|reaction))\b/;
/** A clause after a weapon's bonus that puts terms on it: ", but only against undead", ", once per day". */
const NEXT_TERMS =
  /^(?:but only|only|if|while|when|whenever|against|unless|until|once|provided|as long as)\b/;

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
  // The dice the file gives, not a staff's quarterstaff dice assumed below.
  const fileDice = [dmg1, dmg2];
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
    // Unless its text says otherwise, a staff can be used as a quarterstaff
    // (both Dungeon Master's Guides), as the official data gives every staff;
    // Fight Club's file often leaves the dice to that convention. A staff
    // with dice of its own keeps them. One with none stays a focus in 2014,
    // as the official Staff is, and is a weapon in 2024, as the 2024 staffs are.
    item.staff = true;
    if (dmg1 !== undefined || dmgType !== '' || codes.includes('V')) {
      item.type = 'M';
      dmg1 ??= '1d6';
      if (codes.includes('V')) dmg2 ??= '1d8';
      if (dmgType === '') dmgType = 'B';
    } else {
      item.type = edition === '2024' ? 'M' : 'SCF';
      dmg1 = '1d6';
      dmg2 = '1d8';
      dmgType = 'B';
      codes.push('V');
    }
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
  const isWeapon = item.type === 'M' || item.type === 'R' || item.staff === true;
  if (isWeapon) {
    // The raw text, not `prose`: a "Proficiency: martial" line on its own is
    // a named entry there, and its colon is gone.
    const martial =
      codes.includes('M') ||
      childTexts(el, 'text').some((t) => /\bProficiency:\s*martial\b/i.test(t));
    item.weaponCategory = martial ? 'martial' : 'simple';
    // A 2024 staff is a Quarterstaff, whose mastery is Topple.
    const mastery =
      MASTERIES.find((m) => new RegExp(`\\b${m} \\(Mastery\\)`).test(prose)) ??
      (item.staff === true && edition === '2024' ? 'Topple' : undefined);
    if (mastery !== undefined) item.mastery = [`${mastery}|XPHB`];
  }
  const range = childText(el, 'range');
  if (range !== undefined && /^\d+\/\d+$/.test(range.replace(/\s+/g, ''))) {
    item.range = range.replace(/\s+/g, '');
  }

  const bonuses = readModifiers(el);
  Object.assign(item, bonuses.fields);
  reasons.push(...bonuses.reasons);
  // A bonus in a list is not read: a list is for one of the item's states (a
  // vestige's Dormant State), which the official data leaves to the reader.
  const said = paragraphs(text.entries);
  const stated = item.dmg1 === undefined ? undefined : itemWeaponBonus(said);
  if (stated !== undefined && WEAPON_FIELDS.every((f) => item[f] === undefined)) {
    item.bonusWeapon = stated;
  }
  if (item.bonusAc === undefined) {
    const ac = itemAcBonus(said, named.name);
    if (ac !== undefined) {
      item.bonusAc = ac;
      // The text says what a modifier this app cannot read left out ("unarmored armor class +2").
      const acKept = (r: string) =>
        r.startsWith('the bonus "') &&
        r.endsWith('" is kept as text') &&
        /\b(?:ac|armor class)\b/i.test(r);
      reasons.splice(0, reasons.length, ...reasons.filter((r) => !acKept(r)));
    }
  }
  // An item you attune to grants what its text states for good while you are
  // attuned, which is when the sheet counts it: "You have resistance to fire damage."
  const defenses = itemDefenses(prose, named.name);
  const held = wearing(named.name);
  Object.assign(
    item,
    item.reqAttune === undefined
      ? defenses
      : addDefenses(
          defenses,
          standingDefenses(untilTerms(withoutWearing(text.entries, held), held)),
        ),
  );

  // A weapon's rolls are its damage dice, which `dmg1` and `dmg2` already hold.
  item.entries = withRolls(text.entries, el, fileDice);
  const citation = citationEntry(placement);
  if (citation !== undefined) (item.entries as unknown[]).push(citation);
  if ((item.entries as unknown[]).length === 0) delete item.entries;

  return { kind: 'item', name: named.name, edition, entity: item, placement, reasons };
}
