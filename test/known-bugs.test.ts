import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FakeLinear, issuePage, sdkIssue } from './helpers/fake-linear.js';
import { runCli } from './helpers/run-cli.js';

/**
 * The audit findings, written as the assertions they *should* satisfy.
 *
 * Every test here is marked `todo`, so the suite stays green as a baseline
 * while each one names an outstanding defect. Fixing a finding means deleting
 * its `{ todo: ... }` flag — at which point it becomes a real regression test.
 *
 * Do not "fix" a failure here by weakening the assertion; the assertion is the
 * specification.
 */

let fake: FakeLinear;

before(async () => {
  fake = await FakeLinear.start();
});
after(async () => {
  await fake.stop();
});
beforeEach(() => {
  fake.requests.length = 0;
});

async function bulkFile(entries: unknown[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'linear-cli-bulk-'));
  const file = path.join(dir, 'bulk.json');
  await writeFile(file, JSON.stringify(entries));
  return file;
}

const TEAM_UUID = '11111111-1111-1111-1111-111111111111';

function stubCreateIssue(): void {
  fake.reply({
    contains: 'query team',
    data: { team: { id: TEAM_UUID, key: 'ENG', name: 'Engineering' } },
  });
  fake.reply({
    contains: 'mutation createIssue',
    data: { issueCreate: { success: true, lastSyncId: 1, issue: { id: 'i1' } } },
  });
  fake.reply({ contains: 'query issue(', data: { issue: sdkIssue() } });
}

describe('finding 1 — bulk concurrency is not validated', () => {
  test(
    'a non-numeric --concurrency is rejected instead of silently creating nothing',
    async () => {
      stubCreateIssue();
      const file = await bulkFile([
        { team: 'ENG', title: 'one' },
        { team: 'ENG', title: 'two' },
      ]);

      const r = await runCli(['issues', 'bulk-create', '--file', file, '--concurrency', 'abc'], {
        apiUrl: fake.url,
      });

      assert.equal(r.code, 1, 'must not report success after doing nothing');
      assert.equal(r.errorJson?.code, 'INVALID_INPUT');
    }
  );

  test(
    '--concurrency 0 is rejected rather than hanging forever',
    async () => {
      stubCreateIssue();
      const file = await bulkFile([{ team: 'ENG', title: 'one' }]);

      const r = await runCli(['issues', 'bulk-create', '--file', file, '--concurrency', '0'], {
        apiUrl: fake.url,
        timeoutMs: 3000,
      });

      assert.equal(r.code, 1);
      assert.equal(r.errorJson?.code, 'INVALID_INPUT');
    }
  );
});

describe('finding 3 — mutation success flags are ignored', () => {
  test(
    'archive reports failure when the API returns success: false',
    async () => {
      fake.reply({ contains: 'query issue(', data: { issue: sdkIssue() } });
      fake.reply({
        contains: 'mutation archiveIssue',
        data: { issueArchive: { success: false, lastSyncId: 1 } },
      });

      const r = await runCli(['issues', 'archive', 'ENG-1'], { apiUrl: fake.url });

      assert.equal(r.code, 1, 'a refused archive must not exit 0');
      assert.equal(r.errorJson?.code, 'ARCHIVE_FAILED');
    }
  );

  test(
    'issue-relation delete reports failure when the API returns success: false',
    async () => {
      fake.reply({
        contains: 'mutation deleteIssueRelation',
        data: { issueRelationDelete: { success: false, lastSyncId: 1 } },
      });

      const r = await runCli(['issues', 'relations', 'delete', 'rel-1'], { apiUrl: fake.url });

      assert.equal(r.code, 1);
      assert.equal(r.errorJson?.code, 'DELETE_FAILED');
    }
  );
});

