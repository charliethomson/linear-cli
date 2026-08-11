import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'linear-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface Config {
  apiKey?: string;
}

function readConfig(): Config {
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as Config;
  } catch {
    return {};
  }
}

function writeConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getApiKey(): { key: string; source: 'env' | 'config' } | null {
  const envKey = process.env['LINEAR_API_KEY'];
  if (envKey) {
    return { key: envKey, source: 'env' };
  }
  const config = readConfig();
  if (config.apiKey) {
    return { key: config.apiKey, source: 'config' };
  }
  return null;
}

export function setApiKey(key: string): void {
  const config = readConfig();
  config.apiKey = key;
  writeConfig(config);
}

export function removeApiKey(): void {
  const config = readConfig();
  delete config.apiKey;
  writeConfig(config);
}

export function getConfigFilePath(): string {
  return CONFIG_FILE;
}
