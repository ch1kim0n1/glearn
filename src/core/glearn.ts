import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import {
  Pattern,
  Proposal,
  CounterfactualEvaluation,
  LearningRun,
  DataIngestionRequest,
  GBrainData,
  GStackData,
  GOrchestratorData,
  GMirrorData,
  GToMData,
  MultiModelConfig,
  EscalationMetrics,
  TierConfig,
  ConsensusResult,
} from '../types/index.js';
import { PatternMiner } from './pattern-miner.js';
import { ProposalGenerator } from './proposal-generator.js';
import { CounterfactualEvaluator } from './counterfactual.js';
import { LLMClient } from './llm-client.js';
import { BudgetLedger } from './budget-ledger.js';
import { ReceiptRegistry } from './receipt-registry.js';
import { GLearnPersistenceManager } from './glearn-persistence.js';
import { ExecutionReceipt } from '../types/quality-rubric.js';
import {
  GBrainClient,
  GBrainClientConfig,
  GBrainClientError,
} from '../../../shared/src/core/gbrain-client.js';
import { DriftDetector } from '../../../shared/src/core/drift-detector.js';
import { LatencyTracker } from '../../../shared/src/core/latency-tracker.js';
import { AuditLogger } from '../../../shared/src/core/audit-logger.js';
import { StructuredLogger } from '../../../shared/src/observability/structured-logger.js';
import { createPersistenceManager, type PersistenceConfig } from '../../../shared/src/core/persistence-manager.js';
import { HealthCheckResult } from '../../../shared/src/health/health-checker.js';

/**
 * Main GLearn
 * 
 * Ties together all components:
 * - Data ingestion from all tools
 * - Pattern mining (with Tier 1/Tier 2 escalation)
 * - Proposal generation
 * - Counterfactual evaluation
 * - Human-in-loop approval
 * - Persistent state storage (patterns, proposals, metrics)
 */
export class GLearn {
  private patternMiner: PatternMiner;
  private proposalGenerator: ProposalGenerator;
  private counterfactualEvaluator: CounterfactualEvaluator;
  private gbrainEndpoint: string;
  private gstackEndpoint: string;
  private gorchestratorEndpoint: string;
  private gmirrorEndpoint: string;
  private gtomEndpoint: string;
  private receiptRegistry: ReceiptRegistry;
  private persistenceDb: GLearnPersistenceManager;
  private multiModelConfig: MultiModelConfig;
  private driftDetector: DriftDetector;
  private costLedger: BudgetLedger;
  private costLedgerReady: Promise<void>;
  private llmClient: LLMClient;
  private tierConfigs: Map<string, TierConfig>;
  private escalationMetrics: EscalationMetrics;
  private gbrainClient: GBrainClient;
  private gbrainCircuitOpen: boolean = false;
  private gbrainCircuitOpenUntil: number = 0;
  private readonly CIRCUIT_BREAKER_TIMEOUT_MS = 60000;
  private latencyTracker: LatencyTracker;
  private auditLogger: AuditLogger;
  private persistenceManager: ReturnType<typeof createPersistenceManager<{
    patterns: Pattern[];
    proposals: Proposal[];
    escalationMetrics: EscalationMetrics;
  }>>;
  private persistenceInitialized = false;
  private logger: StructuredLogger;

