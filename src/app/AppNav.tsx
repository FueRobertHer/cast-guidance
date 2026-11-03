import { FlaskConical, LibraryBig, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';

const items = [
  { to: '/', label: 'Characters', icon: Users, end: true },
  { to: '/library', label: 'Library', icon: LibraryBig, end: false },
  { to: '/homebrew', label: 'Homebrew', icon: FlaskConical, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

/**
 * The pill behind a tab's icon, filled `surface-raised` for the current tab
 * (DS-001). With the label's bold weight it marks the open tab by more than
 * colour alone (A11Y-002). Decorative: NavLink reports the page through
 * `aria-current`. On the side rail the whole row takes the fill instead.
 * The sheet's tab bar draws the same one. Sharing a module between the two
 * pulled the data registry chunk into the entry bundle (+140 KB), so each
 * keeps its own copy.
 */
function TabPill({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      {...(active ? { 'data-indicator': '' } : {})}
      className={`flex h-7.5 w-14 items-center justify-center rounded-full transition-colors duration-200 ease-out lg:size-auto lg:bg-transparent ${active ? 'bg-surface-raised' : ''}`}
    >
      {children}
    </span>
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
      {/* Clears the tab bar: `tabbar` and its hairline, plus the inset. */}
      <div className="flex flex-1 flex-col pb-[calc(4rem+1px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-40">
        <Outlet />
      </div>
      {/* Content-box as a bar, so the inset adds to its 64px; border-box as
          the rail, whose 9rem is then its whole width, inside the content's 10rem. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 box-content flex h-tabbar border-line border-t bg-surface px-1 pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:box-border lg:right-auto lg:h-auto lg:w-36 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-2 lg:pt-4 lg:pb-0"
      >
        <span className="hidden px-3 pb-3 font-display text-title-card lg:block">
          Cast Guidance
        </span>
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.75 pt-1.5 text-tab lg:min-h-tap lg:flex-none lg:flex-row lg:gap-2.5 lg:rounded-control lg:px-3 lg:text-label ${
                isActive
                  ? 'font-bold text-ink lg:bg-surface-raised'
                  : 'text-ink-muted hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* The current tab is marked by weight and a pill, not by
                    colour alone (A11Y-002); NavLink sets aria-current. */}
                <TabPill active={isActive}>
                  <Icon size={20} aria-hidden className="lg:size-4.5" />
                </TabPill>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
