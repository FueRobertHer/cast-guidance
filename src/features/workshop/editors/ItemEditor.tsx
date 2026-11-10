/**
 * Items: what the item is, the weapon or armor it is, its bonuses and charges,
 * its text, and what it does on the sheet while its magic works.
 *
 * The fields are the ones the sheet already reads (`type`, `dmg1`, `ac`,
 * `bonusWeapon`, `bonusAc`, `bonusSavingThrow`, `reqAttune`, `extraDamage`,
 * `additionalSpells`); the rest of what an item does is its `castGuidance`,
 * read through `mechanicsOf` while it is attuned (or needs no attunement).
 * Charges are the standard `charges` field and, so the sheet counts them, a
 * "Charges" resource among the item's effects, which a "Cast a spell" card or
 * an action can spend.
 */
import { useState } from 'react';
import { useTypePacks } from '@/data5e/hooks';
import { isRecord, type StoredEffect } from '@/engine/castGuidance';
import { ABILITIES, type Ability } from '@/engine/types';
import {
  baseTypeCode,
  DEFAULT_RIDER_TYPE,
  damagePatch,
  defaultDamageType,
  isArmorType,
  isWeaponType,
  nextRiders,
} from '@/features/homebrew/itemFields';
import {
  COMPLEX,
  readSpellGrant,
  type SpellGrant,
  writeSpellGrant,
} from '@/features/homebrew/spellGrant';
import { DMG_TYPES, ITEM_TYPES } from '@/features/library/fmt';
import { Button } from '@/ui/Button';
import { fieldClass } from '@/ui/TextField';
import { EffectCards, guidanceWith, type SpellOption } from '../EffectCards';
import type { EditorProps, EditorSpec, Json } from '../editorTypes';
import {
  ChipPicks,
  Field,
  Kept,
  NumberField,
  onePerName,
  Section,
  Select,
  TextBlocks,
} from '../fields';

type Options = ReadonlyArray<readonly [string, string]>;

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The kinds of item an author makes, first; any other code the item has is kept and named. */
const TYPES: Options = [
  ['W', 'Wondrous item'],
  ['M', 'Melee weapon'],
  ['R', 'Ranged weapon'],
  ['LA', 'Light armor'],
  ['MA', 'Medium armor'],
  ['HA', 'Heavy armor'],
  ['S', 'Shield'],
  ['RG', 'Ring'],
  ['RD', 'Rod'],
  ['ST', 'Staff'],
  ['WD', 'Wand'],
  ['P', 'Potion'],
  ['SC', 'Scroll'],
  ['A', 'Ammunition'],
  ['SCF', 'Spellcasting focus'],
  ['G', 'Adventuring gear'],
];
const RARITIES: Options = [
  ['none', 'Mundane'],
  ['common', 'Common'],
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['very rare', 'Very rare'],
  ['legendary', 'Legendary'],
  ['artifact', 'Artifact'],
  ['varies', 'Varies'],
];
const PROPERTIES: Options = [
  ['F', 'Finesse'],
  ['L', 'Light'],
  ['H', 'Heavy'],
  ['2H', 'Two-handed'],
  ['V', 'Versatile'],
  ['T', 'Thrown'],
  ['R', 'Reach'],
  ['A', 'Ammunition'],
  ['LD', 'Loading'],
];
const MASTERIES = ['Cleave', 'Graze', 'Nick', 'Push', 'Sap', 'Slow', 'Topple', 'Vex'];
const RECHARGE: Options = [
  ['', 'Never'],
  ['dawn', 'At dawn'],
  ['dusk', 'At dusk'],
  ['midnight', 'At midnight'],
];
const DAMAGE_CODES: Options = Object.entries(DMG_TYPES).map(([k, v]) => [
  k,
  `${v[0]?.toUpperCase() ?? ''}${v.slice(1)}`,
]);

/** What only a weapon has, taken out when an item stops being one. */
const WEAPON_FIELDS = [
  'dmg1',
  'dmgType',
  'dmg2',
  'extraDamage',
  'bonusWeapon',
  'property',
  'mastery',
  'range',
  'weaponCategory',
];

/** The key of the resource that counts an item's charges on the sheet. */
export const CHARGES = 'charges';
const isCharges = (e: StoredEffect) => e.kind === 'resource' && e.key === CHARGES;

/** The item's own effects, as its `castGuidance` holds them. */
const effectsOf = (draft: Json): StoredEffect[] => {
  const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
  return list(g.effects).filter(isRecord) as StoredEffect[];
};

/**
 * The patch for an item's charges: the standard field and, while there are
 * any, the resource that counts them, which a long rest (dawn) refills.
 */
