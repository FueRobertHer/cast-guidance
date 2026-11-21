// @vitest-environment jsdom
// "Class in the name" (a pool's or an action's class said in its name) shows
// only where a class gives the card: a class's or a subclass's features, a
// subclass's own effects and an optional feature's. A species trait, a feat or
// an item has no class to name, so there it shows only for a card whose file
// already names one, so what the file holds is never hidden.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry, normalizeDataset } from '@/data5e/normalize';
import { readStoredEffects } from '@/engine/effects/mechanics';

vi.mock('@/data5e/hooks', async (load) => ({
  ...(await load<typeof import('@/data5e/hooks')>()),
  useTypePacks: () => ({ status: 'ready', error: null, offline: false, retry: () => undefined }),
}));

import { EntryEffects } from './EffectCards';
import {
  editor as classEditor,
  editsOf as classEdits,
  featureTree as classTree,
  openClass,
} from './editors/ClassEditor';
import { editor as feat } from './editors/FeatEditor';
import { editor as item } from './editors/ItemEditor';
import { editor as optionalFeature } from './editors/OptionalFeatureEditor';
import { editor as species } from './editors/SpeciesEditor';
import {
  openSubclass,
  editor as subclassEditor,
  editsOf as subEdits,
  featureTree as subTree,
} from './editors/SubclassEditor';
import type { EditorSpec, Json } from './editorTypes';

afterEach(cleanup);

const POOL: Json = { kind: 'resource', key: 'embers', label: 'Embers', max: 2, reset: 'long' };
const ACTION: Json = { kind: 'action', economy: 'bonus', label: 'Kindle' };
const guidance = (effects: Json[] = [POOL, ACTION]) => ({ v: 1, effects });

