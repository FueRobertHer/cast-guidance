/**
 * Items: what the item is, the weapon or armor it is, its bonuses and charges,
 * its text, and what it does on the sheet while its magic works.
 *
 * The fields are the ones the sheet already reads (`type`, `dmg1`, `ac`,
 * `bonusWeapon`, `bonusAc`, `bonusSavingThrow`, `reqAttune`, `extraDamage`,
 * `additionalSpells`); the rest of what an item does is its `castGuidance`,
 * read through `mechanicsOf` while it is attuned (or needs no attunement).
 * Charges are the standard `charges`, `recharge` and `rechargeAmount` fields
 * and, so the sheet counts them, the item's `charges` effect made from them:
 * the spells they cast, each priced by level, which an action can spend too.
 */
import { CircleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTypePacks } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { isRecord, RULE_SET_TYPE, type StoredEffect } from '@/engine/castGuidance';
import {
  fieldChargesOf,
  ITEM_CHARGES,
  itemChargesIn,
  itemDcIn,
  rechargeWords,
  regainOf,
  upgradeOlderCharges,
} from '@/engine/curated/itemCharges';
import { type ItemCharges, officialOf, readOwnEffects } from '@/engine/effects/mechanics';
import { ABILITIES, type Ability, type DataEntity, type EntityRef, refUid } from '@/engine/types';
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
/**
 * Regains them, for an effect written by hand that says what comes back with
 * no recharge field: shown, never written.
 */
const AS_WRITTEN = '*as-written';
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

/** The Workshop's older way of counting an item's charges: a pool of its own under the key `charges`. */
const isOldCharges = (e: StoredEffect) => e.kind === 'resource' && e.key === ITEM_CHARGES;
/** The item's charges as the sheet counts them: its `charges` effect. */
const isCharges = (e: StoredEffect) => e.kind === 'charges';

/** The item's own effects, as its `castGuidance` holds them. */
const effectsOf = (draft: Json): StoredEffect[] => {
  const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
  return list(g.effects).filter(isRecord) as StoredEffect[];
};

/** When an item's charges come back, as its `recharge` field says it: an empty one says none. */
const rechargeIn = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined;

/**
 * The patch for an item's charges: `patch` to its standard fields (`charges`,
 * `recharge`, `rechargeAmount`) and the `charges` effect the sheet counts them
 * by, made from them, with what `own` sets (its spells, the ability they cast
 * with) or else what it had. The effect is begun by `own` (Count them on the
 * sheet) or by charges given an item that had none, and taken out with them.
 * A field the item leaves out keeps what the effect says (a file written by
 * hand). An item that counts them the older way (`isOldCharges`, and no
 * effect) gets its fields alone.
 */
export function withCharges(draft: Json, patch: Json, own?: Json): Json {
  const effects = effectsOf(draft);
  const had = effects.find(isCharges);
  const n = 'charges' in patch ? patch.charges : (draft.charges ?? had?.charges);
  const charges = typeof n === 'number' && n > 0 ? n : undefined;
  const fields = 'charges' in patch ? { ...patch, charges } : patch;
  const begins = own !== undefined || (typeof draft.charges !== 'number' && charges !== undefined);
  if (had === undefined && (!begins || effects.some(isOldCharges))) return fields;
  const next = { ...draft, ...fields };
  // What comes back is the fields' once they say it, or are changed. (How
  // many is changed only beside a recharge.)
  const fresh = had === undefined || 'recharge' in patch || rechargeIn(next.recharge) !== undefined;
  const kept: Json = {
    ability: had?.ability,
    spells: had?.spells,
    dc: had?.dc,
    attack: had?.attack,
    ...own,
  };
  const spells = list(kept.spells);
  const made: StoredEffect | undefined =
    charges === undefined
      ? undefined
      : ({
          kind: 'charges',
          charges,
          regain: fresh ? regainOf(next.recharge, next.rechargeAmount) : had.regain,
          ...(typeof kept.ability === 'string' ? { ability: kept.ability } : {}),
          ...(typeof kept.dc === 'number' ? { dc: kept.dc } : {}),
          ...(typeof kept.attack === 'number' ? { attack: kept.attack } : {}),
          ...(spells.length > 0 ? { spells } : {}),
        } as StoredEffect);
  const now =
    made === undefined
      ? effects.filter((e) => !isCharges(e))
      : had === undefined
        ? [made, ...effects]
        : effects.map((e) => (e === had ? made : e));
  return {
    ...fields,
    castGuidance: guidanceWith(draft.castGuidance, {
      effects: now.length > 0 ? now : undefined,
    }),
  };
}

