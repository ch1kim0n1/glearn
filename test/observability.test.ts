import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GLearnObservability, redactPII } from '../src/core/observability';
import { GLearn } from '../src/core/glearn';

describe('GLearn observability', () => {
  const originalAuditDir = process.env.GLEARN_AUDIT_DIR;

  afterEach(() => {
    if (originalAuditDir === undefined) delete process.env.GLEARN_AUDIT_DIR;
    else process.env.GLEARN_AUDIT_DIR = originalAuditDir;
  });

  it('redacts PII from structured payloads', () => {
    expect(redactPII({
      user_email: 'person@example.com',
      nested: { api_key: 'test-key' },
      message: 'contact person@example.com',
    })).toEqual({
      user_email: '[REDACTED]',
      nested: { api_key: '[REDACTED]' },
      message: 'contact [REDACTED_EMAIL]',
    });
  });

  it('exports Prometheus and OpenTelemetry metrics with latency quantiles', () => {
    const observability = new GLearnObservability('glearn');
    observability.metrics.recordPublicMethod('runLearningCycle', 10, 'ok');
    observability.metrics.recordPublicMethod('runLearningCycle', 20, 'ok');
    observability.metrics.recordPublicMethod('runLearningCycle', 30, 'error');

    const prometheus = observability.metrics.prometheus();
    expect(prometheus).toContain('glearn_public_method_throughput_total{method="runLearningCycle",status="ok"} 2');
    expect(prometheus).toContain('glearn_public_method_errors_total{method="runLearningCycle"} 1');
    expect(prometheus).toContain('quantile="0.95"');

    const otel = observability.metrics.openTelemetry();
    expect(JSON.stringify(otel)).toContain('service.name');
  });

  it('writes decision and shell-job audit JSONL files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glearn-audit-'));
    process.env.GLEARN_AUDIT_DIR = dir;
    const observability = new GLearnObservability('glearn');

    observability.audit.logDecision({
      operation: 'runLearningCycle',
      decision: 'completed',
      success: true,
      metadata: { email: 'person@example.com' },
    });
    observability.audit.logShellJob({
      command: 'npm test',
      exit_code: 0,
      metadata: { token: 'test-token' },
    });

    const files = fs.readdirSync(dir);
    expect(files.some(file => file.startsWith('decisions-'))).toBe(true);
    expect(files.some(file => file.startsWith('shell-jobs-'))).toBe(true);
    const content = files.map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n');
    expect(content).toContain('[REDACTED]');
    expect(content).not.toContain('person@example.com');
    expect(content).not.toContain('test-token');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exposes metrics and trace snapshots from GLearn public methods', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glearn-audit-'));
    process.env.GLEARN_AUDIT_DIR = dir;
    const glearn = new GLearn({
      gbrainEndpoint: 'http://127.0.0.1:1',
      gstackEndpoint: 'http://127.0.0.1:1',
      gorchestratorEndpoint: 'http://127.0.0.1:1',
      gmirrorEndpoint: 'http://127.0.0.1:1',
      gtomEndpoint: 'http://127.0.0.1:1',
    });

    await glearn.healthCheck();

    expect(glearn.exportPrometheusMetrics()).toContain('glearn_public_method_throughput_total');
    expect(JSON.stringify(glearn.exportOpenTelemetryMetrics())).toContain('resourceMetrics');
    expect(JSON.stringify(glearn.getObservabilitySnapshot())).toContain('GLearn.healthCheck');

    (glearn as any).persistenceDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
