import * as crypto from 'crypto';
import { Pattern } from '../types/index.js';

export interface JSONImportDataSourceConfig {
  filePath: string;
}

export class JSONImportDataSource {
  constructor(private config: JSONImportDataSourceConfig) {}

  async load(): Promise<Pattern[]> {
    const fs = await import('fs/promises');
    
    const content = await fs.readFile(this.config.filePath, 'utf-8');
    const records = JSON.parse(content);
    const patterns = Array.isArray(records) ? records : [records];

    return patterns.map((record: any) => ({
      pattern_id: record.pattern_id || record.id || crypto.randomUUID(),
      pattern_type: record.pattern_type || 'configuration_optimization',
      description: record.description || record.pattern || '',
      confidence: record.confidence || 0.7,
      first_observed: record.first_observed || record.created_at || new Date().toISOString(),
      observation_count: record.observation_count || 1,
      evidence: record.evidence || [],
      source_tools: record.source_tools || [],
      metadata: record.metadata || { source: 'json-import' },
    }));
  }
}
