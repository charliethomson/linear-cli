/**
 * Retry with exponential backoff and full jitter, for Linear's rate limiting.
 *
 * Linear rate-limits by request count and by complexity, and a bulk run at the
 * default concurrency provokes 429s readily. Before this existed a 429 was a
 * hard failure, which for `bulk-create` meant part of a program's backlog was
 * silently reported in `failed[]` while the command still exited 0.
 */

/** Total attempts including the first, and the ceiling on any single wait. */
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_BASE_DELAY_MS = 500;

let _enabled = true;

/** Disabled by `--no-retry`, for callers that would rather fail fast. */
export function setRetryEnabled(enabled: boolean): void {
  _enabled = enabled;
}

export function isRetryEnabled(): boolean {
  return _enabled;
}

/**
 * Base backoff delay. Overridable so the test suite does not spend real
 * seconds sleeping; not intended for normal use.
 */
function baseDelayMs(): number {
  const override = Number(process.env['LINEAR_RETRY_BASE_MS']);
  return Number.isFinite(override) && override >= 0 ? override : DEFAULT_BASE_DELAY_MS;
}

function httpStatus(err: unknown): number | undefined {
  const e = err as any;
  const status = e?.response?.status ?? e?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Whether the operation is a mutation.
 *
 * Retrying a mutation after a 5xx is unsafe: the server may have applied it
 * before failing to respond, so a retried `issueCreate` can produce a duplicate
 * issue. A 429 is different — it is a refusal, so nothing was applied. When the
 * operation cannot be identified it is treated as a mutation, because the
 * dangerous mistake is retrying a write that already landed.
 */
function isMutation(document: unknown): boolean {
  const doc = document as any;
  if (Array.isArray(doc?.definitions)) {
    return doc.definitions.some((d: any) => d?.operation === 'mutation');
  }
  if (typeof doc === 'string') return /^\s*mutation\b/m.test(doc);
  if (typeof doc?.loc?.source?.body === 'string') {
    return /^\s*mutation\b/m.test(doc.loc.source.body);
  }
  return true;
}

export function isRetryable(err: unknown, document?: unknown): boolean {
  const status = httpStatus(err);

  // A refusal: the request was never processed, so retrying is always safe.
  if (status === 429) return true;

  if (status !== undefined && status >= 500 && status < 600) {
    return !isMutation(document);
  }

  // Transport-level faults never reached the server in a form it acted on.
  if (status === undefined) {
    const message = String((err as any)?.message ?? '');
    return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(
      message
    );
  }

  return false;
}

/** Honour Retry-After when the server sends it; it knows better than we do. */
function retryAfterMs(err: unknown): number | undefined {
  const headers = (err as any)?.response?.headers;
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : undefined;
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function nextDelayMs(
  err: unknown,
  attempt: number,
  maxDelayMs: number = DEFAULT_MAX_DELAY_MS
): number {
  const serverAsked = retryAfterMs(err);
  if (serverAsked !== undefined) return Math.min(serverAsked, maxDelayMs);

  // Full jitter: random within the window rather than at its edge, so a batch
  // of concurrent requests does not retry in lockstep and re-trigger the limit.
  const window = Math.min(baseDelayMs() * 2 ** (attempt - 1), maxDelayMs);
  return Math.random() * window;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { document?: unknown; attempts?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const attempts = _enabled ? (opts.attempts ?? DEFAULT_ATTEMPTS) : 1;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isRetryable(err, opts.document)) throw err;
      await sleep(nextDelayMs(err, attempt, maxDelayMs));
    }
  }
  throw lastError;
}
