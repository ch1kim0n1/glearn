#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { GLearn } from './core/glearn.js';
import { GBrainIntegrationClient } from './core/gbrain-integration.js';
import { GStackGBrainSync } from './core/gstack-gbrain-sync.js';
import { GLearnPersistenceManager } from './core/glearn-persistence.js';
import type { MultiModelConfig } from './types/index.js';
import {
  getDefaultSecretManager,
  sanitizeCliFloat,
  sanitizeCliInteger,
  sanitizeCliPath,
  sanitizeCliString,
  sanitizeCliUrl,
} from './core/security.js';
import { runAnalyzeCommand } from './commands/analyze.js';

function requireServices(commandName: string): void {
  const enabled = process.env.GBRAIN_ENABLED === 'true' || process.env.GSTACK_ENABLED === 'true';
  if (!enabled) {
    console.error(`'${commandName}' requires external services (GBrain, GStack).`);
    console.error('');
    console.error('For standalone use without services, try:');
    console.error('  glearn analyze --file receipts.jsonl');
    console.error('  glearn analyze --dir ./baselines/');
    console.error('');
    console.error('To enable services, set GBRAIN_ENABLED=true in .env and run ./start-all.sh');
    process.exit(1);
  }
}

const program = new Command();

program
  .name('glearn')
  .description('Meta-learning and reflective layer for the G-Stack')
  .version('0.1.0');

program
  .command('backup [destination]')
  .description('Backup GLearn SQLite state')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (destination, options) => {
    const persistence = new GLearnPersistenceManager();
    try {
      const backupPath = persistence.backup(destination);
      if (options.json) {
        console.log(JSON.stringify({ backup_path: backupPath }, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green(`Backup written: ${backupPath}`));
      }
    } finally {
      persistence.close();
    }
  });

program
  .command('restore <backup>')
  .description('Restore GLearn SQLite state from backup')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (backup, options) => {
    const persistence = new GLearnPersistenceManager();
    try {
      persistence.restore(backup);
      if (options.json) {
        console.log(JSON.stringify({ restored_from: backup }, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green(`Restored from: ${backup}`));
      }
    } finally {
      persistence.close();
    }
  });

program
  .command('export')
  .description('Export persisted GLearn state')
  .option('--format <format>', 'Export format: json', 'json')
  .option('--json', 'Alias for --format json')
  .action(async (options) => {
    const format = options.json ? 'json' : String(options.format || 'json').toLowerCase();
    if (format !== 'json') {
      console.error(chalk.red(`Unsupported export format: ${format}`));
      process.exit(1);
    }

    const persistence = new GLearnPersistenceManager();
    try {
      console.log(JSON.stringify(persistence.exportJson(), null, 2));
    } finally {
      persistence.close();
    }
  });

const secretsCommand = program
  .command('secrets')
  .description('Manage local GLearn secrets');

secretsCommand
  .command('list')
  .description('List configured secret names without values')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action((options) => {
    const secrets = getDefaultSecretManager();
    const records = secrets.list();
    if (options.json) {
      console.log(JSON.stringify(records, null, 2));
      return;
    }
    if (!options.quiet) {
      for (const record of records) {
        console.log(`${record.name} v${record.version} ${record.source} ${record.rotated_at}`);
      }
    }
  });

