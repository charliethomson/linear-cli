import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeLinear, issuePage } from './helpers/fake-linear.js';
import { runCli } from './helpers/run-cli.js';

/**
 * errorMessage() exists because graphql-request's ClientError serialises the
 * entire request into `message`, which is unusable as CLI output. It prefers
 * extensions.userPresentableMessage and truncates the serialised-request tail.
 * That behaviour is load-bearing and easy to lose in an SDK upgrade.
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

describe('GraphQL error extraction', () => {
  test('prefers extensions.userPresentableMessage over the raw message', async () => {
    fake.reply({
      contains: 'query Issues',
      errors: [
        {
          message: 'GraphQL Error (Code: 400): {"response":{"errors":[...]},"request":{...}}',
          extensions: { userPresentableMessage: 'You do not have access to this team.' },
        },
      ],
    });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.errorJson.error, 'You do not have access to this team.');
    assert.doesNotMatch(r.errorJson.error, /response/, 'serialised request must not leak through');
  });

  test('falls back to message when there is no userPresentableMessage', async () => {
    fake.reply({ contains: 'query Issues', errors: [{ message: 'Entity not found' }] });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.errorJson.error, 'Entity not found');
  });

  test('joins several distinct errors and de-duplicates repeats', async () => {
    fake.reply({
      contains: 'query Issues',
      errors: [
        { message: 'first problem' },
        { message: 'second problem' },
        { message: 'first problem' },
      ],
    });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.errorJson.error, 'first problem; second problem');
  });

  test('never emits the serialised request blob, even with no structured errors', async () => {
    fake.reply({
      contains: 'query Issues',
      raw: { status: 500, body: 'upstream exploded' },
    });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.ok(r.errorJson, 'a transport failure must still produce the JSON error envelope');
    assert.doesNotMatch(r.errorJson.error, /"request":/);
    assert.ok(
      r.errorJson.error.length < 500,
      `error message should stay short, got ${r.errorJson.error.length} chars`
    );
  });

  test('an HTTP 429 surfaces as a JSON error, not a crash', async () => {
    fake.reply({
      contains: 'query Issues',
      raw: {
        status: 429,
        body: JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }),
        headers: { 'retry-after': '30' },
      },
    });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.ok(r.errorJson, 'rate limiting must not break the JSON contract');
    assert.equal(r.errorJson.code, 'FETCH_FAILED');
  });
});

describe('error codes per command family', () => {
  const cases: Array<{ args: string[]; contains: string; code: string }> = [
    { args: ['issues', 'list'], contains: 'query Issues', code: 'FETCH_FAILED' },
    { args: ['teams', 'list'], contains: 'query teams', code: 'FETCH_FAILED' },
    { args: ['labels', 'list'], contains: 'query issueLabels', code: 'FETCH_FAILED' },
    { args: ['me'], contains: 'query viewer', code: 'FETCH_FAILED' },
  ];

  for (const { args, contains, code } of cases) {
    test(`\`linear ${args.join(' ')}\` maps a query failure to ${code}`, async () => {
      fake.reply({ contains, errors: [{ message: 'denied' }] });

      const r = await runCli(args, { apiUrl: fake.url });

      assert.equal(r.code, 1);
      assert.equal(r.errorJson.code, code);
      assert.equal(r.errorJson.error, 'denied');
    });
  }
});

describe('not-found handling', () => {
  test('a missing issue is NOT_FOUND, not a generic fetch failure', async () => {
    fake.reply({ contains: 'query issue(', errors: [{ message: 'Entity not found' }] });

    const r = await runCli(['issues', 'get', 'ENG-999'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson.code, 'NOT_FOUND');
    assert.match(r.errorJson.error, /ENG-999/);
  });

  test('a project that resolves to null is NOT_FOUND', async () => {
    fake.reply({ contains: 'query Project(', data: { project: null } });

    const r = await runCli(['projects', 'get', 'nope'], { apiUrl: fake.url });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson.code, 'NOT_FOUND');
  });
});