/**
 * The spells a built-in `charges` row prices, written as an item's own effect
 * names them: each with its book, the first of `options` by its name (the
 * item's edition first), or its name alone when the data has none.
 */
export function rowSpells(
  row: ItemCharges,
  options: readonly SpellOption[],
  registry?: Pick<EntityRegistry, 'get'>,
): Json[] {
  return row.spells.map((s) => {
    // A spell its fields name with its book is that printing, where the data has it.
    const named =
      s.ref === undefined || s.ref.source === ''
        ? undefined
        : registry?.get('spell', s.ref.name, s.ref.source);
    const hit =
      typeof named?.name === 'string' && typeof named.source === 'string'
        ? { name: named.name, source: named.source }
        : options.find((o) => o.name.toLowerCase() === s.spell.toLowerCase());
    return {
      spell: hit === undefined ? s.spell : `${hit.name}|${hit.source}`,
      cost: s.cost,
      ...(s.upTo === undefined ? {} : { upTo: s.upTo }),
      ...(s.at === undefined ? {} : { at: s.at }),
    };
  });
}

/**
 * Where a copy of `original` finds the official one's built-in rows: under the
 * original's own `name|source`, then the official item it stands for (a copy
 * it copies, or a converted file's printing), which the copy is saved
 * `basedOn` (`basedOnKey`).
 */
export function originalRefs(original: Json): EntityRef[] {
  const own = { name: String(original.name), source: String(original.source) };
  const official = officialOf(original as DataEntity);
  return official === undefined || refUid(official) === refUid(own) ? [own] : [own, official];
}

