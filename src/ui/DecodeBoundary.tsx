import { AlertTriangle } from 'lucide-react';
import { Component, type ReactNode } from 'react';

interface DecodeBoundaryProps {
  /** Names what failed, in the sentence the user reads: "This item". */
  label: string;
  /** Rendered beside the message: the way out, usually a delete or a close. */
  action?: ReactNode;
  /**
   * Changing this clears a caught failure and renders the children again.
   *
   * A caught boundary holds its error for as long as React keeps the instance,
   * and a list key like `unnamed-2` does not identify a record: delete the
   * entry ahead of it and the same key belongs to a different record, which
   * would inherit a failure that was never its own. Pass something that
   * changes when the list moves, and a boundary whose subject may have changed
   * tries again instead.
   */
  resetKey?: string | number;
  children: ReactNode;
}

interface DecodeBoundaryState {
  detail: string | null;
  /** The `resetKey` the current state was reached under. */
  seen: string | number | undefined;
}

/**
 * Contains a decode failure to the one record that caused it (REL-005).
 *
 * The route-level `errorElement` is the last resort and behaves like one: it
 * replaces the whole screen, so a single homebrew entity the app cannot read
 * would take the rest of the file's entities down with it, along with the way
 * to delete the bad one. This boundary goes around one record, so a record
 * that throws while it is being read or rendered fails where it is shown and
 * everything around it keeps working.
 *
 * Deliberately not a live region: several of these can mount at once on a
 * damaged file, and a screen reader being told about each in turn is worse
 * than finding them in reading order.
 */
export class DecodeBoundary extends Component<DecodeBoundaryProps, DecodeBoundaryState> {
  state: DecodeBoundaryState = { detail: null, seen: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): { detail: string } {
    return { detail: error instanceof Error ? error.message : String(error) };
  }

  static getDerivedStateFromProps(
    props: DecodeBoundaryProps,
    state: DecodeBoundaryState,
  ): DecodeBoundaryState | null {
    if (props.resetKey === state.seen) return null;
    return { detail: null, seen: props.resetKey };
  }

  render(): ReactNode {
    const { detail } = this.state;
    if (detail === null) return this.props.children;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/40 bg-surface px-3 py-2">
        <AlertTriangle size={14} className="shrink-0 text-amber-300" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs text-ink-muted">
          {this.props.label} could not be read, so it is shown this way instead. Everything else
          here is fine.
          <span className="block truncate font-mono text-[11px]">{detail}</span>
        </p>
        {this.props.action}
      </div>
    );
  }
}
