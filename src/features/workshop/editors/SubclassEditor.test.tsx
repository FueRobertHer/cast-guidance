// @vitest-environment jsdom
// The subclass editor: what Save writes for a subclass and its features, and
// that the Workshop reopens it as the player left it (Homebrew Workshop phase 6).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { readStored } from '../copyWriter';
import { EDITORS, type Json } from '../editorTypes';
import {
  editor,
  editsOf,
  type FeatureEdits,
  featureTree,
  openSubclass,
  summarize,
  writeSubclass,
} from './SubclassEditor';

afterEach(cleanup);

const ref = (name: string, level: number, source = 'XPHB') =>
  `${name}|Paladin|XPHB|Devotion|${source}|${level}`;
const feature = (name: string, level: number, entries: unknown[], extra: Json = {}): Json => ({
  name,
  source: 'XPHB',
  className: 'Paladin',
  classSource: 'XPHB',
  subclassShortName: 'Devotion',
  subclassSource: 'XPHB',
  level,
  entries,
  ...extra,
});
const DEVOTION: Json = {
  name: 'Oath of Devotion',
  shortName: 'Devotion',
  source: 'XPHB',
  className: 'Paladin',
  classSource: 'XPHB',
  subclassFeatures: [
    ref('Oath of Devotion', 3),
    ref('Aura of Devotion', 7),
    ref('Smite of Protection', 15),
  ],
};

/** A small Paladin book: Devotion holds Sacred Weapon in its level 3 feature's text. */
function book(): { registry: EntityRegistry; sub: Json } {
  const registry = normalizeDataset(
    new Map([
      [
        'class/class-paladin.json',
        {
          subclass: [DEVOTION],
          subclassFeature: [
            // Another subclass's feature with the same name and book, found first.
            feature('Aura of Devotion', 7, ['Not this one.'], { subclassShortName: 'Other' }),
            feature('Oath of Devotion', 3, [
              'Uphold justice.',
              { type: 'refSubclassFeature', subclassFeature: ref('Sacred Weapon', 3) },
            ]),
            feature('Sacred Weapon', 3, ['Your weapon shines.']),
            feature('Aura of Devotion', 7, ['No charm near you.']),
            feature('Smite of Protection', 15, ['Your smite shields.']),
          ],
        },
      ],
    ]),
  );
  const sub = registry.get('subclass', 'Oath of Devotion', 'XPHB') as Json;
  return { registry, sub };
}

const nodeOf = (registry: EntityRegistry, sub: Json, name: string) => {
  const n = featureTree(sub, registry).find((f) => f.entity?.name === name);
  if (n === undefined) throw new Error(`no ${name}`);
  return n;
};

/** A copy of Devotion with these edits, as Save writes it. */
function save(registry: EntityRegistry, sub: Json, edits: Partial<FeatureEdits>, name = 'Lantern') {
  const draft = openSubclass(structuredClone(sub), { original: sub, registry });
  draft.name = name;
  draft._features = { ...editsOf(draft), ...edits };
  return writeSubclass({
    original: sub,
    copied: sub,
    draft,
    source: 'MyHomebrew',
    mode: 'changes',
    registry,
  });
}

/** The registry with the written file loaded, as the app loads homebrew. */
function loaded(registry: EntityRegistry, written: ReturnType<typeof save>) {
  mergeHomebrew(
    registry,
    new Map([
      [
        'mine',
        {
          _meta: { sources: [{ json: 'MyHomebrew' }] },
          subclass: [structuredClone(written.entry)],
          subclassFeature: structuredClone(written.owned),
        },
      ],
    ]),
  );
  return registry.get('subclass', written.entry.name, 'MyHomebrew') as Json;
}

/** Each ref's feature as the sheet finds it: its name and text. */
const features = (registry: EntityRegistry, refs: unknown) =>
  (refs as string[]).map((r) => {
    const [name, , , short, source, level] = r.split('|');
    const f = registry
      .byType('subclassFeature')
      .find(
        (x) =>
          x.name === name &&
          x.subclassShortName === short &&
          x.subclassSource === source &&
          String(x.level) === level,
      );
    return [name, f?.entries];
  });