export function withCharges(draft: Json, charges: number | undefined): Json {
  const effects = effectsOf(draft);
  const had = effects.find(isCharges);
  const some = charges !== undefined && charges > 0;
  const next = !some
    ? effects.filter((e) => !isCharges(e))
    : had !== undefined
      ? effects.map((e) => (e === had ? { ...had, max: charges } : e))
      : [
          { kind: 'resource', key: CHARGES, label: 'Charges', max: charges, reset: 'long' },
          ...effects,
        ];
  return {
    charges: some ? charges : undefined,
    castGuidance: guidanceWith(draft.castGuidance, {
      effects: next.length > 0 ? next : undefined,
    }),
  };
}

/** A weapon's properties with `code` on or off, written as the others are (`F|XPHB` beside `L|XPHB`). */
/** How many charges come back, as words: the data tags a roll (`{@dice 1d6 + 1}`). */
export function rechargeWords(amount: unknown): string | undefined {
  if (typeof amount === 'number') return String(amount);
  if (typeof amount !== 'string') return undefined;
  return amount.replace(/\{@dice ([^{}|]+)(?:\|[^{}]*)?\}/g, '$1');
}

/** What was typed, stored as the data has it: a number, a tagged roll, or the words. */
export function rechargeValue(typed: string | undefined): string | number | undefined {
  if (typed === undefined) return undefined;
  const t = typed.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d*d\d+(\s*[+-]\s*\d+)?$/i.test(t)) return `{@dice ${t}}`;
  return typed;
}

export function withProperty(draft: Json, code: string, on: boolean): unknown {
  const refs = list(draft.property).filter((p): p is string => typeof p === 'string');
  if (!on) {
    const next = refs.filter((p) => p.split('|')[0] !== code);
    return next.length > 0 ? next : undefined;
  }
  const source =
    refs.map((p) => p.split('|')[1]).find((s) => s !== undefined) ??
    (draft.edition === 'one' ? 'XPHB' : undefined);
  return [...refs, source !== undefined ? `${code}|${source}` : code];
}

/** A bonus box: "+1", "-2", or empty to take it out. */
function BonusField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: unknown;
  placeholder: string;
  disabled: boolean;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      <input
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value.trim();
          onChange(t === '' ? undefined : /^\d/.test(t) ? `+${t}` : t);
        }}
        className={fieldClass}
      />
    </Field>
  );
}

function TextField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: unknown;
  placeholder?: string;
  disabled: boolean;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      <input
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        className={fieldClass}
      />
    </Field>
  );
}

