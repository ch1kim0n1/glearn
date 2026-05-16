import { v4 as uuidv4 } from 'uuid';
import {
  EmotionalTrajectory,
  RelationalCounterfactualInput,
  RelationalCounterfactualInputSchema,
  RelationalCounterfactualResult,
} from '../types/index.js';
import { LLMClient } from './llm-client.js';
import { coreLogger } from './observability.js';

type RelationalLLMClient = Pick<LLMClient, 'call' | 'getModelByTier'>;

export class RelationalCounterfactualEvaluator {
  constructor(private readonly llmClient: RelationalLLMClient = new LLMClient()) {}

  async evaluate(input: RelationalCounterfactualInput): Promise<RelationalCounterfactualResult> {
    const parsed = RelationalCounterfactualInputSchema.parse(input);

    let original = this.fallbackTrajectory(parsed.actual_response);
    let alternative = this.fallbackTrajectory('toward');

    try {
      const [originalResult, alternativeResult] = await Promise.all([
        this.predictTrajectory(parsed, parsed.actual_response),
        this.predictTrajectory(parsed, 'toward'),
      ]);
      original = originalResult;
      alternative = alternativeResult;
    } catch (error) {
      coreLogger.warn('Relational counterfactual LLM evaluation failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const divergence = parsed.actual_response === 'toward'
      ? 0
      : this.calculateDivergence(original, alternative);

    return {
      counterfactual_id: uuidv4(),
      original_trajectory: original,
      alternative_trajectory: alternative,
      divergence_score: divergence,
      key_bifurcation: parsed.actual_response === 'toward'
        ? 'The bid was already acknowledged, so the most useful change is maintaining that responsiveness.'
        : 'Acknowledging the bid with a toward response is the single change most likely to reduce escalation and improve repair odds.',
      confidence: parsed.message_window.length >= 4 ? 0.74 : 0.58,
    };
  }

  private async predictTrajectory(
    input: RelationalCounterfactualInput,
    response: RelationalCounterfactualInput['actual_response'],
  ): Promise<EmotionalTrajectory> {
    const prompt = `Predict the emotional trajectory for a dyadic interaction.

Use the same surrounding message window for this estimate:
${JSON.stringify(input.message_window, null, 2)}

Focal event:
${JSON.stringify(input.event, null, 2)}

Response condition: ${response}

Return strict JSON:
{
  "predicted_state_30min": "short phrase",
  "predicted_state_24h": "short phrase",
  "repair_probability": 0.0,
  "escalation_probability": 0.0
}`;

    const result = await this.llmClient.call(prompt, {
      model: this.llmClient.getModelByTier('tier1'),
      maxTokens: 384,
      temperature: 0.2,
    });
    return this.normalizeTrajectory(JSON.parse(this.extractJsonObject(result.content)), response);
  }

  private fallbackTrajectory(response: RelationalCounterfactualInput['actual_response']): EmotionalTrajectory {
    if (response === 'toward') {
      return {
        predicted_state_30min: 'more settled and acknowledged',
        predicted_state_24h: 'repair remains accessible',
        repair_probability: 0.72,
        escalation_probability: 0.18,
      };
    }

    if (response === 'ignored') {
      return {
        predicted_state_30min: 'unacknowledged and more activated',
        predicted_state_24h: 'distance may persist without repair',
        repair_probability: 0.28,
        escalation_probability: 0.68,
      };
    }

    return {
      predicted_state_30min: 'defensive and uncertain',
      predicted_state_24h: 'repair depends on a later softening attempt',
      repair_probability: response === 'away' ? 0.42 : 0.34,
      escalation_probability: response === 'away' ? 0.48 : 0.6,
    };
  }

  private normalizeTrajectory(parsed: any, response: RelationalCounterfactualInput['actual_response']): EmotionalTrajectory {
    const fallback = this.fallbackTrajectory(response);
    return {
      predicted_state_30min: this.nonEmptyString(parsed?.predicted_state_30min, fallback.predicted_state_30min),
      predicted_state_24h: this.nonEmptyString(parsed?.predicted_state_24h, fallback.predicted_state_24h),
      repair_probability: this.clamp(parsed?.repair_probability, fallback.repair_probability),
      escalation_probability: this.clamp(parsed?.escalation_probability, fallback.escalation_probability),
    };
  }

  private calculateDivergence(original: EmotionalTrajectory, alternative: EmotionalTrajectory): number {
    const repairDelta = Math.abs(original.repair_probability - alternative.repair_probability);
    const escalationDelta = Math.abs(original.escalation_probability - alternative.escalation_probability);
    return this.clamp((repairDelta + escalationDelta) / 2, 0.5);
  }

  private extractJsonObject(content: string): string {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    return start >= 0 && end > start ? content.slice(start, end + 1) : content;
  }

  private nonEmptyString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  private clamp(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : fallback;
  }
}