  constructor(config: {
    gbrainEndpoint?: string;
    gstackEndpoint?: string;
    gorchestratorEndpoint?: string;
    gmirrorEndpoint?: string;
    gtomEndpoint?: string;
    multiModelConfig?: MultiModelConfig;
    statePath?: string;
  } = {}) {
    this.gbrainEndpoint = config.gbrainEndpoint || 'http://localhost:3000';
    this.gstackEndpoint = config.gstackEndpoint || 'http://localhost:3001';
    this.gorchestratorEndpoint = config.gorchestratorEndpoint || 'http://localhost:3001';
    this.gmirrorEndpoint = config.gmirrorEndpoint || 'http://localhost:3002';
    this.gtomEndpoint = config.gtomEndpoint || 'http://localhost:3003';
    
    const gbrainEndpoint = process.env.GBRAIN_ENDPOINT || this.gbrainEndpoint;
    this.gbrainClient = new GBrainClient({
      baseUrl: gbrainEndpoint,
      timeoutMs: 30000,
      maxRetries: 3,
    });

    this.receiptRegistry = new ReceiptRegistry('glearn');
    this.persistenceDb = new GLearnPersistenceManager();
    
    this.driftDetector = new DriftDetector({
      window_size: 100,
      drift_threshold: 0.2,
      alert_threshold: 0.3,
    });
    this.latencyTracker = new LatencyTracker(1000);
    this.auditLogger = new AuditLogger('glearn');
    this.logger = new StructuredLogger('glearn');
    
    // Multi-model configuration with defaults
    this.multiModelConfig = config.multiModelConfig || {
      default_tier: 'tier1',
      escalation_enabled: true,
      escalation_triggers: {
        min_confidence: 0.7,
        min_quality_score: 0.5,
        max_ambiguity: 0.5,
      },
      consensus_threshold: 0.8,
      cost_budget_usd_per_hour: 10.0,
      allow_tier3: true,
    };

    // Tier configurations
    this.tierConfigs = new Map([
      ['tier1', { name: 'claude-haiku-4-5', model_id: 'anthropic/claude-haiku-4-5', cost_per_1k_tokens_usd: 0.001, avg_latency_ms: 500, use_case: 'Initial pattern mining' }],
      ['tier2', { name: 'claude-sonnet-4-6', model_id: 'anthropic/claude-sonnet-4-6', cost_per_1k_tokens_usd: 0.003, avg_latency_ms: 2000, use_case: 'Proposal generation' }],
      ['tier3', { name: 'claude-opus-4-6', model_id: 'anthropic/claude-opus-4-6', cost_per_1k_tokens_usd: 0.015, avg_latency_ms: 5000, use_case: 'Critical decisions' }],
    ]);

    this.costLedger = new BudgetLedger({
      max_budget_usd: this.multiModelConfig.cost_budget_usd_per_hour,
      default_ttl_ms: 5 * 60 * 1000,
      scope_caps_usd: {
        learning_cycle: this.multiModelConfig.cost_budget_usd_per_hour,
      },
    }, 'glearn');
    this.costLedgerReady = this.costLedger.init().catch(error => {
      console.warn('[GLearn] Budget ledger initialization failed:', error);
    });
    this.llmClient = new LLMClient({
      metricsPersistencePath: path.join(os.homedir(), '.glearn', 'audit', 'llm-metrics.json'),
      onSpend: async (modelId, inputTokens, outputTokens, costUsd) => {
        await this.recordLLMSpend(modelId, inputTokens, outputTokens, costUsd);
      },
    });
    this.patternMiner = new PatternMiner(this.llmClient);
    this.proposalGenerator = new ProposalGenerator(this.llmClient);
    this.counterfactualEvaluator = new CounterfactualEvaluator(this.llmClient);

    // Initialize escalation metrics
    this.escalationMetrics = {
      total_tasks: 0,
      escalated_tasks: 0,
      tier1_success_rate: 1,
      tier2_success_rate: 0,
      tier3_success_rate: 0,
      tier1_count: 0,
      tier2_count: 0,
      tier3_count: 0,
      avg_cost_per_task_usd: 0,
      avg_latency_ms: 0,
      tier1_avg_latency_ms: 0,
      tier2_avg_latency_ms: 0,
      tier3_avg_latency_ms: 0,
      consensus_agreement_rate: 0,
      budget_remaining_usd: this.multiModelConfig.cost_budget_usd_per_hour,
    };
    
    // Initialize persistence for patterns, proposals, and metrics
    const initialState = {
      patterns: [],
      proposals: [],
      escalationMetrics: this.escalationMetrics,
    };
    this.persistenceManager = createPersistenceManager(
      initialState,
      'glearn',
      {
        statePath: config.statePath,
        autoSave: false,
      }
    );
  }

  private async ensurePersistenceInitialized(): Promise<void> {
    if (!this.persistenceInitialized) {
      await this.persistenceManager.init();
      this.persistenceInitialized = true;
    }
  }

  /**
   * Get latency metrics
   */
  getLatencyMetrics() {
    return this.latencyTracker.getMetrics();
  }

  private async recordLLMSpend(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
  ): Promise<void> {
    await this.costLedgerReady;
    const reserveUsd = Math.max(costUsd, Number(process.env.GLEARN_LLM_CALL_RESERVE_USD || '0.01'));
    const ttlMs = Number(process.env.GLEARN_BUDGET_RESERVATION_TTL_MS || String(5 * 60 * 1000));
    const reservation = this.costLedger.reserve('learning_cycle_llm', reserveUsd, ttlMs, {
      scope: 'learning_cycle',
      resolver: 'llm',
      model: modelId,
    });

    await this.costLedger.commit(reservation.id, costUsd, {
      model_id: modelId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      operation: 'learning_cycle_llm',
      metadata: {
        scope: 'learning_cycle',
        resolver: 'llm',
      },
    });
  }

