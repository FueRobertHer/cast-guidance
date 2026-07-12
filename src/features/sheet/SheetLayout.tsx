import { ArrowLeft, Backpack, Gauge, ScrollText, Sparkles, Swords, Wrench } from 'lucide-react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { DiceTray } from '@/features/dice/DiceTray';
import { AdvToggle } from '@/ui/AdvToggle';
import { HistoryDrawer } from './HistoryDrawer';
import { useCharacterSheet } from './useCharacterSheet';

const tabs = [
  { to: '.', label: 'Play', icon: Swords, end: true },
  { to: 'stats', label: 'Stats', icon: Gauge, end: false },
  { to: 'inventory', label: 'Items', icon: Backpack, end: false },
  { to: 'spells', label: 'Spells', icon: Sparkles, end: false },
  { to: 'features', label: 'More', icon: ScrollText, end: false },
  { to: 'build', label: 'Build', icon: Wrench, end: false },
] as const;

export function Component() {
  const { id } = useParams();
  const state = useCharacterSheet(id);

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
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-zinc-950/90 px-4 py-3 backdrop-blur lg:pl-40">
        <Link
          to="/"
          aria-label="Back to characters"
          className="-my-2 -ml-2 rounded p-2 text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{state.doc?.name ?? '…'}</h1>
          <p className="truncate text-xs text-ink-muted">{state.sheet?.classLabel ?? ''}</p>
        </div>
        {id !== undefined && <HistoryDrawer charId={id} />}
      </header>
      <main className="flex-1 px-4 pt-1 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-4 lg:pl-40">
        <Outlet context={state} />
      </main>
      <nav
        aria-label="Character sheet"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-surface-2 bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-36 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-2 lg:pt-4"
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium lg:flex-none lg:flex-row lg:justify-start lg:gap-2.5 lg:rounded-lg lg:px-3 lg:py-2 lg:text-sm ${
                isActive ? 'text-accent' : 'text-ink-muted hover:text-ink'
              }`
            }
          >
            <Icon size={20} aria-hidden className="lg:size-[17px]" />
            {label}
          </NavLink>
        ))}
      </nav>
      <AdvToggle />
      <DiceTray />
    </div>
  );
}
