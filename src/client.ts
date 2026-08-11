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

  _client = new LinearClient({ apiKey: result!.key });
  return _client;
}
