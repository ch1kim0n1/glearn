import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GLearn } from '../core/glearn.js';
import { LocalAuditLogger, coreLogger } from '../core/observability.js';
import { createAuthMiddleware, type AuthConfig, type AuthToken } from '@gstack/shared/core';
import { getDefaultSecretManager, PermissionModel } from '../core/security.js';

type McpScope = 'read' | 'write';

interface IssuedToken {
  scopes: McpScope[];
  expiresAt: number;
}

interface RateWindow {
  minuteCount: number;
  minuteStart: number;
  hourCount: number;
  hourStart: number;
}

/**
 * MCP Server for GLearn
 * 
 * Exposes GLearn functionality as MCP tools for Claude Code and other agents
 */
class GLearnMCPServer {
  private server: Server;
  private glearn: GLearn;
  private authMiddleware: ReturnType<typeof createAuthMiddleware>;
  private issuedTokens = new Map<string, IssuedToken>();
  private rateWindows = new Map<string, RateWindow>();
  private requireAuth: boolean;
  private allowAnonymousRead: boolean;
  private defaultScopes: McpScope[];
  private rateLimitRpm: number;
  private rateLimitRph: number;
  private bootstrapToken?: string;
  private bootstrapScopes: McpScope[];
  private permissions: PermissionModel;
  private securityAudit: LocalAuditLogger;

