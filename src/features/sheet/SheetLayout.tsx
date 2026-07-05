import { NavLink, Outlet, useParams } from 'react-router';

const tabs = [
  { to: '.', label: 'Play', end: true },
  { to: 'stats', label: 'Stats' },
  { to: 'inventory', label: 'Items' },
  { to: 'spells', label: 'Spells' },
  { to: 'features', label: 'More' },
] as const;

export function Component() {
  const { id } = useParams();
  return (
    <div className="flex flex-1 flex-col">
      <main className="flex-1 p-4 pb-20 lg:pb-4 lg:pl-40">
        <Outlet context={{ characterId: id }} />
      </main>
      {/* Bottom tab bar on mobile, left rail on desktop */}
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
    </div>
  );
}
