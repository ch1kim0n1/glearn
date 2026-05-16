import { v4 as uuidv4 } from 'uuid';
import {
  DyadContext,
  Pattern,
  RelationalProposal,
  RelationalProposalSchema,
} from '../types/index.js';
import { LLMClient } from './llm-client.js';
import { coreLogger } from './observability.js';

type RelationalLLMClient = Pick<LLMClient, 'call' | 'getModelByTier'>;

interface EthicalRefusalClassifier {
  classify(text: string): Promise<{ should_refuse?: boolean; refused?: boolean; reason?: string }>;
}

const GROUNDINGS = {
  gottmanHorsemen: 'Gottman: Four Horsemen research on criticism, contempt, defensiveness, and stonewalling',
  gottmanRatio: 'Gottman: 5:1 positive-to-negative interaction ratio',
  johnsonEft: 'Johnson (EFT): attachment bids and responsiveness',
  bowlbySecureBase: 'Bowlby: secure base and safe haven attachment theory',
};

export class RelationalProposalGenerator {
  constructor(
    private readonly llmClient: RelationalLLMClient = new LLMClient(),
    private readonly ethicalRefusalClassifier?: EthicalRefusalClassifier,
  ) {}

  async generate(patterns: Pattern[], dyadContext: DyadContext): Promise<RelationalProposal[]> {
    const relationalPatterns = patterns.filter(pattern =>
      ['bid_cycle', 'repair_window', 'labor_drift', 'attachment_signal'].includes(pattern.pattern_type)
    );
    const proposals: RelationalProposal[] = [];

    for (const pattern of relationalPatterns) {
      const fallback = this.fallbackProposal(pattern, dyadContext);
      let proposal = fallback;

      try {
        const result = await this.llmClient.call(this.buildPrompt(pattern, dyadContext), {
          model: this.llmClient.getModelByTier('tier1'),
          maxTokens: 512,
          temperature: 0.3,
        });
        proposal = this.normalizeProposal(JSON.parse(this.extractJsonObject(result.content)), fallback);
      } catch (error) {
        coreLogger.warn('Relational proposal LLM generation failed, using fallback', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const refused = await this.shouldSuppress(proposal, dyadContext);
      proposals.push({
        ...proposal,
        should_surface: !refused,
      });
    }

    return proposals;
  }

  private buildPrompt(pattern: Pattern, dyadContext: DyadContext): string {
    return `SYSTEM:
You generate relationship-science-grounded DYAD learning insights.
Never assign blame to a single participant.
Never use clinical diagnosis language.
Use "noticing", "it seems like", or "you might consider" framing.
Every insight must cite at least one grounding source.

Grounding options:
- ${GROUNDINGS.gottmanHorsemen}
- ${GROUNDINGS.gottmanRatio}
- ${GROUNDINGS.johnsonEft}
- ${GROUNDINGS.bowlbySecureBase}

DYAD context:
${JSON.stringify(dyadContext, null, 2)}

Pattern:
${JSON.stringify(pattern, null, 2)}

Return strict JSON:
{
  "insight_type": "bid_pattern" | "repair_opportunity" | "labor_imbalance" | "attachment_dynamic",
  "insight": "non-blaming human-readable insight",
  "confidence": 0.0,
  "grounding": ["source"],
  "suggested_actions": ["action"]
}`;
  }

  private fallbackProposal(pattern: Pattern, dyadContext: DyadContext): RelationalProposal {
    const insightType = this.insightType(pattern.pattern_type);
    return {
      proposal_id: uuidv4(),
      dyad_id: dyadContext.dyad_id,
      pattern_ids: [pattern.pattern_id],
      insight_type: insightType,
      insight: this.fallbackInsight(pattern),
      confidence: pattern.confidence,
      grounding: this.groundingFor(pattern.pattern_type),
      should_surface: true,
      suggested_actions: this.actionsFor(pattern.pattern_type),
    };
  }

  private normalizeProposal(parsed: any, fallback: RelationalProposal): RelationalProposal {
    const candidate = {
      ...fallback,
      insight_type: this.normalizeInsightType(parsed?.insight_type, fallback.insight_type),
      insight: typeof parsed?.insight === 'string' && parsed.insight.trim()
        ? parsed.insight.trim()
        : fallback.insight,
      confidence: this.clamp(parsed?.confidence, fallback.confidence),
      grounding: this.normalizeGrounding(parsed?.grounding, fallback.grounding),
      suggested_actions: this.normalizeStringArray(parsed?.suggested_actions, fallback.suggested_actions),
    };

    return RelationalProposalSchema.parse(candidate);
  }

  private async shouldSuppress(proposal: RelationalProposal, dyadContext: DyadContext): Promise<boolean> {
    if (dyadContext.ethical_refusal) return true;
    if (this.heuristicRefusal(proposal.insight)) return true;

    if (!this.ethicalRefusalClassifier) return false;

    try {
      const result = await this.ethicalRefusalClassifier.classify(proposal.insight);
      return Boolean(result.should_refuse || result.refused);
    } catch (error) {
      coreLogger.warn('Relational proposal refusal classifier failed open', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private heuristicRefusal(text: string): boolean {
    return /\b(narcissist|borderline|gaslight|manipulative|coerce|force|surveil|spy|punish|blame)\b/i.test(text);
  }

  private fallbackInsight(pattern: Pattern): string {
    switch (pattern.pattern_type) {
      case 'bid_cycle':
        return 'It seems like bids for connection may be going unanswered often enough that a gentler acknowledgment could help keep repair accessible.';
      case 'labor_drift':
        return 'Noticing an emotional labor imbalance, you might consider a small check-in ritual that gives both people a clearer chance to initiate connection.';
      case 'repair_window':
        return 'It seems like repair works best in a specific window after tension, so protecting that window may make repair easier.';
      case 'attachment_signal':
        return 'Noticing attachment-related language patterns, you might consider naming the need for reassurance without diagnosing either person.';
      default:
        return 'Noticing a recurring relational pattern, you might consider a small bid for repair before the interaction escalates.';
    }
  }

  private actionsFor(patternType: Pattern['pattern_type']): string[] {
    switch (patternType) {
      case 'bid_cycle':
        return ['Acknowledge the next bid briefly before changing topics.', 'Name one concrete need in softer language.'];
      case 'labor_drift':
        return ['Alternate who initiates the next check-in.', 'Use one explicit appreciation before problem-solving.'];
      case 'repair_window':
        return ['Set a short pause and return within the observed repair window.', 'Start repair with one owned feeling.'];
      case 'attachment_signal':
        return ['Ask for reassurance directly and avoid labels.', 'Reflect the feeling before responding to the content.'];
      default:
        return ['Use a short, non-blaming bid for connection.'];
    }
  }

  private groundingFor(patternType: Pattern['pattern_type']): string[] {
    switch (patternType) {
      case 'bid_cycle':
        return [GROUNDINGS.johnsonEft, GROUNDINGS.gottmanRatio];
      case 'labor_drift':
        return [GROUNDINGS.gottmanRatio, GROUNDINGS.johnsonEft];
      case 'repair_window':
        return [GROUNDINGS.gottmanHorsemen, GROUNDINGS.bowlbySecureBase];
      case 'attachment_signal':
        return [GROUNDINGS.bowlbySecureBase, GROUNDINGS.johnsonEft];
      default:
        return [GROUNDINGS.johnsonEft];
    }
  }

  private insightType(patternType: Pattern['pattern_type']): RelationalProposal['insight_type'] {
    switch (patternType) {
      case 'bid_cycle':
        return 'bid_pattern';
      case 'repair_window':
        return 'repair_opportunity';
      case 'labor_drift':
        return 'labor_imbalance';
      case 'attachment_signal':
        return 'attachment_dynamic';
      default:
        return 'bid_pattern';
    }
  }

  private normalizeInsightType(value: unknown, fallback: RelationalProposal['insight_type']): RelationalProposal['insight_type'] {
    return value === 'bid_pattern' || value === 'repair_opportunity' || value === 'labor_imbalance' || value === 'attachment_dynamic'
      ? value
      : fallback;
  }

  private normalizeGrounding(value: unknown, fallback: string[]): string[] {
    const normalized = this.normalizeStringArray(value, fallback);
    return normalized.length > 0 ? normalized : fallback;
  }

  private normalizeStringArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) return fallback;
    const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
    return strings.length > 0 ? strings : fallback;
  }

  private extractJsonObject(content: string): string {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    return start >= 0 && end > start ? content.slice(start, end + 1) : content;
  }

  private clamp(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : fallback;
  }
}