secretsCommand
  .command('rotate <name>')
  .description('Rotate or create a local secret')
  .option('--value <value>', 'Explicit secret value; otherwise one is generated')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action((name, options) => {
    try {
      const secrets = getDefaultSecretManager();
      const value = options.value === undefined
        ? undefined
        : sanitizeCliString(options.value, 'secret value', 20000);
      const record = secrets.rotate(sanitizeCliString(name, 'secret name', 128), value);
      const result = {
        name: record.name,
        version: record.version,
        rotated_at: record.rotated_at,
        path: secrets.pathFor(record.name),
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green(`Secret rotated: ${result.name} v${result.version}`));
        console.log(chalk.gray(`Stored at: ${result.path}`));
      }
    } catch (error) {
      console.error(chalk.red(`[GLearn] ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// Run learning cycle
program
  .command('run')
  .description('Run a learning cycle to mine patterns and generate proposals')
  .option('--counterfactual', 'Run counterfactual evaluation on proposals')
  .option('--cycles <number>', 'Number of learning cycles to run', '1')
  .option('--budget-usd <amount>', 'Maximum learning budget in USD', '10')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--gstack <url>', 'GStack endpoint', 'http://localhost:3001')
  .option('--gorchestrator <url>', 'GOrchestrator endpoint', 'http://localhost:3001')
  .option('--gmirror <url>', 'GMirror endpoint', 'http://localhost:3002')
  .option('--gtom <url>', 'GToM endpoint', 'http://localhost:3003')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    requireServices('run');
    const endpoints = sanitizeEndpointOptions(options);
    const cycles = parsePositiveInteger(options.cycles, '--cycles', 1, 100);
    const budgetUsd = parsePositiveNumber(options.budgetUsd, '--budget-usd');
    const multiModelConfig = buildMultiModelConfig(budgetUsd);
    const glearn = new GLearn({
      gbrainEndpoint: endpoints.gbrain,
      gstackEndpoint: endpoints.gstack,
      gorchestratorEndpoint: endpoints.gorchestrator,
      gmirrorEndpoint: endpoints.gmirror,
      gtomEndpoint: endpoints.gtom,
      multiModelConfig,
    });

    try {
      const cycleResults = [];
      if (!options.quiet && !options.json) {
        console.log(chalk.blue.bold('[GLearn] Starting learning cycle'));
        console.log(chalk.gray(`Counterfactual evaluation: ${options.counterfactual}`));
        console.log(chalk.gray(`Cycles: ${cycles}`));
        console.log(chalk.gray(`Budget: $${budgetUsd.toFixed(2)}`));
      }

      for (let cycle = 0; cycle < cycles; cycle++) {
        if (cycles > 1 && !options.quiet && !options.json) {
          console.log(chalk.gray(`Cycle ${cycle + 1}/${cycles}`));
        }
        const result = await glearn.runLearningCycle({
          run_counterfactual: options.counterfactual,
        });
        cycleResults.push({
          cycle: cycle + 1,
          status: result.status,
          patterns_found: result.patterns_found,
          proposals_generated: result.proposals_generated,
          evaluations_completed: result.evaluations_completed,
          duration_ms: result.completed_at ? new Date(result.completed_at).getTime() - new Date(result.started_at).getTime() : 0,
          error_message: result.error_message,
        });
      }

      const completed = cycleResults.filter(result => result.status === 'completed').length;
      const output = cycles === 1 ? cycleResults[0] : {
        cycles,
        budget_usd: budgetUsd,
        completed,
        failed: cycleResults.length - completed,
        avg_patterns_found: cycleResults.reduce((sum, r) => sum + r.patterns_found, 0) / cycleResults.length,
        avg_proposals_generated: cycleResults.reduce((sum, r) => sum + r.proposals_generated, 0) / cycleResults.length,
        avg_evaluations_completed: cycleResults.reduce((sum, r) => sum + r.evaluations_completed, 0) / cycleResults.length,
        avg_duration_ms: cycleResults.reduce((sum, r) => sum + r.duration_ms, 0) / cycleResults.length,
        results: cycleResults,
      };
      const latest = cycleResults[cycleResults.length - 1];

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.green.bold('\n[GLearn] Learning cycle completed'));
        console.log(chalk.gray(`Status: ${latest.status}`));
        console.log(chalk.gray(`Patterns found: ${latest.patterns_found}`));
        console.log(chalk.gray(`Proposals generated: ${latest.proposals_generated}`));
        console.log(chalk.gray(`Evaluations completed: ${latest.evaluations_completed}`));
        console.log(chalk.gray(`Duration: ${latest.duration_ms}ms`));

        if (cycles > 1) {
          console.log(chalk.gray(`Completed cycles: ${completed}/${cycles}`));
        }

        if (latest.status === 'failed') {
          console.log(chalk.red(`Error: ${latest.error_message}`));
        }
      }

      process.exit(completed === cycleResults.length ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('[GLearn] Learning cycle failed:'), error);
      process.exit(1);
    }
  });

// List patterns
program
  .command('patterns')
  .description('List discovered patterns')
  .option('--type <type>', 'Filter by pattern type')
  .option('--tool <tool>', 'Filter by source tool')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const glearn = new GLearn();
    const patterns = glearn.getPatterns();

    let filtered = patterns;
    if (options.type) {
      filtered = filtered.filter(p => p.pattern_type === options.type);
    }
    if (options.tool) {
      filtered = filtered.filter(p => p.source_tools.includes(options.tool));
    }

    if (options.json) {
      console.log(JSON.stringify(filtered, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.bold('Discovered Patterns:'));
      for (const pattern of filtered) {
        console.log(`  ${pattern.pattern_type}: ${pattern.description}`);
        console.log(`    Confidence: ${pattern.confidence.toFixed(3)}`);
        console.log(`    Source tools: ${pattern.source_tools.join(', ')}`);
      }
    }

    process.exit(0);
  });

// List proposals
program
  .command('proposals')
  .description('List generated proposals')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const glearn = new GLearn();
    const patterns = glearn.getPatterns();
    const proposals = await glearn.getProposals(patterns);

    if (options.json) {
      console.log(JSON.stringify(proposals, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.bold('Generated Proposals:'));
      for (const proposal of proposals) {
        console.log(`  ${proposal.proposal_type} for ${proposal.target_tool}:`);
        console.log(`    Target: ${proposal.target_component}`);
        console.log(`    Rationale: ${proposal.rationale}`);
        console.log(`    Expected improvement: ${(proposal.expected_impact.improvement * 100).toFixed(1)}%`);
        console.log(`    Risk level: ${proposal.risk_assessment.risk_level}`);
        console.log(`    Status: ${proposal.status}`);
      }
    }

    process.exit(0);
  });

// Approve proposal
program
  .command('approve')
  .description('Approve a proposal')
  .requiredOption('-p, --proposal-id <id>', 'Proposal ID')
  .option('-r, --reviewer <name>', 'Reviewer name', 'user')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const proposalId = sanitizeCliString(options.proposalId, '--proposal-id', 256);
    const reviewer = sanitizeCliString(options.reviewer, '--reviewer', 128);
    const glearn = new GLearn();
    const result = glearn.approveProposal(proposalId, reviewer);

    const output = {
      proposal_id: proposalId,
      reviewer,
      status: result ? 'approved' : 'failed',
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else if (result && !options.quiet) {
      console.log(chalk.green(`[GLearn] Proposal ${proposalId} approved by ${reviewer}`));
    } else if (!result && !options.quiet) {
      console.error(chalk.red(`[GLearn] Failed to approve proposal ${proposalId}`));
    }

    process.exit(result ? 0 : 1);
  });

// Reject proposal
program
  .command('reject')
  .description('Reject a proposal')
  .requiredOption('-p, --proposal-id <id>', 'Proposal ID')
  .option('-r, --reviewer <name>', 'Reviewer name', 'user')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const proposalId = sanitizeCliString(options.proposalId, '--proposal-id', 256);
    const reviewer = sanitizeCliString(options.reviewer, '--reviewer', 128);
    const glearn = new GLearn();
    const result = glearn.rejectProposal(proposalId, reviewer);

    const output = {
      proposal_id: proposalId,
      reviewer,
      status: result ? 'rejected' : 'failed',
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else if (result && !options.quiet) {
      console.log(chalk.green(`[GLearn] Proposal ${proposalId} rejected by ${reviewer}`));
    } else if (!result && !options.quiet) {
      console.error(chalk.red(`[GLearn] Failed to reject proposal ${proposalId}`));
    }

    process.exit(result ? 0 : 1);
  });

// Health check
program
  .command('health')
  .description('Check health of GLearn and dependencies')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--gstack <url>', 'GStack endpoint', 'http://localhost:3001')
  .option('--gorchestrator <url>', 'GOrchestrator endpoint', 'http://localhost:3001')
  .option('--gmirror <url>', 'GMirror endpoint', 'http://localhost:3002')
  .option('--gtom <url>', 'GToM endpoint', 'http://localhost:3003')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    requireServices('health');
    const endpoints = sanitizeEndpointOptions(options);
    const glearn = new GLearn({
      gbrainEndpoint: endpoints.gbrain,
      gstackEndpoint: endpoints.gstack,
      gorchestratorEndpoint: endpoints.gorchestrator,
      gmirrorEndpoint: endpoints.gmirror,
      gtomEndpoint: endpoints.gtom,
    });

    const health = await glearn.healthCheck();
    const components = Object.fromEntries(
      health.map((check) => [check.service, check.healthy ? 'ok' : 'error'])
    ) as Record<string, 'ok' | 'error'>;
    const status = health.every((check) => check.healthy) ? 'healthy' : 'unhealthy';

    if (options.json) {
      console.log(JSON.stringify({ status, components, checks: health }, null, 2));
    } else if (!options.quiet) {
      console.log(chalk.bold('GLearn Health Check'));
      console.log(chalk.gray(`Status: ${status}`));
      console.log('');
      console.log('Components:');
      console.log(`  Pattern Miner: ${components.pattern_miner === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Proposal Generator: ${components.proposal_generator === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Counterfactual Evaluator: ${components.counterfactual_evaluator === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  GBrain: ${components.gbrain === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  GStack: ${components.gstack === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  GOrchestrator: ${components.gorchestrator === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  GMirror: ${components.gmirror === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  GToM: ${components.gtom === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    }

    process.exit(status === 'healthy' ? 0 : 1);
  });

program
  .command('sync')
  .description('Sync GLearn and stack tool sources into GBrain')
  .option('--incremental', 'Run incremental sync (default)')
  .option('--full', 'Run full sync and clean legacy source registrations')
  .option('--dry-run', 'Show planned sync without writing files or registering sources')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    requireServices('sync');
    const mode = options.full ? 'full' : 'incremental';
    const sync = new GStackGBrainSync();

    if (!options.quiet && !options.json) {
      console.log(chalk.blue(`[GLearn] Syncing stack sources (${mode}${options.dryRun ? ', dry run' : ''})`));
    }

    const result = await sync.run({ mode, dryRun: options.dryRun });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!options.quiet) {
      for (const stage of result.stages) {
        const color = stage.status === 'ok' ? 'green' : stage.status === 'skipped' ? 'yellow' : 'red';
        console.log(`  ${chalk[color](stage.status.padEnd(7))} ${stage.stage}: ${stage.items_changed}/${stage.items_total} changed`);
        if (stage.error) console.log(`    ${chalk.red(stage.error)}`);
      }
      const statusColor = result.status === 'ok' ? 'green' : result.status === 'partial' ? 'yellow' : 'red';
      console.log(chalk[statusColor](`[GLearn] Sync ${result.status}`));
    }

    process.exit(result.status === 'ok' ? 0 : 1);
  });

// Eval mode
program
  .command('eval')
  .description('Run evaluation on pattern mining performance')
  .argument('[mode]', 'Optional mode, e.g. regress')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--against <receipt>', 'Receipt path or ID to compare against in regress mode')
  .option('--cycles <number>', 'Number of cycles to run for statistical comparison', '1')
  .option('--budget-usd <amount>', 'Maximum learning budget in USD', '10')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--gstack <url>', 'GStack endpoint', 'http://localhost:3001')
  .option('--gorchestrator <url>', 'GOrchestrator endpoint', 'http://localhost:3001')
  .option('--gmirror <url>', 'GMirror endpoint', 'http://localhost:3002')
  .option('--gtom <url>', 'GToM endpoint', 'http://localhost:3003')
  .option('-o, --output <path>', 'Write output to file (JSON format)')
  .option('--json', 'Output as JSON to stdout')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (mode, options) => {
    if (mode === 'regress') {
      await runReceiptRegression(options.against, options);
      return;
    }

    requireServices('eval');
    const endpoints = sanitizeEndpointOptions(options);
    const budgetUsd = parsePositiveNumber(options.budgetUsd, '--budget-usd');
    const glearn = new GLearn({
      gbrainEndpoint: endpoints.gbrain,
      gstackEndpoint: endpoints.gstack,
      gorchestratorEndpoint: endpoints.gorchestrator,
      gmirrorEndpoint: endpoints.gmirror,
      gtomEndpoint: endpoints.gtom,
      multiModelConfig: buildMultiModelConfig(budgetUsd),
    });

    try {
      if (!options.corpus) {
        console.error(chalk.red('[GLearn] --corpus is required'));
        process.exit(1);
      }

      const cycles = parsePositiveInteger(options.cycles, '--cycles', 1, 100);
      const fs = await import('fs/promises');
      const corpusContent = await fs.readFile(sanitizeCliPath(options.corpus, '--corpus'), 'utf-8');
      const corpus = JSON.parse(corpusContent);

      const allResults = [];
      for (let cycle = 0; cycle < cycles; cycle++) {
        if (!options.quiet && !options.json) {
          console.log(chalk.gray(`Cycle ${cycle + 1}/${cycles}`));
        }
        const result = await glearn.runLearningCycle({
          run_counterfactual: false,
        });

        allResults.push({
          patterns_found: result.patterns_found,
          proposals_generated: result.proposals_generated,
          evaluations_completed: result.evaluations_completed,
          status: result.status,
          duration_ms: result.completed_at ? new Date(result.completed_at).getTime() - new Date(result.started_at).getTime() : 0,
        });
      }

      // Calculate statistical summary
      const summary = {
        cycles: cycles,
        budget_usd: budgetUsd,
        corpus_size: corpus.length,
        avg_patterns_found: allResults.reduce((sum, r) => sum + r.patterns_found, 0) / allResults.length,
        avg_proposals_generated: allResults.reduce((sum, r) => sum + r.proposals_generated, 0) / allResults.length,
        avg_evaluations_completed: allResults.reduce((sum, r) => sum + r.evaluations_completed, 0) / allResults.length,
        avg_duration_ms: allResults.reduce((sum, r) => sum + r.duration_ms, 0) / allResults.length,
        std_duration_ms: calculateStdDev(allResults.map(r => r.duration_ms)),
        results_by_cycle: allResults,
      };

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else if (options.output) {
        const outputPath = sanitizeCliPath(options.output, '--output');
        await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
        if (!options.quiet) {
          console.log(chalk.green(`[GLearn] Results written to ${outputPath}`));
        }
      } else {
        if (!options.quiet) {
          console.log(chalk.blue.bold('[GLearn] Running evaluation'));
          console.log(chalk.green.bold('\n[GLearn] Evaluation completed'));
          console.log(chalk.gray(`Cycles: ${summary.cycles}`));
          console.log(chalk.gray(`Budget: $${summary.budget_usd.toFixed(2)}`));
          console.log(chalk.gray(`Avg patterns found: ${summary.avg_patterns_found.toFixed(2)}`));
          console.log(chalk.gray(`Avg proposals generated: ${summary.avg_proposals_generated.toFixed(2)}`));
          console.log(chalk.gray(`Avg evaluations completed: ${summary.avg_evaluations_completed.toFixed(2)}`));
          console.log(chalk.gray(`Avg duration: ${summary.avg_duration_ms.toFixed(2)}ms (±${summary.std_duration_ms.toFixed(2)}ms)`));
        }
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Evaluation failed:'), error);
      process.exit(1);
    }
  });

function calculateStdDev(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

// Stats command
program
  .command('stats')
  .description('Show statistics from recent learning cycles')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    requireServices('stats');
    try {
      const gbrain = new GBrainIntegrationClient({
        endpoint: sanitizeCliUrl(options.gbrain, '--gbrain'),
      });
      const stats = await gbrain.getGlearnStats();
      
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GLearn] Fetching statistics'));
        console.log(chalk.green.bold('\n[GLearn] Statistics'));
        console.log(chalk.gray(`Total cycles: ${Number(stats.total_cycles || 0)}`));
        console.log(chalk.gray(`Patterns found: ${Number(stats.total_patterns || 0)}`));
        console.log(chalk.gray(`Proposals generated: ${Number(stats.total_proposals || 0)}`));
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Stats failed:'), error);
      console.log(chalk.yellow('[GLearn] Stats endpoint requires additional setup - see TESTING.md for implementation guidance'));
      process.exit(0);
    }
  });

// Drift command
program
  .command('drift')
  .description('Check for pattern drift over time')
  .option('--corpus <path>', 'Path to corpus directory for drift data', './.gbrain-corpus')
  .option('--window <duration>', 'Current analysis window, e.g. 7d, 24h, 30m', '7d')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      const { ReceiptRegistry } = await import('./core/receipt-registry.js');
      const { analyzeCohortDrift, executionReceiptToCohortSnapshot, parseWindowDuration } = await import('./core/drift-analysis.js');
      const windowMs = parseWindowDuration(sanitizeCliString(options.window, '--window', 32));
      const registry = new ReceiptRegistry('glearn');
      const end = new Date();
      const start = new Date(end.getTime() - windowMs * 2);
      const receipts = await registry.getAllBetween(start, end);
      const snapshots = receipts.map(executionReceiptToCohortSnapshot);
      const driftResults = analyzeCohortDrift(snapshots, { windowMs, now: end, seed: 'glearn-drift' });
      const alerts = driftResults.filter(result =>
        result.anomalies.length > 0 || result.frustration_wilson_95_ci.degraded,
      );

      if (options.json) {
        console.log(JSON.stringify({
          window: options.window,
          cohorts: driftResults,
          drift_results: driftResults,
          alerts,
        }, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GLearn] Checking for pattern drift'));
        console.log(chalk.green.bold('\n[GLearn] Drift Analysis'));
        console.log(chalk.gray(`Window: ${options.window}`));
        console.log(chalk.gray(`Receipts checked: ${receipts.length}`));
        console.log(chalk.gray(`Cohorts tracked: ${driftResults.length}`));
        console.log(chalk.gray(`Drift detected: ${alerts.length > 0 ? 'Yes' : 'No'}`));
        
        if (driftResults.length > 0) {
          console.log(chalk.bold('\nDrift Results:'));
          for (const result of driftResults) {
            const status = result.anomalies.length > 0 || result.frustration_wilson_95_ci.degraded ? chalk.red('ALERT') : chalk.green('OK');
            console.log(`  ${status} ${result.cohort}: samples=${result.sample_size} anomalies=${result.anomalies.length} new=${result.brand_new}`);
          }
        }

        if (alerts.length > 0) {
          console.log(chalk.red.bold('\nAlerts:'));
          for (const alert of alerts) {
            console.log(`  ${alert.cohort}: ${alert.anomalies.map((anomaly: any) => `${anomaly.metric}:${anomaly.reason}`).join(', ') || 'receipt_verdict_wilson_degraded'}`);
          }
        }
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Drift check failed:'), error);
      process.exit(1);
    }
  });

// Replay command
program
  .command('replay')
  .description('Replay a previous learning cycle from receipt or corpus')
  .argument('<id>', 'Receipt path, receipt ID, corpus_sha8, or content hash to replay')
  .option('--corpus <path>', 'Path to corpus directory', './.gbrain-corpus')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (id: string, options) => {
    try {
      const replayId = sanitizeCliString(id, 'id', 256);
      const isHash = /^[a-f0-9]{64}$/i.test(replayId);
      const isCorpusSha8 = /^[a-f0-9]{8}$/i.test(replayId);
      if (!isHash) {
        const { ReceiptRegistry } = await import('./core/receipt-registry.js');
        const receiptRegistry = new ReceiptRegistry('glearn');
        const receipt = isCorpusSha8
          ? (await receiptRegistry.getByCorpusSha8(replayId)).at(-1)
          : await receiptRegistry.getByIdOrPath(replayId);

        if (!receipt) {
          console.error(chalk.red(`[GLearn] Receipt not found: ${replayId}`));
          process.exit(1);
        }

        const output = {
          receipt_id: receipt.receipt_id,
          timestamp: receipt.timestamp,
          verdict: receipt.verdict,
          overall_score: receipt.overall_score,
          metadata: receipt.metadata,
        };

        if (options.json) {
          console.log(JSON.stringify(output, null, 2));
        } else if (!options.quiet) {
          console.log(chalk.blue.bold(`[GLearn] Replaying receipt: ${receipt.receipt_id}`));
          console.log(chalk.gray(`Timestamp: ${receipt.timestamp}`));
          console.log(chalk.gray(`Corpus: ${receipt.metadata?.corpus_sha8 || receipt.input_hash.substring(0, 8)}`));
          console.log(chalk.gray(`Verdict: ${receipt.verdict}`));
          console.log(chalk.gray(`Score: ${receipt.overall_score.toFixed(3)}`));
        }
        process.exit(0);
      }

      const { ReplayManager } = await import('../../shared/src/core/replay-manager.js');
      const replayManager = new ReplayManager(sanitizeCliPath(options.corpus, '--corpus'));
      
      const result = await replayManager.retrieve(replayId);
      
      if (!result.found) {
        console.error(chalk.red(`[GLearn] Hash not found in corpus: ${replayId}`));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold(`[GLearn] Replaying hash: ${replayId}`));
        console.log(chalk.gray(`Tool: ${result.metadata.tool}`));
        console.log(chalk.gray(`Timestamp: ${result.metadata.timestamp}`));
        console.log(chalk.gray(`Task: ${result.metadata.task || 'N/A'}`));
        console.log(chalk.green('\nContent:'));
        console.log(result.content);
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Replay failed:'), error);
      process.exit(1);
    }
  });

program
  .command('receipts')
  .description('List execution receipts')
  .option('--since <date>', 'Only include receipts since YYYY-MM-DD')
  .option('--until <date>', 'Only include receipts up to YYYY-MM-DD')
  .option('--limit <n>', 'Maximum number of receipts to print', '50')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      const { ReceiptRegistry } = await import('./core/receipt-registry.js');
      const receiptRegistry = new ReceiptRegistry('glearn');
      const start = options.since ? new Date(options.since) : new Date(0);
      const end = options.until ? new Date(options.until) : new Date();
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        console.error(chalk.red('[GLearn] --since/--until must be valid dates'));
        process.exit(1);
      }

      const limit = sanitizeCliInteger(options.limit, '--limit', 1, 1000);

      const receipts = (await receiptRegistry.getAllBetween(start, end)).slice(-limit);
      if (options.json) {
        console.log(JSON.stringify(receipts, null, 2));
      } else if (!options.quiet) {
        for (const receipt of receipts) {
          console.log(`${receipt.timestamp} ${receipt.receipt_id} ${receipt.verdict} score=${receipt.overall_score.toFixed(3)} corpus=${receipt.metadata?.corpus_sha8 || receipt.input_hash.substring(0, 8)}`);
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Receipt query failed:'), error);
      process.exit(1);
    }
  });

