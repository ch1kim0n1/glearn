/**
 * Command index for GLearn
 * Registers all available commands
 */

import { registerCommands } from './command-registry.js';
import { initCommand } from './init.js';
import { doctorCommand } from './doctor.js';
import { configCommand } from './config.js';
import { serveCommand } from './serve.js';
import { healthCheckCommand } from './health-check.js';
import { patternCommand } from './pattern.js';
import { proposalCommand } from './proposal.js';
import { counterfactualCommand } from './counterfactual.js';
import { learningRunCommand } from './learning-run.js';
import { ingestCommand } from './ingest.js';
import { receiptCommand } from './receipt.js';
import { driftCommand } from './drift.js';
import { costCommand } from './cost.js';
import { escalationCommand } from './escalation.js';
import { exportCommand } from './export.js';
import { importCommand } from './import.js';
import { analyzeCommand } from './analyze.js';
import { validateCommand } from './validate.js';
import { cleanupCommand } from './cleanup.js';
import { benchmarkCommand } from './benchmark.js';
import { versionCommand } from './version.js';
import { helpCommand } from './help.js';
import { resetCommand } from './reset.js';
import { backupCommand } from './backup.js';
import { migrateCommand } from './migrate.js';
import { authCommand } from './auth.js';
import { logsCommand } from './logs.js';
import { metricsCommand } from './metrics.js';
import { tierCommand } from './tier.js';
import { consensusCommand } from './consensus.js';
import { apiKeyCommand } from './api-key.js';
import { experimentCommand } from './experiment.js';
import { optimizeCommand } from './optimize.js';

export function registerAllCommands(): void {
  registerCommands([
    initCommand,
    doctorCommand,
    configCommand,
    serveCommand,
    healthCheckCommand,
    patternCommand,
    proposalCommand,
    counterfactualCommand,
    learningRunCommand,
    ingestCommand,
    receiptCommand,
    driftCommand,
    costCommand,
    escalationCommand,
    exportCommand,
    importCommand,
    analyzeCommand,
    validateCommand,
    cleanupCommand,
    benchmarkCommand,
    versionCommand,
    helpCommand,
    resetCommand,
    backupCommand,
    migrateCommand,
    authCommand,
    logsCommand,
    metricsCommand,
    tierCommand,
    consensusCommand,
    apiKeyCommand,
    experimentCommand,
    optimizeCommand,
  ]);
}
