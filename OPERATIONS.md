# GLearn Operations Guide

## Deployment

### Prerequisites
- Node.js >= 18
- GBrain endpoint accessible
- GOrchestrator, GMirror, GToM data in GBrain

### Installation
```bash
npm install
npm run build
npm link
```

### Deployment Methods

#### Docker Compose
```bash
# Build and start with Docker Compose
docker-compose up -d glearn

# View logs
docker-compose logs -f glearn

# Stop
docker-compose down
```

#### Kubernetes with Helm
```bash
# Install chart
helm install glearn ./helm/glearn --namespace gstack --create-namespace

# Upgrade
helm upgrade glearn ./helm/glearn --namespace gstack

# Rollback
helm rollback glearn --namespace gstack

# Uninstall
helm uninstall glearn --namespace gstack
```

#### Systemd (Bare Metal)
```bash
# Create user and directories
sudo useradd -r -s /bin/false glearn
sudo mkdir -p /opt/glearn /var/lib/glearn /var/log/glearn /etc/glearn
sudo chown -R glearn:glearn /opt/glearn /var/lib/glearn /var/log/glearn

# Copy files
sudo cp -r dist/* /opt/glearn/
sudo cp deploy/systemd/glearn.service /etc/systemd/system/
sudo cp .env.example /etc/glearn/glearn.env
# Edit /etc/glearn/glearn.env with actual values

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable glearn
sudo systemctl start glearn

# Check status
sudo systemctl status glearn
sudo journalctl -u glearn -f
```

### Rollback Procedures

#### Kubernetes
```bash
# View revision history
helm history glearn --namespace gstack

# Rollback to previous version
helm rollback glearn --namespace gstack

# Rollback to specific revision
helm rollback glearn <revision> --namespace gstack
```

#### Docker Compose
```bash
# Rebuild with previous image tag
docker-compose down
docker-compose up -d --build glearn
```

#### Systemd
```bash
# Stop service
sudo systemctl stop glearn

# Restore previous build
sudo cp -r /opt/glearn.backup/* /opt/glearn/

# Restart
sudo systemctl start glearn
```

### Configuration
Create `~/.glearn/config.json`:

```json
{
  "dataSources": {
    "gbrain": "http://localhost:3000",
    "retentionDays": 90
  },
  "mining": {
    "cadence": "daily"
  },
  "proposals": {
    "approvalThreshold": "medium"
  }
}
```

## Running

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
# Run pattern mining
glearn mine --since "2026-01-01"

# Generate proposals
glearn propose --tool gorchestrator

# Backtest proposal
glearn backtest --proposal-id abc123
```

### MCP Server Mode
```bash
glearn mcp
```

## Monitoring

### Health Checks
```bash
glearn health
```

### Service Level Objectives (SLOs)

#### P95 Latency
- Pattern mining: 10s (batch operation)
- Proposal generation: 5s
- Health check: 200ms

#### Error Rate
- Pattern mining: < 5%
- Proposal generation: < 2%
- Health check: < 0.1%

#### Uptime
- Monthly: 99.5%
- Quarterly: 99.9%

#### Alert Thresholds
- Mining cycle failure for 30 minutes
- Health check failure for 1 minute
- Proposal queue backlog > 100 for 10 minutes

Checks:
- GBrain connectivity
- Data availability
- Mining cadence status
- Proposal queue status

### Metrics to Track
- Patterns detected per mining cycle
- Proposal generation rate
- Proposal acceptance rate
- Backtest success rate
- Regression detection frequency

## Troubleshooting

### GBrain Unavailable
- Mining cycle is skipped
- Logs error, continues on next cadence
- Check GBrain endpoint and connectivity

### Insufficient Data
- Mining requires minimum data points
- Logs warning, skips pattern types
- Check data retention window

### Low Proposal Acceptance
- Review confidence thresholds
- Check backtest validation
- Verify proposal scope

## Maintenance

### Cleanup
```bash
# Archive old proposals
# Prune pattern history (via GBrain)
```

### Updates
```bash
npm install
npm run build
```

## Backup

Patterns, proposals, and backtest results are stored in GBrain. Backup GBrain according to its operational guide.
