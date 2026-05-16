import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { homedir } from 'os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';

export type SyncMode = 'incremental' | 'full';

export interface SyncOptions {
  mode?: SyncMode;
  dryRun?: boolean;
  lockTimeoutMs?: number;
}

export interface SyncStageResult {
  stage: string;
  status: 'ok' | 'skipped' | 'error';
  mode: SyncMode;
  dry_run: boolean;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  items_total: number;
  items_changed: number;
  details?: Record<string, unknown>;
  error?: string;
}

export interface SyncResult {
  status: 'ok' | 'partial' | 'error';
  mode: SyncMode;
  dry_run: boolean;
  stages: SyncStageResult[];
  state_path: string;
  lock_path: string;
  timestamp: string;
}

export interface GBrainSourceAttachment {
  tool: string;
  id: string;
  path: string;
  pathhash8: string;
  federated: boolean;
  dotfile_path: string;
  updated_at: string;
}

interface SyncState {
  version: 1;
  updated_at: string;
  mode: SyncMode;
  sources: Record<string, GBrainSourceAttachment>;
}

type CommandRunner = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface GStackGBrainSyncConfig {
  syncRoot?: string;
  toolPaths?: Partial<Record<ToolName, string>>;
  enabledTools?: ToolName[];
  commandRunner?: CommandRunner;
}

const TOOL_NAMES = ['gbrain', 'gstack', 'gorchestrator', 'gmirror', 'gtom', 'glearn'] as const;
type ToolName = typeof TOOL_NAMES[number];

const DEFAULT_TOOL_PATHS: Record<ToolName, string> = {
  gbrain: join(homedir(), '.gbrain'),
  gstack: join(homedir(), '.claude', 'skills', 'gstack'),
  gorchestrator: join(homedir(), '.gorchestrator'),
  gmirror: join(homedir(), '.gmirror'),
  gtom: join(homedir(), '.gtom'),
  glearn: join(homedir(), '.glearn'),
};

const STALE_LOCK_MS = 5 * 60 * 1000;

export class GStackGBrainSync {
  private syncRoot: string;
  private toolPaths: Record<ToolName, string>;
  private enabledTools: ToolName[];
  private commandRunner: CommandRunner;

  constructor(config: GStackGBrainSyncConfig = {}) {
    this.syncRoot = config.syncRoot || process.env.GLEARN_SYNC_ROOT || join(homedir(), '.glearn', 'sync');
    this.toolPaths = { ...DEFAULT_TOOL_PATHS, ...(config.toolPaths ?? {}) };
    this.enabledTools = config.enabledTools ?? [...TOOL_NAMES];
    this.commandRunner = config.commandRunner ?? runCommand;
  }

  async run(options: SyncOptions = {}): Promise<SyncResult> {
    const mode = options.mode ?? 'incremental';
    const dryRun = options.dryRun ?? false;
    const statePath = join(this.syncRoot, 'gstack-gbrain-sync-state.json');
    const lockPath = join(this.syncRoot, 'gstack-gbrain-sync.lock');
    const stages: SyncStageResult[] = [];

    if (!dryRun) {
      try {
        this.acquireLock(lockPath, options.lockTimeoutMs ?? STALE_LOCK_MS);
      } catch (error) {
        stages.push(makeStageResult(
          'lock',
          mode,
          dryRun,
          Date.now(),
          0,
          0,
          'error',
          undefined,
          error instanceof Error ? error.message : 'Unable to acquire sync lock',
        ));
        return this.buildResult('error', mode, dryRun, stages, statePath, lockPath);
      }
    }

    try {
      const previousState = readState(statePath);
      stages.push(await this.runGBrainStage(mode, dryRun));
      const toolsStage = await this.runToolsStage(mode, dryRun, statePath, previousState);
      stages.push(toolsStage);

      if (!dryRun && toolsStage.status !== 'error') {
        const sources = (toolsStage.details?.sources as GBrainSourceAttachment[] | undefined) ?? [];
        writeStateAtomic(statePath, {
          version: 1,
          updated_at: new Date().toISOString(),
          mode,
          sources: Object.fromEntries(sources.map(source => [source.tool, source])),
        });
      }

      const status = stages.some(stage => stage.status === 'error')
        ? stages.some(stage => stage.status === 'ok') ? 'partial' : 'error'
        : 'ok';
      return this.buildResult(status, mode, dryRun, stages, statePath, lockPath);
    } finally {
      if (!dryRun) releaseLock(lockPath);
    }
  }

  private async runGBrainStage(mode: SyncMode, dryRun: boolean): Promise<SyncStageResult> {
    const started = Date.now();
    if (!this.enabledTools.includes('gbrain')) {
      return makeStageResult('gbrain', mode, dryRun, started, 0, 0, 'skipped', { reason: 'gbrain disabled' });
    }

    if (dryRun) {
      return makeStageResult('gbrain', mode, dryRun, started, 1, 1, 'ok', {
        planned_command: ['gbrain', 'sync'],
      });
    }

    try {
      await this.commandRunner('gbrain', ['sync']);
      return makeStageResult('gbrain', mode, dryRun, started, 1, 1, 'ok');
    } catch (error) {
      return makeStageResult('gbrain', mode, dryRun, started, 1, 0, 'error', undefined, error instanceof Error ? error.message : 'gbrain sync failed');
    }
  }

