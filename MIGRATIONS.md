# GLearn Migrations

GLearn persists learning state in SQLite, JSON state files, JSONL receipts, and audit logs.
Migrations must be deterministic, forward-only, and safe to run before CLI or MCP commands serve
requests.

## State Stores

| Store | Default location | Contents |
| --- | --- | --- |
| SQLite | `~/.glearn/glearn.db` | Patterns, proposals, data-store entries, LLM calls, cost entries, budget reservations, schema version. |
| State file | Configured by `GLEARN_STATE_PATH` or shared persistence defaults | Cached pattern/proposal/escalation state. |
| Receipts | Runtime receipt directory or test baselines | Learning-cycle receipts and regression evidence. |
| Audit logs | `~/.glearn/audit/*.jsonl` unless overridden | Decisions, shell jobs, health events. |

## Migration Rules

1. Add SQL migrations under `src/core/migrations/NNN_description.sql`.
2. Never edit a migration that has shipped. Add a new numbered migration instead.
3. Use idempotent DDL wherever possible.
4. Keep application code compatible with both pre- and post-migration data during rollout.
5. Add tests that create a temporary database and verify the new schema.
6. Document operator-facing effects in `CHANGELOG.md` and this file.

## Current Migrations

| Version | File | Purpose |
| --- | --- | --- |
| 1 | `001_initial_schema.sql` | Initial GLearn persistent state. |
| 2 | `002_durable_learning_state.sql` | Durable patterns, proposals, data-store, cost, and budget state. |

## Applying Migrations

Migrations are applied automatically by `GLearnPersistenceManager` when the database opens.

```bash
npm run build
node dist/cli.js health
npm run verify
```

If migration fails, preserve the database file, stop the process, inspect the error, and add a new
corrective migration. Do not repair production data with ad hoc SQL unless the operation is also
captured in a migration or incident note.

## Backup Before Schema Changes

```bash
glearn backup ./backups/glearn-before-migration
npm run build
node dist/cli.js health
```
