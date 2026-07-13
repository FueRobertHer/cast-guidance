import { ArrowLeft, Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { DiceTray } from '@/features/dice/DiceTray';
import { AdvToggle } from '@/ui/AdvToggle';
import { HistoryDrawer } from './HistoryDrawer';
import { useCharacterSheet } from './useCharacterSheet';

const tabs = [
  { to: '.', label: 'Play', end: true },
  { to: 'stats', label: 'Stats' },
  { to: 'inventory', label: 'Items' },
  { to: 'spells', label: 'Spells' },
  { to: 'features', label: 'More' },
  { to: 'build', label: 'Build' },
] as const;

export function Component() {
  const { id } = useParams();
  const state = useCharacterSheet(id);

  if (state.loadStatus === 'loading' || state.loadStatus === 'idle') {
    return (
      <main className="flex flex-1 items-center gap-2 p-4 text-sm text-ink-muted" role="status">
        <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
        Loading character…
      </main>
    );
  }

  if (state.loadStatus === 'error') {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4" role="alert">
        <p className="text-sm text-accent">Could not load this character: {state.error}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={state.retryLoad}
            className="text-sm font-semibold text-accent"
          >
            Retry
          </button>
          <Link to="/" className="text-sm text-ink-muted">
            Back to characters
          </Link>
        </div>
      </main>
    );
  }

  if (state.missing) {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-sm text-ink-muted">Character not found.</p>
        <Link to="/" className="text-sm text-accent">
          Back to characters
        </Link>
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 px-4 pt-4 lg:pl-40">
        <Link to="/" className="text-ink-muted hover:text-ink">
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{state.doc?.name ?? '…'}</h1>
          <p className="truncate text-xs text-ink-muted">{state.sheet?.classLabel ?? ''}</p>
        </div>
        <span
          className="flex items-center gap-1 text-xs text-ink-muted"
          role="status"
          aria-live="polite"
        >
          {state.saveStatus === 'pending' && 'Unsaved'}
          {state.saveStatus === 'saving' && (
            <>
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> Saving
            </>
          )}
          {state.saveStatus === 'saved' && (
            <>
              <Check size={13} aria-hidden="true" /> Saved
            </>
          )}
          {state.saveStatus === 'error' && (
            <>
              <CircleAlert size={13} aria-hidden="true" /> Save failed
            </>
          )}
        </span>
        {id !== undefined && <HistoryDrawer charId={id} />}
      </header>
      <main className="flex-1 p-4 pb-24 lg:pb-4 lg:pl-40">
        <Outlet context={state} />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-surface-2 bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-36 lg:flex-col lg:border-t-0 lg:border-r lg:pt-4">
        {tabs.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={'end' in tab && tab.end}
            className={({ isActive }) =>
              `flex-1 px-2 py-3 text-center text-xs font-medium lg:flex-none lg:text-left lg:text-sm ${
                isActive ? 'text-accent' : 'text-ink-muted'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <AdvToggle />
      <DiceTray />
    </div>
  );
}