describe('the Workshop', () => {
  it('finds this editor for subclasses', async () => {
    const load = EDITORS.get('subclass');
    expect(load).toBeDefined();
    expect((await load?.())?.editor).toBe(editor);
  });
});

describe('featureTree', () => {
  it('lists each feature once, with those its text holds under it', () => {
    const { registry, sub } = book();
    const tree = featureTree(sub, registry);
    expect(tree.map((n) => [n.ref, n.parent])).toEqual([
      [ref('Oath of Devotion', 3), undefined],
      [ref('Sacred Weapon', 3), ref('Oath of Devotion', 3)],
      [ref('Aura of Devotion', 7), undefined],
      [ref('Smite of Protection', 15), undefined],
    ]);
    // The ref to the one under it is not part of the feature's own text.
    expect(tree[0]?.base.entries).toEqual(['Uphold justice.']);
    // Found as the sheet finds it, by its subclass, not by name and book.
    expect(tree[2]?.entity?.entries).toEqual(['No charm near you.']);
  });
});

describe('writeSubclass', () => {
  it('writes an unchanged copy as its name and what it copies, and no feature', () => {
    const { registry, sub } = book();
    const { entry, owned } = save(registry, sub, {});
    expect(owned).toEqual([]);
    expect(entry).toEqual({
      name: 'Lantern',
      source: 'MyHomebrew',
      _copy: {
        name: 'Oath of Devotion',
        source: 'XPHB',
        shortName: 'Devotion',
        className: 'Paladin',
        classSource: 'XPHB',
      },
      castGuidance: {
        v: 1,
        basedOn: 'Oath of Devotion|XPHB',
        basedOnFingerprint: expect.any(String),
      },
      className: 'Paladin',
      classSource: 'XPHB',
      shortName: 'Devotion',
    });
    const copy = loaded(registry, { entry, owned });
    expect(copy.subclassFeatures).toEqual(sub.subclassFeatures);
  });

  it('saves a changed feature as changes, drops a removed one and lists a new one by level', () => {
    const { registry, sub } = book();
    const smite = nodeOf(registry, sub, 'Smite of Protection');
    const written = save(registry, sub, {
      changed: { [smite.ref]: { ...smite.base, entries: ['Your smite shields twice.'] } },
      removed: [ref('Aura of Devotion', 7)],
      added: [{ name: "Lantern's Reach", level: 3, entries: ['A flare of light.'] }],
    });
    expect(written.entry.subclassFeatures).toEqual([
      ref('Oath of Devotion', 3),
      ref("Lantern's Reach", 3, 'MyHomebrew'),
      ref('Smite of Protection', 15, 'MyHomebrew'),
    ]);
    const [changed, added] = written.owned;
    expect(changed).toMatchObject({
      name: 'Smite of Protection',
      source: 'MyHomebrew',
      subclassShortName: 'Devotion',
      subclassSource: 'MyHomebrew',
      level: 15,
      _copy: {
        name: 'Smite of Protection',
        source: 'XPHB',
        subclassShortName: 'Devotion',
        subclassSource: 'XPHB',
        level: 15,
        _mod: {
          entries: [
            {
              mode: 'replaceArr',
              replace: 'Your smite shields.',
              items: ['Your smite shields twice.'],
            },
          ],
        },
      },
      castGuidance: { v: 1, basedOn: 'Smite of Protection|XPHB' },
    });
    expect(changed?.entries).toBeUndefined();
    expect(added).toMatchObject({
      name: "Lantern's Reach",
      source: 'MyHomebrew',
      subclassSource: 'MyHomebrew',
      level: 3,
      entries: ['A flare of light.'],
    });
    const copy = loaded(registry, written);
    expect(features(registry, copy.subclassFeatures)).toEqual([
      [
        'Oath of Devotion',
        ['Uphold justice.', expect.objectContaining({ type: 'refSubclassFeature' })],
      ],
      ["Lantern's Reach", ['A flare of light.']],
      ['Smite of Protection', ['Your smite shields twice.']],
    ]);
  });

  it('writes the feature holding a changed one without it, and lists that one on the subclass', () => {
    const { registry, sub } = book();
    const weapon = nodeOf(registry, sub, 'Sacred Weapon');
    const written = save(registry, sub, {
      changed: { [weapon.ref]: { ...weapon.base, name: 'Lantern Weapon' } },
    });
    expect(written.entry.subclassFeatures).toEqual([
      ref('Oath of Devotion', 3, 'MyHomebrew'),
      ref('Lantern Weapon', 3, 'MyHomebrew'),
      ref('Aura of Devotion', 7),
      ref('Smite of Protection', 15),
    ]);
    const holder = written.owned.find((f) => f.name === 'Oath of Devotion');
    expect((holder?._copy as Json)._mod).toEqual({
      entries: [
        {
          mode: 'removeArr',
          items: [{ type: 'refSubclassFeature', subclassFeature: ref('Sacred Weapon', 3) }],
        },
      ],
    });
    const copy = loaded(registry, written);
    expect(features(registry, copy.subclassFeatures).slice(0, 2)).toEqual([
      ['Oath of Devotion', ['Uphold justice.']],
      ['Lantern Weapon', ['Your weapon shines.']],
    ]);
  });

  it('writes a feature out whole when another shares its name and book', () => {
    const { registry, sub } = book();
    const aura = nodeOf(registry, sub, 'Aura of Devotion');
    const written = save(registry, sub, {
      changed: { [aura.ref]: { ...aura.base, name: 'Aura of the Lantern' } },
    });
    const [f] = written.owned;
    expect(f?._copy).toBeUndefined();
    expect(f).toMatchObject({
      name: 'Aura of the Lantern',
      entries: ['No charm near you.'],
      castGuidance: { basedOn: 'Aura of Devotion|XPHB' },
    });
  });

  it('takes the name as the short name when another of the player’s subclasses has it', () => {
    const { registry, sub } = book();
    const first = save(registry, sub, {});
    loaded(registry, first);
    const second = save(registry, sub, {}, 'Lamp');
    expect(second.entry.shortName).toBe('Lamp');
    // Saving the first again keeps its own.
    const draft = openSubclass(structuredClone(sub), { original: sub, registry });
    draft.name = 'Lantern';
    const again = writeSubclass({
      original: sub,
      copied: sub,
      draft,
      source: 'MyHomebrew',
      mode: 'changes',
      registry,
      stored: { name: 'Lantern', source: 'MyHomebrew' },
    });
    expect(again.entry.shortName).toBe('Devotion');
  });

  it('keeps the short name on a second save after a rename, with the registry from before', () => {
    const { registry, sub } = book();
    loaded(registry, save(registry, sub, {}));
    // The editor opened on Lantern, saved it as Lamp, and saves again: the
    // registry it holds was built before the first save, so it still has Lantern.
    const draft = openSubclass(structuredClone(sub), { original: sub, registry });
    draft.name = 'Lamp';
    const again = writeSubclass({
      original: sub,
      copied: sub,
      draft,
      source: 'MyHomebrew',
      mode: 'changes',
      registry,
      stored: { name: 'Lamp', source: 'MyHomebrew' },
      storedAs: [
        { name: 'Lantern', source: 'MyHomebrew' },
        { name: 'Lamp', source: 'MyHomebrew' },
      ],
    });
    expect(again.entry.shortName).toBe('Devotion');
  });

  it('writes a feature out whole when the data holds it as a copy it never resolved', () => {
    const registry = normalizeDataset(
      new Map([
        [
          'class/class-paladin.json',
          {
            subclass: [DEVOTION],
            subclassFeature: [
              feature('Oath of Devotion', 3, ['Uphold justice.']),
              feature('Aura of Devotion', 7, ['No charm near you.']),
              {
                ...feature('Smite of Protection', 15, []),
                entries: undefined,
                _copy: { name: 'Old Smite', source: 'PHB' },
              },
            ],
          },
        ],
      ]),
    );
    const sub = registry.get('subclass', 'Oath of Devotion', 'XPHB') as Json;
    const smite = nodeOf(registry, sub, 'Smite of Protection');
    // The book's features are not resolved, so this one is still a copy.
    expect(smite.entity?._copy).toBeDefined();
    const written = save(registry, sub, {
      changed: { [smite.ref]: { ...smite.base, entries: ['Your smite shields.'] } },
    });
    const [f] = written.owned;
    expect(f?._copy).toBeUndefined();
    expect(f).toMatchObject({
      name: 'Smite of Protection',
      entries: ['Your smite shields.'],
      castGuidance: { basedOn: 'Smite of Protection|XPHB' },
    });
  });

  it('writes every feature in full for a full copy', () => {
    const { registry, sub } = book();
    const draft = openSubclass(structuredClone(sub), { original: sub, registry });
    draft.name = 'Lantern';
    const { entry, owned } = writeSubclass({
      original: sub,
      copied: sub,
      draft,
      source: 'MyHomebrew',
      mode: 'full',
      registry,
    });
    expect(entry._copy).toBeUndefined();
    expect(owned.map((f) => [f.name, f._copy])).toEqual([
      ['Oath of Devotion', undefined],
      ['Sacred Weapon', undefined],
      ['Aura of Devotion', undefined],
      ['Smite of Protection', undefined],
    ]);
    expect(entry.subclassFeatures).toEqual(
      owned.map((f) => ref(String(f.name), Number(f.level), 'MyHomebrew')),
    );
  });
});

