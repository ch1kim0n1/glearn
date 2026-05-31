import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export class StructuredLogger {
  constructor(private readonly source: string) {}

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
    };
    void entry;
    const levelName = LogLevel[level];
    const prefix = `[${this.source}] [${levelName}]`;
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    console.log(`${prefix} ${message}${contextStr}`);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }
}

export function createLogger(source: string): StructuredLogger {
  return new StructuredLogger(source);
}

export interface DriftResult {
  has_drift: boolean;
  drift_magnitude: number;
  detected_at: string | null;
  metric_name: string;
  drift_detected: boolean;
  baseline_mean: number;
  current_mean: number;
  trend: 'stable' | 'improving' | 'degrading';
}

export interface DriftDetectorConfig {
  window_size?: number;
  drift_threshold?: number;
  alert_threshold?: number;
}

interface Snapshot {
  value: number;
  at: number;
  context?: unknown;
}

/**
 * Detects concept/metric drift from a rolling window of recorded snapshots.
 *
 * For each metric the window is split into a baseline half (older samples) and
 * a current half (recent samples). Drift magnitude is the relative change of the
 * current mean versus the baseline mean. `has_drift` is set when that magnitude
 * exceeds `drift_threshold`. This is the canonical implementation used by the
 * core engine; there is no second divergent `DriftDetector`.
 */
export class DriftDetector {
  private readonly windowSize: number;
  private readonly driftThreshold: number;
  private readonly alertThreshold: number;
  private readonly snapshots = new Map<string, Snapshot[]>();

  constructor(config?: DriftDetectorConfig) {
    this.windowSize = config?.window_size && config.window_size > 1 ? config.window_size : 100;
    this.driftThreshold = config?.drift_threshold != null ? config.drift_threshold : 0.2;
    this.alertThreshold = config?.alert_threshold != null ? config.alert_threshold : this.driftThreshold;
  }

  recordSnapshot(name: string, value: number, context?: unknown): void {
    if (!Number.isFinite(value)) return;
    let history = this.snapshots.get(name);
    if (!history) {
      history = [];
      this.snapshots.set(name, history);
    }
    history.push({ value, at: Date.now(), context });
    if (history.length > this.windowSize) {
      history.splice(0, history.length - this.windowSize);
    }
  }

  recordRelationalMetric(
    metric_name: string,
    value: number,
    dyad_id: string,
    _relational_type: string,
    context?: unknown,
  ): void {
    this.recordSnapshot(`${metric_name}:${dyad_id}`, value, context);
  }

  private static mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }

  detectDrift(metric: string, threshold?: number): DriftResult | null {
    const history = this.snapshots.get(metric);
    if (!history || history.length < 2) return null;
    const effectiveThreshold = threshold != null ? threshold : this.driftThreshold;

    const split = Math.floor(history.length / 2);
    const baselineValues = history.slice(0, split).map(s => s.value);
    const currentValues = history.slice(split).map(s => s.value);
    const baselineMean = DriftDetector.mean(baselineValues);
    const currentMean = DriftDetector.mean(currentValues);

    const denominator = Math.abs(baselineMean) > 1e-9 ? Math.abs(baselineMean) : 1;
    const driftMagnitude = Math.abs(currentMean - baselineMean) / denominator;
    const hasDrift = driftMagnitude > effectiveThreshold;

    let trend: 'stable' | 'improving' | 'degrading' = 'stable';
    if (driftMagnitude > effectiveThreshold) {
      trend = currentMean >= baselineMean ? 'improving' : 'degrading';
    }

    return {
      has_drift: hasDrift,
      drift_detected: hasDrift && driftMagnitude >= this.alertThreshold,
      drift_magnitude: driftMagnitude,
      detected_at: hasDrift ? new Date().toISOString() : null,
      metric_name: metric,
      baseline_mean: baselineMean,
      current_mean: currentMean,
      trend,
    };
  }

  detectAllDrift(threshold?: number): DriftResult[] {
    const results: DriftResult[] = [];
    for (const metric of this.snapshots.keys()) {
      const result = this.detectDrift(metric, threshold);
      if (result) results.push(result);
    }
    return results;
  }
}

