// Neutral, agent-view-safe copy for each structured denial reason
// (src/contracts.ts's DenialReason). The runner uses these instead of
// forwarding a tool's raw `detail` string into the agent view -- a `detail`
// is written for a developer reading logs and freely names chains,
// deployments and env vars; these are written for the view the presentation
// rule actually governs.
import type { DenialReason } from '../../src/contracts.js';

export const DENIAL_COPY: Record<DenialReason, string> = {
  ceiling_exceeded: 'denied — over the agreed spending ceiling',
  no_signal_cited: 'denied — no prior query result to cite as grounds',
  awaiting_device: 'awaiting_device — exceeds the available float; treasury authorization required',
  deployment_unavailable: 'denied — data source unavailable',
  provider_policy_denied: 'denied — refused by an upstream policy check',
};
