import { v4 as uuidv4 } from 'uuid';
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
} from '../types/index.js';
import { PatternMiner } from './pattern-miner.js';
import { ProposalGenerator } from './proposal-generator.js';
import { CounterfactualEvaluator } from './counterfactual.js';

/**
 * Main GLearn
 * 
 * Ties together all components:
 * - Data ingestion from all tools
 * - Pattern mining
 * - Proposal generation
 * - Counterfactual evaluation
 * - Human-in-loop approval
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

  constructor(config: {
    gbrainEndpoint?: string;
    gstackEndpoint?: string;
    gorchestratorEndpoint?: string;
    gmirrorEndpoint?: string;
    gtomEndpoint?: string;
  } = {}) {
    this.gbrainEndpoint = config.gbrainEndpoint || 'http://localhost:3000';
    this.gstackEndpoint = config.gstackEndpoint || 'http://localhost:3001';
    this.gorchestratorEndpoint = config.gorchestratorEndpoint || 'http://localhost:3001';
    this.gmirrorEndpoint = config.gmirrorEndpoint || 'http://localhost:3002';
    this.gtomEndpoint = config.gtomEndpoint || 'http://localhost:3003';

    this.patternMiner = new PatternMiner();
    this.proposalGenerator = new ProposalGenerator();
    this.counterfactualEvaluator = new CounterfactualEvaluator();
  }

  /**
   * Run a learning cycle
   */
  async runLearningCycle(request: {
    time_range?: { start: string; end: string };
    run_counterfactual?: boolean;
  } = {}): Promise<LearningRun> {
    const runId = uuidv4();
    const startTime = Date.now();

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
      console.log('[GLearn] Phase 1: Ingesting data');
      await this.ingestDataFromAllTools(request.time_range);

      // Phase 2: Mine patterns
      console.log('[GLearn] Phase 2: Mining patterns');
      const patterns = await this.patternMiner.minePatterns();
      run.patterns_found = patterns.length;

      // Phase 3: Generate proposals
      console.log('[GLearn] Phase 3: Generating proposals');
      const proposals = this.proposalGenerator.generateProposals(patterns);
      run.proposals_generated = proposals.length;

      // Phase 4: Counterfactual evaluation (if requested)
      if (request.run_counterfactual) {
        console.log('[GLearn] Phase 4: Counterfactual evaluation');
        const baselineMetrics = this.extractBaselineMetrics();
        const evaluations = await this.counterfactualEvaluator.batchEvaluate(
          proposals,
          baselineMetrics
        );
        run.evaluations_completed = evaluations.length;
      }

      run.status = 'completed';
      run.completed_at = new Date().toISOString();

      console.log(`[GLearn] Learning cycle complete: ${run.patterns_found} patterns, ${run.proposals_generated} proposals`);
    } catch (error) {
      run.status = 'failed';
      run.error_message = error instanceof Error ? error.message : String(error);
      run.completed_at = new Date().toISOString();
      console.error('[GLearn] Learning cycle failed:', error);
    }

    return run;
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
  getProposals(patterns: Pattern[]): Proposal[] {
    return this.proposalGenerator.generateProposals(patterns);
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
    return await this.proposalGenerator.applyProposal(proposalId);
  }

  /**
   * Rollback a proposal
   */
  async rollbackProposal(proposalId: string): Promise<boolean> {
    return await this.proposalGenerator.rollbackProposal(proposalId);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    components: {
      pattern_miner: 'ok' | 'error';
      proposal_generator: 'ok' | 'error';
      counterfactual_evaluator: 'ok' | 'error';
      gbrain: 'ok' | 'error';
      gstack: 'ok' | 'error';
      gorchestrator: 'ok' | 'error';
      gmirror: 'ok' | 'error';
      gtom: 'ok' | 'error';
    };
  }> {
    const checks = {
      pattern_miner: 'ok' as const,
      proposal_generator: 'ok' as const,
      counterfactual_evaluator: 'ok' as const,
      gbrain: await this.checkEndpoint(this.gbrainEndpoint),
      gstack: await this.checkEndpoint(this.gstackEndpoint),
      gorchestrator: await this.checkEndpoint(this.gorchestratorEndpoint),
      gmirror: await this.checkEndpoint(this.gmirrorEndpoint),
      gtom: await this.checkEndpoint(this.gtomEndpoint),
    };

    const errorCount = Object.values(checks).filter(v => v === 'error').length;
    const status = errorCount === 0 ? 'healthy' : errorCount < 4 ? 'degraded' : 'unhealthy';

    return { status, components: checks };
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
}
