/**
 * Species: size, speed, darkvision, the damage they resist, and their traits,
 * each trait with what it does on the sheet (the sheet reads a trait's own
 * effects, and a renamed trait still finds what the original did).
 */
import { isRecord } from '@/engine/castGuidance';
import type { EditorProps, EditorSpec } from '../editorTypes';
import { ChipPicks, Kept, NumberField, Section, TextBlocks } from '../fields';
import { PartList } from '../PartList';

const SIZES: ReadonlyArray<readonly [string, string]> = [
  ['T', 'Tiny'],
  ['S', 'Small'],
  ['M', 'Medium'],
  ['L', 'Large'],
];

const DAMAGE: ReadonlyArray<readonly [string, string]> = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
].map((t) => [t, t[0]?.toUpperCase() + t.slice(1)] as const);

/** A walking speed, from a number or a speed block; the block keeps its other speeds. */
export function walkSpeed(speed: unknown): number | undefined {
  if (typeof speed === 'number') return speed;
  return isRecord(speed) && typeof speed.walk === 'number' ? speed.walk : undefined;
}

export function withWalkSpeed(speed: unknown, walk: number | undefined): unknown {
  if (isRecord(speed)) {
    const { walk: _, ...rest } = speed;
    return walk === undefined
      ? Object.keys(rest).length > 0
        ? rest
        : undefined
      : { ...speed, walk };
  }
  return walk;
}

function SpeciesBody({ draft, change, original, readOnly }: EditorProps) {
  const sizes = Array.isArray(draft.size) ? draft.size.map(String) : [];
  const resist = draft.resist;
  const resistPicks =
    resist === undefined || resist === null
      ? []
      : Array.isArray(resist) && resist.every((r) => typeof r === 'string')
        ? (resist as string[])
        : undefined;
  return (
    <>
      <Section title="About them">
        <ChipPicks
          label="Size"
          options={SIZES}
          value={sizes}
          disabled={readOnly}
          onChange={(v) =>
            change({
              size: v.length === 0 ? undefined : SIZES.map(([k]) => k).filter((k) => v.includes(k)),
            })
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Speed in feet"
            value={walkSpeed(draft.speed)}
            disabled={readOnly}
            onChange={(walk) => change({ speed: withWalkSpeed(draft.speed, walk) })}
          />
          <NumberField
            label="Darkvision in feet"
            value={typeof draft.darkvision === 'number' ? draft.darkvision : undefined}
            placeholder="None"
            disabled={readOnly}
            onChange={(d) => change({ darkvision: d === 0 ? undefined : d })}
          />
        </div>
        {resistPicks !== undefined ? (
          <ChipPicks
            label="Resistances"
            options={DAMAGE}
            value={resistPicks}
            disabled={readOnly}
            onChange={(v) => change({ resist: v.length === 0 ? undefined : v })}
          />
        ) : (
          <Kept label="Resistances">a choice, kept as it is.</Kept>
        )}
      </Section>
      <Section title="Text">
        <TextBlocks
          label="Paragraphs"
          entries={draft.entries}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      <Section title="Traits">
        <PartList
          title="Traits"
          noun="trait"
          entries={draft.entries}
          original={original?.entries}
          source={original !== undefined ? String(original.source) : undefined}
          readOnly={readOnly}
          withEffects
          onChange={(entries) => change({ entries })}
        />
      </Section>
    </>
  );
}

export const editor: EditorSpec = {
  noun: 'species',
  blank: () => ({ size: ['M'], speed: 30, entries: [] }),
  Body: SpeciesBody,
};
