import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { LinearClient } from '@linear/sdk';
import type * as ResolveModule from '../src/resolve.js';

/**
 * src/ sits under the root package scope, which deliberately has no
 * `"type": "module"` (the shipped bundle is CJS). tsx therefore transpiles
 * src/resolve.ts to CommonJS, and an ESM `import { isUuid }` cannot bind to it.
 * Going through createRequire is the honest way across that boundary; the type
 * import above keeps the call sites fully typed.
 */
const require = createRequire(import.meta.url);
const { isUuid, resolveIssueId, resolveTeamId } = require('../src/resolve.ts') as typeof ResolveModule;

/**
 * Pure unit tests — resolve.ts takes the client as a parameter, so a duck-typed
 * fake is enough and no network or SDK object is involved.
 *
 * The knowledge these helpers encode is load-bearing: IssueFilter has no
 * `identifier` field, and mutations reject a non-UUID teamId, so both refs must
 * be resolved through the singular `issue(id:)` / `team(id:)` queries.
 */

function fakeClient(over: Partial<Record<'issue' | 'team', (ref: string) => Promise<unknown>>>) {
  return {
    issue: over.issue ?? (async () => ({ id: 'unused' })),
    team: over.team ?? (async () => ({ id: 'unused' })),
  } as unknown as LinearClient;
}

const UUID = '11111111-2222-3333-4444-555555555555';

describe('isUuid', () => {
  test('accepts a canonical v4 UUID in either case', () => {
    assert.equal(isUuid(UUID), true);
    assert.equal(isUuid(UUID.toUpperCase()), true);
  });

  test('rejects issue identifiers, team keys and near-misses', () => {
    for (const bad of ['ENG-123', 'ENG', '', 'not-a-uuid', UUID.slice(0, -1), `${UUID}-extra`]) {
      assert.equal(isUuid(bad), false, `${bad} should not be a UUID`);
    }
  });
});

describe('resolveIssueId', () => {
  test('passes a UUID straight through without calling the API', async () => {
    let called = false;
    const client = fakeClient({
      issue: async () => {
        called = true;
        return { id: 'other' };
      },
    });

    assert.equal(await resolveIssueId(client, UUID), UUID);
    assert.equal(called, false, 'a UUID needs no lookup');
  });

  test('resolves a human identifier through issue(id:)', async () => {
    const seen: string[] = [];
    const client = fakeClient({
      issue: async (ref) => {
        seen.push(ref);
        return { id: 'resolved-uuid' };
      },
    });

    assert.equal(await resolveIssueId(client, 'ENG-123'), 'resolved-uuid');
    assert.deepEqual(seen, ['ENG-123'], 'the identifier is sent verbatim; the API is case-insensitive');
  });

  test('throws a message naming the reference when lookup fails', async () => {
    const client = fakeClient({
      issue: async () => {
        throw new Error('Entity not found');
      },
    });

    await assert.rejects(() => resolveIssueId(client, 'ENG-404'), /Issue 'ENG-404' not found/);
  });
});

describe('resolveTeamId', () => {
  test('passes a UUID straight through', async () => {
    const client = fakeClient({
      team: async () => {
        throw new Error('should not be called');
      },
    });

    assert.equal(await resolveTeamId(client, UUID), UUID);
  });

  test('resolves a team key to its UUID', async () => {
    const client = fakeClient({ team: async () => ({ id: 'team-uuid-a' }) });

    assert.equal(await resolveTeamId(client, 'AAA'), 'team-uuid-a');
  });

  test('caches a resolved key so a bulk run does not re-query per entry', async () => {
    let calls = 0;
    const client = fakeClient({
      team: async () => {
        calls++;
        return { id: 'team-uuid-b' };
      },
    });

    await resolveTeamId(client, 'BBB');
    await resolveTeamId(client, 'BBB');
    await resolveTeamId(client, 'BBB');

    assert.equal(calls, 1, 'the key should be resolved once and cached');
  });

  test('throws a message naming the key when lookup fails', async () => {
    const client = fakeClient({
      team: async () => {
        throw new Error('Entity not found');
      },
    });

    await assert.rejects(() => resolveTeamId(client, 'ZZZ'), /Team 'ZZZ' not found/);
  });

  test('does not cache a failed lookup', async () => {
    let calls = 0;
    const client = fakeClient({
      team: async () => {
        calls++;
        if (calls === 1) throw new Error('transient');
        return { id: 'team-uuid-c' };
      },
    });

    await assert.rejects(() => resolveTeamId(client, 'CCC'));
    assert.equal(await resolveTeamId(client, 'CCC'), 'team-uuid-c');
    assert.equal(calls, 2);
  });
});
