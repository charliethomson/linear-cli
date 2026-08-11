import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FakeLinear, issuePage, sdkIssue } from './helpers/fake-linear.js';
import { runCli } from './helpers/run-cli.js';

/**
 * The JSON contract is the product. Two Claude Code skills (thmsn-jarvis,
 * thmsn-ultron) parse this output, so every shape asserted here is a public
 * interface — a change that breaks one of these tests is a breaking change to
 * those skills and must be called out, not absorbed.
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

describe('success envelope', () => {
  test('reads wrap their payload in {"data": ...} on stdout, exit 0', async () => {
    fake.reply({
      contains: 'query viewer',
      data: {
        viewer: {
          id: 'u1',
          name: 'Ada',
          email: 'ada@example.com',
          displayName: 'ada',
          active: true,
          admin: false,
          avatarUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    const r = await runCli(['me'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
    assert.deepEqual(r.json, {
      data: {
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.com',
        displayName: 'ada',
        active: true,
        admin: false,
        avatarUrl: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  test('list commands return a JSON array under "data"', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([{}, {}], { hasNextPage: false }) });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.ok(Array.isArray(r.json.data));
    assert.equal(r.json.data.length, 2);
  });

  test('each issue in a list carries exactly the documented key set', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([{}], { hasNextPage: false }) });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    // Documented in ai/skills/linear.md; consumers index these directly.
    assert.deepEqual(Object.keys(r.json.data[0]).sort(), [
      'archivedAt',
      'assignee',
      'branchName',
      'createdAt',
      'dueDate',
      'estimate',
      'id',
      'identifier',
      'labels',
      'priority',
      'priorityLabel',
      'project',
      'state',
      'title',
      'trashed',
      'updatedAt',
      'url',
    ]);
  });

  test('nested state/assignee/project keep their {id,name,...} shape', async () => {
    fake.reply({
      contains: 'query Issues',
      data: issuePage(
        [
          {
            state: { id: 's9', name: 'In Progress', type: 'started' },
            assignee: { id: 'u9', name: 'Ada', email: 'ada@example.com' },
            project: { id: 'p9', name: 'Platform' },
            labels: { nodes: [{ id: 'l1', name: 'bug' }] },
          },
        ],
        { hasNextPage: false }
      ),
    });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });
    const issue = r.json.data[0];

    assert.deepEqual(issue.state, { id: 's9', name: 'In Progress', type: 'started' });
    assert.deepEqual(issue.assignee, { id: 'u9', name: 'Ada', email: 'ada@example.com' });
    assert.deepEqual(issue.project, { id: 'p9', name: 'Platform' });
    assert.deepEqual(issue.labels, [{ id: 'l1', name: 'bug' }]);
  });

  test('mutations merge their message into the data object, not beside it', async () => {
    fake.reply({
      contains: 'query team',
      data: { team: { id: '11111111-1111-1111-1111-111111111111', key: 'ENG', name: 'Eng' } },
    });
    // The payload selects only `issue { id }`, so the SDK re-fetches the issue;
    // the printed fields come from that follow-up query, not the mutation.
    fake.reply({
      contains: 'mutation createIssue',
      data: { issueCreate: { success: true, lastSyncId: 1, issue: { id: 'i1' } } },
    });
    fake.reply({
      contains: 'query issue(',
      data: {
        issue: sdkIssue({
          id: 'i1',
          identifier: 'ENG-1',
          title: 'New thing',
          url: 'https://linear.app/x/issue/ENG-1',
        }),
      },
    });

    const r = await runCli(
      ['issues', 'create', '--team', 'ENG', '--title', 'New thing'],
      { apiUrl: fake.url }
    );

    assert.equal(r.code, 0);
    assert.deepEqual(r.json, {
      data: {
        message: 'Issue created',
        id: 'i1',
        identifier: 'ENG-1',
        title: 'New thing',
        url: 'https://linear.app/x/issue/ENG-1',
      },
    });
  });

  test('an empty result set is an empty array, not null', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([], { hasNextPage: false }) });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.deepEqual(r.json, { data: [] });
  });
});

describe('error envelope', () => {
  test('errors go to stderr as {"error","code"} with exit 1 and no stdout', async () => {
    fake.reply({
      contains: 'query Issues',
      errors: [{ message: 'boom', extensions: { userPresentableMessage: 'Something broke.' } }],
    });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.deepEqual(r.errorJson, { error: 'Something broke.', code: 'FETCH_FAILED' });
  });

  test('a missing API key fails as AUTH_MISSING without any network call', async () => {
    // HOME is redirected so the developer's real ~/.config/linear-cli/config.json
    // cannot satisfy the lookup and make this pass for the wrong reason.
    const emptyHome = await mkdtemp(path.join(tmpdir(), 'linear-cli-test-'));

    const r = await runCli(['me'], {
      apiUrl: fake.url,
      env: { LINEAR_API_KEY: '', HOME: emptyHome },
    });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson.code, 'AUTH_MISSING');
    assert.match(r.errorJson.error, /No API key configured/);
    assert.equal(fake.requests.length, 0, 'must not hit the network without a key');
  });

  test('every error code in use is a stable SCREAMING_SNAKE string', async () => {
    fake.reply({ contains: 'query Issues', errors: [{ message: 'nope' }] });
    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });
    assert.match(r.errorJson.code, /^[A-Z][A-Z_]+$/);
  });
});

describe('--human mode', () => {
  test('renders non-JSON to stdout but keeps exit 0', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([{}], { hasNextPage: false }) });

    const r = await runCli(['--human', 'issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.equal(r.json, undefined, 'human mode must not emit JSON');
    assert.match(r.stdout, /identifier/);
  });

  test('is accepted after the subcommand too', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([{}], { hasNextPage: false }) });

    const r = await runCli(['issues', 'list', '--human'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.equal(r.json, undefined);
  });

  test('errors still exit 1 in human mode', async () => {
    fake.reply({ contains: 'query Issues', errors: [{ message: 'nope' }] });

    const r = await runCli(['--human', 'issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson, undefined);
    assert.match(r.stderr, /Error \[FETCH_FAILED\]/);
  });
});
