import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { ProposalGenerator } from '../src/core/proposal-generator';
import { Pattern, Proposal } from '../src/types/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePattern(
  type: Pattern['pattern_type'],
  overrides: Partial<Pattern> = {}
): Pattern {
  return {
    pattern_id: uuidv4(),
    pattern_type: type,
    description: `Test pattern of type ${type}`,
    confidence: 0.8,
    evidence: ['evidence item 1', 'evidence item 2'],
    source_tools: ['GOrchestrator'],
    first_observed: new Date().toISOString(),
    observation_count: 5,
    ...overrides,
  };
}

function makeConfigPattern(): Pattern {
  return makePattern('configuration_optimization', {
    source_tools: ['GOrchestrator'],
    metadata: {
      config: 'config-b',
      metrics: { avg_cost: 1.20, success_rate: 0.5, avg_duration: 2000 },
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProposalGenerator', () => {
  let generator: ProposalGenerator;

  beforeEach(() => {
    generator = new ProposalGenerator();
  });

  // --------------------------------------------------------------------------
  // 1. Empty pattern list → empty proposals
  // --------------------------------------------------------------------------
  it('returns empty array when given no patterns', async () => {
    const proposals = await generator.generateProposals([]);
    expect(proposals).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 2. configuration_optimization pattern → proposal
  // --------------------------------------------------------------------------
  it('generates a proposal for a configuration_optimization pattern', async () => {
    const pattern = makeConfigPattern();
    const proposals = await generator.generateProposals([pattern]);

    expect(proposals.length).toBe(1);
    const p = proposals[0];
    expect(p.proposal_type).toBe('configuration_change');
    expect(p.target_tool).toBe('GOrchestrator');
  });

  // --------------------------------------------------------------------------
  // 3. coverage_gap pattern → library_expansion proposal
  // --------------------------------------------------------------------------
  it('generates a library_expansion proposal for a coverage_gap pattern', async () => {
    const pattern = makePattern('coverage_gap', { source_tools: ['GMirror'] });
    const proposals = await generator.generateProposals([pattern]);

    expect(proposals.length).toBe(1);
    expect(proposals[0].proposal_type).toBe('library_expansion');
    expect(proposals[0].target_tool).toBe('GMirror');
  });

  // --------------------------------------------------------------------------
  // 4. drift_detection pattern → calibration_adjustment proposal
  // --------------------------------------------------------------------------
  it('generates a calibration_adjustment proposal for a drift_detection pattern', async () => {
    const pattern = makePattern('drift_detection', { source_tools: ['GToM'] });
    const proposals = await generator.generateProposals([pattern]);

    expect(proposals.length).toBe(1);
    expect(proposals[0].proposal_type).toBe('calibration_adjustment');
    expect(proposals[0].target_tool).toBe('GToM');
  });

  // --------------------------------------------------------------------------
  // 5. cross_tool_correlation pattern → workflow_optimization proposal
  // --------------------------------------------------------------------------
  it('generates a workflow_optimization proposal for a cross_tool_correlation pattern', async () => {
    const pattern = makePattern('cross_tool_correlation', {
      source_tools: ['GOrchestrator', 'GMirror'],
      confidence: 0.75,
    });
    const proposals = await generator.generateProposals([pattern]);

    expect(proposals.length).toBe(1);
    expect(proposals[0].proposal_type).toBe('workflow_optimization');
    expect(proposals[0].target_tool).toBe('GAgent');
  });

  // --------------------------------------------------------------------------
  // 6. Unhandled pattern types (failure_mode_cluster, cost_anomaly) → skip
  // --------------------------------------------------------------------------
  it('skips unhandled pattern types and returns no proposals for them', async () => {
    const patterns = [
      makePattern('failure_mode_cluster'),
      makePattern('cost_anomaly'),
    ];
    const proposals = await generator.generateProposals(patterns);
    expect(proposals).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 7. Multiple patterns → one proposal each (for handled types)
  // --------------------------------------------------------------------------
  it('generates one proposal per handled pattern', async () => {
    const patterns = [
      makeConfigPattern(),
      makePattern('coverage_gap', { source_tools: ['GStack'] }),
      makePattern('drift_detection', { source_tools: ['GOrchestrator'] }),
      makePattern('cross_tool_correlation', { source_tools: ['GBrain'] }),
    ];
    const proposals = await generator.generateProposals(patterns);
    expect(proposals.length).toBe(4);
  });

  // --------------------------------------------------------------------------
  // 8. Proposal required fields
  // --------------------------------------------------------------------------
  it('all proposals have required fields with correct types', async () => {
    const patterns = [
      makeConfigPattern(),
      makePattern('coverage_gap', { source_tools: ['GMirror'] }),
      makePattern('drift_detection', { source_tools: ['GToM'] }),
      makePattern('cross_tool_correlation'),
    ];
    const proposals = await generator.generateProposals(patterns);

    for (const p of proposals) {
      expect(p.proposal_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(typeof p.proposal_type).toBe('string');
      expect(typeof p.target_tool).toBe('string');
      expect(typeof p.target_component).toBe('string');
      expect(typeof p.rationale).toBe('string');
      expect(p.rationale.length).toBeGreaterThan(0);

      // expected_impact
      expect(p.expected_impact.improvement).toBeGreaterThanOrEqual(0);
      expect(p.expected_impact.improvement).toBeLessThanOrEqual(1);
      expect(p.expected_impact.confidence).toBeGreaterThanOrEqual(0);
      expect(p.expected_impact.confidence).toBeLessThanOrEqual(1);
      expect(Number.isInteger(p.expected_impact.evidence_count)).toBe(true);

      // risk_assessment
      expect(['low', 'medium', 'high']).toContain(p.risk_assessment.risk_level);
      expect(Array.isArray(p.risk_assessment.potential_side_effects)).toBe(true);
      expect(typeof p.risk_assessment.rollback_plan).toBe('string');

      // status
      expect(p.status).toBe('pending');
      expect(typeof p.created_at).toBe('string');
    }
  });

  // --------------------------------------------------------------------------
  // 9. configuration_optimization without metadata.config → no proposal
  // --------------------------------------------------------------------------
  it('skips configuration_optimization pattern that has no metadata.config', async () => {
    const pattern = makePattern('configuration_optimization');
    // No metadata field → generateConfigProposal returns null
    const proposals = await generator.generateProposals([pattern]);
    expect(proposals).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 10. approveProposal / rejectProposal return updated status
  // --------------------------------------------------------------------------
  it('uses LLM-generated proposal hypotheses when available', async () => {
    const llmClient = {
      getModelByTier: () => 'test-model',
      call: async () => ({
        content: JSON.stringify({
          target_component: 'adaptive_parallelism_policy',
          current_value: { max_parallelism: 8, budget_multiplier: 1.0 },
          proposed_value: { max_parallelism: 4, budget_multiplier: 0.7 },
          rationale: 'The expensive configuration has weak success, so reducing parallelism should lower cost without sacrificing quality.',
          expected_impact: { improvement: 0.44, confidence: 0.68 },
          risk_assessment: {
            risk_level: 'medium',
            potential_side_effects: ['Longer wall-clock time on broad tasks'],
            rollback_plan: 'Restore prior parallelism if success rate falls below baseline.',
          },
        }),
        input_tokens: 10,
        output_tokens: 10,
        model_id: 'test-model',
        cost_usd: 0,
        latency_ms: 1,
      }),
    };
    const llmGenerator = new ProposalGenerator(llmClient as any);

    const proposals = await llmGenerator.generateProposals([makeConfigPattern()]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target_component).toBe('adaptive_parallelism_policy');
    expect(proposals[0].proposed_value).toEqual({ max_parallelism: 4, budget_multiplier: 0.7 });
    expect(proposals[0].expected_impact.improvement).toBe(0.44);
    expect(proposals[0].risk_assessment.rollback_plan).toContain('Restore prior parallelism');
  });

  it('approveProposal returns a proposal with status approved', async () => {
    const id = uuidv4();
    const approved = generator.approveProposal(id, 'alice');
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe('approved');
    expect(approved!.reviewed_by).toBe('alice');
    expect(typeof approved!.reviewed_at).toBe('string');
  });

  it('rejectProposal returns a proposal with status rejected', async () => {
    const id = uuidv4();
    const rejected = generator.rejectProposal(id, 'bob');
    expect(rejected).not.toBeNull();
    expect(rejected!.status).toBe('rejected');
    expect(rejected!.reviewed_by).toBe('bob');
  });
});
