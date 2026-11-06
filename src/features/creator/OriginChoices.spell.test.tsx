// @vitest-environment jsdom
// A spell pick's list comes from files the engine never sees, so this page draws it
// up, and a failure to load them has to read as a failure, not as an empty list.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypePacksState } from '@/data5e/hooks';
import { EntityRegistry } from '@/data5e/normalize';
import type { CharacterDoc, ChoicePrompt, DerivedSheet } from '@/engine/types';
import { OriginChoices } from './OriginChoices';

const data = vi.hoisted(() => ({
  packs: {} as unknown,
  requested: [] as Array<string | undefined>,
  lookup: {} as Record<string, unknown>,
  lookupFails: false,
  lookupReads: 0,
  refreshing: false,
}));

vi.mock('@/data5e/hooks', () => ({
  useRegistryRefreshing: () => data.refreshing,
  useTypePacks: (type: string | undefined) => {
    data.requested.push(type);
    return data.packs;
  },
}));

vi.mock('@/data5e/spellLookup', async (actual) => ({
  ...(await actual<typeof import('@/data5e/spellLookup')>()),
  getSpellClassLookup: () => {
    data.lookupReads++;
    return data.lookupFails
      ? Promise.reject(new Error('read failed'))
      : Promise.resolve(data.lookup);
  },
}));

const origin = { label: 'Test Feat', uid: 'feat|test feat|hb', type: 'feat' } as const;

const schoolPick: ChoicePrompt = {
  id: 'feat:test:spell:u:0:known:_:0',
  origin,
  kind: 'spell',
  label: 'Test Feat: Level 1 Abjuration spell',
  count: 1,
  options: [],
  spellQuery: { levels: [1], classes: [], schools: ['A'], ritual: false, attacks: [] },
};

const classPick: ChoicePrompt = {
  ...schoolPick,
  id: 'feat:test:spell:u:0:known:_:1',
  label: 'Test Feat: Testclass cantrip',
  spellQuery: { levels: [0], classes: ['Testclass'], schools: [], ritual: false, attacks: [] },
};

/** An option's button, whose name has its caption after it, and not the ⓘ beside it. */
const optionName = (name: string) => new RegExp(`^${name}(?! details)`);
const optionNamed = (name: string) => screen.getByRole('button', { name: optionName(name) });
const queryOption = (name: string) => screen.queryByRole('button', { name: optionName(name) });

const packs = (over: Partial<TypePacksState> = {}): TypePacksState => ({
  status: 'ready',
  error: null,
  offline: false,
  retry: vi.fn(),
  repair: () => undefined,
  ...over,
});

const withSpells = () => {
  const registry = new EntityRegistry();
  registry.addAll('spell', [
    { name: 'Fake Ward', source: 'HB', level: 1, school: 'A' },
    { name: 'Fake Screen', source: 'HB', level: 1, school: 'A' },
    { name: 'Fake Spark', source: 'HB', level: 0, school: 'V' },
    { name: 'Fake Glow', source: 'HB', level: 0, school: 'V' },
  ]);
  return registry;
};

function harness(
  pending: ChoicePrompt[],
  {
    registry = withSpells() as EntityRegistry | null,
    resolvedChoices = [] as DerivedSheet['resolvedChoices'],
    grantedSpells = [] as DerivedSheet['grantedSpells'],
    choices = {} as CharacterDoc['choices'],
  } = {},
) {
  const doc = { rulesVersion: '2024', choices } as unknown as CharacterDoc;
  const sheet = { pending, resolvedChoices, grantedSpells } as unknown as DerivedSheet;
  const update = vi.fn((recipe: (d: CharacterDoc) => void) => recipe(doc));
  const page = () => (
    <OriginChoices sheet={sheet} doc={doc} update={update} match={() => true} registry={registry} />
  );
  const { rerender } = render(page());
  return { doc, update, rerender: () => rerender(page()) };
}

beforeEach(() => {
  data.packs = packs();
  data.requested = [];
  data.lookup = { hb: { 'fake spark': { class: { HB: { Testclass: true } } } } };
  data.lookupFails = false;
  data.lookupReads = 0;
  data.refreshing = false;
});

afterEach(cleanup);

