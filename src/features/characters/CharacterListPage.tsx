import { Link } from 'react-router';

// react-router lazy route module convention: export `Component`
export function Component() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Characters</h1>
        <nav className="flex gap-3 text-sm text-ink-muted">
          <Link to="/library" className="hover:text-ink">
            Library
          </Link>
          <Link to="/homebrew" className="hover:text-ink">
            Homebrew
          </Link>
          <Link to="/settings" className="hover:text-ink">
            Settings
          </Link>
        </nav>
      </header>
      <p className="text-sm text-ink-muted">No characters yet.</p>
      <Link
        to="/create"
        className="rounded-lg bg-accent px-4 py-3 text-center font-semibold text-white"
      >
        New character
      </Link>
    </main>
  );
}