program
  .command('diff <receiptA> <receiptB>')
  .description('Diff two execution receipts')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (receiptA, receiptB, options) => {
    try {
      const { ReceiptRegistry } = await import('./core/receipt-registry.js');
      const receiptRegistry = new ReceiptRegistry('glearn');
      const a = await receiptRegistry.getByIdOrPath(receiptA);
      const b = await receiptRegistry.getByIdOrPath(receiptB);
      if (!a || !b) {
        console.error(chalk.red('[GLearn] Both receipts must exist'));
        process.exit(1);
      }

      const diff = receiptRegistry.diff(a, b);
      if (options.json) {
        console.log(JSON.stringify(diff, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GLearn] Receipt Diff'));
        console.log(`  Verdict: ${diff.verdict.from} -> ${diff.verdict.to}`);
        console.log(`  Overall score: ${diff.overall_score.from} -> ${diff.overall_score.to} (${diff.overall_score.delta >= 0 ? '+' : ''}${diff.overall_score.delta.toFixed(3)})`);
        console.log(`  Cost: $${diff.cost_usd.from.toFixed(4)} -> $${diff.cost_usd.to.toFixed(4)} (${diff.cost_usd.delta >= 0 ? '+' : ''}${diff.cost_usd.delta.toFixed(4)})`);
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Receipt diff failed:'), error);
      process.exit(1);
    }
  });

// Regress command
program
  .command('regress')
  .description('Compare current pattern mining performance against baseline')
  .option('-b, --baseline <path>', 'Path to baseline file')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--budget-usd <amount>', 'Maximum learning budget in USD', '10')
  .option('--tolerance <number>', 'Tolerance for regression detection', '0.05')
  .option('--baseline-file <path>', 'Versioned JSONL baseline file for per-dimension regression gates', 'glearn/test/baselines/regression-baselines.jsonl')
  .option('--against <receipt>', 'Compare latest receipt against a baseline receipt path or ID')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      if (options.against) {
        await runReceiptRegression(options.against, options);
        return;
      }

      if (options.baselineFile) {
        const { ReceiptRegistry } = await import('./core/receipt-registry.js');
        const { loadRegressionBaselines, evaluateRegressionGates } = await import('./core/regression-gates.js');
        const receiptRegistry = new ReceiptRegistry('glearn');
        const latest = await receiptRegistry.getLatest();
        if (latest) {
          const baselines = await loadRegressionBaselines(options.baselineFile);
          const gate = evaluateRegressionGates(latest, baselines);
          if (options.json) {
            console.log(JSON.stringify(gate, null, 2));
          } else if (!options.quiet) {
            console.log(chalk.blue.bold('[GLearn] Regression Gates'));
            for (const result of gate.results) {
              const status = result.passed ? chalk.green('PASSED') : chalk.red('FAILED');
              console.log(`  ${result.dimension}: ${status} current=${result.current.toFixed(4)} baseline=${result.baseline.toFixed(4)} tolerance=${result.tolerance}`);
            }
          }
          process.exit(gate.passed ? 0 : 1);
        }
      }

      requireServices('regress');
      const tolerance = sanitizeCliFloat(options.tolerance, '--tolerance', 0, 1);

      if (!options.baseline) {
        console.error(chalk.red('[GLearn] --baseline is required'));
        process.exit(1);
      }

      if (!options.corpus) {
        console.error(chalk.red('[GLearn] --corpus is required'));
        process.exit(1);
      }

      const fs = await import('fs/promises');
      const baselineContent = await fs.readFile(sanitizeCliPath(options.baseline, '--baseline'), 'utf-8');
      const baseline = JSON.parse(baselineContent);
      const corpusContent = await fs.readFile(sanitizeCliPath(options.corpus, '--corpus'), 'utf-8');
      const corpus = JSON.parse(corpusContent);

      const glearn = new GLearn({
        gbrainEndpoint: sanitizeCliUrl(options.gbrain, '--gbrain'),
        multiModelConfig: buildMultiModelConfig(parsePositiveNumber(options.budgetUsd, '--budget-usd')),
      });

      // Run current performance on corpus
      const currentResults = [];
      for (const testCase of corpus.slice(0, 5)) {
        const result = await glearn.runLearningCycle({
          run_counterfactual: false,
        });
        currentResults.push({
          patterns_found: result.patterns_found,
          proposals_generated: result.proposals_generated,
          evaluations_completed: result.evaluations_completed,
        });
      }

      // Compare with baseline
      const baselinePatterns = baseline.avg_patterns_found || 0;
      const currentPatterns = currentResults.reduce((sum, r) => sum + r.patterns_found, 0) / currentResults.length;
      const patternsDelta = currentPatterns - baselinePatterns;
      const patternsRegressed = patternsDelta < -baselinePatterns * tolerance;

      const baselineProposals = baseline.avg_proposals_generated || 0;
      const currentProposals = currentResults.reduce((sum, r) => sum + r.proposals_generated, 0) / currentResults.length;
      const proposalsDelta = currentProposals - baselineProposals;
      const proposalsRegressed = proposalsDelta < -baselineProposals * tolerance;

      const regressionDetected = patternsRegressed || proposalsRegressed;

      const result = {
        baseline_avg_patterns_found: baselinePatterns,
        current_avg_patterns_found: currentPatterns,
        patterns_delta: patternsDelta,
        patterns_regressed: patternsRegressed,
        baseline_avg_proposals_generated: baselineProposals,
        current_avg_proposals_generated: currentProposals,
        proposals_delta: proposalsDelta,
        proposals_regressed: proposalsRegressed,
        tolerance,
        regression_detected: regressionDetected,
        current_results_count: currentResults.length,
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GLearn] Running regression test'));
        console.log(chalk.gray(`Baseline patterns: ${baselinePatterns.toFixed(2)}`));
        console.log(chalk.gray(`Current patterns: ${currentPatterns.toFixed(2)}`));
        console.log(chalk.gray(`Patterns delta: ${patternsDelta.toFixed(2)}`));
        console.log(chalk.gray(`Baseline proposals: ${baselineProposals.toFixed(2)}`));
        console.log(chalk.gray(`Current proposals: ${currentProposals.toFixed(2)}`));
        console.log(chalk.gray(`Proposals delta: ${proposalsDelta.toFixed(2)}`));
        console.log(chalk.gray(`Tolerance: ${(tolerance * 100).toFixed(1)}%`));
        const statusColor = regressionDetected ? 'red' : 'green';
        const statusLabel = regressionDetected ? '✗ REGRESSION DETECTED' : '✓ PASSED';
        console.log(chalk[statusColor](`Status: ${statusLabel}`));
      }

      process.exit(regressionDetected ? 1 : 0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Regression test failed:'), error);
      process.exit(1);
    }
  });

