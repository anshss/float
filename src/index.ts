#!/usr/bin/env node
// Float MCP server entrypoint: stdio transport, the shape a Claude Code
// plugin or any MCP-speaking agent connects to.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFloatServer } from './server.js';
import { startResourceServer } from '../layers/payments/resourceServer.js';

async function main() {
  const { server, config, signalStore, digestStore } = createFloatServer();

  // Gated resource server (seller side, C4): serves Float's own premium
  // counterparty_risk deep report behind a real x402 402 challenge. Both
  // buyer (`pay`) and seller run in this one process — the Hedera track
  // requires operating both sides, and there is no public gated demo
  // endpoint to buy from otherwise. Started here, not in `createFloatServer`,
  // so unit tests that construct a server never open a real socket.
  const paymentsPort = config.raw.FLOAT_PAYMENTS_PORT ?? 4402;
  startResourceServer({ config, signalStore, digestStore }, paymentsPort);
  console.error(`float-mcp: gated resource server listening on :${paymentsPort}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('float-mcp: fatal error during startup', err);
  process.exit(1);
});