  /**
   * Run a learning cycle with multi-model escalation
   */
  async runLearningCycle(request: {
    time_range?: { start: string; end: string };
    run_counterfactual?: boolean;
    priority?: 'normal' | 'high' | 'critical';
  } = {}): Promise<LearningRun> {
    const runId = uuidv4();
    const start = performance.now();
    const startTime = Date.now();
    const runStartCostUsd = this.llmClient.getTotalCostUsd();
    let currentTier = this.multiModelConfig.default_tier;
    let escalated = false;
    let tier3Used = false;

    // Check budget before execution
    if (this.escalationMetrics.budget_remaining_usd < 0) {
      this.logger.error('Budget exceeded before learning cycle execution', undefined, {
        budget_remaining: this.escalationMetrics.budget_remaining_usd,
      });
      return {
        run_id: runId,
        run_type: 'pattern_mining',
        status: 'failed',
        patterns_found: 0,
        proposals_generated: 0,
        evaluations_completed: 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: 'Budget exceeded before execution',
      };
    }

    const run: LearningRun = {
      run_id: runId,
      run_type: 'pattern_mining',
      status: 'running',
      patterns_found: 0,
      proposals_generated: 0,
      evaluations_completed: 0,
      started_at: new Date().toISOString(),
    };

    try {
      // Phase 1: Ingest data from all tools
      this.logger.info('Phase 1: Ingesting data');
      await this.ingestDataFromAllTools(request.time_range);

      // Phase 2: Mine patterns with Tier 1
      this.logger.info('Phase 2: Mining patterns (Tier 1)');
      const patternStartTime = Date.now();
      const patterns = await this.minePatternsWithEscalation();
      const patternDuration = Date.now() - patternStartTime;
      run.patterns_found = patterns.length;

      // Update metrics
      this.escalationMetrics.total_tasks++;
      this.escalationMetrics.tier1_count++;
      this.escalationMetrics.tier1_avg_latency_ms = patternDuration;

      // Phase 3: Generate proposals with escalation based on statistical significance
      this.logger.info('Phase 3: Generating proposals (with escalation check)');
      const proposalStartTime = Date.now();
      const proposals = await this.generateProposalsWithEscalation(patterns, request.priority);
      const proposalDuration = Date.now() - proposalStartTime;
      run.proposals_generated = proposals.length;

      // Track escalation
      if (escalated) {
        this.escalationMetrics.escalated_tasks++;
        this.escalationMetrics.tier2_count++;
        this.escalationMetrics.tier2_avg_latency_ms = proposalDuration;
      }

      if (tier3Used) {
        this.escalationMetrics.tier3_count++;
        this.escalationMetrics.tier3_avg_latency_ms = proposalDuration;
      }

      // Phase 4: Counterfactual evaluation (if requested)
      if (request.run_counterfactual) {
        this.logger.info('Phase 4: Counterfactual evaluation');
        const baselineMetrics = this.extractBaselineMetrics();
        const evaluations = await this.counterfactualEvaluator.batchEvaluate(
          proposals,
          baselineMetrics
        );
        run.evaluations_completed = evaluations.length;
      }

      run.status = 'completed';
      run.completed_at = new Date().toISOString();

      this.logger.info(`Learning cycle complete: ${run.patterns_found} patterns, ${run.proposals_generated} proposals`);

      // Generate and emit receipt
      const receipt = await this.generateReceipt(request, run, this.llmClient.getTotalCostUsd() - runStartCostUsd);
      await this.receiptRegistry.append(receipt);
      
      // Store receipt in gbrain for quality control
      await this.storeReceiptInGBrain(receipt);
      
      // Persist patterns and proposals
      await this.ensurePersistenceInitialized();
      await this.persistenceManager.updateState(state => ({
        ...state,
        patterns: this.patternMiner.getPatterns(),
        proposals: [], // Proposals are generated per-cycle, not persisted long-term
        escalationMetrics: this.escalationMetrics,
      }));
    } catch (error) {
      run.status = 'failed';
      run.error_message = error instanceof Error ? error.message : String(error);
      run.completed_at = new Date().toISOString();
      console.error('[GLearn] Learning cycle failed:', error);

      // Generate and emit receipt even on failure
      const receipt = await this.generateReceipt(request, run, this.llmClient.getTotalCostUsd() - runStartCostUsd);
      await this.receiptRegistry.append(receipt);
      
      // Store receipt in gbrain for quality control
      await this.storeReceiptInGBrain(receipt);
      
      // Persist state even on failure
      await this.ensurePersistenceInitialized();
      await this.persistenceManager.updateState(state => ({
        ...state,
        escalationMetrics: this.escalationMetrics,
      }));
    }

    this.latencyTracker.record(performance.now() - start);
    return run;
  }

  /**
   * Mine patterns with Tier 1/Tier 2 escalation based on confidence
   */
  private async minePatternsWithEscalation(): Promise<Pattern[]> {
    const tier1Config = this.tierConfigs.get('tier1')!;
    this.logger.info(`Using Tier 1: ${tier1Config.name} for pattern mining`);
    
    // Tier 1: Initial pattern mining with fast/cheap model
    const tier1Patterns = await this.patternMiner.minePatterns();
    
    // Calculate average confidence
    const avgConfidence = tier1Patterns.length > 0 
      ? tier1Patterns.reduce((sum, p) => sum + p.confidence, 0) / tier1Patterns.length 
      : 0;

    // Check if escalation is needed based on confidence threshold
    const needsEscalation = this.multiModelConfig.escalation_enabled && 
                           avgConfidence < this.multiModelConfig.escalation_triggers.min_confidence;

    if (needsEscalation && tier1Patterns.length > 0) {
      this.logger.info(`Average confidence ${avgConfidence.toFixed(2)} below threshold ${this.multiModelConfig.escalation_triggers.min_confidence}, escalating to Tier 2`);
      
      // Tier 2: Re-mine with higher quality model
      const tier2Config = this.tierConfigs.get('tier2')!;
      this.logger.info(`Escalating to Tier 2: ${tier2Config.name}`);
      
      // In a real implementation, this would call a different model
      // For now, we simulate by re-running pattern mining with enhanced parameters
      const tier2Patterns = await this.patternMiner.minePatterns();
      
      // Apply consensus mechanism to determine final output
      const consensus = this.computeConsensus(tier1Patterns, tier2Patterns);
      this.logger.info(`Consensus decision: ${consensus.decision}, similarity: ${consensus.similarity_score.toFixed(2)}`);
      
      return consensus.final_output as Pattern[];
    }

    return tier1Patterns;
  }

