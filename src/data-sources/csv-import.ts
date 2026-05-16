import * as crypto from 'crypto';
import { Pattern } from '../types/index.js';

export interface CSVImportDataSourceConfig {
  filePath: string;
  idColumn?: string;
  patternColumn?: string;
  metadataColumn?: string;
  contextColumn?: string;
  createdAtColumn?: string;
}

export class CSVImportDataSource {
  constructor(private config: CSVImportDataSourceConfig) {}

  async load(): Promise<Pattern[]> {
    const fs = await import('fs/promises');
    const csv = await import('csv-parse/sync');
    
    const content = await fs.readFile(this.config.filePath, 'utf-8');
    const records = csv.parse(content, {
      columns: true,
      skip_empty_lines: true,
    });

    return records.map((record: any) => ({
      pattern_id: record[this.config.idColumn || 'id'] || crypto.randomUUID(),
      pattern_type: 'configuration_optimization',
      description: record[this.config.patternColumn || 'pattern'] || '',
      confidence: 0.7,
      first_observed: record[this.config.createdAtColumn || 'created_at'] || new Date().toISOString(),
      observation_count: 1,
      metadata: this.config.metadataColumn && record[this.config.metadataColumn]
        ? JSON.parse(record[this.config.metadataColumn])
        : { source: 'csv-import', context: record[this.config.contextColumn || 'context'] || '' },
    }));
  }
}
