/**
 * The CLI version, injected at build time by esbuild from package.json.
 *
 * It used to be written out a second time as a literal in index.ts, which meant
 * `linear --version` and the published package version could disagree with
 * nothing to catch it. package.json is the single source; the build passes it
 * through `--define`.
 *
 * The fallback covers `npm run dev`, where tsx runs the sources directly and no
 * define has been applied. `typeof` rather than a direct read, because the
 * identifier genuinely does not exist in that path.
 */
declare const __CLI_VERSION__: string | undefined;

export const VERSION: string =
  typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.0.0-dev';
