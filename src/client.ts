import { LinearClient } from '@linear/sdk';
import { getApiKey } from './config.js';
import { outputError } from './output.js';
import { withRetry } from './retry.js';

let _client: LinearClient | null = null;

export function getClient(): LinearClient {
  if (_client) return _client;

  const result = getApiKey();
  if (!result) {
    outputError(
      'No API key configured. Run: linear auth set <api-key> or set LINEAR_API_KEY env var',
      'AUTH_MISSING'
    );
  }

  // LINEAR_API_URL overrides the API endpoint. Unset in normal use; the test
  // suite points it at a local fake so the real binary can be exercised
  // end-to-end without touching a live workspace.
  const apiUrl = process.env['LINEAR_API_URL'];

  _client = new LinearClient({
    apiKey: result!.key,
    ...(apiUrl ? { apiUrl } : {}),
  });

  // Every request goes through client.request — the SDK's own methods are built
  // on `(doc, vars) => this.client.request(doc, vars)`, and this CLI's raw
  // GraphQL queries call it directly. Wrapping it here is the single seam that
  // covers both, so retry behaviour cannot diverge between them.
  const inner = _client.client.request.bind(_client.client);
  (_client.client as any).request = (document: unknown, variables?: unknown) =>
    withRetry(() => inner(document as any, variables as any), { document });

  return _client;
}
