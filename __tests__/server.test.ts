import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFloatServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { loadState, resetStateForTests, saveState } from '../layers/policy/state.js';
import { resetStateForTests as resetCustodyStateForTests } from '../layers/custody/state.js';

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

  it('float_status() reports Hedera configured with ids/ceilings from bootstrap state, no HEDERA_TREASURY_*/_TOPIC_ID env set (#11)', async () => {
    resetStateForTests();
    const state = loadState();
    state.treasury = { accountId: '0.0.999001', privateKey: 'unused-in-tests' };
    state.topicId = '0.0.999002';
    state.agents['child-a'] = { accountId: '0.0.999003', privateKey: 'unused-in-tests' };
    state.policies['child-a'] = {
      agentId: 'child-a',
      parentId: 'root',
      ceilingHbar: 3,
      period: 'unbounded',
      scope: 'lending',
      thresholdForHuman: null,
      allowanceTx: '0.0.1@1.1',
      grantedAt: new Date().toISOString(),
      revoked: false,
    };
    saveState(state);

    await connect(loadConfig({ DRY_RUN: '1', HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'k' }));
    const result = await client.callTool({ name: 'float_status', arguments: {} });
    const body = parseTextResult(result);
    expect(body.data.configured.hedera).toBe(true);
    expect(body.data.hedera.treasury_account_id).toBe('0.0.999001');
    expect(body.data.hedera.treasury_source).toBe('state');
    expect(body.data.hedera.topic_id).toBe('0.0.999002');
    expect(body.data.hedera.agents).toEqual([
      { agent_id: 'child-a', account_id: '0.0.999003', scope: 'lending', ceiling_hbar: 3, remaining_hbar: null, revoked: false },
    ]);
    expect(JSON.stringify(body)).not.toContain('unused-in-tests');
  });

  it('#14: demo-shaped configuration (real creds, bootstrapped state, no explicit opt-in) resolves to stubbed, not live by accident', async () => {
    resetStateForTests();
    const state = loadState();
    state.treasury = { accountId: '0.0.999001', privateKey: 'unused-in-tests' };
    state.topicId = '0.0.999002';
    saveState(state);

    // Real operator creds present, treasury/topic already bootstrapped in
    // state — exactly the shape #14 says must NOT silently resolve to live.
    await connect(loadConfig({ HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'k' }));
    const result = await client.callTool({ name: 'float_status', arguments: {} });
    const body = parseTextResult(result);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.mode).toBe('stubbed');
  });

  it('#14: the same demo-shaped configuration goes live only with an explicit opt-in', async () => {
    resetStateForTests();
    const state = loadState();
    state.treasury = { accountId: '0.0.999001', privateKey: 'unused-in-tests' };
    state.topicId = '0.0.999002';
    saveState(state);

    await connect(loadConfig({ DRY_RUN: '0', HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'k' }));
    const result = await client.callTool({ name: 'float_status', arguments: {} });
    const body = parseTextResult(result);
    expect(body.data.dryRun).toBe(false);
    expect(body.data.mode).toBe('live');
  });

  // grant_budget, pay and transfer_usdc are all implemented for real now
  // (C3/C4/C5) -- nothing left to exercise generically as a bare stub.
  const stubTools: Array<[string, Record<string, string>]> = [];

  it.each(stubTools)('%s returns a structured deployment_unavailable denial, never throws', async (name, args) => {
    await connect();
    const result = await client.callTool({ name, arguments: args });
    const body = parseTextResult(result);
    expect(body).toEqual({ denied: true, reason: 'deployment_unavailable', detail: 'not implemented' });
  });

  // pay() is implemented for real by C4 (see layers/payments/__tests__ for
  // full coverage) — here we only check the "no operator key configured"
  // seam still returns a structured denial through the live MCP protocol,
  // never a thrown error.
  it('pay() denies without a configured buyer key, never throws', async () => {
    await connect(loadConfig({}));
    const result = await client.callTool({ name: 'pay', arguments: { url: 'https://example.com', max: '5' } });
    const body = parseTextResult(result);
    expect(body).toEqual({
      denied: true,
      reason: 'deployment_unavailable',
      detail: 'HEDERA_OPERATOR_ID/HEDERA_OPERATOR_KEY not configured — pay() has no buyer key to sign with',
    });
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

  it('grant_budget() under DRY_RUN produces a synthetic allowance and never throws', async () => {
    resetStateForTests();
    await connect(loadConfig({ DRY_RUN: '1' }));
    const result = await client.callTool({
      name: 'grant_budget',
      arguments: { child_id: 'child-server-1', ceiling: '3', scope: 'lending' },
    });
    const body = parseTextResult(result);
    expect(body.ok).toBe(true);
    expect(body.data.dry_run).toBe(true);
    expect(body.data.agent_id).toBe('child-server-1');
  });

  it('grant_budget() refuses a ceiling that breaks the hierarchy invariant', async () => {
    resetStateForTests();
    await connect(loadConfig({ DRY_RUN: '1' }));
    const over = await client.callTool({
      name: 'grant_budget',
      arguments: { child_id: 'child-server-2', ceiling: '999999', scope: 'lending' },
    });
    expect(parseTextResult(over)).toMatchObject({ denied: true, reason: 'ceiling_exceeded' });
  });

  // transfer_usdc is implemented for real by C5 (see
  // layers/settlement/__tests__/transferUsdc.test.ts for full coverage) —
  // here we only check the seam still returns a structured denial through
  // the live MCP protocol, with no signal store entry to cite.
  it('transfer_usdc() denies with no_signal_cited when signal_ref is unknown', async () => {
    await connect(loadConfig({}));
    const result = await client.callTool({
      name: 'transfer_usdc',
      arguments: { to: '0xabc', amount: '1', signal_ref: 'sig_unknown' },
    });
    const body = parseTextResult(result);
    expect(body).toEqual({
      denied: true,
      reason: 'no_signal_cited',
      detail: 'signal_ref "sig_unknown" does not resolve to a known perception-layer query result',
    });
  });

  it('confirm_pending() with nothing in flight reports idle, not a denial', async () => {
    resetCustodyStateForTests();
    await connect();
    const result = await client.callTool({ name: 'confirm_pending', arguments: {} });
    const body = parseTextResult(result);
    expect(body).toEqual({ ok: true, data: { pending: false } });
  });

  it('server boots and serves with zero env vars configured', async () => {
    await expect(connect(loadConfig({}))).resolves.not.toThrow();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(9);
  });
});
