/**
 * Recursive renderer for the 5etools "entries" format. Tolerance rule:
 * unknown node types render their children (or nothing); unknown inline
 * tags render their body as plain text. Never crash on data.
 */
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { RollChip } from '@/ui/RollChip';
import { parseEntityRef, tokenizeEntryText } from '../tags';

// ---------------------------------------------------------------------------
// Inline tags
// ---------------------------------------------------------------------------

/** Tags that link into a Library-browsable entity type (tag -> route type). */
const LINKED_TYPES: Record<string, string> = {
  spell: 'spell',
  item: 'item',
  condition: 'condition',
  skill: 'skill',
  action: 'action',
  sense: 'sense',
  feat: 'feat',
  race: 'race',
  background: 'background',
  class: 'class',
  subclass: 'subclass',
  language: 'language',
  variantrule: 'variantrule',
  optfeature: 'optionalfeature',
  disease: 'disease',
  status: 'status',
  book: 'book',
};

/** Tags rendered as a styled name only (no target in our registry). */
const PLAIN_REF_TAGS = new Set([
  'creature',
  'deity',
  'hazard',
  'object',
  'trap',
  'card',
  'deck',
  'vehicle',
  'vehupgrade',
  'adventure',
  'table',
  'quickref',
  'filter',
  '5etools',
  'classFeature',
  'subclassFeature',
  'itemProperty',
  'itemMastery',
]);

function TagView({ tag, args }: { tag: string; args: string[] }): ReactNode {
  const body = args[0] ?? '';
  switch (tag) {
    case 'dice':
    case 'damage':
      return (
        <RollChip expr={body} display={args[1]} variant={tag === 'damage' ? 'damage' : 'dice'} />
      );
    case 'scaledamage':
    case 'scaledice': {
      // {@scaledamage 8d6|3-9|1d6} — the last arg is the per-step add.
      const add = args[2] ?? body;
      return <RollChip expr={add} variant="damage" label={`scaling: +${add} per level`} />;
    }
    case 'hit': {
      const n = Number.parseInt(body, 10);
      const sign = n >= 0 ? '+' : '';
      return (
        <RollChip expr={`1d20${n >= 0 ? '+' : ''}${n}`} display={`${sign}${n}`} variant="d20" />
      );
    }
    case 'd20': {
      const n = Number.parseInt(body || '0', 10);
      return (
        <RollChip
          expr={`1d20${n >= 0 ? '+' : ''}${n}`}
          display={`d20${n !== 0 ? (n > 0 ? `+${n}` : n) : ''}`}
          variant="d20"
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
    case 'link':
      return (
        <a
          href={args[1] ?? body}
          target="_blank"
          rel="noreferrer"
          className="text-sky-300 underline"
        >
          {body}
        </a>
      );
    default: {
      const routeType = LINKED_TYPES[tag];
      if (routeType !== undefined) {
        const ref = parseEntityRef(args);
        const uid = ref.source ? `${ref.name}|${ref.source}` : ref.name;
        return (
          <Link
            to={`/library/${routeType}/${encodeURIComponent(uid.toLowerCase())}`}
            className="text-amber-200 underline decoration-amber-200/40 underline-offset-2"
          >
            <InlineText text={ref.display} />
          </Link>
        );
      }
      if (PLAIN_REF_TAGS.has(tag)) {
        const ref = parseEntityRef(args);
        return (
          <span className="text-amber-200/80">
            <InlineText text={ref.display} />
          </span>
        );
      }
      // Unknown tag: show the body text, drop the tag (drift tolerance).
      return <InlineText text={body} />;
    }
  }
}

export function InlineText({ text }: { text: string }): ReactNode {
  const tokens = tokenizeEntryText(text);
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === 'text' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static token list
          <Fragment key={i}>{t.text}</Fragment>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static token list
          <TagView key={i} tag={t.tag} args={t.args} />
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;

function headingClass(depth: number): string {
  if (depth <= 0) return 'text-lg font-bold';
  if (depth === 1) return 'text-base font-semibold';
  return 'text-sm font-semibold';
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
        // biome-ignore lint/suspicious/noArrayIndexKey: static data
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
      <table className="w-full border-collapse text-sm">
        {caption !== undefined && (
          <caption className="pb-1 text-left font-semibold">{caption}</caption>
        )}
        {colLabels.length > 0 && (
          <thead>
            <tr>
              {colLabels.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static data
                <th
                  key={i}
                  className="border-b border-surface-2 px-2 py-1 text-left text-ink-muted"
                >
                  {typeof c === 'string' ? <InlineText text={c} /> : null}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static data
            <tr key={i} className="odd:bg-surface/40">
              {(Array.isArray(row) ? row : []).map((cell, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static data
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
        <div className="rounded-lg border border-surface-2 bg-surface p-3">
          <NamedBlock node={n} depth={depth + 1} />
        </div>
      );
    case 'quote':
      return (
        <blockquote className="border-l-2 border-surface-2 pl-3 italic text-ink-muted">
          <EntriesView entries={n.entries} depth={depth + 1} />
          {typeof n.by === 'string' && <div className="mt-1 text-xs">— {n.by}</div>}
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
    <div className="flex flex-col gap-2 leading-relaxed">
      {list.map((node, i) => {
        const rendered = <EntryNode node={node} depth={depth} />;
        // Bare strings become paragraphs; blocks manage their own layout.
        return typeof node === 'string' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static data
          <p key={i}>{rendered}</p>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static data
          <Fragment key={i}>{rendered}</Fragment>
        );
      })}
    </div>
  );
}
