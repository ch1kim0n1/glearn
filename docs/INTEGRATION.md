# Embedding GLearn In Other Projects

GLearn can be embedded as a CLI, MCP server, or TypeScript library.

## CLI Integration

```bash
npm install
npm run build
node ./dist/cli.js run --counterfactual
node ./dist/cli.js proposals
```

For CI or scheduled jobs, call `node ./dist/cli.js` from a pinned checkout rather than relying on
a global binary.

## MCP Integration

```json
{
  "mcpServers": {
    "glearn": {
      "command": "node",
      "args": ["./dist/cli.js", "serve"],
      "env": {
        "GLEARN_DB_PATH": "./.glearn/glearn.db"
      }
    }
  }
}
```

Expose write tools only to trusted callers. `glearn_run` can trigger model spend and
`glearn_approve` changes proposal lifecycle state.

## TypeScript Integration

```ts
import { GLearn } from './dist/core/glearn.js';

const glearn = new GLearn({
  gbrainEndpoint: 'http://localhost:3000',
});

const run = await glearn.runLearningCycle({
  run_counterfactual: true,
  priority: 'normal',
});
```

Library callers are responsible for endpoint configuration, secret handling, and state-directory
permissions.

## Required Runtime State

- Writable SQLite path.
- Writable receipt, state, and audit directories.
- Network access to configured stack endpoints.
- LLM API keys when model-backed mining or proposal generation is enabled.

## Compatibility

Pin GLearn versions for production use. Existing MCP names and required fields remain stable within
a major version; new optional fields may be added in minor versions.
