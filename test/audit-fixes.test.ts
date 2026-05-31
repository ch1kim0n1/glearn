import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createAuthMiddleware,
  LatencyTracker,
  DriftDetector,
  createPersistenceManager,
} from '../src/core/shared-utils';
import { safeEqual, hashWithSalt, verifyHash } from '../src/security/crypto';
import { OAuthProvider } from '../src/auth/oauth-provider';
import * as authIndex from '../src/auth/index';
import { SecureHealthServer } from '../src/core/public-health-server';

const SECRET = ['signing', 'key', 'for', 'tests'].join('-');

describe('#43 createAuthMiddleware — real token verification', () => {
  it('throws when no secret is configured (no silent mock)', () => {
    expect(() => createAuthMiddleware({})).toThrow(/secret/i);
  });

  it('accepts a token it issued', () => {
    const mw = createAuthMiddleware({ secret: SECRET, defaultRoles: ['read', 'write'] });
    const issued = mw.generateToken(['read', 'write']);
    const result = mw.authenticate(`Bearer ${issued.token}`);
    expect(result.success).toBe(true);
    expect(result.token?.roles).toEqual(['read', 'write']);
  });

  it('rejects an arbitrary / forged bearer token', () => {
    const mw = createAuthMiddleware({ secret: SECRET });
    expect(mw.authenticate('Bearer anything').success).toBe(false);
    expect(mw.authenticate('Bearer abc.def').success).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const issuer = createAuthMiddleware({ secret: 'other-secret' });
    const verifier = createAuthMiddleware({ secret: SECRET });
    const forged = issuer.generateToken(['write']);
    expect(verifier.authenticate(`Bearer ${forged.token}`).success).toBe(false);
  });

  it('rejects an expired token', () => {
    const mw = createAuthMiddleware({ secret: SECRET });
    // Craft a token with a past expiry, signed correctly, to prove expiry is enforced.
    const { createHmac } = require('crypto');
    const b64url = (s: string | Buffer) =>
      Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = b64url(JSON.stringify({ roles: ['read'], exp: Date.now() - 1000, nonce: 'x' }));
    const sig = b64url(createHmac('sha256', SECRET).update(payload).digest());
    expect(mw.authenticate(`Bearer ${payload}.${sig}`).success).toBe(false);
  });

  it('never returns a hardcoded "mock" token', () => {
    const mw = createAuthMiddleware({ secret: SECRET });
    const issued = mw.generateToken();
    expect(issued.token).not.toBe('mock');
    expect(mw.getAuth().hashToken('x')).not.toBe('mock');
  });
});

describe('#46 LatencyTracker — measured latency', () => {
  it('measures real elapsed time, not Math.random', async () => {
    const tracker = new LatencyTracker(100);
    tracker.start('op');
    await new Promise((r) => setTimeout(r, 40));
    const ms = tracker.end('op');
    expect(ms).toBeGreaterThanOrEqual(30);
    expect(ms).toBeLessThan(500);
  });

  it('returns 0 when end() is called without a matching start()', () => {
    const tracker = new LatencyTracker();
    expect(tracker.end('never-started')).toBe(0);
  });
});

describe('#45 DriftDetector — real drift detection', () => {
  it('detects drift when a metric drops past the threshold', () => {
    const d = new DriftDetector({ drift_threshold: 0.2 });
    // baseline high, then degrade
    for (const v of [1.0, 1.0, 1.0, 1.0]) d.recordSnapshot('bid_acceptance_rate:dyad1', v);
    for (const v of [0.5, 0.5, 0.5, 0.5]) d.recordSnapshot('bid_acceptance_rate:dyad1', v);
    const result = d.detectDrift('bid_acceptance_rate:dyad1');
    expect(result).not.toBeNull();
    expect(result!.has_drift).toBe(true);
    expect(result!.trend).toBe('degrading');
    expect(result!.drift_magnitude).toBeGreaterThan(0.2);
  });

  it('reports no drift for a stable metric', () => {
    const d = new DriftDetector({ drift_threshold: 0.2 });
    for (const v of [0.8, 0.8, 0.81, 0.79, 0.8, 0.8]) d.recordSnapshot('labor_ratio:dyad1', v);
    const result = d.detectDrift('labor_ratio:dyad1');
    expect(result!.has_drift).toBe(false);
  });

  it('detectAllDrift returns one result per recorded metric', () => {
    const d = new DriftDetector();
    d.recordSnapshot('a', 1);
    d.recordSnapshot('a', 2);
    d.recordSnapshot('b', 1);
    d.recordSnapshot('b', 1);
    expect(d.detectAllDrift().map((r) => r.metric_name).sort()).toEqual(['a', 'b']);
  });
});

