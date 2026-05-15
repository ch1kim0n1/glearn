import { v4 as uuidv4 } from 'uuid';
import {
  CounterfactualEvaluation,
  Proposal,
} from '../types/index.js';
import { LLMClient } from './llm-client.js';
import { coreLogger } from './observability.js';

/**
 * Counterfactual Evaluator
 *
 * Responsibilities:
 * - Evaluate proposals using counterfactual analysis
 * - Compare baseline vs counterfactual metrics
 * - Calculate statistical significance using LLM causal reasoning
 * - Provide apply/ignore recommendations
 */
export class CounterfactualEvaluator {
  private llmClient: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient || new LLMClient();
  }

  /**
   * Evaluate a proposal using counterfactual analysis
   */
  async evaluateProposal(
    proposal: Proposal,
    baselineMetrics: Record<string, number>,
    counterfactualMetrics: Record<string, number>
  ): Promise<CounterfactualEvaluation> {
    const delta: Record<string, number> = {};

    for (const key of Object.keys(baselineMetrics)) {
      const baseline = baselineMetrics[key];
      const counterfactual = counterfactualMetrics[key] || baseline;
      delta[key] = counterfactual - baseline;
    }

    try {
      const { significance, conclusion, recommendation, reasoning } = await this.evaluateWithLLM(
        proposal,
        baselineMetrics,
        counterfactualMetrics,
        delta
      );

      return {
        evaluation_id: uuidv4(),
        proposal_id: proposal.proposal_id,
        baseline_metrics: baselineMetrics,
        counterfactual_metrics: counterfactualMetrics,
        delta,
        statistical_significance: significance,
        conclusion,
        recommendation,
        reasoning,
        evaluated_at: new Date().toISOString(),
      };
    } catch (error) {
      coreLogger.warn('Counterfactual LLM evaluation failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.fallbackEvaluation(proposal, baselineMetrics, counterfactualMetrics, delta);
    }
  }

  /**
   * Calculate statistical significance
   */
  private calculateSignificance(
    delta: Record<string, number>,
    baseline: Record<string, number>
  ): number {
    // Simplified significance calculation
    // In production, would use proper statistical tests
    
    let totalSignificance = 0;
    let count = 0;
    
    for (const key of Object.keys(delta)) {
      const relativeChange = Math.abs(delta[key] / (baseline[key] || 1));
      totalSignificance += Math.min(1, relativeChange * 2);
      count++;
    }
    
    return count > 0 ? totalSignificance / count : 0;
  }

  /**
   * Determine conclusion (positive, neutral, negative)
   */
  private determineConclusion(
    delta: Record<string, number>,
    significance: number
  ): CounterfactualEvaluation['conclusion'] {
    if (significance < 0.3) {
      return 'neutral';
    }
    
    let positiveCount = 0;
    let negativeCount = 0;
    
    for (const value of Object.values(delta)) {
      if (value > 0) positiveCount++;
      else if (value < 0) negativeCount++;
    }
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * Determine recommendation
   */
  private determineRecommendation(
    conclusion: CounterfactualEvaluation['conclusion'],
    significance: number
  ): CounterfactualEvaluation['recommendation'] {
    if (conclusion === 'positive' && significance > 0.5) {
      return 'apply';
    }
    if (conclusion === 'negative' && significance > 0.5) {
      return 'ignore';
    }
    return 'needs_more_data';
  }

  /**
   * Run batch evaluation on multiple proposals
   */
  async batchEvaluate(
    proposals: Proposal[],
    baselineMetrics: Record<string, number>
  ): Promise<CounterfactualEvaluation[]> {
    const evaluations: CounterfactualEvaluation[] = [];
    
    for (const proposal of proposals) {
      // Simulate counterfactual metrics
      const counterfactualMetrics = this.simulateCounterfactualMetrics(
        baselineMetrics,
        proposal
      );
      
      const evaluation = await this.evaluateProposal(
        proposal,
        baselineMetrics,
        counterfactualMetrics
      );
      
      evaluations.push(evaluation);
    }
    
    return evaluations;
  }

  /**
   * Simulate counterfactual metrics
   */
  private simulateCounterfactualMetrics(
    baseline: Record<string, number>,
    proposal: Proposal
  ): Record<string, number> {
    const counterfactual: Record<string, number> = { ...baseline };

    // Apply expected impact to metrics
    const improvement = proposal.expected_impact.improvement;

    for (const key of Object.keys(counterfactual)) {
      if (key.includes('cost') || key.includes('error')) {
        counterfactual[key] *= (1 - improvement * 0.3);
      } else if (key.includes('success') || key.includes('score')) {
        counterfactual[key] *= (1 + improvement * 0.2);
      }
    }

    return counterfactual;
  }

  /**
   * Evaluate using LLM causal reasoning
   */
  private async evaluateWithLLM(
    proposal: Proposal,
    baselineMetrics: Record<string, number>,
    counterfactualMetrics: Record<string, number>,
    delta: Record<string, number>
  ): Promise<{
    significance: number;
    conclusion: CounterfactualEvaluation['conclusion'];
    recommendation: CounterfactualEvaluation['recommendation'];
    reasoning: string;
  }> {
    const prompt = this.buildEvaluationPrompt(proposal, baselineMetrics, counterfactualMetrics, delta);
    const result = await this.llmClient.call(prompt, {
      model: this.llmClient.getModelByTier('tier1'),
      maxTokens: 512,
      temperature: 0.3,
    });

    const parsed = JSON.parse(result.content);
    // Require all causal-reasoning fields to be present; otherwise let the caller
    // fall back to the deterministic heuristic. Prevents the simulator's generic
    // {action, confidence} response from short-circuiting real reasoning.
    const validConclusions = ['positive', 'negative', 'neutral'];
    const validRecommendations = ['apply', 'ignore', 'needs_more_data'];
    if (
      typeof parsed.significance !== 'number' ||
      typeof parsed.conclusion !== 'string' ||
      typeof parsed.recommendation !== 'string' ||
      !validConclusions.includes(parsed.conclusion) ||
      !validRecommendations.includes(parsed.recommendation)
    ) {
      throw new Error('LLM response missing required causal-reasoning fields');
    }
    return {
      significance: Math.max(0, Math.min(1, parsed.significance)),
      conclusion: parsed.conclusion,
      recommendation: parsed.recommendation,
      reasoning: parsed.reasoning || 'LLM evaluation completed',
    };
  }

  /**
   * Build prompt for LLM evaluation
   */
  private buildEvaluationPrompt(
    proposal: Proposal,
    baselineMetrics: Record<string, number>,
    counterfactualMetrics: Record<string, number>,
    delta: Record<string, number>
  ): string {
    return `Evaluate the following proposal using causal reasoning:

PROPOSAL:
Type: ${proposal.proposal_type}
Rationale: ${proposal.rationale}
Expected Improvement: ${proposal.expected_impact.improvement.toFixed(3)}
Confidence: ${proposal.expected_impact.confidence.toFixed(3)}

BASELINE METRICS:
${JSON.stringify(baselineMetrics, null, 2)}

COUNTERFACTUAL METRICS:
${JSON.stringify(counterfactualMetrics, null, 2)}

DELTA:
${JSON.stringify(delta, null, 2)}

Analyze the causal relationship between the proposed change and the metric changes. Return a JSON object:
{
  "significance": <0-1 number indicating statistical significance>,
  "conclusion": "positive" | "negative" | "neutral",
  "recommendation": "apply" | "ignore" | "needs_more_data",
  "reasoning": "<brief causal explanation>"
}`;
  }

  /**
   * Fallback evaluation using heuristic methods
   */
  private fallbackEvaluation(
    proposal: Proposal,
    baselineMetrics: Record<string, number>,
    counterfactualMetrics: Record<string, number>,
    delta: Record<string, number>
  ): CounterfactualEvaluation {
    const significance = this.calculateSignificance(delta, baselineMetrics);
    const conclusion = this.determineConclusion(delta, significance);
    const recommendation = this.determineRecommendation(conclusion, significance);

    return {
      evaluation_id: uuidv4(),
      proposal_id: proposal.proposal_id,
      baseline_metrics: baselineMetrics,
      counterfactual_metrics: counterfactualMetrics,
      delta,
      statistical_significance: significance,
      conclusion,
      recommendation,
      evaluated_at: new Date().toISOString(),
    };
  }
}
