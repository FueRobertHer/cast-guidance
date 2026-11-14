import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import type { Entity } from '../copyMod';
import { normalizeDataset } from '../normalize';
import { BONUS_SCOPE, BONUS_SET, bonusCues, bonusSubjects } from './bonusScope';
import { CAPABILITY_SCOPE, CAPABILITY_SET, capabilitySubjects } from './capabilityScope';
import { FEATCHOICE_SCOPE, FEATCHOICE_SET, featChoiceSubjects } from './featChoiceScope';
import type { JevRequest } from './jev';
import {
  emptyJudgments,
  type JudgeSet,
  type JudgeSubject,
  parseJudgments,
  runJudgments,
  serializeJudgments,
} from './judgments';
import { reportHead, reportSection } from './scoping';

// Synthetic entities: invented wording in the shapes in question, not any book's.
const trait = (name: string, ...entries: string[]) => ({ name, entries });
const classFeature = (name: string, level: number, ...entries: string[]) => ({
  name,
  source: 'HB',
  className: 'Testclass',
  classSource: 'HB',
  level,
  entries,
});
const spellList = (name: string, spell: string) => ({
  name,
  ability: { choose: ['int', 'wis'] },
  known: { _: [spell] },
});

const registry = normalizeDataset(
  new Map<string, unknown>(
    Object.entries({
      'races.json': {
        race: [
          {
            name: 'Testfolk',
            source: 'HB',
            entries: [
              trait('Fixed Reflex', 'You gain a +2 bonus to your initiative rolls.'),
              trait('Keen Reflex', 'Your initiative rolls also gain your proficiency bonus.'),
              trait('Wise Glance', 'You add your Wisdom modifier to any Insight check you make.'),
              trait('Twitchy', 'Initiative rolls are made with advantage for you.'),
              trait('Sharp Eyes', 'Your passive scores gain a +3 bonus.'),
              trait('Thin Luck', 'Half your proficiency bonus is how many coins you find.'),
              trait('Slot Sense', 'Half your proficiency bonus sets the level of the slot.'),
              trait('Dull Note', 'Your bonus to this check is a matter of taste.'),
              trait('Odd Omen', 'Once a day, your next check gains a bonus die.'),
              trait('Foggy Hint', 'In fog, your checks may gain a bonus.'),
              trait('Rally', 'While you spend a charge, add your proficiency bonus to a check.'),
              // Curated by name (`trait:hare-trigger`), so its sheet effect is hand-written.
              trait('Hare-Trigger', 'You gain a bonus on initiative.'),
              trait('Long Stride', 'You walk a little further than most.'),
              // Only describe a character, so no reminder comes of them.
              trait('Age', 'You live about as long as an oak.'),
              trait('Alignment', 'You lean toward order.'),
              trait('Creature Type', 'You count as a plant of sorts.'),
              trait('Language', 'You speak one tongue.'),
              trait('Languages', 'You speak two tongues.'),
              trait('Size', 'You stand about as tall as a door.'),
              // Has a capability line, so it never needs another.
              trait('Brave', 'You stand firm when your nerve is tested.'),
              // The scanner draws a reaction chip from this.
              trait('Sidestep', 'As a reaction, you slip aside.'),
              trait('Deft Step', 'You step lightly past a blade.'),
            ],
          },
          {
            name: 'Otherfolk',
            source: 'HB',
            entries: [trait('Deft Step', 'You slip past a blade with care.')],
          },
        ],
      },
      'feats.json': {
        feat: [
          // Curated as `alert|phb`.
          {
            name: 'Alert',
            source: 'PHB',
            entries: ['Always on guard, with a bonus to initiative.'],
          },
          {
            name: 'Elemental Test',
            source: 'HB',
            entries: ['Choose an element you favor. Your magic treats it kindly.'],
          },
          {
            name: 'Offered Test',
            source: 'HB',
            skillProficiencies: [{ any: 1 }],
            entries: ['Pick any one skill to learn.'],
          },
          {
            // A field the feat collector does not read, so no picker comes of it.
            name: 'Unread Field Test',
            source: 'HB',
            savingThrowProficiencies: [{ choose: { from: ['str', 'dex'] } }],
            entries: ['Pick three skills or tools, mixed as you like.'],
          },
          // Read by hand, so what Jev says about them does not put them on the backlog.
          {
            name: 'Harper Agent',
            source: 'FRHoF',
            entries: ['Pick a tune, and hum it when you like.'],
          },
          {
            // Left unsupported, and says why on its row.
            name: 'Rune Shaper',
            source: 'BGG',
            entries: ['Pick some marks to draw on your gear.'],
          },
          {
            // The app only warns about a chosen spell, so it offers nothing here.
            name: 'Spell Test',
            source: 'HB',
            additionalSpells: [{ innate: { _: { daily: { 1: [{ choose: 'level=1' }] } } } }],
            entries: ['Learn a spell you pick.'],
          },
          {
            // The same, behind a prompt the app does offer.
            name: 'Hidden Spell Test',
            source: 'HB',
            additionalSpells: [
              { ability: { choose: ['int', 'wis'] }, known: { _: [{ choose: 'level=0' }] } },
            ],
            entries: ['Pick a small spell and how you cast it.'],
          },
          {
            // No warning at the level the audit collects at, and still a pick to make.
            name: 'Gated Spell Test',
            source: 'HB',
            additionalSpells: [
              { ability: { choose: ['int', 'wis'] }, known: { 5: [{ choose: 'level=1' }] } },
            ],
            entries: ['Later on, pick a spell and how you cast it.'],
          },
          {
            // No warning on the first option, the only one the audit answers with.
            name: 'Later Option Test',
            source: 'HB',
            additionalSpells: [
              spellList('Alpha List', 'fake one'),
              {
                name: 'Beta List',
                ability: { choose: ['int', 'wis'] },
                known: { _: [{ choose: 'level=0' }] },
              },
            ],
            entries: ['Select a list, and with one of them a spell too.'],
          },
          {
            // Answers just as high as the feat above, with no spell to pick.
            name: 'Fixed Spell Test',
            source: 'HB',
            additionalSpells: [spellList('Only List', 'fake three')],
            entries: ['Pick how you cast the spell this feat teaches.'],
          },
          {
            name: 'Vague Test',
            source: 'HB',
            entries: ['Pick something, though the text will not say what.'],
          },
          {
            // A branch, with a further prompt that only appears once it is answered.
            name: 'Branch Test',
            source: 'HB',
            additionalSpells: [
              spellList('Alpha List', 'fake one'),
              spellList('Beta List', 'fake two'),
            ],
            entries: ['Select the list you like.'],
          },
          {
            name: 'Heavy Swing Test',
            source: 'HB',
            entries: ['Each swing, you may choose to trade accuracy for force.'],
          },
          {
            name: 'Either Way Test',
            source: 'HB',
            entries: ['You are hard to surprise, either way.'],
          },
          {
            name: 'Murky Test',
            source: 'HB',
            entries: ['Your chosen path is not spelled out here.'],
          },
          {
            name: 'Unsure Beyond Test',
            source: 'HB',
            entries: ['Pick what suits you, perhaps.'],
          },
          { name: 'Plain Test', source: 'HB', entries: ['You run a little faster.'] },
          { name: 'Reprint Test', source: 'HB', entries: ['Choose the same thing.'] },
          { name: 'Reprint Test', source: 'HB2', entries: ['Choose the same thing.'] },
        ],
      },
      'class/class-testclass.json': {
        class: [{ name: 'Testclass', source: 'HB' }],
        classFeature: [
          classFeature('Steady Aim', 2, 'You can steady yourself before a shot.'),
          classFeature('Steady Aim', 3, 'You rest your weapon on a nearby surface.'),
          classFeature('Odd Hobby', 4, 'You collect small stones in your downtime.'),
          classFeature('Extra Attack', 5, 'You strike more than once.'),
          classFeature('Deft Step', 6, 'You pass a blade without a scratch.'),
        ],
      },
    }),
  ),
);
// The rule sets the app's registry loads beside the release (`setRuleSets`).
registry.setRuleSets(BUILT_IN_RULE_SETS as Entity[]);

