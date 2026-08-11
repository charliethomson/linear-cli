import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO_ROOT, 'dist', 'linear.js');

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
  /** Parsed stdout, or undefined if stdout was not valid JSON. */
  json: any;
  /** Parsed stderr, or undefined if stderr was not valid JSON. */
  errorJson: any;
}

function tryParse(s: string): any {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Run the built CLI against a fake API.
 *
 * Deliberately spawns `dist/linear.js` — the artifact that actually ships and
 * gets symlinked onto PATH — so the tests cover the esbuild bundle, not just
 * the TypeScript sources.
 */
export function runCli(
  args: string[],
  opts: {
    apiUrl?: string;
    apiKey?: string;
    env?: Record<string, string>;
    stdin?: string;
    /** Fail the call if the CLI has not exited by then. Default 10s. */
    timeoutMs?: number;
  } = {}
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: {
        ...process.env,
        LINEAR_API_KEY: opts.apiKey ?? 'lin_api_testkey0000000000000000000000000000',
        ...(opts.apiUrl ? { LINEAR_API_URL: opts.apiUrl } : {}),
        // Keep chalk deterministic regardless of the terminal running the suite.
        FORCE_COLOR: '0',
        ...opts.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);

    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();

    // A hung CLI is itself a bug (see --concurrency 0); fail loudly rather than
    // letting the whole suite stall on the runner's default timeout.
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${timeoutMs}ms: linear ${args.join(' ')}`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        code: code ?? -1,
        json: tryParse(stdout),
        errorJson: tryParse(stderr),
      });
    });
  });
}
