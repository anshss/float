#!/usr/bin/env node
// Float MCP server entrypoint: stdio transport, the shape a Claude Code
// plugin or any MCP-speaking agent connects to.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFloatServer } from './server.js';

async function main() {
  const { server } = createFloatServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('float-mcp: fatal error during startup', err);
  process.exit(1);
});
