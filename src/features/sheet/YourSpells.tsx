import { AlertTriangle, ChevronRight, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { d20Effects } from '@/engine/conditions';
import { type HpLimits, setConcentration } from '@/engine/effectLife';
import { rollEffects } from '@/engine/playRules';
import {
  type CharacterDoc,
  type DerivedSheet,
  type PlayState,
  refUid,
  type SpellcastingBlock,
} from '@/engine/types';
import { signed } from '@/lib/signed';
import type { DocUpdater } from '@/stores/characterSession';
import { Badge, badgeClass } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import type { ChipWear } from '@/ui/ChipFace';
import { PackProblem } from '@/ui/PackProblem';
import { cardClass, openListClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { RemoveAddedSpell } from './AddSpellSheet';
import { castsByPrompt, type SpellCast } from './castPlan';
import { castingEconomy, isConcentratingOn } from './castResources';
import { conditionLimits } from './conditionEffects';
import {
  conditionWear,
  type D20Ask,
  d20Ask,
  effectLines,
  noteLines,
  rollWear,
  useIgnoreOnce,
} from './d20Tests';
import { conditionsInForce, hpLimits, saveDcRaisedBy } from './effectsInPlay';
import { RollEffectCue } from './RollEffectCue';
import { SpellCastChips } from './SpellCastChips';
import { classifyKnown, OVER, spellNeedsConcentration } from './SpellManager';
import { SpellRow } from './SpellRow';
import { SpellSlots } from './SpellSlots';
import { NoSpellsCue, raging, SaveDcBadge } from './spellcastingMarks';
import { findSpell, useSpellData } from './spellData';
import { spellMeta, spellSaves } from './spellMeta';
import { countPrepared, spellLimits } from './spellTrim';

/** A modifier for a dice expression, whose parser reads a hyphen; on screen, see `signed`. */
const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

type Granted = DerivedSheet['grantedSpells'][number];

interface OwnSpell {
  name: string;
  source: string;
  entity: Entity | undefined;
  /** A level from the spell's file: none means it has none, or has not arrived. */
  level: number | undefined;
  always: boolean;
  /** The class whose spell it is, for what reaches only that class's spells. */
  className: string | undefined;
}

/** Whether a class chooses from its spells each day, so a known spell can sit unprepared. */
const preparesSpells = (block: SpellcastingBlock) =>
  block.mode === 'prepared' || block.mode === 'spellbook';

const byName = (a: OwnSpell, b: OwnSpell) => a.name.localeCompare(b.name);
const levelLabel = (level: number) => (level === 0 ? 'Cantrips' : `Level ${level}`);

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Above each level's spells: what the player has left to cast them with. */
export function levelCaption(block: SpellcastingBlock, play: PlayState, level: number): string {
  if (level === 0) return 'at will';
  if (block.mysticArcanum?.includes(level) === true) {
    return `Mystic Arcanum ${play.arcanumUsed?.includes(level) === true ? 'used' : 'ready'}`;
  }
  const parts: string[] = [];
  const total = block.slots[level - 1] ?? 0;
  if (total > 0) {
    parts.push(`${plural(Math.max(0, total - (play.slotsSpent[level - 1] ?? 0)), 'slot')} left`);
  }
  if (block.pactSlots !== undefined && block.pactSlots.level >= level) {
    const left = Math.max(0, block.pactSlots.count - play.pactSlotsSpent);
    parts.push(`${plural(left, 'pact slot')} left`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'no slots at this level';
}

/** What every row needs from the page. */
interface RowContext {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  update: DocUpdater;
  /**
   * A spell attack chip's roll, marked as the attack `of` (the spell's name);
   * `className` is whose spell it is (Innate Sorcery).
   */
  rollAttack: (modifier: number, label: string, of: string, className?: string) => () => D20Ask;
  /** The conditions on the attack chips. */
  wear: ChipWear;
  /** On Cast and the dice chip that casts: only what stops casting. */
  castWear: ChipWear;
  noVerbal: readonly string[];
  entityOf: (ref: { name: string; source: string }) => Entity | undefined;
  /** What raised a class's save DC (Innate Sorcery), for its ring. */
  dcRaisedBy: (block: SpellcastingBlock) => string[];
}

const hasSpellAttack = (entity: Entity | undefined) =>
  Array.isArray(entity?.spellAttack) && entity.spellAttack.length > 0;

/** A `guide` mark for a spell the character's conditions would stop them casting. */
function VerbalMark({
  entity,
  noVerbal,
}: {
  entity: Entity | undefined;
  noVerbal: readonly string[];
}) {
  if (noVerbal.length === 0 || (entity?.components as { v?: boolean } | undefined)?.v !== true) {
    return null;
  }
  const why = `${noVerbal.join(', ')}: you can't speak, and this spell has a verbal component`;
  return (
    <span className="shrink-0 text-guide" title={why}>
      <AlertTriangle size={14} />
      <span className="sr-only">{why}</span>
    </span>
  );
}

/** Ends the concentration this row started: its Cast, while it lasts. */
function EndButton({
  name,
  update,
  hp,
}: {
  name: string;
  update: DocUpdater;
  /** Its own effects held by this concentration end with it. */
  hp: HpLimits;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`End concentration on ${name}`}
      className="-my-1"
      onClick={() =>
        update((d) => {
          setConcentration(d.play, undefined, hp);
        })
      }
    >
      End
    </Button>
  );
}

/** A spell cast with the class's slots: known, prepared or always prepared. */
function SlotSpellRow({
  spell,
  block,
  muted = false,
  withLevel = false,
  ctx,
}: {
  spell: OwnSpell;
  block: SpellcastingBlock;
  muted?: boolean;
  withLevel?: boolean;
  ctx: RowContext;
}) {
  const { doc, sheet, update } = ctx;
  const play = doc.play;
  const { name, source, entity } = spell;
  // Nothing says what a spell no file holds is, so it casts as level 1, with
  // the ways to cast it on show in the prompt and the player's to change.
  const level = spell.level ?? 1;
  const concentrating = isConcentratingOn(play, name);
  const attackModifier = hasSpellAttack(entity) ? block.attackMod.value : undefined;
  const cast: SpellCast = {
    doc,
    sheet,
    update,
    hp: hpLimits(sheet, doc.rulesVersion),
    info: {
      name,
      source,
      concentration: spellNeedsConcentration(entity),
      economy: castingEconomy(entity),
    },
    entity,
    level,
    block,
    abilityModifier: sheet.abilities[block.ability].mod,
    attack: attackModifier !== undefined,
  };
  const locked =
    block.learnable !== undefined &&
    spell.level !== undefined &&
    spell.level > block.learnable.upTo;
  return (
    <SpellRow
      name={name}
      source={source}
      version={doc.rulesVersion}
      subtitle={
        spell.always ? `${block.className} spell · always prepared` : `${block.className} spell`
      }
      meta={spellMeta(entity, { withLevel, concentrating })}
      concentrates={cast.info.concentration === true}
      concentrating={concentrating}
      always={spell.always}
      muted={muted}
      marks={
        <>
          {locked && !spell.always && <span className={badgeClass('guide')}>Above your level</span>}
          <VerbalMark entity={entity} noVerbal={ctx.noVerbal} />
        </>
      }
      actions={
        <>
          {spellSaves(entity).length > 0 && (
            <SaveDcBadge value={block.saveDc.value} raisedBy={ctx.dcRaisedBy(block)} short />
          )}
          <SpellCastChips
            cast={cast}
            running={concentrating}
            runningLevel={play.concentratingOn?.level}
            castButton={!concentrating}
            attack={
              attackModifier === undefined
                ? undefined
                : {
                    expr: `1d20${fmt(attackModifier)}`,
                    display: signed(attackModifier),
                    roller: ctx.rollAttack(
                      attackModifier,
                      `${name} spell attack`,
                      name,
                      spell.className,
                    ),
                  }
            }
            wear={ctx.wear}
            castWear={ctx.castWear}
            castTitle={
              level === 0 && spell.level !== undefined
                ? 'Cast cantrip (marks the action economy its casting time uses)'
                : 'Cast: choose how to cast it'
            }
          />
          {concentrating && (
            <EndButton name={name} update={update} hp={hpLimits(sheet, doc.rulesVersion)} />
          )}
        </>
      }
    />
  );
}

/** An innate grant: no slot, its own pool of uses when it has one, or an item's charges. */
function InnateSpellRow({
  grant,
  spell,
  ctx,
}: {
  grant: Granted;
  spell: OwnSpell;
  ctx: RowContext;
}) {
  const { doc, sheet, update } = ctx;
  const { name, source, entity } = spell;
  const concentrating = isConcentratingOn(doc.play, name);
  const abilityModifier =
    grant.ability !== undefined ? sheet.abilities[grant.ability].mod : undefined;
  const modifier =
    abilityModifier !== undefined ? sheet.profBonus.value + abilityModifier : undefined;
  const attackModifier = hasSpellAttack(entity) ? modifier : undefined;
  const limited =
    grant.resourceKey !== undefined
      ? sheet.resources.find((r) => r.key === grant.resourceKey)
      : undefined;
  const remaining =
    limited !== undefined
      ? limited.max - (doc.play.resources.find((r) => r.key === limited.key)?.used ?? 0)
      : undefined;
  const cast: SpellCast = {
    doc,
    sheet,
    update,
    hp: hpLimits(sheet, doc.rulesVersion),
    info: {
      name,
      source,
      concentration: spellNeedsConcentration(entity),
      economy: castingEconomy(entity),
    },
    entity,
    level: spell.level ?? 1,
    abilityModifier,
    grantPool:
      limited === undefined
        ? undefined
        : { key: limited.key, label: grant.origin, max: limited.max },
    attack: attackModifier !== undefined,
  };
  // Rolling is always allowed, but a spent grant with nothing else to cast it
  // with must not go on marking your action and your concentration.
  const depleted = remaining !== undefined && remaining <= 0;
  const usedUp = depleted && !castsByPrompt(cast);
  return (
    <SpellRow
      name={name}
      source={source}
      version={doc.rulesVersion}
      subtitle={grant.origin}
      meta={spellMeta(entity, { withLevel: true, concentrating })}
      concentrates={spellNeedsConcentration(entity)}
      concentrating={concentrating}
      marks={
        <>
          {grant.added && <Badge tone="guide">Outside your class</Badge>}
          {remaining !== undefined && limited !== undefined && (
            <span
              title={
                depleted ? 'No uses left until you rest' : `${grant.usage} from ${grant.origin}`
              }
              // Uses left of an innate spell are magic's to spend, so `arcane`;
              // spent, a neutral badge.
              className={`shrink-0 ${badgeClass(depleted ? 'neutral' : 'arcane')}`}
            >
              {remaining}/{limited.max} per {grant.usage?.split('/')[1]}
            </span>
          )}
          <VerbalMark entity={entity} noVerbal={ctx.noVerbal} />
        </>
      }
      rulesFooter={grant.added ? <RemoveAddedSpell name={name} update={update} /> : undefined}
      actions={
        <>
          {spellSaves(entity).length > 0 && modifier !== undefined && (
            <Badge tone="arcane">DC {8 + modifier}</Badge>
          )}
          <SpellCastChips
            cast={cast}
            running={concentrating}
            runningLevel={doc.play.concentratingOn?.level}
            usedUp={usedUp}
            castButton={!concentrating}
            attack={
              attackModifier === undefined
                ? undefined
                : {
                    expr: `1d20${fmt(attackModifier)}`,
                    display: signed(attackModifier),
                    roller: ctx.rollAttack(
                      attackModifier,
                      `${name} spell attack`,
                      name,
                      spell.className,
                    ),
                  }
            }
            wear={ctx.wear}
            castWear={ctx.castWear}
            castTitle={limited === undefined ? 'Cast (no slot)' : 'Cast: choose how to cast it'}
          />
          {concentrating && (
            <EndButton name={name} update={update} hp={hpLimits(sheet, doc.rulesVersion)} />
          )}
        </>
      }
    />
  );
}

/** A heading with its caption, over a list of rows. */
function SpellGroup({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-1">
        <h3 className="text-heading">{title}</h3>
        {caption !== undefined && (
          <span className="text-caption text-ink-muted tabular-nums">{caption}</span>
        )}
      </div>
      <div className={openListClass}>{children}</div>
    </section>
  );
}

/** One casting class: its card, then its spells by level. */
function ClassSection({
  block,
  granted,
  showSlots,
  shared,
  search,
  filter,
  settling,
  ctx,
}: {
  block: SpellcastingBlock;
  /** The always-prepared grants this class casts. */
  granted: readonly Granted[];
  showSlots: boolean;
  shared: boolean;
  /** The search field, which sits under the first class's card (DS-001 SpellsScreen). */
  search: ReactNode;
  filter: string;
  settling: boolean;
  ctx: RowContext;
}) {
  const { doc, update, entityOf } = ctx;
  const play = doc.play;
  const state = doc.spellcasting[block.classUid] ?? { known: [], prepared: [] };
  const levelOf = (ref: { name: string; source: string }) => {
    const level = entityOf(ref)?.level;
    return typeof level === 'number' ? level : undefined;
  };

  // Always prepared first: a domain spell also picked by hand is one row.
  // A grant sits here because it casts with this class's ability, which does
  // not make it this class's spell: a species' or feat's is no one's, unless
  // the class picked it too.
  const alwaysNames = new Set(granted.map((g) => g.name.toLowerCase()));
  const picked = new Set([...state.known, ...state.prepared].map((r) => r.name.toLowerCase()));
  const own = new Map<string, OwnSpell>();
  for (const g of granted) {
    const entity = entityOf(g);
    own.set(g.name.toLowerCase(), {
      name: typeof entity?.name === 'string' ? entity.name : g.name,
      source: g.source,
      entity,
      level: typeof entity?.level === 'number' ? entity.level : undefined,
      always: true,
      className: g.className ?? (picked.has(g.name.toLowerCase()) ? block.className : undefined),
    });
  }
  for (const ref of [...state.known, ...state.prepared]) {
    if (alwaysNames.has(ref.name.toLowerCase()) || own.has(refUid(ref))) continue;
    own.set(refUid(ref), {
      ...ref,
      entity: entityOf(ref),
      level: levelOf(ref),
      always: false,
      className: block.className,
    });
  }

  const preparedUids = new Set(state.prepared.map(refUid));
  const byLevel = new Map<number, OwnSpell[]>();
  const pending: OwnSpell[] = [];
  const unknown: OwnSpell[] = [];
  const notPrepared: OwnSpell[] = [];
  const f = filter.trim().toLowerCase();
  const shown = [...own.values()].filter((s) => s.name.toLowerCase().includes(f));
  for (const s of shown) {
    if (s.entity === undefined && settling) pending.push(s);
    else if (preparesSpells(block) && !s.always && s.level !== 0 && !preparedUids.has(refUid(s))) {
      notPrepared.push(s);
    } else if (s.level === undefined) unknown.push(s);
    else byLevel.set(s.level, [...(byLevel.get(s.level) ?? []), s]);
  }

  const limits = spellLimits(block);
  const { cantrips, leveled } = classifyKnown(state.known, levelOf, limits);
  const count = preparesSpells(block)
    ? { n: countPrepared(state.prepared, limits, levelOf), max: limits.prepared, word: 'prepared' }
    : limits.known !== undefined
      ? { n: leveled, max: limits.known, word: 'known' }
      : { n: leveled + cantrips, max: undefined, word: 'known' };

  return (
    <section className="flex flex-col gap-3">
      <div className={`${cardClass} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <h2 className="font-display text-title-card">{block.className} spells</h2>
          <span className="text-caption text-ink-muted tabular-nums">
            <span className={count.max !== undefined && count.n > count.max ? OVER : undefined}>
              {count.max !== undefined ? `${count.n} of ${count.max}` : count.n}
            </span>{' '}
            {count.word}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <SaveDcBadge value={block.saveDc.value} raisedBy={ctx.dcRaisedBy(block)} />
          <Badge tone="arcane">
            Attack <strong>{signed(block.attackMod.value)}</strong>
          </Badge>
          <Badge>{block.ability.toUpperCase()}</Badge>
        </div>
        {raging(ctx.sheet) && <NoSpellsCue />}
        <SpellSlots
          block={block}
          play={play}
          update={update}
          showSlots={showSlots}
          shared={shared}
          framed
        />
      </div>
      {search}
      {shown.length === 0 && (
        <p className="px-1 text-body text-ink-muted">
          {f === ''
            ? `No ${block.className} spells yet. Pick some under Choose.`
            : `No ${block.className} spells match “${filter.trim()}”.`}
        </p>
      )}
      {[...byLevel.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([level, spells]) => (
          <SpellGroup
            key={level}
            title={levelLabel(level)}
            caption={levelCaption(block, play, level)}
          >
            {[...spells].sort(byName).map((s) => (
              <SlotSpellRow key={refUid(s)} spell={s} block={block} ctx={ctx} />
            ))}
          </SpellGroup>
        ))}
      {unknown.length > 0 && (
        <SpellGroup title="Level unknown">
          {[...unknown].sort(byName).map((s) => (
            <SlotSpellRow key={refUid(s)} spell={s} block={block} ctx={ctx} />
          ))}
        </SpellGroup>
      )}
      {/* The name still opens the rules sheet, which says what became of the
          file and can ask again. Its level decides what casting it spends, so
          until the file is here the row offers no way to cast it. */}
      {pending.length > 0 && (
        <SpellGroup title="Waiting for spell details">
          {[...pending].sort(byName).map((s) => (
            <SpellRow
              key={refUid(s)}
              name={s.name}
              source={s.source}
              version={doc.rulesVersion}
              subtitle={`${block.className} spell`}
              concentrates={false}
              concentrating={false}
              muted
            />
          ))}
        </SpellGroup>
      )}
      {/* Folded rather than gone: a wizard's spellbook, still castable, since
          a ritual needs no preparing and the sheet guides without gatekeeping. */}
      {notPrepared.length > 0 && (
        <details
          open={f !== ''}
          className="group overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line ring-inset"
        >
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 px-4 py-2 text-body-strong">
            <ChevronRight
              size={16}
              aria-hidden="true"
              className="shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-90"
            />
            Not prepared
            <span className="ml-auto font-normal text-caption text-ink-muted tabular-nums">
              {notPrepared.length}
            </span>
          </summary>
          <div className="flex flex-col divide-y divide-line border-line border-t">
            {[...notPrepared]
              .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || byName(a, b))
              .map((s) => (
                <SlotSpellRow key={refUid(s)} spell={s} block={block} muted withLevel ctx={ctx} />
              ))}
          </div>
        </details>
      )}
    </section>
  );
}

/**
 * The Spells tab's first view: the character's own spells by level, each with
 * the one thing a player does with it (DS-001 SpellRow, SpellsScreen). Choosing
 * them is the tab's other view.
 */
export function YourSpells({
  doc,
  sheet,
  built,
  update,
}: {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  /** The sheet from the build alone, to say what an effect in play raised. */
  built?: DerivedSheet | null;
  update: DocUpdater;
}) {
  const { registry, spellsMissing, spellPacks, spellsSettling } = useSpellData(sheet, doc);
  const ignore = useIgnoreOnce(JSON.stringify(doc.play.conditions));
  const [filter, setFilter] = useState('');

  // One the character is immune to is held off, as one switched off is.
  const conditions = conditionsInForce(doc.play.conditions, sheet.conditionImmunities);
  const attackEffects = d20Effects(
    conditions,
    doc.rulesVersion,
    { kind: 'attack' },
    { immune: sheet.conditionImmunities },
  );
  const rollAttack = (modifier: number, label: string, of: string, className?: string) => () =>
    d20Ask(`1d20${fmt(modifier)}`, {
      label,
      effects: attackEffects,
      ignored: ignore.take('attack', attackEffects),
      riders: rollEffects(sheet, {
        kind: 'attack',
        attack: 'spell',
        ...(className === undefined ? {} : { className }),
      }),
      settlesOnNatural: true,
      attack: { by: doc.id, of, critFrom: sheet.critRange?.min },
    });
  const limits = conditionLimits(conditions, doc.rulesVersion);
  const entityOf = (ref: { name: string; source: string }) =>
    findSpell(registry, ref.name, ref.source, doc.rulesVersion);
  const ctx: RowContext = {
    doc,
    sheet,
    update,
    rollAttack,
    wear: rollWear(conditions, attackEffects, ignore.armed('attack'), limits.noActions),
    castWear: conditionWear(conditions, limits.noActions),
    noVerbal: limits.noVerbal,
    entityOf,
    dcRaisedBy: (block) => saveDcRaisedBy(block, built),
  };

  // Always prepared grants cast with a class's slots, so they sit in its list.
  const blockFor = (g: Granted) =>
    sheet.spellcasting.find((sc) => sc.ability === g.ability) ?? sheet.spellcasting[0];
  const alwaysPrepared = sheet.grantedSpells.filter((g) => g.usage === 'prepared');
  const innate = sheet.grantedSpells.filter((g) => g.usage !== 'prepared');
  const f = filter.trim().toLowerCase();
  const innateShown = innate.filter((g) => g.name.toLowerCase().includes(f));
  const anySpells =
    sheet.grantedSpells.length > 0 ||
    sheet.spellcasting.some((sc) => {
      const state = doc.spellcasting[sc.classUid];
      return (state?.known.length ?? 0) + (state?.prepared.length ?? 0) > 0;
    });
  const anyAttack = [
    ...sheet.spellcasting.flatMap((sc) => {
      const state = doc.spellcasting[sc.classUid];
      return [...(state?.known ?? []), ...(state?.prepared ?? [])];
    }),
    ...sheet.grantedSpells,
  ].some((s) => hasSpellAttack(entityOf(s)));
  const slotClass = sheet.spellcasting.findIndex((b) => b.slots.some((n) => n > 0));

  return (
    <div className="flex flex-col gap-4">
      {spellsMissing && <PackProblem packs={spellPacks} what="the spell list" />}
      {limits.noActions.length > 0 && (
        <span className="flex items-center gap-1 px-1 text-caption text-guide">
          <AlertTriangle size={14} className="shrink-0" /> Can&apos;t take actions (
          {limits.noActions.join(', ')})
        </span>
      )}
      {anyAttack && (
        <RollEffectCue
          heading="Spell attacks"
          lines={effectLines(attackEffects)}
          notes={noteLines(attackEffects)}
          rolls="attack roll"
          ignored={ignore.armed('attack')}
          onIgnore={() => ignore.toggle('attack')}
        />
      )}
      {sheet.spellcasting.map((block, index) => (
        <ClassSection
          key={block.classUid}
          block={block}
          granted={alwaysPrepared.filter((g) => blockFor(g) === block)}
          showSlots={index === slotClass}
          shared={sheet.spellcasting.length > 1}
          search={
            index === 0 && anySpells ? (
              <div className="relative">
                <Search
                  size={20}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
                />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Search your spells"
                  placeholder="Search your spells"
                  className={`${fieldClass} pl-10.5`}
                />
              </div>
            ) : undefined
          }
          filter={filter}
          settling={spellsSettling}
          ctx={ctx}
        />
      ))}
      {innateShown.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-heading">Innate &amp; granted spells</h2>
          <div className={openListClass}>
            {innateShown.map((g) => {
              const entity = entityOf(g);
              const spell: OwnSpell = {
                name: typeof entity?.name === 'string' ? entity.name : g.name,
                source: g.source,
                entity,
                level: typeof entity?.level === 'number' ? entity.level : undefined,
                always: false,
                className: g.className,
              };
              return entity === undefined && spellsSettling ? (
                <SpellRow
                  key={`${refUid(g)}|${g.resourceKey ?? ''}|${g.added ? 'added' : ''}`}
                  name={spell.name}
                  source={g.source}
                  version={doc.rulesVersion}
                  subtitle={g.origin}
                  concentrates={false}
                  concentrating={false}
                  muted
                />
              ) : (
                <InnateSpellRow
                  key={`${refUid(g)}|${g.resourceKey ?? ''}|${g.added ? 'added' : ''}`}
                  grant={g}
                  spell={spell}
                  ctx={ctx}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
