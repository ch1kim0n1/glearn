import { v4 as uuidv4 } from 'uuid';
import {
  Pattern,
  Proposal,
  RelationalProposal,
  GOrchestratorData,
  GMirrorData,
  GStackData,
} from '../types/index.js';
import { LLMClient } from './llm-client.js';
import { LocalLogger, type LogLevel } from './observability.js';

/**
 * A Pattern restricted to DYAD relational pattern types.
 */
export type DyadPattern = Pattern & {
  pattern_type: 'bid_cycle' | 'repair_window' | 'labor_drift';
};

/**
 * Proposal Generator
 * 
 * Responsibilities:
 * - Generate proposals from patterns
 * - Assess risk of proposals
 * - Calculate expected impact
 * - Require human approval for application
 */
export class ProposalGenerator {
  private llmClient: LLMClient;
  private logger: LocalLogger;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient || new LLMClient();
    this.logger = new LocalLogger('glearn-proposal-generator', (process.env.GLEARN_LOG_LEVEL as LogLevel) || 'INFO');
  }

  /**
   * Generate proposals from patterns
   */
  async generateProposals(patterns: Pattern[]): Promise<Proposal[]> {
    const proposals: Proposal[] = [];

    for (const pattern of patterns) {
      const proposal = await this.generateProposalFromPattern(pattern);
      if (proposal) {
        proposals.push(proposal);
      }
    }

    return proposals;
  }

  /**
   * Generate a proposal from a pattern
   */
  private async generateProposalFromPattern(pattern: Pattern): Promise<Proposal | null> {
    switch (pattern.pattern_type) {
      case 'configuration_optimization':
        return await this.generateConfigProposal(pattern);
      case 'coverage_gap':
        return await this.generateCoverageProposal(pattern);
      case 'drift_detection':
        return await this.generateDriftProposal(pattern);
      case 'cross_tool_correlation':
        return await this.generateCorrelationProposal(pattern);
      default:
        return null;
    }
  }

  /**
   * Generate configuration optimization proposal
   */
  private async generateConfigProposal(pattern: Pattern): Promise<Proposal | null> {
    if (!pattern.metadata?.config) return null;

    try {
      const fallback: Proposal = {
        proposal_id: uuidv4(),
        proposal_type: 'configuration_change',
        target_tool: 'GOrchestrator',
        target_component: pattern.metadata.config,
        current_value: pattern.metadata.metrics,
        proposed_value: {
          max_parallelism: 3,
          budget_multiplier: 0.8,
        },
        rationale: `Configuration ${pattern.metadata.config} is expensive relative to its observed success rate.`,
        expected_impact: {
          improvement: 0.3,
          confidence: pattern.confidence,
          evidence_count: pattern.observation_count,
        },
        risk_assessment: {
          risk_level: 'medium',
          potential_side_effects: [
            'May increase total wall time',
            'May reduce exploration diversity',
          ],
          rollback_plan: 'Revert to original configuration if success rate drops below 70%',
        },
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      return await this.generateLLMProposalHypothesis(pattern, fallback);
    } catch (error) {
      this.logger.warn('LLM proposal generation failed, using fallback', { error: error instanceof Error ? error.message : String(error) });
      return this.fallbackConfigProposal(pattern);
    }
  }

  /**
   * Generate coverage gap proposal
   */
  private async generateCoverageProposal(pattern: Pattern): Promise<Proposal> {
    const targetTool = pattern.source_tools[0] as Proposal['target_tool'];

    try {
      const fallback: Proposal = {
        proposal_id: uuidv4(),
        proposal_type: 'library_expansion',
        target_tool: targetTool,
        target_component: 'test_library',
        current_value: 'current_coverage',
        proposed_value: 'expanded_coverage',
        rationale: pattern.description,
        expected_impact: {
          improvement: 0.4,
          confidence: pattern.confidence,
          evidence_count: pattern.observation_count,
        },
        risk_assessment: {
          risk_level: 'low',
          potential_side_effects: [
            'Increased test execution time',
            'Higher computational cost',
          ],
          rollback_plan: 'Remove new test scenarios if they cause false positives',
        },
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      return await this.generateLLMProposalHypothesis(pattern, fallback);
    } catch (error) {
      this.logger.warn('LLM proposal generation failed, using fallback', { error: error instanceof Error ? error.message : String(error) });
      return {
        proposal_id: uuidv4(),
        proposal_type: 'library_expansion',
        target_tool: targetTool,
        target_component: 'test_library',
        current_value: 'current_coverage',
        proposed_value: 'expanded_coverage',
        rationale: pattern.description,
        expected_impact: {
          improvement: 0.4,
          confidence: pattern.confidence,
          evidence_count: pattern.observation_count,
        },
        risk_assessment: {
          risk_level: 'low',
          potential_side_effects: [
            'Increased test execution time',
            'Higher computational cost',
          ],
          rollback_plan: 'Remove new test scenarios if they cause false positives',
        },
        status: 'pending',
        created_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Generate drift proposal
   */
  private async generateDriftProposal(pattern: Pattern): Promise<Proposal> {
    const targetTool = pattern.source_tools[0] as Proposal['target_tool'];

    try {
      const fallback: Proposal = {
        proposal_id: uuidv4(),
        proposal_type: 'calibration_adjustment',
        target_tool: targetTool,
        target_component: 'calibration_weights',
        current_value: 'current_weights',
        proposed_value: 'recalibrated_weights',
        rationale: `Drift detected in ${targetTool}. Recalibration may restore expected behavior.`,
        expected_impact: {
          improvement: 0.5,
          confidence: pattern.confidence,
          evidence_count: pattern.observation_count,
        },
        risk_assessment: {
          risk_level: 'medium',
          potential_side_effects: [
            'May temporarily reduce accuracy',
            'Requires validation period',
          ],
          rollback_plan: 'Revert to previous calibration if performance degrades',
        },
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      return await this.generateLLMProposalHypothesis(pattern, fallback);
    } catch (error) {
      this.logger.warn('LLM proposal generation failed, using fallback', { error: error instanceof Error ? error.message : String(error) });
      return {
        proposal_id: uuidv4(),
        proposal_type: 'calibration_adjustment',
        target_tool: targetTool,
        target_component: 'calibration_weights',
        current_value: 'current_weights',
        proposed_value: 'recalibrated_weights',
        rationale: `Drift detected in ${targetTool}. Recalibration may restore expected behavior.`,
        expected_impact: {
          improvement: 0.5,
          confidence: pattern.confidence,
          evidence_count: pattern.observation_count,
        },
        risk_assessment: {
          risk_level: 'medium',
          potential_side_effects: [
            'May temporarily reduce accuracy',
            'Requires validation period',
          ],
          rollback_plan: 'Revert to previous calibration if performance degrades',
        },
        status: 'pending',
        created_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Generate correlation proposal
   */
  private async generateCorrelationProposal(pattern: Pattern): Promise<Proposal> {
    try {
      const fallback: Proposal = {
        proposal_id: uuidv4(),
        proposal_type: 'workflow_optimization',
        target_tool: 'GAgent' as Proposal['target_tool'],
        target_component: 'pipeline_flow',
        current_value: 'current_pipeline',
        proposed_value: 'optimized_pipeline',
        rationale: pattern.description,
        expected_impact: {
          improvement: 0.35,
          confidence: pattern.confidence,
          evidence_count: pattern.observation_count,
        },
        risk_assessment: {
          risk_level: 'medium',
          potential_side_effects: [
            'May require pipeline reconfiguration',
            'May affect existing workflows',
          ],
          rollback_plan: 'Revert to previous pipeline configuration',
        },
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      return await this.generateLLMProposalHypothesis(pattern, fallback);
    } catch (error) {
      this.logger.warn('LLM proposal generation failed, using fallback', { error: error instanceof Error ? error.message : String(error) });
      return {
        proposal_id: uuidv4(),
        proposal_type: 'workflow_optimization',
        target_tool: 'GAgent' as Proposal['target_tool'],
        target_component: 'pipeline_flow',
        current_value: 'current_pipeline',
        proposed_value: 'optimized_pipeline',
        rationale: pattern.description,
        expected_impact: {
          improvement: 0.35,
          confidence: pattern.confidence,
          evidence_count: pattern.observation_count,
        },
        risk_assessment: {
          risk_level: 'medium',
          potential_side_effects: [
            'May require pipeline reconfiguration',
            'May affect existing workflows',
          ],
          rollback_plan: 'Revert to previous pipeline configuration',
        },
        status: 'pending',
        created_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Approve a proposal
   */
  approveProposal(proposalId: string, reviewer: string): Proposal | null {
    // In production, would update persistent storage
    // For MVP, return mock approved proposal
    return {
      proposal_id: proposalId,
      proposal_type: 'configuration_change',
      target_tool: 'GOrchestrator',
      target_component: 'test',
      current_value: {},
      proposed_value: {},
      rationale: '',
      expected_impact: {
        improvement: 0.5,
        confidence: 0.8,
        evidence_count: 10,
      },
      risk_assessment: {
        risk_level: 'low',
        potential_side_effects: [],
        rollback_plan: '',
      },
      status: 'approved',
      created_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer,
    };
  }

  /**
   * Reject a proposal
   */
  rejectProposal(proposalId: string, reviewer: string): Proposal | null {
    // In production, would update persistent storage
    // For MVP, return mock rejected proposal
    return {
      proposal_id: proposalId,
      proposal_type: 'configuration_change',
      target_tool: 'GOrchestrator',
      target_component: 'test',
      current_value: {},
      proposed_value: {},
      rationale: '',
      expected_impact: {
        improvement: 0.5,
        confidence: 0.8,
        evidence_count: 10,
      },
      risk_assessment: {
        risk_level: 'low',
        potential_side_effects: [],
        rollback_plan: '',
      },
      status: 'rejected',
      created_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer,
    };
  }

  /**
   * Apply a proposal
   */
  async applyProposal(proposalId: string): Promise<boolean> {
    // In production, would integrate with tool APIs to apply changes
    this.logger.info(`Applying proposal: ${proposalId}`);
    return true;
  }

  /**
   * Rollback a proposal
   */
  async rollbackProposal(proposalId: string): Promise<boolean> {
    // In production, would integrate with tool APIs to rollback changes
    this.logger.info(`Rolling back proposal: ${proposalId}`);
    return true;
  }

  /**
   * Generate the concrete hypothesis, proposed value, impact, and risk model
   * with an LLM while preserving schema invariants and safe fallback defaults.
   */
  private async generateLLMProposalHypothesis(pattern: Pattern, fallback: Proposal): Promise<Proposal> {
    const prompt = this.buildProposalHypothesisPrompt(pattern, fallback);
    const result = await this.llmClient.call(prompt, {
      model: this.llmClient.getModelByTier('tier1'),
      maxTokens: 768,
      temperature: 0.4,
    });

    const parsed = JSON.parse(this.extractJsonObject(result.content));
    return this.normalizeLLMProposal(parsed, fallback);
  }

  private buildProposalHypothesisPrompt(pattern: Pattern, fallback: Proposal): string {
    return `Generate a production proposal hypothesis from this GLearn pattern.

Pattern:
${JSON.stringify({
  pattern_type: pattern.pattern_type,
  description: pattern.description,
  confidence: pattern.confidence,
  evidence: pattern.evidence,
  source_tools: pattern.source_tools,
  observation_count: pattern.observation_count,
  metadata: pattern.metadata,
}, null, 2)}

Fixed proposal fields:
${JSON.stringify({
  proposal_type: fallback.proposal_type,
  target_tool: fallback.target_tool,
  status: fallback.status,
}, null, 2)}

Return strict JSON with these fields:
{
  "target_component": "specific component to change",
  "current_value": "current state or object",
  "proposed_value": "specific proposed state or object",
  "rationale": "causal hypothesis grounded in the evidence",
  "expected_impact": { "improvement": 0.0, "confidence": 0.0 },
  "risk_assessment": {
    "risk_level": "low" | "medium" | "high",
    "potential_side_effects": ["side effect"],
    "rollback_plan": "concrete rollback plan"
  }
}`;
  }

  private normalizeLLMProposal(parsed: any, fallback: Proposal): Proposal {
    const risk = parsed?.risk_assessment || {};
    const expectedImpact = parsed?.expected_impact || {};
    const sideEffects = Array.isArray(risk.potential_side_effects)
      ? risk.potential_side_effects.filter((item: unknown) => typeof item === 'string' && item.trim())
      : fallback.risk_assessment.potential_side_effects;

    return {
      ...fallback,
      target_component: typeof parsed?.target_component === 'string' && parsed.target_component.trim()
        ? parsed.target_component.trim()
        : fallback.target_component,
      current_value: Object.prototype.hasOwnProperty.call(parsed || {}, 'current_value')
        ? parsed.current_value
        : fallback.current_value,
      proposed_value: Object.prototype.hasOwnProperty.call(parsed || {}, 'proposed_value')
        ? parsed.proposed_value
        : fallback.proposed_value,
      rationale: typeof parsed?.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : fallback.rationale,
      expected_impact: {
        improvement: this.clampNumber(expectedImpact.improvement, fallback.expected_impact.improvement),
        confidence: this.clampNumber(expectedImpact.confidence, fallback.expected_impact.confidence),
        evidence_count: fallback.expected_impact.evidence_count,
      },
      risk_assessment: {
        risk_level: this.normalizeRiskLevel(risk.risk_level, fallback.risk_assessment.risk_level),
        potential_side_effects: sideEffects.length > 0
          ? sideEffects
          : fallback.risk_assessment.potential_side_effects,
        rollback_plan: typeof risk.rollback_plan === 'string' && risk.rollback_plan.trim()
          ? risk.rollback_plan.trim()
          : fallback.risk_assessment.rollback_plan,
      },
    };
  }

  private extractJsonObject(content: string): string {
    const trimmed = content.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    return trimmed;
  }

  private clampNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : fallback;
  }

  private normalizeRiskLevel(value: unknown, fallback: Proposal['risk_assessment']['risk_level']): Proposal['risk_assessment']['risk_level'] {
    return value === 'low' || value === 'medium' || value === 'high' ? value : fallback;
  }

  /**
   * Generate LLM-driven rationale for a proposal
   */
  private async generateLLMRationale(pattern: Pattern, proposalType: string): Promise<string> {
    const prompt = this.buildRationalePrompt(pattern, proposalType);
    const result = await this.llmClient.call(prompt, {
      model: this.llmClient.getModelByTier('tier1'),
      maxTokens: 256,
      temperature: 0.5,
    });

    return result.content.trim();
  }

  /**
   * Build prompt for rationale generation
   */
  private buildRationalePrompt(pattern: Pattern, proposalType: string): string {
    return `Generate a concise technical rationale for a ${proposalType} proposal based on the following pattern:

Pattern Type: ${pattern.pattern_type}
Description: ${pattern.description}
Confidence: ${pattern.confidence.toFixed(3)}
Evidence: ${pattern.evidence.join(', ')}
Source Tools: ${pattern.source_tools.join(', ')}

Return only the rationale, no additional text.`;
  }

  /**
   * Generate relational proposals from DYAD-specific patterns.
   * Uses deterministic templates — no LLM call.
   */
  async generateRelationalProposals(patterns: DyadPattern[]): Promise<RelationalProposal[]> {
    const insightTemplates: Record<DyadPattern['pattern_type'], {
      insight_type: RelationalProposal['insight_type'];
      insight: string;
      grounding: string[];
    }> = {
      bid_cycle: {
        insight_type: 'bid_pattern',
        insight: 'One participant is initiating connection significantly more often than the other is responding. This asymmetry often predicts disconnection if unaddressed (Gottman, 1994).',
        grounding: [
          'Gottman (1994): bid responsiveness and relationship satisfaction',
          'Johnson (EFT): attachment bids and responsiveness',
        ],
      },
      repair_window: {
        insight_type: 'repair_opportunity',
        insight: 'Repair attempts appear to succeed within a predictable window after conflict. Protecting this window may make repair more accessible.',
        grounding: [
          'Gottman (1994): repair attempts and relationship stability',
          'Bowlby: secure base and safe haven attachment theory',
        ],
      },
      labor_drift: {
        insight_type: 'labor_imbalance',
        insight: 'Noticing a gradual emotional labor imbalance — one participant is carrying more of the relational maintenance work. This drift can accumulate quietly until it becomes harder to address.',
        grounding: [
          'Gottman (1994): 5:1 positive-to-negative interaction ratio',
          'Johnson (EFT): attachment bids and responsiveness',
        ],
      },
    };

    const proposals: RelationalProposal[] = [];
    for (const pattern of patterns) {
      const template = insightTemplates[pattern.pattern_type];
      if (!template) continue;
      const dyadId = (pattern.metadata?.dyad_id as string | undefined) ?? 'unknown';
      proposals.push({
        proposal_id: uuidv4(),
        dyad_id: dyadId,
        pattern_ids: [pattern.pattern_id],
        insight_type: template.insight_type,
        insight: template.insight,
        confidence: pattern.confidence,
        grounding: template.grounding,
        should_surface: pattern.confidence >= 0.6,
        suggested_actions: [],
      });
    }
    return proposals;
  }

  /**
   * Fallback configuration proposal
   */
  private fallbackConfigProposal(pattern: Pattern): Proposal | null {
    if (!pattern.metadata?.config) return null;

    return {
      proposal_id: uuidv4(),
      proposal_type: 'configuration_change',
      target_tool: 'GOrchestrator',
      target_component: pattern.metadata.config,
      current_value: pattern.metadata.metrics,
      proposed_value: {
        max_parallelism: 3,
        budget_multiplier: 0.8,
      },
      rationale: `Configuration ${pattern.metadata.config} has high average cost ($${pattern.metadata.metrics.avg_cost.toFixed(4)}). Reducing parallelism and budget may lower costs while maintaining success rate.`,
      expected_impact: {
        improvement: 0.3,
        confidence: pattern.confidence,
        evidence_count: pattern.observation_count,
      },
      risk_assessment: {
        risk_level: 'medium',
        potential_side_effects: [
          'May increase total wall time',
          'May reduce exploration diversity',
        ],
        rollback_plan: 'Revert to original configuration if success rate drops below 70%',
      },
      status: 'pending',
      created_at: new Date().toISOString(),
    };
  }
}
