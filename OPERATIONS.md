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
