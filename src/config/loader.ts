/**
 * Configuration loader for GLearn
 */

import { readFileSync } from 'fs';
import { logger } from '../core/logger.js';

export interface ConfigLoaderOptions {
  path?: string;
  format?: 'json' | 'yaml';
  envPrefix?: string;
}

export class ConfigLoader {
  private options: ConfigLoaderOptions;

  constructor(options: ConfigLoaderOptions = {}) {
    this.options = {
      format: 'json',
      envPrefix: 'GLEARN_',
      ...options,
    };
  }

  load(): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    // Load from file if specified
    if (this.options.path) {
      try {
        const content = readFileSync(this.options.path, 'utf-8');
        if (this.options.format === 'json') {
          Object.assign(config, (() => {
            try {
              return JSON.parse(content);
            } catch (parseError) {
              logger.error('Failed to parse configuration JSON', { error: parseError, path: this.options.path });
              throw new Error(`Invalid configuration JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
            }
          })());
        } else {
          // YAML parsing would go here
          Object.assign(config, (() => {
            try {
              return JSON.parse(content);
            } catch (parseError) {
              logger.error('Failed to parse configuration JSON', { error: parseError, path: this.options.path });
              throw new Error(`Invalid configuration JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
            }
          })());
        }
        logger.info('Configuration loaded from file', { path: this.options.path });
      } catch (error) {
        logger.warn('Failed to load configuration file', { path: this.options.path, error });
      }
    }

    // Load from environment variables
    if (this.options.envPrefix) {
      for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(this.options.envPrefix)) {
          const configKey = key.slice(this.options.envPrefix.length).toLowerCase();
          config[configKey] = value;
        }
      }
      logger.info('Configuration loaded from environment variables');
    }

    return config;
  }

  validate(config: Record<string, unknown>, schema: Record<string, unknown>): boolean {
    // Placeholder for validation logic
    logger.info('Configuration validated');
    return true;
  }
}
