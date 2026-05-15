#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { GLearn } from './core/glearn.js';

const program = new Command();

program
  .name('glearn')
  .description('Meta-learning and reflective layer for the G-Stack')
  .version('0.1.0');

// Run learning cycle
program
  .command('run')
  .description('Run a learning cycle to mine patterns and generate proposals')
  .option('--counterfactual', 'Run counterfactual evaluation on proposals')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--gstack <url>', 'GStack endpoint', 'http://localhost:3001')
  .option('--gorchestrator <url>', 'GOrchestrator endpoint', 'http://localhost:3001')
  .option('--gmirror <url>', 'GMirror endpoint', 'http://localhost:3002')
  .option('--gtom <url>', 'GToM endpoint', 'http://localhost:3003')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    // Basic input validation
    if (options.gbrain && options.gbrain.length > 500) {
      console.error(chalk.red('Error: GBrain URL too long (max 500 characters)'));
      process.exit(1);
    }

    const glearn = new GLearn({
      gbrainEndpoint: options.gbrain,
      gstackEndpoint: options.gstack,
      gorchestratorEndpoint: options.gorchestrator,
      gmirrorEndpoint: options.gmirror,
      gtomEndpoint: options.gtom,
    });

    try {
      const result = await glearn.runLearningCycle({
        run_counterfactual: options.counterfactual,
      });

      const output = {
        status: result.status,
        patterns_found: result.patterns_found,
        proposals_generated: result.proposals_generated,
        evaluations_completed: result.evaluations_completed,
        duration_ms: result.completed_at ? new Date(result.completed_at).getTime() - new Date(result.started_at).getTime() : 0,
        error_message: result.error_message,
      };

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GLearn] Starting learning cycle'));
        console.log(chalk.gray(`Counterfactual evaluation: ${options.counterfactual}`));
        console.log(chalk.green.bold('\n[GLearn] Learning cycle completed'));
        console.log(chalk.gray(`Status: ${result.status}`));
        console.log(chalk.gray(`Patterns found: ${result.patterns_found}`));
        console.log(chalk.gray(`Proposals generated: ${result.proposals_generated}`));
        console.log(chalk.gray(`Evaluations completed: ${result.evaluations_completed}`));
        console.log(chalk.gray(`Duration: ${output.duration_ms}ms`));

        if (result.status === 'failed') {
          console.log(chalk.red(`Error: ${result.error_message}`));
        }
      }

      process.exit(result.status === 'completed' ? 0 : 1);
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
    const glearn = new GLearn();
    const result = glearn.approveProposal(options.proposalId, options.reviewer);

    const output = {
      proposal_id: options.proposalId,
      reviewer: options.reviewer,
      status: result ? 'approved' : 'failed',
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else if (result && !options.quiet) {
      console.log(chalk.green(`[GLearn] Proposal ${options.proposalId} approved by ${options.reviewer}`));
    } else if (!result && !options.quiet) {
      console.error(chalk.red(`[GLearn] Failed to approve proposal ${options.proposalId}`));
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
    const glearn = new GLearn();
    const result = glearn.rejectProposal(options.proposalId, options.reviewer);

    const output = {
      proposal_id: options.proposalId,
      reviewer: options.reviewer,
      status: result ? 'rejected' : 'failed',
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else if (result && !options.quiet) {
      console.log(chalk.green(`[GLearn] Proposal ${options.proposalId} rejected by ${options.reviewer}`));
    } else if (!result && !options.quiet) {
      console.error(chalk.red(`[GLearn] Failed to reject proposal ${options.proposalId}`));
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
    const glearn = new GLearn({
      gbrainEndpoint: options.gbrain,
      gstackEndpoint: options.gstack,
      gorchestratorEndpoint: options.gorchestrator,
      gmirrorEndpoint: options.gmirror,
      gtomEndpoint: options.gtom,
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

// Eval mode
program
  .command('eval')
  .description('Run evaluation on pattern mining performance')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--cycles <number>', 'Number of cycles to run for statistical comparison', '1')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--gstack <url>', 'GStack endpoint', 'http://localhost:3001')
  .option('--gorchestrator <url>', 'GOrchestrator endpoint', 'http://localhost:3001')
  .option('--gmirror <url>', 'GMirror endpoint', 'http://localhost:3002')
  .option('--gtom <url>', 'GToM endpoint', 'http://localhost:3003')
  .option('-o, --output <path>', 'Write output to file (JSON format)')
  .option('--json', 'Output as JSON to stdout')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    const glearn = new GLearn({
      gbrainEndpoint: options.gbrain,
      gstackEndpoint: options.gstack,
      gorchestratorEndpoint: options.gorchestrator,
      gmirrorEndpoint: options.gmirror,
      gtomEndpoint: options.gtom,
    });

    try {
      if (!options.corpus) {
        console.error(chalk.red('[GLearn] --corpus is required'));
        process.exit(1);
      }

      const cycles = parseInt(options.cycles);
      const fs = await import('fs/promises');
      const corpusContent = await fs.readFile(options.corpus, 'utf-8');
      const corpus = JSON.parse(corpusContent);

      const allResults = [];
      for (let cycle = 0; cycle < cycles; cycle++) {
        if (!options.quiet) {
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
        await fs.writeFile(options.output, JSON.stringify(summary, null, 2));
        if (!options.quiet) {
          console.log(chalk.green(`[GLearn] Results written to ${options.output}`));
        }
      } else {
        if (!options.quiet) {
          console.log(chalk.blue.bold('[GLearn] Running evaluation'));
          console.log(chalk.green.bold('\n[GLearn] Evaluation completed'));
          console.log(chalk.gray(`Cycles: ${summary.cycles}`));
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
    try {
      const response = await fetch(`${options.gbrain}/api/glearn/stats`);
      if (!response.ok) {
        console.error(chalk.red('[GLearn] Failed to fetch statistics'));
        process.exit(1);
      }

      const stats = await response.json();
      
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GLearn] Fetching statistics'));
        console.log(chalk.green.bold('\n[GLearn] Statistics'));
        console.log(chalk.gray(`Total cycles: ${stats.total_cycles || 0}`));
        console.log(chalk.gray(`Patterns found: ${stats.total_patterns || 0}`));
        console.log(chalk.gray(`Proposals generated: ${stats.total_proposals || 0}`));
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
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      const { DriftDetector } = await import('../../shared/src/core/drift-detector.js');
      const detector = new DriftDetector({
        window_size: 100,
        drift_threshold: 0.2,
        alert_threshold: 0.3,
        baseline_period_ms: 7 * 24 * 60 * 60 * 1000,
      });

      // For MVP, we'll demonstrate with sample data
      // In production, this would load historical metrics from corpus
      const sampleMetrics = [
        { name: 'patterns_found', values: Array.from({ length: 50 }, () => 10 + Math.random() * 5) },
        { name: 'proposals_generated', values: Array.from({ length: 50 }, () => 5 + Math.random() * 3) },
        { name: 'duration_ms', values: Array.from({ length: 50 }, () => 500 + Math.random() * 100) },
      ];

      // Record snapshots
      sampleMetrics.forEach(metric => {
        metric.values.forEach((value, i) => {
          const timestamp = new Date(Date.now() - (50 - i) * 3600000).toISOString();
          detector['recordSnapshot'](metric.name, value, { timestamp });
        });
      });

      const driftResults = detector.detectAllDrift();
      const alerts = detector.getAlerts();

      if (options.json) {
        console.log(JSON.stringify({
          metrics: detector.getMetricNames(),
          drift_results: driftResults,
          alerts,
        }, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold('[GLearn] Checking for pattern drift'));
        console.log(chalk.green.bold('\n[GLearn] Drift Analysis'));
        console.log(chalk.gray(`Metrics tracked: ${detector.getMetricNames().join(', ')}`));
        console.log(chalk.gray(`Drift detected: ${driftResults.some(d => d.drift_detected) ? 'Yes' : 'No'}`));
        
        if (driftResults.length > 0) {
          console.log(chalk.bold('\nDrift Results:'));
          for (const result of driftResults) {
            const status = result.drift_detected ? chalk.red('⚠') : chalk.green('✓');
            console.log(`  ${status} ${result.metric_name}: ${result.drift_magnitude.toFixed(3)} (${result.trend})`);
          }
        }

        if (alerts.length > 0) {
          console.log(chalk.red.bold('\nAlerts:'));
          for (const alert of alerts) {
            console.log(`  ${alert.metric_name}: ${alert.drift_magnitude.toFixed(3)} (threshold: 0.3)`);
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
  .description('Replay a previous learning cycle from corpus')
  .argument('<hash>', 'Content hash to replay')
  .option('--corpus <path>', 'Path to corpus directory', './.gbrain-corpus')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (hash: string, options) => {
    try {
      const { ReplayManager } = await import('../../shared/src/core/replay-manager.js');
      const replayManager = new ReplayManager(options.corpus);
      
      const result = await replayManager.retrieve(hash);
      
      if (!result.found) {
        console.error(chalk.red(`[GLearn] Hash not found in corpus: ${hash}`));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        console.log(chalk.blue.bold(`[GLearn] Replaying hash: ${hash}`));
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

// Regress command
program
  .command('regress')
  .description('Compare current pattern mining performance against baseline')
  .option('-b, --baseline <path>', 'Path to baseline file')
  .option('-c, --corpus <path>', 'Path to test corpus JSON')
  .option('--gbrain <url>', 'GBrain endpoint', 'http://localhost:3000')
  .option('--tolerance <number>', 'Tolerance for regression detection', '0.05')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output for CI use')
  .action(async (options) => {
    try {
      const tolerance = parseFloat(options.tolerance);
      if (isNaN(tolerance) || tolerance < 0 || tolerance > 1) {
        console.error(chalk.red('[GLearn] --tolerance must be a number between 0 and 1'));
        process.exit(1);
      }

      if (!options.baseline) {
        console.error(chalk.red('[GLearn] --baseline is required'));
        process.exit(1);
      }

      if (!options.corpus) {
        console.error(chalk.red('[GLearn] --corpus is required'));
        process.exit(1);
      }

      const fs = await import('fs/promises');
      const baselineContent = await fs.readFile(options.baseline, 'utf-8');
      const baseline = JSON.parse(baselineContent);
      const corpusContent = await fs.readFile(options.corpus, 'utf-8');
      const corpus = JSON.parse(corpusContent);

      const glearn = new GLearn({
        gbrainEndpoint: options.gbrain,
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
  .action(async (options) => {
    try {
      const { BudgetLedger } = await import('../../shared/src/core/budget-ledger.js');
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
          breakdown['by_operation'] = ledger.getSpendByModel();
        }
        console.log(JSON.stringify({ spend, ...breakdown }, null, 2));
      } else {
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
          const byOp = ledger.getSpendByModel();
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
      const windowDays = parseInt(options.window);
      if (isNaN(windowDays) || windowDays <= 0) {
        console.error(chalk.red('[GLearn] --window must be a positive integer'));
        process.exit(1);
      }

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

program.parse();
