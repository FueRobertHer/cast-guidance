import type { BrowserContext } from '@playwright/test';

/** Our own static servers. Everything else must go through a mirror route. */
const LOCAL_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+\//;

/**
 * The fallback route: lets requests to the local servers through and aborts
 * anything else. Registered before the mirror, so the mirror's routes (which
 * Playwright tries first, newest first) answer its hosts and this answers the
 * rest. A test fails at teardown if anything was blocked: no spec may reach
 * the real network.
 */
export class NetworkGuard {
  readonly blocked: string[] = [];

  async attach(context: BrowserContext): Promise<void> {
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (LOCAL_ORIGIN.test(url)) return route.fallback();
      this.blocked.push(url);
      return route.abort('blockedbyclient');
    });
  }

  assertClean(): void {
    if (this.blocked.length > 0) {
      throw new Error(
        `Requests left the harness (add a route or a mirror rule):\n${this.blocked.join('\n')}`,
      );
    }
  }
}

export interface ConsoleEntry {
  kind: 'console' | 'pageerror';
  text: string;
  /** For console messages, `msg.location().url`; for a failed resource, that resource. */
  url: string;
}

/**
 * Collects console errors and uncaught page errors from every page of the
 * contexts it watches, and fails the test at teardown on any it was not told
 * to expect.
 *
 * "Failed to load resource" messages carry the resource only in
 * `msg.location().url`, so they are allowed by URL ({@link allowResource});
 * other messages by text ({@link allow}). A CSP violation is never allowed,
 * which makes every spec a check of the enforced policy too.
 */
export class ConsoleGuard {
  readonly entries: ConsoleEntry[] = [];
  private readonly textRules: RegExp[] = [];
  private readonly resourceRules: Array<(url: string, text: string) => boolean> = [];

  watch(context: BrowserContext): void {
    context.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      this.entries.push({ kind: 'console', text: msg.text(), url: msg.location().url });
    });
    context.on('weberror', (webError) => {
      const err = webError.error();
      this.entries.push({
        kind: 'pageerror',
        text: err.stack ?? err.message,
        url: webError.page()?.url() ?? '',
      });
    });
  }

  /** Expects console errors (and page errors) whose text matches `pattern`. */
  allow(pattern: RegExp): void {
    this.textRules.push(pattern);
  }

  /** Expects "Failed to load resource" for the URLs (and error text) `match` accepts. */
  allowResource(match: (url: string, text: string) => boolean): void {
    this.resourceRules.push(match);
  }

  unexpected(): ConsoleEntry[] {
    return this.entries.filter((entry) => {
      if (/Refused to|Content Security Policy/.test(entry.text)) return true;
      if (
        entry.kind === 'console' &&
        entry.text.startsWith('Failed to load resource') &&
        this.resourceRules.some((match) => match(entry.url, entry.text))
      ) {
        return false;
      }
      return !this.textRules.some((pattern) => pattern.test(entry.text));
    });
  }

  assertClean(): void {
    const bad = this.unexpected();
    if (bad.length > 0) {
      const lines = bad.map((e) => `[${e.kind}] ${e.text}${e.url === '' ? '' : ` (${e.url})`}`);
      throw new Error(`Unexpected console errors:\n${lines.join('\n')}`);
    }
  }
}
