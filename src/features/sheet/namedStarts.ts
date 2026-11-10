/**
 * Where the named effects come into play on the sheet (the buffs canvas, "How
 * a buff gets on"): Rage and Innate Sorcery from their own Use, Bless from
 * casting it, and the starter list under + Effect. The effects themselves are
 * built in `engine/curated/namedEffects.ts`.
 */
import {
  type BardicDie,
  bardicEffect,
  blessEffect,
  guidanceEffect,
  innateSorceryEffect,
  rageEffect,
  rageHeavyArmor,
} from '@/engine/curated/namedEffects';
import { applyEffect, type HpLimits, maxHpFrom, spellCast } from '@/engine/effectLife';
import type { MomentReport } from '@/engine/moments';
import type { ActiveEffect, CharacterDoc, DerivedSheet } from '@/engine/types';
import { randomId } from '@/lib/randomId';
import type { DocUpdater } from '@/stores/characterSession';
import { notify } from '@/stores/notices';
import { askChoice } from '@/ui/dialogs';
import { castGranted, castSpell, nextCastResource } from './castResources';
import { momentNotice } from './effectsInPlay';

const lower = (s: string) => s.trim().toLowerCase();

/** The effect answers to this name: its own, or the named effect it is. */
export const answersTo = (e: ActiveEffect, name: string) =>
  [e.name, e.same].some((n) => n !== undefined && lower(n) === lower(name));

/** What a feature's Use puts in play. */
export interface NamedStart {
  /** The effect's name, which an effect in play answers to while it lasts. */
  name: string;
  build: (id: string) => ActiveEffect;
  /** It cannot be kept up with concentration (Rage), so starting it ends that. */
  endsConcentration: boolean;
  /** What heavy armor does to it (Rage), said on its row while heavy armor is worn. */
  inHeavyArmor?: string;
}

/** The character's class of this name, in the printing given when one is. */
const classOf = (doc: CharacterDoc, name: string) =>
  doc.classes.find((c) => lower(c.ref.name) === name);

/**
 * The effect an action's Use starts, when it is one the sheet knows: a
 * barbarian's Rage (in its class's printing, at their level) and the 2024
 * sorcerer's Innate Sorcery. Other actions start nothing.
 */
export function namedStart(
  action: Pick<DerivedSheet['actions'][number], 'label' | 'origin'>,
  doc: CharacterDoc,
): NamedStart | undefined {
  const label = lower(action.label);
  if (label === 'rage' && lower(action.origin) === 'rage') {
    const barbarian = classOf(doc, 'barbarian');
    if (barbarian === undefined) return undefined;
    const edition = lower(barbarian.ref.source) === 'xphb' ? '2024' : '2014';
    return {
      name: 'Rage',
      build: (id) => rageEffect(id, barbarian.levels, edition),
      endsConcentration: true,
      inHeavyArmor: rageHeavyArmor(edition),
    };
  }
  if (label === 'innate sorcery' && lower(action.origin) === 'innate sorcery') {
    const sorcerer = classOf(doc, 'sorcerer');
    if (sorcerer === undefined || lower(sorcerer.ref.source) !== 'xphb') return undefined;
    return { name: 'Innate Sorcery', build: innateSorceryEffect, endsConcentration: false };
  }
  return undefined;
}

/**
 * After the character casts Bless, ask once whether they are one of its
 * targets, and put its d4 on them if so. Held by their concentration, so it
 * ends with it. Any other spell asks nothing.
 */
export async function offerSelfBless(
  spellName: string,
  update: DocUpdater,
  hp: HpLimits,
): Promise<void> {
  if (lower(spellName) !== 'bless') return;
  const pick = await askChoice({
    title: 'Bless yourself too?',
    options: [
      { id: 'self', label: 'Yes, add +d4' },
      { id: 'others', label: 'Others only' },
    ],
  });
  if (pick !== 'self') return;
  update((d) => void applyEffect(d.play, blessEffect(randomId(), true), hp));
}

/**
 * Cast as `castSpell` does, firing the `castAtLevel` moments in the same
 * change (one undo), and say what they did; then ask Bless's caster whether
 * they are a target too.
 */
export function castSpellAsking(...args: Parameters<typeof castSpell>): void {
  const [update, hp, block, level, spell, resource] = args;
  const inForce = hp.moments;
  if (inForce === undefined || !inForce.moments.some((m) => m.at === 'castAtLevel')) {
    castSpell(...args);
  } else {
    let said: MomentReport | undefined;
    const firing: DocUpdater = (recipe, label, opts) =>
      update(
        (d) => {
          // What the cast spends, worked out as `castSpell` does before it spends it.
          const spent = (resource ?? nextCastResource(block, d.play, level)).level;
          const maxBefore = maxHpFrom(d.play.activeEffects);
          recipe(d);
          // The cast can end what concentration held, a maximum-HP effect among them.
          const moved = maxHpFrom(d.play.activeEffects) - maxBefore;
          said = spellCast(d.play, spent, { ...hp, maxHp: hp.maxHp + moved }).moments;
        },
        label,
        opts,
      );
    castSpell(firing, hp, block, level, spell, resource);
    const notice = said === undefined ? null : momentNotice(said);
    if (notice !== null) notify(notice);
  }
  if (spell !== undefined) void offerSelfBless(spell.name, update, hp);
}

/** Cast an innate grant as `castGranted` does, then ask as `castSpellAsking` does. */
export function castGrantedAsking(...args: Parameters<typeof castGranted>): void {
  castGranted(...args);
  const [update, hp, spell] = args;
  void offerSelfBless(spell.name, update, hp);
}

/** A starter on + Effect: what its chip says, and the effect it adds. */
export interface Starter {
  /** The name an effect in play answers to while this one is on. */
  name: string;
  /** The die its chip marks before it is added: "+d4". */
  mark: string;
}

/** The starter list: what an ally most often gives you, by name. */
export const STARTERS: readonly Starter[] = [
  { name: 'Bless', mark: '+d4' },
  { name: 'Guidance', mark: '+d4' },
  { name: 'Bardic Inspiration', mark: '+d8' },
];

/** The bard's die when nothing has said otherwise: a 5th to 9th level bard's. */
export const BARDIC_DEFAULT: BardicDie = 'd8';

/** An ally's effect from the starter list, in the character's rules version. */
export function starterEffect(
  name: string,
  edition: '2014' | '2024',
  answers: { die?: BardicDie } = {},
): ActiveEffect | undefined {
  const id = randomId();
  switch (name) {
    case 'Bless':
      return blessEffect(id, false);
    case 'Guidance':
      return guidanceEffect(id, edition);
    case 'Bardic Inspiration':
      return bardicEffect(id, edition, answers.die ?? BARDIC_DEFAULT);
    default:
      return undefined;
  }
}
