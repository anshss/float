// The one event stream both views render from. The agent view and the
// auditor view are two projections of the SAME beat log, not two separately
// narrated scripts -- that's what makes "chain names appear exactly once, in
// the auditor view" a property of the rendering, not of two authors staying
// in sync by hand.

import type { DenialReason } from '../../src/contracts.js';

export type BeatLabel =
  | 'task'
  | 'compare_markets'
  | 'pay'
  | 'grant_budget'
  | 'child_spend'
  | 'transfer'
  | 'spend_history';

export type BeatEvent = {
  beat: number; // 1..6, matches the spec's numbered beats
  label: BeatLabel;
  ok: boolean;
  reason?: DenialReason;
  /** Neutral, agent-view-safe summary -- written by the runner per beat,
   * never a raw tool `detail` string (those can carry chain-specific
   * wording the presentation rule bans). Still run through
   * `assertAgentSafe` at render time as a backstop. */
  agentSummary: string;
  /** Everything the auditor view is allowed to show and the agent view is
   * not: deployment/account/topic ids, tx hashes, explorer links, raw tool
   * `detail` text. */
  auditor: {
    source?: 'graph' | 'hedera_hcs' | 'hedera_hts' | 'mirror_node' | 'arc' | 'privy';
    detail?: string;
    ids?: string[];
    links?: string[];
  };
};
