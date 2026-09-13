// Real Ledger signing, one layer BELOW wallet-cli: `@ledgerhq/hw-app-eth` +
// `@ledgerhq/hw-transport-node-hid`. wallet-cli's own "Out of scope" skill
// doc blocks `send`/`operations`(write)/`swap execute` on testnets -- that's
// the CLI's product policy, not a hardware or protocol limit, so this talks
// to the same USB transport the CLI itself uses ("Ledger Wallet CLI using
// Device Management Kit (USB)" per its own npm description) without going
// through the CLI's policy layer. `@ledgerhq/device-management-kit` +
// `@ledgerhq/device-signer-kit-ethereum` (the newer DMK stack) were tried
// first; the older hw-app-eth/hw-transport-node-hid pair was taken instead
// because it is CommonJS and resolves cleanly via `createRequire` under
// Node's strict ESM loader, where DMK's own dependency tree threw
// `ERR_MODULE_NOT_FOUND` on a nested subpackage even for a version-matched
// install -- exactly the "take the fallback without ceremony" case the
// ticket anticipated.
//
// This module never produces a signature without the physical press: both
// `signPersonalMessage` and `signTransaction` block on the device's APDU
// response, which the Ethereum app itself does not return until the user
// approves or rejects on-screen. There is no code path here that skips that.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TransportNodeHid = require('@ledgerhq/hw-transport-node-hid').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppEth = require('@ledgerhq/hw-app-eth').default;

export type EthSignature = { v: string; r: string; s: string };

export interface LedgerSigner {
  getAddress(path: string): Promise<{ address: string }>;
  signPersonalMessage(path: string, messageHex: string): Promise<EthSignature>;
  signTransaction(path: string, rawTxHex: string): Promise<EthSignature>;
  close(): Promise<void>;
}

/** Opens a fresh USB session and Ethereum app connection. Callers open one
 * per operation and close it when done -- the device only accepts one
 * transport session at a time, same constraint wallet-cli itself has. */
export async function openLedgerSigner(): Promise<LedgerSigner> {
  const transport = await TransportNodeHid.create();
  const eth = new AppEth(transport);
  return {
    async getAddress(path: string) {
      const { address } = await eth.getAddress(path);
      return { address };
    },
    async signPersonalMessage(path: string, messageHex: string) {
      return eth.signPersonalMessage(path, messageHex);
    },
    async signTransaction(path: string, rawTxHex: string) {
      // `resolution: null` -- correct for a plain native-value transfer with
      // no calldata; there is nothing for Ledger's clear-signing metadata
      // service to resolve (no ERC-20 token, no known contract ABI).
      return eth.signTransaction(path, rawTxHex, null);
    },
    async close() {
      await transport.close();
    },
  };
}
