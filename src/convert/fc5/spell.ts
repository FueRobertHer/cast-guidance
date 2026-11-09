/**
 * A Fight Club 5e `<spell>` into a 5etools spell. Spells carry most of their
 * rules as short strings ("Self (15-foot cone)", "Concentration, up to 1
 * minute"), so nearly everything maps; what does not parse stays readable as
 * a line of text and is reported.
 */
import type { RulesVersion } from '../../data5e/rulesVersion';
import { childElements, childText, childTexts, textContent, type XmlElement } from '../xml';
import {
  citationEntry,
  extraClassKey,
  type Fc5Context,
  type Fc5Result,
  placeEntity,
} from './context';
import {
  DAMAGE_TYPES,
  type Entry,
  entryName,
  inlineText,
  own,
  parenthetical,
  plainText,
  readText,
  splitName,
} from './text';

const SCHOOLS: Record<string, string> = {
  a: 'A',
  abjuration: 'A',
  c: 'C',
  conjuration: 'C',
  d: 'D',
  divination: 'D',
  en: 'E',
  e: 'E',
  enchantment: 'E',
  ev: 'V',
  v: 'V',
  evocation: 'V',
  i: 'I',
  illusion: 'I',
  n: 'N',
  necromancy: 'N',
  t: 'T',
  transmutation: 'T',
  p: 'P',
  psionic: 'P',
};

const UNITS: Record<string, string> = {
  action: 'action',
  actions: 'action',
  'bonus action': 'bonus',
  'bonus actions': 'bonus',
  reaction: 'reaction',
  reactions: 'reaction',
  minute: 'minute',
  minutes: 'minute',
  hour: 'hour',
  hours: 'hour',
  round: 'round',
  rounds: 'round',
};

/** "1 action", "Bonus Action", "1 reaction, which you take when…", "10 minutes". */
export function parseTime(raw: string): Record<string, unknown>[] | undefined {
  const out: Record<string, unknown>[] = [];
  // "1 action or 8 hours" is two times; "…when you or a creature…" is one condition.
  const alternatives = raw.split(
    /\s+or\s+(?=(?:\d+\s+)?(?:bonus action|action|reaction|minute|hour|round)s?\b)/i,
  );
  for (const part of alternatives) {
    const m =
      /^(\d+)?\s*(bonus actions?|actions?|reactions?|minutes?|hours?|rounds?)\b\s*,?\s*(.*)$/i.exec(
        part.trim(),
      );
    if (m === null) return undefined;
    const unit = UNITS[(m[2] ?? '').toLowerCase()];
    if (unit === undefined) return undefined;
    const time: Record<string, unknown> = { number: Number(m[1] ?? 1), unit };
    const condition = (m[3] ?? '').trim();
    if (condition !== '') time.condition = condition;
    out.push(time);
  }
  return out.length > 0 ? out : undefined;
}

const SHAPES = ['cone', 'cube', 'cylinder', 'emanation', 'hemisphere', 'line', 'radius', 'sphere'];

/** "90 feet", "Self", "Touch", "Self (15-foot cone)", "Self (10-foot-radius sphere)", "1 mile". */
export function parseRange(raw: string): Record<string, unknown> | undefined {
  const text = raw.trim().toLowerCase();
  for (const kind of ['self', 'touch', 'sight', 'unlimited']) {
    if (text === kind) return { type: 'point', distance: { type: kind } };
  }
  if (text === 'special') return { type: 'special' };
  const point = /^(\d+)\s*(feet|foot|ft\.?|miles?)$/.exec(text);
  if (point !== null) {
    const miles = (point[2] ?? '').startsWith('mile');
    return {
      type: 'point',
      distance: { type: miles ? 'miles' : 'feet', amount: Number(point[1]) },
    };
  }
  const area = /^self\s*\((\d+)[- ](foot|feet|ft\.?|miles?)(?:[- ]radius)?[- ]?([a-z]+)?\)$/.exec(
    text,
  );
  if (area !== null) {
    const shape = area[3] ?? 'radius';
    if (!SHAPES.includes(shape)) return undefined;
    const unit = (area[2] ?? '').startsWith('mile') ? 'miles' : 'feet';
    return { type: shape, distance: { type: unit, amount: Number(area[1]) } };
  }
  return undefined;
}

