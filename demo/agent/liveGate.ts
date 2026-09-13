// The live-mode precondition (this demo's single non-negotiable): refuses to
// run beat 1 unless the server itself reports mode 'live', read back through
// the real float_status MCP tool call -- never inferred from process.env
// directly, so this checks the exact same ground truth float_status() shows
// a judge on screen (see src/config.ts / src/server.ts's #14 doc comments on
// why "live" is an explicit opt-in, never inferred from which env vars
// happen to be set).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export class NotLiveError extends Error {}

function parseToolResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

/** Throws `NotLiveError` -- never returns a false/log-line signal -- if the
 * server isn't reporting live mode. Call this before beat 1, always. */
export async function assertLiveMode(client: Client): Promise<void> {
  const result = await client.callTool({ name: 'float_status', arguments: {} });
  const body = parseToolResult(result) as { ok?: boolean; data?: { mode?: string } };
  if (!body.ok || body.data?.mode !== 'live') {
    throw new NotLiveError(
      `float_status().mode is "${body.data?.mode ?? 'unknown'}", not "live" -- refusing to run the demo. ` +
        'Set FLOAT_LIVE=1 (or DRY_RUN=0) and ensure HEDERA_OPERATOR_ID/HEDERA_OPERATOR_KEY are configured before rerunning.',
    );
  }
}
