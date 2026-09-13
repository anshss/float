// Builds and (once device-signed) finalizes a Sepolia EIP-1559 treasury
// authorization -- our own transaction construction, standing in for the
// spec's `send --dry-run` (which does not exist for wallet-cli on Sepolia,
// see the ticket). Every refusal path below renders the exact transaction
// that was refused, fee estimate included, with no device touch -- same
// product behaviour as a dry-run preview, different mechanism.

import {
  createPublicClient,
  formatEther,
  http,
  parseEther,
  serializeTransaction,
  type PublicClient,
  type TransactionSerializableEIP1559,
} from 'viem';
import { sepolia } from 'viem/chains';
import { denied, type ToolResult } from '../../src/contracts.js';
import type { FloatConfig } from '../../src/config.js';
import type { EthSignature } from './ledgerSigner.js';

export type BuiltReplenishmentTx = {
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountEth: string;
  feeEstimateEth: string;
  nonce: number;
  chainId: number;
  tx: TransactionSerializableEIP1559;
  /** Unsigned, no `0x` prefix -- the exact form `hw-app-eth`'s
   * `signTransaction` expects. */
  unsignedRawHexNoPrefix: string;
};

export function makePublicClient(config: FloatConfig): PublicClient {
  return createPublicClient({
    chain: sepolia,
    transport: http(config.raw.SEPOLIA_RPC_URL ?? sepolia.rpcUrls.default.http[0]),
  });
}

export type ChainReads = {
  getTransactionCount(args: { address: `0x${string}`; blockTag: 'pending' }): Promise<number>;
  estimateFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  estimateGas(args: { account: `0x${string}`; to: `0x${string}`; value: bigint }): Promise<bigint>;
};

function realChainReads(config: FloatConfig): ChainReads {
  const client = makePublicClient(config);
  return {
    getTransactionCount: (args) => client.getTransactionCount(args),
    estimateFeesPerGas: () => client.estimateFeesPerGas(),
    estimateGas: (args) => client.estimateGas(args),
  };
}

export async function buildReplenishmentTx(
  config: FloatConfig,
  fromAddress: `0x${string}`,
  amountEth: string,
  chainReads: ChainReads = realChainReads(config),
): Promise<ToolResult<BuiltReplenishmentTx>> {
  const toAddress = config.raw.LEDGER_FUNDING_ADDRESS as `0x${string}` | undefined;
  if (!toAddress) {
    return denied('deployment_unavailable', 'LEDGER_FUNDING_ADDRESS not set -- no earmarked destination for a treasury authorization');
  }

  let value: bigint;
  try {
    value = parseEther(amountEth);
  } catch {
    return denied('deployment_unavailable', `amount "${amountEth}" is not a valid decimal ETH amount`);
  }
  if (value <= 0n) {
    return denied('deployment_unavailable', `amount "${amountEth}" must be positive`);
  }

  let nonce: number;
  let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  let gas: bigint;
  try {
    [nonce, fees, gas] = await Promise.all([
      chainReads.getTransactionCount({ address: fromAddress, blockTag: 'pending' }),
      chainReads.estimateFeesPerGas(),
      chainReads.estimateGas({ account: fromAddress, to: toAddress, value }),
    ]);
  } catch (err) {
    return denied('deployment_unavailable', `could not reach Sepolia RPC to build the transaction: ${err instanceof Error ? err.message : String(err)}`);
  }

  const tx: TransactionSerializableEIP1559 = {
    chainId: sepolia.id,
    to: toAddress,
    value,
    nonce,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    type: 'eip1559',
  };

  const feeWei = fees.maxFeePerGas * gas;
  const unsignedRawHex = serializeTransaction(tx);

  return {
    ok: true,
    data: {
      fromAddress,
      toAddress,
      amountEth,
      feeEstimateEth: formatEther(feeWei),
      nonce,
      chainId: sepolia.id,
      tx,
      unsignedRawHexNoPrefix: unsignedRawHex.slice(2),
    },
  };
}

/** Reassembles the device signature into a broadcastable signed transaction.
 *
 * UNVERIFIED against real hardware (no live device press has run this path
 * yet -- see the ticket's live-press rehearsal step): `hw-app-eth` returns
 * `v`/`r`/`s` as hex strings without a `0x` prefix; for an EIP-1559 (type 2)
 * transaction `v` is the y-parity, not a legacy chain-adjusted value, so
 * `parseInt(v, 16) % 2` is the standard reference-integration reading of
 * it. Confirm this against the first real signed broadcast.
 */
export function attachSignature(tx: TransactionSerializableEIP1559, signature: EthSignature): `0x${string}` {
  const yParity = parseInt(signature.v, 16) % 2;
  return serializeTransaction(tx, {
    r: `0x${signature.r}`,
    s: `0x${signature.s}`,
    yParity,
  });
}
