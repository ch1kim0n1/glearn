import {
  GBrainIntegrationClient,
  GBrainIntegrationError,
} from '../src/core/gbrain-integration.js';
import { GLearn } from '../src/core/glearn.js';

const now = new Date('2026-05-15T00:00:00.000Z').toISOString();

describe('GBrainIntegrationClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('sends auth headers and validates health responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy' }),
    } as Response);

    const client = new GBrainIntegrationClient({
      endpoint: 'http://gbrain.local',
      authToken: 'secret-token',
      maxRetries: 0,
    });

    await expect(client.healthCheck()).resolves.toEqual(expect.objectContaining({ status: 'healthy' }));
    expect(global.fetch).toHaveBeenCalledWith(
      'http://gbrain.local/health',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      }),
    );
  });

  it('pulls GLearn observations from the GBrain takes table', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        takes: [
          {
            take_id: 'take-1',
            content: 'Repeated expensive retries after low confidence outputs',
            entities: ['retry', 'confidence'],
            links: [{ target: 'run-1', type: 'evidence' }],
            query: 'glearn retry confidence',
            result_count: 3,
            timestamp: now,
          },
        ],
      }),
    } as Response);

    const client = new GBrainIntegrationClient({
      endpoint: 'http://gbrain.local',
      maxRetries: 0,
    });

    const data = await client.getObservationStream({
      start: now,
      end: now,
    });

    expect(data.pages).toHaveLength(1);
    expect(data.pages[0]).toEqual(expect.objectContaining({
      page_id: 'take-1',
      content: expect.stringContaining('expensive retries'),
      entities: ['retry', 'confidence'],
    }));
    expect(data.searches[0]).toEqual(expect.objectContaining({
      query: 'glearn retry confidence',
      results: 3,
      timestamp: now,
    }));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/takes/observations?'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('retries transient failures with backoff on page writes', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ page_id: 'page-1' }) } as Response);

    const client = new GBrainIntegrationClient({
      endpoint: 'http://gbrain.local',
      maxRetries: 1,
      initialBackoffMs: 1,
    });

    await expect(client.createPage({
      title: 'Receipt',
      content: '{}',
      tags: ['glearn'],
    })).resolves.toEqual(expect.objectContaining({ page_id: 'page-1' }));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit breaker after repeated transient failures', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const client = new GBrainIntegrationClient({
      endpoint: 'http://gbrain.local',
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerCooldownMs: 1000,
    });

    await expect(client.healthCheck()).rejects.toBeInstanceOf(GBrainIntegrationError);
    await expect(client.healthCheck()).rejects.toMatchObject({ kind: 'circuit_open' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('supports MCP tool transport for observation reads', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: { pages: [{ page_id: 'p1', content: 'context', entities: [], links: [] }], searches: [] } }),
    } as Response);

    const client = new GBrainIntegrationClient({
      endpoint: 'http://gbrain.local',
      mcpEndpoint: 'http://gbrain.local/mcp',
      mode: 'mcp',
      maxRetries: 0,
    });

    const data = await client.getObservationStream();

    expect(data.pages[0].page_id).toBe('p1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://gbrain.local/mcp/tools/gbrain.get_glearn_observations',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('GLearn GBrain ingestion', () => {
  it('queries GBrain context before ingesting other tool data', async () => {
    const gbrainClient = {
      getObservationStream: jest.fn().mockResolvedValue({
        pages: [{ page_id: 'p1', content: 'context', entities: [], links: [] }],
        searches: [],
      }),
      getCircuitState: jest.fn().mockReturnValue({ open: false, consecutiveFailures: 0 }),
      createPage: jest.fn(),
      healthCheck: jest.fn(),
    } as any;
    const learner = new GLearn({ gbrainClient });
    const ingestOrder: string[] = [];
    (learner as any).patternMiner = {
      ingestData: (tool: string) => ingestOrder.push(tool),
    };

    await (learner as any).ingestDataFromAllTools({
      start: now,
      end: now,
    });

    expect(gbrainClient.getObservationStream).toHaveBeenCalledWith({ start: now, end: now });
    expect(ingestOrder[0]).toBe('GBrain');
    expect(ingestOrder).toEqual(['GBrain', 'GStack', 'GOrchestrator', 'GMirror', 'GToM']);
  });
});
