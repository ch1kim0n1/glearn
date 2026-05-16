/**
 * Api-key command for GLearn
 * Manage API keys for LLM providers
 */

import { Command } from './command-registry.js';
import { getDefaultSecretManager, sanitizeCliString } from '../core/security.js';

const PROVIDER_SECRETS: Record<string, string> = {
  anthropic: 'anthropic_api_key',
  openai: 'openai_api_key',
};

function secretNameForProvider(provider: string): string {
  const normalized = sanitizeCliString(provider, 'provider', 64).toLowerCase();
  const secretName = PROVIDER_SECRETS[normalized];
  if (!secretName) throw new Error(`Unsupported provider: ${provider}`);
  return secretName;
}

export const apiKeyCommand: Command = {
  name: 'api-key',
  description: 'Manage API keys for LLM providers',
  handler: async (args: string[]) => {
    const secrets = getDefaultSecretManager();
    const records = secrets.list().filter(record => record.name.endsWith('_api_key'));
    console.log(JSON.stringify(records, null, 2));
  },
  subcommands: [
    {
      name: 'set',
      description: 'Set an API key',
      handler: async (args: string[]) => {
        try {
          const provider = args[0];
          const key = args[1];
          if (!provider || !key) {
            console.error('Error: Missing provider or key argument');
            return;
          }
          const record = getDefaultSecretManager().rotate(
            secretNameForProvider(provider),
            sanitizeCliString(key, 'API key', 20000),
          );
          console.log(`Rotated API key for ${provider}: v${record.version}`);
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      name: 'get',
      description: 'Get an API key',
      handler: async (args: string[]) => {
        try {
          const provider = args[0];
          if (!provider) {
            console.error('Error: Missing provider argument');
            return;
          }
          const configured = Boolean(getDefaultSecretManager().get(secretNameForProvider(provider)));
          console.log(JSON.stringify({ provider, configured }, null, 2));
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      name: 'remove',
      description: 'Remove a file-backed API key',
      handler: async (args: string[]) => {
        try {
          const provider = args[0];
          if (!provider) {
            console.error('Error: Missing provider argument');
            return;
          }
          const removed = getDefaultSecretManager().remove(secretNameForProvider(provider));
          console.log(JSON.stringify({ provider, removed }, null, 2));
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      name: 'rotate',
      description: 'Rotate an API key to a newly generated value',
      handler: async (args: string[]) => {
        try {
          const provider = args[0];
          if (!provider) {
            console.error('Error: Missing provider argument');
            return;
          }
          const record = getDefaultSecretManager().rotate(secretNameForProvider(provider));
          console.log(`Rotated API key for ${provider}: v${record.version}`);
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      name: 'list',
      description: 'List all configured API keys',
      handler: async () => {
        const records = getDefaultSecretManager().list().filter(record => record.name.endsWith('_api_key'));
        console.log(JSON.stringify(records, null, 2));
      },
    },
  ],
};
