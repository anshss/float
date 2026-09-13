// Fixed inputs for the six-beat demo, per the spec's "Demo script (<= 3 min,
// one take)" section. Every value here is a constant, never derived from a
// live query result, so two rehearsals against the same lockfile produce the
// same beat sequence and the same denials.

/** The task as the spec states it, verbatim -- kept here only for the code
 * comment / auditor-facing record, never printed to the agent view (it names
 * the asset by ticker, which the presentation rule bans there -- see
 * `AGENT_TASK_LINE` below). */
export const SPEC_TASK_TEXT =
  'rebalance idle USDC toward the best lending rate under $50 total cost.';

/** What beat 1 actually prints to the agent view: same task, asset referred
 * to generically rather than by ticker, so beat 1 doesn't itself violate the
 * "zero chain/asset names in the agent view" rule the later beats are held
 * to. */
export const AGENT_TASK_LINE =
  'rebalance idle stablecoin balance toward the best lending rate under $50 total cost.';

export const SCHEMA_FAMILY = 'lending';

/** Beat 4: the child this run grants a sub-budget to and then overspends
 * from. Reuses the spender account the policy layer already bootstrapped
 * (see layers/policy/.state/hedera.json) -- grant_budget's ensureAgentAccount
 * is idempotent, so re-granting here never mints a new account. */
export const CHILD_AGENT_ID = 'demo-child-1';

/** ~$10 at the demo's illustrative rate, expressed in the policy engine's
 * native unit (see grant_budget's `ceiling` argument). Kept well under
 * FLOAT_ROOT_CEILING_HBAR (default 10) so the hierarchy invariant never
 * blocks the grant itself. */
export const CHILD_CEILING_NATIVE = '0.5';

/** The child's overspend attempt -- comfortably above CHILD_CEILING_NATIVE,
 * so `spend()` (layers/policy/engine.ts) denies it with `ceiling_exceeded`
 * before any chain write, exactly like the policy layer's own live-verify
 * script exercises the same denial. */
export const CHILD_OVERSPEND_NATIVE = 1;

export const CHILD_OVERSPEND_SERVICE = 'counterparty_risk';

/** Beat 5: transfer_usdc's `to` is the settlement wallet's own address (same
 * pattern as demo/proofs/arc-settlement-proof.ts) -- no second funded
 * address is required for the demo to prove the denial path. Read at call
 * time from config rather than hardcoded here. */
export const TRANSFER_AMOUNT_NATIVE = '25';
