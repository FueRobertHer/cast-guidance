import { useOutletContext } from 'react-router';
import { type D20Effects, d20Effects } from '@/engine/conditions';
import { ABILITIES, type Ability } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { D20Icon } from '@/ui/D20Icon';
import { ProfDot } from '@/ui/ProfDot';
import { listClass } from '@/ui/surfaces';
import {
  effectLines,
  noteLines,
  type RollGroup,
  rollD20Test,
  saveEffectLines,
  useIgnoreOnce,
} from '../d20Tests';
import { RollEffectCue } from '../RollEffectCue';
import type { CharacterSheetState } from '../useCharacterSheet';

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

export function Component() {
  const { sheet, doc } = useOutletContext<CharacterSheetState>();
  const conditions = doc?.play.conditions ?? [];
  const ignore = useIgnoreOnce(JSON.stringify(conditions));
  if (sheet === null) return <p className="text-body text-ink-muted">Deriving…</p>;

  // What the character's conditions do to checks and saves: applied to each
  // roll, said above the rolls they reach, and "Ignore once" for one roll.
  const edition = doc?.rulesVersion ?? '2014';
  const checkEffects = (ability: Ability) =>
    d20Effects(conditions, edition, { kind: 'check', ability });
  const saveEffects = Object.fromEntries(
    ABILITIES.map((a) => [a, d20Effects(conditions, edition, { kind: 'save', ability: a })]),
  ) as Record<Ability, D20Effects>;
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
  const rollTest = (label: string, modifier: number, group: RollGroup, effects: D20Effects) =>
    rollLogStore.getState().append(
      rollD20Test(`1d20${fmt(modifier)}`, {
        label,
        effects,
        ignored: ignore.take(group, effects),
      }),
    );

  return (
    <div className="flex flex-col gap-6">
      {/* A neutral tip (DS-001): `surface-raised`, with the die where the
          emoji was. */}
      <p className="flex gap-3 rounded-control bg-surface-raised p-3 text-[0.875rem] leading-5">
        <D20Icon size={18} className="mt-px shrink-0 text-ink-muted" />
        <span>Tap any modifier to roll it — the DIS/N/ADV switch applies to every roll.</span>
      </p>
      {/* Abilities, modifier first: tap the modifier to roll a check, the score
          pill under it for its breakdown; any cue for checks over them. */}
      <div className="flex flex-col gap-2">
        {checkCue}
        <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITIES.map((a) => {
            const ability = sheet.abilities[a];
            return (
              <div
                key={a}
                className={`flex flex-col items-center rounded-card px-1 pt-3 pb-2 ${TILE}`}
              >
                <span className="text-ink-muted text-overline uppercase">{a}</span>
                <button
                  type="button"
                  onClick={() =>
                    rollTest(`${a.toUpperCase()} check`, ability.mod, 'check', checkEffects(a))
                  }
                  aria-label={`Roll ${a.toUpperCase()} check (${fmt(ability.mod)})`}
                  className={`min-w-tap rounded-control px-2 text-stat tabular-nums ${ROLLS}`}
                  title={`Roll ${a.toUpperCase()} check`}
                >
                  {fmt(ability.mod)}
                </button>
                <BreakdownSheet
                  title={`${a.toUpperCase()} score`}
                  value={ability}
                  trigger={
                    <button
                      type="button"
                      aria-label={`${a.toUpperCase()} score ${ability.value}${
                        ability.overridden ? ' (set manually)' : ''
                      }: breakdown`}
                      // A thumb-sized target around the small score pill
                      // (A11Y-003: it was 13 by 16, under even axe's 24px floor):
                      // the pill is what shows, the transparent rest takes the
                      // tap. The negative margin spends the card's bottom
                      // padding, so the card grows less than the target does.
                      className="group tap -mb-2"
                    >
                      <span className="h-5.5 min-w-8.5 rounded-full bg-surface-raised px-2 text-center text-ink-muted text-label leading-5.5 tabular-nums transition-colors duration-120 group-hover:bg-surface-hover">
                        {ability.value}
                        {ability.overridden ? '•' : ''}
                      </span>
                    </button>
                  }
                />
              </div>
            );
          })}
        </section>
      </div>

      {/* Saves: a proficiency dot where the old fill was. The button's name
          stays "STR +2", which never said the level either. */}
      <section className="@container flex flex-col gap-2">
        <h2 className={H2}>Saving throws</h2>
        <RollEffectCue
          lines={saveEffectLines(saveEffects)}
          rolls="save"
          ignored={ignore.armed('save')}
          onIgnore={() => ignore.toggle('save')}
        />
        <div className={SAVES}>
          {ABILITIES.map((a) => {
            const save = sheet.saves[a];
            return (
              <button
                key={a}
                type="button"
                onClick={() =>
                  rollTest(`${a.toUpperCase()} save`, save.total.value, 'save', saveEffects[a])
                }
                className={`flex min-h-tap items-center justify-between gap-2 rounded-control px-3 text-ink ${TILE} ${ROLLS}`}
              >
                <span className="inline-flex items-center gap-2 text-label">
                  <ProfDot level={save.prof ? 1 : 0} decorative />
                  <span className="text-ink-muted">{a.toUpperCase()}</span>
                </span>{' '}
                <span className="font-bold tabular-nums">{fmt(save.total.value)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Skills: whole-row rolls in ink rather than the roll blue, so 18 rows
          do not read as links, with a faint die that says the row rolls. */}
      <section className="flex flex-col gap-2">
        <h2 className={H2}>Skills</h2>
        {checkCue}
        <div className={listClass}>
          {Object.entries(sheet.skills).map(([name, s]) => (
            <button
              key={name}
              type="button"
              onClick={() =>
                rollTest(`${name} check`, s.total.value, 'check', checkEffects(s.ability))
              }
              className={`flex min-h-tap items-center gap-3 pr-3 pl-4 text-left text-ink ${ROLLS}`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <ProfDot level={s.prof} />
                {name}
                <span className="font-semibold text-[0.75rem] text-ink-muted uppercase leading-4 tracking-[0.04em]">
                  {s.ability}
                </span>
              </span>
              <span className="min-w-9 text-right font-bold tabular-nums">
                {fmt(s.total.value)}
              </span>
              <D20Icon size={16} className="shrink-0 text-ink-faint" />
            </button>
          ))}
        </div>
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
        {sheet.resists.length > 0 && (
          <div className={ROW}>
            <span className="text-ink-muted">Resistances: </span>
            {sheet.resists.map((r) => r.damageType).join(', ')}
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
