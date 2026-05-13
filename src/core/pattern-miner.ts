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
} from '../types/index.js';

/**
 * Pattern Miner
 * 
 * Responsibilities:
 * - Ingest data from all tools
 * - Detect cross-tool correlations
 * - Identify drift in metrics
 * - Find coverage gaps
 * - Extract higher-order patterns
 */
export class PatternMiner {
  private dataStore: Map<string, any>;
  private patterns: Pattern[];

  constructor() {
    this.dataStore = new Map();
    this.patterns = [];
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

    // Cross-tool correlations
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

    this.patterns = patterns;
    return patterns;
  }

  /**
   * Detect cross-tool correlations
   */
  private async detectCrossToolCorrelations(): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    // Correlate GOrchestrator success rates with GMirror scores
    const orchData = this.dataStore.get('GOrchestrator') as GOrchestratorData | undefined;
    const mirrorData = this.dataStore.get('GMirror') as GMirrorData | undefined;

    if (orchData && mirrorData) {
      const correlation = this.calculateCorrelation(
        orchData.run_records.map(r => r.total_cost_usd),
        mirrorData.verdicts.map(v => v.correctness)
      );

      if (Math.abs(correlation) > 0.5) {
        patterns.push({
          pattern_id: uuidv4(),
          pattern_type: 'cross_tool_correlation',
          description: `Correlation between GOrchestrator cost and GMirror correctness: ${correlation.toFixed(3)}`,
          confidence: Math.abs(correlation),
          evidence: [
            `Correlation coefficient: ${correlation.toFixed(3)}`,
            `Sample size: ${orchData.run_records.length}`,
          ],
          source_tools: ['GOrchestrator', 'GMirror'],
          first_observed: new Date().toISOString(),
          observation_count: orchData.run_records.length,
        });
      }
    }

    // Correlate GToM vulnerability with GStack success
    const gtomData = this.dataStore.get('GToM') as GToMData | undefined;
    const stackData = this.dataStore.get('GStack') as GStackData | undefined;

    if (gtomData && stackData) {
      const avgVuln = gtomData.vulnerability_states.reduce(
        (sum, s) => sum + s.overall_vulnerability,
        0
      ) / gtomData.vulnerability_states.length;

      const avgSuccess = stackData.runs.filter(r => r.success).length / stackData.runs.length;

      if (avgVuln > 0.7 && avgSuccess < 0.5) {
        patterns.push({
          pattern_id: uuidv4(),
          pattern_type: 'cross_tool_correlation',
          description: 'High vulnerability correlates with low GStack success rate',
          confidence: 0.7,
          evidence: [
            `Avg vulnerability: ${avgVuln.toFixed(3)}`,
            `Avg success rate: ${avgSuccess.toFixed(3)}`,
          ],
          source_tools: ['GToM', 'GStack'],
          first_observed: new Date().toISOString(),
          observation_count: gtomData.vulnerability_states.length,
        });
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
            patterns.push({
              pattern_id: uuidv4(),
              pattern_type: 'drift_detection',
              description: `GToM vulnerability drift detected: ${drift.toFixed(3)}`,
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
            patterns.push({
              pattern_id: uuidv4(),
              pattern_type: 'drift_detection',
              description: `GOrchestrator cost drift detected: ${(drift * 100).toFixed(1)}%`,
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
        patterns.push({
          pattern_id: uuidv4(),
          pattern_type: 'coverage_gap',
          description: `High GMirror failure rate indicates coverage gap: ${(failureRate * 100).toFixed(1)}%`,
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
      patterns.push({
        pattern_id: uuidv4(),
        pattern_type: 'coverage_gap',
        description: `Limited GStack skill diversity: ${Object.keys(stackData.skill_usage).length} skills used`,
        confidence: 0.6,
        evidence: [
          `Skills used: ${Object.keys(stackData.skill_usage).length}`,
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
          patterns.push({
            pattern_id: uuidv4(),
            pattern_type: 'configuration_optimization',
            description: `High-cost configuration detected: ${config}`,
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
}