/** "V, S, M (a pinch of salt, which the spell consumes)". */
export function parseComponents(raw: string): Record<string, unknown> | undefined {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  parts.push(current.trim());
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    const m = /^([VSMR])\b\s*(?:\((.*)\))?$/i.exec(part);
    if (m === null) {
      if (part !== '') return undefined;
      continue;
    }
    const key = (m[1] ?? '').toLowerCase();
    out[key] = key === 'm' && m[2] !== undefined ? m[2].trim() : true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const DURATION_UNITS: Record<string, string> = {
  round: 'round',
  minute: 'minute',
  hour: 'hour',
  day: 'day',
  week: 'week',
  year: 'year',
};

/** "Instantaneous", "Concentration, up to 1 minute", "8 hours", "Until dispelled or triggered". */
export function parseDuration(raw: string): Record<string, unknown>[] | undefined {
  const text = raw.trim().toLowerCase().replace(/\.$/, '');
  if (text === 'instantaneous' || text === 'instant') return [{ type: 'instant' }];
  if (text === 'special') return [{ type: 'special' }];
  if (text === 'permanent') return [{ type: 'permanent' }];
  const until = /^until (dispelled|triggered)(?: or (dispelled|triggered))?$/.exec(text);
  if (until !== null) {
    const ends = [until[1], until[2]]
      .filter((e): e is string => e !== undefined)
      .map((e) => (e === 'dispelled' ? 'dispel' : 'trigger'));
    return [{ type: 'permanent', ends }];
  }
  const timed =
    /^(concentration,?\s*)?(?:up to\s+)?(\d+)\s+(round|minute|hour|day|week|year)s?$/.exec(text);
  if (timed !== null) {
    const unit = DURATION_UNITS[timed[3] ?? ''];
    if (unit === undefined) return undefined;
    const duration: Record<string, unknown> = {
      type: 'timed',
      duration: { type: unit, amount: Number(timed[2]) },
    };
    if (timed[1] !== undefined) duration.concentration = true;
    return [duration];
  }
  return undefined;
}

interface ClassLists {
  classes: string[];
  subclasses: { className: string; subclassName: string }[];
  edition?: RulesVersion;
}

/**
 * "Wizard, Sorcerer", "School: Evocation, Wizard", "Wizard [5.5e]",
 * "Fighter (Eldritch Knight)", "Artificer (UA)".
 */
export function readClasses(raw: string): ClassLists {
  const out: ClassLists = { classes: [], subclasses: [] };
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    // Filter tags some files mix in: "School: Evocation", "Ritual Caster", "Touch Spells".
    if (trimmed === '' || /^school:|^ritual caster$|\bspells$/i.test(trimmed)) continue;
    const { name, edition } = splitName(trimmed);
    if (edition !== undefined) out.edition = edition;
    const sub = parenthetical(name);
    if (sub !== undefined && !/^UA$/i.test(sub.inner)) {
      out.subclasses.push({ className: sub.base, subclassName: sub.inner });
      continue;
    }
    const base = name.replace(/\s*\(UA\)$/i, '').trim();
    if (base !== '' && !seen.has(base.toLowerCase())) {
      seen.add(base.toLowerCase());
      out.classes.push(base);
    }
  }
  return out;
}

/** Lead-ins 5etools keeps in `entriesHigherLevel`, a cantrip's upgrade included. */
const HIGHER_LEVEL_NAMES =
  /^(?:at higher levels|using a higher-level spell slot|higher levels?|cantrip upgrade)$/i;

interface DiceRoll {
  level: number;
  count: number;
  sides: number;
  /** A flat bonus written with the dice ("+40"), or ''. */
  bonus: string;
}