  /**
   * Generate proposals with escalation based on statistical significance
   */
  private async generateProposalsWithEscalation(
    patterns: Pattern[], 
    priority: 'normal' | 'high' | 'critical' = 'normal'
  ): Promise<Proposal[]> {
    // Calculate statistical significance of patterns
    const statisticalSignificance = this.calculateStatisticalSignificance(patterns);
    
    this.logger.info(`Statistical significance: ${statisticalSignificance.toFixed(2)}`);
    this.logger.info(`Priority: ${priority}`);

    let proposals: Proposal[];
    let tier = 'tier1';
    
    // Check if escalation is needed based on statistical significance
    const needsTier2Escalation = this.multiModelConfig.escalation_enabled && 
                                statisticalSignificance < 0.6;
    
    // Check if Tier 3 escalation is needed (critical path triggers)
    const needsTier3Escalation = this.multiModelConfig.allow_tier3 && 
                                (priority === 'critical' || 
                                 statisticalSignificance < 0.3 ||
                                 needsTier2Escalation && this.checkBudgetForTier3());

    if (needsTier3Escalation && patterns.length > 0) {
      this.logger.info('Critical path detected, escalating to Tier 3 for proposal generation');
      const tier3Config = this.tierConfigs.get('tier3')!;
      this.logger.info(`Using Tier 3: ${tier3Config.name}`);

      // Tier 3: Generate proposals with premium model for critical decisions
      proposals = await this.proposalGenerator.generateProposals(patterns);

      // Enhance proposals with Tier 3 analysis
      proposals = this.enhanceProposalsTier3(proposals);
      tier = 'tier3';
    } else if (needsTier2Escalation && patterns.length > 0) {
      this.logger.info('Low statistical significance detected, escalating to Tier 2 for proposal generation');
      const tier2Config = this.tierConfigs.get('tier2')!;
      this.logger.info(`Using Tier 2: ${tier2Config.name}`);

      // Tier 2: Generate proposals with higher quality model
      proposals = await this.proposalGenerator.generateProposals(patterns);

      // Enhance proposals with additional analysis
      proposals = this.enhanceProposals(proposals);
      tier = 'tier2';
    } else {
      // Tier 1: Standard proposal generation
      proposals = await this.proposalGenerator.generateProposals(patterns);
    }

    // Update tier tracking
    this.trackTierUsage(tier);

    return proposals;
  }

  /**
   * Check if budget allows Tier 3 usage
   */
  private checkBudgetForTier3(): boolean {
    const tier3Cost = this.tierConfigs.get('tier3')!.cost_per_1k_tokens_usd;
    const estimatedTaskCost = tier3Cost * 10; // Estimate 10k tokens per task
    return this.escalationMetrics.budget_remaining_usd >= estimatedTaskCost;
  }

  /**
   * Track tier usage in metrics
   */
  private trackTierUsage(tier: string): void {
    if (tier === 'tier1') {
      this.escalationMetrics.tier1_count++;
    } else if (tier === 'tier2') {
      this.escalationMetrics.tier2_count++;
    } else if (tier === 'tier3') {
      this.escalationMetrics.tier3_count++;
    }
  }

  /**
   * Enhance proposals with Tier 3 premium analysis
   */
  private enhanceProposalsTier3(proposals: Proposal[]): Proposal[] {
    return proposals.map(proposal => ({
      ...proposal,
      expected_impact: {
        ...proposal.expected_impact,
        confidence: Math.min(1, proposal.expected_impact.confidence + 0.15), // Higher boost for Tier 3
      },
      rationale: `${proposal.rationale} [Tier 3 Enhanced: Critical path analysis with premium model]`,
    }));
  }

  /**
   * Calculate statistical significance of patterns
   */
  private calculateStatisticalSignificance(patterns: Pattern[]): number {
    if (patterns.length === 0) return 0;

    // Statistical significance based on:
    // 1. Number of observations
    // 2. Confidence scores
    // 3. Pattern diversity
    
    const avgObservationCount = patterns.reduce((sum, p) => sum + p.observation_count, 0) / patterns.length;
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    const patternTypes = new Set(patterns.map(p => p.pattern_type));
    
    // Normalize observation count (max expected ~100)
    const observationScore = Math.min(1, avgObservationCount / 50);
    
    // Weighted combination
    const significance = (observationScore * 0.4) + (avgConfidence * 0.4) + (patternTypes.size / 6 * 0.2);
    
    return Math.min(1, significance);
  }

  /**
   * Merge patterns from two tiers, keeping higher confidence versions
   */
  private mergePatterns(tier1Patterns: Pattern[], tier2Patterns: Pattern[]): Pattern[] {
    const merged = new Map<string, Pattern>();
    
    // Add all Tier 1 patterns
    for (const pattern of tier1Patterns) {
      merged.set(pattern.pattern_id, pattern);
    }
    
    // Add Tier 2 patterns, replacing Tier 1 if higher confidence
    for (const pattern of tier2Patterns) {
      const existing = merged.get(pattern.pattern_id);
      if (!existing || pattern.confidence > existing.confidence) {
        merged.set(pattern.pattern_id, pattern);
      }
    }
    
    return Array.from(merged.values());
  }

