/**
 * The books (ADR-002, D1; the owner's pick of 18 November): the game data,
 * listed in Collections beside the player's collections, with the choice of
 * which books show on this device that Settings calls Content sources. Its
 * address is `/workshop/collection/books` (`BOOKS_PATH`); the collection
 * page hands it over, so it needs no route of its own.
 */
import { ArrowLeft } from 'lucide-react';
import { getActiveTag } from '@/data5e/loader';
import { SourcesSection } from '@/features/settings/SourcesSection';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';

const ICON =
  '-ml-3 tap shrink-0 self-start rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';

export default function BooksPage() {
  usePageTitle('The books', 'Workshop');
  const back = useBack('/workshop?shelf=collections');
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-4">
      <button type="button" aria-label="Back" onClick={back} className={ICON}>
        <ArrowLeft size={20} aria-hidden />
      </button>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-title-page">The books</h1>
        <p className="text-caption text-ink-muted">Game data {getActiveTag()}</p>
      </header>
      <p className="text-body text-ink-muted">
        The books come first: where a collection has an entry with a book&rsquo;s name and source,
        the book&rsquo;s wins. A change you make to a book&rsquo;s entry for your table is kept in
        Changes to the books, under Collections, and takes that entry&rsquo;s place.
      </p>
      <SourcesSection />
    </main>
  );
}