  constructor(authConfig?: AuthConfig) {
    this.server = new Server(
      {
        name: 'glearn',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.glearn = new GLearn();
    this.permissions = PermissionModel.loadDefault();
    this.securityAudit = new LocalAuditLogger('glearn');

    const env = typeof process !== 'undefined' ? process.env : {};
    const secrets = getDefaultSecretManager();
    this.requireAuth = env.GLEARN_REQUIRE_AUTH === 'true';
    this.allowAnonymousRead = env.GLEARN_ALLOW_ANONYMOUS_READ !== 'false';
    this.defaultScopes = this.parseScopes(env.GLEARN_MCP_DEFAULT_SCOPES || 'read,write');
    this.bootstrapToken = secrets.get('glearn_mcp_token');
    this.bootstrapScopes = this.parseScopes(env.GLEARN_MCP_TOKEN_SCOPES || 'read,write');

    this.authMiddleware = createAuthMiddleware(authConfig || {
      secret: secrets.get('glearn_auth_secret') || 'dev-secret-key',
      tool: 'glearn',
      defaultRoles: this.defaultScopes,
    });
    this.rateLimitRpm = this.parseLimit(env.GLEARN_RATE_LIMIT_RPM, 60);
    this.rateLimitRph = this.parseLimit(env.GLEARN_RATE_LIMIT_RPH, 1000);

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'glearn_run',
            description: 'Run a learning cycle to mine patterns and generate proposals across the entire G-Stack',
            inputSchema: {
              type: 'object',
              properties: {
                run_counterfactual: {
                  type: 'boolean',
                  description: 'Run counterfactual evaluation on proposals',
                  default: false,
                },
              },
              required: [],
            },
          },
          {
            name: 'glearn_patterns',
            description: 'List discovered patterns from the learning cycle',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description: 'Filter by pattern type',
                },
                tool: {
                  type: 'string',
                  description: 'Filter by source tool',
                },
              },
              required: [],
            },
          },
          {
            name: 'glearn_get_patterns',
            description: 'Get discovered patterns from the learning cycle',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description: 'Filter by pattern type',
                },
                tool: {
                  type: 'string',
                  description: 'Filter by source tool',
                },
              },
              required: [],
            },
          },
          {
            name: 'glearn_proposals',
            description: 'List generated proposals for system optimization',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'glearn_get_proposals',
            description: 'Get generated proposals for system optimization',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'glearn_approve',
            description: 'Approve a proposal for application',
            inputSchema: {
              type: 'object',
              properties: {
                proposal_id: {
                  type: 'string',
                  description: 'Proposal ID to approve',
                },
                reviewer: {
                  type: 'string',
                  description: 'Reviewer name',
                  default: 'user',
                },
              },
              required: ['proposal_id'],
            },
          },
          {
            name: 'glearn_health',
            description: 'Check health of GLearn and its dependencies',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'glearn_get_receipts',
            description: 'Get execution receipts from the receipt registry',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of receipts to return',
                },
                offset: {
                  type: 'number',
                  description: 'Offset for pagination',
                },
                startDate: {
                  type: 'string',
                  description: 'Start date for filtering (ISO 8601)',
                },
                endDate: {
                  type: 'string',
                  description: 'End date for filtering (ISO 8601)',
                },
              },
            },
          },
          {
            name: 'glearn_get_drift',
            description: 'Get drift statistics for metrics',
            inputSchema: {
              type: 'object',
              properties: {
                metricName: {
                  type: 'string',
                  description: 'Specific metric name to check (optional)',
                },
              },
            },
          },
          {
            name: 'glearn_get_cost_stats',
            description: 'Get cost statistics from the cost ledger',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // Handle tool calls with token auth, read/write scopes, and per-token rate limits.
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const requiredScope = this.requiredScopeForTool(name);
      const auth = this.authorize(request.params._meta, requiredScope);
      if (!auth.ok) {
        this.securityAudit.logSecurityEvent({
          event: 'mcp_auth_denied',
          target: name,
          scope: requiredScope,
          success: false,
          error: auth.error,
        });
        return this.errorResponse(auth.error);
      }

      const rateLimit = this.checkRateLimit(auth.token);
      if (!rateLimit.allowed) {
        this.securityAudit.logSecurityEvent({
          event: 'mcp_rate_limited',
          actor: this.tokenLabel(auth.token),
          target: name,
          scope: requiredScope,
          success: false,
          metadata: { reset_at: rateLimit.resetAt },
        });
        return this.errorResponse(`Rate limit exceeded. Reset at ${rateLimit.resetAt}`);
      }

      try {
        switch (name) {
          case 'glearn_run':
            return await this.handleRun(args as any);
          case 'glearn_patterns':
          case 'glearn_get_patterns':
            return await this.handlePatterns(args as any);
          case 'glearn_proposals':
          case 'glearn_get_proposals':
            return await this.handleProposals();
          case 'glearn_approve':
            return await this.handleApprove(args as any);
          case 'glearn_health':
            return await this.handleHealth();
          case 'glearn_get_receipts':
            return await this.handleGetReceipts(args as any);
          case 'glearn_get_drift':
            return await this.handleGetDrift(args as any);
          case 'glearn_get_cost_stats':
            return await this.handleGetCostStats();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return this.errorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  generateToken(customRoles?: string[]): AuthToken {
    const token = this.authMiddleware.getAuth().generateToken(customRoles);
    this.issuedTokens.set(token.token, {
      scopes: this.parseScopes(token.roles.join(',')),
      expiresAt: new Date(token.expiresAt).getTime(),
    });
    return token;
  }

  private authorize(meta: Record<string, unknown> | undefined, requiredScope: McpScope) {
    const authHeaderRaw = meta?.authorization;
    const authHeader = typeof authHeaderRaw === 'string' ? authHeaderRaw : '';

    if (!authHeader) {
      if (!this.requireAuth && requiredScope === 'read' && this.allowAnonymousRead) {
        return { ok: true as const, token: 'anonymous-read' };
      }
      return { ok: false as const, error: `Authentication failed: missing bearer token for ${requiredScope} scope` };
    }

    const auth = this.authMiddleware.authenticate(authHeader);
    if (!auth.success) {
      return { ok: false as const, error: `Authentication failed: ${auth.error}` };
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const scopes = this.scopesForToken(token, auth.token?.roles || []);
    if (!scopes.includes(requiredScope)) {
      return { ok: false as const, error: `Insufficient permissions: requires ${requiredScope} scope` };
    }

    return { ok: true as const, token };
  }

  private scopesForToken(token: string, fallbackRoles: string[]): McpScope[] {
    const issued = this.issuedTokens.get(token);
    if (issued && issued.expiresAt >= Date.now()) {
      return this.permissions.scopesForToken(token, issued.scopes).filter((scope): scope is McpScope => scope === 'read' || scope === 'write');
    }
    if (this.bootstrapToken && token === this.bootstrapToken) {
      return this.permissions.scopesForToken(token, this.bootstrapScopes).filter((scope): scope is McpScope => scope === 'read' || scope === 'write');
    }
    if (this.bootstrapToken) {
      return [];
    }
    const fallback = this.parseScopes(fallbackRoles.join(','));
    return this.permissions.scopesForToken(token, fallback).filter((scope): scope is McpScope => scope === 'read' || scope === 'write');
  }

  private requiredScopeForTool(name: string): McpScope {
    const writeTools = new Set(['glearn_run', 'glearn_approve']);
    return writeTools.has(name) ? 'write' : 'read';
  }

  private checkRateLimit(token: string) {
    const now = Date.now();
    const minuteMs = 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    let window = this.rateWindows.get(token);
    if (!window) {
      window = { minuteCount: 0, minuteStart: now, hourCount: 0, hourStart: now };
      this.rateWindows.set(token, window);
    }
    if (now - window.minuteStart >= minuteMs) {
      window.minuteStart = now;
      window.minuteCount = 0;
    }
    if (now - window.hourStart >= hourMs) {
      window.hourStart = now;
      window.hourCount = 0;
    }
    if (window.minuteCount >= this.rateLimitRpm || window.hourCount >= this.rateLimitRph) {
      const resetAt = new Date(Math.min(window.minuteStart + minuteMs, window.hourStart + hourMs)).toISOString();
      return { allowed: false, resetAt };
    }
    window.minuteCount++;
    window.hourCount++;
    return { allowed: true, resetAt: new Date(window.minuteStart + minuteMs).toISOString() };
  }

  private tokenLabel(token: string): string {
    return token === 'anonymous-read' ? token : `token:${this.authMiddleware.getAuth().hashToken(token)}`;
  }

  private parseScopes(value: string): McpScope[] {
    const scopes = value
      .split(',')
      .map(scope => scope.trim())
      .filter((scope): scope is McpScope => scope === 'read' || scope === 'write');
    return scopes.length > 0 ? scopes : ['read'];
  }

  private parseLimit(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private errorResponse(text: string) {
    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
      isError: true,
    };
  }

  private async handleRun(args: {
    run_counterfactual?: boolean;
  }) {
    const result = await this.glearn.runLearningCycle({
      run_counterfactual: args.run_counterfactual,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            run_id: result.run_id,
            status: result.status,
            patterns_found: result.patterns_found,
            proposals_generated: result.proposals_generated,
            evaluations_completed: result.evaluations_completed,
            duration_ms: result.completed_at 
              ? new Date(result.completed_at).getTime() - new Date(result.started_at).getTime()
              : 0,
            error_message: result.error_message,
          }, null, 2),
        },
      ],
    };
  }

  private async handlePatterns(args: {
    type?: string;
    tool?: string;
  } = {}) {
    const patterns = this.glearn.getPatterns();
    
    let filtered = patterns;
    if (args.type) {
      filtered = filtered.filter(p => p.pattern_type === args.type);
    }
    if (args.tool) {
      filtered = filtered.filter(p => args.tool ? p.source_tools.includes(args.tool) : true);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(filtered, null, 2),
        },
      ],
    };
  }

  private async handleProposals() {
    const patterns = this.glearn.getPatterns();
    const proposals = await this.glearn.getProposals(patterns);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(proposals, null, 2),
        },
      ],
    };
  }

  private async handleApprove(args: {
    proposal_id: string;
    reviewer?: string;
  }) {
    const result = this.glearn.approveProposal(
      args.proposal_id,
      args.reviewer || 'user'
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleHealth() {
    const health = await this.glearn.healthCheck();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(health, null, 2),
        },
      ],
    };
  }

  private async handleGetReceipts(args: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
  } = {}) {
    const receipts = await this.glearn.getReceipts(args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(receipts, null, 2),
        },
      ],
    };
  }

  private async handleGetDrift(args: {
    metricName?: string;
  } = {}) {
    const drift = await this.glearn.getDrift(args.metricName);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(drift, null, 2),
        },
      ],
    };
  }

  private async handleGetCostStats() {
    const stats = this.glearn.getCostStats();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    coreLogger.info('GLearn MCP Server started');
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new GLearnMCPServer();
  server.start().catch((error) => coreLogger.error('GLearn MCP Server failed', error instanceof Error ? error : { error: String(error) }));
}

export { GLearnMCPServer };
