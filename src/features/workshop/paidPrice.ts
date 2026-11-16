import { deriveSheet } from '@/engine/derive';
import { type DataEntity, type EngineContext, newCharacterDoc } from '@/engine/types';
import { offerPrice } from '@/features/sheet/rollPrice';

/** The stand-in that holds pools kept beside the entry (a class's), never its own. */
const KEPT = 'Pools kept elsewhere';

/**
 * Classes that give the stand-in every price a cost may name: Hit Point Dice,
 * slots up to 9th level and pact slots. A sheet that cannot pay a slot or a die
 * drops that cost, and a character who can never adds either to a roll.
 */
const PAYS_ANYTHING: ReadonlyArray<[DataEntity, number]> = [
  [
    {
      name: 'Caster',
      source: 'HB',
      hd: { number: 1, faces: 8 },
      casterProgression: 'full',
      spellcastingAbility: 'int',
    },
    17,
  ],
  [
    {
      name: 'Pact caster',
      source: 'HB',
      hd: { number: 1, faces: 8 },
      casterProgression: 'pact',
      spellcastingAbility: 'int',
    },
    3,
  ],
];

/**
 * Whether the roll prompt finds a price for a paid extra or a reroll an entry
 * gives, paid with its use: the entry's own effects, and the pools kept beside
 * it (a class's, which its Action may spend), derived on a sheet of their own
 * and priced as the prompt prices them (`offerPrice`), for a character who can
 * pay any cost (`PAYS_ANYTHING`) and has 20 in every score, under the rules
 * version the card counts under, every pool full and the reaction unspent. `reaction`
 * is the card's, as stored. A name not given yet matches no Action or pool.
 */
export function pricedAlone(
  name: string,
  effects: readonly unknown[],
  reaction: boolean | undefined,
  options: { kept?: readonly unknown[]; edition?: '2014' | '2024' } = {},
): boolean {
  const own = name.trim() === '' ? 'This entry' : name.trim();
  const kept = options.kept ?? [];
  const feat = (featName: string, list: readonly unknown[]): DataEntity => ({
    name: featName,
    source: 'HB',
    entries: [],
    castGuidance: { v: 1, effects: list },
  });
  const feats = [
    feat(own, effects),
    ...(kept.length > 0
      ? [feat(own.toLowerCase() === KEPT.toLowerCase() ? `${KEPT}, too` : KEPT, kept)]
      : []),
  ];
  const ctx: EngineContext = {
    get: (type, n) => {
      const list = type === 'feat' ? feats : type === 'class' ? PAYS_ANYTHING.map(([c]) => c) : [];
      return list.find((f) => String(f.name).toLowerCase() === n.toLowerCase());
    },
    byType: (type) =>
      type === 'feat' ? feats : type === 'class' ? PAYS_ANYTHING.map(([c]) => c) : [],
  };
  const doc = newCharacterDoc('price', own, 'price');
  if (options.edition !== undefined) doc.rulesVersion = options.edition;
  doc.classes = PAYS_ANYTHING.map(([c, levels]) => ({
    ref: { name: String(c.name), source: 'HB' },
    levels,
    hp: [],
  }));
  doc.feats = feats.map((f, i) => ({
    ref: { name: String(f.name), source: 'HB' },
    instanceId: `f${i}`,
  }));
  // A pool whose size goes by a score is there at any score a character may have.
  doc.abilities.base = { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 };
  const sheet = deriveSheet(doc, ctx);
  return offerPrice(sheet, { resources: [] }, own, reaction) !== undefined;
}
