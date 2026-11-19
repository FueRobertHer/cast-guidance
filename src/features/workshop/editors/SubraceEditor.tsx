/**
 * Subraces: the species one belongs to, then the species' own fields, which a
 * sheet reads over that species' (race.ts `raceUnderSubrace`): ability scores,
 * skills and languages add to the species', every other field it fills takes
 * the species' place, and its traits go on a card of their own.
 *
 * A subrace finds its species by `raceName` and `raceSource`, so a new one
 * picks the species first; Add a subrace on a species opens one naming it.
 */
import type { EditorProps, EditorSpec } from '../editorTypes';
import { Field, Select } from '../fields';
import { OriginParts } from './SpeciesEditor';

function SubraceBody(props: EditorProps) {
  const { draft, change, original, readOnly, registry } = props;
  const raceName = typeof draft.raceName === 'string' ? draft.raceName : '';
  const raceSource = typeof draft.raceSource === 'string' ? draft.raceSource : '';
  const species = registry.byType('race');
  const about =
    original === undefined ? (
      <Field label="Species">
        <Select
          value={raceName === '' ? '' : `${raceName}|${raceSource}`}
          disabled={readOnly}
          onChange={(e) => {
            const [name = '', source = ''] = e.target.value.split('|');
            change({
              raceName: name === '' ? undefined : name,
              raceSource: source === '' ? undefined : source,
            });
          }}
        >
          <option value="">Pick a species</option>
          {species.map((s) => (
            <option
              key={`${String(s.name)}|${String(s.source)}`}
              value={`${String(s.name)}|${String(s.source)}`}
            >
              {String(s.name)}, {String(s.source)}
            </option>
          ))}
        </Select>
      </Field>
    ) : (
      <p className="text-body">A subrace of {raceName || 'its species'}.</p>
    );
  return <OriginParts {...props} sub about={about} />;
}

export const editor: EditorSpec = {
  noun: 'subrace',
  blank: () => ({ entries: [] }),
  check: (d) => (d.raceName ? undefined : 'Pick the species it belongs to.'),
  Body: SubraceBody,
};
