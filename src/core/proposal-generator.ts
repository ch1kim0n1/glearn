import { v4 as uuidv4 } from 'uuid';
import {
  Pattern,
  Proposal,
  GOrchestratorData,
  GMirrorData,
  GStackData,
} from '../types/index.js';
import { LLMClient } from './llm-client.js';

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

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient || new LLMClient();
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
      const rationale = await this.generateLLMRationale(pattern, 'configuration_change');
      
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
        rationale,
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
    } catch (error) {
      console.warn('[ProposalGenerator] LLM rationale generation failed, using fallback:', error);
      return this.fallbackConfigProposal(pattern);
    }
  }

  /**
   * Generate coverage gap proposal
   */
  private async generateCoverageProposal(pattern: Pattern): Promise<Proposal> {
    const targetTool = pattern.source_tools[0] as Proposal['target_tool'];

    try {
      const rationale = await this.generateLLMRationale(pattern, 'library_expansion');

      return {
        proposal_id: uuidv4(),
        proposal_type: 'library_expansion',
        target_tool: targetTool,
        target_component: 'test_library',
        current_value: 'current_coverage',
        proposed_value: 'expanded_coverage',
        rationale,
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
    } catch (error) {
      console.warn('[ProposalGenerator] LLM rationale generation failed, using fallback:', error);
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
      const rationale = await this.generateLLMRationale(pattern, 'calibration_adjustment');

      return {
        proposal_id: uuidv4(),
        proposal_type: 'calibration_adjustment',
        target_tool: targetTool,
        target_component: 'calibration_weights',
        current_value: 'current_weights',
        proposed_value: 'recalibrated_weights',
        rationale,
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
    } catch (error) {
      console.warn('[ProposalGenerator] LLM rationale generation failed, using fallback:', error);
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
      const rationale = await this.generateLLMRationale(pattern, 'workflow_optimization');

      return {
        proposal_id: uuidv4(),
        proposal_type: 'workflow_optimization',
        target_tool: 'GAgent' as Proposal['target_tool'],
        target_component: 'pipeline_flow',
        current_value: 'current_pipeline',
        proposed_value: 'optimized_pipeline',
        rationale,
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
    } catch (error) {
      console.warn('[ProposalGenerator] LLM rationale generation failed, using fallback:', error);
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
    console.log(`[ProposalGenerator] Applying proposal: ${proposalId}`);
    return true;
  }

  /**
   * Rollback a proposal
   */
  async rollbackProposal(proposalId: string): Promise<boolean> {
    // In production, would integrate with tool APIs to rollback changes
    console.log(`[ProposalGenerator] Rolling back proposal: ${proposalId}`);
    return true;
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
