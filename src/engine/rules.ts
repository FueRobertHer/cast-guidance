/**
 * Table rules (D4, H2): which value of each rule a character plays by. One
 * resolver, `tableRulesFor`, takes the first it finds of: the character's own
 * choice; a rule pack applied to them (the later in the player's list wins);
 * the app's choice in Settings (`EngineContext.rules`); a pack the player made
 * the app's default; else as written for their edition.
 *
 * Each rule is read where it acts: HP each level in `calc/hp.ts`, rest length
 * and HP on a long rest in `rest.ts` and `effectLife.endsAtRest`, flanking in
 * `playRules.rollEffects`, critical damage in `dice/roll.ts`, one-use dice in
 * the roll prompt (`features/sheet/rollOfferSpending.ts`).
 */
import {
  AS_WRITTEN,
  clip,
  guidanceVersion,
  isRecord,
  own,
  RULE_PACK_TYPE,
  readTableRules,
  TABLE_RULES,
  type TableRuleChoices,
  type TableRuleId,
} from './castGuidance';
import type { CharacterDoc, DerivedSheet, EngineContext } from './types';

type Layer = Partial<TableRuleChoices>;

/** Every rule as written for an edition (both editions agree today). */
export function asWritten(edition: string): Readonly<TableRuleChoices> {
  return AS_WRITTEN[edition === '2024' ? '2024' : '2014'];
}

function isValue<K extends TableRuleId>(id: K, value: unknown): value is TableRuleChoices[K] {
  return typeof value === 'string' && (TABLE_RULES[id] as readonly string[]).includes(value);
}

/**
 * The character's own choices: HP each level in `hpMethod`, one-use dice in
 * `oneUseDice`, the rest in `tableRules`. Read as stored data, never trusted.
 */
function characterRules(doc: Pick<CharacterDoc, 'tableRules' | 'hpMethod' | 'oneUseDice'>): {
  rules: Layer;
  problems: string[];
} {
  const read = readTableRules(doc.tableRules);
  const rules: Layer = { ...read.rules };
  if (isValue('hpEachLevel', doc.hpMethod)) rules.hpEachLevel = doc.hpMethod;
  if (isValue('oneUseDice', doc.oneUseDice)) rules.oneUseDice = doc.oneUseDice;
  return { rules, problems: read.problems.map((p) => `Your own ${p}`) };
}

/**
 * The table rules of the packs that reach this character, in the player's
 * order (the later wins): applied to them, or made the app's default. A pack
 * with no `appliesTo` reaches nobody. A version the app cannot read counts
 * nothing; the mechanics reader already says so.
 */
function packRules(
  ctx: Pick<EngineContext, 'byType'>,
  characterId: string,
): { mine: Layer; appDefault: Layer; problems: string[] } {
  const mine: Layer = {};
  const appDefault: Layer = {};
  const problems: string[] = [];
  for (const pack of ctx.byType(RULE_PACK_TYPE)) {
    const to = own(pack, 'appliesTo');
    const characters = isRecord(to) ? own(to, 'characters') : undefined;
    const forMe = Array.isArray(characters) && characters.includes(characterId);
    if (!forMe && !(isRecord(to) && own(to, 'appDefault') === true)) continue;
    const guidance = own(pack, 'castGuidance');
    if (!isRecord(guidance)) continue;
    if ('problem' in guidanceVersion(guidance)) continue;
    const read = readTableRules(own(guidance, 'tableRules'));
    const named = own(pack, 'name');
    const name =
      typeof named === 'string' && named.trim() !== '' ? clip(named.trim()) : 'A rule pack';
    for (const p of read.problems) problems.push(`${name}: ${p}`);
    Object.assign(forMe ? mine : appDefault, read.rules);
  }
  return { mine, appDefault, problems };
}

/** The rules a character plays by, with what in their own choices or their packs did not read. */
export function tableRulesFor(
  doc: Pick<CharacterDoc, 'id' | 'rulesVersion' | 'tableRules' | 'hpMethod' | 'oneUseDice'>,
  ctx: Pick<EngineContext, 'byType' | 'rules'>,
): { rules: TableRuleChoices; problems: string[] } {
  const character = characterRules(doc);
  const packs = packRules(ctx, doc.id);
  // Anything can build a context, so the app's choices are read as data too.
  const app = readTableRules(ctx.rules).rules;
  return {
    rules: {
      ...asWritten(doc.rulesVersion),
      ...packs.appDefault,
      ...app,
      ...packs.mine,
      ...character.rules,
    },
    problems: [...character.problems, ...packs.problems],
  };
}

/** The rules a character plays by (`tableRulesFor` without its problems). */
export function rulesFor(
  doc: Parameters<typeof tableRulesFor>[0],
  ctx: Parameters<typeof tableRulesFor>[1],
): TableRuleChoices {
  return tableRulesFor(doc, ctx).rules;
}

/**
 * `DerivedSheet.rules` and the problems to warn of: the rules, or nothing
 * when every one is as written, so a sheet under the books derives as before.
 */
export function sheetRulesField(
  doc: Parameters<typeof tableRulesFor>[0],
  ctx: Parameters<typeof tableRulesFor>[1],
): { rules?: TableRuleChoices; problems: string[] } {
  const { rules, problems } = tableRulesFor(doc, ctx);
  const written = asWritten(doc.rulesVersion);
  const same = (Object.keys(TABLE_RULES) as TableRuleId[]).every((id) => rules[id] === written[id]);
  return same ? { problems } : { rules, problems };
}

/** The rules a derived sheet was made under. */
export function sheetRules(
  sheet: Pick<DerivedSheet, 'rules'>,
  edition: string,
): Readonly<TableRuleChoices> {
  return sheet.rules ?? asWritten(edition);
}

/**
 * How long each rest takes under each rest length, in minutes: what a rest
 * ends of the effects in play (`effectLife.endsAtRest`), and its words.
 */
export const REST_MINUTES: Readonly<
  Record<TableRuleChoices['restLength'], Readonly<{ short: number; long: number }>>
> = {
  standard: { short: 60, long: 480 },
  gritty: { short: 480, long: 7 * 24 * 60 },
  heroic: { short: 5, long: 60 },
};

/** A rest's length in words, for the rest card: "1 hour", "8 hours", "7 days", "5 minutes". */
export function restTakes(length: TableRuleChoices['restLength'], rest: 'short' | 'long'): string {
  const minutes = REST_MINUTES[length][rest];
  const [n, unit] =
    minutes % 1440 === 0
      ? [minutes / 1440, 'day']
      : minutes % 60 === 0
        ? [minutes / 60, 'hour']
        : [minutes, 'minute'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
