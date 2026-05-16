/**
 * GLearn HTTP client
 *
 * GLearn primarily exposes an MCP server and health server (port 8080).
 * This client targets the health endpoint and any future HTTP endpoints.
 */

export interface Pattern {
  pattern_id: string;
  pattern_type: string;
  signature: string;
  frequency: number;
  confidence: number;
  affected_tools: string[];
  [key: string]: unknown;
}

export interface Proposal {
  proposal_id: string;
  pattern_ids: string[];
  insight_type?: string;
  insight?: string;
  confidence: number;
  [key: string]: unknown;
}

export interface HealthResult {
  status: string;
  timestamp: string;
  [key: string]: unknown;
}

export class GLearnClient {
  private baseUrl: string;
  private healthBaseUrl: string;
  private token?: string;

  constructor(options: { baseUrl?: string; healthBaseUrl?: string; token?: string } = {}) {
    this.baseUrl = options.baseUrl ?? 'http://localhost:3005';
    this.healthBaseUrl = options.healthBaseUrl ?? 'http://localhost:8080';
    this.token = options.token;
  }

  /** GET /patterns */
  async getPatterns(): Promise<Pattern[]> {
    return this.request<Pattern[]>('GET', '/patterns', undefined, this.baseUrl);
  }

  /** GET /proposals */
  async getProposals(): Promise<Proposal[]> {
    return this.request<Proposal[]>('GET', '/proposals', undefined, this.baseUrl);
  }

  /** GET /health/live */
  async health(): Promise<HealthResult> {
    return this.request<HealthResult>('GET', '/health/live', undefined, this.healthBaseUrl);
  }

  private async request<T>(method: string, path: string, body?: unknown, base?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${base ?? this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
}
