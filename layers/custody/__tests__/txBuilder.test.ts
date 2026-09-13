import { describe, it, expect } from 'vitest';
import { parseTransaction, recoverTransactionAddress } from 'viem';
import { sign, privateKeyToAddress } from 'viem/accounts';
import { keccak256, serializeTransaction } from 'viem';
import { loadConfig } from '../../../src/config.js';
import { attachSignature, buildReplenishmentTx, type ChainReads } from '../txBuilder.js';

const FROM = '0x58a8679318eaFBCbB28dC5e619886462f2A1872f' as const;
const TO = '0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1' as const;

const fakeChainReads: ChainReads = {
  getTransactionCount: async () => 3,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }),
  estimateGas: async () => 21_000n,
};

describe('buildReplenishmentTx', () => {
  it('denies with no device touch when LEDGER_FUNDING_ADDRESS is not set', async () => {
    const config = loadConfig({});
    const result = await buildReplenishmentTx(config, FROM, '0.01', fakeChainReads);
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
    expect((result as { detail: string }).detail).toMatch(/LEDGER_FUNDING_ADDRESS/);
  });

  it('denies a non-positive amount before any RPC read', async () => {
    const config = loadConfig({ LEDGER_FUNDING_ADDRESS: TO });
    const result = await buildReplenishmentTx(config, FROM, '0', fakeChainReads);
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
  });

  it('renders a full preview (nonce, fee estimate, chain) with the configured funding address', async () => {
    const config = loadConfig({ LEDGER_FUNDING_ADDRESS: TO });
    const result = await buildReplenishmentTx(config, FROM, '0.01', fakeChainReads);
    if (!('ok' in result) || !result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.data).toMatchObject({
      fromAddress: FROM,
      toAddress: TO,
      amountEth: '0.01',
      nonce: 3,
      chainId: 11155111,
      feeEstimateEth: '0.000042', // 2e9 wei/gas * 21000 gas
    });
    expect(result.data.unsignedRawHexNoPrefix.startsWith('0x')).toBe(false);
  });

  it('degrades to deployment_unavailable when the RPC is unreachable', async () => {
    const config = loadConfig({ LEDGER_FUNDING_ADDRESS: TO });
    const brokenReads: ChainReads = { ...fakeChainReads, estimateGas: async () => { throw new Error('network down'); } };
    const result = await buildReplenishmentTx(config, FROM, '0.01', brokenReads);
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
  });
});

describe('attachSignature', () => {
  it('reassembles a hw-app-eth-shaped {v,r,s} (hex, no 0x, decimal-looking v) into a transaction that recovers the signer', async () => {
    const config = loadConfig({ LEDGER_FUNDING_ADDRESS: TO });
    const built = await buildReplenishmentTx(config, FROM, '0.01', fakeChainReads);
    if (!('ok' in built) || !built.ok) throw new Error('expected ok');

    const pk = `0x${'ab'.repeat(32)}` as const;
    const signerAddress = privateKeyToAddress(pk);
    const unsignedHex = `0x${built.data.unsignedRawHexNoPrefix}` as const;
    const hash = keccak256(unsignedHex);
    const sig = await sign({ hash, privateKey: pk });
    const yParity = sig.yParity ?? Number(sig.v! % 2n);

    // hw-app-eth's own shape: hex strings, no `0x` prefix, v as the
    // y-parity rendered in hex (e.g. "00"/"01").
    const hwShaped = {
      r: sig.r.slice(2),
      s: sig.s.slice(2),
      v: yParity.toString(16).padStart(2, '0'),
    };

    const signedRawHex = attachSignature(built.data.tx, hwShaped);
    const parsed = parseTransaction(signedRawHex);
    expect(parsed.yParity).toBe(yParity);

    const recovered = await recoverTransactionAddress({ serializedTransaction: signedRawHex as `0x02${string}` });
    expect(recovered.toLowerCase()).toBe(signerAddress.toLowerCase());
  });
});