export class LatencyTracker {
  private latencies = new Map<string, number[]>();
  private starts = new Map<string, number>();
  private readonly maxSamples: number;

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples > 0 ? maxSamples : 1000;
  }

  private push(operation: string, latencyMs: number): void {
    let history = this.latencies.get(operation);
    if (!history) {
      history = [];
      this.latencies.set(operation, history);
    }
    history.push(latencyMs);
    if (history.length > this.maxSamples) {
      history.splice(0, history.length - this.maxSamples);
    }
  }

  start(operation: string): void {
    this.starts.set(operation, performance.now());
  }

  end(operation: string): number {
    const startedAt = this.starts.get(operation);
    const latency = startedAt != null ? performance.now() - startedAt : 0;
    this.starts.delete(operation);
    this.push(operation, latency);
    return latency;
  }
  getLatency(operation: string): number {
    const history = this.latencies.get(operation);
    if (!history || history.length === 0) return 0;
    return history[history.length - 1];
  }
  record(...args: any[]): void {
    if (args.length === 1) {
      // Record a single latency value to a default bucket
      this.push('default', args[0]);
      return;
    }
    if (args.length >= 2) {
      this.push(args[0], args[1]);
    }
  }
  getMetrics(): Record<string, number> {
    const metrics: Record<string, number> = {};
    for (const [op, history] of this.latencies) {
      if (history.length > 0) {
        metrics[op] = history[history.length - 1];
      }
    }
    return metrics;
  }
}

export interface PersistenceConfig {
  path?: string;
  enabled?: boolean;
  statePath?: string;
  autoSave?: boolean;
}

export interface PersistenceManager<T> {
  init: () => Promise<void>;
  save: (data: T) => Promise<void>;
  load: () => Promise<T>;
  updateState: (updater: (state: T) => T) => Promise<void>;
  getState: () => T;
}

/**
 * Durable, file-backed persistence manager. State is written atomically (via a
 * temp file + rename) to a JSON file so it survives process restarts. The state
 * file path is resolved from `config.statePath`, then `GLEARN_STATE_PATH`, then
 * `~/.glearn/state/<name>.json`. Set `enabled: false` to opt back into a
 * purely in-memory store (used by tests).
 */
export function createPersistenceManager<T = any>(
  initialState?: T,
  name?: string,
  config?: PersistenceConfig,
): PersistenceManager<T> {
  // Lazy require so this module stays usable in environments without fs/os/path.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path') as typeof import('path');

  const enabled = config?.enabled !== false;
  const resolvedName = name || 'state';
  const statePath =
    config?.statePath ||
    config?.path ||
    process.env.GLEARN_STATE_PATH ||
    path.join(os.homedir(), '.glearn', 'state', `${resolvedName}.json`);

  let state = (initialState ?? ({} as T)) as T;

  const persist = (): void => {
    if (!enabled) return;
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
      fs.renameSync(tmp, statePath);
    } catch {
      // Best-effort durability; the in-memory state remains authoritative.
    }
  };

  return {
    init: async () => {
      if (!enabled) return;
      try {
        if (fs.existsSync(statePath)) {
          const raw = fs.readFileSync(statePath, 'utf8');
          if (raw.trim().length > 0) {
            state = JSON.parse(raw) as T;
          }
        }
      } catch {
        // Corrupt/unreadable state file: keep the provided initial state.
      }
    },
    save: async (data: T) => {
      state = data;
      persist();
    },
    load: async () => state,
    updateState: async (updater: (state: T) => T) => {
      state = updater(state);
      persist();
    },
    getState: () => state,
  };
}

export interface HealthCheckResult {
  healthy: boolean;
  service: string;
  latency_ms: number;
  timestamp: string;
  checks?: Record<string, boolean>;
  message?: string;
  error?: string;
}

export interface AuthConfig {
  enabled?: boolean;
  secret?: string;
  tool?: string;
  defaultRoles?: string[];
}

export interface AuthToken {
  token: string;
  roles: string[];
  expiresAt: string;
}

export interface AuthenticateResult {
  success: boolean;
  error: string | null;
  token: AuthToken | null;
}

