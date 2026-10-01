/**
 * Thin fetch wrapper for the FuelOps backend API.
 *
 * - Server components and server actions call `apiServer(path, opts)` which
 *   reads `process.env.BACKEND_URL` directly.
 * - Client components call `apiClient(path, opts)` which uses the rewrite
 *   proxy (`/api/*` → `${BACKEND_URL}/api/*`) so the browser never needs to
 *   know the backend URL. If you need to bypass the rewrite (rare), call
 *   `apiServer` from a server action instead.
 * - `withToken: true` adds the `X-Operator-Token` header from
 *   `NEXT_PUBLIC_OPERATOR_TOKEN` (client-safe env).
 */

const SERVER_BASE = () => process.env.BACKEND_URL ?? '';

export type ApiOpts = RequestInit & {
  /** When true, attach X-Operator-Token. Use for /api/admin/demo/*. */
  withToken?: boolean;
  /** Optional AbortSignal forwarded to fetch. */
  signal?: AbortSignal;
};

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function operatorToken(): string | undefined {
  return process.env.NEXT_PUBLIC_OPERATOR_TOKEN;
}

function buildUrl(path: string, base: string): string {
  // path must start with `/`. base may be empty (use relative — goes through
  // the Next.js rewrite proxy in next.config.js).
  if (!path.startsWith('/')) path = '/' + path;
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

async function exec<T>(url: string, opts: ApiOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has('content-type') && opts.body && typeof opts.body === 'string') {
    headers.set('content-type', 'application/json');
  }
  if (opts.withToken) {
    const tok = operatorToken();
    if (tok) headers.set('X-Operator-Token', tok);
  }
  const res = await fetch(url, {
    ...opts,
    headers,
    // Server components in Next 14 need explicit caching decisions. Default
    // to no-store so we always see fresh data during the demo.
    cache: 'no-store',
    signal: opts.signal,
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, body, `API ${res.status} ${res.statusText} on ${url}`);
  }
  return body as T;
}

/** Server-side fetch. Prepends BACKEND_URL. Reads X-Operator-Token from env. */
export function apiServer<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  return exec<T>(buildUrl(path, SERVER_BASE()), opts);
}

/** Client-side fetch. Uses the /api/* rewrite proxy (no absolute URL exposed). */
export function apiClient<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  return exec<T>(buildUrl(path, ''), opts);
}