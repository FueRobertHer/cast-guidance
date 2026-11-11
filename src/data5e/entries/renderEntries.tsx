/**
 * Recursive renderer for the 5etools "entries" format. Tolerance rule:
 * unknown node types render their children (or nothing); unknown inline
 * tags render their body as plain text. Never crash on data.
 */
/** biome-ignore-all lint/suspicious/noArrayIndexKey: entries are static data, index keys are stable */
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { signed } from '@/lib/signed';
import { safeExternalHref } from '@/lib/url';
import { RollChip } from '@/ui/RollChip';
import { parseEntityRef, tokenizeEntryText } from '../tags';
import { DISPLAY_ARG, PLAIN_REF_TAGS } from './inlineTags';
import { libraryPath } from './libraryPath';
import { setsDice, slotLevelsLabel, slotLevelsOf, tagLevels } from './upcast';

// ---------------------------------------------------------------------------
// Inline tags
// ---------------------------------------------------------------------------

/**
 * A link in rules text (DS-001): `ink` with a `line-strong` underline, so it
 * is told from the words around it by its underline, not by a hue. Blue is
 * for rolls in this system, and the gold it used to be is guidance.
 */
const LINK = 'underline decoration-line-strong underline-offset-2 hover:decoration-ink';

/**
 * Every explicit case below is listed in `FORMATTING_TAGS` (inlineTags.ts), so
 * the data audit counts it as handled; the renderer test keeps the two in step.
 */
/**
 * One inline tag. `inline` is whether there are words around it, so a roll
 * chip in a sentence keeps the size of its line (WCAG 2.5.8 exempts a target
 * in a sentence) and one alone, in a table cell say, is a 24 px target.
 * `heals` is whether its sentence says hit points are regained.
 */
function TagView({
  tag,
  args,
  inline,
  heals = false,
  lead = '',
}: {
  tag: string;
  args: string[];
  inline: boolean;
  heals?: boolean;
  /** The words of its sentence before it. */
  lead?: string;
}): ReactNode {
  const body = args[0] ?? '';
  switch (tag) {
    case 'dice':
    case 'damage':
      return (
        <RollChip
          inline={inline}
          expr={body}
          display={args[1]}
          variant={tag === 'damage' ? 'damage' : heals ? 'heal' : 'dice'}
        />
      );
    case 'scaledamage':
    case 'scaledice': {
      // {@scaledamage 8d6|3-9|1d6}: the last arg is the per-step add, or the
      // dice outright where the sentence says "increases to".
      const add = args[2] ?? body;
      return (
        <RollChip
          inline={inline}
          expr={add}
          variant={tag === 'scaledice' && heals ? 'heal' : 'damage'}
          label={scaleLabel(add, args[1] ?? '', lead)}
        />
      );
    }
    case 'hit': {
      const n = Number.parseInt(body, 10);
      return (
        <RollChip
          inline={inline}
          expr={`1d20${n >= 0 ? '+' : ''}${n}`}
          display={signed(n)}
          variant="d20"
          label={`Attack roll ${signed(n)}`}
        />
      );
    }
    case 'd20': {
      const n = Number.parseInt(body || '0', 10);
      return (
        <RollChip
          inline={inline}
          expr={`1d20${n >= 0 ? '+' : ''}${n}`}
          display={`d20${n !== 0 ? signed(n) : ''}`}
          variant="d20"
          label={`d20${n !== 0 ? signed(n) : ''} roll`}
        />
      );
    }
    case 'dc':
      return <span className="font-semibold">DC {body}</span>;
    case 'chance':
      return <span>{body} percent</span>;
    case 'atk':
      return <em className="text-ink-muted">{body}</em>;
    case 'b':
    case 'bold':
      return (
        <strong>
          <InlineText text={body} />
        </strong>
      );
    case 'i':
    case 'italic':
      return (
        <em>
          <InlineText text={body} />
        </em>
      );
    case 'u':
      return (
        <u>
          <InlineText text={body} />
        </u>
      );
    case 's':
      return (
        <s>
          <InlineText text={body} />
        </s>
      );
    case 'h':
      return <span className="font-semibold text-ink">Hit: </span>;
    case 'note':
      return (
        <span className="text-ink-muted">
          <InlineText text={body} />
        </span>
      );
    case 'tip':
      return <span title={args[1]}>{body}</span>;
    case 'color': {
      // {@color text|hexOrName} — apply only safe hex colors.
      const c = args[1] ?? '';
      const safe = /^[0-9a-fA-F]{3,8}$/.test(c) ? `#${c}` : undefined;
      return (
        <span style={safe ? { color: safe } : undefined}>
          <InlineText text={body} />
        </span>
      );
    }
    case 'link': {
      // Content-driven URL — allow only plain http(s); render inert text otherwise.
      const href = safeExternalHref(args[1] ?? body);
      if (href === undefined) return <InlineText text={body} />;
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className={LINK}>
          {body}
        </a>
      );
    }
    default: {
      const path = libraryPath(tag, args);
      if (path !== undefined) {
        const ref = parseEntityRef(args, DISPLAY_ARG.get(tag));
        return (
          <Link to={path} className={LINK}>
            <InlineText text={ref.display} />
          </Link>
        );
      }
      if (PLAIN_REF_TAGS.has(tag)) {
        // Something the library has no page for: plain words, since a mark
        // with nowhere to go would read as a link that does nothing.
        const ref = parseEntityRef(args, DISPLAY_ARG.get(tag));
        return (
          <span>
            <InlineText text={ref.display} />
          </span>
        );
      }
      // Unknown tag: show the body text, drop the tag (drift tolerance).
      return <InlineText text={body} />;
    }
  }
}

