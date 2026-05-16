import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { GLearn } from './core/glearn.js';
import { CSVImportDataSource } from './data-sources/csv-import.js';
import { DemoDataSource } from './data-sources/demo-source.js';
import { LearningRun } from './types/index.js';

export interface LearnSDKOptions {
  apiKey?: string;
}

export class LearnSDK {
  private learn: GLearn;

  constructor(_options: LearnSDKOptions = {}) {
    this.learn = new GLearn({
      // minimal config — no service endpoints required
    });
  }

  async demo(): Promise<LearningRun> {
    const ds = new DemoDataSource();
    const patterns = await ds.load();
    // Inject pre-loaded patterns into the internal pattern miner before running cycle
    (this.learn as any).patternMiner.ingestData('SDK_DEMO', patterns);
    return this.learn.runLearningCycle({});
  }

  async mineFromCsv(csvString: string): Promise<LearningRun> {
    // Write csv to a temp file so CSVImportDataSource can read it
    const tmpPath = path.join(os.tmpdir(), `glearn-sdk-${crypto.randomUUID()}.csv`);
    try {
      fs.writeFileSync(tmpPath, csvString, 'utf-8');
      const ds = new CSVImportDataSource({ filePath: tmpPath });
      const patterns = await ds.load();
      (this.learn as any).patternMiner.ingestData('SDK_CSV', patterns);
      return this.learn.runLearningCycle({});
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    }
  }

  getPatterns() {
    return this.learn.getPatterns?.() ?? [];
  }

  async getProposals() {
    const patterns = this.getPatterns();
    return this.learn.getProposals?.(patterns) ?? Promise.resolve([]);
  }
}

export { GLearn };
export { CSVImportDataSource };
export { DemoDataSource };
