import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runCli } from './helpers/run-cli.js';

/**
 * Keeps the documentation honest about what the CLI actually offers.
 *
 * ai/skills/linear.md is loaded by Claude Code as a skill and is what an agent
 * believes about this tool, so a command documented but not implemented is a
 * failure an agent discovers at the worst moment. The two copies had already
 * drifted once — the installed one is now a symlink to the repo, and this is
 * what stops the content itself going stale.
 */

/** Command groups that own subcommands. */
const GROUPS = [
  'auth',
  'teams',
  'projects',
  'issues',
  'states',
  'labels',
  'users',
  'cycles',
  'issues relations',
  'projects relations',
];

const implemented = new Set<string>();

before(async () => {
  const root = await runCli(['--help']);
  for (const name of parseCommandNames(root.stdout)) implemented.add(name);

  for (const group of GROUPS) {
    const help = await runCli([...group.split(' '), '--help']);
    for (const name of parseCommandNames(help.stdout)) {
      implemented.add(`${group} ${name}`);
    }
  }
});

/** Pull subcommand names out of commander's `Commands:` block. */
function parseCommandNames(help: string): string[] {
  const section = help.split(/^Commands:$/m)[1];
  if (!section) return [];
  return section
    .split('\n')
    .map((line) => line.match(/^\s{2}([a-z][a-z-]*)/)?.[1])
    .filter((name): name is string => Boolean(name) && name !== 'help');
}

/**
 * Extract the command path from a documented `linear ...` invocation, dropping
 * arguments, placeholders and flags.
 */
function documentedCommands(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/^\s*linear (.+)$/gm)) {
    // Take the leading run of whole bare words. Anything else — a placeholder,
    // a flag, or an argument like `lin_api_XXXX` — ends the command path.
    const words: string[] = [];
    for (const token of match[1]!.trim().split(/\s+/)) {
      if (!/^[a-z][a-z-]*$/.test(token)) break;
      words.push(token);
    }
    if (words.length === 0) continue;
    // Longest-first so `issues relations create` is preferred over `issues`.
    for (let n = Math.min(words.length, 3); n >= 1; n--) {
      found.add(words.slice(0, n).join(' '));
    }
  }
  return [...found];
}

for (const doc of ['ai/skills/linear.md', 'README.md']) {
  describe(doc, () => {
    test('every documented command exists in the CLI', async () => {
      const markdown = await readFile(new URL(`../${doc}`, import.meta.url), 'utf-8');

      const unknown = documentedCommands(markdown).filter((candidate) => {
        // A prefix of a real command path is fine ("issues" for "issues list").
        if (implemented.has(candidate)) return false;
        return ![...implemented].some((real) => real.startsWith(`${candidate} `));
      });

      assert.deepEqual(unknown, [], `documented but not implemented: ${unknown.join(', ')}`);
    });
  });
}

describe('ai/skills/linear.md accuracy', () => {
  test('does not describe `issues delete` as a hard delete', async () => {
    const markdown = await readFile(new URL('../ai/skills/linear.md', import.meta.url), 'utf-8');

    // issueDelete is a soft delete: it sets trashed + archivedAt and the issue
    // is recoverable from Trash. The doc asserted the opposite for months.
    assert.doesNotMatch(markdown, /hard delete/i);
    assert.match(markdown, /Trash/);
  });

  test('documents every error code the CLI can emit', async () => {
    const markdown = await readFile(new URL('../ai/skills/linear.md', import.meta.url), 'utf-8');

    for (const code of [
      'AUTH_MISSING',
      'INVALID_KEY',
      'KEY_NOT_FOUND',
      'NOT_FOUND',
      'INVALID_INPUT',
      'MISSING_FIELDS',
      'FETCH_FAILED',
      'CREATE_FAILED',
      'UPDATE_FAILED',
      'ARCHIVE_FAILED',
      'DELETE_FAILED',
    ]) {
      assert.match(markdown, new RegExp(code), `${code} is undocumented`);
    }
  });

  test('the installed skill and the repo copy are the same file', async () => {
    // ~/.claude/skills/linear/SKILL.md is a symlink to ai/skills/linear.md.
    // If that is ever replaced by a copy, the two will drift again as they did
    // between February and July.
    const { realpath } = await import('node:fs/promises');
    const { homedir } = await import('node:os');
    const installed = `${homedir()}/.claude/skills/linear/SKILL.md`;

    let target: string;
    try {
      target = await realpath(installed);
    } catch {
      return; // Not installed on this machine (e.g. CI) — nothing to check.
    }

    const repoCopy = await realpath(new URL('../ai/skills/linear.md', import.meta.url).pathname);
    assert.equal(target, repoCopy, 'the installed skill has drifted from the repo copy');
  });
});
