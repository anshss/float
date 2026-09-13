// The proof this ticket exists to produce: a REAL MCP client, over the REAL
// stdio transport, spawning the ACTUAL command the plugin manifest declares
// (`npx tsx src/index.ts`) — not the in-process InMemoryTransport every
// other test in this repo uses (__tests__/server.test.ts, demo/agent's own
// tests). Before this file, the tool surface had only ever been exercised
// in-process; no real MCP client had ever connected to this server over
// stdio (see .claude-plugin/plugin.json's mcpServers entry, which this
// spawns verbatim).
import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(PLUGIN_ROOT, '..', '..');

const V1_TOOLS = [
  'float_status',
  'compare_markets',
  'query_position',
  'counterparty_risk',
  'spend_history',
  'grant_budget',
  'pay',
  'transfer_usdc',
  'confirm_pending',
];

describe('plugin over real stdio transport (the command in .claude-plugin/plugin.json)', () => {
  let client: Client | null = null;

  afterEach(async () => {
    await client?.close();
    client = null;
  });

  it('a real MCP client can connect over stdio, list tools and call float_status', async () => {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/index.ts'],
      cwd: REPO_ROOT,
      // No .env in CI (public repo, gitignored) — every layer degrades to a
      // structured denial with no config at all (src/config.ts), which is
      // exactly the shape this test wants: prove the TRANSPORT works, not
      // that live credentials happen to be present.
      env: { ...getDefaultEnvironment(), FLOAT_PAYMENTS_PORT: '0' },
      // Piped so a startup crash surfaces in the test failure instead of
      // silently going to the test runner's own stderr.
      stderr: 'pipe',
    });

    let stderrOutput = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    client = new Client({ name: 'plugin-stdio-test', version: '0.0.0' });
    try {
      await client.connect(transport);
    } catch (err) {
      throw new Error(`stdio connect failed (stderr so far: ${stderrOutput})`, { cause: err });
    }

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...V1_TOOLS].sort());

    const result = await client.callTool({ name: 'float_status', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0].text) as { ok: boolean; data: { mode: string } };
    expect(body.ok).toBe(true);
    expect(body.data.mode).toBe('stubbed'); // no live opt-in in this test's env
  }, 30_000);
});
