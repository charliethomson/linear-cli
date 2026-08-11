import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runCli } from './helpers/run-cli.js';

/**
 * The version is derived from git, never stored in a manifest:
 *
 *   VERSION = <tag MAJOR>.<tag MINOR>.<total commit count>
 *
 * See standards/docs/versioning.md. package.json carries a static placeholder
 * that is deliberately not the source of truth, so the interesting failure is
 * the build silently falling back to it — or to the dev sentinel.
 */

const run = promisify(execFile);
const repoRoot = new URL('..', import.meta.url).pathname;

async function git(args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: repoRoot });
  return stdout.trim();
}

describe('version', () => {
  test('is a three-part version, not the dev fallback', async () => {
    const r = await runCli(['--version']);

    assert.equal(r.code, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.notEqual(
      r.stdout.trim(),
      '0.0.0-dev',
      'the build must inject __CLI_VERSION__; the fallback is for `npm run dev` only'
    );
  });

  test('the patch component is the total commit count', async () => {
    const reported = (await runCli(['--version'])).stdout.trim();
    const count = await git(['rev-list', '--count', 'HEAD']);

    assert.equal(
      reported.split('.')[2],
      count,
      'the patch component must be git rev-list --count HEAD, so it stays monotonic'
    );
  });

  test('MAJOR.MINOR comes from the latest v-tag, or 0.0 when untagged', async () => {
    const reported = (await runCli(['--version'])).stdout.trim();
    const [major, minor] = reported.split('.');

    let expected = '0.0';
    try {
      const tag = await git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']);
      const parts = tag.replace(/^v/, '').split('.');
      // The tag's own patch component is ignored by design.
      if (parts[0] && parts[1]) expected = `${parts[0]}.${parts[1]}`;
    } catch {
      // No matching tag; 0.0 is correct.
    }

    assert.equal(`${major}.${minor}`, expected);
  });

  test('the manifest version is a placeholder and is NOT what the CLI reports', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf-8')
    ) as { version: string };
    const reported = (await runCli(['--version'])).stdout.trim();

    assert.equal(pkg.version, '0.0.1', 'package.json should hold the static placeholder');
    assert.notEqual(
      reported,
      pkg.version,
      'reporting the manifest version means the git derivation did not run'
    );
  });

  test('RELEASE_VERSION from the environment wins, so CI computes it once', async () => {
    const { stdout } = await run('sh', ['scripts/version.sh'], {
      cwd: repoRoot,
      env: { ...process.env, RELEASE_VERSION: '7.8.9' },
    });

    assert.equal(stdout.trim(), '7.8.9');
  });

  test('falls back to 0.0.0 outside a git repository', async () => {
    const { mkdtemp, copyFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    // A tarball install has no .git; the standard specifies 0.0.0 there.
    const dir = await mkdtemp(path.join(tmpdir(), 'linear-cli-nogit-'));
    await copyFile(path.join(repoRoot, 'scripts/version.sh'), path.join(dir, 'version.sh'));

    const { stdout } = await run('sh', ['version.sh'], {
      cwd: dir,
      env: { ...process.env, RELEASE_VERSION: '' },
    });

    assert.equal(stdout.trim(), '0.0.0');
  });
});
