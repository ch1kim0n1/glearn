/**
 * LLM Client for G-Stack Tools
 * 
 * Provides:
 * - Model pricing tables (Anthropic, OpenAI)
 * - Token counting and cost tracking
 * - Standardized LLM call interface
 * - Multi-tier model selection
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { encoding_for_model, get_encoding, TiktokenModel } from 'tiktoken';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@gstack/shared/core';
import { coreLogger } from './observability.js';

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** Average latency in ms. */
  avg_latency_ms: number;
}

export interface LLMCallResult {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model_id: string;
  cost_usd: number;
  latency_ms: number;
}

export interface EmbeddingResult {
  embedding: number[];
  input_tokens: number;
  model_id: string;
  cost_usd: number;
  latency_ms: number;
}

export interface LLMClientConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  defaultModel?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Hook called after each LLM call with cost info (for BudgetLedger integration) */
  onSpend?: (modelId: string, inputTokens: number, outputTokens: number, costUsd: number) => Promise<void>;
  /** Optional path for persisted aggregate cost/token/call metrics. */
  metricsPersistencePath?: string;
}

/** Anthropic model pricing (as of 2026-05-01) */
export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { input: 5.00, output: 25.00, avg_latency_ms: 5000 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, avg_latency_ms: 2000 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, avg_latency_ms: 500 },
  'claude-opus-4-6': { input: 5.00, output: 25.00, avg_latency_ms: 5000 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, avg_latency_ms: 2000 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00, avg_latency_ms: 500 },
};

/** OpenAI model pricing (as of 2026-05-01) */
export const OPENAI_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.50, output: 10.00, avg_latency_ms: 1500 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, avg_latency_ms: 300 },
  'gpt-4-turbo': { input: 10.00, output: 30.00, avg_latency_ms: 3000 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50, avg_latency_ms: 800 },
  'text-embedding-3-small': { input: 0.02, output: 0.00, avg_latency_ms: 250 },
  'text-embedding-3-large': { input: 0.13, output: 0.00, avg_latency_ms: 500 },
};

/** Combined pricing map */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  ...ANTHROPIC_PRICING,
  ...OPENAI_PRICING,
};

/** Model tier configurations */
export const MODEL_TIERS = {
  tier1: 'claude-haiku-4-5-20251001',
  tier2: 'claude-sonnet-4-6',
  tier3: 'claude-opus-4-7',
};

/**
 * Estimate cost for a model call
 */
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) {
    coreLogger.warn('No pricing for model', { model_id: modelId });
    return 0;
  }
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Get pricing for a model
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  return MODEL_PRICING[modelId] || null;
}

/**
 * Enhanced token counter using tiktoken with fallback
 */