/**
 * Whether the dice between `before` and `after` are a heal, by their
 * sentence: "healing" ahead of them ("The healing increases by
 * {@scaledice 1d8|1-9|1d8}"), or "regain" ahead of them with hit points
 * either side ("You regain {@dice 2d4 + 2} hit points"). A wand that "regains
 * {@dice 1d6 + 1} expended charges" is not a heal.
 */
function healsBetween(before: string, after: string): boolean {
  const lead = before.match(/[^.]*$/)?.[0] ?? '';
  if (/\bhealing\b/i.test(lead)) return true;
  const sentence = `${lead}${after.split('.')[0] ?? ''}`;
  return /\bregains?\b/i.test(lead) && /\bhit points?\b/i.test(sentence);
}

/**
 * What an upcast chip adds: a step each slot level ("+1d6 per slot level"), a
 * step at the levels a list names ("+1d6 at slot levels 4, 6 and 8", Flame
 * Blade's every two), or the dice outright at the slots its sentence names
 * (Elemental Weapon's "increases to 2d4" at 5th and 6th).
 */
function scaleLabel(add: string, list: string, lead: string): string {
  if (setsDice(lead)) {
    const levels = slotLevelsOf(lead);
    return levels === undefined
      ? `scaling: ${add} at a higher slot`
      : `scaling: ${add} at slot level${levels.length > 1 ? 's' : ''} ${slotLevelsLabel(levels)}`;
  }
  const levels = tagLevels(list);
  const each =
    levels === undefined || levels.every((l, i) => i === 0 || l === (levels[i - 1] ?? 0) + 1);
  return each || levels === undefined
    ? `scaling: +${add} per slot level`
    : `scaling: +${add} at slot levels ${slotLevelsLabel(levels.slice(1))}`;
}

