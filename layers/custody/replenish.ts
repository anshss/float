// Treasury replenishment: authorizes a real Sepolia movement from the
// Ledger-custodied treasury to the earmarked funding address, and on its
// confirmation, unlocks the reserve tranche (see `reserve.ts`). Not an
// agent-facing MCP tool -- there is no tenth tool in the v1 surface for
// this; it's an operator action run via `live-verify.ts`. `confirm_pending`
// (an agent-facing tool) reports on it the same way it reports on a
// pending policy-grant attestation, since both share `pending.ts`'s state.

import { denied, type ToolResult } from '../../src/contracts.js';
import type { FloatConfig } from '../../src/config.js';
import { writeAudit } from '../policy/audit.js';
import { openLedgerSigner, type LedgerSigner } from './ledgerSigner.js';
import { attachSignature, buildReplenishmentTx, makePublicClient, type ChainReads } from './txBuilder.js';
import { discoverSepoliaAccounts } from './walletCli.js';
import { startPendingOp } from './pending.js';
import { unlockReserve } from './reserve.js';

export type ReplenishDeps = {
  config: FloatConfig;
  /** Injectable for tests; defaults to a real USB session via `ledgerSigner.ts`. */
  openSigner?: () => Promise<LedgerSigner>;
  /** Injectable for tests; defaults to a real broadcast via viem's public client. */
  broadcast?: (signedRawHex: `0x${string}`) => Promise<`0x${string}`>;
  /** Injectable for tests, which must never shell out to the real
   * `wallet-cli` (it would reach an actually-attached device). Defaults to
   * a real `wallet-cli account discover ethereum:sepolia`. */
  discoverTreasuryAddress?: (config: FloatConfig) => Promise<`0x${string}` | null>;
  /** Injectable for tests, which must never make a real Sepolia RPC call. */
  chainReads?: ChainReads;
};

function derivationPath(config: FloatConfig): string {
  return config.raw.LEDGER_DERIVATION_PATH ?? "44'/60'/0'/0/0";
}

async function realDiscoverTreasuryAddress(config: FloatConfig): Promise<`0x${string}` | null> {
  const discovered = await discoverSepoliaAccounts(config);
  if (!('ok' in discovered) || !discovered.ok) return null;
  const data = discovered.data as { accounts?: { freshAddress?: string }[] };
  const address = data.accounts?.[0]?.freshAddress;
  return (address as `0x${string}` | undefined) ?? null;
}

export async function requestReplenishment(
  deps: ReplenishDeps,
  input: { amountEth: string },
): Promise<ToolResult<unknown>> {
  const { config } = deps;

  const discoverTreasuryAddress = deps.discoverTreasuryAddress ?? realDiscoverTreasuryAddress;
  const fromAddress = await discoverTreasuryAddress(config);
  if (!fromAddress) {
    return denied('deployment_unavailable', 'could not resolve the treasury address via wallet-cli account discover');
  }

  const built = deps.chainReads
    ? await buildReplenishmentTx(config, fromAddress, input.amountEth, deps.chainReads)
    : await buildReplenishmentTx(config, fromAddress, input.amountEth);
  if (!('ok' in built) || !built.ok) return built;
  const { data: preview } = built;

  // No device configured (or LIVE not opted into) -- render the exact
  // transaction that would be authorized, fee estimate included, and stop.
  // Same product behaviour as the spec's `send --dry-run`, built on our own
  // transaction construction since that CLI command does not exist on
  // Sepolia: a structured refusal the agent/operator can reason about,
  // with no device touch of any kind.
  if (config.dryRun || !config.configured.ledger) {
    return denied(
      'awaiting_device',
      `PREVIEW ONLY, no device touched -- would authorize ${preview.amountEth} ETH from ${preview.fromAddress} ` +
        `to funding address ${preview.toAddress} (nonce ${preview.nonce}, est. fee ${preview.feeEstimateEth} ETH, ` +
        `chain sepolia/${preview.chainId}). Set DRY_RUN=0 (or FLOAT_LIVE=1) and LEDGER_CLI_BIN to authorize for real.`,
    );
  }

  const openSigner = deps.openSigner ?? openLedgerSigner;
  const broadcast =
    deps.broadcast ??
    (async (signedRawHex: `0x${string}`) => makePublicClient(config).sendRawTransaction({ serializedTransaction: signedRawHex }));

  const detail =
    `authorize ${preview.amountEth} ETH from ${preview.fromAddress} to funding address ${preview.toAddress} ` +
    `(nonce ${preview.nonce}, est. fee ${preview.feeEstimateEth} ETH) -- PRESS THE BUTTON on the Ledger to confirm`;

  return startPendingOp('replenish', detail, async () => {
    const signer = await openSigner();
    let signedRawHex: `0x${string}`;
    try {
      const signature = await signer.signTransaction(derivationPath(config), preview.unsignedRawHexNoPrefix);
      signedRawHex = attachSignature(preview.tx, signature);
    } finally {
      await signer.close();
    }

    const sepoliaTxHash = await broadcast(signedRawHex);
    const reserve = unlockReserve(config, sepoliaTxHash);

    // The Sepolia movement already confirmed by the time this runs -- an
    // HCS audit write failing (e.g. Hedera credentials not configured on a
    // Sepolia-only run) must never unwind a real treasury authorization
    // that already landed, so this is logged, not thrown.
    try {
      await writeAudit(config, {
        v: 1,
        kind: 'spend',
        agent_id: 'treasury',
        ts: new Date().toISOString(),
        service: 'ledger_treasury_replenish',
        amount: preview.amountEth,
        tx: sepoliaTxHash,
      });
    } catch (err) {
      console.error(
        `[float-mcp/custody] treasury replenishment ${sepoliaTxHash} confirmed but the HCS audit write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Plain data, not a ToolResult -- `pending.ts#reportPending` wraps
    // whatever this resolves with in its own `ok(...)` when confirm_pending
    // reads it back.
    return {
      sepoliaTxHash,
      amountEth: preview.amountEth,
      to: preview.toAddress,
      reserveUnlockedUsd: reserve.unlockedUsd,
      reserveLockedUsd: reserve.lockedUsd,
      note: 'hardware authorization and the Sepolia movement are real; the reserve unlock is bookkeeping, not a bridge -- no funds moved onto Arc or Hedera',
    };
  });
}
