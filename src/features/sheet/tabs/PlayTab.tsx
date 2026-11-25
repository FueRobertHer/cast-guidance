import {
  AlertTriangle,
  Brain,
  ChevronsUp,
  HeartCrack,
  HeartPlus,
  Hourglass,
  Info,
  Minus,
  Moon,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import type { RulesVersion } from '@/data5e/rulesVersion';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import type { RollResult } from '@/dice/types';
import { attacksPerAction } from '@/engine/calc/attacksPerAction';
import type { TableRuleChoices, TableRuleId } from '@/engine/castGuidance';
import {
  attacksAgainst,
  conditionMaxHp,
  conditionSpeed,
  type D20Test,
  d20Effects,
} from '@/engine/conditions';
import { idleChargePools } from '@/engine/curated/itemCharges';
import {
  applyEffect,
  concentrationDc,
  endEffect,
  endEffects,
  type HpLimits,
  knockedOut,
  newTurn,
  setConcentration,
} from '@/engine/effectLife';
import { defensesInForce, rollEffects } from '@/engine/playRules';
import type { RestDone } from '@/engine/rest';
import { sheetRules } from '@/engine/rules';
import type {
  ActionCost,
  ActionEconomy,
  AttackRow,
  CharacterDoc,
  DamageRider,
  DerivedSheet,
  PlayState,
  SlotPrice,
  SpellcastingBlock,
  WeaponExtra,
} from '@/engine/types';
import { choiceTitle, RuleSheet } from '@/features/settings/RuleSheet';
import { randomId } from '@/lib/randomId';
import { signed } from '@/lib/signed';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { characterSessionStore } from '@/stores/characterSession';
import {
  attackInPlay,
  castFrom,
  type DamageAsk,
  type DamageExtra,
  type HeldCast,
  type OwnDamage,
  rollFrom,
} from '@/stores/heldRoll';
import { type Notice, notify } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { Badge, badgeClass } from '@/ui/Badge';
import { BannerAction } from '@/ui/Banner';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { Button, buttonClass } from '@/ui/Button';
import { ChipFace, NOT_WORN, useRollMoment } from '@/ui/ChipFace';
import { D20Icon } from '@/ui/D20Icon';
import { askChoice, askConfirm, askText } from '@/ui/dialogs';
import { FeatureInfoSheet, findFeatureInfo } from '@/ui/FeatureInfoSheet';
import { Tip, useTip } from '@/ui/Hint';
import { Lift } from '@/ui/Lift';
import { PackProblem } from '@/ui/PackProblem';
import { Pips } from '@/ui/Pips';
import { RollChip } from '@/ui/RollChip';
import { cardClass, listClass, openListClass } from '@/ui/surfaces';
import { RemoveAddedSpell } from '../AddSpellSheet';
import {
  type ActionRestore,
  type ActionSpend,
  type ActionUse,
  actionUse,
  applyRestore,
} from '../actionUse';
import {
  castDiceAt,
  castPlan,
  grantBadgeTitle,
  grantCast,
  grantLimitWords,
  grantNumbersKey,
  grantRowKey,
  grantUsedUp,
  ritualWay,
  type SpellCast,
} from '../castPlan';
import { castingEconomy, isConcentratingOn, type SlotSpent, spendSlot } from '../castResources';
import { capabilityKey, collectCapabilityCards } from '../combatCapabilities';
import { conditionLimits } from '../conditionEffects';
import { DefensesChip } from '../Defenses';
import {
  conditionWear,
  d20Ask,
  effectLines,
  noteLines,
  rollD20Test,
  rollWear,
  type TurnExtra,
  useIgnoreOnce,
} from '../d20Tests';
import {
  type DamageAdd,
  damageAdds,
  damageParts,
  entriesText,
  featReaches,
  hitSpell,
  oncePerTurn,
  weaponFeats,
} from '../damageAdds';
import {
  andList,
  attackDrop,
  attackLift,
  conditionsInForce,
  defendedTypes,
  defensesRaisedBy,
  defenseView,
  effectsInPlay,
  hpLimits,
  immunityTo,
  loweredBy,
  momentLines,
  newTurnLines,
  raisedBy,
  saveDcLoweredBy,
  saveDcRaisedBy,
  withMoments,
} from '../effectsInPlay';
import { ForetoldNumbers } from '../ForetoldNumbers';
import {
  BloomCue,
  CapCues,
  ChipCues,
  CueShield,
  cuePart,
  GlowCue,
  NumberCues,
  TrailCue,
  useHpCues,
} from '../HpCues';
import { type HpMode, HpSheet } from '../HpSheet';
import { hpBand } from '../hpChange';
import { answersTo, namedStart, recklessStart } from '../namedStarts';
import { clampPlayStateToMax, detectPlayStateOverages } from '../playStateLimits';
import { type RecoveryPicks, RestSheet } from '../RestSheet';
import { RollEffectCue } from '../RollEffectCue';
import {
  backCaption,
  giveBack,
  recoverSlots,
  restWith,
  shortRestWouldRestore,
  slotRecoveries,
  spendHitDie,
  spentSlots,
} from '../rest';
import { payOffer, pricedRollEffects } from '../rollPrice';
import { SpellCastChips } from '../SpellCastChips';
import { SpellInfoSheet } from '../SpellInfoSheet';
import { spellNeedsConcentration } from '../SpellManager';
import { SpellSlots } from '../SpellSlots';
import { hitDiceLeft, hitDiePlan, hitDieRoll, slotLeft, slotPlan, slotsLeftFor } from '../slotCost';
import { NoSpellsCue, SaveDcBadge } from '../spellcastingMarks';
import { findSpell, useSpellData } from '../spellData';
import { spellSaves } from '../spellMeta';
import type { CharacterSheetState } from '../useCharacterSheet';
import { useConditionEntry } from '../useConditionEntry';
import { attackSubtitle, damageLabel, weaponInfoEntries } from '../weaponInfo';

/** A modifier for a dice expression, whose parser reads a hyphen; on screen, see `signed`. */
const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** The sides of the first die a damage expression adds ("1d8+3" is 8), if it has one. */
function firstDieSides(expr: string): number | undefined {
  try {
    const die = parseDice(expr).terms.find((t) => t.kind === 'dice' && t.sign > 0);
    return die?.kind === 'dice' ? die.sides : undefined;
  } catch {
    return undefined;
  }
}

/** A section's heading and the helper line under it (DS-001 `heading`, `caption`). */
const H2 = 'px-1 text-heading';

/**
 * What a melee weapon's attack prompt offers to claim for an opportunity
 * attack: the attack takes the reaction, and its damage is on another
 * creature's turn.
 */
const OPPORTUNITY = 'Opportunity attack';
const HELP = 'px-1 text-caption text-ink-muted';
/** A quiet text link in a card's footer (temp HP, breakdown). */
const LINK =
  'min-h-6 min-w-0 text-left text-caption font-semibold text-ink-muted underline decoration-line-strong underline-offset-3 hover:text-ink';
/** A name that opens its rules: dashed, so it reads as tappable without shouting. */
const RULES = 'underline decoration-line-strong decoration-dashed';
/**
 * A list row of a name and its roll chips (attacks, spells). The name keeps at
 * least 4.5rem, and the chips (ROW_ACTIONS) drop under it as one group where
 * both do not fit (large text, several chips on a narrow phone), wrapping among
 * themselves past the row's width, rather than squeezing the name to a letter
 * or two and pushing the page sideways (A11Y-003). ROW_NAME is a spell's side:
 * its 1.5rem level and a gap, then the name.
 */
const ROW = 'flex flex-wrap items-center gap-x-2 gap-y-1';
const ROW_NAME = 'flex min-w-0 flex-1 basis-26 items-center gap-2';
/**
 * ROW_NAME beside its source's name in place of an ability's three letters (a
 * grant with no ability: an item's, a feat's): sized by its content, so the
 * chips drop under it first, and then the source's name under the spell's
 * (wrapping if it must), before it squeezes the spell's to a letter. Its name
 * button grows from its own width (not `flex-1`'s none), and the source's
 * name may shrink.
 */
const ROW_NAME_WIDE = 'flex min-w-0 grow flex-wrap items-center gap-x-2 gap-y-0.5';
const ROW_ACTIONS = 'ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end';
/**
 * A row's name: one line cut short while its list is at least 15rem wide, and
 * wrapped once narrower (large text), so none of it is lost where an ellipsis
 * would leave a few letters. The list is the query container.
 */
const NAME = 'wrap-anywhere @min-[15rem]:truncate';
/**
 * A lasting state, on or off (Inspiration, Concentration): ToggleChip's look,
 * and its On and Off words, hidden from the buttons' names, which aria-pressed
 * already says. Each grows, so the pair stacks where both do not fit (a long
 * spell's name, large text) rather than push the page sideways (A11Y-003).
 */
const TOGGLE =
  'flex min-h-tap min-w-0 grow items-center justify-center gap-2 rounded-control px-3 text-label transition-colors duration-120';
const TOGGLE_OFF = 'text-ink-muted ring ring-line-strong ring-inset hover:text-ink';
/** The HP card's ±1: round `surface-raised` steppers, the icon in `danger` or `heal`. */
const STEP =
  'flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised transition-[background-color,scale] duration-120 hover:bg-surface-hover active:scale-92';
/** The HP bar's fill in each band (hpChange.ts): green, then amber, then red as it drops. */
const BAND_FILL = { high: 'bg-heal', mid: 'bg-meter-mid', low: 'bg-danger' } as const;
/** Its ±5: a 36px tint of the same role inside a 44px target (A11Y-002). */
const FIVE =
  'tap rounded-full text-label tabular-nums transition-[filter] duration-120 hover:brightness-112';
/** A card without its padding (surfaces' `cardClass`), for one whose rows pad themselves. */
const FLUSH = 'rounded-card bg-surface shadow-card ring ring-line ring-inset';
/**
 * A cell of the Armor Class / Initiative / Speed / Proficiency strip (DS-001
 * StatStrip), and the small label under its number. Four across, two by two
 * where four would not fit: the strip is the query container.
 */
const TILE = 'flex min-h-19 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-2';
const TILE_LABEL = 'wrap-anywhere text-[0.75rem] text-ink-muted leading-4';
/**
 * A cell a condition can wear or an effect can raise: its `ChipFace` lays it out
 * as `TILE` does the others. The strip does not clip, so that a raised cell's
 * mark can sit on its corner, and a cell on the card's corner rounds its own.
 */
const WORN_TILE = 'relative flex min-h-19 min-w-0 flex-col';
/** What a long rest does, said before it is taken, under the table's HP on a long rest rule. */
function longRestDetail(hp: TableRuleChoices['hpOnLongRest']): string {
  const back =
    hp === 'all'
      ? 'Full HP'
      : hp === 'half'
        ? 'Half your maximum HP back'
        : 'No HP back (spend hit dice to heal)';
  return `${back}, all spell slots and resources restored; regain half your hit dice.`;
}
/** No effects to end. */
const NONE: ReadonlySet<string> = new Set();
/** A point pool's −5 / −1 / +1 / +5 (sorcery points, Lay on Hands). */
const POOL_STEP =
  'tap rounded-pill bg-surface-raised px-2 text-label tabular-nums leading-none hover:bg-surface-hover unavailable:bg-surface-raised unavailable:text-ink-faint';

/** A cue line's look for an effect's own line (`DerivedSheet.cues`), by tone. */
const CUE_TONE: Record<
  DerivedSheet['cues'][number]['tone'],
  { Icon: typeof Info; className: string }
> = {
  help: { Icon: ChevronsUp, className: 'text-heal' },
  ward: { Icon: ShieldCheck, className: 'text-ward' },
  warn: { Icon: AlertTriangle, className: 'text-guide' },
  info: { Icon: Info, className: 'text-ink-muted' },
};

/**
 * How long HP has to stay put before it is said (A11Y-002). A run of taps on
 * the steppers is one change to a listener: only where it ends is spoken.
 */
export const HP_SETTLE_MS = 1000;

/** HP as a screen reader hears it once a change settles; the meter's own words. */
export function hpSpeech(play: Pick<PlayState, 'currentHp' | 'tempHp'>, max: number): string {
  const temp = play.tempHp > 0 ? `, plus ${play.tempHp} temporary` : '';
  return `${play.currentHp} of ${max} hit points${temp}`;
}

/**
 * Damage eats temp HP first; healing caps at max. Dropping to 0 knocks the
 * character out, which the caller settles (`knockedOut`: concentration, Rage)
 * once it knows the drop sticks (Relentless Endurance).
 */
function applyHp(play: PlayState, delta: number, maxHp: number): void {
  // Any manual HP change means the character is in play now: stop auto-tracking
  // max HP so a deliberate 0-HP / damaged state sticks across level-ups.
  play.hpInitialized = true;
  if (delta < 0) {
    let dmg = -delta;
    const fromTemp = Math.min(play.tempHp, dmg);
    play.tempHp -= fromTemp;
    // Spent, they belong to no effect: ending Heroism later takes nobody's.
    if (play.tempHp === 0) delete play.tempHpFrom;
    dmg -= fromTemp;
    play.currentHp = Math.max(0, play.currentHp - dmg);
  } else {
    play.currentHp = Math.min(maxHp, play.currentHp + delta);
    if (play.currentHp > 0) play.deathSaves = { success: 0, fail: 0 };
  }
}

/**
 * A concentrating character who takes damage must make a CON save
 * (`concentrationDc`: 10 or half the damage, 30 at most in 2024). Rolls it
 * with `rollSave` (the sheet's d20 test, so War Caster and the character's
 * conditions count), logs it, and
 * breaks concentration on a failure. Mutates the draft; returns a notice to
 * show. No-op when not concentrating or already dropped to 0 HP (that breaks
 * it too).
 */
function rollConcentration(
  play: PlayState,
  damageTaken: number,
  rollSave: (label: string) => RollResult,
  hp: HpLimits,
): Notice | null {
  const label = play.concentratingOn?.label;
  if (label === undefined || damageTaken <= 0 || play.currentHp === 0) return null;
  const dc = concentrationDc(damageTaken, hp.edition);
  const r = rollSave(`Concentration save (DC ${dc})`);
  rollLogStore.getState().append(r);
  const held = r.meta?.autoFail !== true && r.total >= dc;
  const ended = held ? [] : setConcentration(play, undefined, hp).ended;
  const cue = r.meta?.cue === undefined ? '' : ` · ${r.meta.cue}`;
  const gone = ended.length === 0 ? '' : ` · Ended ${andList(ended)}`;
  return {
    title: held ? 'Concentration held' : 'Concentration broken',
    detail: `${label} · rolled ${r.total} vs DC ${dc}${cue}${gone}`,
    tone: held ? 'good' : 'warn',
  };
}

/**
 * A spell whose file has not arrived. Its level decides what casting it spends,
 * and guessing that spent a slot on a cantrip, so until the file is here the row
 * offers no way to cast it. The name still opens the rules sheet, which says what
 * became of the file and can ask again. The slot pips above still work.
 */
/**
 * One table rule a rest follows, as a chip on the rest card (the Rules board,
 * C): the rule's value in words, opening its sheet.
 */
function RestRule({
  id,
  value,
  onOpen,
}: {
  id: 'restLength' | 'hpOnLongRest';
  value: string;
  onOpen: (id: TableRuleId) => void;
}) {
  const words =
    id === 'restLength'
      ? choiceTitle(id, value as TableRuleChoices['restLength'])
      : `Long rest HP: ${choiceTitle(id, value as TableRuleChoices['hpOnLongRest']).replace(/^./, (c) => c.toLowerCase())}`;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => onOpen(id)}
      className="inline-flex min-h-tap items-center gap-1 rounded-pill bg-surface-raised px-3 text-label text-ink hover:bg-surface-hover"
    >
      {words}
      <span className="text-ink-muted">· Change</span>
    </button>
  );
}

function PendingSpellRow({
  name,
  source,
  version,
  subtitle,
  className,
}: {
  name: string;
  source: string;
  version: RulesVersion;
  subtitle: string;
  className: string;
}) {
  return (
    <div className={`${className} ${ROW}`}>
      <div className={ROW_NAME}>
        <span aria-hidden="true" className="w-6 shrink-0 text-caption text-ink-muted">
          …
        </span>
        <SpellInfoSheet
          name={name}
          source={source}
          version={version}
          subtitle={subtitle}
          trigger={
            <button
              type="button"
              className={`min-h-6 min-w-0 flex-1 text-left ${NAME} ${RULES} text-ink-muted underline-offset-2`}
            >
              {name}
            </button>
          }
        />
      </div>
    </div>
  );
}

