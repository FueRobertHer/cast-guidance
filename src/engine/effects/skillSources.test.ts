import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import {
  type CharacterDoc,
  type ChoicePrompt,
  type DataEntity,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { originList } from './skillSources';

const world = makeTestContext();

/** A 2024-style background that brings a feat with skill picks of its own. */
const COURTIER: DataEntity = {
  name: 'Courtier',
  source: 'TST',
  skillProficiencies: [{ history: true, persuasion: true }],
  feats: [{ 'skilled|tst': true }],
};

const ctx: EngineContext = {
  get: (type, name, source) =>
    type === 'background' && name.toLowerCase() === 'courtier'
      ? COURTIER
      : world.get(type, name, source),
  byType: (type) =>
    type === 'background' ? [...world.byType(type), COURTIER] : world.byType(type),
};

const CLASS_SKILLS = 'class:sneak|tst:skill:0';

/** Testfolk (Perception) Sneak 1, whose class skills offer Stealth, Acrobatics, Perception. */
function sneakDoc(): CharacterDoc {
  const doc = newCharacterDoc('s1', 'Sly', 'test-tag');
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.classes = [{ ref: { name: 'Sneak', source: 'TST' }, levels: 1, hp: ['avg'] }];
  return doc;
}

/** The skill prompt with this id, made or not. */
function promptOf(doc: CharacterDoc, id: string): ChoicePrompt | undefined {
  const sheet = deriveSheet(doc, ctx);
  return (
    sheet.pending.find((p) => p.id === id) ??
    sheet.resolvedChoices.find((r) => r.prompt.id === id)?.prompt
  );
}

const advisoryOf = (prompt: ChoicePrompt | undefined, id: string) =>
  prompt?.options.find((o) => o.id === id)?.advisory;

describe('skill picks name what already grants an option', () => {
  it('marks an option the species already grants, and leaves the rest alone', () => {
    const prompt = promptOf(sneakDoc(), CLASS_SKILLS);
    expect(advisoryOf(prompt, 'Perception')).toBe('Already proficient from Testfolk (species).');
    expect(advisoryOf(prompt, 'Stealth')).toBeUndefined();
    expect(advisoryOf(prompt, 'Acrobatics')).toBeUndefined();
  });

  it('never flags a skill the pick granted itself', () => {
    const doc = sneakDoc();
    doc.choices[CLASS_SKILLS] = ['Stealth', 'Acrobatics'];
    const prompt = promptOf(doc, CLASS_SKILLS);
    expect(advisoryOf(prompt, 'Stealth')).toBeUndefined();
    expect(advisoryOf(prompt, 'Perception')).toBe('Already proficient from Testfolk (species).');
  });

  it('flags a made pick that something collected after it also grants', () => {
    const doc = sneakDoc();
    doc.feats = [{ ref: { name: 'Skilled', source: 'TST' }, instanceId: 'f1' }];
    doc.choices[CLASS_SKILLS] = ['Stealth', 'Acrobatics'];
    doc.choices['feat:skilled|tst:f1:skill:0'] = ['Stealth', 'History', 'Arcana'];
    expect(advisoryOf(promptOf(doc, CLASS_SKILLS), 'Stealth')).toBe(
      'Already proficient from Skilled (feat).',
    );
    expect(advisoryOf(promptOf(doc, 'feat:skilled|tst:f1:skill:0'), 'Stealth')).toBe(
      'Already proficient from Sneak (class).',
    );
  });

  it('names every other source', () => {
    const doc = sneakDoc();
    doc.customEffects = [
      {
        kind: 'skillProf',
        skill: 'Perception',
        level: 1,
        origin: { label: 'Owl Cloak', uid: 'cloak', type: 'item' },
      },
    ];
    expect(advisoryOf(promptOf(doc, CLASS_SKILLS), 'Perception')).toBe(
      'Already proficient from Testfolk (species) and Owl Cloak (item).',
    );
  });

  it('does not count expertise built on the pick as a second source', () => {
    const doc = sneakDoc();
    doc.choices[CLASS_SKILLS] = ['Stealth', 'Acrobatics'];
    doc.choices['class:sneak|tst:expertise:1'] = ['Stealth', 'Perception'];
    expect(advisoryOf(promptOf(doc, CLASS_SKILLS), 'Stealth')).toBeUndefined();
    // The sheet still says where expertise came from.
    const stealth = deriveSheet(doc, ctx).skills.Stealth;
    expect(stealth?.sources.map((o) => o.label)).toEqual(['Sneak', 'Sneak Expertise']);
  });

  it('keeps a nested pick its own grants, even before it is full', () => {
    // ASI -> feat -> the feat's three skills, two of them made so far.
    const doc = sneakDoc();
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 3, 3, 3] }];
    doc.choices['class:warrior|tst:asi:4'] = 'feat';
    doc.choices['class:warrior|tst:asi:4:feat'] = 'skilled|tst';
    doc.choices['feat:skilled|tst:asi4:skill:0'] = ['Stealth', 'Arcana'];
    const prompt = promptOf(doc, 'feat:skilled|tst:asi4:skill:0');
    expect(deriveSheet(doc, ctx).pending.some((p) => p.id === prompt?.id)).toBe(true);
    expect(advisoryOf(prompt, 'Stealth')).toBeUndefined();
    expect(advisoryOf(prompt, 'Arcana')).toBeUndefined();
    expect(advisoryOf(prompt, 'Perception')).toBe('Already proficient from Testfolk (species).');
  });

  it('flags a background pick and a class pick against each other', () => {
    const doc = newCharacterDoc('m1', 'Sage', 'test-tag');
    doc.background = { name: 'Scholar', source: 'TST' };
    doc.classes = [{ ref: { name: 'Mage', source: 'TST' }, levels: 1, hp: ['avg'] }];
    doc.choices['background:scholar|tst:skill:0'] = ['Arcana', 'History'];
    doc.choices['class:mage|tst:skill:0'] = ['Arcana'];
    expect(advisoryOf(promptOf(doc, 'background:scholar|tst:skill:0'), 'Arcana')).toBe(
      'Already proficient from Mage (class).',
    );
    expect(advisoryOf(promptOf(doc, 'class:mage|tst:skill:0'), 'Arcana')).toBe(
      'Already proficient from Scholar (background).',
    );
  });
});

