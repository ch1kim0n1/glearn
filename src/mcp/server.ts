import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GLearn } from '../core/glearn.js';

/**
 * MCP Server for GLearn
 * 
 * Exposes GLearn functionality as MCP tools for Claude Code and other agents
 */
class GLearnMCPServer {
  private server: Server;
  private glearn: GLearn;

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
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

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