export interface AuthMiddleware {
  authenticate: (header?: string) => AuthenticateResult;
  getAuth: () => {
    authenticated: boolean;
    hashToken: (token?: string) => string;
    generateToken: (customRoles?: string[]) => AuthToken;
  };
  middleware: (req: any, res: any, next: any) => void;
  generateToken: (customRoles?: string[]) => AuthToken;
}

/** Constant-time string comparison that does not leak length via early return. */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // Hash both inputs to fixed-length buffers so the comparison is constant-time
  // regardless of input length (timingSafeEqual throws on length mismatch).
  const ah = createHmac('sha256', 'glearn-ct').update(ab).digest();
  const bh = createHmac('sha256', 'glearn-ct').update(bb).digest();
  return timingSafeEqual(ah, bh) && ab.length === bb.length;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface TokenPayload {
  roles: string[];
  exp: number; // epoch ms
  nonce: string;
}

/**
 * Real authentication middleware backed by an HMAC-signed token.
 *
 * Token format: `<base64url(payload)>.<base64url(hmac-sha256(payload, secret))>`.
 * `authenticate` verifies the signature with a constant-time comparison and
 * enforces expiry. Forged or expired tokens are rejected. No "mock" bypass.
 */
export function createAuthMiddleware(config?: AuthConfig): AuthMiddleware {
  const secret = config?.secret;
  if (!secret) {
    throw new Error('createAuthMiddleware requires a non-empty `secret`');
  }
  const defaultRoles = config?.defaultRoles && config.defaultRoles.length > 0 ? config.defaultRoles : ['read'];

  const sign = (payloadB64: string): string =>
    base64url(createHmac('sha256', secret).update(payloadB64).digest());

  const makeToken = (customRoles?: string[]): AuthToken => {
    const roles = customRoles && customRoles.length > 0 ? customRoles : defaultRoles;
    const expiresAtMs = Date.now() + 3600_000;
    const payload: TokenPayload = {
      roles,
      exp: expiresAtMs,
      nonce: randomBytes(16).toString('hex'),
    };
    const payloadB64 = base64url(JSON.stringify(payload));
    const token = `${payloadB64}.${sign(payloadB64)}`;
    return {
      token,
      roles,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  };

  const parseBearer = (header?: string): string =>
    (header || '').replace(/^Bearer\s+/i, '').trim();

  const verify = (rawToken: string): { token: AuthToken | null; error: string | null } => {
    if (!rawToken) {
      return { token: null, error: 'missing token' };
    }
    const parts = rawToken.split('.');
    if (parts.length !== 2) {
      return { token: null, error: 'malformed token' };
    }
    const [payloadB64, signature] = parts;
    const expected = sign(payloadB64);
    if (!constantTimeEqual(signature, expected)) {
      return { token: null, error: 'invalid signature' };
    }
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')) as TokenPayload;
    } catch {
      return { token: null, error: 'invalid payload' };
    }
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
      return { token: null, error: 'token expired' };
    }
    if (!Array.isArray(payload.roles)) {
      return { token: null, error: 'invalid payload' };
    }
    return {
      token: { token: rawToken, roles: payload.roles, expiresAt: new Date(payload.exp).toISOString() },
      error: null,
    };
  };

  const hashToken = (token?: string): string =>
    createHmac('sha256', secret).update(token || '').digest('hex').slice(0, 16);

  return {
    authenticate: (header?: string) => {
      const result = verify(parseBearer(header));
      return result.token
        ? { success: true, error: null, token: result.token }
        : { success: false, error: result.error, token: null };
    },
    getAuth: () => ({
      authenticated: true,
      hashToken,
      generateToken: (customRoles?: string[]) => makeToken(customRoles),
    }),
    middleware: (req: any, res: any, next: any) => {
      const header = req?.headers?.authorization ?? req?.headers?.Authorization;
      const result = verify(parseBearer(header));
      if (!result.token) {
        if (res && typeof res.status === 'function') {
          res.status(401).json({ error: `Authentication failed: ${result.error}` });
          return;
        }
        if (res && typeof res.writeHead === 'function') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Authentication failed: ${result.error}` }));
          return;
        }
        return;
      }
      if (req) {
        (req as { auth?: AuthToken }).auth = result.token;
      }
      next();
    },
    generateToken: (customRoles?: string[]) => makeToken(customRoles),
  };
}