// Cost command
program
  .command('cost')
  .description('Show cost information')
  .option('--day', 'Show today\'s spend (default)')
  .option('--week', 'Show this week\'s spend')
  .option('--month', 'Show this month\'s spend')
  .option('--by-model', 'Break down by model')
  .option('--by-operation', 'Break down by operation')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      const { BudgetLedger } = await import('./core/budget-ledger.js');
      const ledger = new BudgetLedger({ max_budget_usd: 1000 }, 'glearn');
      await ledger.init();

      let spend = 0;
      if (options.week) {
        spend = ledger.getWeeklySpend();
      } else if (options.month) {
        spend = ledger.getMonthlySpend();
      } else {
        spend = ledger.getDailySpend();
      }

      if (options.json) {
        const breakdown: Record<string, any> = {};
        if (options.byModel) {
          breakdown['by_model'] = ledger.getSpendByModel();
        }
        if (options.byOperation) {
          breakdown['by_operation'] = ledger.getSpendByOperation();
        }
        console.log(JSON.stringify({ spend, ...breakdown }, null, 2));
      } else if (!options.quiet) {
        const period = options.week ? 'this week' : options.month ? 'this month' : 'today';
        console.log(chalk.blue(`LLM Spend ${period}: $${spend.toFixed(4)}`));
        
        if (options.byModel) {
          const byModel = ledger.getSpendByModel();
          console.log(chalk.gray('\nBy model:'));
          for (const [model, cost] of Object.entries(byModel)) {
            console.log(`  ${model}: $${(cost as number).toFixed(4)}`);
          }
        }
        
        if (options.byOperation) {
          const byOp = ledger.getSpendByOperation();
          console.log(chalk.gray('\nBy operation:'));
          for (const [op, cost] of Object.entries(byOp)) {
            console.log(`  ${op}: $${(cost as number).toFixed(4)}`);
          }
        }
      }
      
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Cost query failed:'), error);
      process.exit(1);
    }
  });