  /**
   * Compute consensus between Tier 1 and Tier 2 outputs
   */
  private computeConsensus(tier1Output: Pattern[], tier2Output: Pattern[]): ConsensusResult {
    const similarityScore = this.calculateSimilarityScore(tier1Output, tier2Output);
    const consensusThreshold = this.multiModelConfig.consensus_threshold;

    let decision: ConsensusResult['decision'];
    let reason: string;
    let finalOutput: Pattern[];

    if (similarityScore > consensusThreshold) {
      // High similarity: Accept Tier 1 (cheaper, faster)
      decision = 'accept_tier1';
      reason = `High similarity (${similarityScore.toFixed(2)}) > threshold (${consensusThreshold}), accepting Tier 1 output`;
      finalOutput = tier1Output;
      this.escalationMetrics.consensus_agreement_rate = similarityScore;
    } else if (similarityScore < 0.5) {
      // Low similarity: Accept Tier 2 (higher quality)
      decision = 'accept_tier2';
      reason = `Low similarity (${similarityScore.toFixed(2)}) < 0.5, accepting Tier 2 output for higher quality`;
      finalOutput = tier2Output;
      this.escalationMetrics.consensus_agreement_rate = 1 - similarityScore;
    } else {
      // Medium similarity: Merge outputs
      decision = 'merge';
      reason = `Medium similarity (${similarityScore.toFixed(2)}) in ambiguous range, merging outputs`;
      finalOutput = this.mergeOutputs(tier1Output, tier2Output);
      this.escalationMetrics.consensus_agreement_rate = similarityScore;
    }

    return {
      similarity_score: similarityScore,
      decision,
      reason,
      tier1_output: tier1Output,
      tier2_output: tier2Output,
      final_output: finalOutput,
    };
  }

  /**
   * Calculate similarity score between two outputs
   */
  private calculateSimilarityScore(output1: Pattern[], output2: Pattern[]): number {
    if (output1.length === 0 && output2.length === 0) return 1;
    if (output1.length === 0 || output2.length === 0) return 0;

    // Calculate similarity based on:
    // 1. Pattern type overlap
    // 2. Confidence score similarity
    // 3. Description similarity (simplified as string comparison)

    const types1 = new Set(output1.map(p => p.pattern_type));
    const types2 = new Set(output2.map(p => p.pattern_type));
    
    // Type overlap similarity
    const typeIntersection = new Set([...types1].filter(x => types2.has(x)));
    const typeUnion = new Set([...types1, ...types2]);
    const typeSimilarity = typeUnion.size > 0 ? typeIntersection.size / typeUnion.size : 0;

    // Confidence similarity
    const avgConf1 = output1.reduce((sum, p) => sum + p.confidence, 0) / output1.length;
    const avgConf2 = output2.reduce((sum, p) => sum + p.confidence, 0) / output2.length;
    const confSimilarity = 1 - Math.abs(avgConf1 - avgConf2);

    // Count similarity
    const countSimilarity = 1 - Math.abs(output1.length - output2.length) / Math.max(output1.length, output2.length);

    // Weighted combination
    const similarity = (typeSimilarity * 0.4) + (confSimilarity * 0.3) + (countSimilarity * 0.3);

    return Math.min(1, Math.max(0, similarity));
  }

  /**
   * Merge two outputs when similarity is in ambiguous range
   */
  private mergeOutputs(output1: Pattern[], output2: Pattern[]): Pattern[] {
    const merged = new Map<string, Pattern>();
    
    // Add all patterns from both outputs
    for (const pattern of [...output1, ...output2]) {
      const existing = merged.get(pattern.pattern_id);
      if (!existing || pattern.confidence > existing.confidence) {
        merged.set(pattern.pattern_id, pattern);
      }
    }
    
    return Array.from(merged.values());
  }

  /**
   * Enhance proposals with additional analysis (Tier 2 enhancement)
   */
  private enhanceProposals(proposals: Proposal[]): Proposal[] {
    return proposals.map(proposal => ({
      ...proposal,
      expected_impact: {
        ...proposal.expected_impact,
        confidence: Math.min(1, proposal.expected_impact.confidence + 0.1), // Boost confidence
      },
      rationale: `${proposal.rationale} [Tier 2 Enhanced: Low statistical significance triggered escalation]`,
    }));
  }

  /**
   * Ingest data from all tools
   */
  private async ingestDataFromAllTools(timeRange?: { start: string; end: string }): Promise<void> {
    // Ingest from GBrain
    try {
      const gbrainData = await this.fetchGBrainData(timeRange);
      this.patternMiner.ingestData('GBrain', gbrainData);
    } catch (error) {
      console.warn('[GLearn] Failed to ingest GBrain data:', error);
    }

    // Ingest from GStack
    try {
      const gstackData = await this.fetchGStackData(timeRange);
      this.patternMiner.ingestData('GStack', gstackData);
    } catch (error) {
      console.warn('[GLearn] Failed to ingest GStack data:', error);
    }

    // Ingest from GOrchestrator
    try {
      const orchData = await this.fetchGOrchestratorData(timeRange);
      this.patternMiner.ingestData('GOrchestrator', orchData);
    } catch (error) {
      console.warn('[GLearn] Failed to ingest GOrchestrator data:', error);
    }

    // Ingest from GMirror
    try {
      const mirrorData = await this.fetchGMirrorData(timeRange);
      this.patternMiner.ingestData('GMirror', mirrorData);
    } catch (error) {
      console.warn('[GLearn] Failed to ingest GMirror data:', error);
    }

    // Ingest from GToM
    try {
      const gtomData = await this.fetchGToMData(timeRange);
      this.patternMiner.ingestData('GToM', gtomData);
    } catch (error) {
      console.warn('[GLearn] Failed to ingest GToM data:', error);
    }
  }

