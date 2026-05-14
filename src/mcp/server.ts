import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GLearn } from '../core/glearn.js';
import { createAuthMiddleware } from '../../../shared/src/core/token-auth.js';
import { AuthRateLimiter } from '../../../shared/src/core/auth-rate-limit.js';

/**
 * MCP Server for GLearn
 * 
 * Exposes GLearn functionality as MCP tools for Claude Code and other agents
 */
class GLearnMCPServer {
  private server: Server;
  private glearn: GLearn;
  private authMiddleware: any;
  private rateLimiter!: AuthRateLimiter;

  constructor() {
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

    // Initialize authentication middleware
    const authSecret = process.env.GLEARN_AUTH_SECRET || 'dev-secret-key';
    this.authMiddleware = createAuthMiddleware({
      secret: authSecret,
      tool: 'glearn',
      defaultRoles: ['read', 'write'],
    });

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
            name: 'glearn_proposals',
            description: 'List generated proposals for system optimization',
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

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Authentication check (for MVP, this is a no-op since stdio servers authenticate at process level)
      // In production with HTTP transport, this would validate the Authorization header
      const authHeaderRaw = request.params._meta?.authorization;
      const authHeader = typeof authHeaderRaw === "string" ? authHeaderRaw : "";
      if (authHeader) {
        const auth = this.authMiddleware.authenticate(authHeader);
        if (!auth.success) {
          return {
            content: [
              {
                type: 'text',
                text: `Authentication failed: ${auth.error}`,
              },
            ],
            isError: true,
          };
        }
      }

      try {
        switch (name) {
          case 'glearn_run':
            return await this.handleRun(args as any);
          case 'glearn_patterns':
            return await this.handlePatterns(args as any);
          case 'glearn_proposals':
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
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
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
  }) {
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
    const proposals = this.glearn.getProposals(patterns);

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
  }) {
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
  }) {
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
    console.error('[GLearn MCP Server] Started');
  }
}

// Start server if run directly
// @ts-ignore - CommonJS compatibility
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new GLearnMCPServer();
  server.start().catch(console.error);
}

export { GLearnMCPServer };