type Answer = Record<string, number>;

/** A fake Jev: answers by the name a subject's text starts with, and "no" to the rest. */
function answersFrom(set: JudgeSet, table: Record<string, Answer>) {
  return async ({ state }: JevRequest) => {
    const name = state.split('\n')[0] ?? '';
    const answer = table[name] ?? {};
    return Object.fromEntries(set.questions.map((q) => [q.id, answer[q.id] ?? 0.05]));
  };
}

/** Answers run through the real saver and parser, as a report reads them from disk. */
async function savedFile(set: JudgeSet, subjects: JudgeSubject[], table: Record<string, Answer>) {
  const file = emptyJudgments();
  const result = await runJudgments({ set, subjects, file, ask: answersFrom(set, table) });
  expect(result.failed).toEqual([]);
  return parseJudgments(JSON.parse(serializeJudgments(file)));
}

/** The lines under a `## title: n` heading, up to the blank line that ends the section. */
function rowsUnder(report: string, title: string): string[] {
  const lines = report.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`## ${title}: `));
  expect(at, `no section "${title}" in:\n${report}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, i) => i > at && line === '');
  return lines.slice(at + 1, end);
}

describe('reportHead', () => {
  it('says what to run when part of the net has no answers yet', () => {
    expect(reportHead(BONUS_SET, 'title', 5, 3)).toContain(
      '5 subjects, 3 answered, 2 not asked yet (bun run data:judge -- --set bonus).',
    );
    expect(reportHead(BONUS_SET, 'title', 5, 5)).not.toContain('data:judge');
  });
});

describe('reportSection', () => {
  it('counts rows, not lines', () => {
    expect(reportSection('Title', ['one\nmore', 'two'])).toBe('## Title: 2\none\nmore\ntwo\n');
  });
});

describe('bonus scope', () => {
  const subjects = bonusSubjects(registry);
  const names = subjects.map((s) => s.name);

  it('nets initiative, a bonus to a check or passive score, half proficiency and a modifier added to a check', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'Fixed Reflex',
        'Keen Reflex',
        'Wise Glance',
        'Twitchy',
        'Sharp Eyes',
        'Slot Sense',
        'Odd Omen',
        'Rally',
        'Hare-Trigger',
        'Alert',
      ]),
    );
    expect(names).not.toContain('Long Stride');
    expect(names).not.toContain('Plain Test');
  });

  it('keeps only the sentences that matched as cues', () => {
    expect(bonusCues('Name\nYou run fast. You add +1 to initiative. You jump high.')).toEqual([
      'You add +1 to initiative.',
    ]);
  });

  it('renders from an empty file, before any run', () => {
    const report = BONUS_SCOPE.report(registry, emptyJudgments());
    expect(report).toContain(`${subjects.length} subjects, 0 answered`);
    expect(rowsUnder(report, 'Flat bonus, uncurated')).toEqual([]);
  });

  it('reports uncurated hits by type, untriggered first, with what to teach', async () => {
    const file = await savedFile(BONUS_SET, subjects, {
      'Fixed Reflex': { flat: 0.97 },
      'Keen Reflex': { proficiency: 0.9 },
      'Wise Glance': { abilityMod: 0.88 },
      Twitchy: { advantage: 0.99 },
      'Sharp Eyes': { flat: 0.85 },
      'Thin Luck': { notBonus: 0.81 },
      'Slot Sense': { notBonus: 0.93 },
      'Dull Note': { notBonus: 0.75 },
      'Odd Omen': { flat: 0.4, notBonus: 0.5 },
      'Foggy Hint': { advantage: 0.6, notBonus: 0.3 },
      Rally: { proficiency: 0.95, triggered: 0.91 },
      'Hare-Trigger': { proficiency: 0.96 },
    });
    const report = BONUS_SCOPE.report(registry, file);

    expect(rowsUnder(report, 'Flat bonus, uncurated')).toEqual([
      '0.97  Fixed Reflex (Testfolk|HB)',
      '      You gain a +2 bonus to your initiative rolls.',
      '0.85  Sharp Eyes (Testfolk|HB)',
      '      Your passive scores gain a +3 bonus.',
    ]);
    // Rally's bonus needs a trigger, so the likelier-looking row still comes second.
    expect(rowsUnder(report, 'Proficiency-based bonus, uncurated')).toEqual([
      '0.90  Keen Reflex (Testfolk|HB)',
      '      Your initiative rolls also gain your proficiency bonus.',
      '0.95  Rally (Testfolk|HB)  needs a trigger (0.91)',
      '      While you spend a charge, add your proficiency bonus to a check.',
    ]);
    expect(rowsUnder(report, 'Ability-modifier bonus, uncurated')).toEqual([
      '0.88  Wise Glance (Testfolk|HB)',
      '      You add your Wisdom modifier to any Insight check you make.',
    ]);
    expect(rowsUnder(report, 'Advantage, not a bonus, uncurated')).toEqual([
      '0.99  Twitchy (Testfolk|HB)',
      '      Initiative rolls are made with advantage for you.',
    ]);
    // Slot Sense comes later in the data, so this is the sort, not the input order.
    expect(rowsUnder(report, 'Not a bonus, uncurated (negative test cases)')).toEqual([
      '0.93  Slot Sense (Testfolk|HB)',
      '      Half your proficiency bonus sets the level of the slot.',
      '0.81  Thin Luck (Testfolk|HB)',
      '      Half your proficiency bonus is how many coins you find.',
    ]);
    // The likeliest bonus first, so being nearly sure of none does not rank a row up.
    expect(rowsUnder(report, 'Unclear, uncurated (read these)')).toEqual([
      '0.60  Foggy Hint (Testfolk|HB)  closest: advantage  notBonus 0.30',
      '      In fog, your checks may gain a bonus.',
      '0.40  Odd Omen (Testfolk|HB)  closest: flat  notBonus 0.50',
      '      Once a day, your next check gains a bonus die.',
      '0.05  Dull Note (Testfolk|HB)  closest: flat  notBonus 0.75',
      '      Your bonus to this check is a matter of taste.',
    ]);
    expect(report).toContain(`${subjects.length} subjects, ${subjects.length} answered`);
    expect(report).toContain('Yes means p >= 0.8.');
    expect(report).toContain('keep this output out of the repository');
  });

  it('keeps a curated feature on the report whether or not Jev finds a bonus in it', async () => {
    const file = await savedFile(BONUS_SET, subjects, { 'Hare-Trigger': { proficiency: 0.96 } });
    const report = BONUS_SCOPE.report(registry, file);
    expect(rowsUnder(report, 'Curated already (wording the scanner should learn)')).toEqual([
      'Hare-Trigger (Testfolk|HB): proficiency 0.96',
      '      You gain a bonus on initiative.',
    ]);
    expect(rowsUnder(report, 'Curated, no bonus found (a miss if its entry adds one)')).toEqual([
      'Alert (feat|PHB)',
      '      Always on guard, with a bonus to initiative.',
    ]);
  });

  it('saves answers and labels, and no prose', async () => {
    const file = await savedFile(BONUS_SET, subjects, {});
    const saved = serializeJudgments(file);
    expect(saved).toContain('Fixed Reflex (Testfolk|HB)');
    expect(saved).not.toContain('initiative rolls');
  });
});

describe('feat choice scope', () => {
  const subjects = featChoiceSubjects(registry);
  const subject = (name: string) => subjects.find((s) => s.label.startsWith(`${name} (`));

  it('nets feats with choice words, once per distinct text', () => {
    expect(subject('Plain Test')).toBeUndefined();
    expect(subject('Murky Test')).toBeDefined();
    expect(subjects.filter((s) => s.label.startsWith('Reprint Test'))).toHaveLength(1);
  });

  it('tells Jev what the app really offers, not what fields exist', () => {
    expect(subject('Offered Test')?.offered).toEqual(['Skill proficiency']);
    expect(subject('Offered Test')?.state).toContain('Picks the app offers: Skill proficiency\n');
    expect(subject('Unread Field Test')?.offered).toEqual([]);
    expect(subject('Unread Field Test')?.state).toContain('Picks the app offers: none\n');
    expect(subject('Spell Test')?.offered).toEqual(['spells']);
    expect(subject('Elemental Test')?.state).toBe(
      'Elemental Test\nPicks the app offers: none\nChoose an element you favor. Your magic treats it kindly.',
    );
  });

  it('names a branch prompt by its options, and finds the prompt behind it', () => {
    expect(subject('Branch Test')?.offered).toEqual([
      'one of Alpha List, Beta List',
      'spellcasting ability',
    ]);
    expect(subject('Branch Test')?.state).toContain(
      'Picks the app offers: one of Alpha List, Beta List; spellcasting ability\n',
    );
  });

  it('reaches a spell prompt behind a later branch option and a level key', () => {
    expect(subject('Later Option Test')?.covers).toContain('pickSpell');
    expect(subject('Gated Spell Test')?.covers).toContain('pickSpell');
  });

  it('keeps a spell prompt to one word in the state, so rewording a label keeps the answers', () => {
    expect(subject('Later Option Test')?.state).toContain(
      'Picks the app offers: one of Alpha List, Beta List; spellcasting ability; spells\n',
    );
  });

  it.each<[string, object, string[]]>([
    ['skill', { skillProficiencies: [{ any: 1 }] }, ['pickSkill']],
    ['spell', { additionalSpells: [{ known: { _: [{ choose: 'level=0' }] } }] }, ['pickSpell']],
    ['expertise', { expertise: [{ anyProficientSkill: 1 }] }, ['pickSkill']],
    ['tool', { toolProficiencies: [{ anyArtisansTool: 1 }] }, ['pickTool']],
    ['ability', { ability: [{ choose: { from: ['str', 'dex'] } }] }, ['pickAbility']],
    [
      'weighted ability',
      { ability: [{ choose: { weighted: { from: ['str', 'dex'], weights: [2, 1] } } }] },
      ['pickAbility'],
    ],
    ['language', { languageProficiencies: [{ anyStandard: 1 }] }, ['pickOther']],
    ['weapon', { weaponProficiencies: [{ choose: { from: ['club', 'dagger'] } }] }, ['pickOther']],
    ['damage resistance', { resist: [{ choose: { from: ['fire', 'cold'] } }] }, ['pickDamageType']],
    [
      'skill or tool',
      { skillToolLanguageProficiencies: [{ choose: [{ from: ['anySkill', 'anyTool'] }] }] },
      ['pickSkill', 'pickTool'],
    ],
    [
      'optional feature',
      {
        optionalfeatureProgression: [
          { name: 'Fake Tricks', featureType: ['ZZ'], progression: { '*': 1 } },
        ],
      },
      ['pickOther'],
    ],
    [
      'branch',
      {
        additionalSpells: [spellList('Alpha List', 'fake one'), spellList('Beta List', 'fake two')],
      },
      ['pickClass', 'pickOther', 'pickAbility'],
    ],
  ])('knows what a %s prompt takes care of', (_prompt, fields, covers) => {
    const feat = { name: 'Prompt Test', source: 'HB', entries: ['Choose one.'], ...fields };
    const dataset = new Map<string, unknown>([['feats.json', { feat: [feat] }]]);
    expect(featChoiceSubjects(normalizeDataset(dataset))[0]?.covers).toEqual(covers);
  });

  it('knows a damage type prompt from the table of picks only prose asks for', () => {
    const feat = { name: 'Elemental Adept', source: 'PHB', entries: ['Choose one.'] };
    const dataset = new Map<string, unknown>([['feats.json', { feat: [feat] }]]);
    const [only] = featChoiceSubjects(normalizeDataset(dataset));
    expect(only?.covers).toEqual(['pickDamageType']);
    expect(only?.offered).toEqual(['Damage type']);
  });

  it('keeps rows read by hand off the backlog, and says why one stays on it', async () => {
    const surely = { pickOnTaking: 0.95, pickOther: 0.95 };
    const file = await savedFile(FEATCHOICE_SET, subjects, {
      'Harper Agent': surely,
      'Rune Shaper': surely,
    });
    const report = FEATCHOICE_SCOPE.report(registry, file);
    expect(rowsUnder(report, 'Read by hand, no picker needed')).toEqual([
      'Harper Agent (feat|FRHoF)  its only pick is the instrument, offered already',
    ]);
    const backlog = rowsUnder(report, 'A pick the app does not offer (the feat-picker backlog)');
    expect(backlog).toHaveLength(1);
    expect(backlog[0]).toMatch(/^0\.95 {2}Rune Shaper \(feat\|BGG\) .* left unsupported: runes /);
  });

  it('reports the picks the app does not offer as the backlog, kept apart from play decisions', async () => {
    const chosenSpellAnswers = {
      pickOnTaking: 0.94,
      pickAbility: 0.97,
      pickSpell: 0.69,
      beyondOffered: 0.81,
    };
    const file = await savedFile(FEATCHOICE_SET, subjects, {
      'Elemental Test': { pickOnTaking: 0.98, pickDamageType: 0.97, beyondOffered: 0.3 },
      // Jev says there is more, but the only kind it names is already offered.
      'Offered Test': { pickOnTaking: 0.99, pickSkill: 0.98, beyondOffered: 0.9 },
      'Unread Field Test': {
        pickOnTaking: 0.97,
        pickSkill: 0.9,
        pickTool: 0.85,
        // Unsure kinds still show beside the sure ones, likeliest first.
        pickClass: 0.55,
        pickOther: 0.6,
        beyondOffered: 0.91,
      },
      'Spell Test': { pickOnTaking: 0.9, pickSpell: 0.95, beyondOffered: 0.99 },
      // The data has a spell to choose and a prompt offers it, however unsure Jev is.
      'Hidden Spell Test': chosenSpellAnswers,
      'Gated Spell Test': chosenSpellAnswers,
      'Later Option Test': chosenSpellAnswers,
      // No spell to choose in the data, so the unsure spell only shows on the row.
      'Fixed Spell Test': {
        pickOnTaking: 0.95,
        pickAbility: 0.97,
        pickSpell: 0.79,
        pickClass: 0.5,
        beyondOffered: 0.85,
      },
      // A branch and its ability are offered, so only the spell inside is needed.
      'Branch Test': { pickSpell: 0.92, pickClass: 0.9, pickAbility: 0.9, pickOther: 0.6 },
      // Just under the lean, so it is not worth a guess.
      'Vague Test': { pickTool: 0.49, beyondOffered: 0.85 },
      // No confident kind, so what Jev said about going beyond the line decides.
      'Reprint Test': { pickSpell: 0.7, beyondOffered: 0.9 },
      'Heavy Swing Test': { pickDuringPlay: 0.94 },
      'Murky Test': { pickOnTaking: 0.5, beyondOffered: 0.5 },
      // Not confident enough to be the backlog, too unsure to call it no pick.
      'Unsure Beyond Test': { pickDuringPlay: 0.9, beyondOffered: 0.6 },
    });
    const report = FEATCHOICE_SCOPE.report(registry, file);

    const backlog = 'A pick the app does not offer (the feat-picker backlog)';
    expect(rowsUnder(report, backlog)).toEqual([
      '0.97  Elemental Test (feat|HB)  needs: damage type  offers: none',
      '0.92  Branch Test (feat|HB)  needs: spell  offers: one of Alpha List, Beta List; spellcasting ability',
      '0.90  Reprint Test (feat|HB)  needs: maybe spell (0.70)  offers: none',
      '0.90  Unread Field Test (feat|HB)  needs: skill, tool, maybe other (0.60), maybe class (0.55)  offers: none',
      '0.85  Vague Test (feat|HB)  needs: ?  offers: none',
    ]);
    expect(report).toContain('Needed, most first: skill 1, tool 1, spell 1, damage type 1');
    expect(rowsUnder(report, 'Every kind of pick offered already')).toEqual([
      '0.99  Offered Test (feat|HB)  picks: skill  offers: Skill proficiency',
      '0.95  Fixed Spell Test (feat|HB)  picks: ability, maybe spell (0.79), maybe class (0.50)  offers: spellcasting ability',
      '0.94  Gated Spell Test (feat|HB)  picks: ability  offers: spellcasting ability; spells',
      '0.94  Hidden Spell Test (feat|HB)  picks: ability  offers: spellcasting ability; spells',
      '0.94  Later Option Test (feat|HB)  picks: ability  offers: one of Alpha List, Beta List; spellcasting ability; spells',
      '0.90  Spell Test (feat|HB)  picks: spell  offers: spells',
    ]);
    expect(rowsUnder(report, 'A decision during play only (no picker needed)')).toEqual([
      '0.94  Heavy Swing Test (feat|HB)  picks: ?  offers: none',
    ]);
    expect(rowsUnder(report, 'No pick at all (only the wording matched)')).toEqual(
      expect.arrayContaining(['0.05  Either Way Test (feat|HB)  picks: ?  offers: none']),
    );
    expect(rowsUnder(report, 'Unclear (read these)')).toEqual([
      '0.60  Unsure Beyond Test (feat|HB)  picks: ?  offers: none',
      '0.50  Murky Test (feat|HB)  picks: ?  offers: none',
    ]);
    expect(report).toContain('Yes means p >= 0.8.');
  });
});

describe('capability scope', () => {
  const subjects = capabilitySubjects(registry);
  const names = subjects.map((s) => s.name);

  it('nets features the Play tab shows nothing for', () => {
    expect(names).toContain('Long Stride');
    expect(names).toContain('Odd Hobby');
    expect(names.filter((n) => n === 'Steady Aim')).toHaveLength(2);
  });

  it('leaves out a capability line, a curated entry, a scanner chip and feats', () => {
    expect(names).not.toContain('Brave');
    expect(names).not.toContain('Extra Attack');
    expect(names).not.toContain('Hare-Trigger');
    expect(names).not.toContain('Sidestep');
    expect(names).not.toContain('Plain Test');
  });

  it('leaves out traits that only describe a character', () => {
    for (const filler of ['Age', 'Alignment', 'Creature Type', 'Language', 'Languages', 'Size']) {
      expect(names).not.toContain(filler);
    }
  });

  it('asks the two questions the owner chose', () => {
    expect(CAPABILITY_SET.questions).toEqual([
      {
        id: 'inCombat',
        instructions:
          'Does this change what the character can do, or how well they do it, in combat?',
      },
      {
        id: 'alwaysOn',
        instructions: 'Does it work every round, with no limit on uses per rest or per day?',
      },
    ]);
  });

  it('ranks names by the two answers multiplied, one row per name, and counts what it leaves out', async () => {
    const steady = subjects.filter((s) => s.name === 'Steady Aim');
    const file = await savedFile(CAPABILITY_SET, subjects, {
      'Long Stride': { inCombat: 0.8, alwaysOn: 0.75 },
      // Sure of one answer only, and that is not enough.
      'Odd Hobby': { inCombat: 0.1, alwaysOn: 0.9 },
    });
    // Two printings of one name disagree, which only the saved file can say.
    const [first, second] = steady;
    if (first === undefined || second === undefined) throw new Error('fixture lost a printing');
    file.judgments[`capability@1:${first.key}`] = { label: first.label, p: [0.6, 0.5] };
    file.judgments[`capability@1:${second.key}`] = { label: second.label, p: [0.96, 0.96] };

    const report = CAPABILITY_SCOPE.report(registry, file);
    expect(rowsUnder(report, 'Names at 0.4 or above, likeliest first')).toEqual([
      '0.92  Steady Aim (Testclass|HB)  in combat 0.96, every round 0.96  2 printings, lowest 0.30',
      '0.60  Long Stride (Testfolk|HB)  in combat 0.80, every round 0.75',
    ]);
    const listed = 2;
    const below = new Set(names).size - listed;
    expect(report).toContain(`${below} more names below 0.4 are not listed.`);
    expect(report).toContain('The score is the two answers multiplied.');
    // This list cuts at 0.4, so the yes threshold other reports state does not apply.
    expect(report).not.toContain('Yes means');
  });

  it("shows the best printing's label and answers, and the lowest score of any", async () => {
    const [middle, best, lowest] = subjects.filter((s) => s.name === 'Deft Step');
    if (middle === undefined || best === undefined || lowest === undefined) {
      throw new Error('fixture lost a printing');
    }
    expect(new Set([middle.label, best.label, lowest.label]).size).toBe(3);
    const file = await savedFile(CAPABILITY_SET, subjects, {});
    // The best is neither first nor last, and the lowest comes after it.
    file.judgments[`capability@1:${middle.key}`] = { label: middle.label, p: [0.6, 0.6] };
    file.judgments[`capability@1:${best.key}`] = { label: best.label, p: [0.9, 0.8] };
    file.judgments[`capability@1:${lowest.key}`] = { label: lowest.label, p: [0.5, 0.2] };

    const report = CAPABILITY_SCOPE.report(registry, file);
    expect(rowsUnder(report, 'Names at 0.4 or above, likeliest first')).toEqual([
      `0.72  ${best.label}  in combat 0.90, every round 0.80  3 printings, lowest 0.10`,
    ]);
  });

  it('lists a name that scores exactly at the cutoff, and not one just under it', async () => {
    const atCutoff = await savedFile(CAPABILITY_SET, subjects, {
      'Long Stride': { inCombat: 0.5, alwaysOn: 0.8 },
    });
    expect(
      rowsUnder(
        CAPABILITY_SCOPE.report(registry, atCutoff),
        'Names at 0.4 or above, likeliest first',
      ),
    ).toEqual(['0.40  Long Stride (Testfolk|HB)  in combat 0.50, every round 0.80']);
    const under = await savedFile(CAPABILITY_SET, subjects, {
      'Long Stride': { inCombat: 0.5, alwaysOn: 0.79 },
    });
    expect(
      rowsUnder(CAPABILITY_SCOPE.report(registry, under), 'Names at 0.4 or above, likeliest first'),
    ).toEqual([]);
  });
});
