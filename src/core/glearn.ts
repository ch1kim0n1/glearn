import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as fs from 'fs';
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
  ModelTier,
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
import { DriftDetector, DriftResult } from '../../../shared/src/core/drift-detector.js';
import { deriveReceiptVerdictFromDrift } from './drift-analysis.js';
import { LatencyTracker } from '../../../shared/src/core/latency-tracker.js';
import { AuditLogger } from '../../../shared/src/core/audit-logger.js';
import { StructuredLogger } from '../../../shared/src/observability/structured-logger.js';
import { createPersistenceManager, type PersistenceConfig } from '../../../shared/src/core/persistence-manager.js';
import { HealthCheckResult } from '../../../shared/src/health/health-checker.js';

interface PatternConsensusVote {
  tier: ModelTier;
  model_id: string;
  output: Pattern[];
  dimensions: Record<string, number>;
  disqualified: boolean;
  disqualification_reason?: string;
}

interface DimensionAgreement {
  participating_models: number;
  agreement: number;
  wilson_95_ci: { lower: number; upper: number };
  small_sample_note: boolean;
  values: Record<string, number>;
}

interface PatternConsensusSummary {
  agreed: boolean;
  decision: 'accept_tier1' | 'accept_tier2' | 'accept_tier3' | 'merge';
  reason: string;
  agreement_ratio: number;
  consensus_threshold: number;
  votes_required: number;
  valid_votes: number;
  tier3_invoked: boolean;
  early_stopped: boolean;
  small_sample_note: boolean;
  per_dimension_agreement: Record<string, DimensionAgreement>;
  votes: PatternConsensusVote[];
  final_output_count: number;
}

