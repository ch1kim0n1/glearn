import { describe, expect, it, jest } from '@jest/globals';
import { LLMClient } from '../src/core/llm-client';

describe('LLMClient embeddings', () => {
  it('calls the OpenAI embeddings API and tracks cost metadata', async () => {
    const client = new LLMClient({ openaiApiKey: 'test-key' });
    const create = jest.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    } as never);
    (client as any).openaiClient = { embeddings: { create } };

    const result = await client.getEmbedding('cost and success rate pattern', {
      model: 'text-embedding-3-small',
    });

    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'cost and success rate pattern',
    });
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.input_tokens).toBeGreaterThan(0);
    expect(result.model_id).toBe('text-embedding-3-small');
    expect(client.getCallCount()).toBe(1);
  });
});
