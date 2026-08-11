import { outputError } from './output.js';

/** Linear caps `first` at 250 per page. */
export const PAGE_MAX = 250;

export interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

/**
 * Drain a Linear connection up to `limit`, following cursors.
 *
 * Most list commands used to issue a single unpaginated request and return
 * whatever the API's default page size gave them. A truncated list was
 * byte-identical in shape to a complete one, so a caller had no way to know it
 * was looking at part of the answer — the failure mode being a workspace with
 * more than ~50 labels or users quietly losing the rest.
 *
 * Fetching the pages is preferred over merely reporting truncation, because the
 * existing commands return a bare JSON array and adding a flag beside it would
 * mean wrapping the array in an object — a breaking change for anything already
 * parsing this output.
 */
export async function fetchAll<T>(
  fetchPage: (vars: { first: number; after: string | null }) => Promise<Page<T>>,
  limit: number
): Promise<T[]> {
  const collected: T[] = [];
  let after: string | null = null;

  while (collected.length < limit) {
    const page = await fetchPage({
      first: Math.min(PAGE_MAX, limit - collected.length),
      after,
    });
    collected.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor ?? null;
  }

  return collected;
}

/** Parse and validate a `--limit` style option, failing loudly on nonsense. */
export function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    outputError('--limit must be a positive integer', 'INVALID_INPUT');
  }
  return parsed;
}

/**
 * Parse and validate an integer option.
 *
 * Uses Number rather than parseInt: parseInt('3abc') is 3 and parseInt('high')
 * is NaN, and a NaN reaching a filter serialises to null, which silently
 * changes what the query matches instead of failing.
 */
export function parseIntOption(
  value: string,
  flag: string,
  bounds: { min?: number; max?: number } = {}
): number {
  const parsed = Number(value);
  const { min, max } = bounds;
  const inRange =
    Number.isInteger(parsed) &&
    (min === undefined || parsed >= min) &&
    (max === undefined || parsed <= max);

  if (!inRange) {
    const range =
      min !== undefined && max !== undefined
        ? ` between ${min} and ${max}`
        : min !== undefined
        ? ` of at least ${min}`
        : '';
    outputError(`${flag} must be an integer${range}`, 'INVALID_INPUT');
  }
  return parsed;
}

/**
 * The literal a caller passes to clear a field, e.g. `--assignee none`.
 * Without it there is no way to express "unassign" — an omitted flag means
 * "leave unchanged", so the two cases are otherwise indistinguishable.
 */
export const CLEAR_SENTINEL = 'none';

export function isClear(value: string): boolean {
  return value.toLowerCase() === CLEAR_SENTINEL;
}