describe('openSubclass', () => {
  it('reopens a saved copy with the edits it was saved with', () => {
    const { registry, sub } = book();
    const weapon = nodeOf(registry, sub, 'Sacred Weapon');
    const edits: FeatureEdits = {
      changed: { [weapon.ref]: { ...weapon.base, name: 'Lantern Weapon', entries: ['It glows.'] } },
      removed: [ref('Smite of Protection', 15)],
      added: [{ name: "Lantern's Reach", level: 3, entries: ['A flare of light.'] }],
    };
    const written = save(registry, sub, edits);
    const stored = structuredClone(written.entry);
    loaded(registry, written);
    const { entry } = readStored(stored, sub);
    const back = editsOf(openSubclass(entry, { original: sub, registry }));
    expect(back.removed).toEqual(edits.removed);
    expect(back.added).toEqual(edits.added);
    expect(Object.keys(back.changed)).toEqual([weapon.ref]);
    expect(back.changed[weapon.ref]).toMatchObject({
      name: 'Lantern Weapon',
      entries: ['It glows.'],
    });
  });

  it('reads the player’s features from their file, so they open with the file turned off', () => {
    const { registry, sub } = book();
    const weapon = nodeOf(registry, sub, 'Sacred Weapon');
    const smite = nodeOf(registry, sub, 'Smite of Protection');
    const edits: FeatureEdits = {
      changed: {
        [weapon.ref]: { ...weapon.base, name: 'Lantern Weapon', entries: ['It glows.'] },
        [smite.ref]: { ...smite.base, entries: ['Twice.'] },
      },
      removed: [ref('Aura of Devotion', 7)],
      added: [{ name: "Lantern's Reach", level: 3, entries: ['A flare of light.'] }],
    };
    const written = save(registry, sub, edits);
    const file = { subclass: [written.entry], subclassFeature: written.owned };
    // A registry without the player's file, as when it is turned off.
    const off = book();
    const { entry } = readStored(structuredClone(written.entry), off.sub);
    const back = editsOf(openSubclass(entry, { original: off.sub, registry: off.registry, file }));
    expect(back.removed).toEqual(edits.removed);
    expect(back.added).toEqual(edits.added);
    expect(Object.keys(back.changed).sort()).toEqual([weapon.ref, smite.ref].sort());
    expect(back.changed[weapon.ref]).toMatchObject({
      name: 'Lantern Weapon',
      entries: ['It glows.'],
    });
    expect(back.changed[smite.ref]).toMatchObject({ entries: ['Twice.'] });
  });

  it('keeps a renamed pick’s choices inside it, not as new features', () => {
    const arm = (name: string, entries: unknown[]): Json => ({
      ...feature(name, 3, entries),
      source: 'TCE',
      className: 'Artificer',
      classSource: 'TCE',
      subclassShortName: 'Armorer',
      subclassSource: 'TCE',
    });
    const refTo = (name: string) => `${name}|Artificer|TCE|Armorer|TCE|3`;
    const registry = normalizeDataset(
      new Map([
        [
          'class/class-artificer.json',
          {
            subclass: [
              {
                name: 'Armorer',
                shortName: 'Armorer',
                source: 'TCE',
                className: 'Artificer',
                classSource: 'TCE',
                subclassFeatures: [refTo('Armor Model')],
              },
            ],
            subclassFeature: [
              arm('Armor Model', [
                'Pick one.',
                { type: 'refSubclassFeature', subclassFeature: refTo('Guardian') },
                { type: 'refSubclassFeature', subclassFeature: refTo('Infiltrator') },
              ]),
              arm('Guardian', ['Thunder gauntlets.']),
              arm('Infiltrator', ['Lightning launcher.']),
            ],
          },
        ],
      ]),
    );
    const sub = registry.get('subclass', 'Armorer', 'TCE') as Json;
    const [model] = featureTree(sub, registry);
    if (model === undefined) throw new Error('no Armor Model');
    const draft = openSubclass(structuredClone(sub), { original: sub, registry });
    draft.name = 'Lantern Armor';
    draft._features = {
      changed: { [model.ref]: { ...model.base, name: 'Lantern Model' } },
      removed: [],
      added: [],
    };
    const written = writeSubclass({
      original: sub,
      copied: sub,
      draft,
      source: 'MyHomebrew',
      mode: 'changes',
      registry,
    });
    const file = { subclass: [written.entry], subclassFeature: written.owned };
    const { entry } = readStored(structuredClone(written.entry), sub);
    const back = editsOf(openSubclass(entry, { original: sub, registry, file }));
    expect(back.added).toEqual([]);
    expect(back.removed).toEqual([]);
    expect(Object.keys(back.changed)).toEqual([model.ref]);
  });

  it('pairs a changed feature with the original at its level when names repeat', () => {
    const at = (level: number): Json => ({
      ...feature('More Maneuvers', level, [`Two more at ${level}.`]),
      className: 'Fighter',
      subclassShortName: 'Battle Master',
    });
    const refAt = (level: number) => `More Maneuvers|Fighter|XPHB|Battle Master|XPHB|${level}`;
    const registry = normalizeDataset(
      new Map([
        [
          'class/class-fighter.json',
          {
            subclass: [
              {
                name: 'Battle Master',
                shortName: 'Battle Master',
                source: 'XPHB',
                className: 'Fighter',
                classSource: 'XPHB',
                subclassFeatures: [refAt(7), refAt(10), refAt(15)],
              },
            ],
            subclassFeature: [at(7), at(10), at(15)],
          },
        ],
      ]),
    );
    const sub = registry.get('subclass', 'Battle Master', 'XPHB') as Json;
    const [seven, ten] = featureTree(sub, registry);
    if (seven === undefined || ten === undefined) throw new Error('no features');
    for (const mode of ['changes', 'full'] as const) {
      const draft = openSubclass(structuredClone(sub), { original: sub, registry });
      draft.name = `Lantern ${mode}`;
      draft._features = {
        changed: { [ten.ref]: { ...ten.base, entries: ['Three more.'] } },
        removed: [seven.ref],
        added: [],
      };
      const written = writeSubclass({
        original: sub,
        copied: sub,
        draft,
        source: 'MyHomebrew',
        mode,
        registry,
      });
      const file = { subclass: [written.entry], subclassFeature: written.owned };
      const stored = structuredClone(written.entry);
      const entry = mode === 'full' ? stored : readStored(stored, sub).entry;
      const back = editsOf(openSubclass(entry, { original: sub, registry, file }));
      expect(back.removed).toEqual([seven.ref]);
      expect(Object.keys(back.changed)).toEqual([ten.ref]);
      expect(back.changed[ten.ref]).toMatchObject({ level: 10, entries: ['Three more.'] });
    }
  });
});

