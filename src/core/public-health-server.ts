import { IncomingMessage, Server as HttpServer, ServerResponse, createServer } from 'http';
import { getDefaultSecretManager } from './security.js';
import { safeEqual } from '../security/crypto.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
}

export interface ReadinessCheckResult extends HealthCheckResult {
  dependencies: Record<string, 'ok' | 'error'>;
}

interface RateWindow {
  count: number;
  startedAt: number;
}

export class SecureHealthServer {
  private server?: HttpServer;
  private isShuttingDown = false;
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private windows = new Map<string, RateWindow>();
  private limit = Number(process.env.GLEARN_HEALTH_RATE_LIMIT_RPM || '120');
  private shutdownToken = getDefaultSecretManager().get('health_shutdown_token');

  constructor(
    private livenessCheck: () => Promise<HealthCheckResult>,
    private readinessCheck: () => Promise<ReadinessCheckResult>,
    private port = 8080,
    private shutdownTimeout = 30000,
  ) {}

  addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  async start(): Promise<void> {
    if (this.server) throw new Error('Health server already running');
    this.server = createServer((req, res) => void this.handleRequest(req, res));
    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, () => resolve());
      this.server!.on('error', reject);
    });
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    for (const handler of this.shutdownHandlers) await handler();
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
      setTimeout(resolve, this.shutdownTimeout);
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Security headers (helmet-equivalent for plain http server)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return this.json(res, 204, {});

    const rate = this.checkRate(req.socket.remoteAddress || 'unknown');
    if (!rate.allowed) return this.json(res, 429, { error: 'rate_limited', reset_at: rate.resetAt });

    try {
      if (req.url === '/health/live' && req.method === 'GET') {
        const result = this.isShuttingDown ? { status: 'unhealthy' as const, timestamp: new Date().toISOString() } : await this.livenessCheck();
        return this.json(res, result.status === 'healthy' ? 200 : 503, result);
      }
      if (req.url === '/health/ready' && req.method === 'GET') {
        const result = this.isShuttingDown
          ? { status: 'unhealthy' as const, timestamp: new Date().toISOString(), dependencies: {} }
          : await this.readinessCheck();
        return this.json(res, result.status === 'healthy' ? 200 : 503, result);
      }
      if (req.url === '/health/shutdown' && req.method === 'POST') {
        if (!this.authorizeShutdown(req.headers.authorization)) return this.json(res, 403, { error: 'shutdown token required' });
        this.json(res, 202, { status: 'shutdown_initiated' });
        void this.shutdown();
        return;
      }
      return this.json(res, 404, { error: 'not_found' });
    } catch {
      return this.json(res, 500, { error: 'internal_server_error' });
    }
  }

  private authorizeShutdown(header?: string): boolean {
    if (!this.shutdownToken) return false;
    const provided = (header || '').replace(/^Bearer\s+/i, '');
    if (!provided) return false;
    return safeEqual(provided, this.shutdownToken);
  }

  /** Maximum number of distinct rate-limit windows retained at once. */
  private maxWindows = Number(process.env.GLEARN_HEALTH_RATE_LIMIT_MAX_KEYS || '10000');
  private lastSweep = 0;

  /**
   * Opportunistically evict windows whose 60s span has fully elapsed so the Map
   * cannot grow without bound under sustained unique-key load. Throttled to at
   * most once per second. If the Map still exceeds `maxWindows`, the oldest
   * entries are dropped (insertion order ≈ recency for active keys).
   */
  private sweepWindows(now: number): void {
    if (now - this.lastSweep < 1_000 && this.windows.size <= this.maxWindows) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= 60_000) this.windows.delete(key);
    }
    if (this.windows.size > this.maxWindows) {
      const overflow = this.windows.size - this.maxWindows;
      let removed = 0;
      for (const key of this.windows.keys()) {
        if (removed++ >= overflow) break;
        this.windows.delete(key);
      }
    }
  }

  private checkRate(key: string): { allowed: boolean; resetAt: string } {
    const now = Date.now();
    this.sweepWindows(now);
    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= 60_000) {
      window = { count: 0, startedAt: now };
      this.windows.set(key, window);
    }
    if (window.count >= this.limit) return { allowed: false, resetAt: new Date(window.startedAt + 60_000).toISOString() };
    window.count++;
    return { allowed: true, resetAt: new Date(window.startedAt + 60_000).toISOString() };
  }

  private json(res: ServerResponse, statusCode: number, body: object): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}
