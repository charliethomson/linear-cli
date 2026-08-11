import { Command } from 'commander';
import { getApiKey, setApiKey, removeApiKey, getConfigFilePath } from '../config.js';
import { outputData, outputError, outputSuccess } from '../output.js';

export const authCommand = new Command('auth')
  .description('Manage authentication');

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
    const key = result.key;
    const masked = key.length > 8
      ? key.slice(0, 8) + '•'.repeat(key.length - 12) + key.slice(-4)
      : '••••••••';
    outputData({
      configured: true,
      source: result.source,
      maskedKey: masked,
      configFile: getConfigFilePath(),
    });
  });