// Trend command
program
  .command('trend')
  .description('Show how pattern quality metrics are changing over time')
  .option('--window <days>', 'Number of days to analyze', '7')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      const windowDays = sanitizeCliInteger(options.window, '--window', 1, 3650);

      const { ReceiptRegistry } = await import('./core/receipt-registry.js');
      const registry = new ReceiptRegistry('glearn');

      const end = new Date();
      const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
      const receipts = await registry.getAllBetween(start, end);

      // Calculate mean pattern metrics from receipts
      let meanPatternFrequency = 0;
      let meanTemporalStability = 0;

      if (receipts.length > 0) {
        const frequencies: number[] = receipts
          .map((r: any) => r.pattern_frequency ?? r.patterns_found ?? 0)
          .filter((v: any) => typeof v === 'number');
        const stabilities: number[] = receipts
          .map((r: any) => r.temporal_stability ?? r.confidence ?? 0)
          .filter((v: any) => typeof v === 'number');

        meanPatternFrequency = frequencies.length > 0
          ? frequencies.reduce((sum: number, v: number) => sum + v, 0) / frequencies.length
          : 0;
        meanTemporalStability = stabilities.length > 0
          ? stabilities.reduce((sum: number, v: number) => sum + v, 0) / stabilities.length
          : 0;
      }

      // Determine trend label from stability score
      let trend: 'stable' | 'improving' | 'degrading' = 'stable';
      if (meanTemporalStability >= 0.7) {
        trend = 'improving';
      } else if (meanTemporalStability < 0.3) {
        trend = 'degrading';
      }

      const output = {
        window_days: windowDays,
        mean_pattern_frequency: parseFloat(meanPatternFrequency.toFixed(4)),
        mean_temporal_stability: parseFloat(meanTemporalStability.toFixed(4)),
        trend,
      };

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GLearn] Analyzing pattern quality trends'));
        console.log(chalk.green.bold('\n[GLearn] Trend Analysis'));
        console.log(chalk.gray(`Window: ${windowDays} days`));
        console.log(chalk.gray(`Mean pattern frequency: ${output.mean_pattern_frequency}`));
        console.log(chalk.gray(`Mean temporal stability: ${output.mean_temporal_stability}`));
        const trendColor = trend === 'improving' ? chalk.green : trend === 'degrading' ? chalk.red : chalk.yellow;
        console.log(`Trend: ${trendColor(trend)}`);
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('[GLearn] Trend analysis failed:'), error);
      process.exit(1);
    }
  });

