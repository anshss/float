import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFloatServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

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

function parseTextResult(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe('float-mcp server (in-process MCP client)', () => {
  let client: Client;

  async function connect(config = loadConfig({})) {
    const { server } = createFloatServer({ config });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  }

  afterEach(async () => {
    await client?.close();
  });

  it('lists exactly the nine v1 tools', async () => {
    await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...V1_TOOLS].sort());
  });

  it('float_status() returns real data reflecting config, not a stub denial', async () => {
    await connect(loadConfig({ GRAPH_API_KEY: 'k' }));
    const result = await client.callTool({ name: 'float_status', arguments: {} });
    const body = parseTextResult(result);
    expect(body.ok).toBe(true);
    expect(body.data.configured.graph).toBe(true);
    expect(body.data.dryRun).toBe(true);
    expect(body.data).not.toHaveProperty('reason');
  });

  it('float_status() never leaks key material even when secrets are configured', async () => {
    await connect(loadConfig({ HEDERA_OPERATOR_KEY: 'super-secret-key' }));
    const result = await client.callTool({ name: 'float_status', arguments: {} });
    expect(JSON.stringify(result)).not.toContain('super-secret-key');
  });

  const stubTools: Array<[string, Record<string, string>]> = [
    ['grant_budget', { child_id: 'child-1', ceiling: '10', scope: 'lending' }],
    ['pay', { url: 'https://example.com', max: '5' }],
    ['transfer_usdc', { to: '0xabc', amount: '1', signal_ref: 'sig_1' }],
  ];

  it.each(stubTools)('%s returns a structured deployment_unavailable denial, never throws', async (name, args) => {
    await connect();
    const result = await client.callTool({ name, arguments: args });
    const body = parseTextResult(result);
    expect(body).toEqual({ denied: true, reason: 'deployment_unavailable', detail: 'not implemented' });
  });

  // compare_markets, query_position, counterparty_risk, spend_history are
  // implemented for real by C2 (see layers/perception/__tests__/tools.test.ts
  // for full coverage) — here we only check the "no key configured" seam
  // still returns a structured denial through the live MCP protocol.
  const perceptionTools: Array<[string, Record<string, string>]> = [
    ['compare_markets', { schema_family: 'lending' }],
    ['query_position', { protocol: 'aave-v3-ethereum', address: '0xabc' }],
    ['counterparty_risk', { address: '0xabc' }],
    ['spend_history', { agent_id: 'agent-1' }],
  ];

  it.each(perceptionTools)('%s denies without configuration, never throws', async (name, args) => {
    await connect(loadConfig({}));
    const result = await client.callTool({ name, arguments: args });
    const body = parseTextResult(result);
    expect(body.denied).toBe(true);
    expect(body.reason).toBe('deployment_unavailable');
  });

  it('confirm_pending() (no args) returns a structured denial', async () => {
    await connect();
    const result = await client.callTool({ name: 'confirm_pending', arguments: {} });
    const body = parseTextResult(result);
    expect(body).toEqual({ denied: true, reason: 'deployment_unavailable', detail: 'not implemented' });
  });

  it('server boots and serves with zero env vars configured', async () => {
    await expect(connect(loadConfig({}))).resolves.not.toThrow();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(9);
  });
});
