import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { GStackGBrainSync } from '../src/core/gstack-gbrain-sync';

describe('GStackGBrainSync', () => {
  let root: string;
  let syncRoot: string;
  let toolPaths: Record<string, string>;
  let commandRunner: jest.Mock;
  const tools = ['gbrain', 'gstack', 'gorchestrator', 'gmirror', 'gtom', 'glearn'] as const;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'glearn-gstack-sync-'));
    syncRoot = path.join(root, 'sync');
    toolPaths = Object.fromEntries(tools.map(tool => {
      const toolPath = path.join(root, tool);
      mkdirSync(toolPath, { recursive: true });
      return [tool, toolPath];
    }));
    commandRunner = jest.fn(async () => ({ stdout: '', stderr: '' }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('emits a tools stage, attaches .gbrain-source files, and registers pathhash8 federated sources', async () => {
    const sync = new GStackGBrainSync({ syncRoot, toolPaths, commandRunner });
    const result = await sync.run({ mode: 'full' });
    const toolsStage = result.stages.find(stage => stage.stage === 'tools');

    expect(result.status).toBe('ok');
    expect(toolsStage?.status).toBe('ok');
    expect(toolsStage?.items_total).toBe(tools.length);
    expect(toolsStage?.items_changed).toBe(tools.length);

    for (const tool of tools) {
      const dotfile = path.join(toolPaths[tool], '.gbrain-source');
      const source = JSON.parse(readFileSync(dotfile, 'utf8'));
      expect(source.tool).toBe(tool);
      expect(source.federated).toBe(true);
      expect(source.pathhash8).toMatch(/^[a-f0-9]{8}$/);
      expect(source.id).toBe(`glearn-${tool}-${source.pathhash8}`);
      expect(commandRunner).toHaveBeenCalledWith('gbrain', ['sources', 'add', source.id, '--federated']);
    }

    expect(commandRunner).toHaveBeenCalledWith('gbrain', ['sync']);
  });

  it('supports dry-run without writes or command execution', async () => {
    const sync = new GStackGBrainSync({ syncRoot, toolPaths, commandRunner });
    const result = await sync.run({ mode: 'full', dryRun: true });

    expect(result.status).toBe('ok');
    expect(result.dry_run).toBe(true);
    expect(commandRunner).not.toHaveBeenCalled();
    expect(result.stages.find(stage => stage.stage === 'tools')?.details?.commands).toBeDefined();

    for (const tool of tools) {
      expect(() => readFileSync(path.join(toolPaths[tool], '.gbrain-source'), 'utf8')).toThrow();
    }
  });

  it('cleans legacy sources during full sync', async () => {
    mkdirSync(syncRoot, { recursive: true });
    writeFileSync(path.join(syncRoot, 'gstack-gbrain-sync-state.json'), JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      mode: 'incremental',
      sources: {
        gstack: {
          tool: 'gstack',
          id: 'legacy-gstack-source',
          path: toolPaths.gstack,
          pathhash8: 'legacy',
          federated: true,
          dotfile_path: path.join(toolPaths.gstack, '.gbrain-source'),
          updated_at: new Date().toISOString(),
        },
      },
    }));

    const sync = new GStackGBrainSync({ syncRoot, toolPaths, commandRunner });
    const result = await sync.run({ mode: 'full' });

    expect(result.stages.find(stage => stage.stage === 'tools')?.details?.legacy_cleanup).toContain('legacy-gstack-source');
    expect(commandRunner).toHaveBeenCalledWith('gbrain', ['sources', 'remove', 'legacy-gstack-source']);
  });

  it('rejects active locks and takes over stale locks', async () => {
    mkdirSync(syncRoot, { recursive: true });
    const lockPath = path.join(syncRoot, 'gstack-gbrain-sync.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 1, created_at: new Date().toISOString() }));

    const sync = new GStackGBrainSync({ syncRoot, toolPaths, commandRunner });
    const locked = await sync.run({ mode: 'incremental', lockTimeoutMs: 60_000 });
    expect(locked.status).toBe('error');
    expect(locked.stages[0].stage).toBe('lock');

    const stale = await sync.run({ mode: 'incremental', lockTimeoutMs: 0 });
    expect(stale.status).toBe('ok');
  });
});