program
  .command('completion')
  .description('Print shell completion script')
  .argument('[shell]', 'Shell type: bash, zsh, or fish', 'bash')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action((shell, options) => {
    const normalized = String(shell).toLowerCase();
    const script = buildCompletionScript(normalized);
    if (!script) {
      console.error(chalk.red('[GLearn] Shell must be one of: bash, zsh, fish'));
      process.exit(1);
    }
    if (options.json) {
      console.log(JSON.stringify({ shell: normalized, script }, null, 2));
    } else if (!options.quiet) {
      console.log(script);
    }
    process.exit(0);
  });

program
  .command('metrics')
  .description('Export observability metrics')
  .option('--format <format>', 'Output format: prometheus, otel, json', 'prometheus')
  .option('--json', 'Output observability snapshot as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const glearn = new GLearn();
    const format = options.json ? 'json' : String(options.format || 'prometheus').toLowerCase();
    if (format === 'prometheus') {
      if (!options.quiet) console.log(glearn.exportPrometheusMetrics());
    } else if (format === 'otel') {
      if (!options.quiet) console.log(JSON.stringify(glearn.exportOpenTelemetryMetrics(), null, 2));
    } else if (format === 'json') {
      if (!options.quiet) console.log(JSON.stringify(glearn.getObservabilitySnapshot(), null, 2));
    } else {
      console.error(chalk.red('[GLearn] --format must be one of: prometheus, otel, json'));
      process.exit(1);
    }
    process.exit(0);
  });

