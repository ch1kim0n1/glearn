/**
 * Analyze command for GLearn
 * Reads JSONL receipt files, mines patterns via LLM, produces a report.
 * Requires only ANTHROPIC_API_KEY — no other services needed.
 */

import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import type { Command } from './command-registry.js';

export interface AnalyzeOptions {
  file?: string;
  dir?: string;
  output?: string;
  model: string;
  json: boolean;
  demo?: boolean;
}

interface Receipt {
  run_id?: string;
  task?: string;
  output?: string;
  exit_code?: number;
  cost_usd?: number;
  timestamp?: string;
  [key: string]: unknown;
}

async function readJsonlFile(filePath: string): Promise<Receipt[]> {
  const records: Receipt[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        records.push(JSON.parse(trimmed) as Receipt);
      } catch {
        // skip malformed lines
      }
    }
  }
  return records;
}

async function collectReceipts(options: AnalyzeOptions): Promise<Receipt[]> {
  if (options.file) {
    return readJsonlFile(options.file);
  }
  if (options.dir) {
    const files = fs.readdirSync(options.dir).filter(f => f.endsWith('.jsonl'));
    const all: Receipt[] = [];
    for (const f of files) {
      all.push(...await readJsonlFile(path.join(options.dir, f)));
    }
    return all;
  }
  // Try default locations
  const defaults = [
    path.join(process.cwd(), 'test/baselines'),
    path.join(process.env.HOME || '/tmp', '.gagent', 'receipts'),
  ];
  for (const d of defaults) {
    if (fs.existsSync(d)) {
      const files = fs.readdirSync(d).filter(f => f.endsWith('.jsonl'));
      if (files.length > 0) {
        const all: Receipt[] = [];
        for (const f of files) {
          all.push(...await readJsonlFile(path.join(d, f)));
        }
        return all;
      }
    }
  }
  return [];
}

export async function runAnalyzeCommand(options: AnalyzeOptions): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('Error: ANTHROPIC_API_KEY not set'));
    process.exit(1);
  }

  const receipts = await collectReceipts(options);

  if (receipts.length === 0) {
    console.error(chalk.yellow('No receipts found.'));
    console.error('Options:');
    console.error('  glearn analyze --file receipts.jsonl');
    console.error('  glearn analyze --dir ./baselines/');
    console.error('  Run some tasks first with: gagent run "<task>"');
    process.exit(1);
  }

  if (!options.json) {
    console.log(chalk.blue(`Analyzing ${receipts.length} execution receipts...`));
  }

  const successCount = receipts.filter(r => r.exit_code === 0).length;
  const successRate = successCount / receipts.length;
  const totalCost = receipts.reduce(
    (s, r) => s + (typeof r.cost_usd === 'number' ? r.cost_usd : 0),
    0,
  );
  const tasks = receipts
    .map(r => r.task)
    .filter((t): t is string => typeof t === 'string');
  const failed = receipts.filter(r => r.exit_code !== 0);

  const client = new Anthropic({ apiKey });

  const prompt = `You are an execution pattern analyst. Analyze ${receipts.length} task execution receipts and identify actionable insights.

Statistics:
- Total runs: ${receipts.length}
- Success rate: ${(successRate * 100).toFixed(1)}%
- Total cost: $${totalCost.toFixed(4)}

Sample tasks (first 20):
${tasks.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Failed tasks (first 5):
${failed.slice(0, 5).map(r => `- "${r.task}": ${String(r.output ?? '').slice(0, 100)}`).join('\n') || 'None'}

Write a concise markdown report with these sections:
## Task Patterns
## Failure Analysis
## Cost Analysis
## Top 3 Proposals

Keep each section to 2-4 bullet points. Be specific and actionable.`;

  const response = await client.messages.create({
    model: options.model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const analysis = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  const report = `# GLearn Analysis Report

**Generated:** ${new Date().toISOString()}
**Receipts:** ${receipts.length} | **Success rate:** ${(successRate * 100).toFixed(1)}% | **Total cost:** $${totalCost.toFixed(4)}

${analysis}`;

  if (options.output) {
    fs.writeFileSync(options.output, report, 'utf-8');
    if (!options.json) {
      console.log(chalk.green(`Report saved to ${options.output}`));
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          receipts_count: receipts.length,
          success_rate: successRate,
          total_cost: totalCost,
          report,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('');
    console.log(report);
  }
}

/**
 * Command-registry–compatible export for commands/index.ts registration.
 * The full LLM-backed implementation is wired into CLI via runAnalyzeCommand.
 */
export const analyzeCommand: Command = {
  name: 'analyze',
  description: 'Mine patterns from local execution receipts via LLM (requires ANTHROPIC_API_KEY)',
  handler: async (_args: string[]) => {
    console.log('Use: glearn analyze [--file <path>] [--dir <path>] [--output <path>] [--model <model>] [--json]');
  },
  subcommands: [
    {
      name: 'correlations',
      description: 'Find cross-tool correlations',
      handler: async () => {
        console.log('Use glearn analyze --dir <path> to mine patterns across receipts.');
      },
    },
    {
      name: 'coverage',
      description: 'Analyze coverage gaps',
      handler: async () => {
        console.log('Use glearn analyze --file <path> to analyze a receipt file.');
      },
    },
    {
      name: 'trends',
      description: 'Analyze trends over time',
      handler: async () => {
        console.log('Use glearn analyze --dir <path> to analyze trends across receipts.');
      },
    },
  ],
};
