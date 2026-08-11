/**
 * The CLI version, injected at build time by esbuild.
 *
 *   VERSION = <tag MAJOR>.<tag MINOR>.<total commit count>
 *
 * Derived from git by scripts/version.sh, never read from package.json — the
 * manifest holds a static placeholder. The commit count is monotonic and never
 * resets, so a higher version always means a later commit, which is the whole
 * point: it answers "which commit is this?" from a `--version` string alone.
 * See standards/docs/versioning.md.
 *
 * The fallback covers `npm run dev`, where tsx runs the sources directly and no
 * define has been applied. `typeof` rather than a direct read, because the
 * identifier genuinely does not exist in that path.
 */
declare const __CLI_VERSION__: string | undefined;

export const VERSION: string =
  typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.0.0-dev';