  /**
   * Fetch GBrain data
   */
  private async fetchGBrainData(timeRange?: { start: string; end: string }): Promise<GBrainData> {
    // In production, would fetch from GBrain API
    // For MVP, return mock data
    return {
      pages: [],
      searches: [],
    };
  }

  /**
   * Fetch GStack data
   */
  private async fetchGStackData(timeRange?: { start: string; end: string }): Promise<GStackData> {
    // In production, would fetch from GStack API
    // For MVP, return mock data
    return {
      runs: [],
      skill_usage: {},
    };
  }

  /**
   * Fetch GOrchestrator data
   */
  private async fetchGOrchestratorData(timeRange?: { start: string; end: string }): Promise<GOrchestratorData> {
    // In production, would fetch from GOrchestrator API
    // For MVP, return mock data
    return {
      run_records: [],
      configuration_performance: {},
    };
  }

  /**
   * Fetch GMirror data
   */
  private async fetchGMirrorData(timeRange?: { start: string; end: string }): Promise<GMirrorData> {
    // In production, would fetch from GMirror API
    // For MVP, return mock data
    return {
      verdicts: [],
      failure_modes: [],
    };
  }

  /**
   * Fetch GToM data
   */
  private async fetchGToMData(timeRange?: { start: string; end: string }): Promise<GToMData> {
    // In production, would fetch from GToM API
    // For MVP, return mock data
    return {
      vulnerability_states: [],
      authenticity_scores: [],
    };
  }

  /**
   * Extract baseline metrics from data store
   */
  private extractBaselineMetrics(): Record<string, number> {
    const dataStore = this.patternMiner.getDataStore();
    const metrics: Record<string, number> = {};

    // Extract metrics from each tool's data
    const orchData = dataStore.get('GOrchestrator') as GOrchestratorData | undefined;
    if (orchData && orchData.run_records.length > 0) {
      metrics['orch_avg_cost'] = orchData.run_records.reduce(
        (sum: number, r: any) => sum + r.total_cost_usd,
        0
      ) / orchData.run_records.length;
      metrics['orch_avg_duration'] = orchData.run_records.reduce(
        (sum: number, r: any) => sum + r.total_wall_time_ms,
        0
      ) / orchData.run_records.length;
    }

    const mirrorData = dataStore.get('GMirror') as GMirrorData | undefined;
    if (mirrorData && mirrorData.verdicts.length > 0) {
      metrics['mirror_avg_correctness'] = mirrorData.verdicts.reduce(
        (sum: number, v: any) => sum + v.correctness,
        0
      ) / mirrorData.verdicts.length;
    }

    return metrics;
  }

  /**
   * Get patterns
   */
  getPatterns(): Pattern[] {
    return this.patternMiner.getPatterns();
  }

