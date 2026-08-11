import type { LinearClient } from '@linear/sdk';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Resolve an issue reference to a UUID.
 *
 * Accepts either a UUID or a human identifier (ENG-123, case-insensitive).
 * Linear's `issue(id:)` query resolves both forms server-side, so a single
 * lookup covers either. Note there is no `identifier` field on `IssueFilter` —
 * filtering by it fails with a GraphQL validation error.
 */
export async function resolveIssueId(client: LinearClient, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  try {
    const issue = await client.issue(ref);
    return issue.id;
  } catch {
    throw new Error(`Issue '${ref}' not found`);
  }
}

const teamIdCache = new Map<string, string>();

/**
 * Resolve a team reference to a UUID.
 *
 * Accepts either a UUID or a team key (ENG, case-insensitive). Mutations such
 * as `issueCreate` reject anything that is not a UUID (`teamId must be a UUID`),
 * so keys have to be resolved before they are sent.
 */
export async function resolveTeamId(client: LinearClient, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const cached = teamIdCache.get(ref);
  if (cached) return cached;
  try {
    const team = await client.team(ref);
    teamIdCache.set(ref, team.id);
    return team.id;
  } catch {
    throw new Error(`Team '${ref}' not found`);
  }
}
