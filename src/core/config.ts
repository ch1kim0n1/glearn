/**
 * Configuration management for GLearn
 */

export interface GLearnConfig {
  database: {
    type: 'sqlite' | 'postgres' | 'memory';
    dbPath?: string;
    connectionString?: string;
  };
  llm: {
    provider: string;
    apiKey?: string;
    model?: string;
  };
  learning: {
    patternMinerEnabled: boolean;
    proposalGeneratorEnabled: boolean;
    counterfactualEvaluatorEnabled: boolean;
  };
  multiModel: {
    enabled: boolean;
    tiers: TierConfig[];
  };
  server: {
    port: number;
    host: string;
  };
}

export interface TierConfig {
  name: string;
  model: string;
  costPerToken: number;
  quality: number;
}

export const defaultConfig: GLearnConfig = {
  database: {
    type: 'sqlite',
    dbPath: './glearn.db',
  },
  llm: {
    provider: 'openai',
  },
  learning: {
    patternMinerEnabled: true,
    proposalGeneratorEnabled: true,
    counterfactualEvaluatorEnabled: true,
  },
  multiModel: {
    enabled: false,
    tiers: [],
  },
  server: {
    port: 8080,
    host: 'localhost',
  },
};

export function loadConfig(configPath?: string): GLearnConfig {
  // In a real implementation, this would load from a file
  return defaultConfig;
}

export function mergeConfig(base: GLearnConfig, override: Partial<GLearnConfig>): GLearnConfig {
  return {
    ...base,
    ...override,
    database: { ...base.database, ...override.database },
    llm: { ...base.llm, ...override.llm },
    learning: { ...base.learning, ...override.learning },
    multiModel: { ...base.multiModel, ...override.multiModel },
    server: { ...base.server, ...override.server },
  };
}