export function Component() {
  const { sheet, built: builtSheet, doc, update } = useOutletContext<CharacterSheetState>();
  const { registry, entities, spellsMissing, spellPacks, spellsSettling } = useSpellData(
    sheet,
    doc,
  );
  // Keyed by character, so a settling HP line is only ever about the one it
  // was for; leaving the tab or the character drops one still settling.
  const hpKey = `hp:${doc?.id ?? ''}`;
  useEffect(() => () => cancelAnnouncement(hpKey), [hpKey]);
  // The cues' "Ignore once", for as long as the tab is open.
  const ignore = useIgnoreOnce(JSON.stringify(doc?.play.conditions ?? []));
  const initiativeRoll = useRollMoment();
  const hpTip = useTip('hp-exact');
  const rulesTip = useTip('tap-for-rules');
  const hpNumber = useRef<HTMLButtonElement>(null);
  // The rest whose sheet asks which effects it ends, kept as the sheet closes.
  const [restAsked, setRestAsked] = useState<{ rest: 'short' | 'long'; open: boolean }>({
    rest: 'short',
    open: false,
  });
  // The rest card's rule chip opened, if one is: its sheet sets the rule here.
  const [ruleOpen, setRuleOpen] = useState<TableRuleId | null>(null);
  const restId = useId();
  const [hpSheet, setHpSheet] = useState<{ open: boolean; mode: HpMode }>({
    open: false,
    mode: 'damage',
  });
  const hpSheetFrom = useRef<HTMLElement>(null);
  // The HP card's cues for damage, healing and temp HP. A change made while
  // the HP sheet or the rest sheet covers the card plays as the sheet goes.
  const hpCues = useHpCues({
    id: doc?.id ?? '',
    currentHp: doc?.play.currentHp ?? 0,
    tempHp: doc?.play.tempHp ?? 0,
    follows: doc?.play.hpInitialized === false,
    hold: hpSheet.open || restAsked.open,
  });
  // When a Use that starts an effect last turned into End, or back: the
  // button changes under the finger, so a second tap within a second is the
  // same tap, not an undo.
  const startedAt = useRef(new Map<string, number>());
  const conditionEntry = useConditionEntry(registry, doc?.rulesVersion ?? '2024');
  if (sheet === null || doc === null) return <p className="text-body text-ink-muted">Deriving…</p>;

  const spellEntity = (name: string, source: string) =>
    findSpell(registry, name, source, doc.rulesVersion);
  const spellLevelOf = (name: string, source: string): number => {
    const e = spellEntity(name, source);
    return typeof e?.level === 'number' ? e.level : 1;
  };
  const spellConcentrationOf = (name: string, source: string): boolean =>
    spellNeedsConcentration(spellEntity(name, source));
  const spellCastEconomy = (name: string, source: string) =>
    castingEconomy(spellEntity(name, source));

  const play = doc.play;
  const rules = sheetRules(sheet, doc.rulesVersion);
  // What ending or switching effects needs, to keep current HP within the maximum.
  const hpNow = hpLimits(sheet, doc.rulesVersion, conditionEntry);
  const inPlay = effectsInPlay(play);
  /**
   * Take a rest, ending the effects ticked first, so Aid's +5 does not outlive
   * it, then the rest's moments (H9), once its recovery is done.
   */
  const finishRest = (
    rest: 'short' | 'long',
    ends: ReadonlySet<string>,
    recover: RecoveryPicks = new Map(),
  ) => {
    let done: RestDone | undefined;
    let full = true;
    const recovered: string[] = [];
    update(
      (d) => {
        done = restWith(d.play, sheet, rest, doc.rulesVersion, {
          before: endEffects(d.play, ends, hpNow),
          idle: idleChargePools(d, sheet.resources, entities),
          conditionEntry,
        });
        // Slots picked back as the short rest ends (Arcane Recovery), each pool's use spent.
        if (rest === 'short') {
          for (const [key, picks] of recover) {
            const said = recoverSlots(d.play, sheet, key, picks);
            if (said !== undefined) recovered.push(said);
          }
        }
        // A table that heals less on a long rest can leave it short of full.
        full = d.play.currentHp >= hpNow.maxHp + done.change.maxHpChange;
      },
      rest === 'short' ? 'Short rest' : 'Long rest',
    );
    const restored = done?.restored ?? [];
    const ended = done?.change.ended ?? [];
    const said = [
      ...(restored.length > 0 ? [`Restored ${restored.join(', ')}`] : []),
      ...recovered,
      ...(ended.length > 0 ? [`Ended ${andList(ended)}`] : []),
    ];
    const notice: Notice =
      rest === 'short'
        ? {
            title: 'Short rest',
            detail: said.length > 0 ? said.join(' · ') : 'Nothing to restore',
            tone: said.length > 0 ? 'good' : 'info',
          }
        : {
            title: 'Long rest complete',
            detail:
              said.length > 0 ? said.join(' · ') : full ? 'Already at full' : 'Nothing to restore',
            tone: 'good',
          };
    notify(withMoments(notice, done?.change.moments) ?? notice);
  };

  // What the character's conditions do to their own rolls, speed and hit
  // point maximum (engine/conditions.ts): applied, said in a cue where each
  // roll starts, and never more than guidance (see RollEffectCue). One the
  // character is immune to is held off, as one switched off is.
  const immune = { immune: sheet.conditionImmunities };
  const conditions = conditionsInForce(play.conditions, sheet.conditionImmunities);
  const effectsFor = (test: Parameters<typeof d20Effects>[2]) =>
    d20Effects(conditions, doc.rulesVersion, test, immune);
  const maxHp = conditionMaxHp(sheet.maxHp.value, conditions, doc.rulesVersion, immune);
  /**
   * Spend one hit die of a size to heal, from the HP card's chip or the short
   * rest sheet: rolled, logged and healed by, up to the maximum the card shows.
   */
  const healWithHitDie = (die: string) =>
    update((d) => {
      const r = spendHitDie(d.play, sheet.hitDice, die, sheet.abilities.con.mod);
      if (r === undefined) return;
      rollLogStore.getState().append(r);
      applyHp(d.play, Math.max(0, r.total), maxHp.value);
    });
  // Haste doubles what is left once exhaustion has taken its share.
  const speed = conditionSpeed(sheet.speedWalk.value, conditions, doc.rulesVersion, {
    ...immune,
    multiplier: sheet.speedMultiplier,
  });
  const attackEffects = effectsFor({ kind: 'attack' });
  const initiativeEffects = effectsFor({ kind: 'initiative' });
  const deathEffects = effectsFor({ kind: 'save' });
  const against = attacksAgainst(conditions, doc.rulesVersion, immune);

  // The same numbers for the build alone, without the effects in play, so the
  // ones an effect raised wear its ring (the buffs canvas, Wear A).
  const built = builtSheet ?? sheet;
  const builtImmune = { immune: built.conditionImmunities };
  const builtConditions = conditionsInForce(play.conditions, built.conditionImmunities);
  const builtSpeed = conditionSpeed(built.speedWalk.value, builtConditions, doc.rulesVersion, {
    ...builtImmune,
    multiplier: built.speedMultiplier,
  });
  const builtMaxHp = conditionMaxHp(
    built.maxHp.value,
    builtConditions,
    doc.rulesVersion,
    builtImmune,
  );
  const acUp = raisedBy(sheet.ac, built.ac);
  const initiativeUp = raisedBy(sheet.initiative, built.initiative);
  // And the ones an effect lowered wear the same edge in red (a homebrew
  // condition's -2 to AC).
  const acDown = loweredBy(sheet.ac, built.ac);
  const initiativeDown = loweredBy(sheet.initiative, built.initiative);
  // A condition on that only an effect holds off (Freedom of Movement while
  // grappled): what raised the number when no part of it says so.
  const heldOffBy = [
    ...new Set(
      play.conditions
        .filter((c) => c.ignored !== true)
        .flatMap((c) =>
          immunityTo(c.id, built.conditionImmunities).length > 0
            ? []
            : immunityTo(c.id, sheet.conditionImmunities),
        ),
    ),
  ];
  const orHeldOff = (names: string[]) => (names.length > 0 ? names : heldOffBy);
  const speedUp =
    speed.value > builtSpeed.value
      ? orHeldOff(
          raisedBy(sheet.speedWalk, built.speedWalk).concat(
            sheet.speedMultiplier.factor > 1 ? sheet.speedMultiplier.sources : [],
          ),
        )
      : [];
  // Only the largest multiplier counts, and it starts at 1, so none slows.
  const speedDown =
    speed.value < builtSpeed.value ? loweredBy(sheet.speedWalk, built.speedWalk) : [];
  const maxHpUp =
    maxHp.value > builtMaxHp.value ? orHeldOff(raisedBy(sheet.maxHp, built.maxHp)) : [];
  const maxHpDown = maxHp.value < builtMaxHp.value ? loweredBy(sheet.maxHp, built.maxHp) : [];
  // What could change the damage the character takes: theirs, and their conditions'.
  const defenses = defensesInForce(sheet, conditions, doc.rulesVersion);
  const builtDefenses = defensesInForce(built, builtConditions, doc.rulesVersion);
  const defensesUp = defensesRaisedBy(
    defenses,
    builtDefenses,
    sheet.conditionImmunities,
    built.conditionImmunities,
  );
  // Features whose crit rules live in prose, found as the capability cards
  // find them. Savage Attacks (the 2014 half-orc's): a melee crit with a
  // weapon rolls one of its damage dice once more. Brutal Critical (the 2014
  // barbarian's): one more for each of its cards, at 9th, 13th and 17th level.
  // The Champion's Improved and Superior Critical: weapon attacks crit on 19,
  // then 18.
  const capabilities = new Set(collectCapabilityCards(sheet.features).map((c) => c.key));
  const savage = capabilities.has('savage attacks');
  const brutal = sheet.features.filter((f) => capabilityKey(f.name) === 'brutal critical').length;
  const weaponCritFrom = capabilities.has('superior critical')
    ? 18
    : capabilities.has('improved critical')
      ? 19
      : 20;
  /**
   * What the roll prompt offers to declare for the turn on this attack:
   * Reckless Attack on a barbarian's first, put in play as the roll lands.
   */
  const turnExtras = (test: D20Test): TurnExtra[] => {
    const start = recklessStart(doc, capabilities.has('reckless attack'), inPlay, test);
    if (start === undefined) return [];
    const declare = () =>
      update(
        (d) => void applyEffect(d.play, start.build(randomId()), hpNow),
        `Declared ${start.name}`,
      );
    return [{ source: start.name, mode: start.mode, cost: start.cost, declare }];
  };
  /**
   * A d20 test in the attack group: the weapon and spell attack chips, with
   * what the effects in play bring to that attack (Bless, Bardic Inspiration)
   * and what may be declared for the turn on it (Reckless Attack).
   * It is marked as the attack `of` (a weapon's or a spell's name) and whether
   * it crit, inside the character's crit range: the damage that goes with it
   * (`attackDamage`) reads that to roll its dice twice.
   */
  const rollAttack =
    (
      modifier: number,
      label: string,
      test: D20Test,
      of: string,
      claims: readonly TurnExtra[] = [],
    ) =>
    () =>
      d20Ask(`1d20${fmt(modifier)}`, {
        label,
        effects: attackEffects,
        ignored: ignore.take('attack', attackEffects),
        riders: pricedRollEffects(rollEffects(sheet, test), sheet, doc.play),
        settlesOnNatural: true,
        thisTurn: [...turnExtras(test), ...claims],
        attack: {
          by: doc.id,
          of,
          critFrom: Math.min(
            sheet.critRange?.min ?? 20,
            test.kind === 'attack' && test.attack === 'weapon' ? weaponCritFrom : 20,
          ),
        },
      });
  /** Damage that goes with the attack `of`, or with any of this character's attacks. */
  const attackDamage = (of?: string, critDice?: { dice: string; source: string }) => ({
    by: doc.id,
    ...(of === undefined ? {} : { of }),
    ...(critDice === undefined ? {} : { critDice }),
  });
  /** What a weapon row's attack is, as an effect's filter reads it. */
  const weaponTest = (a: AttackRow): D20Test => ({
    kind: 'attack',
    attack: 'weapon',
    ...(a.ranged === undefined ? {} : { range: a.ranged ? 'ranged' : 'melee' }),
    ...(a.ability === undefined ? {} : { ability: a.ability }),
  });
  /**
   * The extra crit dice for a carried melee weapon's damage `expr`, of its first
   * die: one for Savage Attacks, and one for each Brutal Critical card.
   */
  const extraCritDice = (a: AttackRow, expr: string) => {
    const count = (savage ? 1 : 0) + brutal;
    if (count === 0 || a.ranged !== false || a.weaponId === undefined) return undefined;
    const sides = firstDieSides(expr);
    const source = [savage ? 'Savage Attacks' : '', brutal > 0 ? 'Brutal Critical' : '']
      .filter((s) => s !== '')
      .join(' and ');
    return sides === undefined ? undefined : { dice: `${count}d${sides}`, source };
  };
  /** The attack rolls' cue: over the attack list, and again over spells with attack rolls. */
  const attackCue = (heading?: string) => (
    <RollEffectCue
      heading={heading}
      lines={effectLines(attackEffects)}
      notes={noteLines(attackEffects)}
      rolls="attack roll"
      ignored={ignore.armed('attack')}
      onIgnore={() => ignore.toggle('attack')}
    />
  );
  const hasSpellAttack = (entity: ReturnType<typeof spellEntity>) =>
    Array.isArray(entity?.spellAttack) && entity.spellAttack.length > 0;
  // A spell attack's range when the spell makes only the one kind (`M` melee,
  // `R` ranged): a melee spell attack is a melee attack (flanking, a melee rider).
  const spellRange = (entity: ReturnType<typeof spellEntity>) => {
    const kinds = new Set(Array.isArray(entity?.spellAttack) ? entity.spellAttack : []);
    if (kinds.size !== 1) return {};
    return kinds.has('M')
      ? { range: 'melee' as const }
      : kinds.has('R')
        ? { range: 'ranged' as const }
        : {};
  };

  // After a build change lowers a limit, stored play state can hold values above
  // the new maxima — surface them and offer a non-destructive clamp (GAME-007).
  // Exhaustion's halved maximum (2014) is one more such limit. A class whose
  // data has not landed yet derives no slots or pools at all, so there is
  // nothing to compare with: the warning would call every spent slot over a
  // limit of 0, and its button would wipe them. So too a tab just opened,
  // whose registry lands a moment after the sheet: until then it finds no
  // put-away item's charges (`idleChargePools`).
  const overages =
    sheet.classDataMissing || registry === null
      ? []
      : detectPlayStateOverages(
          play,
          sheet,
          idleChargePools(doc, sheet.resources, entities),
          maxHp.value,
        );

  /**
   * Trigger an action: mark its slice of the turn used (a rider has none) AND
   * spend what it costs, in a single update so the sheet stays honest.
   */
  const triggerAction = (
    economy: ActionEconomy,
    spends: readonly ActionSpend[],
    label?: string,
    regains?: ActionUse['regains'],
    then?: (d: CharacterDoc) => void,
  ) =>
    update(
      (d) => {
        const entryOf = (key: string) => d.play.resources.find((r) => r.key === key);
        // All of it or none: a tap that beat the last render must not take half a cost,
        // or the use of something with nothing left to refill.
        if (spends.some((s) => (entryOf(s.key)?.used ?? 0) + s.amount > s.max)) return;
        const refilled = regains !== undefined ? entryOf(regains.key) : undefined;
        if (regains !== undefined && (refilled === undefined || refilled.used <= 0)) return;
        if (economy !== 'none') {
          const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
          turn[economy] = true;
          d.play.turn = turn;
        }
        for (const { key, amount } of spends) {
          const entry = entryOf(key);
          if (entry !== undefined) entry.used += amount;
          else d.play.resources.push({ key, used: amount });
        }
        if (regains !== undefined && refilled !== undefined) {
          giveBack(refilled, regains.max, regains.amount);
        }
        then?.(d);
      },
      label !== undefined ? `Used ${label}` : undefined,
    );
  /** Buy a use back. It takes nothing from the turn: "no action required". */
  const restoreUse = (restore: ActionRestore) =>
    update((d) => void applyRestore(d.play.resources, restore), `Restored ${restore.label}`);
  /** What is left to pay a spell slot or Hit Point Die price with. */
  const paying = {
    slotsLeft: (price: SlotPrice) => slotsLeftFor(sheet, play, price),
    hitDiceLeft: hitDiceLeft(sheet, play).reduce((n, s) => n + s.left, 0),
  };
  /** A slot as the history names it. */
  const slotWords = (r: SlotSpent) =>
    r.kind === 'pact' ? 'a pact slot' : `a level ${String(r.level)} slot`;
  /**
   * Spend what Use takes beside a slot or a die, in the update that spends that:
   * the slice of the turn and the uses. False, spending nothing, when a use is gone.
   */
  const spendUses = (d: CharacterDoc, economy: ActionEconomy, spends: readonly ActionSpend[]) => {
    const entryOf = (key: string) => d.play.resources.find((r) => r.key === key);
    if (spends.some((x) => (entryOf(x.key)?.used ?? 0) + x.amount > x.max)) return false;
    if (economy !== 'none') {
      const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
      turn[economy] = true;
      d.play.turn = turn;
    }
    for (const { key, amount } of spends) {
      const entry = entryOf(key);
      if (entry !== undefined) entry.used += amount;
      else d.play.resources.push({ key, used: amount });
    }
    return true;
  };
  /**
   * Use paid with a spell slot (Divine Smite, Song of Defense): the prompt offers
   * the slots that pay as tiles, and rolls what the level picked buys. Paying
   * marks the turn, spends the uses and the slot, and refills the pool a slot
   * turns into (Font of Magic), all in one update or none of it.
   */
  const payWithSlot = (
    from: HTMLElement | null,
    label: string,
    economy: ActionEconomy,
    spends: readonly ActionSpend[],
    cost: ActionCost,
    rowKey: string,
  ) => castFrom(from, slotUse(label, economy, spends, cost, rowKey));
  /** What paying with a slot offers and does, as tiles: for its own prompt, or a hit's damage. */
  const slotUse = (
    label: string,
    economy: ActionEconomy,
    spends: readonly ActionSpend[],
    cost: ActionCost,
    rowKey: string,
  ): HeldCast =>
    slotPlan({
      id: `${doc.id}|slot|${rowKey}`,
      title: label,
      verb: 'Use',
      sheet,
      play,
      price: cost,
      dice: cost.slotDice,
      crit: () => {
        const attack = attackInPlay();
        return attack?.crit === true && attack.by === doc.id;
      },
      pay: (r) =>
        update(
          (d) => {
            // A slot turned into points needs points spent to come back (Font of Magic),
            // checked here too: the pool may have refilled behind the waiting prompt.
            const refill = sheet.resources.find((x) => x.key === cost.slotRefills);
            const entry = d.play.resources.find((x) => x.key === refill?.key);
            if (cost.slotRefills !== undefined && (entry === undefined || entry.used <= 0)) return;
            if (!slotLeft(sheet, d.play, r) || !spendUses(d, economy, spends)) return;
            spendSlot(d.play, r);
            if (refill !== undefined && entry !== undefined) giveBack(entry, refill.max, r.level);
          },
          `Used ${label} with ${slotWords(r)}`,
        ),
    });
  /**
   * Use paid with a Hit Point Die, which heals as the HP card's chip does: at once
   * with one size of die, else the prompt offers a tile a size.
   */
  const payWithHitDie = (
    from: HTMLElement | null,
    label: string,
    economy: ActionEconomy,
    spends: readonly ActionSpend[],
    cost: ActionCost,
    rowKey: string,
  ) => {
    const heals = cost.hitDieHeals ?? 'roll';
    const conMod = sheet.abilities.con.mod;
    const spendDie = (die: string, rolled?: number) =>
      update((d) => {
        const spent = d.play.hitDiceSpent[die] ?? 0;
        if (spent >= (sheet.hitDice[die] ?? 0) || !spendUses(d, economy, spends)) return;
        d.play.hitDiceSpent[die] = spent + 1;
        let total = rolled;
        if (total === undefined) {
          const r = roll(hitDieRoll(die, heals, conMod), {
            label: `${label} (${die})`,
            kind: 'heal',
          });
          rollLogStore.getState().append(r);
          total = r.total;
        }
        applyHp(d.play, Math.max(cost.hitDieAtLeast ?? 0, total), maxHp.value);
      }, `Used ${label} (${die})`);
    const sizes = hitDiceLeft(sheet, play).filter((x) => x.left > 0);
    const only = sizes.length === 1 ? sizes[0] : undefined;
    if (only !== undefined) {
      spendDie(only.die);
      return;
    }
    // The roll lands before the die is paid: the heal waits for the payment's update.
    let rolled: number | undefined;
    castFrom(
      from,
      hitDiePlan({
        id: `${doc.id}|hit-die|${rowKey}`,
        title: label,
        sheet,
        play,
        heals,
        conMod,
        pay: (die) => spendDie(die, rolled),
      }),
      (r) => {
        rolled = r.total;
      },
    );
  };
  /** Buy a use back with a spell slot, picked in the prompt. */
  const restoreWithSlot = (from: HTMLElement | null, restore: ActionRestore, rowKey: string) =>
    castFrom(
      from,
      slotPlan({
        id: `${doc.id}|restore|${rowKey}`,
        title: restore.label,
        verb: 'Restore',
        sheet,
        play,
        price: restore.slot ?? {},
        pay: (r) =>
          update(
            (d) => {
              if (!slotLeft(sheet, d.play, r) || !applyRestore(d.play.resources, restore)) return;
              spendSlot(d.play, r);
            },
            `Restored ${restore.label} with ${slotWords(r)}`,
          ),
      }),
    );
  // What the active conditions stop you doing — shown as warnings, never blocks.
  const limits = conditionLimits(conditions, doc.rulesVersion);
  /** The conditions on the attack chips, as the cue over them says them. */
  const attackChipWear = rollWear(
    conditions,
    attackEffects,
    ignore.armed('attack'),
    limits.noActions,
  );
  /** On Cast and the dice chip that casts: only what stops casting. */
  const castWear = conditionWear(conditions, limits.noActions);
  const spellHasVerbal = (name: string, source: string): boolean => {
    const e = spellEntity(name, source);
    return (e?.components as { v?: boolean } | undefined)?.v === true;
  };
  /** A `guide` "you normally can't do this" line for a condition limit. */
  const limitWarning = (text: string, reasons: readonly string[]) =>
    reasons.length > 0 ? (
      <span className="flex items-center gap-1 px-1 text-caption text-guide">
        <AlertTriangle size={14} className="shrink-0" /> {text} ({reasons.join(', ')})
      </span>
    ) : null;

  const dying = play.currentHp === 0 && maxHp.value > 0;

  const concentrationEffects = effectsFor({ kind: 'save', ability: 'con' });
  // The build's advantage on these saves (War Caster on concentration, 2024
  // Durable on death saves), which the character's conditions combine with
  // and can cancel, and which their cues name.
  const concentrationRiders = rollEffects(sheet, {
    kind: 'save',
    ability: 'con',
    purpose: 'concentration',
  });
  const deathRiders = rollEffects(sheet, { kind: 'save', purpose: 'death' });
  const rollConcentrationSave = (label: string) =>
    rollD20Test(`1d20${fmt(sheet.saves.con.total.value)}`, {
      label,
      effects: concentrationEffects,
      ignored: ignore.take('concentration', concentrationEffects),
      // Settled on the spot, so nothing is offered after it.
      riders: { ...concentrationRiders, offers: [] },
    });

  const usedOf = (key: string) => play.resources.find((r) => r.key === key)?.used ?? 0;

  /**
   * The character's play state as it stands now, for what is asked after an
   * update this render has not seen (an attack counted, a coating put on).
   */
  const playNow = (): PlayState => {
    const fresh = characterSessionStore.getState().doc;
    return fresh?.id === doc.id ? fresh.play : play;
  };
  /** Attacks one Attack action gives (Extra Attack), the most any feature gives. */
  const perAction = attacksPerAction(sheet.features);
  /**
   * Weapon attacks the turn's Attack actions give: one action's, and as many
   * again after Action Surge (once a turn, even with two uses).
   */
  /**
   * The action an effect adds that allows one attack (Haste's: "one weapon
   * attack only" in 2014, "one attack only" in 2024), if the character has one.
   */
  const hasteBox = sheet.extraActions.find((x) =>
    /\bone (?:weapon )?attack only\b/i.test(x.note ?? ''),
  );
  /**
   * The attacks the turn's Attack actions give: the action's, unless it went to
   * something else (a spell, a Dash), and as many again after Action Surge (once
   * a turn, even with two uses).
   */
  const mainAttacks = (turn: PlayState['turn']) =>
    perAction *
    ((turn?.action !== true || turn.attackAction === true ? 1 : 0) +
      Math.min(1, turn?.surges ?? 0));
  /**
   * Weapon attacks allowed this turn: the Attack actions', and one more with an
   * action that allows one (Haste's), while it is not spent on something else.
   * Action Surge never doubles that one.
   */
  const attacksAllowed = (p: PlayState) => {
    const hasteFree =
      hasteBox !== undefined &&
      (p.turn?.hasted === true || !(p.turn?.extra ?? []).includes(hasteBox.label));
    return mainAttacks(p.turn) + (hasteFree ? 1 : 0);
  };
  /** The feats that change a weapon's damage (Great Weapon Master, Savage Attacker). */
  const feats = weaponFeats(sheet.features);
  /** Action Surge used: one more action this turn, and with it one more Attack action. */
  const markSurge = (d: CharacterDoc) => {
    const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
    turn.surges = Math.min(1, (turn.surges ?? 0) + 1);
    d.play.turn = turn;
  };
  /**
   * What the attack prompt offers to claim for a weapon's roll alone: a −5 to
   * hit for +10 damage (2014 Great Weapon Master, Sharpshooter), which its
   * damage then adds.
   */
  const powerClaims = (a: AttackRow): TurnExtra[] => [
    ...feats
      .filter((f) => f.kind === 'power' && featReaches(f, a))
      .map((f) => ({
        source: f.source,
        bonus: -5,
        cost: '+10 damage if it hits',
        declare: () => undefined,
        thisRoll: true,
      })),
    // An opportunity attack, with a melee weapon: the reaction, on another's turn.
    ...(a.ranged === true
      ? []
      : [
          {
            source: OPPORTUNITY,
            cost: 'Uses your reaction, not your action, and is no attack of your Attack action',
            declare: () => undefined,
            thisRoll: true,
          },
        ]),
  ];
  /**
   * Is the attack in play this character's opportunity attack (claimed in its
   * prompt), with `of` when given? Its damage is on another creature's turn.
   */
  const opportunityInPlay = (of?: string): boolean => {
    const struck = attackInPlay();
    return (
      struck?.by === doc.id &&
      (of === undefined || struck.of === of) &&
      struck.claimed?.includes(OPPORTUNITY) === true
    );
  };
  /** The once-a-turn extras used on the turn the damage is on: this one's, or another's. */
  const usedOnce = (now: PlayState, off: boolean) =>
    (off ? now.turn?.offOnce : now.turn?.once) ?? [];
  /**
   * A weapon attack made: the first of the turn takes the action as the Attack
   * action, and Extra Attack's later ones only count, so they spend nothing more
   * of the turn. One past what the Attack actions give (or with the action gone
   * to something else) takes the action Haste adds, when it is free.
   */
  const markAttack = (label: string) => {
    // An opportunity attack takes the reaction alone, and starts that turn's once afresh.
    if (opportunityInPlay()) {
      update((d) => {
        const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
        turn.reaction = true;
        turn.offOnce = [];
        d.play.turn = turn;
      }, `Opportunity attack with ${label}`);
      return;
    }
    update(
      (d) => {
        const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
        if (turn.action !== true) {
          turn.action = true;
          turn.attackAction = true;
        }
        const made = turn.attacks ?? 0;
        const extra = turn.extra ?? [];
        if (
          made >= mainAttacks(turn) &&
          hasteBox !== undefined &&
          !extra.includes(hasteBox.label)
        ) {
          turn.extra = [...extra, hasteBox.label];
          turn.hasted = true;
        }
        turn.attacks = made + 1;
        d.play.turn = turn;
      },
      (d) => {
        const made = d.play.turn?.attacks ?? 1;
        const allowed = attacksAllowed(d.play);
        if (d.play.turn?.hasted === true && made === allowed && hasteBox !== undefined)
          return `Attacked with ${label} (${hasteBox.label})`;
        return made > 1 && allowed > 1 && made <= allowed
          ? `Attacked with ${label} (${String(made)} of ${String(allowed)})`
          : `Attacked with ${label}`;
      },
    );
  };
  /** The Attack action's next attack, in words, while Extra Attack leaves one: "Attack 2 of 2". */
  const nextAttack = (): string | undefined => {
    // An opportunity attack is no attack of the Attack action: nothing follows it.
    if (opportunityInPlay()) return undefined;
    const now = playNow();
    const made = now.turn?.attacks ?? 0;
    const allowed = attacksAllowed(now);
    return allowed > 1 && made > 0 && made < allowed
      ? `Attack ${String(made + 1)} of ${String(allowed)}`
      : undefined;
  };
  /**
   * Marks a once-a-turn extra used (Sneak Attack), by its row key: on this turn,
   * or with `off` on the turn of an opportunity attack.
   */
  const markOnce = (d: CharacterDoc, key: string, off = false) => {
    const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
    const list = (off ? turn.offOnce : turn.once) ?? [];
    if (!list.includes(key)) {
      if (off) turn.offOnce = [...list, key];
      else turn.once = [...list, key];
    }
    d.play.turn = turn;
  };
  /** Where a weapon's own extras are kept: its equipment entry, else the attack's name. */
  const weaponKey = (a: AttackRow) => a.weaponId ?? a.label;
  /** Takes the player's extra `id` off the weapon. */
  const dropOwn = (a: AttackRow, id: string, label: string) =>
    update((d) => {
      const all = d.play.weaponExtras ?? {};
      const kept = (all[weaponKey(a)] ?? []).filter((w) => w.id !== id);
      if (kept.length > 0) all[weaponKey(a)] = kept;
      else delete all[weaponKey(a)];
      if (Object.keys(all).length > 0) d.play.weaponExtras = all;
      else delete d.play.weaponExtras;
    }, label);
  /** A damage roll's type is the weapon's when it says none, so it rolls in the weapon's roll. */
  const sameType = (a: AttackRow, type: string | undefined) =>
    type === undefined || type === a.damageType;
  /** What the player put on the weapon, as the damage prompt offers it: on, and removable. */
  const ownExtra = (a: AttackRow, w: WeaponExtra): DamageExtra => ({
    key: `own:${w.id}`,
    dice: w.dice,
    source: w.source,
    damageType: w.damageType,
    label: w.damageType === undefined ? `${w.source} damage` : `${w.source} ${w.damageType} damage`,
    kind: 'own',
    folds: sameType(a, w.damageType),
    tag: w.once === true ? 'next hit' : 'every hit',
    note: w.note,
    ...(w.noCrit === true ? { noCrit: true } : {}),
    // A coating is gone once the hit it was for lands.
    ...(w.once === true
      ? {
          pay: () => {
            dropOwn(a, w.id, `Used ${w.source}`);
            return true;
          },
        }
      : {}),
    remove: () => dropOwn(a, w.id, `Took ${w.source} off ${a.label}`),
  });
  /** Puts what the player typed on the weapon, and offers it. */
  const keepOwn = (a: AttackRow, own: OwnDamage): DamageExtra => {
    const w: WeaponExtra = {
      id: randomId(),
      source: own.source,
      dice: own.dice,
      ...(own.damageType === undefined ? {} : { damageType: own.damageType }),
      ...(own.once ? { once: true as const } : {}),
      ...(own.crit ? {} : { noCrit: true as const }),
      ...(own.note === undefined ? {} : { note: own.note }),
    };
    update((d) => {
      const all = d.play.weaponExtras ?? {};
      all[weaponKey(a)] = [...(all[weaponKey(a)] ?? []), w];
      d.play.weaponExtras = all;
    }, `Put ${own.source} on ${a.label}`);
    return ownExtra(a, w);
  };
  /**
   * What the character may add, as the damage prompt offers it: off, priced as
   * its Use is. A damage action spends its uses and marks a once-a-turn one;
   * one paid with a slot brings its tiles; Bardic Inspiration spends the effect.
   */
  /** An add's extras: itself, and with it what it adds against some creatures (Divine Smite's d8). */
  const addExtras = (
    add: DamageAdd,
    usedThisTurn: readonly string[],
    off = false,
  ): DamageExtra[] => {
    const own = addExtra(add, usedThisTurn, off);
    const { against } = add;
    return against === undefined ? [own] : [own, againstExtra(own, against)];
  };
  /** Dice an extra adds against some creatures, which roll only with it: the player says. */
  const againstExtra = (of: DamageExtra, against: { dice: string; who: string }): DamageExtra => ({
    key: `${of.key}:against`,
    dice: against.dice,
    source: `${of.source} vs ${against.who}`,
    damageType: of.damageType,
    label: `${of.source} damage vs ${against.who}`,
    kind: 'add',
    tag: 'if it is one',
    needs: of.key,
  });
  const addExtra = (add: DamageAdd, usedThisTurn: readonly string[], off = false): DamageExtra => {
    const base = {
      key: `add:${add.key}`,
      dice: add.dice ?? '',
      source: add.source,
      label: add.source,
      kind: 'add' as const,
      note: add.note,
      usedThisTurn: add.oncePerTurn && usedThisTurn.includes(add.key),
    };
    const { action, effectId } = add;
    if (add.kind === 'effect' && effectId !== undefined) {
      return {
        ...base,
        // Its die is the weapon's damage, so it rolls in the weapon's roll.
        folds: true,
        tag: 'once',
        pay: () => {
          rollOffersStore.getState().spend?.(effectId, true);
          return true;
        },
      };
    }
    if (action === undefined) return { ...base, tag: 'add' };
    const use = actionUse(action, sheet.resources, usedOf, paying);
    if (add.kind === 'slot' && use.slot !== undefined) {
      const cost = use.slot;
      return {
        ...base,
        tag: 'slot',
        slot: () => slotUse(action.label, action.economy, use.spends, cost, add.key),
      };
    }
    const paid = !use.noButton && !use.disabled;
    return {
      ...base,
      tag: add.oncePerTurn ? 'once a turn' : use.disabled ? 'none left' : paid ? 'paid' : 'add',
      // The dice still roll; only a use it can pay for is spent, as its chip does.
      pay: () => {
        if (paid) {
          triggerAction(action.economy, use.spends, action.label, use.regains, (d) => {
            if (add.oncePerTurn) markOnce(d, add.key, off);
          });
        } else if (add.oncePerTurn)
          update((d) => markOnce(d, add.key, off), `Used ${action.label}`);
        return true;
      },
    };
  };
  /** Spells a grant keeps prepared (a domain's), by name: their grant's row casts them. */
  const alwaysPrepared = new Set(
    sheet.grantedSpells.filter((g) => g.usage === 'prepared').map((g) => g.name.toLowerCase()),
  );
  /** A class spell's cast, as its row and a hit's damage prompt (a smite) both make it. */
  const classSpellCast = (
    sc: SpellcastingBlock,
    ref: { name: string; source: string },
  ): SpellCast => {
    const entity = spellEntity(ref.name, ref.source);
    return {
      doc,
      sheet,
      update,
      hp: hpNow,
      info: {
        name: ref.name,
        source: ref.source,
        concentration: spellConcentrationOf(ref.name, ref.source),
        economy: spellCastEconomy(ref.name, ref.source),
      },
      entity,
      level: spellLevelOf(ref.name, ref.source),
      block: sc,
      abilityModifier: sheet.abilities[sc.ability].mod,
      attack: hasSpellAttack(entity),
      entities,
    };
  };
  /**
   * A granted spell's cast, and the uses its own pool has left ("1/day"). An
   * always-prepared grant casts with class slots, as a class spell does; an
   * innate grant spends its own pool, or an item's charges, through the same
   * prompt.
   */
  const grantSpellCast = (
    g: DerivedSheet['grantedSpells'][number],
  ): {
    cast: SpellCast;
    remaining: number | undefined;
    limited: DerivedSheet['resources'][number] | undefined;
  } => {
    const entity = spellEntity(g.name, g.source);
    const block =
      sheet.spellcasting.find((sc) => sc.ability === g.ability) ??
      (g.usage === 'prepared' ? sheet.spellcasting[0] : undefined);
    const numbers = grantCast(g, sheet);
    // "1/day" grants carry their own pool; casting spends from it.
    const limited =
      g.resourceKey !== undefined
        ? sheet.resources.find((r) => r.key === g.resourceKey)
        : undefined;
    const remaining = limited !== undefined ? limited.max - usedOf(limited.key) : undefined;
    const cast: SpellCast = {
      doc,
      sheet,
      update,
      hp: hpNow,
      info: {
        name: g.name,
        source: g.source,
        concentration: spellConcentrationOf(g.name, g.source),
        economy: spellCastEconomy(g.name, g.source),
      },
      entity,
      level: spellLevelOf(g.name, g.source),
      block: g.usage === 'prepared' ? block : undefined,
      // Always prepared, so a ritual casts as one where its class's would.
      ritual:
        g.usage === 'prepared' && block !== undefined
          ? ritualWay(sheet, block, entity, doc.rulesVersion, true)
          : undefined,
      className: g.className,
      abilityModifier: numbers.mod,
      grantPool:
        limited === undefined ? undefined : { key: limited.key, label: g.origin, max: limited.max },
      numbers: grantNumbersKey(g),
      attack: numbers.attack !== undefined && hasSpellAttack(entity),
      entities,
    };
    return { cast, remaining, limited };
  };
  /**
   * The spells the character can cast now, each as its row casts it: a
   * granted one first (it may carry a free use, as Paladin's Smite does), then
   * each class's prepared spells, or its known ones where it prepares none.
   */
  const castableSpells = (): SpellCast[] => {
    const out = sheet.grantedSpells.map((g) => grantSpellCast(g).cast);
    for (const sc of sheet.spellcasting) {
      const state = doc.spellcasting[sc.classUid];
      if (state === undefined) continue;
      const prepared = new Set(state.prepared.map((r) => `${r.name}|${r.source}`.toLowerCase()));
      const prepares = sc.mode === 'prepared' || sc.mode === 'spellbook';
      for (const ref of state.known) {
        if (prepares && !prepared.has(`${ref.name}|${ref.source}`.toLowerCase())) continue;
        out.push(classSpellCast(sc, ref));
      }
    }
    return out;
  };
  /**
   * What a smite cast as the hit lands would go past this turn: the bonus action
   * it takes, used already, and (2024) the one spell slot a turn, expended.
   */
  const castWarning = (now: PlayState): string =>
    [
      now.turn?.bonus === true ? 'It takes your bonus action, which is used this turn' : '',
      doc.rulesVersion === '2024' && now.turn?.slotSpell === true
        ? 'A spell slot was expended on a spell this turn already'
        : '',
    ]
      .filter((w) => w !== '')
      .join('. ');
  /** Marks the spell concentrated on as having dealt its next hit's damage (a 2014 smite). */
  const markSpent = (name: string) =>
    update((d) => {
      const focus = d.play.concentratingOn;
      if (focus !== undefined && focus.label.toLowerCase() === name.toLowerCase())
        d.play.concentratingOn = { ...focus, spent: true };
    }, `Used ${name}`);
  /**
   * The spells that add damage to a hit with `a`, as the damage prompt offers
   * them (`hitSpell`). One cast as the hit lands (a 2024 smite) brings its ways
   * to cast as tiles, and Roll casts it: the slot, the bonus action, and
   * concentration where it needs it. One the character concentrates on adds
   * its dice at the level it was cast: on to start when it runs on them or on
   * the target they marked (Hex), else theirs to put on; a 2014 smite's is for
   * the next hit alone. One whose damage an effect in play already rolls (a
   * rider of its name) is left to that.
   */
  const spellExtras = (
    a: AttackRow,
    now: PlayState,
    riders: readonly DamageRider[],
    off = false,
  ): DamageExtra[] => {
    const focus = now.concentratingOn;
    const rolled = new Set([
      ...riders.flatMap((r) => (r.label === undefined ? [] : [r.label.toLowerCase()])),
      ...inPlay.map((e) => e.name.toLowerCase()),
    ]);
    const seen = new Set<string>();
    const out: DamageExtra[] = [];
    for (const c of castableSpells()) {
      const name = c.info.name;
      const lower = name.toLowerCase();
      if (seen.has(lower) || rolled.has(lower)) continue;
      const running = focus !== undefined && focus.label.toLowerCase() === lower;
      const spell = hitSpell(c.entity, running);
      if (spell === undefined) continue;
      if (spell.need === 'melee' && a.ranged === true) continue;
      if (spell.need === 'ranged' && a.ranged !== true) continue;
      seen.add(lower);
      const type = spell.damageType;
      const label = `${name}${type === undefined ? '' : ` ${type}`} damage`;
      const key = `spell:${lower}`;
      let extra: DamageExtra;
      if (spell.how === 'cast') {
        extra = {
          key,
          dice: spell.dice,
          source: name,
          damageType: type,
          label,
          kind: 'add',
          tag: 'spell',
          diceLabel: label,
          slot: () => castPlan(c),
          // A bonus action is the character's own turn's: an opportunity attack has none.
          ...(off
            ? { note: 'It takes a bonus action, which is only yours on your own turn' }
            : castWarning(now) === ''
              ? {}
              : { note: castWarning(now) }),
        };
      } else {
        const spent = !spell.every && focus?.spent === true;
        extra = {
          key,
          dice: castDiceAt(c, focus?.level ?? c.level, label)?.expr ?? spell.dice,
          source: name,
          damageType: type,
          label,
          kind: spell.on ? 'rider' : 'add',
          tag: spell.every ? 'concentrating' : spent ? 'dealt already' : 'next hit',
          note: spell.note,
          ...(spent ? { on: false } : {}),
          ...(spell.every
            ? {}
            : {
                pay: () => {
                  markSpent(name);
                  return true;
                },
              }),
        };
      }
      out.push(extra);
      if (spell.against !== undefined) out.push(againstExtra(extra, spell.against));
    }
    return out;
  };
  /**
   * What the character's feats add to a hit with `a`: the +10 a −5 claim on
   * its attack bought (on; offered off when no attack of it is in play), the
   * Proficiency Bonus with a Heavy weapon in the turn's Attack actions (on
   * while attacks are left, else off), and Savage Attacker's weapon dice twice
   * (on while unused this turn). Flat damage never doubles on a crit.
   */
  const featExtras = (a: AttackRow, now: PlayState): DamageExtra[] => {
    const attack = attackInPlay();
    const ofThis = attack !== undefined && attack.by === doc.id && attack.of === a.label;
    const off = opportunityInPlay(a.label);
    const used = usedOnce(now, off);
    const out: DamageExtra[] = [];
    for (const f of feats) {
      if (!featReaches(f, a)) continue;
      const key = `feat:${f.source.toLowerCase()}`;
      if (f.kind === 'power') {
        const claimed = ofThis && attack.claimed?.includes(f.source) === true;
        if (ofThis && !claimed) continue;
        out.push({
          key,
          dice: '10',
          source: f.source,
          label: f.source,
          kind: claimed ? 'rider' : 'add',
          folds: true,
          noCrit: true,
          tag: claimed ? 'claimed' : 'if claimed',
          ...(claimed ? {} : { note: 'Only if you took the −5 to hit' }),
        });
      } else if (f.kind === 'heavyMastery') {
        // Only in the Attack action on the character's turn: no opportunity attack's.
        const within = !off && (now.turn?.attacks ?? 0) <= attacksAllowed(now);
        out.push({
          key,
          dice: String(sheet.profBonus.value),
          source: f.source,
          label: f.source,
          kind: within ? 'rider' : 'add',
          folds: true,
          noCrit: true,
          tag: 'heavy weapon',
          ...(within ? {} : { note: 'Only as part of the Attack action on your turn' }),
        });
      } else if (f.after !== true) {
        const spent = used.includes(key);
        out.push({
          key,
          dice: '',
          source: f.source,
          label: f.source,
          kind: 'add',
          best: true,
          on: !spent,
          usedThisTurn: spent,
          tag: 'once a turn',
          note: 'Rolls the weapon’s dice twice and keeps the higher',
          pay: () => {
            update((d) => markOnce(d, key, off), `Used ${f.source}`);
            return true;
          },
        });
      }
    }
    return out;
  };
  /** The effects in play whose riders (Enlarge's d4) roll with a weapon's damage chip. */
  const riderLift = (a: AttackRow, raised: readonly boolean[]) => [
    ...new Set(
      a.extraDamage.flatMap((x, i) => (raised[i] === true ? [x.label ?? 'an effect in play'] : [])),
    ),
  ];
  /**
   * A weapon's damage as the damage prompt asks it: its dice and what is in
   * them, twice on a crit of this attack, its riders (on), what the player put
   * on it (on), and what the character may add (off). Built as the chip is
   * tapped, from what is left then.
   */
  const weaponDamage =
    (a: AttackRow, expr: string, label: string, riders: readonly DamageRider[]) =>
    (): DamageAsk => {
      const attack = attackInPlay();
      const crit = attack?.crit === true && attack.by === doc.id && attack.of === a.label;
      const now = playNow();
      // The damage of an opportunity attack is on another creature's turn, whose once is its own.
      const off = opportunityInPlay(a.label);
      const used = usedOnce(now, off);
      const offers = rollEffects(sheet, weaponTest(a)).offers;
      const extras: DamageExtra[] = [
        ...riders.map(
          (x, i): DamageExtra => ({
            key: `rider:${String(i)}`,
            dice: x.dice,
            source: x.label ?? a.label,
            damageType: x.damageType,
            label: damageLabel(a.label, x.damageType),
            kind: 'rider',
            folds: sameType(a, x.damageType),
            tag: 'rolls in',
          }),
        ),
        ...(now.weaponExtras?.[weaponKey(a)] ?? []).map((w) => ownExtra(a, w)),
        ...damageAdds(sheet, a, offers).flatMap((add) => addExtras(add, used, off)),
        ...spellExtras(a, now, riders, off),
        ...featExtras(a, now),
      ];
      const critDice = extraCritDice(a, expr);
      // 2014 Savage Attacker: a reroll the result offers once the damage shows, once a turn.
      const savage = feats.find(
        (f) => f.kind === 'savage' && f.after === true && featReaches(f, a),
      );
      const savageKey = savage === undefined ? '' : `feat:${savage.source.toLowerCase()}`;
      return {
        kind: 'damage',
        label,
        expr,
        damageType: a.damageType,
        parts: damageParts(a, expr, sheet.abilities),
        crit,
        ...(critDice === undefined ? {} : { critDice }),
        extras,
        addOwn: (own) => keepOwn(a, own),
        keeps: true,
        // Offered once used too, said so: the sheet cannot see whose turn it is.
        ...(savage === undefined
          ? {}
          : {
              reroll: {
                source: savage.source,
                used: used.includes(savageKey),
                pay: () => update((d) => markOnce(d, savageKey, off), `Used ${savage.source}`),
              },
            }),
      };
    };

  /** Say where HP ended up, once the taps stop; see {@link HP_SETTLE_MS}. */
  const sayHp = (after: Pick<PlayState, 'currentHp' | 'tempHp'>) =>
    announce(hpSpeech(after, maxHp.value), { key: hpKey, settleMs: HP_SETTLE_MS });
  const hpDelta = async (delta: number) => {
    const after = { currentHp: play.currentHp, tempHp: play.tempHp };
    // Healing is a plain apply; damage may force a concentration save.
    if (delta >= 0) {
      update((d) => {
        applyHp(d.play, delta, maxHp.value);
        after.currentHp = d.play.currentHp;
        after.tempHp = d.play.tempHp;
      });
      sayHp(after);
      return;
    }
    // Relentless Endurance: when the hit would drop to 0, offer 1 HP instead.
    const dmgToHp = Math.max(0, -delta - play.tempHp);
    const wouldDrop = play.currentHp > 0 && play.currentHp - dmgToHp <= 0;
    const relentless = sheet.resources.find((r) => r.key === 'relentless-endurance');
    const useRelentless =
      wouldDrop &&
      relentless !== undefined &&
      usedOf('relentless-endurance') < relentless.max &&
      (await askConfirm({
        title: 'Relentless Endurance',
        detail: 'Drop to 1 HP instead of 0? Once per long rest.',
        confirmLabel: 'Stay at 1 HP',
      }));
    let notice: Notice | null = null;
    let out: ReturnType<typeof knockedOut> | undefined;
    update((d) => {
      applyHp(d.play, delta, maxHp.value);
      if (useRelentless && d.play.currentHp === 0) {
        d.play.currentHp = 1; // never actually hit 0, so concentration holds
        const entry = d.play.resources.find((r) => r.key === 'relentless-endurance');
        if (entry !== undefined) entry.used += 1;
        else d.play.resources.push({ key: 'relentless-endurance', used: 1 });
      }
      // Dropping to 0 knocks the character out: concentration and what it
      // held end, and Rage with them.
      if (d.play.currentHp === 0) out = knockedOut(d.play, hpNow);
      notice = rollConcentration(d.play, -delta, rollConcentrationSave, hpNow);
      after.currentHp = d.play.currentHp;
      after.tempHp = d.play.tempHp;
    });
    sayHp(after);
    // What dropping to 0 set off (a moment's cue, an effect it ended), with the
    // concentration save's notice when there is one: the toast shows one at a time.
    const said = withMoments(notice, out?.moments);
    if (said !== null) notify(said);
    else if (useRelentless) {
      notify({
        title: 'Relentless Endurance',
        detail: 'Dropped to 1 HP instead of 0, used for the day',
        tone: 'good',
      });
    }
  };
  /** The card's ways into the HP sheet: each opens it on its own mode. */
  const openHpSheet = (mode: HpMode, from: HTMLElement) => {
    hpSheetFrom.current = from;
    setHpSheet({ open: true, mode });
  };
  const applyFromHpSheet = (mode: HpMode, amount: number) => {
    if (mode === 'damage') return hpDelta(-amount);
    if (mode === 'heal') return hpDelta(amount);
    // Temp HP doesn't stack: the new value replaces the old, and is nobody's effect's.
    update((d) => {
      d.play.tempHp = amount;
      delete d.play.tempHpFrom;
    });
    sayHp({ currentHp: play.currentHp, tempHp: amount });
  };
  const setUsed = (key: string, used: number) =>
    update((d) => {
      const entry = d.play.resources.find((r) => r.key === key);
      if (entry !== undefined) entry.used = used;
      else d.play.resources.push({ key, used });
    });

  return (
    <div className="flex flex-col gap-4">
      {overages.length > 0 && (
        <section className="rounded-control bg-guide-soft p-3" role="alert">
          <p className="flex items-center gap-2 text-body-strong">
            <AlertTriangle size={16} className="shrink-0 text-guide" />
            Some tracked values are above their new limits
          </p>
          <p className="mt-0.5 text-caption text-ink-muted">
            A build change or exhaustion lowered these. You can keep them as-is (house rule) or
            bring them back within range.
          </p>
          <ul className="mt-2 flex flex-col gap-0.5 text-caption">
            {overages.map((o) => (
              <li key={`${o.kind}:${o.label}`}>
                {o.label}: <span className="tabular-nums">{o.current}</span> → max{' '}
                <span className="tabular-nums">{o.max}</span>
              </li>
            ))}
          </ul>
          {/* The guide ground's own action, as on a guide banner: an outline
              would sit under 3:1 on the tint. */}
          <BannerAction
            tone="guide"
            onClick={() =>
              update((d) =>
                clampPlayStateToMax(
                  d.play,
                  sheet,
                  idleChargePools(d, sheet.resources, entities),
                  maxHp.value,
                ),
              )
            }
            className="mt-1 -mb-1.5 -ml-1.5"
          >
            Bring within limits
          </BannerAction>
        </section>
      )}
      {/* HP: the hero card (DS-001 HitPoints), and what its cues move (HpCues.tsx). */}
      <section ref={hpCues} className={`relative ${cardClass}`}>
        {/* Its name, and temp HP on a chip of its own: on the number's caption
            "+5 temp" had no room and wrapped at 375px. */}
        <div className="mb-2 flex min-h-7 flex-wrap items-center justify-between gap-2">
          <span className="text-ink-muted text-overline uppercase">Hit points</span>
          {/* Defenses sit with what they protect, in Temp HP's own shape. */}
          <span className="-mr-2 flex flex-wrap items-center justify-end">
            <DefensesChip view={defenseView(sheet, defenses)} raisedBy={defensesUp} />
            <button
              type="button"
              {...cuePart('chip')}
              aria-label={play.tempHp > 0 ? `+${play.tempHp} temporary hit points` : undefined}
              aria-haspopup="dialog"
              title="Temporary hit points"
              className={`relative -my-2 inline-flex min-h-tap items-center gap-1 whitespace-nowrap rounded-pill-tap border-8 border-transparent bg-clip-padding [--tap-inset:0.5rem] px-2 text-caption tabular-nums transition-colors duration-120 ${
                play.tempHp > 0
                  ? 'bg-ward-soft font-bold text-ward'
                  : 'font-semibold text-ink-muted ring ring-line-strong ring-inset hover:text-ink'
              }`}
              onClick={(event) => openHpSheet('temp', event.currentTarget)}
            >
              {/* The cues' flash and glint on the pill, under its words. */}
              <ChipCues />
              <CueShield />
              <span className="relative">
                {play.tempHp > 0 ? `+${play.tempHp} temp` : 'Temp HP'}
              </span>
            </button>
          </span>
        </div>
        {/* Wraps where the row cannot fit (large text), the heal pair kept
            at the right, rather than push the page sideways (A11Y-003). */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {/* Explicit amounts — a reliable single click each. (The old single/
              double-tap combo double-fired: a "double-tap −5" applied −6 and
              rolled up to three concentration saves.) Tap the total for the
              HP sheet's keypad and an exact amount. */}
          <div className="flex items-center gap-0.5">
            {/* ±5 keep their smaller circle so ±1 still reads as the main
                control, inside a 44px target (A11Y-002). They are the HP
                card's damage and heal tints; ±1 are its round steppers. */}
            <button
              type="button"
              aria-label="Damage 5 hit points"
              onClick={() => void hpDelta(-5)}
              className={FIVE}
              title="Damage 5"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-danger-soft text-danger">
                −5
              </span>
            </button>
            <button
              type="button"
              aria-label="Damage 1 hit point"
              onClick={() => void hpDelta(-1)}
              className={`${STEP} text-danger`}
              title="Damage 1"
            >
              <Minus size={24} />
            </button>
          </div>
          {/* Zero basis: the row wraps only when the HP's narrowest layout
              cannot fit, never just because a long total would rather not
              break onto two lines. The 3.25rem floor is what fits between
              the pairs at 320px; with large text it no longer fits beside
              a pair, so the total gets a line of its own rather than split
              "0 / 0" in two. Never below min-content, though: a floor that
              replaced it let a long total run into the heal pair. */}
          <button
            ref={hpNumber}
            type="button"
            className="min-w-[max(3.25rem,min-content)] grow basis-0 text-center"
            aria-haspopup="dialog"
            title="Type an exact amount"
            onClick={(event) => {
              // Used once, the tip has said what it had to.
              hpTip.dismiss();
              openHpSheet('damage', event.currentTarget);
            }}
          >
            {/* `stat` under 360px and `stat-hero` from there: three-digit HP
                between two 94px button pairs has about 50px at 320
                (A11Y-002). The total may break before "/ max" and nowhere
                else: kept on one line whole, even a two-digit total would
                push the heal pair onto a line of its own at 320px. */}
            <div
              {...cuePart('readout')}
              className="text-stat tabular-nums min-[360px]:text-stat-hero"
            >
              {/* Red while dying. The cues' tallies sit beside its digits. */}
              <span
                {...cuePart('number')}
                className={`relative inline-block origin-[50%_85%] ${dying ? 'text-danger' : ''}`}
              >
                {play.currentHp}
                <NumberCues />
              </span>{' '}
              <Lift
                on={maxHpUp.length + maxHpDown.length > 0}
                down={maxHpDown.length > 0}
                className={`rounded-chip ${maxHpUp.length + maxHpDown.length > 0 ? 'px-1' : ''}`}
              >
                <span className="whitespace-nowrap text-title-sheet text-ink-muted">
                  / {maxHp.value}
                  {sheet.maxHp.overridden ? ' •' : ''}
                </span>
              </Lift>
              {/* Spaced in the text, as a name drops one at a span's edge. */}{' '}
              <span className="sr-only">
                hit points
                {maxHpUp.length > 0 && `, maximum raised by ${maxHpUp.join(', ')}`}
                {maxHpDown.length > 0 && `, maximum lowered by ${maxHpDown.join(', ')}`}
              </span>
            </div>
            {maxHp.source !== undefined && (
              <div className="text-caption text-guide">max halved</div>
            )}
          </button>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Heal 1 hit point"
              onClick={() => void hpDelta(1)}
              className={`${STEP} text-heal`}
              title="Heal 1"
            >
              <Plus size={24} />
            </button>
            <button
              type="button"
              aria-label="Heal 5 hit points"
              onClick={() => void hpDelta(5)}
              className={FIVE}
              title="Heal 5"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-heal-soft text-heal">
                +5
              </span>
            </button>
          </div>
        </div>
        {/* HP bar: green → amber → red as it drops; temp HP shows as a cyan cap.
            The colour is a glance cue only: the numbers above say the same
            thing, and the bar is a meter that reports them (A11Y-002). */}
        {maxHp.value > 0 &&
          (() => {
            const max = maxHp.value;
            const ratio = Math.max(0, Math.min(1, play.currentHp / max));
            const color = BAND_FILL[hpBand(play.currentHp, max)];
            const tempPct = play.tempHp > 0 ? Math.min(100, (play.tempHp / max) * 100) : 0;
            // valuenow has to sit inside the range, but the text says what the
            // screen says: a house rule can leave HP above max (140 / 136).
            const now = Math.max(0, Math.min(max, play.currentHp));
            return (
              // biome-ignore lint/a11y/useSemanticElements: a native <meter> draws one fill and cannot show the temp HP cap beside it
              <div
                role="meter"
                aria-label="Hit points"
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={now}
                aria-valuetext={`${play.currentHp} of ${max}${
                  play.tempHp > 0 ? `, plus ${play.tempHp} temporary` : ''
                }`}
                {...cuePart('meter')}
                className="relative mt-3 flex h-2.5 overflow-hidden rounded-pill bg-track"
              >
                {/* The fill keeps up in 120ms: the trail under it and the
                    bloom over it show what moved. */}
                <TrailCue />
                <div
                  className={`relative h-full ${color} transition-[width,background-color] duration-120 ease-arrive`}
                  style={{ width: `${ratio * 100}%` }}
                />
                <BloomCue />
                {/* Striped `ward`, so temp HP differs from the fill in
                    pattern as well as hue. */}
                {tempPct > 0 && (
                  <div
                    className="relative h-full overflow-hidden rounded-r-pill bg-[repeating-linear-gradient(135deg,var(--cg-ward)_0_4px,transparent_4px_7px)] shadow-[inset_0_0_0_1.5px_var(--cg-ward)]"
                    style={{ width: `${tempPct}%` }}
                  >
                    <CapCues />
                  </div>
                )}
              </div>
            );
          })()}
        {/* Two across, stacked where large text would not fit both: a floor in
            rem, so it grows with the words it has to hold. */}
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-2">
          <Button
            variant="damage"
            aria-haspopup="dialog"
            onClick={(event) => openHpSheet('damage', event.currentTarget)}
          >
            <HeartCrack size={18} aria-hidden="true" className="shrink-0" /> Damage
          </Button>
          <Button
            variant="heal"
            aria-haspopup="dialog"
            onClick={(event) => openHpSheet('heal', event.currentTarget)}
          >
            <HeartPlus size={18} aria-hidden="true" className="shrink-0" /> Heal
          </Button>
        </div>
        <HpSheet
          open={hpSheet.open}
          mode={hpSheet.mode}
          hp={{ currentHp: play.currentHp, tempHp: play.tempHp, maxHp: maxHp.value }}
          defenses={defenses}
          types={defendedTypes(defenses)}
          onApply={applyFromHpSheet}
          onOpenChange={(open) => setHpSheet((s) => ({ ...s, open }))}
          openedFrom={hpSheetFrom}
        />
        {/* How to type an amount is a first-use tip (DS-001 HitPoints), not
            a line that stays on the card. */}
        {hpTip.shown && (
          <div className="mt-3">
            {/* The dismiss button goes with it: focus moves to what the tip
                was about rather than drop to the page. */}
            <Tip
              onDismiss={() => {
                hpTip.dismiss();
                hpNumber.current?.focus();
              }}
            >
              Tap the number to type an exact amount.
            </Tip>
          </div>
        )}
        {/* Wraps whole items onto a second line at 320px rather than
            breaking a hit die chip in two. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-ink-muted">
            Hit Dice:
            {Object.entries(sheet.hitDice).map(([die, total]) => {
              const left = total - (play.hitDiceSpent[die] ?? 0);
              return (
                <button
                  key={die}
                  type="button"
                  aria-label={`Spend a ${die} hit die, ${left} left`}
                  title={`Spend a hit die (${die})`}
                  disabled={left <= 0}
                  onClick={() => healWithHitDie(die)}
                  className="min-h-6 whitespace-nowrap rounded-chip bg-surface-raised px-2 text-ink tabular-nums hover:bg-surface-hover unavailable:bg-surface-raised unavailable:text-ink-faint"
                >
                  <b>{Math.max(0, left)}</b> of {total} {die}
                </button>
              );
            })}
          </div>
          <BreakdownSheet
            title="Max HP"
            value={sheet.maxHp}
            built={built.maxHp}
            onOverride={(v) =>
              update((d) => {
                if (v === null) delete d.overrides.maxHp;
                else d.overrides.maxHp = { value: v };
              })
            }
            trigger={
              <button type="button" className={LINK}>
                How is this worked out?
              </button>
            }
          >
            {/* 2014 exhaustion halves the maximum on top of all of this. */}
            {maxHp.source !== undefined ? (
              <p className="text-body text-guide">
                {maxHp.source} halves it to <strong className="tabular-nums">{maxHp.value}</strong>.
                Exhaustion&apos;s sheet, from the condition strip, can switch that off.
              </p>
            ) : undefined}
          </BreakdownSheet>
        </div>
        <GlowCue />
      </section>

      {/* Death saves */}
      {dying && (
        <section className={cardClass}>
          <div className="mb-2 text-heading text-danger">Death saving throws</div>
          <div className="mb-2 -mx-1">
            <RollEffectCue
              lines={effectLines(deathEffects, deathRiders.advantage)}
              notes={noteLines(deathEffects)}
              rolls="death save"
              ignored={ignore.armed('death')}
              onIgnore={() => ignore.toggle('death')}
            />
          </div>
          {/* Successes over failures, each circle in a 44px target
              (A11Y-002); Roll save wraps under them on a narrow phone. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {(['success', 'fail'] as const).map((kind) => (
                <div key={kind} className="flex items-center">
                  <span className="w-14 text-caption text-ink-muted capitalize">{kind}</span>
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`Death save ${kind} ${n}`}
                      aria-pressed={play.deathSaves[kind] >= n}
                      onClick={() =>
                        update((d) => {
                          d.play.deathSaves[kind] = d.play.deathSaves[kind] >= n ? n - 1 : n;
                        })
                      }
                      className="tap rounded-full"
                    >
                      {/* Marked: filled `heal` or `danger`. Unmarked: an empty
                          `line-strong` ring, so the two differ in shape. */}
                      <span
                        aria-hidden="true"
                        className={`size-5 rounded-full border-2 ${
                          play.deathSaves[kind] >= n
                            ? kind === 'success'
                              ? 'border-heal bg-heal'
                              : 'border-danger bg-danger'
                            : 'border-line-strong'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <Button
              variant="brand"
              size="sm"
              // Asked in the roll prompt like any d20 test, so a DM's
              // advantage can be picked there; tapped again, it rolls.
              onClick={(event) =>
                rollFrom(
                  event.currentTarget,
                  () =>
                    d20Ask('1d20', {
                      label: 'Death save',
                      effects: deathEffects,
                      ignored: ignore.take('death', deathEffects),
                      // Bless reaches a death save; it is settled on the
                      // spot, so nothing is offered after it.
                      riders: { ...deathRiders, offers: [] },
                    }),
                  (r) =>
                    update((d) => {
                      const nat = r.meta?.d20?.natural;
                      const saves = d.play.deathSaves;
                      if (nat === 20) {
                        // Natural 20: back up with 1 hit point.
                        d.play.currentHp = 1;
                        d.play.deathSaves = { success: 0, fail: 0 };
                      } else if (nat === 1) {
                        saves.fail = Math.min(3, saves.fail + 2);
                      } else if (r.total >= 10) {
                        saves.success = Math.min(3, saves.success + 1);
                      } else {
                        saves.fail = Math.min(3, saves.fail + 1);
                      }
                    }),
                )
              }
              title="Roll a death save: successes and failures fill in automatically (nat 1 = two failures, nat 20 = back up on 1 HP)"
            >
              {/* The one next step while dying, so the one `brand` button. */}
              <D20Icon size={16} /> Roll save
            </Button>
          </div>
        </section>
      )}

      {/* Core tiles: one strip, its cells divided by `line` hairlines. */}
      <section className={`@container text-center ${FLUSH}`}>
        <div className="grid grid-cols-2 @min-[18rem]:grid-cols-4">
          {/* A raised cell takes a green edge, which a condition on it gives up,
              and a mark centred on its bottom right corner (the buffs canvas,
              round 7). Tap Armor Class or Speed for the sum. */}
          <BreakdownSheet
            title={`Armor Class (${sheet.acFormulaLabel})`}
            value={sheet.ac}
            built={built.ac}
            onOverride={(v) =>
              update((d) => {
                if (v === null) delete d.overrides.ac;
                else d.overrides.ac = { value: v };
              })
            }
            trigger={
              <button
                type="button"
                className={`${WORN_TILE} rounded-tl-card @min-[18rem]:rounded-bl-card`}
              >
                <ChipFace
                  surface="cell"
                  wear={NOT_WORN}
                  rolls={0}
                  showing={false}
                  lift={acUp.length + acDown.length > 0}
                  down={acDown.length > 0}
                >
                  <span className="block text-stat tabular-nums">{sheet.ac.value}</span>
                  <span className={`block ${TILE_LABEL}`}>
                    Armor Class{sheet.ac.overridden ? ' •' : ''}
                    {acUp.length > 0 && (
                      <span className="sr-only">, raised by {acUp.join(', ')}</span>
                    )}
                    {acDown.length > 0 && (
                      <span className="sr-only">, lowered by {acDown.join(', ')}</span>
                    )}
                  </span>
                </ChipFace>
              </button>
            }
          >
            {sheet.acNotCounted.length > 0 ? (
              <ul aria-label="Not counted" className="flex flex-col gap-1 text-caption">
                {sheet.acNotCounted.map((n) => (
                  <li key={`${n.label}:${n.why}`} className="text-ink-muted">
                    Not counted: {n.label} ({n.value}),{' '}
                    {n.why === 'lower'
                      ? 'lower than the AC that counts'
                      : n.why === 'floor'
                        ? 'a floor under an AC already higher'
                        : n.why === 'untrained'
                          ? 'no shield training'
                          : 'the override stands in for it'}
                  </li>
                ))}
              </ul>
            ) : undefined}
          </BreakdownSheet>
          <button
            type="button"
            onClick={(event) =>
              rollFrom(
                event.currentTarget,
                () =>
                  d20Ask(`1d20${fmt(sheet.initiative.value)}`, {
                    label: 'Initiative',
                    effects: initiativeEffects,
                    ignored: ignore.take('initiative', initiativeEffects),
                    riders: pricedRollEffects(
                      rollEffects(sheet, { kind: 'initiative' }),
                      sheet,
                      doc.play,
                    ),
                  }),
                initiativeRoll.rolled,
                {
                  face: {
                    text: signed(sheet.initiative.value),
                    wear: rollWear(conditions, initiativeEffects, ignore.armed('initiative')),
                    lift: initiativeUp.length + initiativeDown.length > 0,
                    down: initiativeDown.length > 0,
                  },
                },
              )
            }
            className={`${WORN_TILE} rounded-tr-card border-line border-l @min-[18rem]:rounded-tr-none`}
          >
            <ChipFace
              surface="cell"
              wear={rollWear(conditions, initiativeEffects, ignore.armed('initiative'))}
              rolls={initiativeRoll.rolls}
              showing={initiativeRoll.showing}
              lift={initiativeUp.length + initiativeDown.length > 0}
              down={initiativeDown.length > 0}
            >
              <span className="cx-ink block text-roll text-stat tabular-nums">
                {signed(sheet.initiative.value)}
              </span>
              <span className={`cx-ink flex items-center justify-center gap-0.75 ${TILE_LABEL}`}>
                Initiative <D20Icon size={14} className="shrink-0" />
                {initiativeUp.length > 0 && (
                  <span className="sr-only">, raised by {initiativeUp.join(', ')}</span>
                )}
                {initiativeDown.length > 0 && (
                  <span className="sr-only">, lowered by {initiativeDown.join(', ')}</span>
                )}
              </span>
            </ChipFace>
          </button>
          <BreakdownSheet
            title="Speed"
            value={{ ...sheet.speedWalk, value: speed.value }}
            built={built.speedWalk}
            onOverride={(v) =>
              update((d) => {
                if (v === null) delete d.overrides['speed.walk'];
                else d.overrides['speed.walk'] = { value: v };
              })
            }
            trigger={
              <button
                type="button"
                className={`${WORN_TILE} rounded-bl-card border-line border-t @min-[18rem]:rounded-bl-none @min-[18rem]:border-t-0 @min-[18rem]:border-l`}
              >
                <ChipFace
                  surface="cell"
                  wear={conditionWear(conditions, speed.sources)}
                  rolls={0}
                  showing={false}
                  lift={speedUp.length + speedDown.length > 0}
                  down={speedDown.length > 0}
                >
                  <span className="block text-stat tabular-nums">
                    {speed.value}
                    <small className="cx-ink ml-0.5 font-semibold text-[0.875rem] text-ink-muted tracking-normal">
                      ft
                    </small>
                    {speed.value < sheet.speedWalk.value && (
                      <span className="cx-ink ml-1.5 align-middle font-normal text-body text-ink-muted line-through">
                        <span className="sr-only">, down from </span>
                        {sheet.speedWalk.value}
                      </span>
                    )}
                  </span>
                  <span className={`cx-ink block ${TILE_LABEL}`}>
                    Speed{sheet.speedWalk.overridden ? ' •' : ''}
                    {speed.sources.length > 0 && (
                      <span
                        className={`cx-ink ${speed.value < sheet.speedWalk.value ? 'text-guide' : ''}`}
                      >
                        {' '}
                        · {speed.sources.join(', ')}
                      </span>
                    )}
                    {speedUp.length > 0 && (
                      <span className="sr-only">, raised by {speedUp.join(', ')}</span>
                    )}
                    {speedDown.length > 0 && (
                      <span className="sr-only">, lowered by {speedDown.join(', ')}</span>
                    )}
                  </span>
                </ChipFace>
              </button>
            }
          >
            {speed.value !== sheet.speedWalk.value || sheet.otherSpeeds.length > 0 ? (
              <div className="flex flex-col gap-1 text-caption">
                {speed.value !== sheet.speedWalk.value && (
                  <p>
                    Walking {sheet.speedWalk.value} ft., then {speed.sources.join(', ')}:{' '}
                    <strong className="tabular-nums">{speed.value} ft.</strong>
                  </p>
                )}
                {sheet.otherSpeeds.map((o) => (
                  <p key={o.mode} className="text-ink-muted">
                    <span className="capitalize">{o.mode}</span> {o.value} ft.: {o.origin}
                  </p>
                ))}
              </div>
            ) : undefined}
          </BreakdownSheet>
          <div className={`${TILE} border-line border-t border-l @min-[18rem]:border-t-0`}>
            <div className="text-stat tabular-nums">{signed(sheet.profBonus.value)}</div>
            <div className={TILE_LABEL}>Proficiency</div>
          </div>
        </div>
      </section>

      {/* Under the strip, what conditions say about it: initiative's cue, and
          attacks against the character, which their sheet cannot roll and so
          only states. */}
      {(effectLines(initiativeEffects).length > 0 ||
        noteLines(initiativeEffects).length > 0 ||
        against.length > 0 ||
        sheet.cues.length > 0) && (
        <section className="-mt-2 flex flex-col gap-1">
          {/* What the effects in play say with nothing to work out: a help, a
              ward, a cost, a fact. Each names what says it. */}
          {sheet.cues.length > 0 && (
            <ul aria-label="From effects in play" className="flex flex-col gap-0.5 px-1">
              {sheet.cues.map((cue) => {
                const { Icon, className } = CUE_TONE[cue.tone];
                return (
                  <li
                    key={`${cue.origin}:${cue.text}`}
                    className={`flex gap-1.5 text-caption ${className}`}
                  >
                    <Icon size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <span>
                      {cue.text}: {cue.origin}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <RollEffectCue
            heading="Initiative"
            lines={effectLines(initiativeEffects)}
            notes={noteLines(initiativeEffects)}
            rolls="initiative roll"
            ignored={ignore.armed('initiative')}
            onIgnore={() => ignore.toggle('initiative')}
          />
          {against.length > 0 && (
            <ul aria-label="Attacks against you" className={`flex flex-col ${HELP}`}>
              {against.map((line) => (
                <li key={line.text}>
                  {line.text}: {line.sources.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Inspiration + concentration */}
      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={play.inspiration}
          onClick={() => update((d) => void (d.play.inspiration = !d.play.inspiration))}
          className={`${TOGGLE} ${play.inspiration ? 'bg-guide-soft text-guide' : TOGGLE_OFF}`}
          title={
            doc.rulesVersion === '2024'
              ? 'Heroic Inspiration: spend it to reroll a die you just rolled'
              : 'Inspiration: spend it for advantage on an attack, save or check'
          }
        >
          {/* Filled while held: a change of shape as well as colour. */}
          <Star size={16} fill={play.inspiration ? 'currentColor' : 'none'} className="shrink-0" />
          <span className="truncate">Inspiration</span>
          <span aria-hidden="true" className={play.inspiration ? 'font-bold' : 'font-normal'}>
            {play.inspiration ? 'On' : 'Off'}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={play.concentratingOn !== undefined}
          onClick={async () => {
            if (play.concentratingOn !== undefined) {
              update((d) => void setConcentration(d.play, undefined, hpNow));
              return;
            }
            const label = await askText({
              title: 'Concentrating on…',
              placeholder: 'For example, Bless',
            });
            if (label !== null && label.trim() !== '') {
              update((d) => void setConcentration(d.play, { label: label.trim() }, hpNow));
            }
          }}
          // Sized by its content, so a spell's whole name shows, on a line of
          // its own where it does not fit beside Inspiration.
          className={`${TOGGLE} ${
            play.concentratingOn !== undefined ? 'bg-arcane-soft py-1 text-arcane' : TOGGLE_OFF
          }`}
          title="Concentration: tap to set or clear"
        >
          <Brain size={16} className="shrink-0" />
          {play.concentratingOn !== undefined ? (
            // On, the spell's name takes the place of the word On (DS-001
            // ToggleChip). The name to hear says the same in a sentence.
            <span className="min-w-0 wrap-anywhere">
              <span aria-hidden="true">Concentrating:</span>{' '}
              <span className="sr-only">Concentrating on</span>{' '}
              <span className="font-bold">{play.concentratingOn.label}</span>
            </span>
          ) : (
            <>
              <span className="truncate">Concentration</span>
              <span aria-hidden="true" className="font-normal">
                Off
              </span>
            </>
          )}
        </button>
        {play.concentratingOn !== undefined && (
          <div className="basis-full">
            <RollEffectCue
              heading="Concentration saves"
              lines={effectLines(concentrationEffects, concentrationRiders.advantage)}
              notes={noteLines(concentrationEffects)}
              rolls="concentration save"
              ignored={ignore.armed('concentration')}
              onIgnore={() => ignore.toggle('concentration')}
            />
          </div>
        )}
      </section>

      {/* Turn tracker: action economy. */}
      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <h2 className="text-heading">This turn</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // What starts or ends with the turn, said in the toast after.
              let said: Notice | null = null;
              update((d) => {
                const extraBack = d.play.turn?.extra ?? [];
                d.play.turn = { action: false, bonus: false, reaction: false };
                // A start-of-turn moment's lines join the rest, with its tone
                // (a warning warns) and where it came from.
                const { moments, ...turn } = newTurn(d.play, hpNow);
                const lines = newTurnLines(turn, extraBack, d.play.tempHp);
                if (lines.length > 0 || (moments !== undefined && momentLines(moments).length > 0))
                  said = withMoments(
                    { title: 'New turn', detail: lines.join(' · '), tone: 'info' },
                    moments,
                  );
              }, 'New turn');
              if (said !== null) notify(said);
            }}
            className="-my-1 -mr-1 ml-auto"
            title="Reset action, bonus action, and reaction"
          >
            <RefreshCw size={16} aria-hidden="true" /> New turn
          </Button>
        </div>
        {/* Wraps where the row is too narrow for all three (large text)
            instead of pushing the page sideways (A11Y-003). */}
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['action', 'Action'],
              ['bonus', 'Bonus action'],
              ['reaction', 'Reaction'],
            ] as const
          ).map(([key, label]) => {
            const used = play.turn?.[key] ?? false;
            // Extra Attack: how many of the Attack action's attacks are made.
            const made = play.turn?.attacks ?? 0;
            const allowed = attacksAllowed(play);
            const attacksWords =
              allowed > 1 && made > 0 && used
                ? made <= allowed
                  ? `${String(made)} of ${String(allowed)} attacks`
                  : `${String(made)} attacks, ${String(allowed)} this turn`
                : undefined;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={used}
                onClick={() =>
                  update((d) => {
                    const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
                    turn[key] = !turn[key];
                    d.play.turn = turn;
                  })
                }
                // Three equal slots, so all ink (DS-001 TurnTracker): ready is
                // an outline, used fills and strikes the name. Each says its
                // state in words; the word is left out of the name, which a
                // toggle keeps whatever its state (aria-pressed says it).
                className={`flex min-h-15 flex-1 flex-col items-center justify-center gap-0.5 rounded-control px-2 text-label transition-colors duration-120 ${
                  used
                    ? 'bg-surface-raised text-ink-muted'
                    : 'text-ink ring ring-line-strong ring-inset hover:bg-surface-raised'
                }`}
                title={
                  used
                    ? `${label} used: tap to undo`
                    : `Tap when you use your ${label.toLowerCase()}`
                }
              >
                <span className={used ? 'line-through decoration-[1.5px]' : undefined}>
                  {label}
                </span>
                <span
                  aria-hidden="true"
                  className="font-normal text-[0.6875rem] text-ink-muted leading-3.5"
                >
                  {key === 'action' && attacksWords !== undefined
                    ? attacksWords
                    : used
                      ? 'Used'
                      : 'Ready'}
                </span>
              </button>
            );
          })}
        </div>
        {/* A box an effect adds (Haste's action), outlined in heal green for
            the effect, which each new turn resets. Its note says what it can
            do while ready. */}
        {sheet.extraActions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {sheet.extraActions.map((x) => {
              const used = play.turn?.extra?.includes(x.label) ?? false;
              return (
                <button
                  key={x.label}
                  type="button"
                  aria-pressed={used}
                  onClick={() =>
                    update((d) => {
                      const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
                      const extra = (turn.extra ?? []).filter((e) => e !== x.label);
                      if (!used) extra.push(x.label);
                      if (extra.length > 0) turn.extra = extra;
                      else delete turn.extra;
                      d.play.turn = turn;
                    })
                  }
                  className={`flex min-h-15 flex-1 flex-col items-center justify-center gap-0.5 rounded-control px-3 py-2 text-center text-label transition-colors duration-120 ${
                    used
                      ? 'bg-surface-raised text-ink-muted'
                      : 'text-ink ring-[1.5px] ring-heal ring-inset hover:bg-surface-raised'
                  }`}
                  title={used ? `${x.label} used: tap to undo` : `Tap when you use your ${x.label}`}
                >
                  <span className={used ? 'line-through decoration-[1.5px]' : undefined}>
                    {x.label}
                  </span>
                  <span className="font-normal text-[0.6875rem] text-ink-muted leading-3.5">
                    {used ? 'Used' : (x.note ?? 'Ready')}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Resources with pips */}
      {sheet.resources.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className={H2}>Resources</h2>
          {/* One list, a row per pool: its name and when it comes back on the
              left, the pips (or a point pool's stepper) at the end, wrapping
              under the name where a long pool does not fit beside it. */}
          <div className={listClass}>
            {sheet.resources.map((r) => {
              const used = usedOf(r.key);
              const info = findFeatureInfo(sheet.features, r.label, r.origin);
              return (
                <div
                  key={r.key}
                  className="flex min-h-14 flex-wrap items-center justify-end gap-x-2 py-1 pr-2 pl-4"
                >
                  <div className="flex min-w-0 flex-1 basis-32 flex-col items-start py-1">
                    {info !== undefined ? (
                      <FeatureInfoSheet
                        title={info.title}
                        subtitle={r.origin}
                        entries={info.entries}
                        trigger={
                          <button
                            type="button"
                            className={`min-h-6 min-w-6 text-left text-body-strong ${RULES} underline-offset-4`}
                            title="What does this do?"
                          >
                            {r.label}
                          </button>
                        }
                      />
                    ) : (
                      <span className="text-body-strong">{r.label}</span>
                    )}
                    <span className="text-caption text-ink-muted">{backCaption(r)}</span>
                  </div>
                  {r.foretell === true ? (
                    <ForetoldNumbers
                      pool={r}
                      used={used}
                      numbers={play.foretold?.[r.key]}
                      onUse={(v) =>
                        update(
                          (d) =>
                            void payOffer(d.play, {
                              spends: [{ key: r.key, max: r.max, amount: 1 }],
                              reaction: false,
                              words: `uses the foretold ${v}`,
                              foretold: { key: r.key, v },
                            }),
                          `Used ${r.label}'s ${v}`,
                        )
                      }
                      onRoll={(count) =>
                        update((d) => {
                          d.play.foretold = {
                            ...d.play.foretold,
                            [r.key]: Array.from({ length: count }, () => roll('1d20').total),
                          };
                        }, `Rolled ${r.label}`)
                      }
                    />
                  ) : r.max > 12 ? (
                    // Point pools (Lay on Hands, ki, sorcery points) outgrow
                    // pips fast, and pips can't even reach uses beyond the
                    // twelfth; a stepper covers the whole range. ±5 as well as
                    // ±1, because a level 20 paladin heals out of a 100-point
                    // pool and single taps would not get there.
                    <div className="flex items-center gap-1.5">
                      {([5, 1] as const).map((step) => (
                        <button
                          key={`spend-${String(step)}`}
                          type="button"
                          aria-label={`Spend ${step} ${r.label}`}
                          onClick={() => setUsed(r.key, Math.min(r.max, used + step))}
                          disabled={used >= r.max}
                          className={POOL_STEP}
                        >
                          −{step}
                        </button>
                      ))}
                      <span className="min-w-16 text-center text-body-strong tabular-nums">
                        {r.max - used}
                        <span className="font-normal text-ink-muted"> / {r.max}</span>
                      </span>
                      {([1, 5] as const).map((step) => (
                        <button
                          key={`restore-${String(step)}`}
                          type="button"
                          aria-label={`Restore ${step} ${r.label}`}
                          onClick={() => setUsed(r.key, Math.max(0, used - step))}
                          disabled={used === 0}
                          className={POOL_STEP}
                        >
                          +{step}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-end">
                      <Pips
                        total={r.max}
                        spent={used}
                        onChange={(next) => setUsed(r.key, next)}
                        label={(use) => `${r.label} use ${use}`}
                        tone="ink"
                        title={`${r.max - used} of ${r.max} left`}
                      />
                      {/* The count in words: a row of dots is no quick read past
                          three or four. */}
                      <span className="pr-2 pl-1 text-caption text-ink-muted tabular-nums">
                        {r.max - used} of {r.max}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Attacks */}
      {sheet.attacks.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className={H2}>Attacks</h2>
          {limitWarning("Can't take actions", limits.noActions)}
          {attackCue()}
          <div className={`@container ${openListClass}`}>
            {sheet.attacks.map((a) => {
              const before = built.attacks.find((b) => b.label === a.label);
              const lift = attackLift(a, before);
              const drop = attackDrop(a, before);
              return (
                <div key={a.label} className={`min-h-15 ${ROW} py-2 pr-3 pl-4`}>
                  <div className="min-w-0 flex-1 basis-18">
                    {(() => {
                      const info = weaponInfoEntries(
                        registry,
                        a.label,
                        a.properties,
                        doc.rulesVersion,
                      );
                      return info !== undefined ? (
                        <FeatureInfoSheet
                          title={a.label}
                          entries={info}
                          trigger={
                            <button
                              type="button"
                              className={`min-h-6 max-w-full text-left text-body-strong ${NAME} ${RULES} underline-offset-4`}
                            >
                              {a.label}
                            </button>
                          }
                        />
                      ) : (
                        <div className={`text-body-strong ${NAME}`}>{a.label}</div>
                      );
                    })()}
                    <div className={`text-caption text-ink-muted ${NAME}`}>{attackSubtitle(a)}</div>
                  </div>
                  {/* Drops under the name rather than squeezing it: a versatile
                    weapon with a damage rider carries four chips, which is one
                    more than a narrow phone fits on a line. */}
                  <div className={`${ROW_ACTIONS} gap-1.5`}>
                    <RollChip
                      expr={`1d20${fmt(a.toHit.value)}`}
                      display={signed(a.toHit.value)}
                      label={`${a.label} attack`}
                      variant="d20"
                      roller={rollAttack(
                        a.toHit.value,
                        `${a.label} attack`,
                        weaponTest(a),
                        a.label,
                        powerClaims(a),
                      )}
                      wear={attackChipWear}
                      raisedBy={lift.hit ? raisedBy(a.toHit, before?.toHit) : []}
                      loweredBy={drop.hit}
                      onRolled={() => markAttack(a.label)}
                      damageAfter={{
                        expr: a.damage,
                        label: damageLabel(a.label, a.damageType),
                        withAttack: attackDamage(a.label, extraCritDice(a, a.damage)),
                        ask: weaponDamage(
                          a,
                          a.damage,
                          damageLabel(a.label, a.damageType),
                          a.extraDamage,
                        ),
                      }}
                      nextAttack={nextAttack}
                    />
                    {/* Damage asks first (the damage prompt): the riders roll
                      in there, each type apart, since a target immune to fire
                      still takes the slashing, so they have no chips of their
                      own to roll twice by mistake. An effect's rider raises
                      the chips it rolls with. */}
                    <RollChip
                      expr={a.damage}
                      label={damageLabel(a.label, a.damageType)}
                      variant="damage"
                      raisedBy={[
                        ...(lift.damage ? lift.damageBy : []),
                        ...riderLift(a, lift.riders),
                      ]}
                      loweredBy={drop.damage}
                      withAttack={attackDamage(a.label, extraCritDice(a, a.damage))}
                      damagePrompt={weaponDamage(
                        a,
                        a.damage,
                        damageLabel(a.label, a.damageType),
                        a.extraDamage,
                      )}
                    />
                    {a.versatileDamage !== undefined && (
                      <RollChip
                        expr={a.versatileDamage}
                        label={`${damageLabel(a.label, a.damageType)} (two-handed)`}
                        variant="damage"
                        raisedBy={[
                          ...(lift.versatile ? lift.damageBy : []),
                          ...riderLift(a, lift.riders),
                        ]}
                        loweredBy={drop.versatile}
                        withAttack={attackDamage(a.label, extraCritDice(a, a.versatileDamage))}
                        damagePrompt={weaponDamage(
                          a,
                          a.versatileDamage,
                          `${damageLabel(a.label, a.damageType)} (two-handed)`,
                          a.extraDamage,
                        )}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Action economy */}
      {sheet.actions.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className={H2}>Actions</h2>
          {/* One tip at a time: this one waits for the HP card's to go. */}
          {rulesTip.shown && !hpTip.shown && (
            <Tip onDismiss={rulesTip.dismiss}>Tap a name for its rules.</Tip>
          )}
          <div className="flex flex-wrap gap-1.5">
            {sheet.actions.map((a) => {
              const info = findFeatureInfo(sheet.features, a.label, a.origin);
              // Damage added to a hit once a turn (Sneak Attack): rolled here,
              // it is marked used for the turn, as the damage prompt marks it.
              const once = a.roll !== undefined && oncePerTurn(entriesText(info?.entries));
              // Action Surge: one more action, so one more Attack action's attacks.
              const surges = capabilityKey(a.label) === 'action surge';
              // What it spends: a use of the pool sharing its name, and the pool
              // its cost names. See `actionUse`.
              const use = actionUse(a, sheet.resources, usedOf, paying);
              // What its Use puts in play (Rage, Innate Sorcery), and that
              // effect while it lasts, when the Use button becomes End.
              const starts = namedStart(a, doc);
              const started =
                starts === undefined
                  ? undefined
                  : inPlay.find((e) => e.mine === true && answersTo(e, starts.name));
              const rowKey = `${a.origin}:${a.label}:${a.economy}`;
              const recent = () => Date.now() - (startedAt.current.get(rowKey) ?? 0) < 1000;
              const stamp = () => startedAt.current.set(rowKey, Date.now());
              // Using it marks the right slice of the turn and spends the pips,
              // and puts in play what it starts, in the same update.
              const trigger = async (from: HTMLElement | null = null) => {
                if (use.slot !== undefined) {
                  payWithSlot(from, a.label, a.economy, use.spends, use.slot, rowKey);
                  return;
                }
                if (use.hitDie !== undefined) {
                  payWithHitDie(from, a.label, a.economy, use.spends, use.hitDie, rowKey);
                  return;
                }
                if (starts === undefined) {
                  triggerAction(a.economy, use.spends, a.label, use.regains, (d) => {
                    if (once) markOnce(d, rowKey, opportunityInPlay());
                    if (surges) markSurge(d);
                  });
                  return;
                }
                if (recent()) return;
                const focus = play.concentratingOn?.label;
                if (starts.endsConcentration && focus !== undefined) {
                  // It names what you would lose, and only asks when there is something.
                  const pick = await askChoice({
                    title: `Start ${a.label}?`,
                    detail: `You cannot concentrate while raging, so this ends ${focus}.`,
                    options: [
                      { id: 'start', label: `${a.label} and end ${focus}` },
                      { id: 'keep', label: 'Keep concentrating' },
                    ],
                  });
                  if (pick !== 'start') return;
                }
                stamp();
                triggerAction(a.economy, use.spends, a.label, use.regains, (d) => {
                  if (starts.endsConcentration) setConcentration(d.play, undefined, hpNow);
                  applyEffect(d.play, starts.build(randomId()), hpNow);
                });
              };
              const end = () => {
                if (started === undefined || recent()) return;
                stamp();
                update((d) => void endEffect(d.play, started.id, hpNow), `Ended ${started.name}`);
              };
              // A named start with no uses left says so, rather than a dead Use.
              const noneLeft = starts !== undefined && use.disabled;
              const useWord = noneLeft ? 'None left' : 'Use';
              const useVerb = noneLeft ? 'None left of' : 'Use';
              // Incapacitating conditions stop actions/bonus actions/reactions.
              // A rider takes none of those.
              const blocked = a.economy === 'none' ? [] : limits.noActions;
              const economyLabel =
                a.economy === 'bonus'
                  ? 'bonus action'
                  : a.economy === 'reaction'
                    ? 'reaction'
                    : 'action';
              // A feature with a chip per slot (summon with an action, command with a
              // bonus action) shows the same name twice, so each says its slot.
              const sharesName =
                sheet.actions.filter((b) => b.origin === a.origin && b.label === a.label).length >
                1;
              const slot = sharesName
                ? economyLabel.charAt(0).toUpperCase() + economyLabel.slice(1)
                : undefined;
              const mechanics = [
                slot,
                a.note,
                a.save !== undefined
                  ? `${a.save.dc === undefined ? '' : `DC ${a.save.dc} `}${a.save.targetAbility.toUpperCase()} save`
                  : undefined,
                ...use.caption,
              ]
                .filter((s) => s !== undefined)
                .join(' · ');
              const name =
                info !== undefined ? (
                  <FeatureInfoSheet
                    title={info.title}
                    subtitle={[a.origin, mechanics].filter((s) => s !== '').join(' · ')}
                    entries={info.entries}
                    trigger={
                      <button
                        type="button"
                        className={`min-h-6 text-left ${RULES} underline-offset-4`}
                      >
                        {a.label}
                      </button>
                    }
                  />
                ) : (
                  a.label
                );
              return (
                <span
                  key={rowKey}
                  // Ink, whatever the economy: green and blue outlines read as
                  // statuses, and colour alone is no way to say which slot an
                  // action spends (DS-001 TurnTracker). The Use button's
                  // title says it.
                  className={`flex flex-col ${FLUSH} px-3 py-1.5`}
                >
                  {/* With large text, Use or the roll wraps under the name. */}
                  <span className="flex flex-wrap items-center gap-1.5">
                    {name}
                    {blocked.length > 0 && (
                      <span
                        className="text-guide"
                        title={`${blocked.join(', ')}: you normally can't take ${
                          a.economy === 'action' ? 'an' : 'a'
                        } ${economyLabel}`}
                      >
                        <AlertTriangle size={14} />
                        {/* lucide hides the icon, so without this nothing is read. */}
                        <span className="sr-only">
                          {`${blocked.join(', ')}: you normally can't take ${
                            a.economy === 'action' ? 'an' : 'a'
                          } ${economyLabel}`}
                        </span>
                      </span>
                    )}
                    {a.roll !== undefined ? (
                      <RollChip
                        expr={a.roll}
                        label={a.label}
                        variant={
                          a.heals === true ? 'heal' : a.plainDice === true ? 'dice' : 'damage'
                        }
                        // The dice still roll; only a use it can pay for is recorded.
                        // A once-a-turn one is marked used either way, as the damage
                        // prompt marks it: on an opportunity attack's turn when one is
                        // in play.
                        onRolled={
                          use.noButton || use.disabled
                            ? once
                              ? () =>
                                  update(
                                    (d) => markOnce(d, rowKey, opportunityInPlay()),
                                    `Used ${a.label}`,
                                  )
                              : undefined
                            : () => void trigger()
                        }
                        // Damage with no save is added to a hit (Sneak Attack, a
                        // smite), so a crit doubles it; a save's (Breath Weapon)
                        // is no attack's.
                        withAttack={a.save === undefined ? attackDamage() : undefined}
                      />
                    ) : started !== undefined ? (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`End ${a.label}`}
                        onClick={end}
                        className="-my-1.5"
                        title={`End ${started.name}: what it does stops, and the use stays spent`}
                      >
                        End
                      </Button>
                    ) : use.noButton ? null : (
                      <Button
                        variant="outline"
                        size="sm"
                        // Its name starts with what it shows (WCAG 2.5.3).
                        aria-label={
                          slot === undefined
                            ? `${useVerb} ${a.label}`
                            : `${useVerb} ${a.label}, ${economyLabel}`
                        }
                        onClick={(event) => void trigger(event.currentTarget)}
                        disabled={use.disabled}
                        className="-my-1.5"
                        title={use.title}
                      >
                        {useWord}
                      </Button>
                    )}
                    {use.paid !== undefined && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={use.paid.ariaLabel}
                        onClick={() =>
                          use.paid !== undefined &&
                          triggerAction(a.economy, use.paid.spends, a.label)
                        }
                        disabled={use.paid.disabled}
                        className="-my-1.5"
                        title={use.paid.title}
                      >
                        {use.paid.label}
                      </Button>
                    )}
                    {use.restore !== undefined && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={use.restore.ariaLabel}
                        onClick={(event) => {
                          const { restore } = use;
                          if (restore === undefined) return;
                          if (restore.slot !== undefined) {
                            restoreWithSlot(event.currentTarget, restore, rowKey);
                          } else restoreUse(restore);
                        }}
                        disabled={use.restore.disabled}
                        className="-my-1.5"
                        title={use.restore.title}
                      >
                        Restore
                      </Button>
                    )}
                  </span>
                  {mechanics !== '' && (
                    <span className="text-caption text-ink-muted">{mechanics}</span>
                  )}
                  {/* Rage in heavy armor: said, never stopped. */}
                  {starts?.inHeavyArmor !== undefined && sheet.heavyArmor !== undefined && (
                    <span className="flex gap-1.5 text-caption text-guide">
                      <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                      {`${sheet.heavyArmor}: ${starts.inHeavyArmor}`}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Passive combat options: things you can always do (Extra Attack,
          Magic Resistance, …) that aren't already a limited-use action chip
          above. Race traits live nested inside the race card, so the collector
          walks named sub-entries too. */}
      {(() => {
        const actionNames = new Set(sheet.actions.map((a) => capabilityKey(a.label)));
        const caps = collectCapabilityCards(sheet.features, actionNames);
        if (caps.length === 0) return null;
        return (
          <section className="flex flex-col gap-1.5">
            <h2 className={H2}>Combat options</h2>
            <p className={HELP}>Things you can always do.</p>
            <div className={listClass}>
              {caps.map((cap) => (
                <FeatureInfoSheet
                  key={cap.key}
                  title={cap.name}
                  subtitle={cap.origin}
                  entries={cap.entries}
                  trigger={
                    <button
                      type="button"
                      className="flex min-h-14 flex-col justify-center px-4 py-2 text-left"
                    >
                      <span className={`text-body-strong ${RULES} underline-offset-4`}>
                        {cap.name}
                      </span>
                      <span className="text-caption text-ink-muted">{cap.blurb}</span>
                    </button>
                  }
                />
              ))}
            </div>
          </section>
        );
      })()}

      {spellsMissing && <PackProblem packs={spellPacks} what="spell details" />}

      {/* Spell slots (spend/restore) — the leveled pool is character-wide,
          so render its pips only on the first casting class. */}
      {sheet.spellcasting.map((sc, scIdx) => (
        <section key={sc.classUid} className={cardClass}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-heading">{sc.className} spellcasting</span>
            <span className="flex flex-wrap gap-1">
              <SaveDcBadge
                value={sc.saveDc.value}
                raisedBy={saveDcRaisedBy(sc, built)}
                loweredBy={saveDcLoweredBy(sc, built)}
              />
              <Badge tone="arcane">
                Attack <strong>{signed(sc.attackMod.value)}</strong>
              </Badge>
            </span>
          </div>
          <NoSpellsCue sheet={sheet} className="mb-2" />
          <SpellSlots
            block={sc}
            play={play}
            update={update}
            showSlots={scIdx === sheet.spellcasting.findIndex((b) => b.slots.some((n) => n > 0))}
            shared={sheet.spellcasting.length > 1}
          />

          {/* Known / prepared spells, castable right here */}
          {(() => {
            const state = doc.spellcasting[sc.classUid];
            if (state === undefined || state.known.length === 0) return null;
            const preparedUids = new Set(
              state.prepared.map((r) => `${r.name}|${r.source}`.toLowerCase()),
            );
            // A class that prepares its spells casts those here, and a
            // wizard's unprepared rituals as rituals; the rest wait on Spells,
            // a tap from preparing. A cantrip is never prepared, always cast,
            // and a spell whose level no file says yet stays, as it was.
            const prepares = sc.mode === 'prepared' || sc.mode === 'spellbook';
            let unprepared = 0;
            const rows = state.known.flatMap((ref) => {
              const entity = spellEntity(ref.name, ref.source);
              const prepared =
                !prepares ||
                typeof entity?.level !== 'number' ||
                entity.level === 0 ||
                preparedUids.has(`${ref.name}|${ref.source}`.toLowerCase());
              const ritual = ritualWay(sheet, sc, entity, doc.rulesVersion, prepared);
              if (prepared || ritual === 'only') return [{ ref, entity, ritual }];
              // Always prepared too: its grant's row below casts it.
              if (!alwaysPrepared.has(ref.name.toLowerCase())) unprepared += 1;
              return [];
            });
            // Sorted by level (cantrips first), then name — not alphabetically.
            rows.sort(
              (a, b) =>
                spellLevelOf(a.ref.name, a.ref.source) - spellLevelOf(b.ref.name, b.ref.source) ||
                a.ref.name.localeCompare(b.ref.name),
            );
            // A leveled spell ready to cast, else the line below says none is
            // prepared: an always-prepared grant's row counts.
            const anyPrepared =
              alwaysPrepared.size > 0 ||
              rows.some((r) => r.ritual !== 'only' && r.entity?.level !== 0);
            return (
              <div className="@container mt-2 flex flex-col gap-1 border-line border-t pt-2">
                {rows.some((r) => hasSpellAttack(r.entity)) && attackCue('Spell attacks')}
                {rows.map(({ ref, entity, ritual }) => {
                  const uid = `${ref.name}|${ref.source}`.toLowerCase();
                  const ritualOnly = ritual === 'only';
                  const prepared = preparedUids.has(uid);
                  const tag = prepared ? 'prepared' : ritualOnly ? 'ritual' : undefined;
                  const subtitle = `${sc.className} spell${tag === undefined ? '' : ` · ${tag}`}`;
                  const level = spellLevelOf(ref.name, ref.source);
                  if (entity === undefined && spellsSettling) {
                    return (
                      <PendingSpellRow
                        key={uid}
                        name={ref.name}
                        source={ref.source}
                        version={doc.rulesVersion}
                        subtitle={subtitle}
                        className="min-h-10"
                      />
                    );
                  }
                  // Already running, a concentration spell's dice are the slot it
                  // was cast with, and rolling them spends nothing more.
                  const running = isConcentratingOn(play, ref.name);
                  const hasAttack = hasSpellAttack(entity);
                  const cast = { ...classSpellCast(sc, ref), ritual };
                  return (
                    <div key={uid} className={`min-h-10 ${ROW}`}>
                      <div className={ROW_NAME}>
                        <span className="w-6 shrink-0 text-caption text-ink-muted">
                          {typeof entity?.level !== 'number' ? (
                            <span title="Level unknown: this spell isn't in the downloaded data">
                              ?<span className="sr-only"> level unknown</span>
                            </span>
                          ) : level === 0 ? (
                            'c'
                          ) : (
                            `L${level}`
                          )}
                        </span>
                        <SpellInfoSheet
                          name={ref.name}
                          source={ref.source}
                          version={doc.rulesVersion}
                          subtitle={subtitle}
                          trigger={
                            <button
                              type="button"
                              className={`min-h-6 min-w-0 flex-1 text-left ${NAME} ${RULES} underline-offset-2 ${
                                ritualOnly ? 'text-ink-muted' : ''
                              }`}
                            >
                              {ref.name}
                              {/* Where the name wraps, `wbr` lets the tag move
                                  to the next line whole rather than break
                                  mid-word, with no space added to the name.
                                  Hidden where the name truncates, since
                                  Chromium breaks at a `wbr` even then. */}
                              {tag !== undefined && (
                                <>
                                  <wbr className="@min-[15rem]:hidden" />
                                  <span className="ml-1.5 text-arcane text-caption">{tag}</span>
                                </>
                              )}
                            </button>
                          }
                        />
                        {limits.noVerbal.length > 0 && spellHasVerbal(ref.name, ref.source) && (
                          <span
                            className="shrink-0 text-guide"
                            title={`${limits.noVerbal.join(', ')}: you can't speak, and this spell has a verbal component`}
                          >
                            <AlertTriangle size={14} />
                            <span className="sr-only">
                              {`${limits.noVerbal.join(', ')}: you can't speak, and this spell has a verbal component`}
                            </span>
                          </span>
                        )}
                      </div>
                      <span className={`${ROW_ACTIONS} gap-1`}>
                        <SpellCastChips
                          cast={cast}
                          running={running}
                          runningLevel={play.concentratingOn?.level}
                          attack={
                            hasAttack
                              ? {
                                  expr: `1d20${fmt(sc.attackMod.value)}`,
                                  display: `Atk ${signed(sc.attackMod.value)}`,
                                  roller: rollAttack(
                                    sc.attackMod.value,
                                    `${ref.name} spell attack`,
                                    {
                                      kind: 'attack',
                                      attack: 'spell',
                                      className: sc.className,
                                      ability: sc.ability,
                                      ...spellRange(entity),
                                    },
                                    ref.name,
                                  ),
                                }
                              : undefined
                          }
                          wear={attackChipWear}
                          castWear={castWear}
                          castTitle={
                            level === 0
                              ? 'Cast cantrip (marks the action economy its casting time uses)'
                              : 'Cast: choose how to cast it'
                          }
                        />
                      </span>
                    </div>
                  );
                })}
                {unprepared > 0 && (
                  <p className="text-caption text-ink-muted">
                    {anyPrepared
                      ? `${String(unprepared)} more not prepared. `
                      : 'No spells prepared. '}
                    {/* Relative to the sheet: Play is its index route. */}
                    <Link to="spells" className={LINK}>
                      Prepare on Spells
                    </Link>
                  </p>
                )}
              </div>
            );
          })()}
        </section>
      ))}

      {/* Innate / granted spells — cast per their own rules (no slots) */}
      {sheet.grantedSpells.length > 0 && (
        <section className={cardClass}>
          <div className="mb-1 text-heading">Innate &amp; granted spells</div>
          <div className="@container flex flex-col gap-1">
            {sheet.grantedSpells.some(
              (g) =>
                grantCast(g, sheet).attack !== undefined &&
                hasSpellAttack(spellEntity(g.name, g.source)),
            ) && attackCue('Spell attacks')}
            {sheet.grantedSpells.map((g) => {
              const entity = spellEntity(g.name, g.source);
              const subtitle = `${g.origin}${g.usage === 'prepared' ? ' · always prepared' : ''}`;
              if (entity === undefined && spellsSettling) {
                return (
                  <PendingSpellRow
                    key={grantRowKey(g)}
                    name={g.name}
                    source={g.source}
                    version={doc.rulesVersion}
                    subtitle={subtitle}
                    className="min-h-11 border-line border-b py-1.5 last:border-b-0"
                  />
                );
              }
              const numbers = grantCast(g, sheet);
              const attackModifier = numbers.attack;
              const running = isConcentratingOn(play, g.name);
              const { cast, remaining, limited } = grantSpellCast(g);
              const hasAttack = attackModifier !== undefined && hasSpellAttack(entity);
              // Rolling dice is always allowed, but a spent grant must not go
              // on marking your action and your concentration: most limited
              // spells cast through a roll chip rather than the Cast button, so
              // guarding only the button would leave the limit unenforced for
              // every one of them.
              const depleted = remaining !== undefined && remaining <= 0;
              const usedUp = grantUsedUp(cast, remaining);
              return (
                <div
                  key={grantRowKey(g)}
                  className={`min-h-11 ${ROW} border-line border-b py-1.5 last:border-b-0`}
                >
                  <div className={g.ability !== undefined ? ROW_NAME : ROW_NAME_WIDE}>
                    <SpellInfoSheet
                      name={g.name}
                      source={g.source}
                      version={doc.rulesVersion}
                      subtitle={subtitle}
                      footer={
                        g.added ? <RemoveAddedSpell name={g.name} update={update} /> : undefined
                      }
                      trigger={
                        // Name and badges on one line while there is room;
                        // with large text the badges wrap under the name. An
                        // added spell's mark is too long to share the line
                        // with a short name and its uses, so its badges wrap.
                        <button
                          type="button"
                          className={`flex min-h-6 min-w-0 ${
                            g.ability !== undefined ? 'flex-1' : 'grow'
                          } flex-wrap items-center gap-1.5 text-left ${
                            g.added ? '' : '@min-[15rem]:flex-nowrap'
                          }`}
                        >
                          <span
                            className={`min-w-0 capitalize ${NAME} ${RULES} underline-offset-2`}
                          >
                            {g.name}
                          </span>
                          {g.usage === 'prepared' && (
                            <Badge className="shrink-0">Always prepared</Badge>
                          )}
                          {g.added && (
                            <Badge tone="guide" className="shrink-0">
                              Outside your class
                            </Badge>
                          )}
                          {remaining !== undefined && limited !== undefined && (
                            <span
                              title={grantBadgeTitle(g.usage, g.origin, depleted)}
                              // Uses left of an innate spell are magic's to spend,
                              // so `arcane`; spent, a neutral badge.
                              className={`shrink-0 ${badgeClass(depleted ? 'neutral' : 'arcane')}`}
                            >
                              {remaining}/{limited.max} {grantLimitWords(g.usage)}
                            </span>
                          )}
                        </button>
                      }
                    />
                    <span
                      className={`${
                        g.ability !== undefined ? 'shrink-0' : 'ml-auto min-w-0'
                      } text-caption text-ink-muted`}
                    >
                      {g.ability !== undefined ? g.ability.toUpperCase() : g.origin}
                    </span>
                    {limits.noVerbal.length > 0 && spellHasVerbal(g.name, g.source) && (
                      <span
                        className="shrink-0 text-guide"
                        title={`${limits.noVerbal.join(', ')}: you can't speak, and this spell has a verbal component`}
                      >
                        <AlertTriangle size={14} />
                        <span className="sr-only">
                          {`${limits.noVerbal.join(', ')}: you can't speak, and this spell has a verbal component`}
                        </span>
                      </span>
                    )}
                  </div>
                  <span className={`${ROW_ACTIONS} gap-1`}>
                    {spellSaves(entity).length > 0 && numbers.dc !== undefined && (
                      <Badge tone="arcane">DC {numbers.dc}</Badge>
                    )}
                    <SpellCastChips
                      cast={cast}
                      running={running}
                      runningLevel={play.concentratingOn?.level}
                      usedUp={usedUp}
                      attack={
                        hasAttack
                          ? {
                              expr: `1d20${fmt(attackModifier)}`,
                              display: `Atk ${signed(attackModifier)}`,
                              roller: rollAttack(
                                attackModifier,
                                `${g.name} spell attack`,
                                {
                                  kind: 'attack',
                                  attack: 'spell',
                                  className: g.className,
                                  ability: g.ability,
                                  ...spellRange(entity),
                                },
                                g.name,
                              ),
                            }
                          : undefined
                      }
                      wear={attackChipWear}
                      castWear={castWear}
                      castTitle={
                        cast.block === undefined && limited === undefined
                          ? 'Cast (marks the action economy its casting time uses)'
                          : 'Cast: choose how to cast it'
                      }
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Rests, last: they end a stretch of play rather than take part in a
          turn, and a long rest should not be a thumb's slip from the slots.
          How long each takes and what a long one heals follow the table's
          rules, each a chip opening its sheet (the Rules board, C). */}
      <section aria-labelledby={`${restId}-h`} className="flex flex-col gap-2">
        <h2 id={`${restId}-h`} className="sr-only">
          Rests
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            // Always a sheet: hit dice to spend, what comes back, and which
            // effects in play the rest ends.
            onClick={() => setRestAsked({ rest: 'short', open: true })}
            className={buttonClass({ variant: 'outline' })}
          >
            <Hourglass size={18} /> Short rest
          </button>
          <button
            type="button"
            onClick={async () => {
              if (inPlay.length > 0) {
                setRestAsked({ rest: 'long', open: true });
                return;
              }
              const ok = await askConfirm({
                title: 'Long rest',
                detail: longRestDetail(rules.hpOnLongRest),
                confirmLabel: 'Rest',
              });
              if (ok) finishRest('long', NONE);
            }}
            className={buttonClass({ variant: 'outline' })}
          >
            <Moon size={18} /> Long rest
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <RestRule id="restLength" value={rules.restLength} onOpen={setRuleOpen} />
          <RestRule id="hpOnLongRest" value={rules.hpOnLongRest} onOpen={setRuleOpen} />
        </div>
      </section>
      <RuleSheet rule={ruleOpen} onClose={() => setRuleOpen(null)} character={{ doc, update }} />
      <RestSheet
        rest={restAsked.rest}
        length={rules.restLength}
        open={restAsked.open}
        effects={inPlay}
        {...(restAsked.rest === 'long'
          ? { detail: longRestDetail(rules.hpOnLongRest) }
          : {
              short: {
                hp: { current: play.currentHp, max: maxHp.value, temp: play.tempHp },
                hitDice: Object.entries(sheet.hitDice).map(([die, total]) => ({
                  die,
                  total,
                  left: Math.max(0, total - (play.hitDiceSpent[die] ?? 0)),
                })),
                onSpendHitDie: healWithHitDie,
                // Worked out only while it is asked; the sheet keeps the first.
                restores: restAsked.open ? shortRestWouldRestore(play, sheet) : [],
                recoveries: slotRecoveries(play, sheet),
                spentSlots: spentSlots(play, sheet),
              },
            })}
        onOpenChange={(open) => setRestAsked((was) => ({ ...was, open }))}
        onRest={(rest, ends, recover) => {
          setRestAsked((was) => ({ ...was, open: false }));
          finishRest(rest, ends, recover);
        }}
      />
    </div>
  );
}
