# Float — Claude Code plugin

Thin wrapper around the `float-mcp` stdio server (`../src/index.ts`) — a distribution
convenience, never the headline. It runs the exact same server every other test in
this repo runs, over the same code path; the plugin adds nothing except a manifest
Claude Code knows how to launch.

## Try it

From `float-mcp/` (this plugin's parent directory), with `.env` filled in for
whichever layers you want live:

```
claude --plugin-dir plugin/
```

Claude Code spawns `npx tsx --env-file=.env src/index.ts` with this directory's
parent as its working directory (see `.claude-plugin/plugin.json`), and the nine v1
tools (`float_status`, `compare_markets`, `query_position`, `counterparty_risk`,
`spend_history`, `grant_budget`, `pay`, `transfer_usdc`, `confirm_pending`) become
available in that session.

## What's actually proved, and how

Before this ticket, the tool surface had only ever been exercised in-process
(`InMemoryTransport`, e.g. `__tests__/server.test.ts`) — no real MCP client had ever
connected to this server over stdio. `__tests__/stdio.test.ts` closes that gap
automatically: it spawns the literal command this manifest declares, connects a real
`@modelcontextprotocol/sdk` `StdioClientTransport` client to it, lists tools, and calls
`float_status()`. Run it with the rest of the suite from `float-mcp/`: `npm test`.

Manually driving it through the actual `claude` CLI (rather than the SDK's own
client) is a further, valuable check — worth doing once before demo day — but is not
part of the automated suite, since it puts an LLM in the loop for what is otherwise a
transport-level integration proof.
