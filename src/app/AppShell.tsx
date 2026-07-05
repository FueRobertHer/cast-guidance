import { Outlet } from 'react-router';

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
      {/* Data download progress banner mounts here (M1) */}
      <Outlet />
    </div>
  );
}
