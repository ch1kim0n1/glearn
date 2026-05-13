import { v4 as uuidv4 } from 'uuid';
import {
  CounterfactualEvaluation,
  Proposal,
} from '../types/index.js';

/**
 * Counterfactual Evaluator
 * 
 * Responsibilities:
 * - Evaluate proposals using counterfactual analysis
 * - Compare baseline vs counterfactual metrics
 * - Calculate statistical significance
 * - Provide apply/ignore recommendations
 */
export class CounterfactualEvaluator {
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
}
