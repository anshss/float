import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFloatServer } from '../../../src/server.js';
import { loadConfig } from '../../../src/config.js';
import { assertLiveMode, NotLiveError } from '../liveGate.js';

async function connectedClient(config: ReturnType<typeof loadConfig>) {
  const { server } = createFloatServer({ config });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'live-gate-test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('assertLiveMode', () => {
  it('throws NotLiveError when the server is stubbed (the default)', async () => {
    const client = await connectedClient(loadConfig({}));
    await expect(assertLiveMode(client)).rejects.toThrow(NotLiveError);
    await client.close();
  });

  it('resolves once the server reports live mode', async () => {
    const client = await connectedClient(
      loadConfig({ DRY_RUN: '0', HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'k' }),
    );
    await expect(assertLiveMode(client)).resolves.toBeUndefined();
    await client.close();
  });

  it('#14: a demo-shaped config with real creds but no explicit opt-in still refuses — env-var presence alone never satisfies the gate', async () => {
    const client = await connectedClient(loadConfig({ HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'k' }));
    await expect(assertLiveMode(client)).rejects.toThrow(NotLiveError);
    await client.close();
  });
});