/** The first of `refs` a lookup finds something under. */
function firstOf<T>(refs: readonly EntityRef[], find: (ref: EntityRef) => T | undefined) {
  for (const ref of refs) {
    const hit = find(ref);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * What an official item's spells cast with that its own effect would lose: the
 * DC and attack bonus its built-in `itemDc` row fixes, which a written-out
 * effect says itself (`itemChargesOf` takes an effect's numbers as they are),
 * found as `originalRefs` finds it.
 */
export function fixedOfOriginal(registry: EntityRegistry, original: Json | undefined): Json {
  if (original === undefined) return {};
  const sets = registry.byType(RULE_SET_TYPE) as readonly DataEntity[];
  return { ...firstOf(originalRefs(original), (ref) => itemDcIn(sets, ref)) };
}

/** What was typed, stored as the data has it: a number, a tagged roll, or the words. */
export function rechargeValue(typed: string | undefined): string | number | undefined {
  if (typed === undefined) return undefined;
  const t = typed.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d*d\d+(\s*[+-]\s*\d+)?$/i.test(t)) return `{@dice ${t}}`;
  return typed;
}

/** A weapon's properties with `code` on or off, written as the others are (`F|XPHB` beside `L|XPHB`). */
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

/** A problem with an item's charges, in the words a card would use. */
function chargeProblem(p: string): string {
  const pick = /^spell (\d+): "spell" is (?:"name\|source"|the spell's name)$/.exec(p);
  return pick === null ? p : `spell ${pick[1]}: pick a spell from the list`;
}

/** One spell an item's charges cast: the spell, what it costs, and the highest level it is cast at. */
function ChargeSpell({
  n,
  spell,
  options,
  listId,
  disabled,
  onChange,
  onRemove,
}: {
  n: number;
  spell: Json;
  options: readonly SpellOption[];
  listId: string;
  disabled: boolean;
  onChange: (next: Json) => void;
  onRemove: () => void;
}) {
  const ref = typeof spell.spell === 'string' ? spell.spell : '';
  const [held, setHeld] = useState(ref.split('|')[0] ?? '');
  const resolve = (name: string) => {
    const hit = options.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());
    return hit === undefined ? name : `${hit.name}|${hit.source}`;
  };
  // A row is its place in the list, so it can be handed the next one's spell
  // (this one's above removed): then that spell is shown, not what was typed.
  const typed = resolve(held) === ref ? held : (ref.split('|')[0] ?? '');
  const whole = (v: string) => {
    const k = Number.parseInt(v, 10);
    return Number.isNaN(k) ? undefined : Math.max(0, Math.min(99, k));
  };
  // One level for its cost (a Staff of Power's 5th-level Fireball), in place of
  // the highest: the box says that level until it is cleared.
  const fixedAt = typeof spell.at === 'number';
  const { upTo: _, at: __, ...rest } = spell;
  const levelBox = fixedAt ? spell.at : spell.upTo;
  return (
    <div className="grid grid-cols-[1fr_4.5rem_4.5rem_auto] items-end gap-2">
      <Field label="Spell">
        <input
          aria-label={`Charge spell ${n}`}
          list={listId}
          value={typed}
          placeholder="Fireball"
          disabled={disabled}
          onChange={(e) => {
            setHeld(e.target.value);
            onChange({ ...spell, spell: resolve(e.target.value) });
          }}
          className={fieldClass}
        />
      </Field>
      <Field label="Costs">
        <input
          aria-label={`Charge spell ${n}: costs`}
          inputMode="numeric"
          value={typeof spell.cost === 'number' ? spell.cost : ''}
          disabled={disabled}
          onChange={(e) => onChange({ ...spell, cost: whole(e.target.value) })}
          className={fieldClass}
        />
      </Field>
      <Field label={fixedAt ? 'At level' : 'Up to level'}>
        <input
          aria-label={`Charge spell ${n}: ${fixedAt ? 'at level' : 'up to level'}`}
          inputMode="numeric"
          value={typeof levelBox === 'number' ? levelBox : ''}
          placeholder="Its own"
          disabled={disabled}
          onChange={(e) => {
            const to = whole(e.target.value);
            onChange(to === undefined ? rest : { ...rest, [fixedAt ? 'at' : 'upTo']: to });
          }}
          className={fieldClass}
        />
      </Field>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Remove charge spell ${n}`}
        disabled={disabled}
        onClick={onRemove}
      >
        Remove
      </Button>
    </div>
  );
}

function Charges(props: EditorProps) {
  const { draft, change, original, registry, readOnly } = props;
  const listId = useId();
  const spellData = useTypePacks('spell');
  const effects = effectsOf(draft);
  const counted = effects.find(isCharges) as Json | undefined;
  // A file written by hand may say them in the effect alone.
  const n = draft.charges ?? counted?.charges;
  const charges = typeof n === 'number' ? n : undefined;
  // The recharge the fields say; an empty one is none, as `regainOf` reads it
  // (and a time no long rest covers, such as `special`, gives none back).
  const recharge = rechargeIn(draft.recharge);
  // What comes back as the effect says it, shown while no recharge field says it.
  // (A number or words: none, in any case, is no regain, as the reader takes it.)
  const said = counted?.regain;
  const handRegain =
    typeof said === 'number' || (typeof said === 'string' && said !== '' && !/^none$/i.test(said))
      ? said
      : undefined;
  const old = counted === undefined && effects.some(isOldCharges);
  // With no effect, the sheet counts them as the fields say, when they read.
  const byFields = counted === undefined ? fieldChargesOf(draft) : undefined;
  // The effect an empty Charges box (or none at all, 0) took out, and its place,
  // put back whole when a number is typed again: a new number by way of an
  // empty box ends as typing it in place would.
  const cleared = useRef<{ effect: Json; at: number } | undefined>(undefined);
  const options = spellOptions(props);
  // A copy of an official item the app counts already: its row is written out
  // (a copy of a copy, or of a converted file's item, the official one's).
  const sets = registry.byType(RULE_SET_TYPE) as readonly DataEntity[];
  const row =
    original === undefined
      ? undefined
      : firstOf(originalRefs(original), (ref) => itemChargesIn(sets, ref));
  const set = (patch: Json, own?: Json) => change(withCharges(draft, patch, own));
  const setCharges = (to: number | undefined) => {
    if (to === undefined || to <= 0) {
      if (counted !== undefined) {
        cleared.current = { effect: counted, at: effects.indexOf(counted as StoredEffect) };
      }
      set({ charges: to });
      return;
    }
    const back = counted === undefined ? cleared.current : undefined;
    cleared.current = undefined;
    if (back === undefined) {
      set({ charges: to });
      return;
    }
    const now = [...effects];
    now.splice(back.at, 0, back.effect as StoredEffect);
    const restored = { ...draft, castGuidance: guidanceWith(draft.castGuidance, { effects: now }) };
    change(withCharges(restored, { charges: to }));
  };
  const spells = list(counted?.spells).filter(isRecord) as Json[];
  // Written out, the effect says what the sheet counted: the row's spells or
  // the fields', and the DC the original's text fixes.
  const fixed = fixedOfOriginal(registry, original);
  const fieldSpells = byFields?.spells ?? [];
  const fromRow =
    row === undefined ? undefined : (
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={spellData.status !== 'ready'}
        onClick={() => set({}, { spells: rowSpells(row, options), ...fixed })}
      >
        {counted === undefined && byFields === undefined
          ? 'Count them on the sheet'
          : `Add the spells ${String(original?.name)} casts`}
      </Button>
    );
  const setSpells = (next: Json[]) => set({}, { spells: next });
  const problems =
    counted === undefined
      ? []
      : readOwnEffects([counted], 'effects').problems.map((p) =>
          chargeProblem(p.replace(/^effect 1( \([^)]*\))?: /, '')),
        );
  return (
    <Section title="Charges">
      <div className="grid grid-cols-2 items-end gap-2">
        <NumberField
          label="Charges"
          value={charges}
          placeholder="None"
          disabled={readOnly}
          onChange={setCharges}
        />
        {charges !== undefined && (
          <KeptSelect
            label="Regains them"
            value={recharge ?? (handRegain !== undefined ? AS_WRITTEN : '')}
            options={RECHARGE}
            shown={
              recharge ??
              `${/^all$/i.test(String(handRegain)) ? 'All' : String(handRegain)} at dawn, as written`
            }
            disabled={readOnly}
            onChange={(v) => {
              // A select sends no change for the option already chosen, so this
              // only guards: what the effect says is never written as a recharge.
              if (v === AS_WRITTEN) return;
              // A time picked in its place keeps how many the effect says.
              const carried =
                v !== '' && recharge === undefined && handRegain !== undefined
                  ? { rechargeAmount: rechargeValue(String(handRegain)) }
                  : {};
              set({ recharge: v === '' ? undefined : v, ...carried });
            }}
          />
        )}
        {charges !== undefined && recharge !== undefined && (
          <TextField
            label="How many"
            value={rechargeWords(draft.rechargeAmount)}
            placeholder="1d6 + 1, or all"
            disabled={readOnly}
            onChange={(v) => set({ rechargeAmount: rechargeValue(v) })}
          />
        )}
      </div>
      {charges !== undefined && old && (
        <p className="text-caption text-ink-muted">
          The Charges card under What it does on the sheet counts these the older way. Remove the
          card, and the Cast a spell cards that spend it, to count them here alone, where each spell
          costs its charges by level.
        </p>
      )}
      {charges !== undefined && !old && counted === undefined && !readOnly && (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-ink-muted">
            {byFields === undefined
              ? 'The sheet does not count these yet, so nothing can spend them.'
              : fieldSpells.length > 0
                ? `The sheet counts these, and they cast the ${fieldSpells.length === 1 ? 'spell' : `${fieldSpells.length} spells`} the item's data lists.`
                : 'The sheet counts these, and they cast no spells yet.'}
            {row !== undefined &&
              (byFields !== undefined
                ? ` They can cast the spells ${String(original?.name)} casts, priced as the app prices them.`
                : ` Counted, they cast the spells ${String(original?.name)} casts, priced as the app prices them.`)}
          </p>
          {fromRow ?? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={fieldSpells.length > 0 && spellData.status !== 'ready'}
              onClick={() =>
                set(
                  {},
                  fieldSpells.length > 0
                    ? { spells: rowSpells(byFields as ItemCharges, options, registry), ...fixed }
                    : fixed,
                )
              }
            >
              {byFields === undefined
                ? 'Count them on the sheet'
                : fieldSpells.length > 0
                  ? 'Change the spells they cast'
                  : 'Add spells they cast'}
            </Button>
          )}
        </div>
      )}
      {counted !== undefined && (
        <>
          <Field label="Its spells' attack and DC from">
            <Select
              value={typeof counted.ability === 'string' ? counted.ability : ''}
              disabled={readOnly}
              onChange={(e) =>
                set({}, { ability: e.target.value === '' ? undefined : e.target.value })
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
          {spells.map((s, i) => (
            <ChargeSpell
              // A row is its place in the list, as a card is.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={i}
              n={i + 1}
              spell={s}
              options={options}
              listId={listId}
              disabled={readOnly}
              onChange={(next) => setSpells(spells.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setSpells(spells.filter((_, j) => j !== i))}
            />
          ))}
          <datalist id={listId}>
            {options.map((o) => (
              <option key={`${o.name}|${o.source}`} value={o.name} />
            ))}
          </datalist>
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setSpells([...spells, { spell: '', cost: 1 }])}
            >
              Add a spell its charges cast
            </Button>
          )}
          {!readOnly && spells.length === 0 && fromRow}
          {problems.map((p) => (
            <p key={p} className="flex items-start gap-1.5 text-caption text-danger">
              <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
              This does not count yet: {p}
            </p>
          ))}
          <p className="text-caption text-ink-muted">
            The sheet counts them, a pool for each one carried. Each spell costs its charges at its
            own level, and one more a level up to the level it says, or casts at the one level it
            says. An action below can spend them too.
          </p>
          {(typeof counted.dc === 'number' || typeof counted.attack === 'number') && (
            <p className="text-caption text-ink-muted">
              Every spell it casts uses{' '}
              {[
                typeof counted.dc === 'number' ? `save DC ${counted.dc}` : undefined,
                typeof counted.attack === 'number' ? `+${counted.attack} to hit` : undefined,
              ]
                .filter((s) => s !== undefined)
                .join(' and ')}
              , as its text says, in place of the character's own.
            </p>
          )}
        </>
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
  // Shown while the editor is open once the item had one: emptying the box to
  // type another name takes the grant out of the data, not the field off screen.
  const [had] = useState(() => draft.additionalSpells !== undefined);
  if (!had) return null;
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
        holdsCharges
        // The charges effect is shown under Charges, and stays in the list it is hidden from.
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
  // One saved before the Charges section counted them opens as the sheet reads
  // it, so a save writes it so.
  open: (entry) => upgradeOlderCharges(entry as DataEntity) as Json,
};
