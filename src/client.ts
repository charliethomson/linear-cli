import { LinearClient } from '@linear/sdk';
import { getApiKey } from './config.js';
import { outputError } from './output.js';

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
  return _client;
}
