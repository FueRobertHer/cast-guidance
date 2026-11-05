import type { PlayState, SpellcastingBlock } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { Pips } from '@/ui/Pips';
import { setArcanumUsed } from './castResources';

/**
 * A casting class's pips: its pact slots, its Mystic Arcanum and its spell
 * slots, each in `arcane` with the count in words beside it. A tap spends or
 * regains one by hand, as casting does by itself.
 *
 * `showSlots` is for the leveled pool, which is character-wide: only the first
 * class with slots draws it. `framed` is the Spells tab's look, a hairline list
 * of its own inside the class's card.
 */
export function SpellSlots({
  block,
  play,
  update,
  showSlots,
  shared,
  framed = false,
}: {
  block: SpellcastingBlock;
  play: PlayState;
  update: DocUpdater;
  showSlots: boolean;
  /** Says the slots below are every casting class's, not just this one's. */
  shared: boolean;
  framed?: boolean;
}) {
  const row = `flex flex-wrap items-center${framed ? ' pr-2 pl-4' : ''}`;
  const arcana = block.mysticArcanum ?? [];
  const slots = showSlots && block.slots.some((n) => n > 0);
  if (block.pactSlots === undefined && arcana.length === 0 && !slots) return null;
  const rows = (
    <>
      {block.pactSlots !== undefined && (
        <div className={row}>
          <span className="mr-1.5 text-label text-ink-muted">
            Pact (level {block.pactSlots.level})
          </span>
          <Pips
            total={block.pactSlots.count}
            spent={play.pactSlotsSpent}
            onChange={(next) =>
              update((d) => {
                d.play.pactSlotsSpent = next;
              })
            }
            label={(slot) => `Pact slot ${slot}`}
            tone="arcane"
          />
          <span className="ml-auto pl-2 text-caption text-ink-muted tabular-nums">
            {block.pactSlots.count - play.pactSlotsSpent} of {block.pactSlots.count}
          </span>
        </div>
      )}
      {/* One use per arcanum level, back on a long rest; a tap marks one
          used or regained by hand, as a slot's pip does. */}
      {arcana.length > 0 && (
        <div className={row}>
          <span className="mr-1.5 text-label text-ink-muted">Mystic Arcanum</span>
          {arcana.map((level) => (
            <span key={`arcanum-${String(level)}`} className="flex items-center">
              <span className="text-label text-ink-muted">Level {level}</span>
              <Pips
                total={1}
                spent={play.arcanumUsed?.includes(level) === true ? 1 : 0}
                onChange={(next) =>
                  update((d) => {
                    setArcanumUsed(d.play, level, next > 0);
                  })
                }
                label={() => `Level ${level} arcanum`}
                tone="arcane"
              />
            </span>
          ))}
        </div>
      )}
      {slots && (
        <div className={`flex flex-col ${framed ? 'divide-y divide-line' : 'gap-1'}`}>
          {shared && (
            <span className={`text-caption text-ink-muted ${framed ? 'py-1 pr-2 pl-4' : ''}`}>
              Slots (shared across classes)
            </span>
          )}
          {block.slots.map((count, lvlIdx) =>
            count > 0 ? (
              <div key={`slots-${String(lvlIdx)}`} className={row}>
                <span className="w-14 shrink-0 text-label text-ink-muted">Level {lvlIdx + 1}</span>
                <Pips
                  total={count}
                  spent={play.slotsSpent[lvlIdx] ?? 0}
                  onChange={(next) =>
                    update((d) => {
                      d.play.slotsSpent[lvlIdx] = next;
                    })
                  }
                  label={(slot) => `Level ${lvlIdx + 1} slot ${slot}`}
                  tone="arcane"
                />
                <span className="ml-auto pl-2 text-caption text-ink-muted tabular-nums">
                  {count - (play.slotsSpent[lvlIdx] ?? 0)} of {count}
                </span>
              </div>
            ) : null,
          )}
        </div>
      )}
    </>
  );
  return framed ? (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-card ring-1 ring-line ring-inset">
      {rows}
    </div>
  ) : (
    rows
  );
}
