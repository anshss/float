// Arc testnet network facts (C5). Not secrets -- hardcoded rather than read
// from .env, same as the demo-core registry is hardcoded rather than
// user-supplied. Source: https://docs.arc.io/arc/references/connect-to-arc,
// confirmed live (2026-09-13): USDC is Arc's NATIVE gas token at 18 decimals,
// distinct from the 6-decimal ERC-20 USDC most chains use -- a `transfer_usdc`
// on Arc is therefore a plain native-value transfer, never an ERC-20 call.

import { defineChain } from 'viem';

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: {
    default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
});

export function arcExplorerTxUrl(txHash: string): string {
  return `https://testnet.arcscan.app/tx/${txHash}`;
}
