// Thin wrapper around Ledger's own `wallet-cli` for the commands it
// genuinely supports on Sepolia: `account discover` and `balances`/
// `operations` (all read-only, no device confirmation required beyond
// opening the Ethereum app -- see Ledger's own doc, quoted in the README:
// "Read-only commands ... never touch the device and are safe to run in CI
// or from an untrusted agent"). `send`/`receive`/`operations`/`swap execute`
// on testnets are out of scope for the CLI (Ledger's own wallet-cli skill
// file lists them under "Out of scope -- say no, don't improvise") -- this
// wrapper never calls them. Signing lives in `ledgerSigner.ts`, one layer
// below the CLI.

import { execFile } from 'node:child_process';
import type { FloatConfig } from '../../src/config.js';
import { denied, ok, type ToolResult } from '../../src/contracts.js';

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, [...args, '--output', 'json'], { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(err);
      resolve({ stdout, stderr });
    });
  });
}

/** wallet-cli streams one JSON object per line (progress updates, then the
 * final result) -- the last well-formed line is always the outcome. */
export function parseLastJsonLine(stdout: string): unknown {
  const lines = stdout.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      continue;
    }
  }
  throw new Error(`wallet-cli produced no parseable JSON line: ${stdout.slice(0, 500)}`);
}

function binFor(config: FloatConfig): string {
  return config.raw.LEDGER_CLI_BIN ?? 'wallet-cli';
}

export async function discoverSepoliaAccounts(config: FloatConfig): Promise<ToolResult<unknown>> {
  if (!config.configured.ledger) {
    return denied('deployment_unavailable', 'LEDGER_CLI_BIN not set -- wallet-cli is not configured');
  }
  try {
    const { stdout } = await run(binFor(config), ['account', 'discover', 'ethereum:sepolia']);
    const parsed = parseLastJsonLine(stdout) as { status?: string; accounts?: unknown };
    if (parsed.status !== 'success') {
      return denied('deployment_unavailable', `wallet-cli account discover did not succeed: ${JSON.stringify(parsed)}`);
    }
    return ok(parsed);
  } catch (err) {
    return denied('deployment_unavailable', `wallet-cli account discover failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getBalances(config: FloatConfig, account: string): Promise<ToolResult<unknown>> {
  if (!config.configured.ledger) {
    return denied('deployment_unavailable', 'LEDGER_CLI_BIN not set -- wallet-cli is not configured');
  }
  try {
    const { stdout } = await run(binFor(config), ['balances', '--account', account]);
    const parsed = parseLastJsonLine(stdout) as { status?: string };
    if (parsed.status !== 'success') {
      return denied('deployment_unavailable', `wallet-cli balances did not succeed: ${JSON.stringify(parsed)}`);
    }
    return ok(parsed);
  } catch (err) {
    return denied('deployment_unavailable', `wallet-cli balances failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getOperations(config: FloatConfig, account: string): Promise<ToolResult<unknown>> {
  if (!config.configured.ledger) {
    return denied('deployment_unavailable', 'LEDGER_CLI_BIN not set -- wallet-cli is not configured');
  }
  try {
    const { stdout } = await run(binFor(config), ['operations', '--account', account]);
    const parsed = parseLastJsonLine(stdout) as { status?: string };
    if (parsed.status !== 'success') {
      return denied('deployment_unavailable', `wallet-cli operations did not succeed: ${JSON.stringify(parsed)}`);
    }
    return ok(parsed);
  } catch (err) {
    return denied('deployment_unavailable', `wallet-cli operations failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