async function runReceiptRegression(against: string | undefined, options: any): Promise<void> {
  if (!against) {
    console.error(chalk.red('[GLearn] --against is required for receipt regression'));
    process.exit(1);
  }

  const { ReceiptRegistry } = await import('./core/receipt-registry.js');
  const receiptRegistry = new ReceiptRegistry('glearn');
  const baseline = await receiptRegistry.getByIdOrPath(against);
  const latest = await receiptRegistry.getLatest();

  if (!baseline || !latest) {
    console.error(chalk.red('[GLearn] Baseline and latest receipts must both exist'));
    process.exit(1);
  }

  const diff = receiptRegistry.diff(baseline, latest);
  const regressionPassed =
    latest.overall_score >= baseline.overall_score &&
    latest.hard_gates_passed &&
    latest.verdict !== 'fail';

  const result = {
    passed: regressionPassed,
    baseline_receipt: baseline.receipt_id,
    current_receipt: latest.receipt_id,
    baseline_score: baseline.overall_score,
    current_score: latest.overall_score,
    delta: latest.overall_score - baseline.overall_score,
    diff,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!options.quiet) {
    console.log(chalk.blue.bold('[GLearn] Receipt Regression Check'));
    console.log(`  Status: ${regressionPassed ? chalk.green('PASSED') : chalk.red('FAILED')}`);
    console.log(`  Baseline: ${baseline.receipt_id} (${baseline.overall_score.toFixed(3)})`);
    console.log(`  Current: ${latest.receipt_id} (${latest.overall_score.toFixed(3)})`);
    console.log(`  Delta: ${result.delta >= 0 ? chalk.green(`+${result.delta.toFixed(3)}`) : chalk.red(result.delta.toFixed(3))}`);
  }

  process.exit(regressionPassed ? 0 : 1);
}

