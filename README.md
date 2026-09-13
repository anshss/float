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
  and keys are persisted to `layers/policy/.state/hedera.json` (gitignored, plaintext
  keys, local/demo use only) so a rerun never mints duplicate accounts or a duplicate
  topic. Ids are logged loudly to stderr on creation; keys never are.
- `GRANT_SIGNER=operator|ledger` (env, default `operator`). `ledger` routes every grant
  through the C6 custody wrapper (`layers/custody/`, ticket #5) and returns
  `awaiting_device` until that wrapper exists and confirms — see
  `layers/policy/ledger-signer.ts` for the seam.
- `DRY_RUN=1` (or unset with any write layer's creds missing — see `src/config.ts`)
  stubs every Hedera write with a synthetic result and still writes the audit message
  (to stderr, tagged `dry_run: true`, not to a real topic).
- **Hedera chain limits** (fine at demo scale): 100 allowances per owner account, 20
  approvals per `AccountAllowanceApproveTransaction`.
- Live end-to-end verification script (real testnet, re-runnable, idempotent):
  `DRY_RUN=0 npx tsx layers/policy/live-verify.ts` from this directory, with
  `HEDERA_OPERATOR_ID`/`_KEY` set. Completes a hollow operator account if needed,
  bootstraps treasury/topic/child accounts, grants a budget, proves an over-ceiling
  spend is denied and logged, and proves a hierarchy-violating grant is refused before
  touching the chain.
