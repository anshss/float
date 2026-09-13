#!/usr/bin/env node
// Float MCP server entrypoint: stdio transport, the shape a Claude Code
// plugin or any MCP-speaking agent connects to.

import type { Server } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFloatServer } from './server.js';
import { startResourceServer, type ResourceServerDeps } from '../layers/payments/resourceServer.js';
import { closeOperatorClient } from '../layers/policy/hedera.js';

/** `Server#listen` fails asynchronously (an `error` event, not a thrown
 * exception), so a bare `startResourceServer` call lets a port collision
 * surface later as an opaque, unhandled `EADDRINUSE` mid-demo. Waiting for
 * `listening`/`error` here turns that into one loud, specific message named
 * at startup -- the port and the remedy -- since that message is what
 * someone under rehearsal pressure actually reads. */
function startPaymentsServer(deps: ResourceServerDeps, port: number): Promise<Server> {
  const server = startResourceServer(deps, port);
  return new Promise((resolve, reject) => {
    server.once('listening', () => resolve(server));
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `float-mcp: port ${port} is already in use -- another float-mcp (or something else) is ` +
              `already listening there. Find and stop it (\`lsof -ti:${port} | xargs kill\`), or set ` +
              `FLOAT_PAYMENTS_PORT to a free port and retry.`,
          ),
        );
        return;
      }
      reject(err);
    });
  });
}

async function main() {
  const { server, config, signalStore, digestStore } = createFloatServer();

  // Gated resource server (seller side, C4): serves Float's own premium
  // counterparty_risk deep report behind a real x402 402 challenge. Both
  // buyer (`pay`) and seller run in this one process — the Hedera track
  // requires operating both sides, and there is no public gated demo
  // endpoint to buy from otherwise. Started here, not in `createFloatServer`,
  // so unit tests that construct a server never open a real socket.
  const paymentsPort = config.raw.FLOAT_PAYMENTS_PORT ?? 4402;
  const resourceServer = await startPaymentsServer({ config, signalStore, digestStore }, paymentsPort);
  console.error(`float-mcp: gated resource server listening on :${paymentsPort}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // The demo gets started and stopped many times during rehearsal; with no
  // signal handler Node's default handling kills the process outright and
  // leaves the payments listener (and any cached Hedera gRPC channel) open
  // until the OS reclaims them, so the NEXT start collides with a zombie on
  // this same port. Close both together, then exit clean.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`float-mcp: received ${signal}, shutting down`);
    Promise.allSettled([
      new Promise<void>((resolve) => resourceServer.close(() => resolve())),
      closeOperatorClient(),
    ]).then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('float-mcp: fatal error during startup', err);
  process.exit(1);
});
