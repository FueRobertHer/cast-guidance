import { ChevronsUp, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import type { ReactNode } from 'react';
import { Lift } from '@/ui/Lift';
import { Sheet } from '@/ui/sheet';
import type { DefenseRow, DefenseView } from './effectsInPlay';

/**
 * The character's defenses (the buffs canvas, Defenses A): a chip on the HP
 * card in Temp HP's own shape and outline, so it is never read as temp HP held,
 * opening a sheet that lists each one and what gives it. Half a shield is
 * half the damage, a checked shield none of it, an alert double, all in ward
 * cyan but the alert in danger red. The plain shield stays Temp HP's.
 */

const ICON = { half: ShieldHalf, check: ShieldCheck, alert: ShieldAlert } as const;

/** A group of the sheet: its heading, and a row per thing that gives a defense. */
function Group({
  title,
  rows,
  icon,
}: {
  title: string;
  rows: readonly DefenseRow[];
  icon: ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-3 flex flex-col gap-1">
      <h3 className="text-caption font-semibold text-ink-muted">{title}</h3>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li
            key={`${r.what}:${r.from}`}
            className="flex min-h-tap items-center gap-2.5 rounded-control bg-surface-raised px-3 py-2"
          >
            {icon}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body-strong">{r.what}</span>
              <span className="text-caption text-ink-muted">{r.from}</span>
            </span>
            {r.note !== undefined && (
              <span className="shrink-0 rounded-chip bg-ward-soft px-1.75 py-0.5 text-[0.6875rem] font-bold leading-3.5 text-ward">
                {r.note}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Everything the Defenses sheet lists, in the order a hit asks about it. */
export function DefenseGroups({ view }: { view: DefenseView }) {
  const empty =
    view.none.length +
      view.half.length +
      view.double.length +
      view.cannot.length +
      view.saves.length ===
    0;
  const ward = (Icon: typeof ShieldHalf) => (
    <Icon size={20} aria-hidden="true" className="shrink-0 text-ward" />
  );
  return (
    <>
      {empty && (
        <p className="mb-3 text-caption text-ink-muted">
          Nothing changes the damage you take yet. Species traits and items appear here by
          themselves.
        </p>
      )}
      <Group title="You take none from" rows={view.none} icon={ward(ShieldCheck)} />
      <Group title="You take half from" rows={view.half} icon={ward(ShieldHalf)} />
      <Group
        title="You take double from"
        rows={view.double}
        icon={<ShieldAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />}
      />
      <Group title="You cannot be" rows={view.cannot} icon={ward(ShieldCheck)} />
      <Group
        title="On saving throws"
        rows={view.saves}
        icon={<ChevronsUp size={20} aria-hidden="true" className="shrink-0 text-heal" />}
      />
    </>
  );
}

/**
 * The chip on the HP card, and its sheet. Nothing at all for a character with
 * no defenses, who sees today's card. `raisedBy` names the effects in play
 * that added one (Rage), which ring it.
 */
export function DefensesChip({
  view,
  raisedBy,
}: {
  view: DefenseView;
  raisedBy: readonly string[];
}) {
  const chip = view.chip;
  if (chip === undefined) return null;
  const Icon = ICON[chip.icon];
  const lifted = raisedBy.length > 0;
  return (
    <Sheet.Root>
      {/* The ring follows the 28px pill, inside its 44px target. */}
      <Lift on={lifted} className="-my-2 rounded-full [--lift-inset:5px]">
        <Sheet.Trigger asChild>
          <button
            type="button"
            aria-label={`${chip.say}${lifted ? `, raised by ${raisedBy.join(', ')}` : ''}`}
            className="inline-flex min-h-tap items-center gap-1 whitespace-nowrap rounded-full border-8 border-transparent bg-clip-padding px-2 text-caption font-semibold text-ink tabular-nums ring-1 ring-line-strong ring-inset [--tap-inset:0.5rem] hover:bg-surface-raised"
          >
            <Icon
              size={14}
              aria-hidden="true"
              className={chip.icon === 'alert' ? 'text-danger' : 'text-ward'}
            />
            {chip.word}
          </button>
        </Sheet.Trigger>
      </Lift>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel aria-describedby={undefined} className="flex max-h-[85dvh] flex-col">
          <Sheet.Heading>Defenses</Sheet.Heading>
          <div className="min-h-0 flex-1 overflow-y-auto text-body">
            <DefenseGroups view={view} />
          </div>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

/** "fire, cold", with every type said so. */
const typesSaid = (rows: readonly DefenseRow[]) =>
  [
    ...new Set(
      rows.flatMap((r) =>
        r.what === 'All damage' ? ['every damage type'] : r.what.toLowerCase().split(', '),
      ),
    ),
  ].join(', ');

/** The Stats tab's lines, in place of its muted "Resistances" row: no tap needed. */
export function DefenseLines({ view }: { view: DefenseView }) {
  const lines: Array<{ key: string; icon: ReactNode; word: string; text: string }> = [];
  const ward = (Icon: typeof ShieldHalf) => (
    <Icon size={16} aria-hidden="true" className="mt-px shrink-0 text-ward" />
  );
  if (view.none.length > 0)
    lines.push({
      key: 'none',
      icon: ward(ShieldCheck),
      word: 'Immune to',
      text: typesSaid(view.none),
    });
  if (view.half.length > 0)
    lines.push({
      key: 'half',
      icon: ward(ShieldHalf),
      word: 'Resists',
      text: typesSaid(view.half),
    });
  if (view.double.length > 0)
    lines.push({
      key: 'double',
      icon: <ShieldAlert size={16} aria-hidden="true" className="mt-px shrink-0 text-danger" />,
      word: 'Double from',
      text: typesSaid(view.double),
    });
  if (view.cannot.length > 0)
    lines.push({
      key: 'cannot',
      icon: ward(ShieldCheck),
      word: 'Cannot be',
      text: [...new Set(view.cannot.map((c) => c.what.toLowerCase()))].join(', '),
    });
  if (lines.length === 0) return <p className="px-1 text-caption text-ink-muted">None yet.</p>;
  return (
    <ul className="flex flex-col gap-1 px-1">
      {lines.map((l) => (
        <li key={l.key} className="flex gap-1.5 text-caption text-ink">
          {l.icon}
          <span>
            <b className="font-semibold">{l.word}</b> {l.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