/** An editor on screen, as the Workshop holds it; returns the draft as it stands. */
function mount(spec: EditorSpec, start: Json, registry = new EntityRegistry(), original?: Json) {
  let latest = start;
  function Harness() {
    const [draft, setDraft] = useState(start);
    latest = draft;
    const change = (patch: Json) =>
      setDraft((d) => {
        const next = { ...d, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next;
      });
    return (
      <spec.Body
        draft={draft}
        change={change}
        registry={registry}
        original={original}
        readOnly={false}
      />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return () => latest;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const named = (card: string) => screen.queryAllByLabelText(`${card}: Class in the name`);

/** The cards are on screen, a box of each: only the naming boxes are in question. */
function cardsShown(n = 1) {
  expect(screen.getAllByLabelText('Uses per rest: Name')).toHaveLength(n);
  expect(screen.getAllByLabelText('Action: Name')).toHaveLength(n);
}

/** A small Monk book: one feature at level 1. */
function monk() {
  const registry = normalizeDataset(
    new Map([
      [
        'class/class-monk.json',
        {
          class: [
            {
              name: 'Monk',
              source: 'XPHB',
              hd: { number: 1, faces: 8 },
              proficiency: ['str', 'dex'],
              classFeatures: ['Martial Arts|Monk|XPHB|1'],
            },
          ],
          classFeature: [
            {
              name: 'Martial Arts',
              source: 'XPHB',
              className: 'Monk',
              classSource: 'XPHB',
              level: 1,
              entries: ['Strike with your fists.'],
            },
          ],
        },
      ],
    ]),
  );
  return { registry, cls: registry.get('class', 'Monk', 'XPHB') as Json };
}

/** A small Paladin book: Devotion with one feature at level 3. */
function devotion() {
  const registry = normalizeDataset(
    new Map([
      [
        'class/class-paladin.json',
        {
          subclass: [
            {
              name: 'Oath of Devotion',
              shortName: 'Devotion',
              source: 'XPHB',
              className: 'Paladin',
              classSource: 'XPHB',
              subclassFeatures: ['Oath of Devotion|Paladin|XPHB|Devotion|XPHB|3'],
            },
          ],
          subclassFeature: [
            {
              name: 'Oath of Devotion',
              source: 'XPHB',
              className: 'Paladin',
              classSource: 'XPHB',
              subclassShortName: 'Devotion',
              subclassSource: 'XPHB',
              level: 3,
              entries: ['Uphold justice.'],
            },
          ],
        },
      ],
    ]),
  );
  return { registry, sub: registry.get('subclass', 'Oath of Devotion', 'XPHB') as Json };
}

/** A copy of Devotion, its own effects `castGuidance`, with these features added. */
function mountSubclass(castGuidance?: Json, added: Json[] = []) {
  const { registry, sub } = devotion();
  const start: Json = {
    ...openSubclass(structuredClone(sub), { original: sub, registry }),
    name: 'Lantern',
    ...(castGuidance === undefined ? {} : { castGuidance }),
  };
  start._features = { ...subEdits(start), added };
  return mount(subclassEditor, start, registry, sub);
}

describe('where no class gives the card', () => {
  it('leaves the naming boxes off a species trait', () => {
    mount(species, {
      name: 'Emberkin',
      size: ['M'],
      entries: [{ type: 'entries', name: 'Ember Heart', entries: [], castGuidance: guidance() }],
    });
    cardsShown();
    expect(named('Uses per rest')).toEqual([]);
    expect(named('Action')).toEqual([]);
  });

  it("leaves them off a feat's own cards and its benefit's", () => {
    mount(feat, {
      name: 'Ember Adept',
      entries: [{ type: 'entries', name: 'Spark', entries: [], castGuidance: guidance() }],
      castGuidance: guidance(),
    });
    cardsShown(2);
    expect(named('Uses per rest')).toEqual([]);
    expect(named('Action')).toEqual([]);
  });

  it('leaves them off an item', () => {
    mount(item, { name: 'Ember Lamp', type: 'OTH', entries: [], castGuidance: guidance() });
    cardsShown();
    expect(named('Uses per rest')).toEqual([]);
    expect(named('Action')).toEqual([]);
  });

  it('keeps them on a card of an item whose file names its class, and only on that one', () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: guidance([
        { ...POOL, ownClass: true },
        { ...ACTION, ownClassBeside: ['Paladin'] },
        { kind: 'action', economy: 'action', label: 'Flare' },
      ]),
    });
    const naming = (el: HTMLElement | undefined) =>
      (el as HTMLSelectElement | undefined)?.selectedOptions[0]?.textContent;
    expect(named('Uses per rest').map((el) => naming(el))).toEqual(['Always']);
    // Two actions, one naming its class.
    expect(screen.getAllByLabelText('Action: Name')).toHaveLength(2);
    expect(named('Action')).toHaveLength(1);
    expect((screen.getByLabelText('Action: Beside which classes') as HTMLInputElement).value).toBe(
      'Paladin',
    );
    // Still a box that writes: Never takes the field away, and the boxes with it.
    type('Uses per rest: Class in the name', '');
    expect(((draft().castGuidance as Json).effects as Json[])[0]).toEqual(POOL);
    expect(named('Uses per rest')).toEqual([]);
  });
});

describe('where a class gives the card', () => {
  it("shows them on a class's feature", async () => {
    const { registry, cls } = monk();
    const start: Json = {
      ...openClass(structuredClone(cls), { original: cls, registry }),
      name: 'Lantern',
    };
    start._features = {
      ...classEdits(start),
      added: [{ name: 'Ember Strike', level: 1, entries: [], castGuidance: guidance() }],
    };
    mount(classEditor, start, registry, cls);
    // The table opens on level 1, where the feature is.
    await screen.findAllByLabelText('Uses per rest: Name');
    cardsShown();
    expect(named('Uses per rest')).toHaveLength(1);
    expect(named('Action')).toHaveLength(1);
  });

  it("shows them on a subclass's feature", () => {
    mountSubclass(undefined, [
      { name: 'Lantern Glow', level: 3, entries: [], castGuidance: guidance() },
    ]);
    cardsShown();
    expect(named('Uses per rest')).toHaveLength(1);
    expect(named('Action')).toHaveLength(1);
  });

  it("shows them on a class's feature the book has, once changed", async () => {
    const { registry, cls } = monk();
    const start: Json = {
      ...openClass(structuredClone(cls), { original: cls, registry }),
      name: 'Lantern',
    };
    const arts = classTree(cls, registry).find((n) => n.entity?.name === 'Martial Arts');
    if (arts === undefined) throw new Error('no Martial Arts');
    start._features = {
      ...classEdits(start),
      changed: { [arts.ref]: { ...arts.base, castGuidance: guidance() } },
    };
    mount(classEditor, start, registry, cls);
    fireEvent.click(await screen.findByRole('button', { name: /^Martial Arts/ }));
    cardsShown();
    expect(named('Uses per rest')).toHaveLength(1);
    expect(named('Action')).toHaveLength(1);
  });

  it("shows them on a class's own cards", () => {
    const { registry, cls } = monk();
    const start: Json = {
      ...openClass(structuredClone(cls), { original: cls, registry }),
      name: 'Lantern',
      castGuidance: guidance([ACTION]),
    };
    mount(classEditor, start, registry, cls);
    fireEvent.click(screen.getByRole('button', { name: 'Basics' }));
    // Its pools are set in the table, so only the action is a card here.
    expect(screen.getAllByLabelText('Action: Name')).toHaveLength(1);
    expect(named('Action')).toHaveLength(1);
  });

  it("shows them on a subclass's feature the book has, once changed", () => {
    const { registry, sub } = devotion();
    const start: Json = {
      ...openSubclass(structuredClone(sub), { original: sub, registry }),
      name: 'Lantern',
    };
    const oath = subTree(sub, registry).find((n) => n.entity?.name === 'Oath of Devotion');
    if (oath === undefined) throw new Error('no Oath of Devotion');
    start._features = {
      ...subEdits(start),
      changed: { [oath.ref]: { ...oath.base, castGuidance: guidance() } },
    };
    mount(subclassEditor, start, registry, sub);
    fireEvent.click(screen.getByRole('button', { name: /^Oath of Devotion/ }));
    cardsShown();
    expect(named('Uses per rest')).toHaveLength(1);
    expect(named('Action')).toHaveLength(1);
  });

  it('shows them on an optional feature', () => {
    mount(optionalFeature, {
      name: 'Ember Call',
      featureType: ['EI'],
      entries: [],
      castGuidance: guidance(),
    });
    cardsShown();
    expect(named('Uses per rest')).toHaveLength(1);
    expect(named('Action')).toHaveLength(1);
  });

  it('names a pool or an action for its class, always or beside the classes typed', () => {
    // On a subclass's own cards, which its class gives (an item has no class to name).
    const draft = mountSubclass({
      v: 1,
      effects: [POOL, ACTION, { kind: 'acBonus', amount: 1 }],
    });
    const effects = () => (draft().castGuidance as Json).effects as Json[];
    const naming = (label: string) =>
      (screen.getByLabelText(label) as HTMLSelectElement).selectedOptions[0]?.textContent;
    expect(naming('Uses per rest: Class in the name')).toBe('Never');
    // Only a pool and an action have a name the sheet can add the class to.
    expect(screen.queryByLabelText('Armor Class: Class in the name')).toBeNull();
    type('Uses per rest: Class in the name', 'own');
    expect(effects()[0]).toMatchObject({ ownClass: true });
    expect(
      screen.getByText('Embers (name of the class that gives it): 2 uses, back on a long rest'),
    ).toBeTruthy();
    // Beside: no class yet is a problem the card says in words.
    type('Uses per rest: Class in the name', 'beside');
    expect(effects()[0]).not.toHaveProperty('ownClass');
    expect(effects()[0]).toMatchObject({ ownClassBeside: [] });
    expect(screen.getByText(/name a class it stands beside/)).toBeTruthy();
    // A comma typed stays, for the next name.
    type('Uses per rest: Beside which classes', 'Paladin,');
    expect(effects()[0]).toMatchObject({ ownClassBeside: ['Paladin'] });
    expect(
      (screen.getByLabelText('Uses per rest: Beside which classes') as HTMLInputElement).value,
    ).toBe('Paladin,');
    type('Uses per rest: Beside which classes', 'Paladin, cleric ');
    expect(effects()[0]).toMatchObject({ ownClassBeside: ['Paladin', 'cleric'] });
    expect(readStoredEffects(effects()).problems).toEqual([]);
    expect(screen.queryByText(/name a class it stands beside/)).toBeNull();
    type('Uses per rest: Class in the name', '');
    expect(effects()[0]).toEqual({
      kind: 'resource',
      key: 'embers',
      label: 'Embers',
      max: 2,
      reset: 'long',
    });
    // An action too, so it can share an "ownClass" pool's name.
    type('Action: Class in the name', 'own');
    expect(effects()[1]).toEqual({
      kind: 'action',
      economy: 'bonus',
      label: 'Kindle',
      ownClass: true,
    });
    expect(screen.getByText('Bonus action: Kindle (name of the class that gives it)')).toBeTruthy();
    expect(readStoredEffects(effects()).problems).toEqual([]);
  });

  it('shows them on a class or subclass feature changed for the table, read from the feature', () => {
    const shown = (draft: Json) => {
      render(
        <MemoryRouter>
          <EntryEffects draft={draft} change={() => undefined} readOnly={false} />
        </MemoryRouter>,
      );
      const n = named('Uses per rest').length;
      cleanup();
      return n;
    };
    // A class's feature changed for the table names its class; a feat does not.
    expect(shown({ name: 'Rage', className: 'Barbarian', castGuidance: guidance() })).toBe(1);
    expect(shown({ name: 'Ember Adept', castGuidance: guidance() })).toBe(0);
  });
});
