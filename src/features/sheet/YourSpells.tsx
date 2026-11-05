import { AlertTriangle, ChevronRight, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { d20Effects } from '@/engine/conditions';
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
import { PackProblem } from '@/ui/PackProblem';
import { RollChip } from '@/ui/RollChip';
import { cardClass, listClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { askCastResource, CastResourcePicker } from './CastResourcePicker';
import {
  type CastSpellInfo,
  castGranted,
  castingEconomy,
  castResourceLabel,
  castSpell,
  isConcentratingOn,
  needsCastChoice,
} from './castResources';
import { conditionLimits } from './conditionEffects';
import { effectLines, noteLines, rollD20Test, useIgnoreOnce } from './d20Tests';
import { RollEffectCue } from './RollEffectCue';
import { classifyKnown, OVER, spellNeedsConcentration } from './SpellManager';
import { SpellRow } from './SpellRow';
import { SpellSlots } from './SpellSlots';
import { findSpell, useSpellData } from './spellData';
import { spellMeta, spellSaves } from './spellMeta';
import { spellRollActions } from './spellRolls';
import { countPrepared, spellLimits } from './spellTrim';
import { useCastChoice } from './useCastChoice';

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
  choice: ReturnType<typeof useCastChoice>;
  rollAttack: (modifier: number, label: string) => () => ReturnType<typeof rollD20Test>;
  noVerbal: readonly string[];
  entityOf: (ref: { name: string; source: string }) => Entity | undefined;
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
function EndButton({ name, update }: { name: string; update: DocUpdater }) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`End concentration on ${name}`}
      className="-my-1"
      onClick={() =>
        update((d) => {
          d.play.concentratingOn = undefined;
        })
      }
    >
      End
    </Button>
  );
}

/**
 * The row's dice. The first one rolled is the cast (the attack, when there is
 * one), unless the spell is already running: a concentration spell rolled on a
 * later turn has been paid for.
 */