function parsePositiveInteger(value: string, flag: string, min: number, max: number): number {
  try {
    return sanitizeCliInteger(value, flag, min, max);
  } catch {
    console.error(chalk.red(`[GLearn] ${flag} must be an integer between ${min} and ${max}`));
    process.exit(1);
  }
}

function parsePositiveNumber(value: string, flag: string): number {
  try {
    return sanitizeCliFloat(value, flag, 0.01, 1000000);
  } catch {
    console.error(chalk.red(`[GLearn] ${flag} must be a positive number`));
    process.exit(1);
  }
}

function sanitizeEndpointOptions(options: any): {
  gbrain: string;
  gstack: string;
  gorchestrator: string;
  gmirror: string;
  gtom: string;
} {
  try {
    return {
      gbrain: sanitizeCliUrl(options.gbrain, '--gbrain'),
      gstack: sanitizeCliUrl(options.gstack, '--gstack'),
      gorchestrator: sanitizeCliUrl(options.gorchestrator, '--gorchestrator'),
      gmirror: sanitizeCliUrl(options.gmirror, '--gmirror'),
      gtom: sanitizeCliUrl(options.gtom, '--gtom'),
    };
  } catch (error) {
    console.error(chalk.red(`[GLearn] ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function buildMultiModelConfig(budgetUsd: number): MultiModelConfig {
  return {
    default_tier: 'tier1',
    escalation_enabled: true,
    escalation_triggers: {
      min_confidence: 0.7,
      min_quality_score: 0.5,
      max_ambiguity: 0.5,
    },
    consensus_threshold: 0.8,
    cost_budget_usd_per_hour: budgetUsd,
    allow_tier3: true,
  };
}

function buildCompletionScript(shell: string): string | null {
  const commands = [
    'backup',
    'restore',
    'export',
    'secrets',
    'rotate',
    'list',
    'run',
    'patterns',
    'proposals',
    'approve',
    'reject',
    'health',
    'sync',
    'eval',
    'stats',
    'drift',
    'replay',
    'receipts',
    'diff',
    'regress',
    'cost',
    'trend',
    'metrics',
    'completion',
  ];
  const options = [
    '--help',
    '--version',
    '--json',
    '--format',
    '--quiet',
    '--cycles',
    '--budget-usd',
    '--gbrain',
    '--gstack',
    '--gorchestrator',
    '--gmirror',
    '--gtom',
    '--output',
    '--corpus',
    '--against',
    '--incremental',
    '--full',
    '--dry-run',
    '--value',
  ];
  const words = [...commands, ...options].join(' ');

  if (shell === 'bash') {
    return `_glearn_completions()
{
  local cur
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=( $(compgen -W "${words}" -- "$cur") )
}
complete -F _glearn_completions glearn`;
  }

  if (shell === 'zsh') {
    return `#compdef glearn
_arguments '1:command:(${commands.join(' ')})' '*::option:(${options.join(' ')})'`;
  }

  if (shell === 'fish') {
    return [
      ...commands.map(command => `complete -c glearn -f -a ${command}`),
      ...options.map(option => `complete -c glearn -f -l ${option.slice(2)}`),
    ].join('\n');
  }

  return null;
}

// Analyze command — mine patterns from local JSONL receipts, no external services required
program
  .command('analyze')
  .description('Mine patterns from local execution receipts (no external services required)')
  .option('-f, --file <path>', 'JSONL receipt file to analyze')
  .option('-d, --dir <path>', 'Directory of JSONL files to analyze')
  .option('-o, --output <path>', 'Save markdown report to file')
  .option('-m, --model <model>', 'LLM model to use', 'claude-haiku-4-5-20251001')
  .option('--json', 'Output as JSON')
  .option('--demo', 'Use demo data source for testing')
  .action(async (opts: any) => {
    await runAnalyzeCommand({
      file: opts.file,
      dir: opts.dir,
      output: opts.output,
      model: opts.model,
      json: opts.json ?? false,
      demo: opts.demo ?? false,
    });
  });

program.parse();
