// Integration-shaped presentation test: runs the ACTUAL six-beat sequence
// against the real server through a real MCP client (same InMemoryTransport
// wiring __tests__/server.test.ts uses), under DRY_RUN so it never touches
// the network or costs anything. Every layer denies here (no GRAPH_API_KEY,
// no Hedera operator creds) except grant_budget (DRY_RUN never needs
// operator creds — see layers/policy/bootstrap.ts) — which is exactly the
// point: this proves the presentation rule holds across ok AND denied
// results, not just a hand-picked happy path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFloatServer } from '../../../src/server.js';
import { loadConfig } from '../../../src/config.js';
import { resetStateForTests } from '../../../layers/policy/state.js';
import { runDemoBeats } from '../runner.js';
import { renderAgentView } from '../view.js';
import { renderAuditorView } from '../auditorView.js';
import { BANNED_TOKENS } from '../sanitize.js';

const BANNED_RE = new RegExp(BANNED_TOKENS.join('|'), 'i');

describe('demo/agent presentation rule (spec: "Demo script")', () => {
  let client: Client;

  beforeEach(() => {
    resetStateForTests();
  });

  afterEach(async () => {
    await client?.close();
  });

  it('the agent view names zero chains/asset tickers across all six beats, denials included', async () => {
    const config = loadConfig({ DRY_RUN: '1' });
    const { server } = createFloatServer({ config });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-demo-agent', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const { events } = await runDemoBeats({ client, config, gatedUrl: 'http://127.0.0.1:1/dummy' });

    // Seven events: beat 4 emits two (the grant, then the child's own
    // overspend) — every other beat emits exactly one.
    expect(events.map((e) => e.beat)).toEqual([1, 2, 3, 4, 4, 5, 6]);

    const agentText = renderAgentView(events).join('\n');
    expect(agentText).not.toMatch(BANNED_RE);

    // Sanity: the auditor view is NOT held to the same rule — it's allowed
    // to leak (deliberately) the same words the agent view must not.
    const auditorText = renderAuditorView(events).join('\n');
    expect(auditorText.length).toBeGreaterThan(0);
  });

  it('beat 4’s child overspend is always denied — never silently allowed through', async () => {
    const config = loadConfig({ DRY_RUN: '1' });
    const { server } = createFloatServer({ config });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-demo-agent-2', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const { events } = await runDemoBeats({ client, config, gatedUrl: 'http://127.0.0.1:1/dummy' });
    const childSpendEvent = events.find((e) => e.label === 'child_spend');
    expect(childSpendEvent).toMatchObject({ ok: false, reason: 'ceiling_exceeded' });
  });
});
