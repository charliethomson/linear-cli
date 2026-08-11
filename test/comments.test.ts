import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeLinear, sdkIssue } from './helpers/fake-linear.js';
import { runCli } from './helpers/run-cli.js';

/**
 * `issues comments` closes the gap that made the resume workflow impossible:
 * comments could be written but never read back. thmsn-ultron records progress
 * as boundary comments on the issue and a resuming agent has to replay them, so
 * ordering, threading and truncation all carry weight here.
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

function comment(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c1',
    body: 'a comment',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    editedAt: null,
    resolvedAt: null,
    url: 'https://linear.app/x/issue/ENG-1#comment-c1',
    parentId: null,
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', displayName: 'ada' },
    botActor: null,
    ...over,
  };
}

function commentsPage(
  nodes: Record<string, unknown>[],
  pageInfo: { hasNextPage: boolean; endCursor?: string | null } = { hasNextPage: false }
): unknown {
  return {
    issue: {
      id: 'i1',
      identifier: 'ENG-1',
      comments: {
        nodes,
        pageInfo: { hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor ?? null },
      },
    },
  };
}

const commentRequests = () => fake.requestsMatching('IssueComments');

describe('issues comments', () => {
  test('returns the issue, its comments and a truncation flag', async () => {
    fake.reply({ contains: 'IssueComments', data: commentsPage([comment()]) });

    const r = await runCli(['issues', 'comments', 'ENG-1'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.deepEqual(r.json.data.issue, { id: 'i1', identifier: 'ENG-1' });
    assert.equal(r.json.data.hasMore, false);
    assert.equal(r.json.data.comments.length, 1);
  });

  test('each comment carries the documented key set', async () => {
    fake.reply({ contains: 'IssueComments', data: commentsPage([comment()]) });

    const r = await runCli(['issues', 'comments', 'ENG-1'], { apiUrl: fake.url });

    assert.deepEqual(Object.keys(r.json.data.comments[0]).sort(), [
      'body',
      'botActor',
      'createdAt',
      'editedAt',
      'id',
      'parentId',
      'resolvedAt',
      'updatedAt',
      'url',
      'user',
    ]);
  });

  test('accepts a human identifier without a separate resolve round trip', async () => {
    fake.reply({ contains: 'IssueComments', data: commentsPage([]) });

    await runCli(['issues', 'comments', 'ENG-42'], { apiUrl: fake.url });

    assert.equal(fake.requests.length, 1, 'issue(id:) resolves the identifier server-side');
    assert.equal(commentRequests()[0]!.variables['id'], 'ENG-42');
  });

  test('returns comments oldest-first so the history reads as a narrative', async () => {
    // The API orders newest-first; the CLI reverses it.
    fake.reply({
      contains: 'IssueComments',
      data: commentsPage([
        comment({ id: 'c3', body: 'done', createdAt: '2026-01-03T00:00:00.000Z' }),
        comment({ id: 'c2', body: 'blocked', createdAt: '2026-01-02T00:00:00.000Z' }),
        comment({ id: 'c1', body: 'starting', createdAt: '2026-01-01T00:00:00.000Z' }),
      ]),
    });

    const r = await runCli(['issues', 'comments', 'ENG-1'], { apiUrl: fake.url });

    assert.deepEqual(
      r.json.data.comments.map((c: any) => c.body),
      ['starting', 'blocked', 'done']
    );
  });

  test('surfaces the author, and null rather than throwing when there is none', async () => {
    fake.reply({
      contains: 'IssueComments',
      data: commentsPage([
        comment({ id: 'c1' }),
        comment({ id: 'c2', user: null, botActor: { id: 'b1', name: 'GitHub', type: 'app' } }),
      ]),
    });

    const r = await runCli(['issues', 'comments', 'ENG-1'], { apiUrl: fake.url });

    // Indexed by id rather than position, because the command reverses the
    // API's newest-first ordering.
    const byId = Object.fromEntries(r.json.data.comments.map((c: any) => [c.id, c]));
    assert.deepEqual(byId['c1'].user, {
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.com',
      displayName: 'ada',
    });
    assert.equal(byId['c2'].user, null);
    assert.deepEqual(byId['c2'].botActor, { id: 'b1', name: 'GitHub', type: 'app' });
  });

  test('exposes parentId so threaded replies can be reconstructed', async () => {
    fake.reply({
      contains: 'IssueComments',
      data: commentsPage([comment({ id: 'c2', parentId: 'c1' }), comment({ id: 'c1' })]),
    });

    const r = await runCli(['issues', 'comments', 'ENG-1'], { apiUrl: fake.url });

    const byId = Object.fromEntries(r.json.data.comments.map((c: any) => [c.id, c]));
    assert.equal(byId['c1'].parentId, null);
    assert.equal(byId['c2'].parentId, 'c1');
  });

  test('an issue with no comments is an empty array, not an error', async () => {
    fake.reply({ contains: 'IssueComments', data: commentsPage([]) });

    const r = await runCli(['issues', 'comments', 'ENG-1'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.deepEqual(r.json.data.comments, []);
    assert.equal(r.json.data.hasMore, false);
  });

  test('a missing issue is NOT_FOUND', async () => {
    fake.reply({ contains: 'IssueComments', data: { issue: null } });

    const r = await runCli(['issues', 'comments', 'ENG-999'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson.code, 'NOT_FOUND');
    assert.match(r.errorJson.error, /ENG-999/);
  });
});

describe('issues comments pagination', () => {
  test('auto-paginates above the 250 page cap and threads the cursor', async () => {
    const page = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => comment({ id: `${prefix}${i}` }));

    fake.reply({
      contains: 'IssueComments',
      sequence: [
        commentsPage(page(250, 'a'), { hasNextPage: true, endCursor: 'cur-1' }),
        commentsPage(page(50, 'b'), { hasNextPage: false }),
      ],
    });

    const r = await runCli(['issues', 'comments', 'ENG-1', '--limit', '300'], {
      apiUrl: fake.url,
    });

    assert.equal(r.code, 0);
    assert.equal(r.json.data.comments.length, 300);

    const reqs = commentRequests();
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0]!.variables['first'], 250);
    assert.equal(reqs[0]!.variables['after'], null);
    assert.equal(reqs[1]!.variables['first'], 50);
    assert.equal(reqs[1]!.variables['after'], 'cur-1');
  });

  test('reports hasMore when the result was truncated by --limit', async () => {
    fake.reply({
      contains: 'IssueComments',
      data: commentsPage([comment()], { hasNextPage: true, endCursor: 'cur-1' }),
    });

    const r = await runCli(['issues', 'comments', 'ENG-1', '--limit', '1'], { apiUrl: fake.url });

    assert.equal(r.json.data.hasMore, true, 'a truncated history must say so');
  });

  test('stops early when the issue has fewer comments than the limit', async () => {
    fake.reply({ contains: 'IssueComments', data: commentsPage([comment()]) });

    const r = await runCli(['issues', 'comments', 'ENG-1', '--limit', '1000'], {
      apiUrl: fake.url,
    });

    assert.equal(r.json.data.comments.length, 1);
    assert.equal(commentRequests().length, 1);
  });

  test('--limit is validated', async () => {
    for (const bad of ['abc', '0', '-1']) {
      fake.requests.length = 0;
      const r = await runCli(['issues', 'comments', 'ENG-1', '--limit', bad], {
        apiUrl: fake.url,
      });
      assert.equal(r.code, 1, `--limit ${bad} should be rejected`);
      assert.equal(r.errorJson.code, 'INVALID_INPUT');
      assert.equal(fake.requests.length, 0);
    }
  });
});

describe('issues comment / comments are distinct commands', () => {
  test('the singular form still writes, and is unaffected by the new reader', async () => {
    fake.reply({ contains: 'query issue(', data: { issue: sdkIssue() } });
    // Like issueCreate, the payload selects only `comment { id }`, so the SDK
    // re-fetches the comment before the CLI can read its fields.
    fake.reply({
      contains: 'mutation createComment',
      data: { commentCreate: { success: true, lastSyncId: 1, comment: { id: 'c1' } } },
    });
    fake.reply({
      contains: 'query comment(',
      data: {
        comment: {
          id: 'c1',
          body: 'hi',
          bodyData: '{}',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          url: 'https://linear.app/x/issue/ENG-1#comment-c1',
          reactionData: {},
          isArtificialAgentSessionRoot: false,
          // Required: the Comment constructor maps over this unconditionally.
          reactions: [],
        },
      },
    });

    const r = await runCli(['issues', 'comment', 'ENG-1', '--body', 'hi'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.equal(r.json.data.message, 'Comment added');
    assert.equal(r.json.data.id, 'c1');
    assert.equal(fake.requestsMatching('mutation createComment').length, 1);
  });
});

describe('not-found classification', () => {
  test("Linear's GraphQL not-found error maps to NOT_FOUND, not FETCH_FAILED", async () => {
    // The shape the live API actually returns for a bad issue reference —
    // it errors rather than resolving `issue` to null.
    fake.reply({
      contains: 'IssueComments',
      errors: [
        {
          message: 'Entity not found: Issue',
          extensions: {
            type: 'invalid input',
            code: 'INPUT_ERROR',
            userPresentableMessage: 'Could not find referenced Issue.',
          },
        },
      ],
    });

    const r = await runCli(['issues', 'comments', 'THM-999999'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson.code, 'NOT_FOUND');
    assert.match(r.errorJson.error, /THM-999999/);
  });

  test('a transport failure is still FETCH_FAILED, not misreported as not-found', async () => {
    fake.reply({
      contains: 'IssueComments',
      raw: { status: 429, body: JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }) },
    });

    const r = await runCli(['issues', 'comments', 'ENG-1'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson.code, 'FETCH_FAILED');
    assert.doesNotMatch(r.errorJson.error, /not found/i);
  });
});