function RollChips({
  name,
  attackModifier,
  entity,
  rolls,
  roller,
  onCast,
}: {
  name: string;
  attackModifier: number | undefined;
  entity: Entity | undefined;
  rolls: ReturnType<typeof spellRollActions>;
  roller: RowContext['rollAttack'];
  onCast: (() => void) | undefined;
}) {
  const hasAttack = attackModifier !== undefined && hasSpellAttack(entity);
  return (
    <>
      {hasAttack && (
        <RollChip
          expr={`1d20${fmt(attackModifier)}`}
          display={signed(attackModifier)}
          label={`${name} spell attack`}
          variant="d20"
          roller={roller(attackModifier, `${name} spell attack`)}
          onRolled={onCast}
        />
      )}
      {rolls.map((action, index) => (
        <RollChip
          key={`${action.expr}:${action.label}`}
          expr={action.expr}
          label={action.label}
          variant={action.variant}
          onRolled={!hasAttack && index === 0 ? onCast : undefined}
        />
      ))}
    </>
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
  const { doc, sheet, update, choice } = ctx;
  const play = doc.play;
  const { name, source, entity } = spell;
  // Nothing says what a spell no file holds is, so it casts as level 1, with
  // the slot it spends on show and the player's to change.
  const level = spell.level ?? 1;
  const concentrating = isConcentratingOn(play, name);
  const key = `${spell.always ? 'granted' : block.classUid}::${refUid(spell)}`;
  const { resource, options } = choice.resourceFor(key, block, level, play, sheet.resources);
  const rolls = spellRollActions(entity, {
    characterLevel: sheet.totalLevel,
    // The dice follow the chosen slot, or the slot a running spell was cast with.
    slotLevel: concentrating ? (play.concentratingOn?.level ?? level) : resource.level,
    abilityModifier: sheet.abilities[block.ability].mod,
  });
  const attackModifier = hasSpellAttack(entity) ? block.attackMod.value : undefined;
  const rolling = attackModifier !== undefined || rolls.length > 0;
  const info: CastSpellInfo = {
    name,
    source,
    concentration: spellNeedsConcentration(entity),
    economy: castingEconomy(entity),
  };
  const choosing = needsCastChoice(options);
  const castContext = {
    spellName: name,
    options,
    block,
    play,
    pools: sheet.resources,
    spell: entity,
    spellLevel: level,
    characterLevel: sheet.totalLevel,
    rulesVersion: doc.rulesVersion,
    classes: doc.classes,
  };
  // Cast asks which slot when more than one fits. A roll chip cannot wait for
  // an answer, so a rolling spell's picker settles the slot before the roll.
  const castAsking = async () => {
    if (!choosing) {
      castSpell(update, block, level, info, options[0]);
      return;
    }
    const picked = await askCastResource(castContext);
    if (picked !== null) castSpell(update, block, level, info, picked);
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
      concentrates={info.concentration === true}
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
          {spellSaves(entity).length > 0 && <Badge tone="arcane">DC {block.saveDc.value}</Badge>}
          {rolling && !concentrating && (
            <CastResourcePicker
              {...castContext}
              resource={resource}
              onPick={(picked) => choice.choose(key, picked)}
            />
          )}
          <RollChips
            name={name}
            attackModifier={attackModifier}
            entity={entity}
            rolls={rolls}
            roller={ctx.rollAttack}
            onCast={
              concentrating ? undefined : () => castSpell(update, block, level, info, resource)
            }
          />
          {concentrating ? (
            <EndButton name={name} update={update} />
          ) : (
            !rolling && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Cast ${name}`}
                aria-haspopup={choosing ? 'dialog' : undefined}
                className="-my-1"
                onClick={() => {
                  void castAsking();
                }}
                title={
                  level === 0 && spell.level !== undefined
                    ? 'Cast cantrip (marks the action economy its casting time uses)'
                    : choosing
                      ? 'Cast: choose which slot or pool to spend'
                      : resource.kind === 'none'
                        ? 'Cast with nothing left to spend (marks action economy)'
                        : `Cast (spends ${castResourceLabel(resource).toLowerCase()})`
                }
              >
                Cast
              </Button>
            )
          )}
        </>
      }
    />
  );
}

/** An innate grant: no slot, its own pool of uses when it has one. */
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
  const rolls = spellRollActions(entity, {
    characterLevel: sheet.totalLevel,
    abilityModifier,
  });
  const attackModifier = hasSpellAttack(entity) ? modifier : undefined;
  const limited =
    grant.resourceKey !== undefined
      ? sheet.resources.find((r) => r.key === grant.resourceKey)
      : undefined;
  const remaining =
    limited !== undefined
      ? limited.max - (doc.play.resources.find((r) => r.key === limited.key)?.used ?? 0)
      : undefined;
  // Rolling is always allowed, but a spent grant must not go on marking your
  // action and your concentration.
  const depleted = remaining !== undefined && remaining <= 0;
  const cast = () =>
    castGranted(
      update,
      {
        name,
        source,
        concentration: spellNeedsConcentration(entity),
        economy: castingEconomy(entity),
      },
      limited !== undefined ? { key: limited.key, max: limited.max } : undefined,
    );
  const rolling = attackModifier !== undefined || rolls.length > 0;
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
      actions={
        <>
          {spellSaves(entity).length > 0 && modifier !== undefined && (
            <Badge tone="arcane">DC {8 + modifier}</Badge>
          )}
          <RollChips
            name={name}
            attackModifier={attackModifier}
            entity={entity}
            rolls={rolls}
            roller={ctx.rollAttack}
            onCast={concentrating || depleted ? undefined : cast}
          />
          {concentrating ? (
            <EndButton name={name} update={update} />
          ) : (
            !rolling && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Cast ${name}`}
                disabled={depleted}
                className="-my-1"
                onClick={cast}
                title={depleted ? 'No uses left until you rest' : 'Cast (no slot)'}
              >
                Cast
              </Button>
            )
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
      <div className={listClass}>{children}</div>
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
  const alwaysNames = new Set(granted.map((g) => g.name.toLowerCase()));
  const own = new Map<string, OwnSpell>();
  for (const g of granted) {
    const entity = entityOf(g);
    own.set(g.name.toLowerCase(), {
      name: typeof entity?.name === 'string' ? entity.name : g.name,
      source: g.source,
      entity,
      level: typeof entity?.level === 'number' ? entity.level : undefined,
      always: true,
    });
  }
  for (const ref of [...state.known, ...state.prepared]) {
    if (alwaysNames.has(ref.name.toLowerCase()) || own.has(refUid(ref))) continue;
    own.set(refUid(ref), { ...ref, entity: entityOf(ref), level: levelOf(ref), always: false });
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
          <Badge tone="arcane">
            Save DC <strong>{block.saveDc.value}</strong>
          </Badge>
          <Badge tone="arcane">
            Attack <strong>{signed(block.attackMod.value)}</strong>
          </Badge>
          <Badge>{block.ability.toUpperCase()}</Badge>
        </div>
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
  update,
}: {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  update: DocUpdater;
}) {
  const { registry, spellsMissing, spellPacks, spellsSettling } = useSpellData(sheet, doc);
  const choice = useCastChoice(doc.play);
  const ignore = useIgnoreOnce(JSON.stringify(doc.play.conditions));
  const [filter, setFilter] = useState('');

  const attackEffects = d20Effects(doc.play.conditions, doc.rulesVersion, { kind: 'attack' });
  const rollAttack = (modifier: number, label: string) => () =>
    rollD20Test(`1d20${fmt(modifier)}`, {
      label,
      effects: attackEffects,
      ignored: ignore.take('attack', attackEffects),
    });
  const limits = conditionLimits(doc.play.conditions);
  const entityOf = (ref: { name: string; source: string }) =>
    findSpell(registry, ref.name, ref.source, doc.rulesVersion);
  const ctx: RowContext = {
    doc,
    sheet,
    update,
    choice,
    rollAttack,
    noVerbal: limits.noVerbal,
    entityOf,
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
          <div className={listClass}>
            {innateShown.map((g) => {
              const entity = entityOf(g);
              const spell: OwnSpell = {
                name: typeof entity?.name === 'string' ? entity.name : g.name,
                source: g.source,
                entity,
                level: typeof entity?.level === 'number' ? entity.level : undefined,
                always: false,
              };
              return entity === undefined && spellsSettling ? (
                <SpellRow
                  key={`${refUid(g)}|${g.resourceKey ?? ''}`}
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
                  key={`${refUid(g)}|${g.resourceKey ?? ''}`}
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
