import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runCli } from './helpers/run-cli.js';

/**
 * The version was previously written out twice — in package.json and as a
 * literal in index.ts — with nothing to catch them disagreeing. It is now
 * injected at build time from package.json; this is the guard that keeps it so.
 */
describe('version', () => {
  test('`--version` matches package.json exactly', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf-8')
    ) as { version: string };

    const r = await runCli(['--version']);

    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), pkg.version);
  });

  test('the built binary carries a real version, not the dev fallback', async () => {
    const r = await runCli(['--version']);
    assert.notEqual(
      r.stdout.trim(),
      '0.0.0-dev',
      'the build must inject __CLI_VERSION__; the fallback is for `npm run dev` only'
    );
  });
});
