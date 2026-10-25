/**
 * The creator's in-progress draft, kept in sessionStorage so it survives a
 * reload and a trip to the roster, and goes with the tab (UX-001).
 *
 * The whole working state is kept: the doc, the equipment rows picked for its
 * kit, and the step the player was last on. Older builds kept only the doc,
 * under {@link LEGACY_DRAFT_KEY}; that is still read when no envelope is
 * stored. Anything that does not check out reads as no draft at all, so a
 * corrupt value starts a fresh character instead of a broken wizard.
 */
import { DATA_TAG } from '@/data5e/config';
import { migrateCharacter } from '@/engine/migrate';
import { ABILITIES, type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { assertCharacterDoc } from '@/lib/guards';
import { STEPS, type Step } from './steps';

export const DRAFT_KEY = 'cast-guidance:creator-draft:v2';
/** Where builds before the envelope kept a bare doc. */
export const LEGACY_DRAFT_KEY = 'cast-guidance:creator-draft';

/**
 * The wizard's working state: the character, plus the equipment rows picked
 * for its kit. An undo has to put the rows back with the doc, or the kit
 * regranted afterwards would not be the one taken away.
 */
export interface Draft {
  doc: CharacterDoc;
  bundleChoices: Record<string, string>;
  /** Concrete picks for "any martial weapon"-style slots, keyed `${group}:${idx}`. */
  slotPicks: Record<string, string>;
}

/** What is stored: the draft, and the step the player last worked on. */
export interface DraftEnvelope extends Draft {
  v: 2;
  step?: Step;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Only string-to-string rows survive; anything else is dropped. */
function rowsOf(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(
    Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

/**
 * The doc, if it is one the creator can work on: the import guard, then
 * migration, then the fields the creator itself reads without checking.
 */
function docOf(raw: unknown): CharacterDoc | null {
  try {
    assertCharacterDoc(raw);
    const doc = migrateCharacter(raw);
    const d = doc as unknown as Record<string, unknown>;
    const abilities = d.abilities;
    const play = d.play;
    if (
      typeof d.name !== 'string' ||
      !isRecord(abilities) ||
      typeof abilities.method !== 'string' ||
      !isRecord(abilities.base) ||
      !ABILITIES.every((a) => {
        const v = (abilities.base as Record<string, unknown>)[a];
        return typeof v === 'number' && Number.isFinite(v);
      }) ||
      !Array.isArray(d.classes) ||
      !Array.isArray(d.equipment) ||
      !isRecord(d.choices) ||
      !isRecord(d.spellcasting) ||
      !isRecord(play) ||
      !isRecord(play.currency)
    ) {
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The stored draft, or null when there is none or it does not check out. */
export function readDraft(): DraftEnvelope | null {
  let stored: string | null;
  let legacy: string | null = null;
  try {
    stored = sessionStorage.getItem(DRAFT_KEY);
    if (stored === null) legacy = sessionStorage.getItem(LEGACY_DRAFT_KEY);
  } catch {
    return null;
  }
  if (stored === null) {
    const doc = docOf(parse(legacy));
    return doc === null ? null : { v: 2, doc, bundleChoices: {}, slotPicks: {} };
  }
  const env = parse(stored);
  if (!isRecord(env) || env.v !== 2) return null;
  const doc = docOf(env.doc);
  if (doc === null) return null;
  const step = (STEPS as readonly unknown[]).includes(env.step) ? (env.step as Step) : undefined;
  return {
    v: 2,
    doc,
    bundleChoices: rowsOf(env.bundleChoices),
    slotPicks: rowsOf(env.slotPicks),
    ...(step !== undefined ? { step } : {}),
  };
}

function store(env: DraftEnvelope): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(env));
    sessionStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // storage full/unavailable: the draft just won't survive a reload
  }
}

/** Keep the draft, and the step it was edited on. */
export function writeDraft(d: Draft, step?: Step): void {
  store({
    v: 2,
    doc: d.doc,
    bundleChoices: d.bundleChoices,
    slotPicks: d.slotPicks,
    ...(step !== undefined ? { step } : {}),
  });
}

/** Put a whole envelope back, as an undo of a discard does. */
export const restoreDraft = (env: DraftEnvelope) => store(env);

/** Record the step the player moved to, when there is a draft to record it on. */
export function saveDraftStep(step: Step): void {
  const env = readDraft();
  if (env !== null && env.step !== step) store({ ...env, step });
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // nothing stored, or storage unavailable: either way there is no draft
  }
}

export function freshDraft(): Draft {
  return {
    doc: newCharacterDoc(crypto.randomUUID(), '', DATA_TAG),
    bundleChoices: {},
    slotPicks: {},
  };
}

/**
 * Whether a draft holds nothing the player put there, so there is nothing to
 * continue or lose: no name, the default rules version, no class, species,
 * background, picks, spells, gear or coin, the scores untouched (standard
 * array method, every score 10), and no equipment rows picked.
 */
export function isBlankDraft(d: Draft): boolean {
  const { doc } = d;
  return (
    doc.name.trim() === '' &&
    doc.rulesVersion === '2014' &&
    doc.classes.length === 0 &&
    doc.race === undefined &&
    doc.subrace === undefined &&
    doc.background === undefined &&
    doc.abilities.method === 'standard' &&
    ABILITIES.every((a) => doc.abilities.base[a] === 10) &&
    Object.keys(doc.choices).length === 0 &&
    Object.keys(doc.spellcasting).length === 0 &&
    doc.equipment.length === 0 &&
    Object.values(doc.play.currency).every((v) => v === 0) &&
    Object.keys(d.bundleChoices).length === 0 &&
    Object.keys(d.slotPicks).length === 0
  );
}

/**
 * The history state the roster's Resume link carries. Resuming there is the
 * player's choice already made, so the creator does not say it is continuing.
 */
export const RESUME_STATE = { creatorResume: true } as const;

export const isResumeState = (state: unknown): boolean =>
  isRecord(state) && state.creatorResume === true;

/** The draft's name, or "Unnamed" while it has none. */
export const draftName = (doc: CharacterDoc) => doc.name.trim() || 'Unnamed';

/** "Aria (Fighter 3, Elf)": the name, then the class and species picked so far. */
export function draftSummary(doc: CharacterDoc): string {
  const parts = [
    ...doc.classes.map((c) => `${c.ref.name} ${c.levels}`),
    ...(doc.race !== undefined ? [doc.subrace?.name ?? doc.race.name] : []),
  ];
  return parts.length > 0 ? `${draftName(doc)} (${parts.join(', ')})` : draftName(doc);
}