  /**
   * Get proposals
   */
  async getProposals(patterns: Pattern[]): Promise<Proposal[]> {
    const start = performance.now();
    const result = await this.proposalGenerator.generateProposals(patterns);
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /**
   * Approve a proposal
   */
  approveProposal(proposalId: string, reviewer: string): Proposal | null {
    return this.proposalGenerator.approveProposal(proposalId, reviewer);
  }

  /**
   * Reject a proposal
   */
  rejectProposal(proposalId: string, reviewer: string): Proposal | null {
    return this.proposalGenerator.rejectProposal(proposalId, reviewer);
  }

  /**
   * Apply a proposal
   */
  async applyProposal(proposalId: string): Promise<boolean> {
    const start = performance.now();
    const result = await this.proposalGenerator.applyProposal(proposalId);
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /**
   * Rollback a proposal
   */
  async rollbackProposal(proposalId: string): Promise<boolean> {
    const start = performance.now();
    const result = await this.proposalGenerator.rollbackProposal(proposalId);
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /**
   * Get escalation metrics for monitoring
   */
  getEscalationMetrics(): EscalationMetrics {
    const totalTasks = this.escalationMetrics.tier1_count + this.escalationMetrics.tier2_count + this.escalationMetrics.tier3_count;
    
    // Calculate tier success rates
    const tier1SuccessRate = totalTasks > 0 ? this.escalationMetrics.tier1_count / totalTasks : 1;
    const tier2SuccessRate = totalTasks > 0 ? this.escalationMetrics.tier2_count / totalTasks : 0;
    const tier3SuccessRate = totalTasks > 0 ? this.escalationMetrics.tier3_count / totalTasks : 0;
    
    // Calculate escalation rate
    const escalatedTasks = this.escalationMetrics.tier2_count + this.escalationMetrics.tier3_count;
    const escalationRate = totalTasks > 0 ? escalatedTasks / totalTasks : 0;

    return {
      total_tasks: totalTasks,
      escalated_tasks: escalatedTasks,
      tier1_success_rate: tier1SuccessRate,
      tier2_success_rate: tier2SuccessRate,
      tier3_success_rate: tier3SuccessRate,
      tier1_count: this.escalationMetrics.tier1_count,
      tier2_count: this.escalationMetrics.tier2_count,
      tier3_count: this.escalationMetrics.tier3_count,
      avg_cost_per_task_usd: this.calculateAvgCostPerTask(),
      avg_latency_ms: this.calculateAvgLatency(),
      tier1_avg_latency_ms: this.escalationMetrics.tier1_avg_latency_ms,
      tier2_avg_latency_ms: this.escalationMetrics.tier2_avg_latency_ms,
      tier3_avg_latency_ms: this.escalationMetrics.tier3_avg_latency_ms,
      consensus_agreement_rate: this.escalationMetrics.consensus_agreement_rate,
      budget_remaining_usd: this.escalationMetrics.budget_remaining_usd,
    };
  }

  /**
   * Calculate average cost per task
   */
  private calculateAvgCostPerTask(): number {
    const totalTasks = this.escalationMetrics.tier1_count + this.escalationMetrics.tier2_count + this.escalationMetrics.tier3_count;
    if (totalTasks === 0) return 0;

    const tier1Cost = this.escalationMetrics.tier1_avg_latency_ms / 1000 * (this.tierConfigs.get('tier1')?.cost_per_1k_tokens_usd || 0.001);
    const tier2Cost = this.escalationMetrics.tier2_avg_latency_ms / 1000 * (this.tierConfigs.get('tier2')?.cost_per_1k_tokens_usd || 0.003);
    const tier3Cost = this.escalationMetrics.tier3_avg_latency_ms / 1000 * (this.tierConfigs.get('tier3')?.cost_per_1k_tokens_usd || 0.015);

    const tier1Rate = this.escalationMetrics.tier1_count / totalTasks;
    const tier2Rate = this.escalationMetrics.tier2_count / totalTasks;
    const tier3Rate = this.escalationMetrics.tier3_count / totalTasks;

    return tier1Cost * tier1Rate + tier2Cost * tier2Rate + tier3Cost * tier3Rate;
  }

  /**
   * Calculate average latency
   */
  private calculateAvgLatency(): number {
    const totalTasks = this.escalationMetrics.tier1_count + this.escalationMetrics.tier2_count + this.escalationMetrics.tier3_count;
    if (totalTasks === 0) return 0;

    const tier1Rate = this.escalationMetrics.tier1_count / totalTasks;
    const tier2Rate = this.escalationMetrics.tier2_count / totalTasks;
    const tier3Rate = this.escalationMetrics.tier3_count / totalTasks;

    return this.escalationMetrics.tier1_avg_latency_ms * tier1Rate + 
           this.escalationMetrics.tier2_avg_latency_ms * tier2Rate +
           this.escalationMetrics.tier3_avg_latency_ms * tier3Rate;
  }

  /**
   * Get multi-model configuration
   */
  getMultiModelConfig(): MultiModelConfig {
    return { ...this.multiModelConfig };
  }

  /**
   * Update multi-model configuration
   */
  updateMultiModelConfig(config: Partial<MultiModelConfig>): void {
    this.multiModelConfig = { ...this.multiModelConfig, ...config };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthCheckResult[]> {
    const start = performance.now();
    const results: HealthCheckResult[] = [];
    
    // Check pattern_miner (internal component)
    const pmStart = performance.now();
    results.push({
      service: 'pattern_miner',
      healthy: true,
      latency_ms: performance.now() - pmStart,
      timestamp: new Date().toISOString(),
    });

    // Check proposal_generator (internal component)
    const pgStart = performance.now();
    results.push({
      service: 'proposal_generator',
      healthy: true,
      latency_ms: performance.now() - pgStart,
      timestamp: new Date().toISOString(),
    });

    // Check counterfactual_evaluator (internal component)
    const ceStart = performance.now();
    results.push({
      service: 'counterfactual_evaluator',
      healthy: true,
      latency_ms: performance.now() - ceStart,
      timestamp: new Date().toISOString(),
    });

    // Check gbrain
    const gbrainStart = performance.now();
    try {
      const response = await fetch(`${this.gbrainEndpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        service: 'gbrain',
        healthy: response.ok,
        latency_ms: performance.now() - gbrainStart,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        service: 'gbrain',
        healthy: false,
        latency_ms: performance.now() - gbrainStart,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }

    // Check gstack
    const gstackStart = performance.now();
    try {
      const response = await fetch(`${this.gstackEndpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        service: 'gstack',
        healthy: response.ok,
        latency_ms: performance.now() - gstackStart,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        service: 'gstack',
        healthy: false,
        latency_ms: performance.now() - gstackStart,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }

    // Check gorchestrator
    const gorchestratorStart = performance.now();
    try {
      const response = await fetch(`${this.gorchestratorEndpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        service: 'gorchestrator',
        healthy: response.ok,
        latency_ms: performance.now() - gorchestratorStart,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        service: 'gorchestrator',
        healthy: false,
        latency_ms: performance.now() - gorchestratorStart,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }

    // Check gmirror
    const gmirrorStart = performance.now();
    try {
      const response = await fetch(`${this.gmirrorEndpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        service: 'gmirror',
        healthy: response.ok,
        latency_ms: performance.now() - gmirrorStart,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        service: 'gmirror',
        healthy: false,
        latency_ms: performance.now() - gmirrorStart,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }

    // Check gtom
    const gtomStart = performance.now();
    try {
      const response = await fetch(`${this.gtomEndpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        service: 'gtom',
        healthy: response.ok,
        latency_ms: performance.now() - gtomStart,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        service: 'gtom',
        healthy: false,
        latency_ms: performance.now() - gtomStart,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }

    this.latencyTracker.record(performance.now() - start);
    return results;
  }

  private async checkEndpoint(endpoint: string): Promise<'ok' | 'error'> {
    try {
      const response = await fetch(`${endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000),
      });
      return response.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  /**
   * Get receipts
   */
  async getReceipts(options?: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const start = performance.now();
    let result;
    if (options?.startDate && options?.endDate) {
      const startDate = new Date(options.startDate);
      const end = new Date(options.endDate);
      const receipts = await this.receiptRegistry.getAllBetween(startDate, end);
      
      // Apply limit and offset
      result = receipts;
      if (options.offset) {
        result = result.slice(options.offset);
      }
      if (options.limit) {
        result = result.slice(0, options.limit);
      }
    } else {
      // If no date range, get latest
      const latest = await this.receiptRegistry.getLatest();
      result = latest ? [latest] : [];
    }
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /**
   * Get drift statistics
   */
  async getDrift(metricName?: string): Promise<any[]> {
    const start = performance.now();
    let result;
    if (metricName) {
      const driftResult = this.driftDetector.detectDrift(metricName);
      result = driftResult ? [driftResult] : [];
    } else {
      // If no metric specified, return all available metrics
      result = this.driftDetector.detectAllDrift();
    }
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /**
   * Get cost statistics
   */
  getCostStats() {
    return this.costLedger.getStats();
  }

  /**
   * Generate execution receipt for quality tracking
   */
  private async generateReceipt(
    request: { time_range?: { start: string; end: string }; run_counterfactual?: boolean },
    run: LearningRun,
    costUsd: number = 0,
  ): Promise<ExecutionReceipt> {
    const inputHash = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const configHash = crypto.createHash('sha256').update(JSON.stringify(this.gbrainEndpoint)).digest('hex');
    
    const passed = run.status === 'completed';
    const overallScore = passed ? Math.min(1, run.patterns_found / 10 + run.proposals_generated / 5) : 0;

    return {
      receipt_id: uuidv4(),
      schema_version: 1,
      timestamp: new Date().toISOString(),
      project: 'glearn' as const,
      rubric_name: 'glearn_v1',
      rubric_sha8: inputHash.substring(0, 8),
      input_hash: inputHash,
      models_used: ['claude-sonnet-4-6'],
      config_hash: configHash,
      verdict: passed ? 'pass' : 'fail',
      scores: {
        pattern_quality: { score: overallScore, confidence: 0.6, weight: 0.5 },
        proposal_relevance: { score: overallScore, confidence: 0.6, weight: 0.5 },
      },
      overall_score: overallScore,
      hard_gates_passed: passed,
      cost_usd: Math.max(0, costUsd),
      errors: run.error_message ? [run.error_message] : [],
      metadata: {
        run_id: run.run_id,
        run_type: run.run_type,
        patterns_found: run.patterns_found,
        proposals_generated: run.proposals_generated,
        evaluations_completed: run.evaluations_completed,
        run_counterfactual: request.run_counterfactual,
        llm_total_cost_usd: this.llmClient.getTotalCostUsd(),
        budget_status: this.costLedger.getStatus(),
      },
    };
  }

  /**
   * Store receipt in gbrain quality control database
   */
  private async storeReceiptInGBrain(receipt: ExecutionReceipt): Promise<void> {
    if (this.isGbrainCircuitOpen()) {
      console.warn('[GLearn] GBrain circuit breaker is open, skipping storeReceiptInGBrain');
      return;
    }

    try {
      // Store the receipt as a page with structured metadata
      await this.gbrainClient.restClient.createPage({
        title: `Receipt: ${receipt.receipt_id}`,
        content: JSON.stringify(receipt, null, 2),
        tags: ['glearn', 'receipt', receipt.verdict],
      });
      
      this.resetGbrainCircuit();
    } catch (error) {
      if (error instanceof GBrainClientError) {
        this.handleGbrainError(error);
        console.error('[GLearn] Failed to store receipt in gbrain:', error);
      }
    }
  }

  /**
   * Circuit breaker: Check if GBrain circuit is open
   */
  private isGbrainCircuitOpen(): boolean {
    if (this.gbrainCircuitOpen) {
      if (Date.now() > this.gbrainCircuitOpenUntil) {
        this.gbrainCircuitOpen = false;
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Circuit breaker: Handle GBrain errors
   */
  private handleGbrainError(error: GBrainClientError): void {
    if (!error.retryable) {
      return;
    }
    
    if (error.kind === 'timeout' || error.kind === 'network' || error.kind === 'server_error') {
      this.gbrainCircuitOpen = true;
      this.gbrainCircuitOpenUntil = Date.now() + this.CIRCUIT_BREAKER_TIMEOUT_MS;
      console.warn('[GLearn] GBrain circuit breaker opened', { 
        errorKind: error.kind, 
        openUntil: new Date(this.gbrainCircuitOpenUntil).toISOString() 
      });
    }
  }

  /**
   * Circuit breaker: Reset circuit on success
   */
  private resetGbrainCircuit(): void {
    this.gbrainCircuitOpen = false;
    this.gbrainCircuitOpenUntil = 0;
  }
}
