import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createEngine } from '../src/core/engine-factory';
import { PostgreSQLEngine } from '../src/core/postgres-engine';
import { GLearnPersistenceManager } from '../src/core/glearn-persistence';
import { mockPattern, mockProposal } from './fixtures';

describe('GLearn persistence parity', () => {
  it('runs migrations, persists learning state, exports JSON, and restores backups', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glearn-persistence-'));
    const dbPath = path.join(dir, 'glearn.db');
    const manager = new GLearnPersistenceManager(dbPath);

    manager.transaction(() => {
      manager.replacePatterns([mockPattern]);
      manager.replaceProposals([mockProposal]);
      manager.replaceDataStore([['GBrain', { pages: [{ page_id: 'p1', content: 'memo', entities: [], links: [] }] }]]);
      manager.saveEscalationMetrics({ total_tasks: 1, tier1_count: 1 });
      manager.addLlmCall({
        model_id: 'claude-haiku-4-5',
        input_tokens: 20,
        output_tokens: 5,
        cost_usd: 0.002,
        operation: 'learning_cycle_llm',
      });
      manager.addCostEntry({
        operation: 'learning_cycle_llm',
        model_id: 'claude-haiku-4-5',
        cost_usd: 0.002,
      });
    });

    const backupPath = manager.backup(path.join(dir, 'backup.db'));
    const exported = manager.exportJson();
    expect(exported.schema_version).toBe(2);
    expect(exported.patterns[0].pattern_id).toBe(mockPattern.pattern_id);
    expect(exported.proposals[0].proposal_id).toBe(mockProposal.proposal_id);
    expect(exported.data_store.GBrain.pages).toHaveLength(1);
    expect(exported.escalation_metrics.total_tasks).toBe(1);
    expect(exported.llm_call_history).toHaveLength(1);
    expect(exported.cost_ledger).toHaveLength(1);
    manager.close();

    const restored = new GLearnPersistenceManager(path.join(dir, 'restored.db'));
    restored.restore(backupPath);
    expect(restored.getPattern(mockPattern.pattern_id)?.description).toBe(mockPattern.description);
    expect(restored.getAllProposals()[0].proposal_id).toBe(mockProposal.proposal_id);
    expect(restored.getDataStoreEntries()[0][0]).toBe('GBrain');
    restored.close();
  });

  it('wires the Postgres adapter and read-replica configuration through the engine factory', () => {
    const engine = createEngine({
      type: 'postgres',
      connectionString: 'postgresql://writer/glearn',
      readConnectionString: 'postgresql://reader/glearn',
    });
    expect(engine).toBeInstanceOf(PostgreSQLEngine);
  });
});
