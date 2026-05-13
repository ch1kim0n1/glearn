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
  .action(async (options) => {
    console.log(chalk.blue.bold('[GLearn] Starting learning cycle'));
    console.log(chalk.gray(`Counterfactual evaluation: ${options.counterfactual}`));

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

      console.log(chalk.green.bold('\n[GLearn] Learning cycle completed'));
      console.log(chalk.gray(`Status: ${result.status}`));
      console.log(chalk.gray(`Patterns found: ${result.patterns_found}`));
      console.log(chalk.gray(`Proposals generated: ${result.proposals_generated}`));
      console.log(chalk.gray(`Evaluations completed: ${result.evaluations_completed}`));
      console.log(chalk.gray(`Duration: ${result.completed_at ? new Date(result.completed_at).getTime() - new Date(result.started_at).getTime() : 0}ms`));

      if (result.status === 'failed') {
        console.log(chalk.red(`Error: ${result.error_message}`));
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

    console.log(chalk.bold('Discovered Patterns:'));
    for (const pattern of filtered) {
      console.log(`  ${pattern.pattern_type}: ${pattern.description}`);
      console.log(`    Confidence: ${pattern.confidence.toFixed(3)}`);
      console.log(`    Source tools: ${pattern.source_tools.join(', ')}`);
    }

    process.exit(0);
  });

// List proposals
program
  .command('proposals')
  .description('List generated proposals')
  .action(async () => {
    const glearn = new GLearn();
    const patterns = glearn.getPatterns();
    const proposals = glearn.getProposals(patterns);

    console.log(chalk.bold('Generated Proposals:'));
    for (const proposal of proposals) {
      console.log(`  ${proposal.proposal_type} for ${proposal.target_tool}:`);
      console.log(`    Target: ${proposal.target_component}`);
      console.log(`    Rationale: ${proposal.rationale}`);
      console.log(`    Expected improvement: ${(proposal.expected_impact.improvement * 100).toFixed(1)}%`);
      console.log(`    Risk level: ${proposal.risk_assessment.risk_level}`);
      console.log(`    Status: ${proposal.status}`);
    }

    process.exit(0);
  });

// Approve proposal
program
  .command('approve')
  .description('Approve a proposal')
  .requiredOption('-p, --proposal-id <id>', 'Proposal ID')
  .option('-r, --reviewer <name>', 'Reviewer name', 'user')
  .action(async (options) => {
    const glearn = new GLearn();
    const result = glearn.approveProposal(options.proposalId, options.reviewer);

    if (result) {
      console.log(chalk.green(`[GLearn] Proposal ${options.proposalId} approved by ${options.reviewer}`));
      process.exit(0);
    } else {
      console.error(chalk.red(`[GLearn] Failed to approve proposal ${options.proposalId}`));
      process.exit(1);
    }
  });

// Reject proposal
program
  .command('reject')
  .description('Reject a proposal')
  .requiredOption('-p, --proposal-id <id>', 'Proposal ID')
  .option('-r, --reviewer <name>', 'Reviewer name', 'user')
  .action(async (options) => {
    const glearn = new GLearn();
    const result = glearn.rejectProposal(options.proposalId, options.reviewer);

    if (result) {
      console.log(chalk.green(`[GLearn] Proposal ${options.proposalId} rejected by ${options.reviewer}`));
      process.exit(0);
    } else {
      console.error(chalk.red(`[GLearn] Failed to reject proposal ${options.proposalId}`));
      process.exit(1);
    }
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
  .action(async (options) => {
    const glearn = new GLearn({
      gbrainEndpoint: options.gbrain,
      gstackEndpoint: options.gstack,
      gorchestratorEndpoint: options.gorchestrator,
      gmirrorEndpoint: options.gmirror,
      gtomEndpoint: options.gtom,
    });

    const health = await glearn.healthCheck();

    console.log(chalk.bold('GLearn Health Check'));
    console.log(chalk.gray(`Status: ${health.status}`));
    console.log('');
    console.log('Components:');
    console.log(`  Pattern Miner: ${health.components.pattern_miner === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  Proposal Generator: ${health.components.proposal_generator === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  Counterfactual Evaluator: ${health.components.counterfactual_evaluator === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  GBrain: ${health.components.gbrain === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  GStack: ${health.components.gstack === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  GOrchestrator: ${health.components.gorchestrator === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  GMirror: ${health.components.gmirror === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  GToM: ${health.components.gtom === 'ok' ? chalk.green('✓') : chalk.red('✗')}`);

    process.exit(health.status === 'healthy' ? 0 : 1);
  });

program.parse();