describe('summarize and check', () => {
  it('counts the features the way the board does', () => {
    const { registry, sub } = book();
    const draft = openSubclass(structuredClone(sub), { original: sub, registry });
    expect(summarize(draft, sub, registry)).toBe(
      'No changes from Oath of Devotion yet. You can save it as it is.',
    );
    // A new name is a change of the subclass's own; its features are all kept.
    expect(summarize({ ...draft, name: 'Lantern' }, sub, registry)).toBe(
      '4 kept. Saved as changes from Oath of Devotion.',
    );
    const smite = nodeOf(registry, sub, 'Smite of Protection');
    draft._features = {
      changed: { [smite.ref]: { ...smite.base, entries: ['Twice.'] } },
      removed: [ref('Aura of Devotion', 7)],
      added: [{ name: 'Reach', level: 3, entries: [] }],
    };
    expect(summarize(draft, sub, registry)).toBe(
      '1 changed, 1 new, 1 removed, 2 kept. Saved as changes from Oath of Devotion.',
    );
  });

  it('asks for a class, and for features the sheet can tell apart', () => {
    const check = editor.check ?? (() => undefined);
    expect(check({ name: 'Lantern', ...editor.blank() })).toBe('Pick the class it belongs to.');
    const base = { name: 'Lantern', className: 'Paladin', classSource: 'XPHB' };
    const added = (...names: string[]) => ({
      ...base,
      _features: { changed: {}, removed: [], added: names.map((name) => ({ name, level: 3 })) },
    });
    expect(check(added('Reach'))).toBeUndefined();
    expect(check(added(''))).toBe('Every feature needs a name.');
    expect(check(added('A|B'))).toBe('A feature name cannot have | in it.');
    expect(check(added('Reach', 'reach'))).toBe('Two features at level 3 are called reach.');
  });
});

