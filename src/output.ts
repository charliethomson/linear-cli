import chalk from 'chalk';
import Table from 'cli-table3';

let _humanMode = false;

export function setHumanMode(enabled: boolean): void {
  _humanMode = enabled;
}

export function isHumanMode(): boolean {
  return _humanMode;
}

export function outputData(data: unknown): void {
  if (_humanMode) {
    formatHuman(data);
  } else {
    process.stdout.write(JSON.stringify({ data }) + '\n');
  }
}

/**
 * Extract a readable message from an SDK or raw graphql-request failure.
 *
 * graphql-request's ClientError appends the whole serialised request to
 * `message`, which is unusable output; prefer the API's userPresentableMessage.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const graphqlErrors = (err as any)?.response?.errors ?? (err as any)?.errors;
  if (Array.isArray(graphqlErrors) && graphqlErrors.length > 0) {
    const messages = graphqlErrors
      .map((e: any) => e?.extensions?.userPresentableMessage || e?.message)
      .filter((m: unknown): m is string => typeof m === 'string' && m.length > 0);
    if (messages.length > 0) return [...new Set(messages)].join('; ');
  }
  if (err instanceof Error && err.message) {
    return err.message.split(': {"response"')[0]!.trim();
  }
  return fallback;
}

/**
 * Whether a failure is specifically "this entity does not exist".
 *
 * Deliberately narrow. Linear answers a bad reference with a GraphQL error
 * rather than a null field, so a caller cannot tell not-found from a transport
 * failure by looking at the data alone — but catching *everything* and calling
 * it not-found is exactly how a 429 ends up reported as a missing issue. This
 * matches the API's own not-found signal and nothing else.
 */
export function isNotFoundError(err: unknown): boolean {
  const e = err as any;

  // Two shapes reach this. A raw client error carries response.errors with the
  // API's own wording; the SDK re-wraps the same failure as a LinearError whose
  // `errors` entries hold only the user-presentable text. Both must match, or
  // the classification silently depends on which code path made the request.
  const graphqlErrors = e?.response?.errors ?? e?.errors;
  const candidates: string[] = [];

  if (typeof e?.message === 'string') candidates.push(e.message);
  if (Array.isArray(graphqlErrors)) {
    for (const g of graphqlErrors) {
      if (typeof g?.message === 'string') candidates.push(g.message);
      const presentable = g?.extensions?.userPresentableMessage;
      if (typeof presentable === 'string') candidates.push(presentable);
    }
  }

  return candidates.some(
    (m) => /entity not found/i.test(m) || /could not find referenced/i.test(m)
  );
}

export function outputError(message: string, code: string, details?: unknown): never {
  if (_humanMode) {
    process.stderr.write(chalk.red(`Error [${code}]: ${message}\n`));
    if (details) {
      process.stderr.write(chalk.dim(JSON.stringify(details, null, 2)) + '\n');
    }
  } else {
    const errorObj: Record<string, unknown> = { error: message, code };
    if (details !== undefined) errorObj['details'] = details;
    process.stderr.write(JSON.stringify(errorObj) + '\n');
  }
  process.exit(1);
}

export function outputSuccess(message: string, data?: unknown): void {
  if (_humanMode) {
    process.stdout.write(chalk.green(`✓ ${message}\n`));
    if (data !== undefined) {
      formatHuman(data);
    }
  } else {
    const merged =
      typeof data === 'object' && data !== null
        ? { message, ...(data as object) }
        : data !== undefined
        ? { message, value: data }
        : { message };
    process.stdout.write(JSON.stringify({ data: merged }) + '\n');
  }
}

function formatHuman(data: unknown): void {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      process.stdout.write('(no results)\n');
      return;
    }
    const firstRow = data[0] as Record<string, unknown>;
    const keys = Object.keys(firstRow).filter((k) => {
      const val = firstRow[k];
      return typeof val !== 'object' || val === null;
    });

    const table = new Table({
      head: keys.map((k) => chalk.cyan(k)),
      style: { head: [], border: [] },
    });
    for (const row of data as Record<string, unknown>[]) {
      table.push(
        keys.map((k) => {
          const v = row[k];
          return v === null || v === undefined ? chalk.dim('—') : String(v);
        })
      );
    }
    process.stdout.write(table.toString() + '\n');
  } else if (typeof data === 'object' && data !== null) {
    const table = new Table({
      style: { head: [], border: [] },
    });
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) {
        table.push({ [chalk.cyan(k)]: v === null || v === undefined ? chalk.dim('—') : String(v) });
      }
    }
    process.stdout.write(table.toString() + '\n');
  } else {
    process.stdout.write(String(data) + '\n');
  }
}
