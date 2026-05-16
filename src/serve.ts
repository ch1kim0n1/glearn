import { GLearnMCPServer } from './mcp/server.js';
import { LocalLogger, type LogLevel } from './core/observability.js';
import { SecureHealthServer } from './core/public-health-server.js';

const HEALTH_PORT = process.env.HEALTH_PORT ? parseInt(process.env.HEALTH_PORT, 10) : 8080;
const logger = new LocalLogger('glearn-serve', (process.env.GLEARN_LOG_LEVEL as LogLevel) || 'INFO');

async function main() {
  const server = new GLearnMCPServer();

  // Create health server
  const healthServer = new SecureHealthServer(
    async () => ({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }),
    async () => ({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      dependencies: {},
    }),
    HEALTH_PORT
  );

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    await healthServer.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  healthServer.addShutdownHandler(async () => {
    logger.info('Cleanup complete');
  });

  try {
    await healthServer.start();
    await server.start();
  } catch (error) {
    logger.error('Failed to start GLearn', error instanceof Error ? error : { error: String(error) });
    process.exit(1);
  }
}

main().catch((error) => logger.error('Main function error', error instanceof Error ? error : { error: String(error) }));