const CONSENSUS_DIMENSIONS = ['confidence', 'support', 'evidence', 'coverage'];

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
  private lastConsensusSummary?: PatternConsensusSummary;

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
    const persistedEscalationMetrics = this.persistenceDb.loadEscalationMetrics<EscalationMetrics>();
    if (persistedEscalationMetrics) {
      this.escalationMetrics = {
        ...this.escalationMetrics,
        ...persistedEscalationMetrics,
      };
    }
    const persistedPatterns = this.persistenceDb.getAllPatterns();
    const persistedDataStore = this.persistenceDb.getDataStoreEntries();
    if (persistedPatterns.length > 0 || persistedDataStore.length > 0) {
      this.patternMiner.hydrate(persistedPatterns, persistedDataStore);
    }
    
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
    this.persistenceDb.transaction(() => {
      this.persistenceDb.addLlmCall({
        id: reservation.id,
        model_id: modelId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        operation: 'learning_cycle_llm',
        metadata: {
          scope: 'learning_cycle',
          resolver: 'llm',
        },
      });
      this.persistenceDb.addCostEntry({
        id: reservation.id,
        operation: 'learning_cycle_llm',
        model_id: modelId,
        cost_usd: costUsd,
        metadata: {
          scope: 'learning_cycle',
          resolver: 'llm',
        },
      });
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
        proposals,
        escalationMetrics: this.escalationMetrics,
      }));
      this.persistenceDb.transaction(() => {
        this.persistenceDb.replacePatterns(this.patternMiner.getPatterns());
        this.persistenceDb.replaceProposals(proposals);
        this.persistenceDb.replaceDataStore(Array.from(this.patternMiner.getDataStore().entries()));
        this.persistenceDb.saveEscalationMetrics(this.escalationMetrics);
      });
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
      this.persistenceDb.saveEscalationMetrics(this.escalationMetrics);
    }

    this.latencyTracker.record(performance.now() - start);
    return run;
  }

  /**
   * Mine patterns with Tier 1/Tier 2 escalation based on confidence
   */
  private async minePatternsWithEscalation(): Promise<Pattern[]> {
    const votes: PatternConsensusVote[] = [];
    votes.push(await this.collectPatternVote('tier1'));

    if (!this.multiModelConfig.escalation_enabled) {
      const summary = this.evaluatePatternConsensus(votes, false, false);
      this.lastConsensusSummary = summary;
      return votes[0].output;
    }

    votes.push(await this.collectPatternVote('tier2'));
    let consensus = this.evaluatePatternConsensus(votes, false, false);

    if (consensus.agreed) {
      consensus = this.evaluatePatternConsensus(votes, false, true);
      this.lastConsensusSummary = consensus;
      this.escalationMetrics.consensus_agreement_rate = consensus.agreement_ratio;
      this.logger.info(`Consensus early-stop: ${consensus.reason}`);
      return this.resolveConsensusOutput(votes, consensus);
    }

    if (this.multiModelConfig.allow_tier3 && this.checkBudgetForTier3()) {
      this.logger.info('Tier 1/Tier 2 consensus failed, invoking Tier 3 for pattern consensus');
      votes.push(await this.collectPatternVote('tier3'));
    }

    consensus = this.evaluatePatternConsensus(votes, votes.length === 3, false);
    this.lastConsensusSummary = consensus;
    this.escalationMetrics.consensus_agreement_rate = consensus.agreement_ratio;
    this.logger.info(`Consensus decision: ${consensus.decision}, agreement: ${consensus.agreement_ratio.toFixed(2)}`);

    return this.resolveConsensusOutput(votes, consensus);
  }

  private async collectPatternVote(tier: ModelTier): Promise<PatternConsensusVote> {
    const tierConfig = this.tierConfigs.get(tier)!;
    this.logger.info(`Using ${tier}: ${tierConfig.name} for pattern mining`);

    try {
      const output = await this.patternMiner.minePatterns();
      return {
        tier,
        model_id: this.llmClient.getModelByTier(tier),
        output,
        dimensions: this.calculatePatternDimensions(output),
        disqualified: false,
      };
    } catch (error) {
      return {
        tier,
        model_id: this.llmClient.getModelByTier(tier),
        output: [],
        dimensions: {},
        disqualified: true,
        disqualification_reason: error instanceof Error ? error.message : String(error),
      };
    }
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
  private evaluatePatternConsensus(
    votes: PatternConsensusVote[],
    tier3Invoked: boolean,
    earlyStopped: boolean,
  ): PatternConsensusSummary {
    const validVotes = votes.filter(vote => this.isValidPatternVote(vote));
    const threshold = this.multiModelConfig.consensus_threshold;
    const votesRequired = validVotes.length >= 3 ? 2 : 2;

    let bestVote: PatternConsensusVote | undefined;
    let bestAgreementCount = 0;

    for (const vote of validVotes) {
      const agreementCount = validVotes.filter(other =>
        other === vote || this.calculateSimilarityScore(vote.output, other.output) >= threshold
      ).length;

      if (agreementCount > bestAgreementCount) {
        bestAgreementCount = agreementCount;
        bestVote = vote;
      }
    }

    const agreementRatio = validVotes.length > 0 ? bestAgreementCount / validVotes.length : 0;
    const agreed = bestAgreementCount >= votesRequired && bestVote !== undefined;
    const decision = agreed && bestVote
      ? (`accept_${bestVote.tier}` as PatternConsensusSummary['decision'])
      : 'merge';
    const reason = agreed && bestVote
      ? `${bestAgreementCount} of ${validVotes.length} valid model votes agreed at threshold ${threshold.toFixed(2)}`
      : `No two valid model votes reached consensus threshold ${threshold.toFixed(2)}; merged outputs`;
    const finalOutput = agreed && bestVote
      ? bestVote.output
      : validVotes.reduce<Pattern[]>((merged, vote) => this.mergeOutputs(merged, vote.output), []);

    return {
      agreed,
      decision,
      reason,
      agreement_ratio: agreementRatio,
      consensus_threshold: threshold,
      votes_required: votesRequired,
      valid_votes: validVotes.length,
      tier3_invoked: tier3Invoked,
      early_stopped: earlyStopped,
      small_sample_note: this.countPatterns(validVotes) < 30,
      per_dimension_agreement: this.calculateDimensionAgreement(validVotes),
      votes,
      final_output_count: finalOutput.length,
    };
  }

  private resolveConsensusOutput(
    votes: PatternConsensusVote[],
    consensus: Pick<PatternConsensusSummary, 'agreed' | 'decision'>,
  ): Pattern[] {
    const validVotes = votes.filter(vote => this.isValidPatternVote(vote));
    if (consensus.agreed) {
      const acceptedTier = consensus.decision.replace('accept_', '') as ModelTier;
      const acceptedVote = validVotes.find(vote => vote.tier === acceptedTier);
      if (acceptedVote) {
        return acceptedVote.output;
      }
    }

    return validVotes.reduce<Pattern[]>((merged, vote) => this.mergeOutputs(merged, vote.output), []);
  }

  private isValidPatternVote(vote: PatternConsensusVote): boolean {
    if (vote.disqualified) {
      return false;
    }

    const missingDimensions = CONSENSUS_DIMENSIONS.filter(dimension => vote.dimensions[dimension] === undefined);
    if (missingDimensions.length > 0) {
      vote.disqualified = true;
      vote.disqualification_reason = `missing dimensions: ${missingDimensions.join(', ')}`;
      return false;
    }

    return true;
  }

  private calculatePatternDimensions(patterns: Pattern[]): Record<string, number> {
    const avgConfidence = patterns.length > 0
      ? patterns.reduce((sum, pattern) => sum + pattern.confidence, 0) / patterns.length
      : 0;
    const totalObservations = patterns.reduce((sum, pattern) => sum + pattern.observation_count, 0);
    const totalEvidence = patterns.reduce((sum, pattern) => sum + pattern.evidence.length, 0);
    const sourceTools = new Set(patterns.flatMap(pattern => pattern.source_tools));

    return {
      confidence: this.clamp01(avgConfidence),
      support: this.clamp01(totalObservations / Math.max(30, patterns.length * 30)),
      evidence: this.clamp01(totalEvidence / Math.max(3, patterns.length * 3)),
      coverage: this.clamp01(sourceTools.size / 5),
    };
  }

  private calculateDimensionAgreement(votes: PatternConsensusVote[]): Record<string, DimensionAgreement> {
    const agreements: Record<string, DimensionAgreement> = {};
    const tolerance = 1 - this.multiModelConfig.consensus_threshold;

    for (const dimension of CONSENSUS_DIMENSIONS) {
      const values: number[] = [];
      const valuesByModel: Record<string, number> = {};

      for (const vote of votes) {
        const value = vote.dimensions[dimension];
        if (value !== undefined) {
          values.push(value);
          valuesByModel[vote.model_id] = value;
        }
      }

      if (values.length === 0) {
        agreements[dimension] = {
          participating_models: 0,
          agreement: 0,
          wilson_95_ci: this.wilson95(0, 0),
          small_sample_note: true,
          values: valuesByModel,
        };
        continue;
      }

      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const agreeing = values.filter(value => Math.abs(value - median) <= tolerance).length;
      agreements[dimension] = {
        participating_models: values.length,
        agreement: agreeing / values.length,
        wilson_95_ci: this.wilson95(agreeing, values.length),
        small_sample_note: values.length < 30,
        values: valuesByModel,
      };
    }

    return agreements;
  }

  private countPatterns(votes: PatternConsensusVote[]): number {
    return votes.reduce((sum, vote) => sum + vote.output.length, 0);
  }

  private wilson95(successes: number, total: number): { lower: number; upper: number } {
    if (total <= 0) {
      return { lower: 0, upper: 0 };
    }

    const z = 1.96;
    const phat = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = phat + (z * z) / (2 * total);
    const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);

    return {
      lower: this.clamp01((center - margin) / denominator),
      upper: this.clamp01((center + margin) / denominator),
    };
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

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

    const diagnostics = await Promise.all([
      this.checkLLMApiHealth(),
      this.checkSandboxHealth(),
      this.checkSyncFreshness(),
      this.checkSchemaVersion(),
      this.checkQueueHealth(),
      this.checkHealthTrend(),
      this.checkEvalCaptureFailures(),
    ]);
    results.push(...diagnostics);

    const healthScore = this.calculateHealthScore(results);
    results.push({
      service: 'health_score',
      healthy: healthScore >= 80,
      latency_ms: performance.now() - start,
      error: healthScore >= 80 ? undefined : `score=${healthScore}`,
      timestamp: new Date().toISOString(),
    });

    this.latencyTracker.record(performance.now() - start);
    return results;
  }

  private async checkLLMApiHealth(): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        });
        return this.result('llm_api', Boolean(response.id), start);
      }
      if (process.env.OPENAI_API_KEY) {
        const OpenAI = (await import('openai')).default;
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        });
        return this.result('llm_api', Boolean(response.id), start);
      }
      return this.result('llm_api', false, start, 'No LLM API key configured');
    } catch (error) {
      return this.result('llm_api', false, start, error instanceof Error ? error.message : 'LLM ping failed');
    }
  }

  private async checkSandboxHealth(): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      await promisify(exec)('docker --version', { timeout: 1000 });
      return this.result('sandbox', true, start);
    } catch (error) {
      return this.result('sandbox', false, start, error instanceof Error ? error.message : 'Sandbox unavailable');
    }
  }

  private async checkSyncFreshness(): Promise<HealthCheckResult> {
    const start = performance.now();
    const latestReceipt = await this.receiptRegistry.getLatest();
    const corpusPath = path.join(process.cwd(), '.gbrain-corpus');
    const timestamps = [
      latestReceipt ? new Date(latestReceipt.timestamp).getTime() : 0,
      fs.existsSync(corpusPath) ? fs.statSync(corpusPath).mtimeMs : 0,
    ].filter(value => value > 0);
    const newest = Math.max(0, ...timestamps);
    const ageMs = newest > 0 ? Date.now() - newest : Number.POSITIVE_INFINITY;
    return this.result(
      'sync_freshness',
      Number.isFinite(ageMs) && ageMs <= 24 * 60 * 60 * 1000,
      start,
      Number.isFinite(ageMs) ? `age_ms=${Math.round(ageMs)}` : 'No sync artifacts or receipts found',
    );
  }

  private async checkSchemaVersion(): Promise<HealthCheckResult> {
    const start = performance.now();
    const latestReceipt = await this.receiptRegistry.getLatest();
    const healthy = !latestReceipt || latestReceipt.schema_version === 1;
    return this.result('schema_version', healthy, start, healthy ? undefined : `receipt_schema=${latestReceipt?.schema_version}`);
  }

  private async checkQueueHealth(): Promise<HealthCheckResult> {
    const start = performance.now();
    const memory = process.memoryUsage();
    const heapRatio = memory.heapTotal > 0 ? memory.heapUsed / memory.heapTotal : 0;
    return this.result('queue_health', heapRatio < 0.9, start, `pending=0 heap_ratio=${heapRatio.toFixed(3)}`);
  }

  private async checkHealthTrend(): Promise<HealthCheckResult> {
    const start = performance.now();
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [day, week] = await Promise.all([
      this.receiptRegistry.getAllBetween(dayAgo, now),
      this.receiptRegistry.getAllBetween(weekAgo, now),
    ]);
    const passRate = (receipts: any[]) => receipts.length === 0 ? 1 : receipts.filter(receipt => receipt.hard_gates_passed && receipt.verdict !== 'fail').length / receipts.length;
    const dayRate = passRate(day);
    const weekRate = passRate(week);
    return this.result(
      'health_trend',
      dayRate >= Math.max(0.5, weekRate - 0.15),
      start,
      `pass_rate_24h=${dayRate.toFixed(3)} pass_rate_7d=${weekRate.toFixed(3)} receipts_24h=${day.length} receipts_7d=${week.length}`,
    );
  }

  private async checkEvalCaptureFailures(): Promise<HealthCheckResult> {
    const start = performance.now();
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const receipts = await this.receiptRegistry.getAllBetween(dayAgo, now);
    const failures = receipts.filter((receipt: any) =>
      receipt.metadata?.eval_capture_failed ||
      receipt.metadata?.eval_capture?.status === 'failed' ||
      (receipt.errors ?? []).some((error: string) => /eval[_ -]?capture/i.test(error)),
    );
    return this.result('eval_capture', failures.length === 0, start, `failures_24h=${failures.length}`);
  }

  private calculateHealthScore(results: HealthCheckResult[]): number {
    const weights: Record<string, number> = {
      gbrain: 15,
      gstack: 10,
      gorchestrator: 10,
      gmirror: 10,
      gtom: 10,
      llm_api: 10,
      sandbox: 5,
      sync_freshness: 10,
      schema_version: 10,
      queue_health: 5,
      health_trend: 10,
      eval_capture: 5,
    };
    let earned = 0;
    let total = 0;
    for (const result of results) {
      const weight = weights[result.service] ?? 2;
      total += weight;
      if (result.healthy) {
        const latencyPenalty = result.latency_ms > 2000 ? 0.75 : result.latency_ms > 500 ? 0.9 : 1;
        earned += weight * latencyPenalty;
      }
    }
    return total === 0 ? 0 : Math.round((earned / total) * 100);
  }

  private result(service: string, healthy: boolean, start: number, error?: string): HealthCheckResult {
    return {
      service,
      healthy,
      latency_ms: performance.now() - start,
      error: healthy ? undefined : error,
      timestamp: new Date().toISOString(),
    };
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
    const consensusModels = this.lastConsensusSummary?.votes.map(vote => vote.model_id) || [];
    const modelList = consensusModels.length > 0 ? Array.from(new Set(consensusModels)) : ['claude-sonnet-4-6'];
    const validVotes = this.lastConsensusSummary?.valid_votes || 0;
    const agreeingVotes = Math.round((this.lastConsensusSummary?.agreement_ratio || 0) * validVotes);
    const verdictInterval = this.wilson95(agreeingVotes, validVotes);
    const consensusConfidence = this.lastConsensusSummary?.agreement_ratio ?? 0.6;
    const driftResults = this.recordRunDriftMetrics(run, overallScore, costUsd);
    const receiptVerdict = deriveReceiptVerdictFromDrift(passed, driftResults);

    return {
      receipt_id: uuidv4(),
      schema_version: 1,
      timestamp: new Date().toISOString(),
      project: 'glearn' as const,
      rubric_name: 'glearn_v1',
      rubric_sha8: inputHash.substring(0, 8),
      input_hash: inputHash,
      models_used: modelList,
      config_hash: configHash,
      verdict: receiptVerdict,
      scores: {
        pattern_quality: { score: overallScore, confidence: consensusConfidence, weight: 0.5 },
        proposal_relevance: { score: overallScore, confidence: consensusConfidence, weight: 0.5 },
      },
      overall_score: overallScore,
      hard_gates_passed: passed && receiptVerdict !== 'risky',
      cost_usd: Math.max(0, costUsd),
      errors: run.error_message ? [run.error_message] : [],
      metadata: {
        run_id: run.run_id,
        run_type: run.run_type,
        patterns_found: run.patterns_found,
        proposals_generated: run.proposals_generated,
        evaluations_completed: run.evaluations_completed,
        run_counterfactual: request.run_counterfactual,
        consensus: this.lastConsensusSummary,
        verdict_wilson_95_ci: verdictInterval,
        drift_detected: driftResults.some(result => result.drift_detected),
        drift_results: driftResults,
        small_sample_note: (run.patterns_found + run.proposals_generated + run.evaluations_completed) < 30,
        llm_total_cost_usd: this.llmClient.getTotalCostUsd(),
        budget_status: this.costLedger.getStatus(),
      },
    };
  }

  private recordRunDriftMetrics(run: LearningRun, overallScore: number, costUsd: number): DriftResult[] {
    const context = {
      run_id: run.run_id,
      run_type: run.run_type,
      status: run.status,
    };
    const metrics: Record<string, number> = {
      patterns_found: run.patterns_found,
      proposals_generated: run.proposals_generated,
      evaluations_completed: run.evaluations_completed,
      overall_score: overallScore,
      cost_usd: Math.max(0, costUsd),
    };

    for (const [metric, value] of Object.entries(metrics)) {
      if (Number.isFinite(value)) {
        this.driftDetector.recordSnapshot(metric, value, context);
      }
    }

    return this.driftDetector.detectAllDrift();
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