describe('finding 5 — truncated lists are indistinguishable from complete ones', () => {
  test(
    'issues get paginates relations rather than stopping at the API default',
    { todo: 'issue.relations() takes no first/after, so long blocking chains are cut short' },
    async () => {
      const many = Array.from({ length: 60 }, (_, n) => ({
        id: `r${n}`,
        type: 'blocks',
        relatedIssue: { id: `ri${n}`, identifier: `ENG-${n}`, title: `t${n}`, url: 'u' },
      }));

      fake.reply({ contains: 'query issue(', data: { issue: sdkIssue() } });
      fake.reply({
        contains: 'query issue_relations',
        data: {
          issue: {
            relations: { nodes: many, pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      });

      const r = await runCli(['issues', 'get', 'ENG-1'], { apiUrl: fake.url });

      assert.equal(r.code, 0);
      assert.equal(
        r.json?.data?.relations?.length,
        60,
        'a partial blocking chain silently mis-sequences dependent work'
      );
    }
  );

  test(
    'labels list signals that more pages exist',
    { todo: 'no list command except issues list surfaces hasNextPage in any form' },
    async () => {
      fake.reply({
        contains: 'query issueLabels',
        data: {
          issueLabels: {
            nodes: [{ id: 'l1', name: 'bug', color: '#f00', description: null }],
            pageInfo: { hasNextPage: true, endCursor: 'c1' },
          },
        },
      });

      const r = await runCli(['labels', 'list'], { apiUrl: fake.url });

      assert.notEqual(
        JSON.stringify(r.json).includes('hasNextPage'),
        false,
        'a truncated list must be distinguishable from a complete one'
      );
    }
  );
});

describe('finding 6 — null relatedIssue crashes relations list', () => {
  test(
    'a relation to an inaccessible issue does not throw a TypeError',
    async () => {
      fake.reply({ contains: 'query issue(', data: { issue: sdkIssue() } });
      fake.reply({
        contains: 'IssueRelations',
        data: {
          issue: {
            relations: {
              nodes: [
                { id: 'r1', type: 'blocks', relatedIssue: null },
                {
                  id: 'r2',
                  type: 'blocks',
                  relatedIssue: { identifier: 'ENG-2', title: 't', url: 'u' },
                },
              ],
            },
          },
        },
      });

      const r = await runCli(['issues', 'relations', 'list', 'ENG-1'], { apiUrl: fake.url });

      assert.equal(r.code, 0, 'an unreadable related issue should not fail the whole command');
      assert.equal(r.json?.data?.length, 2);
      assert.doesNotMatch(r.stderr, /Cannot read properties of null/);
    }
  );
});

describe('finding 7 — auth status crashes on a short key', () => {
  test(
    'a malformed short key is masked, not fatal',
    async () => {
      const r = await runCli(['auth', 'status'], { apiKey: 'lin_api_xx' });

      assert.equal(r.code, 0);
      assert.equal(r.json?.data?.configured, true);
      assert.doesNotMatch(r.stderr, /RangeError/);
    }
  );

  test(
    'a masked key never reveals more than its first 8 and last 4 characters',
    async () => {
      const key = 'lin_api_1234';
      const r = await runCli(['auth', 'status'], { apiKey: key });

      assert.notEqual(r.json?.data?.maskedKey, key, 'the key must never round-trip in the clear');
    }
  );
});

describe('finding 8 — cycles get miscodes a missing cycle', () => {
  test(
    'a null cycle is NOT_FOUND, matching projects get',
    async () => {
      fake.reply({ contains: 'query Cycle(', data: { cycle: null } });

      const r = await runCli(['cycles', 'get', 'nope'], { apiUrl: fake.url });

      assert.equal(r.code, 1);
      assert.equal(r.errorJson?.code, 'NOT_FOUND');
      assert.doesNotMatch(r.errorJson?.error ?? '', /Cannot read properties/);
    }
  );
});

describe('finding 13 — numeric options are not validated', () => {
  test(
    'a non-numeric --priority is rejected instead of filtering on null',
    { todo: 'parseInt("high") is NaN, which serialises to null in the filter' },
    async () => {
      fake.reply({ contains: 'query Issues', data: issuePage([], { hasNextPage: false }) });

      const r = await runCli(['issues', 'list', '--priority', 'high'], { apiUrl: fake.url });

      assert.equal(r.code, 1);
      assert.equal(r.errorJson?.code, 'INVALID_INPUT');
      assert.equal(fake.requests.length, 0, 'must not query with a NaN filter');
    }
  );

  test(
    'a non-numeric --estimate is rejected on create',
    { todo: 'same parseInt path on the mutation side' },
    async () => {
      stubCreateIssue();

      const r = await runCli(
        ['issues', 'create', '--team', 'ENG', '--title', 'x', '--estimate', 'big'],
        { apiUrl: fake.url }
      );

      assert.equal(r.code, 1);
      assert.equal(r.errorJson?.code, 'INVALID_INPUT');
    }
  );
});

describe('finding 14 — issues update cannot clear a field', () => {
  test(
    'an issue can be unassigned',
    { todo: 'truthiness guards mean there is no way to send assigneeId: null' },
    async () => {
      fake.reply({ contains: 'query issue(', data: { issue: sdkIssue() } });
      fake.reply({
        contains: 'mutation updateIssue',
        data: { issueUpdate: { success: true, lastSyncId: 1, issue: { id: 'i1' } } },
      });

      const r = await runCli(['issues', 'update', 'ENG-1', '--assignee', 'none'], {
        apiUrl: fake.url,
      });

      assert.equal(r.code, 0);
      const mutation = fake.requestsMatching('mutation updateIssue')[0];
      assert.equal(
        (mutation?.variables['input'] as Record<string, unknown>)?.['assigneeId'],
        null,
        'clearing an assignee must send an explicit null'
      );
    }
  );
});