describe('the subclass editor on screen', () => {
  function mount(registry: EntityRegistry, sub: Json) {
    const start: Json = {
      ...openSubclass(structuredClone(sub), { original: sub, registry }),
      name: 'Lantern',
    };
    let latest = start;
    function Harness() {
      const [draft, setDraft] = useState<Json>(start);
      latest = draft;
      return (
        <editor.Body
          draft={draft}
          change={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          original={sub}
          registry={registry}
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
  const row = (name: string | RegExp) => {
    const button = screen.getByRole('button', { name });
    const li = button.closest('li');
    if (li === null) throw new Error(`no row ${name}`);
    return li;
  };
  const pick = (name: string, mode: string) => {
    const header = screen.getByRole('button', { name });
    if (header.getAttribute('aria-expanded') !== 'true') fireEvent.click(header);
    fireEvent.click(
      within(screen.getByRole('group', { name: `${name}: keep, change or remove` })).getByRole(
        'button',
        { name: mode },
      ),
    );
  };

  it('changes, removes and adds features, by level', () => {
    const { registry, sub } = book();
    const draft = mount(registry, sub);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Level 3',
      'Level 7',
      'Level 15',
    ]);
    expect(within(row('Sacred Weapon')).getByText('Kept')).toBeTruthy();

    pick('Sacred Weapon', 'Change');
    fireEvent.change(within(row('Sacred Weapon')).getByLabelText('Feature name'), {
      target: { value: 'Lantern Weapon' },
    });
    expect(within(row('Lantern Weapon')).getByText('Changed')).toBeTruthy();

    pick('Smite of Protection', 'Remove');
    expect(within(row('Smite of Protection')).getByText('Removed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add a feature' }));
    const added = row(/^New feature/);
    fireEvent.change(within(added).getByLabelText('Feature name'), {
      target: { value: "Lantern's Reach" },
    });
    fireEvent.change(within(added).getByLabelText('Level'), { target: { value: '7' } });

    const edits = editsOf(draft());
    expect(Object.values(edits.changed).map((f) => f.name)).toEqual(['Lantern Weapon']);
    expect(edits.removed).toEqual([ref('Smite of Protection', 15)]);
    expect(edits.added).toEqual([{ name: "Lantern's Reach", level: 7, entries: [] }]);
    expect(
      within(screen.getByRole('list', { name: 'Level 7' })).getByText("Lantern's Reach"),
    ).toBeTruthy();

    // Keep puts a removed one back.
    pick('Smite of Protection', 'Keep');
    expect(editsOf(draft()).removed).toEqual([]);
  });

  it('shows a copy whose original is not loaded as waiting', () => {
    const { registry } = book();
    const stored = {
      name: 'Lantern',
      source: 'MyHomebrew',
      _copy: { name: 'Oath of Gone', source: 'XYZ' },
      subclassFeatures: ['Gone Aura|Paladin|XPHB|Gone|XYZ|7'],
    };
    render(
      <MemoryRouter>
        <editor.Body draft={stored} change={() => undefined} registry={registry} readOnly />
      </MemoryRouter>,
    );
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Level 7. Shows when Oath of Gone is loaded.')).toBeTruthy();
  });
});