  private async runToolsStage(
    mode: SyncMode,
    dryRun: boolean,
    statePath: string,
    previousState?: SyncState,
  ): Promise<SyncStageResult> {
    const started = Date.now();
    if (!this.enabledTools.includes('gbrain')) {
      return makeStageResult('tools', mode, dryRun, started, 0, 0, 'skipped', { reason: 'gbrain disabled' });
    }

    const sources = this.enabledTools.map(tool => this.buildSource(tool));
    const previousSources = Object.values(previousState?.sources ?? {});
    const currentIds = new Set(sources.map(source => source.id));
    const legacySources = mode === 'full'
      ? previousSources.filter(source => !currentIds.has(source.id) || !isPathHashSourceId(source.id))
      : [];
    const changedSources = sources.filter(source => {
      const previous = previousState?.sources[source.tool];
      return mode === 'full' || !previous || previous.id !== source.id || previous.path !== source.path;
    });
    let changed = 0;
    const errors: string[] = [];

    for (const source of sources) {
      const shouldWrite = mode === 'full' || changedSources.some(changedSource => changedSource.tool === source.tool);
      if (!shouldWrite) continue;
      changed += 1;

      if (dryRun) continue;

      try {
        attachSourceDotfile(source);
        await this.commandRunner('gbrain', ['sources', 'add', source.id, '--federated']);
      } catch (error) {
        errors.push(`${source.tool}: ${error instanceof Error ? error.message : 'source registration failed'}`);
      }
    }

    for (const legacy of legacySources) {
      changed += 1;
      if (dryRun) continue;
      try {
        await this.commandRunner('gbrain', ['sources', 'remove', legacy.id]);
      } catch (error) {
        errors.push(`${legacy.id}: ${error instanceof Error ? error.message : 'legacy source cleanup failed'}`);
      }
    }

    return makeStageResult(
      'tools',
      mode,
      dryRun,
      started,
      sources.length + legacySources.length,
      changed,
      errors.length > 0 ? 'error' : 'ok',
      {
        state_path: statePath,
        sources,
        legacy_cleanup: legacySources.map(source => source.id),
        commands: [
          ...sources.map(source => ['gbrain', 'sources', 'add', source.id, '--federated']),
          ...legacySources.map(source => ['gbrain', 'sources', 'remove', source.id]),
        ],
      },
      errors.length > 0 ? errors.join('; ') : undefined,
    );
  }

  private buildSource(tool: ToolName): GBrainSourceAttachment {
    const sourcePath = process.env[`GLEARN_TOOL_${tool.toUpperCase()}_PATH`] || this.toolPaths[tool];
    const pathhash8 = createHash('sha256').update(sourcePath).digest('hex').slice(0, 8);
    return {
      tool,
      id: `glearn-${tool}-${pathhash8}`,
      path: sourcePath,
      pathhash8,
      federated: true,
      dotfile_path: join(sourcePath, '.gbrain-source'),
      updated_at: new Date().toISOString(),
    };
  }

  private acquireLock(lockPath: string, staleMs: number): void {
    mkdirSync(dirname(lockPath), { recursive: true });
    if (existsSync(lockPath)) {
      const ageMs = Date.now() - statSync(lockPath).mtimeMs;
      if (staleMs > 0 && ageMs < staleMs) {
        throw new Error(`gstack-gbrain-sync lock is active (${Math.round(ageMs)}ms old)`);
      }
      unlinkSync(lockPath);
    }
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }, null, 2), { flag: 'wx' });
  }

  private buildResult(
    status: SyncResult['status'],
    mode: SyncMode,
    dryRun: boolean,
    stages: SyncStageResult[],
    statePath: string,
    lockPath: string,
  ): SyncResult {
    return {
      status,
      mode,
      dry_run: dryRun,
      stages,
      state_path: statePath,
      lock_path: lockPath,
      timestamp: new Date().toISOString(),
    };
  }
}

function attachSourceDotfile(source: GBrainSourceAttachment): void {
  mkdirSync(source.path, { recursive: true });
  writeFileSync(source.dotfile_path, JSON.stringify(source, null, 2));
}

function readState(statePath: string): SyncState | undefined {
  try {
    if (!existsSync(statePath)) return undefined;
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    if (parsed?.version !== 1 || typeof parsed?.sources !== 'object') return undefined;
    return parsed as SyncState;
  } catch {
    return undefined;
  }
}

function writeStateAtomic(statePath: string, state: SyncState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, statePath);
}

function releaseLock(lockPath: string): void {
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {
    // Stale lock recovery may have already removed it.
  }
}

function isPathHashSourceId(id: string): boolean {
  return /^glearn-[a-z0-9-]+-[a-f0-9]{8}$/.test(id);
}

function makeStageResult(
  stage: string,
  mode: SyncMode,
  dryRun: boolean,
  startedMs: number,
  itemsTotal: number,
  itemsChanged: number,
  status: SyncStageResult['status'],
  details?: Record<string, unknown>,
  error?: string,
): SyncStageResult {
  const completedMs = Date.now();
  return {
    stage,
    status,
    mode,
    dry_run: dryRun,
    started_at: new Date(startedMs).toISOString(),
    completed_at: new Date(completedMs).toISOString(),
    duration_ms: completedMs - startedMs,
    items_total: itemsTotal,
    items_changed: itemsChanged,
    details,
    error,
  };
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', data => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', data => {
      stderr += data.toString();
    });
    proc.on('close', () => resolve({ stdout, stderr }));
    proc.on('error', reject);
  });
}
