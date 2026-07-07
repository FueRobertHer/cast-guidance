import { useOutletContext } from 'react-router';
import { roll } from '@/dice/roll';
import { ABILITIES } from '@/engine/types';
import { currentAdvantage } from '@/stores/advMode';
import { rollLogStore } from '@/stores/rollLog';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import type { CharacterSheetState } from '../useCharacterSheet';

function rollCheck(label: string, modifier: number) {
  const expr = `1d20${modifier >= 0 ? '+' : ''}${modifier}`;
  rollLogStore.getState().append(roll(expr, { label, advantage: currentAdvantage() }));
}

const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

export function Component() {
  const { sheet } = useOutletContext<CharacterSheetState>();
  if (sheet === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  return (
    <div className="flex flex-col gap-5">
      {/* Abilities: tap = check roll, ⓘ = breakdown */}
      <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ABILITIES.map((a) => {
          const ability = sheet.abilities[a];
          return (
            <div key={a} className="flex flex-col items-center rounded-lg bg-surface p-2">
              <span className="text-[10px] font-semibold uppercase text-ink-muted">{a}</span>
              <button
                type="button"
                onClick={() => rollCheck(`${a.toUpperCase()} check`, ability.mod)}
                className="text-xl font-bold hover:text-accent"
                title={`Roll ${a.toUpperCase()} check`}
              >
                {fmt(ability.mod)}
              </button>
              <BreakdownSheet
                title={`${a.toUpperCase()} score`}
                value={ability}
                trigger={
                  <button type="button" className="text-xs text-ink-muted">
                    {ability.value}
                    {ability.overridden ? '•' : ''}
                  </button>
                }
              />
            </div>
          );
        })}
      </section>

      {/* Saves */}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold text-ink-muted">Saving throws</h2>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {ABILITIES.map((a) => {
            const save = sheet.saves[a];
            return (
              <button
                key={a}
                type="button"
                onClick={() => rollCheck(`${a.toUpperCase()} save`, save.total.value)}
                className={`rounded-lg px-2 py-1.5 text-sm ${
                  save.prof ? 'bg-accent-deep/40 font-semibold' : 'bg-surface text-ink-muted'
                }`}
              >
                {a.toUpperCase()} {fmt(save.total.value)}
              </button>
            );
          })}
        </div>
      </section>

      {/* Skills */}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold text-ink-muted">Skills</h2>
        <div className="flex flex-col rounded-lg bg-surface">
          {Object.entries(sheet.skills).map(([name, s]) => (
            <button
              key={name}
              type="button"
              onClick={() => rollCheck(`${name} check`, s.total.value)}
              className="flex items-center justify-between border-b border-surface-2/40 px-3 py-2 text-sm last:border-b-0 hover:bg-surface-2/50"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    s.prof === 2 ? 'bg-amber-300' : s.prof === 1 ? 'bg-accent' : 'bg-surface-2'
                  }`}
                />
                {name}
                <span className="text-xs uppercase text-ink-muted">{s.ability}</span>
              </span>
              <span className="font-mono font-semibold">{fmt(s.total.value)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Passives, senses, proficiencies, languages */}
      <section className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between rounded-lg bg-surface px-3 py-2">
          <span className="text-ink-muted">Passive Perception</span>
          <strong>{sheet.passivePerception.value}</strong>
        </div>
        {sheet.senses.length > 0 && (
          <div className="rounded-lg bg-surface px-3 py-2">
            <span className="text-ink-muted">Senses: </span>
            {sheet.senses.map((s) => `${s.sense} ${s.range} ft.`).join(', ')}
          </div>
        )}
        {sheet.resists.length > 0 && (
          <div className="rounded-lg bg-surface px-3 py-2">
            <span className="text-ink-muted">Resistances: </span>
            {sheet.resists.map((r) => r.damageType).join(', ')}
          </div>
        )}
        {sheet.languages.length > 0 && (
          <div className="rounded-lg bg-surface px-3 py-2">
            <span className="text-ink-muted">Languages: </span>
            {sheet.languages.join(', ')}
          </div>
        )}
        {(sheet.armorProfs.length > 0 ||
          sheet.weaponProfs.length > 0 ||
          sheet.toolProfs.length > 0) && (
          <div className="rounded-lg bg-surface px-3 py-2">
            <span className="text-ink-muted">Proficiencies: </span>
            {[...sheet.armorProfs, ...sheet.weaponProfs, ...sheet.toolProfs].join(', ')}
          </div>
        )}
      </section>
    </div>
  );
}
