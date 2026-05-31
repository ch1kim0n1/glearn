import { describe, expect, it } from '@jest/globals';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

const root = join(__dirname, '..');

function writeFile(rootDir: string, relativePath: string, content = '') {
  const absolutePath = join(rootDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function createPackageGateFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'glearn-quality-gates-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(join(root, 'scripts/quality-gates.js'), join(dir, 'scripts/quality-gates.js'));

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

  writeFile(dir, 'src/cli.ts');
  writeFile(dir, 'src/mcp/server.ts');
  writeFile(dir, 'scripts/eval-tools.js');
  writeFile(dir, 'jest.config.js');
  writeFile(dir, 'tsconfig.json');
  writeFile(dir, 'LICENSE', 'MIT');
  writeFile(dir, 'dist/core/index.js');
  writeFile(dir, 'dist/core/index.d.ts');
  writeFile(dir, 'dist/cli.js');
  writeFile(dir, 'dist/cli.d.ts');
  writeFile(dir, 'dist/sdk.js');
  writeFile(dir, 'dist/sdk.d.ts');
  writeFile(dir, 'dist/client.js');
  writeFile(dir, 'dist/client.d.ts');

  return dir;
}

function runPackageGate(rootDir: string) {
  return spawnSync(process.execPath, ['scripts/quality-gates.js', 'package-contract'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

describe('quality gate package contract', () => {
  it('passes for a complete package fixture', () => {
    const dir = createPackageGateFixture();
    try {
      const result = runPackageGate(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('[quality-gates] OK: package contract');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when package metadata is missing', () => {
    const dir = createPackageGateFixture();
    try {
      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      delete pkg.repository;
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

      const result = runPackageGate(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('package.json missing repository');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a post-build export target is missing', () => {
    const dir = createPackageGateFixture();
    try {
      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg.exports['.'].import = './dist/missing.js';
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

      const result = runPackageGate(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('package entry point target does not exist after build: ./dist/missing.js');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
