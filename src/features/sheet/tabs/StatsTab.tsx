import { useOutletContext } from 'react-router';
import { type D20Effects, type D20Test, d20Effects } from '@/engine/conditions';
import { defensesInForce, rollEffects } from '@/engine/playRules';
import { ABILITIES, type Ability } from '@/engine/types';
import { signed } from '@/lib/signed';
import { rollLogStore } from '@/stores/rollLog';
import { BreakdownParts, BreakdownSheet } from '@/ui/BreakdownSheet';
import { ChipFace, type ChipWear, useRollMoment } from '@/ui/ChipFace';
import { D20Icon } from '@/ui/D20Icon';
import { Tip, useTip } from '@/ui/Hint';
import { Lift } from '@/ui/Lift';
import { ProfDot } from '@/ui/ProfDot';
import { listClass } from '@/ui/surfaces';
import { DefenseLines } from '../Defenses';
import {
  effectLines,
  noteLines,
  type RollGroup,
  rollD20Test,
  rollWear,
  saveEffectLines,
  useIgnoreOnce,
} from '../d20Tests';
import { conditionsInForce, defenseView, raised, raisedBy } from '../effectsInPlay';
import { RollEffectCue } from '../RollEffectCue';
import type { CharacterSheetState } from '../useCharacterSheet';

/** A modifier for a dice expression, whose parser reads a hyphen; on screen, see `signed`. */
const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** A tile on `bg` (DS-001): `surface`, a `line` hairline, `shadow-card` in light. */
const TILE = 'bg-surface shadow-card ring-1 ring-line ring-inset';

/** A section heading inside a screen, as Settings has them. */
const H2 = 'px-1 text-heading';

/** One line of the senses and proficiencies list. */
const ROW = 'px-4 py-3';

/** A press rolls: one fill step on hover, the roll tint while held. */
const ROLLS = 'transition-colors duration-120 hover:bg-surface-raised active:bg-roll-soft';

/**
 * The saves: three across, but never a tile narrower than 5.75rem, which
 * holds "● CHA +3" on one line; six across from `sm` once six such tiles fit
 * (37rem, gaps included). Both are in rem, so with larger text the grid drops
 * to two columns, then one, instead of the row spilling out sideways (WCAG
 * 1.4.4, `layout.spec.ts`), and it is always 6, 3, 2 or 1 across, never a
 * row of four over two. The section is the query container.
 */
const SAVES =
  'grid grid-cols-[repeat(auto-fit,minmax(max(5.75rem,(100%_-_1rem)/3),1fr))] gap-2 sm:@min-[37rem]:grid-cols-6';

type Sheet = NonNullable<CharacterSheetState['sheet']>;

/**
 * An ability: its check bonus to tap and roll, the score pill under it for its
 * breakdown. The bonus is the modifier unless something adds to every check of
 * the ability: half proficiency (2014 Jack of All Trades) puts its mark by the
 * name, and the pill's sheet then shows the check's math too. A condition's tint
 * goes on the whole tile, which holds both buttons, and only the number moves.
 */
function AbilityTile({
  name,
  ability,
  check,
  wear,
  lifted,
  onRoll,
}: {
  name: Ability;
  ability: Sheet['abilities'][Ability];
  check: Sheet['checks'][Ability];
  wear: ChipWear;
  /** The effects in play that raised its score or its check. */
  lifted: readonly string[];
  onRoll: () => void;
}) {
  const moment = useRollMoment();
  return (
    <Lift on={lifted.length > 0} className="flex min-w-0 rounded-card">
      <div className={`relative flex min-w-0 flex-1 rounded-card ${TILE}`}>
        <ChipFace surface="tile" wear={wear} rolls={moment.rolls} showing={moment.showing}>
          {/* The mark stays outside the uppercase label, so its words are not
            shouted, and in ink as on the skill rows. With large text in a narrow
            tile it wraps above the label rather than pushing the pair out of the
            tile. */}
          <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5">
            {check.halfProf && <ProfDot level="half" />}
            <span className="cx-ink text-ink-muted text-overline uppercase">{name}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              onRoll();
              moment.rolled();
            }}
            aria-label={`Roll ${name.toUpperCase()} check (${signed(check.total.value)})${
              lifted.length > 0 ? `, raised by ${lifted.join(', ')}` : ''
            }`}
            className={`min-h-tap min-w-tap rounded-control px-2 text-stat tabular-nums ${ROLLS}`}
            title={`Roll ${name.toUpperCase()} check`}
          >
            <span className="cx-move">{signed(check.total.value)}</span>
          </button>
          <BreakdownSheet
            title={`${name.toUpperCase()} score`}
            value={ability}
            trigger={
              <button
                type="button"
                aria-label={`${name.toUpperCase()} score ${ability.value}${
                  ability.overridden ? ' (set manually)' : ''
                }: breakdown`}
                // A thumb-sized target around the small score pill
                // (A11Y-003: it was 13 by 16, under even axe's 24px floor):
                // the pill is what shows, the transparent rest takes the
                // tap. The negative margin spends the card's bottom
                // padding, so the card grows less than the target does.
                className="group tap -mb-2"
              >
                <span className="cx-ink h-5.5 min-w-8.5 rounded-full bg-surface-raised px-2 text-center text-ink-muted text-label leading-5.5 tabular-nums transition-colors duration-120 group-hover:bg-surface-hover">
                  {ability.value}
                  {ability.overridden ? '•' : ''}
                </span>
              </button>
            }
          >
            {check.total.parts.length > 1 ? (
              <div className="flex flex-col gap-1">
                <p className="flex justify-between gap-3 font-semibold text-body">
                  <span>{name.toUpperCase()} check</span>
                  <span className="tabular-nums">{signed(check.total.value)}</span>
                </p>
                <BreakdownParts parts={check.total.parts} />
              </div>
            ) : undefined}
          </BreakdownSheet>
        </ChipFace>
      </div>
    </Lift>
  );
}

