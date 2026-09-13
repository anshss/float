// #20: no signal handler at all meant Ctrl-C during rehearsal left the
// payments listener open, so the NEXT start of the same demo collided with a
// zombie on :4402. These two tests drive the REAL entrypoint (`src/index.ts`,
// the exact command the plugin manifest and the demo runner both launch)
// over a real stdio transport, not an in-process shortcut -- a signal
// handler and a `server.listen` error path can't be exercised in-process.
import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A real free TCP port, picked once so both the "server up" and "port
 * already held" halves of the test race on the exact same port a live
 * collision would. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function connectClient(port: number): { client: Client; transport: StdioClientTransport; stderr: () => string } {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/index.ts'],
    cwd: REPO_ROOT,
    env: { ...getDefaultEnvironment(), FLOAT_PAYMENTS_PORT: String(port) },
    stderr: 'pipe',
  });
  let stderrOutput = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });
  return { client: new Client({ name: 'index-test', version: '0.0.0' }), transport, stderr: () => stderrOutput };
}

describe('src/index.ts entrypoint -- signal handling and port-in-use startup', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  it('SIGTERM closes the payments listener so a second start on the same port succeeds', async () => {
    const port = await freePort();

    const first = connectClient(port);
    await first.client.connect(first.transport);
    clients.push(first.client);

    // Confirm the child is actually up before killing it.
    await first.client.callTool({ name: 'float_status', arguments: {} });

    const pid = first.transport.pid;
    expect(pid).toBeTruthy();
    process.kill(pid!, 'SIGTERM');
    // `client.close()` in afterEach would race the process already exiting;
    // drop it from the cleanup list now that we're killing it ourselves.
    clients.pop();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const second = connectClient(port);
    try {
      await second.client.connect(second.transport);
    } catch (err) {
      throw new Error(`second start after SIGTERM failed (stderr: ${second.stderr()})`, { cause: err });
    }
    clients.push(second.client);
    const result = await second.client.callTool({ name: 'float_status', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text).ok).toBe(true);
  }, 30_000);

  it('fails loudly, naming the port and the remedy, when the port is already held', async () => {
    const port = await freePort();

    const holder = connectClient(port);
    await holder.client.connect(holder.transport);
    clients.push(holder.client);
    await holder.client.callTool({ name: 'float_status', arguments: {} });

    const blocked = connectClient(port);
    await expect(blocked.client.connect(blocked.transport)).rejects.toBeTruthy();
    expect(blocked.stderr()).toContain(`port ${port} is already in use`);
    expect(blocked.stderr()).toMatch(/FLOAT_PAYMENTS_PORT/);
  }, 30_000);
});
