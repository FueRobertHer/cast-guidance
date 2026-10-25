import { FlaskConical, LibraryBig, Settings, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

const items = [
  { to: '/', label: 'Characters', icon: Users, end: true },
  { to: '/library', label: 'Library', icon: LibraryBig, end: false },
  { to: '/homebrew', label: 'Homebrew', icon: FlaskConical, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

/**
 * Marks the current tab with a bar along its top edge (bottom bar) or its left
 * edge (side rail), so the open tab is not told apart by colour alone
 * (A11Y-002). Decorative: NavLink reports the page through `aria-current`.
 * The sheet's tab bar draws the same one. Sharing a module between the two
 * pulled the data registry chunk into the entry bundle (+140 KB), so each
 * keeps its own copy.
 */
function ActiveTabBar() {
  return (
    <span
      aria-hidden="true"
      data-indicator=""
      className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent lg:inset-x-auto lg:inset-y-2 lg:left-0 lg:h-auto lg:w-0.5"
    />
  );
}

/**
 * Layout route for the top-level sections: persistent tab bar at the bottom
 * on mobile, a left rail on desktop (mirrors the sheet's nav placement).
 * Focused flows (creator, sheet, homebrew editor) stay outside this layout.
 */
export function AppNavLayout() {
  return (
    <>
      <div className="flex flex-1 flex-col pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-40">
        <Outlet />
      </div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-surface-2 bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-36 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-2 lg:pt-4"
      >
        <span className="hidden px-3 pb-3 text-sm font-bold lg:block">Cast Guidance</span>
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[11px] lg:flex-none lg:flex-row lg:justify-start lg:gap-2.5 lg:rounded-lg lg:px-3 lg:py-2 lg:text-sm ${
                isActive ? 'font-semibold text-accent' : 'font-medium text-ink-muted hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* The current tab is marked by weight and a bar, not by
                    colour alone (A11Y-002); NavLink sets aria-current. */}
                {isActive && <ActiveTabBar />}
                <Icon size={20} aria-hidden className="lg:size-[17px]" />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
