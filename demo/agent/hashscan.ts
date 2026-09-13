// HashScan link builders for the auditor view. UNVERIFIED: built from
// general knowledge of HashScan's URL scheme, not confirmed against a live
// fetch in this environment (hashscan.io returned 404 to this sandbox's
// WebFetch, likely a bot-UA block rather than the path being wrong) --
// click every link once during rehearsal before demo day and fix the
// template here if any of them 404.

const HASHSCAN_BASE = 'https://hashscan.io/testnet';

export function hashscanTransactionUrl(txId: string): string {
  return `${HASHSCAN_BASE}/transaction/${encodeURIComponent(txId)}`;
}

export function hashscanTopicUrl(topicId: string): string {
  return `${HASHSCAN_BASE}/topic/${topicId}`;
}

export function hashscanAccountUrl(accountId: string): string {
  return `${HASHSCAN_BASE}/account/${accountId}`;
}
