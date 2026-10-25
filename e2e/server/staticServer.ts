import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import path from 'node:path';
import type { VercelRouting } from './vercelRouting.ts';

/**
 * Rewrites a text file on its way out. `rel` is the path under the served
 * root (`sw.js`, `index.html`). Return null to serve the file unchanged.
 */
export type Transform = (rel: string, body: string, variant: string) => string | null;

export interface ServedRequest {
  /** Request path, query stripped. */
  path: string;
  /** HTTP status sent, or `refused` when the server was down. */
  status: number | 'refused';
  /** Set when the response came from a `vercel.json` rewrite. */
  rewrittenTo?: string;
}

export interface StaticServer {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  readonly url: string;
  /** Everything asked of this server since start or the last {@link resetLog}. */
  readonly requests: readonly ServedRequest[];
  readonly variant: string;
  /** Picks what {@link Transform} sees as `variant`. */
  setVariant(variant: string): void;
  /**
   * The down switch. While down every request has its connection destroyed
   * unanswered, as an unreachable host would, and is logged as `refused`;
   * open keep-alive sockets are destroyed at once.
   */
  setDown(down: boolean): void;
  readonly isDown: boolean;
  resetLog(): void;
  close(): Promise<void>;
}

export interface StartOptions {
  /** Directory to serve (normally `dist/`). */
  root: string;
  routing: VercelRouting;
  /** 0 picks a free port. */
  port?: number;
  transform?: Transform;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg']);

/** Resolves `pathname` to a file under `root` the way Vercel's filesystem check does. */
function findFile(root: string, pathname: string): string | null {
  const resolved = path.resolve(root, `.${pathname}`);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  if (!existsSync(resolved)) return null;
  const stat = statSync(resolved);
  if (stat.isFile()) return resolved;
  if (stat.isDirectory()) {
    const index = path.join(resolved, 'index.html');
    if (existsSync(index) && statSync(index).isFile()) return index;
  }
  return null;
}

/** Long-lived for hashed assets, revalidated for everything else (as Vercel defaults). */
function cacheControl(rel: string): string {
  return rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/**
 * A static server for the built app: files from `root`, response headers and
 * the SPA fallback from `vercel.json`, an analytics stub, a down switch and a
 * transform hook for serving a different build (see `swVariants.ts`).
 */
export function startStaticServer(options: StartOptions): Promise<StaticServer> {
  const root = path.resolve(options.root);
  const { routing, transform } = options;
  let variant = 'v1';
  let down = false;
  let log: ServedRequest[] = [];
  const sockets = new Set<Socket>();
  const transformErrors: string[] = [];

  const send = (
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body: string | Buffer,
  ) => {
    res.writeHead(status, headers);
    res.end(body);
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://e2e.invalid').pathname);
    if (down) {
      log.push({ path: pathname, status: 'refused' });
      req.socket.destroy();
      return;
    }
    const securityHeaders = routing.headersFor(pathname);

    // @vercel/analytics asks for its script here; Vercel serves it, we stub it.
    if (pathname.startsWith('/_vercel/insights/')) {
      log.push({ path: pathname, status: 200 });
      send(
        res,
        200,
        { ...securityHeaders, 'content-type': MIME['.js'] as string, 'cache-control': 'no-cache' },
        '',
      );
      return;
    }

    let file = findFile(root, pathname);
    let rewrittenTo: string | undefined;
    if (file === null) {
      const destination = routing.rewriteFor(pathname);
      if (destination !== null) {
        file = findFile(root, destination);
        rewrittenTo = destination;
      }
    }
    if (file === null) {
      log.push({ path: pathname, status: 404 });
      send(res, 404, { ...securityHeaders, 'content-type': MIME['.txt'] as string }, 'Not found');
      return;
    }

    const rel = path.relative(root, file).split(path.sep).join('/');
    const ext = path.extname(file);
    let body: string | Buffer = readFileSync(file);
    if (transform !== undefined && TEXT_EXTENSIONS.has(ext)) {
      const changed = transform(rel, body.toString('utf8'), variant);
      if (changed !== null) body = changed;
    }
    log.push(
      rewrittenTo === undefined
        ? { path: pathname, status: 200 }
        : { path: pathname, status: 200, rewrittenTo },
    );
    send(
      res,
      200,
      {
        ...securityHeaders,
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': cacheControl(rel),
      },
      body,
    );
  };

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      // A transform that throws (its pattern no longer matches the build) must
      // fail the test, not hang it: answer 500 and keep the error visible.
      const message = err instanceof Error ? err.message : String(err);
      log.push({ path: req.url ?? '?', status: 500 });
      console.error(`[e2e static server] ${message}`);
      if (!res.headersSent) send(res, 500, { 'content-type': MIME['.txt'] as string }, message);
      transformErrors.push(message);
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        get requests() {
          return log;
        },
        get variant() {
          return variant;
        },
        setVariant(next) {
          variant = next;
        },
        get isDown() {
          return down;
        },
        setDown(next) {
          down = next;
          if (down) for (const socket of sockets) socket.destroy();
        },
        resetLog() {
          log = [];
        },
        close() {
          if (transformErrors.length > 0) {
            // Surfaced at teardown too, in case the 500 alone went unnoticed.
            const errors = transformErrors.splice(0);
            server.closeAllConnections();
            return new Promise<void>((done) => server.close(() => done())).then(() => {
              throw new Error(`The static server's transform failed:\n${errors.join('\n')}`);
            });
          }
          server.closeAllConnections();
          return new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
