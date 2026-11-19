/**
 * Subraces: the species one belongs to, then the species' own fields, which a
 * sheet reads over that species' (race.ts `raceUnderSubrace`): ability scores,
 * skills and languages go beside the species' (a score or a choice of skills
 * both give is the subrace's), every other field it fills takes the species'
 * place, and its traits go on a card of their own.
 *
 * A subrace finds its species by `raceName` and `raceSource`, so a new one
 * picks the species first; Add a subrace on a species opens one naming it.
 */

import type { EditorProps, EditorSpec, Json } from '../editorTypes';
import { Field, Select } from '../fields';
import { absent } from '../originFields';
import { OriginParts } from './SpeciesEditor';

/** The fields a subrace adds to its species' rather than replacing them. */
const ADDED = new Set(['ability', 'skillProficiencies', 'languageProficiencies']);

function SubraceBody(props: EditorProps) {
  const { draft, original, readOnly, registry } = props;
  // A copy cannot leave out a field its original sets: emptied, it stores
  // null, which a sheet reads as taking the species' value away too. For a
  // field the subrace adds to its species', none of its own is an empty list.
  const change = (patch: Json) =>
    props.change(
      original === undefined
        ? patch
        : Object.fromEntries(
            Object.entries(patch).map(([k, v]) => [
              k,
              v === undefined && ADDED.has(k) && !absent(original[k]) ? [] : v,
            ]),
          ),
    );
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
  return <OriginParts {...props} change={change} sub about={about} />;
}

export const editor: EditorSpec = {
  noun: 'subrace',
  blank: () => ({ entries: [] }),
  check: (d) => (d.raceName ? undefined : 'Pick the species it belongs to.'),
  Body: SubraceBody,
};
