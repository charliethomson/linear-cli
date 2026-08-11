import { Command } from 'commander';
import { getApiKey, setApiKey, removeApiKey, getConfigFilePath } from '../config.js';
import { outputData, outputError, outputSuccess } from '../output.js';

export const authCommand = new Command('auth')
  .description('Manage authentication');

/**
 * Mask a key for display, showing at most its first 8 and last 4 characters.
 *
 * The previous form computed `'•'.repeat(key.length - 12)`, which threw a
 * RangeError for any key of length 9-11 — reached by a malformed
 * LINEAR_API_KEY, which is exactly when someone runs `auth status` to find out
 * what is wrong. A 12-character key also printed in full, since the two visible
 * slices covered it with no mask between them. Anything short enough for the
 * windows to meet is masked completely.
 */
function maskKey(key: string): string {
  if (key.length <= 12) return '•'.repeat(Math.max(8, key.length));
  return key.slice(0, 8) + '•'.repeat(key.length - 12) + key.slice(-4);
}

authCommand
  .command('set <api-key>')
  .description('Store API key securely')
  .action((apiKey: string) => {
    if (!apiKey.startsWith('lin_api_')) {
      outputError('Invalid API key format. Expected key starting with lin_api_', 'INVALID_KEY');
    }
    setApiKey(apiKey);
    outputSuccess('API key stored', { source: 'config', file: getConfigFilePath() });
  });

authCommand
  .command('remove')
  .description('Delete stored API key')
  .action(() => {
    const result = getApiKey();
    if (!result || result.source !== 'config') {
      outputError('No stored API key found in config file', 'KEY_NOT_FOUND');
    }
    removeApiKey();
    outputSuccess('API key removed');
  });

authCommand
  .command('status')
  .description('Show key source and masked value')
  .action(() => {
    const result = getApiKey();
    if (!result) {
      outputData({
        configured: false,
        source: null,
        maskedKey: null,
      });
      return;
    }
    const masked = maskKey(result.key);
    outputData({
      configured: true,
      source: result.source,
      maskedKey: masked,
      configFile: getConfigFilePath(),
    });
  });