/**
 * A save: a proficiency dot where the old fill was. The button's name stays
 * "STR +2", which never said the level either.
 */
function SaveButton({
  name,
  save,
  wear,
  lifted,
  onRoll,
}: {
  name: Ability;
  save: Sheet['saves'][Ability];
  wear: ChipWear;
  /** The effects in play that raised it. */
  lifted: readonly string[];
  onRoll: () => void;
}) {
  const moment = useRollMoment();
  // Its ring is the face's, so it moves as Paralyzed or Petrified moves the face.
  return (
    <button
      type="button"
      onClick={() => {
        onRoll();
        moment.rolled();
      }}
      className={`relative flex min-h-tap min-w-0 flex-1 rounded-control text-ink ${TILE} ${ROLLS}`}
    >
      <ChipFace
        surface="save"
        wear={wear}
        rolls={moment.rolls}
        showing={moment.showing}
        lift={lifted.length > 0}
      >
        <span className="inline-flex items-center gap-2 text-label">
          <ProfDot level={save.prof ? 1 : 0} decorative />
          <span className="cx-ink text-ink-muted">{name.toUpperCase()}</span>
        </span>{' '}
        <span className="font-bold tabular-nums">{signed(save.total.value)}</span>
        {lifted.length > 0 && <span className="sr-only">, raised by {lifted.join(', ')}</span>}
      </ChipFace>
    </button>
  );
}

/**
 * The skills: whole-row rolls in ink rather than the roll blue, so 18 rows do not
 * read as links, with a faint die that says the row rolls. A condition reaches
 * every skill alike, so it wears the whole card, and its motion stays out of the
 * rows, so no one skill looks singled out.
 */
function SkillsCard({
  skills,
  wear,
  onRoll,
}: {
  skills: Sheet['skills'];
  wear: ChipWear;
  onRoll: (name: string, skill: Sheet['skills'][string]) => void;
}) {
  const moment = useRollMoment();
  return (
    <div className={`relative ${listClass}`}>
      <ChipFace surface="card" wear={wear} rolls={moment.rolls} showing={moment.showing}>
        <span className="flex flex-col divide-y divide-line">
          {Object.entries(skills).map(([name, s]) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                onRoll(name, s);
                moment.rolled();
              }}
              className={`flex min-h-tap items-center gap-3 pr-3 pl-4 text-left text-ink ${ROLLS}`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <ProfDot level={s.halfProf ? 'half' : s.prof} />
                {name}
                <span className="cx-ink font-semibold text-[0.75rem] text-ink-muted uppercase leading-4 tracking-[0.04em]">
                  {s.ability}
                </span>
              </span>
              <span className="min-w-9 text-right font-bold tabular-nums">
                {signed(s.total.value)}
              </span>
              <D20Icon size={16} className="cx-ink shrink-0 text-ink-faint" />
            </button>
          ))}
        </span>
      </ChipFace>
    </div>
  );
}