describe('derived skill sources', () => {
  it('lists each granting origin once', () => {
    const doc = sneakDoc();
    doc.choices[CLASS_SKILLS] = ['Stealth', 'Perception'];
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.skills.Perception?.sources.map((o) => o.label)).toEqual(['Testfolk', 'Sneak']);
    expect(sheet.skills.Arcana?.sources).toEqual([]);
  });

  it('leaves the background and the feat it brings out of sourcesBesideBackground', () => {
    const doc = sneakDoc();
    doc.background = { name: 'Courtier', source: 'TST' };
    doc.choices[CLASS_SKILLS] = ['Stealth', 'Acrobatics'];
    doc.choices['feat:skilled|tst:courtier|tst:skill:0'] = ['Stealth', 'Arcana', 'Insight'];
    const { skills } = deriveSheet(doc, ctx);
    expect(skills.Stealth?.sources.map((o) => o.label)).toEqual(['Skilled', 'Sneak']);
    expect(skills.Stealth?.sourcesBesideBackground.map((o) => o.label)).toEqual(['Sneak']);
    expect(skills.History?.sources.map((o) => o.label)).toEqual(['Courtier']);
    expect(skills.History?.sourcesBesideBackground).toEqual([]);
    expect(skills.Arcana?.sourcesBesideBackground).toEqual([]);
  });
});

describe('originList', () => {
  const o = (label: string, type: 'race' | 'background' | 'custom') => ({
    label,
    uid: label,
    type,
  });

  it('names each origin with its kind, joined the way the app joins lists', () => {
    expect(originList([o('Elf', 'race')])).toBe('Elf (species)');
    expect(originList([o('Elf', 'race'), o('Sage', 'background'), o('House rule', 'custom')])).toBe(
      'Elf (species), Sage (background) and House rule',
    );
  });
});