describe('#45 createPersistenceManager — durable across restarts', () => {
  it('reloads persisted state from disk in a fresh instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'glearn-persist-'));
    const statePath = join(dir, 'state.json');
    try {
      const m1 = createPersistenceManager({ count: 0 }, 'glearn', { statePath });
      await m1.init();
      await m1.updateState((s) => ({ count: s.count + 5 }));

      // Simulate a process restart with a brand new manager + initial state.
      const m2 = createPersistenceManager({ count: 0 }, 'glearn', { statePath });
      await m2.init();
      expect(m2.getState().count).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#48 constant-time comparison + HMAC hashing', () => {
  it('safeEqual matches equal strings and rejects different ones', () => {
    expect(safeEqual('token-abc', 'token-abc')).toBe(true);
    expect(safeEqual('token-abc', 'token-abd')).toBe(false);
    expect(safeEqual('short', 'longer-value')).toBe(false);
  });

  it('hashWithSalt is keyed HMAC (depends on salt as key)', () => {
    expect(hashWithSalt('data', 'salt1')).not.toBe(hashWithSalt('data', 'salt2'));
    expect(verifyHash('data', hashWithSalt('data', 'saltX'), 'saltX')).toBe(true);
    expect(verifyHash('data', hashWithSalt('data', 'saltX'), 'saltY')).toBe(false);
  });
});

describe('#47 OAuthProvider — random opaque tokens, expiry enforced, not public', () => {
  it('is not exported from the public auth barrel', () => {
    expect((authIndex as Record<string, unknown>).OAuthProvider).toBeUndefined();
  });

  it('exchangeCodeForToken does not mint predictable timestamp tokens', async () => {
    const provider = new OAuthProvider({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://app/cb',
      scopes: ['read'],
      // No tokenEndpoint -> must refuse rather than fabricate a token.
    });
    await expect(provider.exchangeCodeForToken('code')).rejects.toThrow(/not implemented/i);
  });

  it('validateToken rejects unknown tokens', () => {
    const provider = new OAuthProvider({ clientId: 'c', clientSecret: 's', redirectUri: 'u', scopes: [] });
    expect(provider.validateToken('token-12345')).toBe(false);
  });
});

describe('#55 health-server rate-limit map is bounded / evicts stale keys', () => {
  it('evicts windows older than 60s and caps total size', () => {
    const live = async () => ({ status: 'healthy' as const, timestamp: new Date().toISOString() });
    const ready = async () => ({ status: 'healthy' as const, timestamp: new Date().toISOString(), dependencies: {} });
    const server = new SecureHealthServer(live, ready) as any;

    // Force a small cap to make the bound observable.
    server.maxWindows = 50;

    // Simulate 1000 distinct stale source addresses recorded > 60s ago.
    const stale = Date.now() - 120_000;
    for (let i = 0; i < 1000; i++) {
      server.windows.set(`10.0.0.${i}`, { count: 1, startedAt: stale });
    }
    expect(server.windows.size).toBe(1000);

    // A new request triggers an opportunistic sweep.
    const result = server.checkRate('192.168.1.1');
    expect(result.allowed).toBe(true);

    // All stale entries evicted; size is bounded well under the flood.
    expect(server.windows.size).toBeLessThanOrEqual(server.maxWindows);
    expect(server.windows.has('10.0.0.0')).toBe(false);
  });
});

describe('#50 / #44 packaging contract', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../package.json');

  it('exports map points only at ./dist (not ./dist/glearn/src)', () => {
    const json = JSON.stringify(pkg.exports);
    expect(json).not.toContain('dist/glearn/src');
    expect(pkg.exports['.'].import).toBe('./dist/sdk.js');
  });

  it('cli.ts resolves version from package.json (not hardcoded 0.1.0)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    const src = readFileSync(join(__dirname, '../src/cli.ts'), 'utf8');
    expect(src).toContain('resolvePackageVersion');
    expect(src).not.toContain(".version('0.1.0')");
  });
});
