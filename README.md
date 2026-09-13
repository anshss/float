# float-mcp

MCP server that acts as the economic actuator for AI agents (stdio transport). See
`.specs/2026-09-13-float-design.md` at the workspace root for the full system design.

## C3: Policy (budgets on HTS allowances)

`layers/policy/` implements hierarchical spending budgets as owner-signed HTS/HBAR
allowances, plus the HCS audit writer every grant/revoke/spend/denial goes through.

**Claim discipline:** ceilings are enforced on-chain (a real HTS allowance the network
itself will not let a spender exceed); the hierarchy invariant — sum of a parent's
active child ceilings never exceeds the parent's own ceiling — is enforced by Float at
grant time and committed to HCS. Both are auditable. **Never claim on-chain nesting**:
HTS/HBAR allowances are strictly owner→spender, and a spender cannot re-delegate
(delegating-spender exists only for NFTs), so there is no on-chain concept of a child
allowance being nested inside a parent's.

- Each agent (parent or child) gets its own Hedera account. Every ceiling is an
  owner-signed `AccountAllowanceApproveTransaction` from the treasury account (the
  allowance owner). Spend path is a `TransferTransaction` using the approved-transfer
  flag, fee paid by the spender account (HIP-336).
- Account bootstrap (treasury + per-agent spender accounts + the audit topic) runs in
  code on first use, funded from `HEDERA_OPERATOR_ID`/`_KEY`, and is idempotent — ids
  and keys are persisted to `<state dir>/hedera.json` (gitignored, plaintext keys,
  local/demo use only) so a rerun never mints duplicate accounts or a duplicate topic.
  Ids are logged loudly to stderr on creation; keys never are.
  **`<state dir>` must survive a worktree reap (#16)**: a treasury minted inside a
  linked worktree that later got `worktree:rm`'d took its allowance-owner key with it,
  permanently — `grant_budget` had no live path until a fresh treasury was minted. So
  `layers/policy/state.ts` resolves the directory as, in order: the `FLOAT_STATE_DIR`
  env var if set; else the main checkout's own `layers/policy/.state/`, auto-detected
  from *any* linked worktree with no hardcoded path (a worktree's `.git` is a file
  pointing back at `<main checkout>/.git/worktrees/<name>`); else this checkout's own
  `.state/`, with a loud warning that it will not survive a reap if this ever does turn
  out to be a worktree. The resolved path is logged to stderr at startup either way.
- `GRANT_SIGNER=operator|ledger` (env, default `operator`). `ledger` routes every grant
  through the C6 custody wrapper (`layers/custody/`, ticket #5) and returns
  `awaiting_device` until that wrapper exists and confirms — see
  `layers/policy/ledger-signer.ts` for the seam.
- `DRY_RUN=1` (or `FLOAT_LIVE` unset — see `src/config.ts`) stubs every Hedera write
  with a synthetic result and still writes the audit message (to stderr, tagged
  `dry_run: true`, not to a real topic). Going live is an explicit opt-in only
  (`DRY_RUN=0` or `FLOAT_LIVE=1`, #14) — never inferred from which env vars are set —
  and the server logs its effective mode loudly at startup either way.
- **Hedera chain limits** (fine at demo scale): 100 allowances per owner account, 20
  approvals per `AccountAllowanceApproveTransaction`.
- Live end-to-end verification script (real testnet, re-runnable, idempotent):
  `DRY_RUN=0 npx tsx layers/policy/live-verify.ts` from this directory, with
  `HEDERA_OPERATOR_ID`/`_KEY` set. Completes a hollow operator account if needed,
  bootstraps treasury/topic/child accounts, grants a budget, proves an over-ceiling
  spend is denied and logged, and proves a hierarchy-violating grant is refused before
  touching the chain.
- `float_status()` reports the policy layer's **ground truth**, not env-var presence
  (#11): it reads treasury/topic ids from `layers/policy/.state/hedera.json` (the
  bootstrap's own persisted record) when `HEDERA_TREASURY_ID`/`HEDERA_TOPIC_ID` aren't
  set in the environment — an explicit env value still wins, so an operator can point a
  run at pre-existing accounts. The response's `hedera` field names the treasury and
  topic ids directly (safe to paste into HashScan) and, outside DRY_RUN, reports each
  agent's live on-chain allowance remaining via one Mirror Node call
  (`layers/policy/mirror.ts`) — never a private key. `configured.hedera` in the same
  response reflects this ground truth; `src/config.ts`'s own `configured.hedera` (used
  internally to pick the DRY_RUN default) stays env-var-only and is untouched by this.

## C6: Custody (Ledger Wallet CLI, treasury/float reserve model)

`layers/custody/` treats the treasury as a real Ledger hardware wallet on Sepolia, and
models each float's reserve as a locked tranche that only a physical device press can
unlock.

**Ledger's own Wallet CLI doesn't sign on testnets.** Its own skill file
(`skills/wallet-cli/wallet-cli-usage/SKILL.md` in `LedgerHQ/agent-skills`), under a
heading literally titled "Out of scope — say no, don't improvise", blocks `send`,
`receive`, `operations` (write), and `swap execute` on testnets and L2s. `send
--dry-run` doesn't exist on Sepolia either. That's the CLI's product policy, not a
hardware or protocol limit, so signing here goes one layer below the CLI: npm
describes wallet-cli itself as "Ledger Wallet CLI using Device Management Kit (USB)" —
`@ledgerhq/hw-app-eth` + `@ledgerhq/hw-transport-node-hid` talk to that same USB
transport directly. The newer `@ledgerhq/device-management-kit` +
`@ledgerhq/device-signer-kit-ethereum` stack was tried first per the ticket's own
suggestion; it was dropped for the older pair because its dependency tree threw
`ERR_MODULE_NOT_FOUND` on a nested subpackage under Node's strict ESM resolver even for
a version-matched install, while `hw-app-eth`/`hw-transport-node-hid` are CommonJS and
resolve cleanly via `node:module`'s `createRequire` (see `layers/custody/ledgerSigner.ts`).

- **Still uses `wallet-cli` for what genuinely works on Sepolia**: `account discover
  ethereum:sepolia` and `balances`/`operations`, all read-only. Per Ledger's own docs:
  *"Read-only commands (balances, operations, `earn yields`, `earn positions`) never
  touch the device and are safe to run in CI or from an untrusted agent."*
  `layers/custody/walletCli.ts` shells out to it with `--output json` and parses the
  final streamed line. "Key Ring CLI" in the prize text is not a separate tool — it's
  the `ring` subcommand family inside `wallet-cli` (LKRP protocol); this project uses
  wallet-cli's own name throughout.
- **The device press is real and un-bypassable.** It is enforced by the Ethereum app on
  the device itself, not by Float: `signTransaction`/`signPersonalMessage`
  (`layers/custody/ledgerSigner.ts`) block on the device's APDU response, which the app
  does not return until a human approves or rejects on-screen. There is no code path
  anywhere in this layer that produces a signature without that.
- **No `send --dry-run` on Sepolia → our own refusal preview.** `layers/custody/txBuilder.ts`
  builds the real EIP-1559 transaction (nonce, fee estimate, chain id) against Sepolia
  via `viem`, and with no device configured (or `DRY_RUN`) `replenish.ts` returns that
  exact preview as a structured `awaiting_device` denial — same product behaviour as a
  dry-run preview, different mechanism, and it never touches the device.
- **Signing doesn't block the tool call.** A physical press can take arbitrarily long,
  so `layers/custody/pending.ts` returns `awaiting_device` immediately and keeps the
  signing promise running in the background; `confirm_pending()` only ever reads that
  persisted record back. It reports device state, it never bypasses it — there is no
  path that returns a result without an observed press. This is shared by both things
  that need a real press: a treasury replenishment, and (`GRANT_SIGNER=ledger`,
  `layers/policy/ledger-signer.ts`) a policy-grant attestation. Hedera isn't one of the
  networks the Ledger app can sign for (bitcoin/ethereum(+EVM)/solana only — Arc and
  Hedera are out), so the ledger-signer press is a Clear-Signed attestation of the
  grant's own terms, gating whether the Hedera-side allowance (signed by the treasury's
  own Hedera key, exactly as the operator-signer path does) commits at all.
- **The reserve model is bookkeeping, honestly.** No bridge is in scope. Each float
  holds a locked reserve tranche (`FLOAT_CAP_HOT_BALANCE_USD`) that policy refuses to
  release. A confirmed Ledger press authorizes a real, small Sepolia movement from the
  treasury to `LEDGER_FUNDING_ADDRESS`; on that confirmation, `layers/custody/reserve.ts`
  unlocks a fixed `FLOAT_RESERVE_UNLOCK_USD` from the tranche. The hardware
  authorization is real, the Sepolia movement is real, the unlock itself is
  bookkeeping — it never lands as USDC on Arc or HBAR on Hedera, because there is no
  bridge. Code and copy say "authorizes", never "bridges". (CCTP Sepolia→Arc was
  checked and is not trivially available for this project's scope, so it stays
  roadmap.)
- **Everything degrades to a structured denial with no device attached** (spec R1): no
  `LEDGER_CLI_BIN` configured means every custody entry point — discovery, balances,
  a replenishment request, a `GRANT_SIGNER=ledger` grant — returns `awaiting_device`
  immediately, with zero device or network touch, so the rest of the product runs
  demoable without a Ledger plugged in.
- **The one live step**: `npm run demo:ledger-press` (`layers/custody/live-verify.ts`)
  runs discovery, balances, and starts a real 0.001 ETH treasury authorization, then
  prints `>>> PRESS THE BUTTON ON YOUR LEDGER NOW <<<` and polls `confirm_pending`'s own
  logic until it confirms (or times out at 3 minutes). Everything before that line runs
  headless; recorded headless output (discovery, balances, the refusal preview, every
  no-device denial) is in `demo/proofs/custody-proof.output.md`
  (`npm run proof:custody` to re-run it).
