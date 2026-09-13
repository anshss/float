// Enforcement point for the demo's one hard presentation constraint (spec:
// "Presentation rule"): the agent's rendered view names zero
// chains and zero asset tickers. Plain substring match, not \b-bounded --
// `GRAPH_API_KEY` and `hierarchy` both carry a banned token mid-word
// ("_GRAPH_", "hi-ERA-rchy"... no -- "hiERArchy" doesn't, but "hiERARCHy"
// does carry "arc" at "hier-ARC-hy"), and a denial's free-text `detail`
// field is exactly the kind of string that can carry either without anyone
// intending it to.
const BANNED_TOKENS = ['hedera', 'arc', 'graph', 'sepolia', 'hbar', 'usdc'] as const;

/** Throws, rather than silently rewriting, the moment a banned token would
 * reach the agent view. A demo transcript with a chain name quietly stripped
 * out is exactly the "reduces scope quietly" failure this project's rails
 * are built to avoid everywhere else -- this line is the one for the
 * presentation rule. Callers write their OWN neutral copy for anything a
 * live tool result might phrase in chain-specific terms (see view.ts); this
 * is the backstop that fails loud if one slips through. */
export function assertAgentSafe(line: string): string {
  const lower = line.toLowerCase();
  for (const token of BANNED_TOKENS) {
    if (lower.includes(token)) {
      throw new Error(
        `demo/agent presentation rule violated: agent-view line contains banned token "${token}": ${JSON.stringify(line)}`,
      );
    }
  }
  return line;
}

export { BANNED_TOKENS };
