# Privy wallet policies do not evaluate correctly on Arc (chain 5042002)

**Status:** reproduced live, 2026-09-13, against a real Privy app and a funded Arc testnet wallet.
**Severity:** a wallet policy silently fails closed -- it blocks 100% of transactions rather than
enforcing the rule it was configured with, with no error indicating the rule itself was ignored.

## Summary

Attaching **any** policy to a Privy server wallet transacting on Arc testnet (chain ID `5042002`, a
custom `defineChain`, not one of Privy's natively listed chains) causes **every**
`eth_sendTransaction` to be denied, regardless of whether the request actually violates the
attached rule's conditions. A request that plainly satisfies the policy's own `ALLOW` rule is
denied identically to one that violates it. Detaching the policy entirely (`policy_ids: []`) makes
an otherwise-identical transaction succeed immediately.

The refusal is a genuine `PrivyAPIError` from the wallet-RPC call itself -- this is not a network,
auth, or RPC-provider issue. The policy engine is being invoked; it just isn't discriminating by
the rule's conditions on this chain.

## Environment

- Chain: Arc testnet, `chain_id: 5042002`, RPC `https://rpc.testnet.arc.io`, defined via viem's
  `defineChain` (not one of viem's built-in `viem/chains`, not one of Privy's natively listed chains).
- Native currency: USDC itself, 18 decimals (per `docs.arc.io` -- distinct from the 6-decimal ERC-20
  USDC most chains use).
- SDK: `@privy-io/node@0.34.0`, viem integration via `createViemAccount` from `@privy-io/node/viem`.
- Wallet: `chain_type: 'ethereum'` server wallet, owned by a 1-of-1 key quorum, transacting via a
  viem `WalletClient` (`account` = `createViemAccount(...)`, `chain` = the Arc `defineChain` object,
  `transport` = `http('https://rpc.testnet.arc.io')`).

## Reproduction

1. Create a policy with a single `ALLOW` rule on `eth_sendTransaction`, e.g.:
   ```json
   {
     "version": "1.0",
     "chain_type": "ethereum",
     "rules": [{
       "name": "allow-under-50usd",
       "method": "eth_sendTransaction",
       "action": "ALLOW",
       "conditions": [{ "field_source": "ethereum_transaction", "field": "value", "operator": "lte", "value": "50000000000000000000" }]
     }]
   }
   ```
2. Attach it to the wallet: `POST /v1/wallets/{id}` with `policy_ids: ["<policy_id>"]`.
3. Send a **trivially compliant** transaction well under the cap (`value` = `0.1 USDC` =
   `100000000000000000` wei, vs. the `50 USDC` cap above) via
   `walletClient.sendTransaction({ to: <self>, value: 100000000000000000n })`.
4. **Expected:** the transaction is signed and broadcast (it satisfies the `ALLOW` rule).
   **Actual:** denied. Raw response body: `{"error":"RPC request denied due to policy violation","code":"policy_violation"}`.

## Ruling out our own mistakes

We tried three independent rule shapes before concluding this is not a bug on our side. All three
were denied identically, for the identical trivially-compliant `0.1 USDC` request:

| Rule shape | Condition | Result |
|---|---|---|
| Decimal value cap | `{field:"value", operator:"lte", value:"50000000000000000000"}` (50 USDC, wei-as-decimal-string) | denied |
| Hex value cap | `{field:"value", operator:"lte", value:"0xde0b6b3a7640000"}` (1 USDC, wei-as-hex) | denied |
| chain_id-only, no value condition | `{field:"chain_id", operator:"eq", value:"5042002"}` | denied |

This rules out: a decimal-vs-hex encoding mismatch, a decimals mismatch (Arc's native currency is
18 decimals, confirmed independently against `docs.arc.io`), and a bug specific to the `value`
field/comparison at all (the `chain_id`-only rule has no `value` condition and still failed).

**Negative control:** with the policy detached entirely (`policy_ids: []`), the identical
transaction (same wallet, same recipient, same amount) succeeds and lands on-chain immediately. This
isolates the cause to "a policy is attached, on this chain" -- not the wallet, the signing key, the
transaction shape, or Arc's own RPC node (which never even sees a request that Privy's wallet-RPC
already refused to sign).

## Why we're confident this is Privy's policy engine, not Arc's RPC or ours

- The error body `{"error": "...", "code": "..."}` is Privy's own REST error shape -- we verified
  this independently: a malformed policy creation request (`rules` with an empty `conditions`
  array) returns the *same* `{error, code}` shape via a direct, unwrapped `BadRequestError` from the
  SDK (`Validation error: ... "code":"invalid_policy_format"`), before any transaction is ever sent.
- The failure happens before the transaction is broadcast to Arc: the negative control (no policy)
  broadcasts successfully via the same RPC endpoint, so Arc's RPC is not the layer rejecting anything.
- viem's `sendTransaction` wraps whatever `account.signTransaction()` throws in its own
  `TransactionExecutionError`. We initially mis-classified this as a non-Privy error for exactly this
  reason -- unwrapping the `cause` chain with viem's `BaseError.walk()` recovers the real
  `PrivyAPIError` underneath (see `layers/settlement/transferUsdc.ts`, `findPrivyError`). Teams
  reproducing this should check `err.cause` / use `.walk()`, not a bare `instanceof` check.

## What we did about it

Per this ticket's own contingency plan: kept the Privy server wallet (hot-key custody via Privy is
still real and still valuable), detached the wallet's policy permanently, dropped any claim of a
Privy-enforced cap, and implemented the per-transaction float cap ourselves at the application layer
(`ceiling_exceeded` in `layers/settlement/transferUsdc.ts`) -- the same pattern the Hedera policy
layer already uses for its own ceilings.

## Re-running this

`demo/proofs/arc-settlement-proof.ts` (via `npm run proof:arc`) reproduces the compliant-transfer-
denied-anyway case live against a funded wallet as step "R6 evidence", with the raw Privy response
logged verbatim to `demo/proofs/arc-settlement-proof.output.md`.