/** A dropdown that keeps a value it has no option for, named as the data names it. */
function KeptSelect({
  label,
  value,
  options,
  shown,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Options;
  shown: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const all = options.some(([v]) => v === value) ? options : [...options, [value, shown] as const];
  return (
    <Field label={label}>
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {all.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function About({ draft, change, readOnly }: EditorProps) {
  const type = typeof draft.type === 'string' ? draft.type : '';
  const code = baseTypeCode(type) ?? '';
  const rarity = typeof draft.rarity === 'string' ? draft.rarity : 'none';
  const attune = draft.reqAttune;
  return (
    <Section title="About it">
      <div className="grid grid-cols-2 items-end gap-2">
        <KeptSelect
          label="Type"
          value={type}
          options={type === '' ? [['', 'Not given'], ...TYPES] : TYPES}
          shown={ITEM_TYPES[code] ?? type}
          disabled={readOnly}
          onChange={(v) => {
            // Fields the new type cannot use go with it, as the form showed them.
            const patch: Json = { type: v === '' ? undefined : v };
            if (!isWeaponType(v)) for (const k of WEAPON_FIELDS) patch[k] = undefined;
            if (!isArmorType(v)) patch.ac = undefined;
            if (isWeaponType(v) && draft.weaponCategory === undefined)
              patch.weaponCategory = 'simple';
            change(patch);
          }}
        />
        <KeptSelect
          label="Rarity"
          value={rarity}
          options={RARITIES}
          shown={rarity}
          disabled={readOnly}
          onChange={(v) => change({ rarity: v === 'none' ? undefined : v })}
        />
      </div>
      <label className="flex min-h-tap items-center gap-2.5 text-body">
        <input
          type="checkbox"
          className="size-4.5 accent-ink"
          disabled={readOnly}
          checked={attune !== undefined && attune !== false}
          onChange={(e) => change({ reqAttune: e.target.checked ? true : undefined })}
        />
        Requires attunement
      </label>
      {attune !== undefined && attune !== false && (
        <TextField
          label="Attuned by (optional)"
          value={typeof attune === 'string' ? attune : ''}
          placeholder="by a wizard"
          disabled={readOnly}
          onChange={(v) => change({ reqAttune: v ?? true })}
        />
      )}
      <p className="text-caption text-ink-muted">
        {attune !== undefined && attune !== false
          ? 'Its bonuses, defenses and effects count while a character is attuned to it.'
          : 'Its bonuses, defenses and effects count while a character has it.'}
      </p>
    </Section>
  );
}

function Weapon({ draft, change, readOnly }: EditorProps) {
  const riders = list(draft.extraDamage).filter(isRecord);
  const props = list(draft.property)
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.split('|')[0] ?? p);
  const ranged = baseTypeCode(draft.type) === 'R' || props.includes('T');
  const mastery = list(draft.mastery).find((m): m is string => typeof m === 'string');
  const masteryName = mastery?.split('|')[0] ?? '';
  return (
    <Section title="As a weapon">
      <div className="grid grid-cols-2 items-end gap-2">
        <KeptSelect
          label="Kind"
          value={typeof draft.weaponCategory === 'string' ? draft.weaponCategory : ''}
          options={[
            ['simple', 'Simple'],
            ['martial', 'Martial'],
          ]}
          shown="Not given"
          disabled={readOnly}
          onChange={(v) => change({ weaponCategory: v === '' ? undefined : v })}
        />
        <TextField
          label="Damage"
          value={draft.dmg1}
          placeholder="1d8"
          disabled={readOnly}
          onChange={(v) => change(damagePatch(v ?? '', draft.dmgType, draft.type))}
        />
        <KeptSelect
          label="Damage type"
          value={String(draft.dmgType ?? defaultDamageType(draft.type))}
          options={DAMAGE_CODES}
          shown={String(draft.dmgType ?? '')}
          disabled={readOnly}
          onChange={(v) => change({ dmgType: v })}
        />
        {props.includes('V') && (
          <TextField
            label="Two-handed damage"
            value={draft.dmg2}
            placeholder="1d10"
            disabled={readOnly}
            onChange={(v) => change({ dmg2: v })}
          />
        )}
        {ranged && (
          <TextField
            label="Range (feet)"
            value={draft.range}
            placeholder="80/320"
            disabled={readOnly}
            onChange={(v) => change({ range: v })}
          />
        )}
        <KeptSelect
          label="Mastery"
          value={masteryName}
          options={[['', 'None'], ...MASTERIES.map((m) => [m, m] as const)]}
          shown={masteryName}
          disabled={readOnly}
          onChange={(v) => change({ mastery: v === '' ? undefined : [`${v}|XPHB`] })}
        />
      </div>
      <ChipPicks
        label="Properties"
        options={PROPERTIES}
        value={props}
        disabled={readOnly}
        onChange={(next) => {
          const added = next.find((c) => !props.includes(c));
          const removed = props.find((c) => !next.includes(c));
          const flip = added ?? removed;
          if (flip === undefined) return;
          change({
            property: withProperty(draft, flip, added !== undefined),
            ...(removed === 'V' ? { dmg2: undefined } : {}),
          });
        }}
      />
      <div className="grid grid-cols-2 items-end gap-2">
        <TextField
          label="Extra damage on a hit"
          value={riders[0]?.dmg}
          placeholder="1d4"
          disabled={readOnly}
          onChange={(v) => change({ extraDamage: nextRiders(riders, 'dmg', v ?? '') })}
        />
        <KeptSelect
          label="Extra damage type"
          value={String(riders[0]?.dmgType ?? DEFAULT_RIDER_TYPE)}
          options={DAMAGE_CODES}
          shown={String(riders[0]?.dmgType ?? '')}
          disabled={readOnly}
          onChange={(v) => change({ extraDamage: nextRiders(riders, 'dmgType', v) })}
        />
      </div>
    </Section>
  );
}

function Bonuses({ draft, change, readOnly }: EditorProps) {
  const weapon = isWeaponType(draft.type);
  const armor = isArmorType(draft.type);
  return (
    <Section title="Bonuses">
      <div className="grid grid-cols-2 items-end gap-2">
        {armor && (
          <NumberField
            label={baseTypeCode(draft.type) === 'S' ? 'AC it adds' : 'Base AC'}
            value={typeof draft.ac === 'number' ? draft.ac : undefined}
            disabled={readOnly}
            onChange={(ac) => change({ ac })}
          />
        )}
        {weapon && (
          <BonusField
            label="Attack and damage"
            value={draft.bonusWeapon}
            placeholder="+1"
            disabled={readOnly}
            onChange={(bonusWeapon) => change({ bonusWeapon })}
          />
        )}
        <BonusField
          label="AC"
          value={draft.bonusAc}
          placeholder="+1"
          disabled={readOnly}
          onChange={(bonusAc) => change({ bonusAc })}
        />
        <BonusField
          label="Saving throws"
          value={draft.bonusSavingThrow}
          placeholder="+1"
          disabled={readOnly}
          onChange={(bonusSavingThrow) => change({ bonusSavingThrow })}
        />
      </div>
      <p className="text-caption text-ink-muted">
        A bonus to spell attacks or to the spell save DC is a card under What it does.
      </p>
    </Section>
  );
}

function Charges({ draft, change, readOnly }: EditorProps) {
  const charges = typeof draft.charges === 'number' ? draft.charges : undefined;
  const counted = effectsOf(draft).some(isCharges);
  return (
    <Section title="Charges">
      <div className="grid grid-cols-2 items-end gap-2">
        <NumberField
          label="Charges"
          value={charges}
          placeholder="None"
          disabled={readOnly}
          onChange={(n) => change(withCharges(draft, n))}
        />
        {charges !== undefined && (
          <KeptSelect
            label="Regains them"
            value={typeof draft.recharge === 'string' ? draft.recharge : ''}
            options={RECHARGE}
            shown={String(draft.recharge ?? '')}
            disabled={readOnly}
            onChange={(v) => change({ recharge: v === '' ? undefined : v })}
          />
        )}
        {charges !== undefined && draft.recharge !== undefined && (
          <TextField
            label="How many"
            value={rechargeWords(draft.rechargeAmount)}
            placeholder="1d6 + 1, or all"
            disabled={readOnly}
            onChange={(v) => change({ rechargeAmount: rechargeValue(v) })}
          />
        )}
      </div>
      {charges !== undefined && !counted && !readOnly && (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-ink-muted">
            The sheet does not count these yet, so nothing can spend them.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => change(withCharges(draft, charges))}
          >
            Count them on the sheet
          </Button>
        </div>
      )}
      {counted && (
        <p className="text-caption text-ink-muted">
          The sheet counts them, back on a long rest. A Cast a spell card or an action below can
          spend them.
        </p>
      )}
    </Section>
  );
}

/** The one spell an item grants in the standard field, as the Builder wrote it. */
function GrantedSpell({ draft, change, readOnly }: EditorProps) {
  const parsed = readSpellGrant(draft.additionalSpells);
  const [grant, setGrant] = useState<SpellGrant>(() =>
    parsed !== undefined && parsed !== COMPLEX ? parsed : { spell: '' },
  );
  if (draft.additionalSpells === undefined) return null;
  if (parsed === COMPLEX) {
    return (
      <Kept label="Spells it grants">
        more than one spell or a level gate, kept as it is. They work while it is equipped.
      </Kept>
    );
  }
  const push = (next: SpellGrant) => {
    setGrant(next);
    change({ additionalSpells: writeSpellGrant(next) });
  };
  return (
    <div className="grid grid-cols-2 items-end gap-2">
      <TextField
        label="Spell"
        value={grant.spell}
        disabled={readOnly}
        onChange={(v) => push({ ...grant, spell: v ?? '' })}
      />
      <NumberField
        label="Times a day"
        value={grant.perDay}
        placeholder="At will"
        disabled={readOnly}
        onChange={(n) => push({ ...grant, perDay: n === 0 ? undefined : n })}
      />
      <Field label="Attack and DC from">
        <Select
          value={grant.ability ?? ''}
          disabled={readOnly}
          onChange={(e) =>
            push({
              ...grant,
              ability: e.target.value === '' ? undefined : (e.target.value as Ability),
            })
          }
        >
          <option value="">No ability</option>
          {ABILITIES.map((a) => (
            <option key={a} value={a}>
              {a.toUpperCase()}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** The spells "Cast a spell" can name, one per name, the player's edition first. */
function spellOptions(props: EditorProps): SpellOption[] {
  return onePerName(props.registry.byType('spell'), props.draft);
}

function Effects(props: EditorProps) {
  const { draft, change, original, readOnly } = props;
  useTypePacks('spell');
  const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
  const set = (patch: Json) => change({ castGuidance: guidanceWith(draft.castGuidance, patch) });
  return (
    <Section title="What it does on the sheet">
      <GrantedSpell {...props} />
      <EffectCards
        effects={g.effects}
        readOnly={readOnly}
        inherits={original !== undefined ? String(original.name) : undefined}
        replace={g.replace === true}
        onReplace={(replace) => set({ replace: replace ? true : undefined })}
        spells={spellOptions(props)}
        hide={isCharges}
        // The charges resource is shown under Charges, and stays in the list it is hidden from.
        onChange={(effects) => set({ effects: effects.length > 0 ? effects : undefined })}
      />
    </Section>
  );
}

function ItemBody(props: EditorProps) {
  const { draft, change, readOnly } = props;
  return (
    <>
      <About {...props} />
      {isWeaponType(draft.type) && <Weapon {...props} />}
      <Bonuses {...props} />
      <Charges {...props} />
      <Section title="Text">
        <TextBlocks
          entries={draft.entries}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      <Effects {...props} />
    </>
  );
}

export const editor: EditorSpec = {
  noun: 'item',
  blank: () => ({ type: 'W', rarity: 'uncommon', entries: [] }),
  Body: ItemBody,
};
