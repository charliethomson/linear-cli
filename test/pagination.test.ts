import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeLinear, issuePage } from './helpers/fake-linear.js';
import { runCli } from './helpers/run-cli.js';

/**
 * `issues list` is the only paginated command, and its cursor handling is
 * correct today — these tests exist to keep it that way. Linear caps a page at
 * 250; --limit above that must auto-paginate, thread the cursor, and stop.
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

const listRequests = () => fake.requestsMatching('query Issues');

describe('issues list pagination', () => {
  test('a single page under the cap costs one request', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([{}, {}], { hasNextPage: false }) });

    const r = await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.equal(listRequests().length, 1);
    assert.equal(listRequests()[0]!.variables['first'], 50, 'default --limit is 50');
    assert.equal(listRequests()[0]!.variables['after'], null, 'first page sends no cursor');
  });

  test('--limit above 250 pages automatically and threads the cursor', async () => {
    const full = Array.from({ length: 250 }, () => ({}));
    fake.reply({
      contains: 'query Issues',
      sequence: [
        issuePage(full, { hasNextPage: true, endCursor: 'cursor-1' }),
        issuePage(Array.from({ length: 50 }, () => ({})), { hasNextPage: false }),
      ],
    });

    const r = await runCli(['issues', 'list', '--limit', '300'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.equal(r.json.data.length, 300);

    const reqs = listRequests();
    assert.equal(reqs.length, 2, 'should take exactly two round trips');
    assert.equal(reqs[0]!.variables['first'], 250, 'first page requests the 250 cap');
    assert.equal(reqs[0]!.variables['after'], null);
    assert.equal(reqs[1]!.variables['first'], 50, 'second page requests only the remainder');
    assert.equal(reqs[1]!.variables['after'], 'cursor-1', 'second page carries the cursor');
  });

  test('stops early when the API reports no further pages', async () => {
    fake.reply({
      contains: 'query Issues',
      sequence: [issuePage([{}, {}], { hasNextPage: false })],
    });

    const r = await runCli(['issues', 'list', '--limit', '1000'], { apiUrl: fake.url });

    assert.equal(r.code, 0);
    assert.equal(r.json.data.length, 2, 'returns what exists, not what was asked for');
    assert.equal(listRequests().length, 1, 'must not keep requesting past the end');
  });

  test('never requests more than the 250-per-page cap', async () => {
    fake.reply({
      contains: 'query Issues',
      sequence: [
        issuePage(Array.from({ length: 250 }, () => ({})), { hasNextPage: true, endCursor: 'c1' }),
        issuePage(Array.from({ length: 250 }, () => ({})), { hasNextPage: true, endCursor: 'c2' }),
        issuePage(Array.from({ length: 250 }, () => ({})), { hasNextPage: false }),
      ],
    });

    await runCli(['issues', 'list', '--limit', '750'], { apiUrl: fake.url });

    for (const req of listRequests()) {
      assert.ok(
        (req.variables['first'] as number) <= 250,
        `requested first=${req.variables['first']}, above Linear's page cap`
      );
    }
  });

  test('--limit is validated rather than silently coerced', async () => {
    for (const bad of ['abc', '0', '-5']) {
      const r = await runCli(['issues', 'list', '--limit', bad], { apiUrl: fake.url });
      assert.equal(r.code, 1, `--limit ${bad} should be rejected`);
      assert.equal(r.errorJson.code, 'INVALID_INPUT');
      assert.equal(fake.requests.length, 0, 'must not call the API with a bad limit');
    }
  });
});

describe('issues list filters', () => {
  test('a team key is sent as a key filter, a UUID as an id filter', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([], { hasNextPage: false }) });

    await runCli(['issues', 'list', '--team', 'eng'], { apiUrl: fake.url });
    assert.deepEqual(listRequests()[0]!.variables['filter'], { team: { key: { eq: 'ENG' } } });

    fake.requests.length = 0;
    const uuid = '11111111-1111-1111-1111-111111111111';
    await runCli(['issues', 'list', '--team', uuid], { apiUrl: fake.url });
    assert.deepEqual(listRequests()[0]!.variables['filter'], { team: { id: { eq: uuid } } });
  });

  test('no filters means no filter variable at all', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([], { hasNextPage: false }) });

    await runCli(['issues', 'list'], { apiUrl: fake.url });

    assert.equal(listRequests()[0]!.variables['filter'], undefined);
  });

  test('--search becomes a title/description or-filter', async () => {
    fake.reply({ contains: 'query Issues', data: issuePage([], { hasNextPage: false }) });

    await runCli(['issues', 'list', '--search', 'auth'], { apiUrl: fake.url });

    assert.deepEqual(listRequests()[0]!.variables['filter'], {
      or: [
        { title: { containsIgnoreCase: 'auth' } },
        { description: { containsIgnoreCase: 'auth' } },
      ],
    });
  });
});