describe('OriginChoices with a spell pick', () => {
  it('asks for the spell files, and lists the spells that fit', () => {
    harness([schoolPick]);
    expect(data.requested.at(-1)).toBe('spell');
    expect(optionNamed('Fake Ward')).toBeTruthy();
    expect(optionNamed('Fake Screen')).toBeTruthy();
    expect(queryOption('Fake Spark')).toBeNull();
    // Nothing but a class list needs the class lists.
    expect(data.lookupReads).toBe(0);
  });

  it('draws on the class lists when the pick names a class', async () => {
    harness([classPick]);
    expect(await screen.findByRole('button', { name: optionName('Fake Spark') })).toBeTruthy();
    expect(queryOption('Fake Glow')).toBeNull();
    expect(data.lookupReads).toBe(1);
  });

  it('saves the pick as its name and printing, on Confirm', () => {
    const { doc, update } = harness([schoolPick]);
    fireEvent.click(optionNamed('Fake Ward'));
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `Confirm ${schoolPick.label}` }));
    expect(doc.choices[schoolPick.id]).toEqual(['Fake Ward|HB']);
  });

  it('offers the rules text of each spell without picking it', () => {
    const { update } = harness([schoolPick]);
    expect(screen.getByRole('button', { name: 'Fake Ward details' })).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('says it is loading, not that nothing is left, while the files are on their way', () => {
    data.packs = packs({ status: 'loading' });
    harness([schoolPick], { registry: new EntityRegistry() });
    expect(screen.getByText('Loading spell list…')).toBeTruthy();
    expect(screen.queryByText('Nothing here is still available to pick.')).toBeNull();
  });

  it('keeps a list already in hand while more spells arrive, saying more are coming', () => {
    data.packs = packs({ status: 'loading' });
    harness([schoolPick]);
    expect(screen.getByText('Loading spell list…')).toBeTruthy();
    expect(optionNamed('Fake Ward')).toBeTruthy();
  });

  it('keeps an unconfirmed tap when the rest of the spells arrive', () => {
    data.packs = packs({ status: 'loading' });
    const { update, rerender } = harness([schoolPick]);
    fireEvent.click(optionNamed('Fake Ward'));
    data.packs = packs();
    rerender();
    expect(screen.queryByText('Loading spell list…')).toBeNull();
    expect(optionNamed('Fake Ward').getAttribute('aria-pressed')).toBe('true');
    expect(update).not.toHaveBeenCalled();
  });

  it('says more are coming when a made pick opens before the spell files are here', () => {
    data.packs = packs({ status: 'loading' });
    const made: ChoicePrompt = {
      ...schoolPick,
      options: [{ id: 'Fake Ward|HB', label: 'Fake Ward' }],
    };
    harness([], {
      registry: new EntityRegistry(),
      resolvedChoices: [{ prompt: made, selected: ['Fake Ward|HB'] }],
      choices: { [made.id]: ['Fake Ward|HB'] },
    });
    fireEvent.click(screen.getByRole('button', { name: `Change ${made.label}` }));
    expect(screen.getByText('Loading spell list…')).toBeTruthy();
    expect(optionNamed('Fake Ward').getAttribute('aria-pressed')).toBe('true');
  });

  it('says so once when the spell files cannot arrive, with Retry, for any number of picks', () => {
    const failed = packs({ status: 'error', error: 'HTTP 503' });
    data.packs = failed;
    harness([schoolPick, classPick], { registry: new EntityRegistry() });
    expect(screen.getAllByText("The spell list couldn't be downloaded: HTTP 503")).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Loading spell list…')).toBeNull();
  });

  it('says so when the class lists cannot be read, in words about this device', async () => {
    data.lookupFails = true;
    harness([classPick]);
    await waitFor(() =>
      expect(
        screen.getByText("The class spell lists couldn't be read on this device: read failed"),
      ).toBeTruthy(),
    );
  });

  it('downloads nothing for a pick already made, which reads from its save', () => {
    const made: ChoicePrompt = {
      ...schoolPick,
      options: [{ id: 'Fake Ward|HB', label: 'Fake Ward' }],
    };
    harness([], {
      registry: null,
      resolvedChoices: [{ prompt: made, selected: ['Fake Ward|HB'] }],
      choices: { [made.id]: ['Fake Ward|HB'] },
    });
    expect(screen.getByText('Fake Ward')).toBeTruthy();
    expect(data.requested.at(-1)).toBeUndefined();
  });

  it('opens a made pick with it still selected, asking for the files only then', () => {
    const made: ChoicePrompt = {
      ...schoolPick,
      options: [{ id: 'Fake Ward|HB', label: 'Fake Ward' }],
    };
    harness([], {
      resolvedChoices: [{ prompt: made, selected: ['Fake Ward|HB'] }],
      choices: { [made.id]: ['Fake Ward|HB'] },
    });
    fireEvent.click(screen.getByRole('button', { name: `Change ${made.label}` }));
    expect(data.requested.at(-1)).toBe('spell');
    expect(optionNamed('Fake Ward').getAttribute('aria-pressed')).toBe('true');
    expect(optionNamed('Fake Screen')).toBeTruthy();
  });

  it('will not let a spell the feat gives already be picked again', () => {
    harness([schoolPick], {
      grantedSpells: [{ name: 'fake ward', source: 'hb', origin: 'Test Feat' }],
    });
    const button = optionNamed('Fake Ward') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Test Feat already gives you this spell')).toBeTruthy();
  });
});