export function InlineText({ text }: { text: string }): ReactNode {
  const tokens = tokenizeEntryText(text);
  const prose = tokens.some((t) => t.kind === 'text' && t.text.trim() !== '');
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === 'text') return <Fragment key={i}>{t.text}</Fragment>;
        const before = tokens[i - 1];
        const after = tokens[i + 1];
        const heals =
          before?.kind === 'text' &&
          healsBetween(before.text, after?.kind === 'text' ? after.text : '');
        const lead = before?.kind === 'text' ? (before.text.match(/[^.]*$/)?.[0] ?? '') : '';
        return (
          <TagView key={i} tag={t.tag} args={t.args} inline={prose} heals={heals} lead={lead} />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;

/**
 * A named block's heading: `heading` at the top, a section of the rules, and
 * `body-strong` below it, so nested names stay the reading size (DS-001).
 */
function headingClass(depth: number): string {
  return depth <= 0 ? 'text-heading' : 'text-body-strong';
}

function NamedBlock({ node, depth }: { node: Node; depth: number }): ReactNode {
  const name = typeof node.name === 'string' ? node.name : undefined;
  return (
    <section className="flex flex-col gap-1.5">
      {name !== undefined && <h3 className={headingClass(depth)}>{name}</h3>}
      <EntriesView entries={node.entries ?? node.entry} depth={depth + 1} />
    </section>
  );
}

function ListBlock({ node, depth }: { node: Node; depth: number }): ReactNode {
  const items = Array.isArray(node.items) ? node.items : [];
  return (
    <ul className="ml-5 flex list-disc flex-col gap-1">
      {items.map((item, i) => (
        <li key={i}>
          <EntryNode node={item} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

function TableBlock({ node, depth }: { node: Node; depth: number }): ReactNode {
  const caption = typeof node.caption === 'string' ? node.caption : undefined;
  const colLabels = Array.isArray(node.colLabels) ? node.colLabels : [];
  const rows = Array.isArray(node.rows) ? node.rows : [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-caption">
        {caption !== undefined && (
          <caption className="pb-1 text-left font-semibold">{caption}</caption>
        )}
        {colLabels.length > 0 && (
          <thead>
            <tr>
              {colLabels.map((c, i) => (
                <th
                  key={i}
                  className="border-b border-line-strong px-2 py-1 text-left text-ink-muted"
                >
                  {typeof c === 'string' ? <InlineText text={c} /> : null}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line">
              {(Array.isArray(row) ? row : []).map((cell, j) => (
                <td key={j} className="px-2 py-1 align-top">
                  <EntryNode node={cell} depth={depth + 1} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryNode({ node, depth }: { node: unknown; depth: number }): ReactNode {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return <InlineText text={node} />;
  if (typeof node === 'number') return <>{node}</>;
  if (Array.isArray(node)) return <EntriesView entries={node} depth={depth} />;
  if (typeof node !== 'object') return null;

  const n = node as Node;
  const type = typeof n.type === 'string' ? n.type : 'entries';
  switch (type) {
    case 'entries':
    case 'section':
    case 'inline':
    case 'inlineBlock':
    case 'options':
      return <NamedBlock node={n} depth={depth} />;
    case 'list':
      return <ListBlock node={n} depth={depth} />;
    case 'table':
      return <TableBlock node={n} depth={depth} />;
    case 'inset':
    case 'insetReadaloud':
      return (
        // A sidebar: `surface-raised`, which reads apart from both grounds
        // rules text sits on (the library's `bg` and a sheet's `surface`).
        <div className="rounded-control bg-surface-raised p-3">
          <NamedBlock node={n} depth={depth + 1} />
        </div>
      );
    case 'quote':
      return (
        <blockquote className="border-l-2 border-line-strong pl-3 italic text-ink-muted">
          <EntriesView entries={n.entries} depth={depth + 1} />
          {typeof n.by === 'string' && <div className="mt-1 text-caption">— {n.by}</div>}
        </blockquote>
      );
    case 'item':
    case 'itemSpell':
    case 'itemSub':
      return (
        <div>
          {typeof n.name === 'string' && <strong>{n.name} </strong>}
          <EntryNode node={n.entry ?? n.entries} depth={depth + 1} />
        </div>
      );
    case 'cell': {
      const roll = n.roll as Node | undefined;
      if (roll !== undefined) {
        const exact = roll.exact;
        const min = roll.min;
        const max = roll.max;
        if (exact !== undefined) return <>{String(exact)}</>;
        return (
          <>
            {String(min ?? '')}–{String(max ?? '')}
          </>
        );
      }
      return <EntryNode node={n.entry ?? n.entries} depth={depth} />;
    }
    case 'abilityDc':
      return (
        <p className="font-semibold">
          {String(n.name ?? '')} save DC = 8 + your proficiency bonus + your{' '}
          {Array.isArray(n.attributes) ? n.attributes.join('/') : ''} modifier
        </p>
      );
    case 'abilityAttackMod':
      return (
        <p className="font-semibold">
          {String(n.name ?? '')} attack modifier = your proficiency bonus + your{' '}
          {Array.isArray(n.attributes) ? n.attributes.join('/') : ''} modifier
        </p>
      );
    case 'refClassFeature':
    case 'refSubclassFeature':
    case 'refOptionalfeature': {
      // Reference nodes are resolved by feature-aware views (M2); show the name.
      const ref = String(n.classFeature ?? n.subclassFeature ?? n.optionalfeature ?? '');
      const name = ref.split('|')[0] ?? '';
      return <p className="text-ink-muted">{name}</p>;
    }
    default:
      // Unknown block: render its children if it has any, else nothing.
      if (n.entries !== undefined || n.entry !== undefined) {
        return <NamedBlock node={n} depth={depth} />;
      }
      return null;
  }
}

export function EntriesView({
  entries,
  depth = 0,
}: {
  entries: unknown;
  depth?: number;
}): ReactNode {
  if (entries === null || entries === undefined) return null;
  const list = Array.isArray(entries) ? entries : [entries];
  return (
    // Rules text is `body` (DS-001), whichever sheet or page shows it, so the
    // top level sets it; nested blocks inherit it, or a table's smaller size.
    <div className={depth <= 0 ? 'flex flex-col gap-2 text-body' : 'flex flex-col gap-2'}>
      {list.map((node, i) =>
        // Bare strings become paragraphs; blocks manage their own layout.
        typeof node === 'string' ? (
          <p key={i}>
            <EntryNode node={node} depth={depth} />
          </p>
        ) : (
          <Fragment key={i}>
            <EntryNode node={node} depth={depth} />
          </Fragment>
        ),
      )}
    </div>
  );
}
