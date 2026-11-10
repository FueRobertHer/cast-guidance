/**
 * Optional features (invocations, maneuvers, fighting styles, metamagic):
 * which lists they belong to, what they need, their text and parts, and what
 * they do on the sheet.
 */
import { EntryEffects } from '../EffectCards';
import type { EditorProps, EditorSpec } from '../editorTypes';
import { ChipPicks, PrerequisiteField, Section, TextBlocks } from '../fields';
import { PartList } from '../PartList';

const TYPES: ReadonlyArray<readonly [string, string]> = [
  ['EI', 'Eldritch invocation'],
  ['MV:B', 'Battle Master maneuver'],
  ['FS:F', 'Fighter fighting style'],
  ['FS:P', 'Paladin fighting style'],
  ['FS:R', 'Ranger fighting style'],
  ['FS:B', 'Bard fighting style'],
  ['MM', 'Metamagic'],
  ['PB', 'Pact boon'],
  ['AI', 'Artificer infusion'],
  ['AS', 'Arcane shot'],
  ['ED', 'Elemental discipline'],
  ['RN', 'Rune'],
  ['RP', 'Replicate magic item'],
];

function OptionalFeatureBody({ draft, change, original, readOnly }: EditorProps) {
  const types = Array.isArray(draft.featureType) ? draft.featureType.map(String) : [];
  const options = [
    ...TYPES,
    ...types.filter((t) => !TYPES.some(([k]) => k === t)).map((t) => [t, t] as const),
  ];
  return (
    <>
      <Section title="About it">
        <ChipPicks
          label="Lists it is on"
          options={options}
          value={types}
          disabled={readOnly}
          onChange={(v) => change({ featureType: v })}
        />
        <PrerequisiteField
          value={draft.prerequisite}
          readOnly={readOnly}
          onChange={(prerequisite) => change({ prerequisite })}
        />
      </Section>
      <Section title="Text">
        <TextBlocks
          label="Paragraphs"
          entries={draft.entries}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      <Section title="Parts">
        <PartList
          title="Parts"
          noun="part"
          entries={draft.entries}
          original={original?.entries}
          source={original !== undefined ? String(original.source) : undefined}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      <EntryEffects draft={draft} change={change} original={original} readOnly={readOnly} />
    </>
  );
}

export const editor: EditorSpec = {
  noun: 'optional feature',
  blank: () => ({ featureType: ['EI'], entries: [] }),
  Body: OptionalFeatureBody,
  check: (draft) =>
    Array.isArray(draft.featureType) && draft.featureType.length > 0
      ? undefined
      : 'Pick at least one list it is on.',
};
