import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';

/**
 * Serves the studio build.
 *
 * The desktop window loads from here rather than from `file://`, which buys
 * two things worth more than the small cost of running a server: the app is
 * served the same way to the window and to a tablet, so there is only one code
 * path to keep working; and `http://127.0.0.1` counts as a secure context, so
 * service workers and everything else gated behind that keep working — which
 * `file://` does not.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.wisp': 'application/octet-stream',
};

export interface StaticHost {
  server: Server;
  port: number;
  /** Addresses a device on the same network can reach, if bound beyond loopback. */
  addresses: string[];
  close: () => Promise<void>;
}

/** Extra routes the host adds on top of the static files. */
export type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => boolean | Promise<boolean>;

/**
 * Resolves a URL path to a file inside `root`, or null if it escapes.
 *
 * The server is reachable from other devices in host mode, so a request for
 * `../../../etc/passwd` has to be refused rather than served. Normalising and
 * then checking containment is what makes that reliable.
 */
function safePath(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const candidate = resolve(join(root, normalize(decoded)));
  const base = resolve(root);
  if (candidate !== base && !candidate.startsWith(base + sep)) return null;
  return candidate;
}

export async function startStaticHost(options: {
  root: string;
  port: number;
  /** '127.0.0.1' keeps it to this machine; '0.0.0.0' opens it to the network. */
  host: string;
  routes?: RouteHandler[];
}): Promise<StaticHost> {
  const { root, host, routes = [] } = options;

  const server = createServer((request, response) => {
    void (async () => {
      try {
        for (const route of routes) {
          if (await route(request, response)) return;
        }

        const path = safePath(root, request.url ?? '/');
        if (!path) {
          response.writeHead(403).end('Forbidden');
          return;
        }

        let target = path;
        try {
          const info = await stat(target);
          if (info.isDirectory()) target = join(target, 'index.html');
        } catch {
          // A single-page app owns its routing, so anything that is not a real
          // file falls back to the entry document rather than 404ing.
          target = join(root, 'index.html');
        }

        const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
        response.writeHead(200, {
          'content-type': type,
          // The window and the tablets both reload often during a session;
          // revalidating beats serving a stale bundle after an update.
          'cache-control': 'no-cache',
        });
        createReadStream(target).pipe(response);
      } catch (error) {
        console.error('Request failed', error);
        if (!response.headersSent) response.writeHead(500);
        response.end('Something went wrong.');
      }
    })();
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      const address = server.address();
      resolvePort(typeof address === 'object' && address ? address.port : options.port);
    });
  });

  return {
    server,
    port,
    addresses: host === '127.0.0.1' ? [] : lanAddresses(),
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

/**
 * The machine's own addresses on the local network.
 *
 * Filtered to IPv4 and non-internal, because what this is for is showing
 * somebody an address to type — or scan — on a tablet, and `::1` or a docker
 * bridge address helps nobody.
 */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}