/**
 * `<roll level="3">5d4</roll>` grouped by description. A flat bonus stays
 * with the dice (`10d6+40`), as the roll chip in the text has it; a bonus
 * named by placeholder (`3d12+%0`, the spellcasting modifier) is not part of
 * the chip's dice, so it is dropped.
 */
function levelRolls(el: XmlElement): { label: string; rolls: DiceRoll[] } {
  const groups = new Map<string, DiceRoll[]>();
  for (const roll of childElements(el, 'roll')) {
    const level = Number(roll.attrs.level);
    const m = /^(\d+)d(\d+)(?:\s*([+-])\s*(?:(\d+)|%\d|SPELL|PROF|LVL))?$/i.exec(
      textContent(roll).trim(),
    );
    if (!Number.isInteger(level) || m === null) continue;
    const key = (roll.attrs.description ?? '').toLowerCase();
    const list = groups.get(key) ?? [];
    const bonus = m[4] === undefined ? '' : `${m[3] ?? '+'}${m[4]}`;
    list.push({ level, count: Number(m[1]), sides: Number(m[2]), bonus });
    groups.set(key, list);
  }
  // The first description with rolls at two or more levels; its words label
  // the scaling, so the label and the dice come from the same rolls.
  for (const [description, list] of groups) {
    if (list.length >= 2) {
      return { label: description || 'damage', rolls: list.sort((a, b) => a.level - b.level) };
    }
  }
  return { label: 'damage', rolls: [] };
}

/** A cantrip's damage by character level: `{"1": "1d6", "5": "2d6", …}`. */
function cantripScaling(el: XmlElement): Record<string, unknown> | undefined {
  const { label, rolls } = levelRolls(el);
  if (rolls.length < 2) return undefined;
  const scaling: Record<string, string> = {};
  for (const r of rolls) scaling[String(Math.max(1, r.level))] = `${r.count}d${r.sides}`;
  return { label, scaling };
}

/**
 * The upcast tag the sheet reads (`{@scaledamage 4d4|2-9|1d4}`), when the
 * rolls grow by the same dice every slot level.
 */
function upcastTag(el: XmlElement, spellLevel: number): string | undefined {
  const { rolls } = levelRolls(el);
  const first = rolls[0];
  const second = rolls[1];
  if (first === undefined || second === undefined || first.level !== spellLevel) return undefined;
  const step = second.count - first.count;
  if (step <= 0) return undefined;
  for (let k = 1; k < rolls.length; k += 1) {
    const prev = rolls[k - 1];
    const cur = rolls[k];
    if (prev === undefined || cur === undefined) return undefined;
    if (cur.sides !== first.sides || cur.bonus !== first.bonus) return undefined;
    if (cur.count - prev.count !== step * (cur.level - prev.level)) return undefined;
  }
  const last = rolls[rolls.length - 1]?.level ?? 9;
  const base = `${first.count}d${first.sides}${first.bonus}`;
  return `{@scaledamage ${base}|${spellLevel}-${last}|${step}d${first.sides}}`;
}

/** A roll tag's dice, by kind, from text: `{@damage 3d6}`, `{@dice 1d8+3}`. */
const ROLL_TAG = /\{@(damage|dice) (\d{1,3})d(\d{1,3})([+-]\d{1,3})?\}/g;

/**
 * The one roll of a kind and die in the text, or undefined when there is none
 * or more than one: the upcast step needs to know which roll it grows.
 */
