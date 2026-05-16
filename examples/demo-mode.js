// Show `glearn run --demo` equivalent in code using DemoDataSource.
// DemoDataSource provides built-in sample patterns without requiring
// any external data, API keys, or running services.
//
// This is the recommended first step to verify glearn is working.
// Equivalent CLI: glearn run --demo
//
// Setup: npm install && npm run build  (in glearn/)
// No additional env vars required — DemoDataSource uses static data.
//
// Usage: node examples/demo-mode.js

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

async function main() {
  let GLearn, DemoDataSource;
  try {
    ({ GLearn } = require('../dist/core/glearn.js'));
    ({ DemoDataSource } = require('../dist/data-sources/demo-source.js'));
  } catch {
    // Try index exports
    try {
      const mod = require('../dist/index.js');
      DemoDataSource = mod.DemoDataSource;
      ({ GLearn } = require('../dist/core/glearn.js'));
    } catch {
      console.log('Built dist not found — run "npm run build" in glearn/ first.');
      console.log('\nEquivalent to CLI:  glearn run --demo');
      console.log('\nDemoDataSource provides these built-in patterns:');
      console.log('  - High latency when parallel execution > 5 tasks');
      console.log('  - LLM cost spikes at temperature > 0.9');
      console.log('  - Error handling missing in 40% of generated code');
      process.exit(0);
    }
  }

  console.log('--- GLearn Demo Mode ---');
  console.log('(Equivalent to: glearn run --demo)\n');

  // Load demo patterns — no file or API needed
  const demoSource = new DemoDataSource();
  const patterns = await demoSource.load();

  console.log(`Loaded ${patterns.length} demo pattern(s):`);
  patterns.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.description}`);
    console.log(`       confidence=${p.confidence}, observations=${p.observation_count}`);
  });

  // Create GLearn instance seeded with demo patterns
  const glearn = new GLearn({ patterns });

  console.log('\nRunning learning cycle with demo data...');
  const result = await glearn.runLearningCycle({ priority: 'normal' });

  console.log('\nLearning cycle result:');
  console.log(`  Status:    ${result.status}`);
  console.log(`  Patterns:  ${result.patterns_mined ?? patterns.length}`);
  if (result.proposals?.length) {
    console.log(`  Proposals: ${result.proposals.length}`);
    result.proposals.slice(0, 3).forEach(p => {
      console.log(`    - ${p.description ?? p.title ?? JSON.stringify(p).slice(0, 60)}`);
    });
  }

  console.log('\nDemo mode complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
