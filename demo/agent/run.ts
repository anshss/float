#!/usr/bin/env node
// The scripted demo agent. Run with:
//
//   FLOAT_LIVE=1 npx tsx --env-file=.env demo/agent/run.ts
//
// (or `npm run demo:agent` — see package.json). FLOAT_LIVE=1 (or DRY_RUN=0)
// is the operator's explicit opt-in; this script does NOT set it itself —
// doing that would make the live-mode assertion below unable to ever catch
// a forgotten flag, which is the entire point of this precondition
// (see liveGate.ts and src/config.ts's #14 doc comment).
//
// One process, one call sequence: connects an in-process MCP client to the
// real server (same wiring __tests__/server.test.ts already uses), starts
// the same gated resource server src/index.ts starts, then runs all six
// beats from demo/agent/runner.ts back to back against that one server
// instance — exactly what a real agent driving this server over stdio
// would do, minus the stdio transport itself (proved separately — see
// plugin/__tests__/stdio.test.ts).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFloatServer } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';
import { startResourceServer } from '../../layers/payments/resourceServer.js';
import { assertLiveMode, NotLiveError } from './liveGate.js';
import { runDemoBeats } from './runner.js';
import { renderAgentView } from './view.js';
import { renderAuditorView } from './auditorView.js';

async function main() {
  const config = loadConfig();
  const { server, signalStore, digestStore } = createFloatServer({ config });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'float-demo-agent', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  // Same gated resource server src/index.ts starts for real -- port 0 so
  // this run never collides with a live float-mcp process already up on
  // the default FLOAT_PAYMENTS_PORT.
  const resourceServer = startResourceServer({ config, signalStore, digestStore }, 0);
  await new Promise((resolve) => resourceServer.once('listening', resolve));
  const port = (resourceServer.address() as { port: number }).port;
  const gatedUrl = `http://127.0.0.1:${port}/premium/counterparty-risk/0.0.10523774`;

  try {
    console.error('--- live-mode precondition ---');
    await assertLiveMode(client);
    console.error('float_status().mode === "live" — proceeding.\n');

    const { events, costs } = await runDemoBeats({ client, config, gatedUrl });

    console.log('=== agent view ===');
    for (const line of renderAgentView(events)) console.log(line);

    console.log('\n=== auditor view ===');
    for (const line of renderAuditorView(events)) console.log(line);

    console.log('\n=== this rehearsal cost ===');
    console.log(`pay layer: ${costs.payLayerAmount ?? 0} (native unit, denied calls cost 0)`);
    console.log(`policy layer: granted ceiling ${costs.grantLayerCeilingDelta} (re-grant of an existing child costs a tiny allowance-update fee, never a new account)`);
    console.log(`settlement layer: ${costs.settlementLayerAmount} (0 while beat 5 stays denied at awaiting_device — no chain write happens on that path)`);

    const deniedBeats = events.filter((e) => !e.ok).map((e) => e.beat);
    console.log(`\ndemo run complete. denied beats: [${deniedBeats.join(', ')}]`);
  } catch (err) {
    if (err instanceof NotLiveError) {
      console.error(`float-mcp demo agent: REFUSING TO RUN — ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    resourceServer.close();
    await client.close();
  }
}

main().catch((err) => {
  console.error('float-mcp demo agent: fatal error', err);
  process.exit(1);
});