function onlyRoll(text: string, kind: string, sides: string): string | undefined {
  const found = new Set<string>();
  for (const m of text.matchAll(ROLL_TAG)) {
    if (m[1] === kind && m[3] === sides) found.add(`${m[2]}d${m[3]}${m[4] ?? ''}`);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/** "the damage increases by {@dice 1d6} for each slot level above 1st". */
const UPCAST_STEP =
  /\b(damage|healing)\b[^.]{0,80}? increases? by \{@(?:dice|damage) (\d{1,3}d(\d{1,3}))\} for each (?:spell )?slot level above/i;

/**
 * The upcast tag from the text alone, for a file without a roll per level
 * ({@link upcastTag}): "the damage increases by 1d6 for each slot level above
 * 1st" over the spell's one damage roll of that die (`{@scaledamage
 * 3d6|1-9|1d6}`), or the healing over its one roll (`{@scaledice
 * 1d8|1-9|1d8}`). A text that caps the increase says nothing reliable about
 * the top slot, so it stays as it is.
 */
function textUpcastTag(entries: Entry[], higher: Entry[], spellLevel: number): string | undefined {
  const higherText = plainText(higher);
  if (/\bmaximum\b/i.test(higherText)) return undefined;
  // Two steps ("the initial damage increases by 1d8 and the later damage by 1d6") are more than one tag holds.
  if ((higherText.match(/ by \{@(?:dice|damage) /g) ?? []).length > 1) return undefined;
  const step = UPCAST_STEP.exec(higherText);
  if (step === null) return undefined;
  const healing = (step[1] ?? '').toLowerCase() === 'healing';
  const base = onlyRoll(plainText(entries), healing ? 'dice' : 'damage', step[3] ?? '');
  if (base === undefined) return undefined;
  return `{@scale${healing ? 'dice' : 'damage'} ${base}|${spellLevel}-9|${step[2]}}`;
}

const ROLL = '\\{@(?:dice|damage) (\\d{1,3})d(\\d{1,3})\\}';
/**
 * "increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and
 * 17th level (4d10)", and the 2024 "when you reach levels 5 (2d10), 11 (3d10),
 * and 17 (4d10)".
 */
const CANTRIP_STEPS = new RegExp(
  `increases by ${ROLL} when you reach (?:5th level|levels? 5) \\(${ROLL}\\), (?:11th level|11) \\(${ROLL}\\),? and (?:17th level|17) \\(${ROLL}\\)`,
  'i',
);

/**
 * A cantrip's damage by character level from its text alone, for a file
 * without a roll per level ({@link cantripScaling}). The 1st-level dice must
 * be the text's one damage roll of that die, so the ladder is this spell's.
 */
function textCantripScaling(
  entries: Entry[],
  higher: Entry[],
): Record<string, unknown> | undefined {
  const m = CANTRIP_STEPS.exec(plainText([...entries, ...higher]));
  if (m === null) return undefined;
  const sides = m[2];
  if ([m[4], m[6], m[8]].some((s) => s !== sides)) return undefined;
  const step = Number(m[1]);
  const at5 = Number(m[3]);
  const at11 = Number(m[5]);
  const at17 = Number(m[7]);
  const counts = [at5 - step, at5, at11, at17];
  if (at5 - step !== step || at11 !== at5 + step || at17 !== at11 + step) return undefined;
  const main = plainText(entries);
  const base = `${counts[0]}d${sides}`;
  if (onlyRoll(main, 'damage', sides ?? '') !== base) return undefined;
  const type = new RegExp(`\\{@damage ${base}\\} (${DAMAGE_TYPES.join('|')}) damage`, 'i')
    .exec(main)?.[1]
    ?.toLowerCase();
  const label = type === undefined ? 'damage' : `${type} damage`;
  const scaling: Record<string, string> = {};
  for (const [i, level] of ['1', '5', '11', '17'].entries())
    scaling[level] = `${counts[i]}d${sides}`;
  return { label, scaling };
}

/** "a 15-foot Cone", "a 10-foot Emanation": the 2024 book's area, in its text. */
const AREA = /\b(\d{1,3})-foot (cone|emanation)\b/gi;

/**
 * A 2024 spell's area as its range, where Fight Club gives the reach alone:
 * Burning Hands' range is "15 feet" and its text says "a 15-foot Cone", and
 * Spirit Guardians' is "Self" with "a 15-foot Emanation"; the 2024 book writes
 * Self (15-foot Cone) and Self (15-foot Emanation). Read only where every such
 * area in the text is the same and fits the range given. A cone in a spell of
 * range Self may be one the spell lets you make later (Draconic
 * Transformation's breath), so that stays Self.
 */
function areaRange(
  range: Record<string, unknown>,
  prose: string,
): Record<string, unknown> | undefined {
  const areas = new Set(
    [...prose.matchAll(AREA)].map((m) => `${m[1]} ${(m[2] ?? '').toLowerCase()}`),
  );
  if (areas.size !== 1) return undefined;
  const [size, shape] = ([...areas][0] ?? '').split(' ');
  const distance = range.distance as { type?: string; amount?: number } | undefined;
  if (range.type !== 'point' || distance === undefined) return undefined;
  const fits =
    (shape === 'emanation' && distance.type === 'self') ||
    (shape === 'cone' && distance.type === 'feet' && distance.amount === Number(size));
  return fits ? { type: shape, distance: { type: 'feet', amount: Number(size) } } : undefined;
}

/** Put the upcast tag where the higher-level text names the step dice. */
function withUpcastTag(higher: Entry[], tag: string): Entry[] | undefined {
  const step = /\|([^|}]+)\}$/.exec(tag)?.[1];
  if (step === undefined) return undefined;
  const pattern = new RegExp(`\\{@(?:dice|damage) ${step.replace(/[+]/g, '\\+')}\\}`);
  let placed = false;
  const place = (e: Entry): Entry => {
    if (placed) return e;
    if (typeof e === 'string') {
      if (!pattern.test(e)) return e;
      placed = true;
      return e.replace(pattern, tag);
    }
    const inner = e.entries;
    return Array.isArray(inner) ? { ...e, entries: (inner as Entry[]).map(place) } : e;
  };
  const out = higher.map(place);
  return placed ? out : undefined;
}

/**
 * A save the spell forces: "makes a Dexterity saving throw", "succeed on a
 * Wisdom saving throw". Not "Advantage on Wisdom saving throws", which is a
 * benefit the spell gives, and which 5etools does not list either.
 */
const SAVE =
  /\b(?:an?|one|another|makes?|succeeds? on|fails?)\s+(?:DC \d+\s+)?(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throws?\b/gi;
const ATTACK = /\b(melee|ranged) spell attack/gi;

export function convertSpell(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const reasons: string[] = [];
  const named = entryName(rawName);
  const text = readText(childTexts(el, 'text'));
  const sourceLine = childText(el, 'source') ?? text.sourceLine;
  const classes = readClasses(
    [
      childText(el, 'classes'),
      ...(ctx.extraClasses?.get(extraClassKey(named.name, named.edition)) ?? []),
    ]
      .filter((c): c is string => c !== undefined)
      .join(', '),
  );
  const placement = ctx.place(sourceLine, named.edition ?? classes.edition);
  const edition = placement.edition;

  const spell: Record<string, unknown> = { name: named.name };
  placeEntity(spell, placement);

  const level = Number(childText(el, 'level'));
  if (Number.isInteger(level) && level >= 0 && level <= 9) spell.level = level;
  else {
    spell.level = 0;
    reasons.push('its level was missing, so it reads as a cantrip');
  }

  const school = own(SCHOOLS, (childText(el, 'school') ?? '').toLowerCase());
  if (school !== undefined) spell.school = school;
  else reasons.push('no school of magic');

  // A field the sheet needs: parsed, or kept as a line of text, or missing.
  const lead: Entry[] = [];
  const unread = (label: string, raw: string | undefined) => {
    if (raw === undefined) reasons.push(`the file gives no ${label.toLowerCase()}`);
    else {
      lead.push(`{@b ${label}:} ${inlineText(raw)}`);
      reasons.push(`${label.toLowerCase()} kept as text`);
    }
  };

  const rawTime = childText(el, 'time');
  const ritualInTime = /\s+or\s+ritual$/i.test(rawTime ?? '');
  const time = parseTime((rawTime ?? '').replace(/\s+or\s+ritual$/i, ''));
  if (time !== undefined) spell.time = time;
  else {
    spell.time = [{ number: 1, unit: 'action' }];
    unread('Casting Time', rawTime);
  }

  const rawRange = childText(el, 'range');
  const range = parseRange(rawRange ?? '');
  if (range !== undefined) spell.range = range;
  else {
    spell.range = { type: 'special' };
    unread('Range', rawRange);
  }

  const rawComponents = childText(el, 'components');
  const components = rawComponents === undefined ? undefined : parseComponents(rawComponents);
  if (components !== undefined) spell.components = components;
  else if (rawComponents !== undefined) unread('Components', rawComponents);

  const rawDuration = childText(el, 'duration');
  const duration = parseDuration(rawDuration ?? '');
  if (duration !== undefined) spell.duration = duration;
  else {
    spell.duration = [{ type: 'special' }];
    unread('Duration', rawDuration);
  }

  const ritual = (childText(el, 'ritual') ?? '').toUpperCase();
  if (ritual === 'YES' || ritual === '1' || ritualInTime) spell.meta = { ritual: true };

  const classSource = edition === '2024' ? 'XPHB' : 'PHB';
  if (classes.classes.length > 0 || classes.subclasses.length > 0) {
    const lists: Record<string, unknown> = {};
    if (classes.classes.length > 0) {
      lists.fromClassList = classes.classes.map((name) => ({ name, source: classSource }));
    }
    if (classes.subclasses.length > 0) {
      lists.fromSubclass = classes.subclasses.map((s) => ({
        class: { name: s.className, source: classSource },
        subclass: { name: s.subclassName, shortName: s.subclassName, source: classSource },
      }));
    }
    spell.classes = lists;
  }

  // Higher-level text moves to its own field, where the sheet reads upcasting.
  const entries: Entry[] = [];
  let higher: Entry[] = [];
  for (const e of text.entries) {
    if (typeof e !== 'string' && typeof e.name === 'string' && HIGHER_LEVEL_NAMES.test(e.name)) {
      higher.push(e);
    } else entries.push(e);
  }
  spell.entries = [...lead, ...entries];
  const citation = citationEntry(placement);
  if (citation !== undefined) (spell.entries as Entry[]).push(citation);

  // The file's rolls per level first; its text where it gives no such rolls.
  const perLevel = levelRolls(el).rolls.length >= 2;
  if (level === 0) {
    const scaling = perLevel ? cantripScaling(el) : textCantripScaling(entries, higher);
    if (scaling !== undefined) spell.scalingLevelDice = scaling;
  } else if (higher.length > 0) {
    const tag = perLevel ? upcastTag(el, level) : textUpcastTag(entries, higher, level);
    const tagged = tag === undefined ? undefined : withUpcastTag(higher, tag);
    if (tagged !== undefined) higher = tagged;
  }
  if (higher.length > 0) spell.entriesHigherLevel = higher;

  const prose = plainText(text.entries);
  if (range !== undefined) {
    // The spell's own paragraphs: a named part ("Elemental Flux") is an effect of its own.
    const paragraphs = plainText(text.entries.filter((e) => typeof e === 'string'));
    const area = areaRange(range, paragraphs);
    if (area !== undefined) spell.range = area;
  }
  const saves = [...new Set([...prose.matchAll(SAVE)].map((m) => (m[1] ?? '').toLowerCase()))];
  if (saves.length > 0) spell.savingThrow = saves;
  const attacks = [
    ...new Set(
      [...prose.matchAll(ATTACK)].map((m) => ((m[1] ?? '').toLowerCase() === 'melee' ? 'M' : 'R')),
    ),
  ];
  if (attacks.length > 0) spell.spellAttack = attacks;

  return { kind: 'spell', name: named.name, edition, entity: spell, placement, reasons };
}
