// Create a sample CSV string inline, load it via CSVImportDataSource,
// and run a GLearn learning cycle to mine patterns from it.
//
// CSVImportDataSource reads a CSV file and returns Pattern objects.
// GLearn.runLearningCycle() then mines proposals from those patterns.
//
// Setup: npm install && npm run build  (in glearn/)
// Env vars:
//   ANTHROPIC_API_KEY  (required for LLM-based pattern mining)
//
// Usage: node examples/mine-from-csv.js

import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Inline sample CSV — no external file needed
const sampleCsv = `id,pattern,context,created_at
csv-001,High latency when concurrency exceeds 5 tasks,gorchestrator performance,2024-01-15
csv-002,LLM cost spikes at temperature > 0.9,gagent cost anomaly,2024-01-16
csv-003,Error handling missing in 40% of generated code,gmirror quality gap,2024-01-17
csv-004,Retry storms when circuit breaker threshold too low,gorchestrator resilience,2024-01-18
`;

// Write CSV to a temp file (CSVImportDataSource expects a file path)
const tmpFile = join(tmpdir(), `glearn-example-${Date.now()}.csv`);
writeFileSync(tmpFile, sampleCsv, 'utf-8');

async function main() {
  let GLearn, CSVImportDataSource;
  try {
    // Try compiled dist first, fall back to source
    ({ GLearn } = require('../dist/core/glearn.js'));
    ({ CSVImportDataSource } = require('../dist/data-sources/csv-import.js'));
  } catch {
    console.log('Built dist not found — run "npm run build" in glearn/ first.');
    console.log('\nWhat this example does:');
    console.log('  1. Writes sample patterns to a temp CSV file');
    console.log('  2. Loads them via CSVImportDataSource');
    console.log('  3. Calls GLearn.runLearningCycle() to mine proposals');
    unlinkSync(tmpFile);
    process.exit(0);
  }

  console.log(`Wrote sample CSV to ${tmpFile}`);

  const dataSource = new CSVImportDataSource({
    filePath: tmpFile,
    idColumn: 'id',
    patternColumn: 'pattern',
    contextColumn: 'context',
    createdAtColumn: 'created_at',
  });

  const patterns = await dataSource.load();
  console.log(`\nLoaded ${patterns.length} patterns from CSV:`);
  patterns.forEach(p => console.log(`  - [${p.pattern_id}] ${p.description}`));

  const glearn = new GLearn({ patterns });

  console.log('\nRunning learning cycle...');
  const result = await glearn.runLearningCycle({ priority: 'normal' });

  console.log('\nLearning cycle result:');
  console.log(`  Status:   ${result.status}`);
  console.log(`  Patterns: ${result.patterns_mined ?? 0} mined`);
  console.log(`  Cost USD: ${result.cost_usd ?? 0}`);

  unlinkSync(tmpFile);
  process.exit(0);
}

main().catch((err) => {
  try { unlinkSync(tmpFile); } catch { /* ignore */ }
  console.error('Unexpected error:', err);
  process.exit(1);
});
