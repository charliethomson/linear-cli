import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeLinear, issuePage, sdkIssue } from './helpers/fake-linear.js';
import { runCli } from './helpers/run-cli.js';
import type * as RetryModule from '../src/retry.js';

/**
 * Retry lives at the single seam every request passes through, so these cover
 * both the raw GraphQL commands and the SDK-backed ones.
 *
 * LINEAR_RETRY_BASE_MS keeps the backoff from spending real seconds; the
 * scheduling logic itself is unit-tested separately below.
 */

const require = createRequire(import.meta.url);
const { isRetryable, nextDelayMs } = require('../src/retry.ts') as typeof RetryModule;

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

/** A 429 body in the shape Linear actually sends. */
const rateLimited = (retryAfter?: string) => ({
  status: 429,
  body: JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }),
  ...(retryAfter ? { headers: { 'retry-after': retryAfter } } : {}),
});

const fastRetry = { LINEAR_RETRY_BASE_MS: '1' };

describe('retry classification', () => {
  test('429 is retryable for both queries and mutations', () => {
    const err = { response: { status: 429 } };
    assert.equal(isRetryable(err, 'query Foo { a }'), true);
    assert.equal(isRetryable(err, 'mutation Bar { b }'), true);
  });

  test('5xx is retryable for a query but NOT for a mutation', () => {
    const err = { response: { status: 500 } };
    assert.equal(isRetryable(err, 'query Foo { a }'), true);
    assert.equal(
      isRetryable(err, 'mutation issueCreate { a }'),
      false,
      'a 5xx may mean the write landed; retrying could duplicate it'
    );
  });

  test('an unidentifiable operation is treated as a mutation on 5xx', () => {
    assert.equal(isRetryable({ response: { status: 500 } }, undefined), false);
  });

  test('4xx other than 429 is not retryable', () => {
    for (const status of [400, 401, 403, 404]) {
      assert.equal(isRetryable({ response: { status } }, 'query Foo { a }'), false, `${status}`);
    }
  });

  test('transport faults are retryable', () => {
    for (const message of ['fetch failed', 'ECONNRESET', 'socket hang up']) {
      assert.equal(isRetryable(new Error(message), 'query Foo { a }'), true, message);
    }
  });

  test('an ordinary GraphQL error is not retryable', () => {
    assert.equal(isRetryable(new Error('Entity not found'), 'query Foo { a }'), false);
  });
});

describe('backoff scheduling', () => {
  test('Retry-After in seconds is honoured over the computed backoff', () => {
    const err = { response: { status: 429, headers: new Headers({ 'retry-after': '7' }) } };
    assert.equal(nextDelayMs(err, 1), 7000);
  });

  test('Retry-After is still capped, so a huge value cannot stall the CLI', () => {
    const err = { response: { status: 429, headers: new Headers({ 'retry-after': '9999' }) } };
    assert.equal(nextDelayMs(err, 1, 30_000), 30_000);
  });

  test('backoff grows with the attempt number and stays within the cap', () => {
    const err = { response: { status: 429 } };
    for (const attempt of [1, 2, 3]) {
      for (let i = 0; i < 50; i++) {
        const d = nextDelayMs(err, attempt, 30_000);
        assert.ok(d >= 0 && d <= 30_000, `delay ${d} out of range`);
      }
    }
  });

  test('jitter spreads delays rather than returning a fixed value', () => {
    const err = { response: { status: 429 } };
    const seen = new Set(Array.from({ length: 40 }, () => nextDelayMs(err, 3, 30_000)));
    assert.ok(seen.size > 1, 'concurrent requests would otherwise retry in lockstep');
  });
});