export function Component() {
  const { sheet, built: builtSheet, doc } = useOutletContext<CharacterSheetState>();
  const ignore = useIgnoreOnce(JSON.stringify(doc?.play.conditions ?? []));
  const rollTip = useTip('tap-to-roll');
  if (sheet === null) return <p className="text-body text-ink-muted">Deriving…</p>;

  // What the character's conditions do to checks and saves: applied to each
  // roll, said above the rolls they reach, and "Ignore once" for one roll.
  // One the character is immune to is held off, as one switched off is.
  const edition = doc?.rulesVersion ?? '2014';
  const immune = { immune: sheet.conditionImmunities };
  const conditions = conditionsInForce(doc?.play.conditions ?? [], sheet.conditionImmunities);
  const checkEffects = (ability: Ability) =>
    d20Effects(conditions, edition, { kind: 'check', ability }, immune);
  const saveEffects = Object.fromEntries(
    ABILITIES.map((a) => [
      a,
      d20Effects(conditions, edition, { kind: 'save', ability: a }, immune),
    ]),
  ) as Record<Ability, D20Effects>;
  // The build alone, so the numbers an effect raised wear its ring.
  const built = builtSheet ?? sheet;
  const abilityLift = (a: Ability) =>
    raised(sheet.abilities[a], built.abilities[a])
      ? raisedBy(sheet.abilities[a], built.abilities[a])
      : raisedBy(sheet.checks[a].total, built.checks[a].total);
  // No condition singles out one ability's checks, so any one speaks for all.
  const checkCue = (
    <RollEffectCue
      lines={effectLines(checkEffects('str'))}
      notes={noteLines(checkEffects('str'))}
      rolls="ability check"
      ignored={ignore.armed('check')}
      onIgnore={() => ignore.toggle('check')}
    />
  );
  /** A check or save, with what the effects in play bring to it (Bless, Guidance). */
  const rollTest = (
    label: string,
    modifier: number,
    group: RollGroup,
    effects: D20Effects,
    test: D20Test,
  ) =>
    rollLogStore.getState().append(
      rollD20Test(`1d20${fmt(modifier)}`, {
        label,
        effects,
        ignored: ignore.take(group, effects),
        riders: rollEffects(sheet, test),
      }),
    );

  return (
    <div className="flex flex-col gap-6">
      {/* How to roll is a first-use tip (DS-001 Hint), not a line that stays. */}
      {rollTip.shown && (
        <Tip onDismiss={rollTip.dismiss}>
          Tap any modifier to roll it. The switch at the bottom applies to every roll.
        </Tip>
      )}
      {/* Abilities, with any cue for checks over them. */}
      <div className="flex flex-col gap-2">
        {checkCue}
        <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITIES.map((a) => (
            <AbilityTile
              key={a}
              name={a}
              ability={sheet.abilities[a]}
              check={sheet.checks[a]}
              wear={rollWear(conditions, checkEffects(a), ignore.armed('check'))}
              lifted={abilityLift(a)}
              onRoll={() =>
                rollTest(
                  `${a.toUpperCase()} check`,
                  sheet.checks[a].total.value,
                  'check',
                  checkEffects(a),
                  { kind: 'check', ability: a },
                )
              }
            />
          ))}
        </section>
      </div>

      <section className="@container flex flex-col gap-2">
        <h2 className={H2}>Saving throws</h2>
        <RollEffectCue
          lines={saveEffectLines(saveEffects)}
          rolls="save"
          ignored={ignore.armed('save')}
          onIgnore={() => ignore.toggle('save')}
        />
        <div className={SAVES}>
          {ABILITIES.map((a) => (
            <SaveButton
              key={a}
              name={a}
              save={sheet.saves[a]}
              wear={rollWear(conditions, saveEffects[a], ignore.armed('save'))}
              lifted={raisedBy(sheet.saves[a].total, built.saves[a].total)}
              onRoll={() =>
                rollTest(
                  `${a.toUpperCase()} save`,
                  sheet.saves[a].total.value,
                  'save',
                  saveEffects[a],
                  { kind: 'save', ability: a },
                )
              }
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={H2}>Skills</h2>
        {checkCue}
        <SkillsCard
          skills={sheet.skills}
          wear={rollWear(conditions, checkEffects('str'), ignore.armed('check'))}
          onRoll={(name, s) =>
            rollTest(`${name} check`, s.total.value, 'check', checkEffects(s.ability), {
              kind: 'check',
              ability: s.ability,
              skill: name,
            })
          }
        />
      </section>

      {/* What changes the damage the character takes, written out: no tap needed. */}
      <section className="flex flex-col gap-2">
        <h2 className={H2}>Defenses</h2>
        <DefenseLines view={defenseView(sheet, defensesInForce(sheet, conditions, edition))} />
      </section>

      {/* Passives, senses, proficiencies, languages */}
      <section className={`${listClass} text-body`}>
        <div className={`flex items-center justify-between gap-3 ${ROW}`}>
          <span className="text-ink-muted">Passive Perception</span>
          <strong className="font-bold tabular-nums">{sheet.passivePerception.value}</strong>
        </div>
        {sheet.senses.length > 0 && (
          <div className={ROW}>
            <span className="text-ink-muted">Senses: </span>
            {sheet.senses.map((s) => `${s.sense} ${s.range} ft.`).join(', ')}
          </div>
        )}
        {sheet.languages.length > 0 && (
          <div className={ROW}>
            <span className="text-ink-muted">Languages: </span>
            {sheet.languages.join(', ')}
          </div>
        )}
        {(sheet.armorProfs.length > 0 ||
          sheet.weaponProfs.length > 0 ||
          sheet.toolProfs.length > 0) && (
          <div className={ROW}>
            <span className="text-ink-muted">Proficiencies: </span>
            {[...sheet.armorProfs, ...sheet.weaponProfs, ...sheet.toolProfs].join(', ')}
          </div>
        )}
      </section>
    </div>
  );
}
