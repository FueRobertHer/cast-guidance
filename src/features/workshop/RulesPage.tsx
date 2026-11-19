/**
 * The table's rules, at `/workshop/rules` (ADR-002, D1): for now the ways to
 * where they are set, Settings for the table rules and the Homebrew page for
 * rule packs. U9 moves both here (board 10, B), so the Rules shelf's rows
 * never lead nowhere meanwhile.
 */
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';
import { buttonClass } from '@/ui/Button';

const NOTE = 'text-body text-ink-muted';
const ICON =
  '-ml-3 tap shrink-0 self-start rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';

export function Component() {
  usePageTitle('Rules', 'Workshop');
  const back = useBack('/workshop?shelf=rules');
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-4">
      <button type="button" aria-label="Back" onClick={back} className={ICON}>
        <ArrowLeft size={20} aria-hidden />
      </button>
      <h1 className="font-display text-title-page">Rules</h1>
      <section aria-labelledby="rules-table" className="flex flex-col gap-2">
        <h2 id="rules-table" className="text-body-strong">
          Table rules
        </h2>
        <p className={NOTE}>
          Critical hits, rest length, HP and the rest are set for every character under House rules
          in Settings. A character can set its own on its Build page.
        </p>
        <Link to="/settings" className={`self-start ${buttonClass({ variant: 'outline' })}`}>
          Open Settings
        </Link>
      </section>
      <section aria-labelledby="rules-packs" className="flex flex-col gap-2">
        <h2 id="rules-packs" className="text-body-strong">
          Rule packs
        </h2>
        <p className={NOTE}>
          Turn rule packs on, put them in order and choose who they apply to on the Homebrew page.
        </p>
        <Link to="/homebrew" className={`self-start ${buttonClass({ variant: 'outline' })}`}>
          Open the Homebrew page
        </Link>
      </section>
    </main>
  );
}