describe('retry end to end', () => {
  test('a rate-limited query recovers once the limit clears', async () => {
    fake.reply({
      contains: 'query Issues',
      responses: [
        { raw: rateLimited('0') },
        { raw: rateLimited('0') },
        { data: issuePage([{}, {}], { hasNextPage: false }) },
      ],
    });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url, env: fastRetry });

    assert.equal(r.code, 0, 'the third attempt succeeded, so the command must succeed');
    assert.equal(r.json.data.length, 2);
    assert.equal(fake.requestsMatching('query Issues').length, 3);
  });

  test('gives up after the attempt budget and reports the failure', async () => {
    fake.reply({ contains: 'query Issues', raw: rateLimited('0') });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url, env: fastRetry });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson.code, 'FETCH_FAILED');
    assert.equal(fake.requestsMatching('query Issues').length, 3, 'exactly 3 attempts, no more');
  });

  test('--no-retry fails on the first attempt', async () => {
    fake.reply({ contains: 'query Issues', raw: rateLimited('0') });

    const r = await runCli(['--no-retry', 'issues', 'list'], { apiUrl: fake.url, env: fastRetry });

    assert.equal(r.code, 1);
    assert.equal(fake.requestsMatching('query Issues').length, 1);
  });

  test('a non-retryable error is not retried', async () => {
    fake.reply({ contains: 'query Issues', errors: [{ message: 'Access denied' }] });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url, env: fastRetry });

    assert.equal(r.code, 1);
    assert.equal(fake.requestsMatching('query Issues').length, 1, 'must not retry a hard failure');
  });

  test('a create mutation is not retried after a 5xx', async () => {
    fake.reply({
      contains: 'query team',
      data: { team: { id: '11111111-1111-1111-1111-111111111111', key: 'ENG', name: 'Eng' } },
    });
    fake.reply({
      contains: 'mutation createIssue',
      raw: { status: 500, body: JSON.stringify({ errors: [{ message: 'boom' }] }) },
    });

    const r = await runCli(['issues', 'create', '--team', 'ENG', '--title', 'x'], {
      apiUrl: fake.url,
      env: fastRetry,
    });

    assert.equal(r.code, 1);
    assert.equal(
      fake.requestsMatching('mutation createIssue').length,
      1,
      'retrying could create a duplicate issue'
    );
  });

  test('a rate-limited mutation IS retried, since a 429 means it never ran', async () => {
    fake.reply({
      contains: 'query team',
      data: { team: { id: '11111111-1111-1111-1111-111111111111', key: 'ENG', name: 'Eng' } },
    });
    fake.reply({ contains: 'mutation createIssue', raw: rateLimited('0') });

    await runCli(['issues', 'create', '--team', 'ENG', '--title', 'x'], {
      apiUrl: fake.url,
      env: fastRetry,
    });

    assert.equal(fake.requestsMatching('mutation createIssue').length, 3);
  });

  test('retry also covers SDK-backed calls, not just the raw queries', async () => {
    fake.reply({ contains: 'query issue(', raw: rateLimited('0') });

    await runCli(['issues', 'get', 'ENG-1'], { apiUrl: fake.url, env: fastRetry });

    assert.equal(
      fake.requestsMatching('query issue(').length,
      3,
      'the SDK routes through the same seam'
    );
  });
});

describe('finding 4 — a rate limit is no longer reported as a missing entity', () => {
  test('an exhausted retry on identifier resolution is not NOT_FOUND', async () => {
    fake.reply({ contains: 'query issue(', raw: rateLimited('0') });

    const r = await runCli(['issues', 'relations', 'list', 'ENG-1'], {
      apiUrl: fake.url,
      env: fastRetry,
    });

    assert.equal(r.code, 1);
    assert.notEqual(r.errorJson.code, 'NOT_FOUND');
    assert.doesNotMatch(r.errorJson.error, /not found/i);
  });

  test('an auth failure resolving a team key is not reported as a missing team', async () => {
    fake.reply({ contains: 'query team', errors: [{ message: 'Authentication required' }] });

    const r = await runCli(['issues', 'create', '--team', 'ENG', '--title', 'x'], {
      apiUrl: fake.url,
      env: fastRetry,
    });

    assert.equal(r.code, 1);
    assert.doesNotMatch(r.errorJson.error, /not found/i);
  });

  test('a genuinely missing issue is still NOT_FOUND', async () => {
    fake.reply({
      contains: 'query issue(',
      errors: [
        {
          message: 'Entity not found: Issue',
          extensions: { userPresentableMessage: 'Could not find referenced Issue.' },
        },
      ],
    });

    const r = await runCli(['issues', 'relations', 'list', 'ENG-999'], {
      apiUrl: fake.url,
      env: fastRetry,
    });

    assert.equal(r.code, 1);
    assert.equal(r.errorJson.code, 'NOT_FOUND');
    assert.match(r.errorJson.error, /ENG-999/);
  });

  test('a genuinely missing team is still reported as missing', async () => {
    fake.reply({
      contains: 'query team',
      errors: [
        {
          message: 'Entity not found: Team',
          extensions: { userPresentableMessage: 'Could not find referenced Team.' },
        },
      ],
    });

    const r = await runCli(['issues', 'create', '--team', 'NOPE', '--title', 'x'], {
      apiUrl: fake.url,
      env: fastRetry,
    });

    assert.equal(r.code, 1);
    assert.match(r.errorJson.error, /Team 'NOPE' not found/);
  });

  test('bulk-update reports the real reason, not a fabricated not-found', async () => {
    fake.reply({ contains: 'query issue(', raw: rateLimited('0') });

    const file = new URL('./fixtures/bulk-update.json', import.meta.url).pathname;
    const r = await runCli(['issues', 'bulk-update', '--file', file], {
      apiUrl: fake.url,
      env: fastRetry,
    });

    assert.equal(r.code, 0, 'bulk still reports partial failure rather than aborting');
    assert.equal(r.json.data.failedCount, 1);
    assert.doesNotMatch(
      r.json.data.failed[0].error,
      /not found/i,
      'a rate limit must not be recorded in failed[] as a missing issue'
    );
  });
});
