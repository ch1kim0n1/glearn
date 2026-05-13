// glearn/test/mcp.test.ts
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('GLearn MCP Server', () => {
  const serverSource = readFileSync(join(__dirname, '../src/mcp/server.ts'), 'utf8');

  it('declares the expected server identity', () => {
    expect(serverSource).toContain("name: 'glearn'");
    expect(serverSource).toContain("version: '0.1.0'");
  });

  it('declares the expected tool names', () => {
    for (const tool of ['glearn_run', 'glearn_patterns', 'glearn_proposals', 'glearn_approve', 'glearn_health']) {
      expect(serverSource).toContain(tool);
    }
  });

  it('declares required schemas for proposal approval', () => {
    expect(serverSource).toContain("required: ['proposal_id']");
  });
});
