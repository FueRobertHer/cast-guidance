import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.ts';

/**
 * Opens a WebSocket to a mirror host, which `context.route` never sees (a
 * stand-in for the preconnect `index.html` makes), and returns how it failed.
 * On a page with no CSP, so the policy cannot be what stops it.
 */
async function openUnroutedSocket(page: Page): Promise<string> {
  const messages: string[] = [];
  page.on('console', (msg) => messages.push(msg.text()));
  await page.goto('about:blank');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const socket = new WebSocket('wss://cdn.jsdelivr.net/');
        socket.onclose = () => resolve();
      }),
  );
  return messages.join('\n');
}

const SOCKET_FAILED = /^WebSocket connection to 'wss:\/\/cdn\.jsdelivr\.net\/' failed/;

test.describe('harness', () => {
  // The name never resolves, so the socket reached no host. Through a
  // proxy it fails differently ("Establishing a tunnel via proxy server
  // failed"), and with neither flag it reaches jsDelivr.
  test('a socket below the routing layer never reaches a real host', async ({
    page,
    consoleGuard,
  }) => {
    consoleGuard.allow(SOCKET_FAILED);
    expect(await openUnroutedSocket(page)).toContain('net::ERR_NAME_NOT_RESOLVED');
  });

  test('nor from a persistent profile', async ({ launchProfile, consoleGuard }, testInfo) => {
    consoleGuard.allow(SOCKET_FAILED);
    const context = await launchProfile(testInfo.outputPath('profile'));
    const page = context.pages()[0] ?? (await context.newPage());
    expect(await openUnroutedSocket(page)).toContain('net::ERR_NAME_NOT_RESOLVED');
  });
});
