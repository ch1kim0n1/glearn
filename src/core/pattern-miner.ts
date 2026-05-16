import { v4 as uuidv4 } from 'uuid';
import {
  Pattern,
  GBrainData,
  GStackData,
  GOrchestratorData,
  GMirrorData,
  GToMData,
  CrossToolAnalysis,
  DriftDetection,
  CoverageGap,
  LearningRequest,
  RelationalEvent,
} from '../types/index.js';
import { LLMClient } from './llm-client.js';
import { coreLogger } from './observability.js';

/**
 * Pattern Miner
 *
 * Responsibilities:
 * - Ingest data from all tools
 * - Detect cross-tool correlations using embedding-based clustering
 * - Identify drift in metrics
 * - Find coverage gaps
 * - Extract higher-order patterns
 */
export class PatternMiner {
  private dataStore: Map<string, any>;
  private patterns: Pattern[];
  private llmClient: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.dataStore = new Map();
    this.patterns = [];
    this.llmClient = llmClient || new LLMClient();
  }

  /**
   * Ingest data from a tool
   */
  ingestData(tool: string, data: any): void {
    this.dataStore.set(tool, data);
  }

  /**
   * Mine patterns from all ingested data
   */
  async minePatterns(): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    // Cross-tool correlations using embedding-based clustering
    const crossToolPatterns = await this.detectCrossToolCorrelations();
    patterns.push(...crossToolPatterns);

    // Drift detection
    const driftPatterns = await this.detectDrift();
    patterns.push(...driftPatterns);

    // Coverage gaps
    const coveragePatterns = await this.detectCoverageGaps();
    patterns.push(...coveragePatterns);

    // Configuration optimization opportunities
    const configPatterns = await this.detectConfigOptimizations();
    patterns.push(...configPatterns);

    // DYAD relational learning patterns
    const relationalPatterns = this.detectRelationalPatterns();
    patterns.push(...relationalPatterns);

    this.patterns = patterns;
    return patterns;
  }

  /**
   * Detect cross-tool correlations using embedding-based clustering
   */
  private async detectCrossToolCorrelations(): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    // Generate embeddings for each tool's data
    const embeddings = await this.generateToolEmbeddings();

    // First-class detection: aligned time-series Pearson correlation across tools.
    // This catches the case where two tools track linked metrics (e.g. orchestrator
    // cost rising with mirror correctness) even when their feature vectors look
    // dissimilar in raw embedding space.
    const tsPatterns = await this.detectTimeSeriesCorrelations();
    patterns.push(...tsPatterns);

    // Cluster embeddings to find similar patterns. Cap k at floor(n/2) so we
    // always get at least one cluster with ≥2 tools (single-tool clusters can't
    // surface a cross-tool correlation). With n=2 we use k=1.
    const k = Math.max(1, Math.floor(embeddings.length / 2));
    const clusters = this.clusterEmbeddings(embeddings, k);

    // Analyze clusters for cross-tool correlations
    for (const cluster of clusters) {
      if (cluster.length > 1) {
        // Found tools with similar patterns
        const tools = cluster.map(c => c.tool);
        const similarity = this.calculateClusterSimilarity(cluster);

        if (similarity > 0.5) {
          const description = await this.generatePatternDescription({
            pattern_type: 'cross_tool_correlation',
            tools,
            similarity,
            cluster_size: cluster.length,
          });

          patterns.push({
            pattern_id: uuidv4(),
            pattern_type: 'cross_tool_correlation',
            description,
            confidence: similarity,
            evidence: [
              `Cluster size: ${cluster.length}`,
              `Similarity: ${similarity.toFixed(3)}`,
              `Tools: ${tools.join(', ')}`,
            ],
            source_tools: tools,
            first_observed: new Date().toISOString(),
            observation_count: cluster.reduce((sum, c) => sum + c.sampleCount, 0),
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Generate embeddings for each tool's data
   */
  private async generateToolEmbeddings(): Promise<Array<{ tool: string; embedding: number[]; sampleCount: number }>> {
    const embeddings: Array<{ tool: string; embedding: number[]; sampleCount: number }> = [];

    for (const [tool, data] of this.dataStore.entries()) {
      const embedding = await this.generateEmbedding(tool, data);
      const sampleCount = this.getSampleCount(tool, data);
      embeddings.push({ tool, embedding, sampleCount });
    }

    return embeddings;
  }

  /**
   * Generate embedding for a tool's data using real embeddings API
   */
  private async generateEmbedding(tool: string, data: any): Promise<number[]> {
    // Convert data to text representation for embedding
    const textRepresentation = this.dataToText(tool, data);

    try {
      // Use LLM client to generate real embedding (if available)
      const client = this.llmClient as any;
      if (typeof client.getEmbedding === 'function') {
        const result = await client.getEmbedding(textRepresentation, {
          model: 'text-embedding-3-small',
          provider: 'openai',
        });
        return result.embedding;
      }
      // No embedding API available — fall back to manual features
      return this.generateManualEmbedding(tool, data);
    } catch (error) {
      coreLogger.warn('Embedding API call failed, falling back to manual features', {
        tool,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.generateManualEmbedding(tool, data);
    }
  }

  /**
   * Convert data to text representation for embedding
   */
  private dataToText(tool: string, data: any): string {
    const summary: string[] = [];
    summary.push(`Tool: ${tool}`);

    if (data.run_records) {
      const avgCost = data.run_records.reduce((sum: number, r: any) => sum + (r.total_cost_usd || 0), 0) / data.run_records.length;
      const successRate = data.run_records.filter((r: any) => r.status === 'completed').length / data.run_records.length;
      const avgLatency = data.run_records.reduce((sum: number, r: any) => sum + (r.wall_time_ms || 0), 0) / data.run_records.length;
      summary.push(`Average cost: $${avgCost.toFixed(4)}`);
      summary.push(`Success rate: ${(successRate * 100).toFixed(1)}%`);
      summary.push(`Average latency: ${(avgLatency / 1000).toFixed(2)}s`);
      summary.push(`Run count: ${data.run_records.length}`);
    }

    if (data.runs) {
      const avgCost = data.runs.reduce((sum: number, r: any) => sum + (r.cost_usd || 0), 0) / data.runs.length;
      const successRate = data.runs.filter((r: any) => r.success).length / data.runs.length;
      summary.push(`Average cost: $${avgCost.toFixed(4)}`);
      summary.push(`Success rate: ${(successRate * 100).toFixed(1)}%`);
      summary.push(`Run count: ${data.runs.length}`);
    }

    if (data.verdicts) {
      const passRate = data.verdicts.filter((v: any) => v.overall === 'pass').length / data.verdicts.length;
      summary.push(`Pass rate: ${(passRate * 100).toFixed(1)}%`);
      summary.push(`Verdict count: ${data.verdicts.length}`);
    }

    if (data.vulnerability_states) {
      const avgVuln = data.vulnerability_states.reduce((sum: number, s: any) => sum + (s.overall_vulnerability || 0), 0) / data.vulnerability_states.length;
      summary.push(`Average vulnerability: ${avgVuln.toFixed(3)}`);
      summary.push(`State count: ${data.vulnerability_states.length}`);
    }

    if (tool.toUpperCase() === 'DYAD') {
      const events = this.extractRelationalEvents(data).map(item => item.event);
      const bids = events.filter(event => event.type === 'bid');
      const responses = events.filter(event => event.type === 'response');
      const repairs = events.filter(event => event.type === 'repair_attempt');
      summary.push(`Relational events: ${events.length}`);
      summary.push(`Bids: ${bids.length}`);
      summary.push(`Responses: ${responses.length}`);
      summary.push(`Repair attempts: ${repairs.length}`);
    }

    return summary.join('. ');
  }

  /**
   * Fallback manual embedding generation
   */
  private generateManualEmbedding(tool: string, data: any): number[] {
    // Create a feature vector from the data
    const features: number[] = [];

    // Feature 1: Average cost
    if (data.run_records) {
      const avgCost = data.run_records.reduce((sum: number, r: any) => sum + (r.total_cost_usd || 0), 0) / data.run_records.length;
      features.push(avgCost);
    } else if (data.runs) {
      const avgCost = data.runs.reduce((sum: number, r: any) => sum + (r.total_cost_usd || 0), 0) / data.runs.length;
      features.push(avgCost);
    } else {
      features.push(0);
    }

    // Feature 2: Success rate
    if (data.run_records) {
      const successRate = data.run_records.filter((r: any) => r.status === 'completed').length / data.run_records.length;
      features.push(successRate);
    } else if (data.runs) {
      const successRate = data.runs.filter((r: any) => r.success).length / data.runs.length;
      features.push(successRate);
    } else if (data.verdicts) {
      const successRate = data.verdicts.filter((v: any) => v.overall === 'pass').length / data.verdicts.length;
      features.push(successRate);
    } else {
      features.push(0);
    }

    // Feature 3: Average latency
    if (data.run_records) {
      const avgLatency = data.run_records.reduce((sum: number, r: any) => sum + (r.wall_time_ms || 0), 0) / data.run_records.length;
      features.push(avgLatency / 1000); // Convert to seconds
    } else if (data.runs) {
      const avgLatency = data.runs.reduce((sum: number, r: any) => sum + (r.wall_time_ms || 0), 0) / data.runs.length;
      features.push(avgLatency / 1000);
    } else {
      features.push(0);
    }

    // Feature 4: Token usage (if available)
    if (data.run_records) {
      const avgTokens = data.run_records.reduce((sum: number, r: any) => sum + (r.trace?.total_tokens || 0), 0) / data.run_records.length;
      features.push(avgTokens);
    } else {
      features.push(0);
    }

    // Feature 5: Vulnerability score (for GToM)
    if (data.vulnerability_states) {
      const avgVuln = data.vulnerability_states.reduce((sum: number, s: any) => sum + (s.overall_vulnerability || 0), 0) / data.vulnerability_states.length;
      features.push(avgVuln);
    } else {
      features.push(0);
    }

    // Normalize features to [0, 1] range
    const maxFeature = Math.max(...features);
    const minFeature = Math.min(...features);
    const range = maxFeature - minFeature || 1;

    return features.map(f => (f - minFeature) / range);
  }

  /**
   * Get sample count for a tool's data
   */
  private getSampleCount(tool: string, data: any): number {
    if (data.run_records) return data.run_records.length;
    if (data.runs) return data.runs.length;
    if (data.verdicts) return data.verdicts.length;
    if (data.vulnerability_states) return data.vulnerability_states.length;
    if (tool.toUpperCase() === 'DYAD') return this.extractRelationalEvents(data).length;
    return 0;
  }

  /**
   * Cluster embeddings using k-means
   */
  private clusterEmbeddings(embeddings: Array<{ tool: string; embedding: number[]; sampleCount: number }>, k: number): Array<Array<{ tool: string; embedding: number[]; sampleCount: number }>> {
    if (embeddings.length <= k) {
      return embeddings.map(e => [e]);
    }

    // Initialize centroids randomly
    const centroids = embeddings.slice(0, k).map(e => [...e.embedding]);

    // K-means iterations
    for (let iter = 0; iter < 10; iter++) {
      // Assign each embedding to nearest centroid
      const clusters: Array<Array<{ tool: string; embedding: number[]; sampleCount: number }>> = Array(k).fill(null).map(() => []);

      for (const emb of embeddings) {
        let minDist = Infinity;
        let nearestCluster = 0;

        for (let i = 0; i < k; i++) {
          const dist = this.euclideanDistance(emb.embedding, centroids[i]);
          if (dist < minDist) {
            minDist = dist;
            nearestCluster = i;
          }
        }

        clusters[nearestCluster].push(emb);
      }

      // Update centroids
      for (let i = 0; i < k; i++) {
        if (clusters[i].length > 0) {
          const newCentroid = new Array(centroids[i].length).fill(0);
          for (const emb of clusters[i]) {
            for (let j = 0; j < emb.embedding.length; j++) {
              newCentroid[j] += emb.embedding[j];
            }
          }
          centroids[i] = newCentroid.map(v => v / clusters[i].length);
        }
      }
    }

    // Final assignment
    const finalClusters: Array<Array<{ tool: string; embedding: number[]; sampleCount: number }>> = Array(k).fill(null).map(() => []);

    for (const emb of embeddings) {
      let minDist = Infinity;
      let nearestCluster = 0;

      for (let i = 0; i < k; i++) {
        const dist = this.euclideanDistance(emb.embedding, centroids[i]);
        if (dist < minDist) {
          minDist = dist;
          nearestCluster = i;
        }
      }

      finalClusters[nearestCluster].push(emb);
    }

    return finalClusters.filter(c => c.length > 0);
  }

  /**
   * Calculate Euclidean distance between two vectors
   */
  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
  }

  /**
   * Calculate similarity of a cluster
   */
  private calculateClusterSimilarity(cluster: Array<{ tool: string; embedding: number[]; sampleCount: number }>): number {
    if (cluster.length < 2) return 0;

    // Calculate average pairwise similarity
    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        const dist = this.euclideanDistance(cluster[i].embedding, cluster[j].embedding);
        const similarity = 1 / (1 + dist); // Convert distance to similarity
        totalSimilarity += similarity;
        pairCount++;
      }
    }

    return pairCount > 0 ? totalSimilarity / pairCount : 0;
  }

  /**
   * Extract a numeric time-series for a tool by metric name.
   * Aligns by array index across tools so positions correspond to the same step.
   */
  private extractSeries(tool: string, metric: string): number[] | null {
    const data: any = this.dataStore.get(tool);
    if (!data) return null;
    const records: any[] = data.run_records ?? data.runs ?? data.verdicts ?? data.vulnerability_states ?? [];
    if (records.length < 3) return null;
    const series = records.map(r => {
      if (metric in r) return Number(r[metric]);
      if (r.scores && metric in r.scores) return Number(r.scores[metric]);
      if (r.cost && metric in r.cost) return Number(r.cost[metric]);
      return NaN;
    });
    return series.every(v => Number.isFinite(v)) ? series : null;
  }

  /**
   * Pearson correlation coefficient between two equal-length series.
   */
  private pearson(xs: number[], ys: number[]): number {
    const n = Math.min(xs.length, ys.length);
    if (n < 3) return 0;
    const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const ex = xs[i] - mx;
      const ey = ys[i] - my;
      num += ex * ey;
      dx += ex * ex;
      dy += ey * ey;
    }
    const denom = Math.sqrt(dx * dy);
    return denom > 0 ? num / denom : 0;
  }

  /**
   * Detect aligned time-series correlations across tools (|r| > 0.5).
   */
  private async detectTimeSeriesCorrelations(): Promise<Pattern[]> {
    const patterns: Pattern[] = [];
    const probes: Array<{ tool: string; metric: string }> = [
      { tool: 'GOrchestrator', metric: 'total_cost_usd' },
      { tool: 'GOrchestrator', metric: 'total_wall_time_ms' },
      { tool: 'GMirror', metric: 'correctness' },
      { tool: 'GMirror', metric: 'user_outcome' },
      { tool: 'GMirror', metric: 'failure_modes' },
      { tool: 'GToM', metric: 'overall_vulnerability' },
      { tool: 'GLearn', metric: 'patterns_found' },
    ];
    const series: Array<{ tool: string; metric: string; values: number[] }> = [];
    for (const p of probes) {
      const s = this.extractSeries(p.tool, p.metric);
      if (s) series.push({ tool: p.tool, metric: p.metric, values: s });
    }
    for (let i = 0; i < series.length; i++) {
      for (let j = i + 1; j < series.length; j++) {
        if (series[i].tool === series[j].tool) continue;
        const r = this.pearson(series[i].values, series[j].values);
        if (Math.abs(r) > 0.5) {
          const description = await this.generatePatternDescription({
            pattern_type: 'cross_tool_correlation',
            tools: [series[i].tool, series[j].tool],
            similarity: Math.abs(r),
          });

          patterns.push({
            pattern_id: uuidv4(),
            pattern_type: 'cross_tool_correlation',
            description,
            confidence: Math.min(1, Math.abs(r)),
            evidence: [
              `r = ${r.toFixed(3)}`,
              `n = ${Math.min(series[i].values.length, series[j].values.length)}`,
              `metrics: ${series[i].metric} ↔ ${series[j].metric}`,
            ],
            source_tools: [series[i].tool, series[j].tool],
            first_observed: new Date().toISOString(),
            observation_count: Math.min(series[i].values.length, series[j].values.length),
          });
        }
      }
    }
    return patterns;
  }

  /**
   * Detect drift in metrics
   */
  private async detectDrift(): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    for (const [tool, data] of this.dataStore.entries()) {
      // Look for GToM vulnerability drift
      if (tool === 'GToM') {
        const gtomData = data as GToMData;
        if (gtomData.vulnerability_states.length > 10) {
          const recent = gtomData.vulnerability_states.slice(-5);
          const baseline = gtomData.vulnerability_states.slice(0, 5);

          const recentAvg = recent.reduce((sum, s) => sum + s.overall_vulnerability, 0) / recent.length;
          const baselineAvg = baseline.reduce((sum, s) => sum + s.overall_vulnerability, 0) / baseline.length;

          const drift = Math.abs(recentAvg - baselineAvg);
          if (drift > 0.2) {
            const description = await this.generatePatternDescription({
              pattern_type: 'drift_detection',
              drift,
            });

            patterns.push({
              pattern_id: uuidv4(),
              pattern_type: 'drift_detection',
              description,
              confidence: drift,
              evidence: [
                `Baseline: ${baselineAvg.toFixed(3)}`,
                `Recent: ${recentAvg.toFixed(3)}`,
                `Drift: ${drift.toFixed(3)}`,
              ],
              source_tools: ['GToM'],
              first_observed: new Date().toISOString(),
              observation_count: gtomData.vulnerability_states.length,
            });
          }
        }
      }

      // Look for GOrchestrator cost drift
      if (tool === 'GOrchestrator') {
        const orchData = data as GOrchestratorData;
        if (orchData.run_records.length > 10) {
          const recent = orchData.run_records.slice(-5);
          const baseline = orchData.run_records.slice(0, 5);

          const recentAvgCost = recent.reduce((sum, r) => sum + r.total_cost_usd, 0) / recent.length;
          const baselineAvgCost = baseline.reduce((sum, r) => sum + r.total_cost_usd, 0) / baseline.length;

          const drift = (recentAvgCost - baselineAvgCost) / baselineAvgCost;
          if (Math.abs(drift) > 0.3) {
            const description = await this.generatePatternDescription({
              pattern_type: 'drift_detection',
              drift: Math.abs(drift),
            });

            patterns.push({
              pattern_id: uuidv4(),
              pattern_type: 'drift_detection',
              description,
              confidence: Math.abs(drift),
              evidence: [
                `Baseline cost: $${baselineAvgCost.toFixed(4)}`,
                `Recent cost: $${recentAvgCost.toFixed(4)}`,
                `Drift: ${(drift * 100).toFixed(1)}%`,
              ],
              source_tools: ['GOrchestrator'],
              first_observed: new Date().toISOString(),
              observation_count: orchData.run_records.length,
            });
          }
        }
      }
    }

    return patterns;
  }

  /**
   * Detect coverage gaps
   */
  private async detectCoverageGaps(): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    // Check for GMirror coverage gaps
    const mirrorData = this.dataStore.get('GMirror') as GMirrorData | undefined;
    if (mirrorData) {
      const failureRate = mirrorData.verdicts.filter(v => v.overall === 'fail').length / mirrorData.verdicts.length;

      if (failureRate > 0.3) {
        const description = await this.generatePatternDescription({
          pattern_type: 'coverage_gap',
          failure_rate: failureRate,
        });

        patterns.push({
          pattern_id: uuidv4(),
          pattern_type: 'coverage_gap',
          description,
          confidence: failureRate,
          evidence: [
            `Failure rate: ${(failureRate * 100).toFixed(1)}%`,
            `Total verdicts: ${mirrorData.verdicts.length}`,
          ],
          source_tools: ['GMirror'],
          first_observed: new Date().toISOString(),
          observation_count: mirrorData.verdicts.length,
        });
      }
    }

    // Check for GStack skill usage gaps
    const stackData = this.dataStore.get('GStack') as GStackData | undefined;
    if (stackData && Object.keys(stackData.skill_usage).length < 10) {
      const skillCount = Object.keys(stackData.skill_usage).length;
      const description = await this.generatePatternDescription({
        pattern_type: 'coverage_gap',
        skill_count: skillCount,
      });

      patterns.push({
        pattern_id: uuidv4(),
        pattern_type: 'coverage_gap',
        description,
        confidence: 0.6,
        evidence: [
          `Skills used: ${skillCount}`,
          `Expected: 20+ skills`,
        ],
        source_tools: ['GStack'],
        first_observed: new Date().toISOString(),
        observation_count: stackData.runs.length,
      });
    }

    return patterns;
  }

  /**
   * Detect configuration optimization opportunities
   */
  private async detectConfigOptimizations(): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    // Analyze GOrchestrator configuration performance
    const orchData = this.dataStore.get('GOrchestrator') as GOrchestratorData | undefined;
    if (orchData && orchData.configuration_performance) {
      for (const [config, metrics] of Object.entries(orchData.configuration_performance)) {
        if (metrics.avg_cost > 0.5) {
          const description = await this.generatePatternDescription({
            pattern_type: 'configuration_optimization',
            config,
            avg_cost: metrics.avg_cost,
          });

          patterns.push({
            pattern_id: uuidv4(),
            pattern_type: 'configuration_optimization',
            description,
            confidence: metrics.avg_cost / 2,
            evidence: [
              `Avg cost: $${metrics.avg_cost.toFixed(4)}`,
              `Success rate: ${(metrics.success_rate * 100).toFixed(1)}%`,
            ],
            source_tools: ['GOrchestrator'],
            first_observed: new Date().toISOString(),
            observation_count: 1,
            metadata: { config, metrics },
          });
        }
      }
    }

    return patterns;
  }

  private detectRelationalPatterns(): Pattern[] {
    const grouped = this.getRelationalEventsByDyad();
    const patterns: Pattern[] = [];

    for (const [dyadId, events] of grouped.entries()) {
      patterns.push(...this.detectBidCycle(dyadId, events));
      patterns.push(...this.detectLaborDrift(dyadId, events));
      patterns.push(...this.detectRepairWindow(dyadId, events));
      patterns.push(...this.detectAttachmentSignal(dyadId, events));
    }

    return patterns;
  }

  private detectBidCycle(dyadId: string, events: RelationalEvent[]): Pattern[] {
    const bids = events.filter(event => event.type === 'bid');
    const towardResponses = events.filter(event => event.type === 'response' && event.response_type === 'toward');
    const ignoredResponses = events.filter(event => event.type === 'response' && event.response_type === 'ignored');

    if (bids.length < 5 || towardResponses.length > 0) {
      return [];
    }

    return [{
      pattern_id: uuidv4(),
      pattern_type: 'bid_cycle',
      description: 'Recurring bids are appearing without toward acknowledgments, which can create a bid escalation cycle.',
      confidence: ignoredResponses.length > 0 ? 0.82 : 0.78,
      evidence: [
        `Dyad: ${dyadId}`,
        `Bids: ${bids.length}`,
        `Toward responses: ${towardResponses.length}`,
      ],
      source_tools: ['DYAD'],
      first_observed: this.firstTimestamp(events),
      observation_count: bids.length,
      metadata: {
        dyad_id: dyadId,
        bid_count: bids.length,
        toward_response_count: towardResponses.length,
        ignored_response_count: ignoredResponses.length,
      },
    }];
  }

  private detectLaborDrift(dyadId: string, events: RelationalEvent[]): Pattern[] {
    const bids = events.filter((event): event is Extract<RelationalEvent, { type: 'bid' }> => event.type === 'bid');
    if (bids.length < 5) {
      return [];
    }

    const participantABids = bids.filter(event => event.participant === 'a').length;
    const participantBBids = bids.length - participantABids;
    const aRatio = participantABids / bids.length;
    const dominantParticipant = aRatio >= 0.5 ? 'a' : 'b';
    const dominantRatio = Math.max(aRatio, 1 - aRatio);

    if (dominantRatio < 0.8) {
      return [];
    }

    return [{
      pattern_id: uuidv4(),
      pattern_type: 'labor_drift',
      description: 'One participant is carrying most observed bids for connection, suggesting emotional labor may be drifting out of balance.',
      confidence: Math.min(0.95, dominantRatio),
      evidence: [
        `Dyad: ${dyadId}`,
        `Participant a bids: ${participantABids}`,
        `Participant b bids: ${participantBBids}`,
        `Dominant share: ${(dominantRatio * 100).toFixed(1)}%`,
      ],
      source_tools: ['DYAD'],
      first_observed: this.firstTimestamp(events),
      observation_count: bids.length,
      metadata: {
        dyad_id: dyadId,
        participant_a_bid_ratio: aRatio,
        dominant_participant: dominantParticipant,
      },
    }];
  }

  private detectRepairWindow(dyadId: string, events: RelationalEvent[]): Pattern[] {
    const repairs = events.filter((event): event is Extract<RelationalEvent, { type: 'repair_attempt' }> => event.type === 'repair_attempt');
    const successes = repairs.filter(event => event.success);
    if (repairs.length < 3 || successes.length < 2) {
      return [];
    }

    return [{
      pattern_id: uuidv4(),
      pattern_type: 'repair_window',
      description: 'Successful repair attempts recur often enough to preserve a repair window for this dyad.',
      confidence: Math.min(0.9, successes.length / repairs.length),
      evidence: [
        `Dyad: ${dyadId}`,
        `Repair attempts: ${repairs.length}`,
        `Successful repairs: ${successes.length}`,
      ],
      source_tools: ['DYAD'],
      first_observed: this.firstTimestamp(events),
      observation_count: repairs.length,
      metadata: {
        dyad_id: dyadId,
        success_rate: successes.length / repairs.length,
      },
    }];
  }

  private detectAttachmentSignal(dyadId: string, events: RelationalEvent[]): Pattern[] {
    const shifts = events.filter((event): event is Extract<RelationalEvent, { type: 'emotional_shift' }> => event.type === 'emotional_shift');
    const attachmentSignals = shifts.filter(event =>
      /\b(anxious|avoidant|secure|distance|reassur|abandon|safe|closer)\b/i.test(`${event.from} ${event.to}`)
    );

    if (attachmentSignals.length < 2) {
      return [];
    }

    return [{
      pattern_id: uuidv4(),
      pattern_type: 'attachment_signal',
      description: 'Repeated emotional shifts include attachment-related language that may signal reassurance or distance needs.',
      confidence: Math.min(0.85, attachmentSignals.length / Math.max(1, shifts.length)),
      evidence: [
        `Dyad: ${dyadId}`,
        `Attachment-related shifts: ${attachmentSignals.length}`,
      ],
      source_tools: ['DYAD'],
      first_observed: this.firstTimestamp(events),
      observation_count: attachmentSignals.length,
      metadata: {
        dyad_id: dyadId,
      },
    }];
  }

  private getRelationalEventsByDyad(): Map<string, RelationalEvent[]> {
    const grouped = new Map<string, RelationalEvent[]>();

    for (const [tool, data] of this.dataStore.entries()) {
      if (tool.toUpperCase() !== 'DYAD') {
        continue;
      }

      for (const item of this.extractRelationalEvents(data)) {
        const existing = grouped.get(item.dyad_id) || [];
        existing.push(item.event);
        grouped.set(item.dyad_id, existing);
      }
    }

    for (const events of grouped.values()) {
      events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    }

    return grouped;
  }

  private extractRelationalEvents(data: any): Array<{ dyad_id: string; event: RelationalEvent }> {
    if (Array.isArray(data)) {
      return data
        .filter((item): item is LearningRequest => item?.source_tool === 'DYAD' && item?.data_type === 'relational_event' && item?.payload)
        .map(item => ({ dyad_id: item.dyad_id, event: item.payload }));
    }

    if (data?.source === 'dyad' && typeof data.dyad_id === 'string' && Array.isArray(data.events)) {
      return data.events.map((event: RelationalEvent) => ({ dyad_id: data.dyad_id, event }));
    }

    if (Array.isArray(data?.events) && typeof data?.dyad_id === 'string') {
      return data.events.map((event: RelationalEvent) => ({ dyad_id: data.dyad_id, event }));
    }

    return [];
  }

  private firstTimestamp(events: RelationalEvent[]): string {
    const first = events
      .map(event => event.timestamp)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return first || new Date().toISOString();
  }

  /**
   * Calculate correlation between two arrays
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;

    const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denominator = Math.sqrt(denomX) * Math.sqrt(denomY);
    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /**
   * Get all patterns
   */
  getPatterns(): Pattern[] {
    return this.patterns;
  }

  /**
   * Get patterns by type
   */
  getPatternsByType(type: Pattern['pattern_type']): Pattern[] {
    return this.patterns.filter(p => p.pattern_type === type);
  }

  /**
   * Get patterns by source tool
   */
  getPatternsByTool(tool: string): Pattern[] {
    return this.patterns.filter(p => p.source_tools.includes(tool));
  }

  /**
   * Clear patterns
   */
  clearPatterns(): void {
    this.patterns = [];
  }

  /**
   * Get data store
   */
  getDataStore(): Map<string, any> {
    return this.dataStore;
  }

  hydrate(patterns: Pattern[], dataStoreEntries: Array<[string, any]> = []): void {
    this.patterns = [...patterns];
    this.dataStore = new Map(dataStoreEntries);
  }

  /**
   * Generate pattern description using LLM
   */
  private async generatePatternDescription(context: {
    pattern_type: string;
    tools?: string[];
    similarity?: number;
    cluster_size?: number;
    drift?: number;
    failure_rate?: number;
    skill_count?: number;
    config?: string;
    avg_cost?: number;
  }): Promise<string> {
    try {
      const prompt = this.buildDescriptionPrompt(context);
      const result = await this.llmClient.call(prompt, {
        model: this.llmClient.getModelByTier('tier1'),
        maxTokens: 256,
        temperature: 0.5,
      });

      return this.parsePatternDescription(result.content, context);
    } catch (error) {
      coreLogger.warn('Pattern description generation failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.generateFallbackDescription(context);
    }
  }

  private parsePatternDescription(content: string, context: {
    pattern_type: string;
    tools?: string[];
    similarity?: number;
    cluster_size?: number;
    drift?: number;
    failure_rate?: number;
    skill_count?: number;
    config?: string;
    avg_cost?: number;
  }): string {
    const trimmed = content.trim();
    if (!trimmed || trimmed === 'Processed') {
      return this.generateFallbackDescription(context);
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.description === 'string' && parsed.description.trim()) {
        return parsed.description.trim();
      }
    } catch (error) {
      // Plain-text descriptions are allowed.
    }

    return trimmed;
  }

  /**
   * Build prompt for pattern description generation
   */
  private buildDescriptionPrompt(context: {
    pattern_type: string;
    tools?: string[];
    similarity?: number;
    cluster_size?: number;
    drift?: number;
    failure_rate?: number;
    skill_count?: number;
    config?: string;
    avg_cost?: number;
  }): string {
    let prompt = `Generate a concise, technical description for a ${context.pattern_type} pattern. `;

    switch (context.pattern_type) {
      case 'cross_tool_correlation':
        prompt += `Tools involved: ${context.tools?.join(', ')}. Similarity: ${context.similarity?.toFixed(3)}. Cluster size: ${context.cluster_size}.`;
        break;
      case 'drift_detection':
        prompt += `Drift magnitude: ${context.drift?.toFixed(3)}.`;
        break;
      case 'coverage_gap':
        prompt += `Failure rate: ${(context.failure_rate! * 100).toFixed(1)}%.`;
        break;
      case 'configuration_optimization':
        prompt += `Configuration: ${context.config}. Average cost: $${context.avg_cost?.toFixed(4)}.`;
        break;
      default:
        prompt += 'Provide a general description of the pattern.';
    }

    prompt += ' Return only the description, no additional text.';
    return prompt;
  }

  /**
   * Fallback description generation
   */
  private generateFallbackDescription(context: {
    pattern_type: string;
    tools?: string[];
    similarity?: number;
    cluster_size?: number;
    drift?: number;
    failure_rate?: number;
    skill_count?: number;
    config?: string;
    avg_cost?: number;
  }): string {
    switch (context.pattern_type) {
      case 'cross_tool_correlation':
        return `Embedding-based cluster of ${context.tools?.join(', ')} with similarity ${context.similarity?.toFixed(3)}`;
      case 'drift_detection':
        return `Metric drift detected with magnitude ${context.drift?.toFixed(3)}`;
      case 'coverage_gap':
        return `Coverage gap detected with failure rate ${(context.failure_rate! * 100).toFixed(1)}%`;
      case 'configuration_optimization':
        return `High-cost configuration ${context.config} with average cost $${context.avg_cost?.toFixed(4)}`;
      default:
        return 'Pattern detected in tool metrics';
    }
  }
}