export function estimateTokens(text: string, modelId?: string): number {
  if (!text) return 0;
  
  try {
    let encoder;
    try {
      // Try to get model-specific encoding
      encoder = encoding_for_model((modelId || 'gpt-4o') as TiktokenModel);
    } catch (e) {
      // Fallback to cl100k_base (used by GPT-4 and recent models)
      encoder = get_encoding('cl100k_base');
    }
    
    const tokens = encoder.encode(text).length;
    encoder.free();
    return tokens;
  } catch (e) {
    // Final fallback: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

/**
 * LLM Client class
 */
export class LLMClient {
  private config: LLMClientConfig;
  private totalCostUsd: number = 0;
  private totalTokens: number = 0;
  private callCount: number = 0;
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;
  private logger = createLogger('glearn');
  private metricsPersistencePath?: string;

  constructor(config: LLMClientConfig = {}) {
    this.config = {
      defaultModel: 'claude-sonnet-4-6',
      maxTokens: 4096,
      timeoutMs: 30000,
      ...config,
    };
    this.metricsPersistencePath = this.config.metricsPersistencePath;
    this.loadPersistedMetrics();

    if (this.config.anthropicApiKey) {
      this.anthropicClient = new Anthropic({
        apiKey: this.config.anthropicApiKey,
      });
    }

    if (this.config.openaiApiKey) {
      this.openaiClient = new OpenAI({
        apiKey: this.config.openaiApiKey,
      });
    }
  }

  /**
   * Call an LLM with the given prompt
   */
  async call(
    prompt: string,
    options: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<LLMCallResult> {
    const model = options.model || this.config.defaultModel || 'claude-sonnet-4-6';
    const maxTokens = options.maxTokens || this.config.maxTokens || 4096;
    const startTime = Date.now();

    // Estimate input tokens
    const inputTokens = estimateTokens(prompt, model);

    let content = '';
    let outputTokens = 0;

    if (model.startsWith('claude')) {
      const result = await this.callAnthropic(prompt, model, options);
      content = result.content;
      outputTokens = result.outputTokens;
    } else if (model.includes('gpt')) {
      const result = await this.callOpenAI(prompt, model, options);
      content = result.content;
      outputTokens = result.outputTokens;
    } else {
      // Fallback to legacy simulation if no real call possible
      content = await this.simulateLLMCall(prompt, model, options.temperature);
      outputTokens = estimateTokens(content, model);
    }

    const latency = Date.now() - startTime;
    const cost = estimateCostUsd(model, inputTokens, outputTokens);

    // Track metrics
    this.totalCostUsd += cost;
    this.totalTokens += inputTokens + outputTokens;
    this.callCount++;
    this.persistMetrics();

    // Call onSpend hook if configured (for BudgetLedger integration)
    if (this.config.onSpend) {
      await this.config.onSpend(model, inputTokens, outputTokens, cost);
    }

    return {
      content,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model_id: model,
      cost_usd: cost,
      latency_ms: latency,
    };
  }

  /**
   * Real call to Anthropic SDK
   */
  private async callAnthropic(
    prompt: string,
    model: string,
    options: any
  ): Promise<{ content: string; outputTokens: number }> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic API key not provided');
    }

    const response = await this.anthropicClient.messages.create({
      model: model,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      temperature: options.temperature,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    return {
      content,
      outputTokens: response.usage.output_tokens,
    };
  }

  /**
   * Real call to OpenAI SDK
   */
  private async callOpenAI(
    prompt: string,
    model: string,
    options: any
  ): Promise<{ content: string; outputTokens: number }> {
    if (!this.openaiClient) {
      throw new Error('OpenAI API key not provided');
    }

    const response = await this.openaiClient.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      temperature: options.temperature,
    });

    return {
      content: response.choices[0].message.content || '',
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }

  /**
   * Generate a real embedding using OpenAI's embeddings API.
   */
  async getEmbedding(
    input: string,
    options: {
      model?: string;
      provider?: 'openai';
    } = {}
  ): Promise<EmbeddingResult> {
    const model = options.model || 'text-embedding-3-small';
    const startTime = Date.now();
    const inputTokens = estimateTokens(input, model);

    const embedding = await this.callOpenAIEmbeddings(input, model);
    const latency = Date.now() - startTime;
    const cost = estimateCostUsd(model, inputTokens, 0);

    this.totalCostUsd += cost;
    this.totalTokens += inputTokens;
    this.callCount++;
    this.persistMetrics();

    if (this.config.onSpend) {
      await this.config.onSpend(model, inputTokens, 0, cost);
    }

    return {
      embedding,
      input_tokens: inputTokens,
      model_id: model,
      cost_usd: cost,
      latency_ms: latency,
    };
  }

  private async callOpenAIEmbeddings(input: string, model: string): Promise<number[]> {
    if (!this.openaiClient) {
      throw new Error('OpenAI API key not provided');
    }

    const response = await this.openaiClient.embeddings.create({
      model,
      input,
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error('OpenAI embeddings response did not include an embedding');
    }
    return embedding;
  }

  /**
   * Simulate an LLM call (fallback)
   */
  private async simulateLLMCall(
    prompt: string,
    model: string,
    temperature?: number
  ): Promise<string> {
    const pricing = MODEL_PRICING[model];
    const latency = pricing?.avg_latency_ms || 1000;
    await new Promise(resolve => setTimeout(resolve, latency / 10));

    if (prompt.toLowerCase().includes('plan') || prompt.toLowerCase().includes('decompose')) {
      return JSON.stringify([
        'Analyze task requirements',
        'Design solution architecture',
        'Implement core functionality',
        'Test implementation',
        'Document results'
      ]);
    }

    if (prompt.toLowerCase().includes('execute') || prompt.toLowerCase().includes('subtask')) {
      return JSON.stringify({
        result: 'Executed successfully',
        confidence: 0.85
      });
    }

    if (prompt.toLowerCase().includes('action') || prompt.toLowerCase().includes('decision')) {
      return JSON.stringify({
        type: 'continue',
        reasoning: 'Task not yet complete'
      });
    }

    return JSON.stringify({
      response: 'Processed',
      confidence: 0.7
    });
  }

  getTotalCostUsd(): number {
    return this.totalCostUsd;
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetMetrics(): void {
    this.totalCostUsd = 0;
    this.totalTokens = 0;
    this.callCount = 0;
    this.persistMetrics();
  }

  getModelByTier(tier: 'tier1' | 'tier2' | 'tier3'): string {
    return MODEL_TIERS[tier];
  }

  private loadPersistedMetrics(): void {
    if (!this.metricsPersistencePath || !fs.existsSync(this.metricsPersistencePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.metricsPersistencePath, 'utf8'));
      this.totalCostUsd = typeof parsed.totalCostUsd === 'number' ? parsed.totalCostUsd : 0;
      this.totalTokens = typeof parsed.totalTokens === 'number' ? parsed.totalTokens : 0;
      this.callCount = typeof parsed.callCount === 'number' ? parsed.callCount : 0;
    } catch (error) {
      this.logger.warn('Failed to load persisted metrics', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private persistMetrics(): void {
    if (!this.metricsPersistencePath) {
      return;
    }

    try {
      fs.mkdirSync(path.dirname(this.metricsPersistencePath), { recursive: true });
      fs.writeFileSync(this.metricsPersistencePath, JSON.stringify({
        totalCostUsd: this.totalCostUsd,
        totalTokens: this.totalTokens,
        callCount: this.callCount,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch (error) {
      this.logger.warn('Failed to persist metrics', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
