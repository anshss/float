// Zero RPC calls in this layer, stated as a feature (spec: C2. Perception).
// This test fails the build if anything under layers/perception ever imports
// an RPC/chain client — Graph gateway and Mirror Node are both plain HTTP.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const perceptionDir = path.join(here, '..');

const RPC_IMPORT_PATTERN = /(from\s+['"]|require\(['"])(ethers|viem|@solana\/web3\.js|web3|jayson|@hashgraph\/sdk)/;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...collectTsFiles(full));
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('perception layer has zero RPC calls', () => {
  it('never imports an RPC/chain client', () => {
    const files = collectTsFiles(perceptionDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      expect(RPC_IMPORT_PATTERN.test(content), `${file} imports an RPC client`).toBe(false);
    }
  });
});
