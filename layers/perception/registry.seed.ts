// Subgraph registry — protocol slug → endpoint entries
// Auto-generated from messari/subgraphs deployment.json (lending schema only)
// URL is assembled at runtime: https://gateway.thegraph.com/api/{GRAPH_API_KEY}/subgraphs/id/{subgraphId}

export type SubgraphEntry = {
  slug: string;
  network: string;
  subgraphId: string;
  schemaVersion: string;
};

export const REGISTRY: Record<string, SubgraphEntry[]> = {
  "aave-amm": [
    { slug: "aave-amm-ethereum", network: "MAINNET", subgraphId: "41ooPWnDYKwckqyG1mvg7ZEndy5zMemXinx6uQxscrBS", schemaVersion: "3.1.0" },
  ],
  "aave-arc": [
    { slug: "aave-arc-ethereum", network: "MAINNET", subgraphId: "5hyqnEzjZbwFBU1rk4JBknCeiF2Mj93qBzsyQfpAa3QA", schemaVersion: "3.1.0" },
  ],
  "aave-rwa": [
    { slug: "aave-rwa-ethereum", network: "MAINNET", subgraphId: "C8ynQrjVKcmqxb9fWrLvSCBFNf2ChFkxCg7Q8gknJrza", schemaVersion: "3.1.0" },
  ],
  "aave-v2": [
    { slug: "aave-v2-ethereum", network: "MAINNET", subgraphId: "C2zniPn45RnLDGzVeGZCx2Sw3GXrbc9gL4ZfL8B8Em2j", schemaVersion: "3.1.0" },
    { slug: "aave-v2-polygon", network: "MATIC", subgraphId: "GrZQJ7sWdTqiNUD8Vh2THaeBM4wGwiF8mFv9FBfyzwxm", schemaVersion: "3.1.0" },
    { slug: "aave-v2-avalanche", network: "AVALANCHE", subgraphId: "9nh6Ums63wFcoZpmegyPcAFtY3CAzQc3S6cuERALYMqa", schemaVersion: "3.1.0" },
  ],
  "aave-v3": [
    { slug: "aave-v3-ethereum", network: "MAINNET", subgraphId: "JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk", schemaVersion: "3.1.0" },
    { slug: "aave-v3-optimism", network: "OPTIMISM", subgraphId: "3RWFxWNstn4nP3dXiDfKi9GgBoHx7xzc7APkXs1MLEgi", schemaVersion: "3.1.0" },
    { slug: "aave-v3-arbitrum", network: "ARBITRUM_ONE", subgraphId: "4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf", schemaVersion: "3.1.0" },
    { slug: "aave-v3-base", network: "BASE", subgraphId: "D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9", schemaVersion: "3.1.0" },
    { slug: "aave-v3-polygon", network: "MATIC", subgraphId: "6yuf1C49aWEscgk5n9D1DekeG1BCk5Z9imJYJT3sVmAT", schemaVersion: "3.1.0" },
    { slug: "aave-v3-avalanche", network: "AVALANCHE", subgraphId: "72Cez54APnySAn6h8MswzYkwaL9KjvuuKnKArnPJ8yxb", schemaVersion: "3.1.0" },
    { slug: "aave-v3-bsc", network: "BSC", subgraphId: "43jbGkvSw55sMvYyF6MZieksmJbajMu3hNGF8PN9ucuP", schemaVersion: "3.1.0" },
    { slug: "aave-v3-scroll", network: "SCROLL", subgraphId: "DkvXMxq1skgSe1ehLHWpiUthHU1znnMDK2SUmj9avhEX", schemaVersion: "3.1.0" },
    { slug: "aave-v3-fantom", network: "FANTOM", subgraphId: "ZcLcVKJNQboeqACXhGuL3WFLBZzf5uUWheNsaFvLph6", schemaVersion: "3.1.0" },
    { slug: "aave-v3-harmony", network: "HARMONY", subgraphId: "G1BNHqmteZiUwSEacfXG2nzMm13KLNo5xoxv62ErAyQv", schemaVersion: "3.1.0" },
    { slug: "aave-v3-gnosis", network: "GNOSIS", subgraphId: "GiNMLDxT1Bdn2dQZxjQLmW24uwpc3geKUBW8RP6oEdg", schemaVersion: "3.1.0" },
  ],
  "abracadabra": [
    { slug: "abracadabra-ethereum", network: "MAINNET", subgraphId: "GLAu42kvVs7ixfXcmkAsRiS7Xt1NCpgkKsnz3qiriuvV", schemaVersion: "2.0.1" },
    { slug: "abracadabra-arbitrum", network: "ARBITRUM_ONE", subgraphId: "3m97d2dJ2pXwPFuiHrm8T37V9TCoAHBpMqRwdguyUZXF", schemaVersion: "2.0.1" },
    { slug: "abracadabra-avalanche", network: "AVALANCHE", subgraphId: "3Gkei7B24o9C2bCoAbQpApZqMStPta7oCAnNhmNv5dab", schemaVersion: "2.0.1" },
    { slug: "abracadabra-bsc", network: "BSC", subgraphId: "6bFCfHn5Uuv5fH7PxKL12dzWh3zz7fkQ46EnMa7nZUj2", schemaVersion: "2.0.1" },
    { slug: "abracadabra-fantom", network: "FANTOM", subgraphId: "2nxGrxxPShrm49dEWusJjB5dpmonN16JFzLwDrS1pCyq", schemaVersion: "2.0.1" },
  ],
  "alpaca-finance-lending": [
    { slug: "alpaca-finance-lending-bsc", network: "BSC", subgraphId: "ED3ayhcLA7h7DCGwbysgcxtfMEcoeYCdMEsdZJeoaUFS", schemaVersion: "2.0.1" },
    { slug: "alpaca-finance-lending-fantom", network: "FANTOM", subgraphId: "6EfFr7xDpD7LLi1X8Cj9b6ytjFjX3GZYrMrCKomEuCmx", schemaVersion: "2.0.1" },
  ],
  "banker-joe": [
    { slug: "banker-joe-avalanche", network: "AVALANCHE", subgraphId: "9NjYuG2BFU1BPacNdKymd9eNdfVCaJM6LhsgD8zSQgDK", schemaVersion: "2.0.1" },
  ],
  "bastion-protocol": [
    { slug: "bastion-protocol-aurora", network: "AURORA", subgraphId: "BD4rW7Ga5YQ3x68tALbi8vsXNodd6LrvFeaVocdJt3bD", schemaVersion: "2.0.1" },
  ],
  "benqi": [
    { slug: "benqi-avalanche", network: "AVALANCHE", subgraphId: "8ZjJGsaKea7WwLJPJNdHXPGsvXDe3iq2231aRjgBPisi", schemaVersion: "2.0.1" },
  ],
  "burrow": [
    // NOTE: TVL data appears inflated (~$60B) — likely a token price or decimal issue in the subgraph
    { slug: "burrow-near", network: "NEAR", subgraphId: "5W5fhZAq6QABBijKo7wqYps7TLzqAqS2mU1C1rhktvtg", schemaVersion: "2.0.1" },
  ],
  "compound-v2": [
    { slug: "compound-v2-ethereum", network: "MAINNET", subgraphId: "4TbqVA8p2DoBd5qDbPMwmDZv3CsJjWtxo8nVSqF2tA9a", schemaVersion: "2.0.1" },
  ],
  "compound-v3": [
    { slug: "compound-v3-ethereum", network: "MAINNET", subgraphId: "AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9", schemaVersion: "3.1.0" },
    { slug: "compound-v3-polygon", network: "MATIC", subgraphId: "5wfoWBpfYv59b99wDxJmyFiKBu9brXESeqJAzw8WP5Cz", schemaVersion: "3.1.0" },
    { slug: "compound-v3-arbitrum", network: "ARBITRUM_ONE", subgraphId: "5MjRndNWGhqvNX7chUYLQDnvEgc8DaH8eisEkcJt71SR", schemaVersion: "3.1.0" },
    // compound-v3-base omitted: deployment.json had duplicate of ethereum subgraphId
  ],
  "cream-finance": [
    { slug: "cream-finance-ethereum", network: "MAINNET", subgraphId: "43NeT7UTACLUkohKBaG7auvkhsj4Kwux9kNTJr6sFdNe", schemaVersion: "2.0.1" },
    { slug: "cream-finance-bsc", network: "BSC", subgraphId: "Dd2ak11qC4mS2spUXzJm5v9EtVNJqmBC9rLzbckTwfN1", schemaVersion: "2.0.1" },
    { slug: "cream-finance-arbitrum", network: "ARBITRUM_ONE", subgraphId: "GzHkVNf7BBqUjV8Sy6U6xUaWdGheFMdin1cB6sNvfdzs", schemaVersion: "2.0.1" },
    { slug: "cream-finance-polygon", network: "MATIC", subgraphId: "CBeERkhQNwPwU3jSWdKHeAtPQh4TFucUyUMcqAJk19ij", schemaVersion: "2.0.1" },
  ],
  "dforce": [
    { slug: "dforce-ethereum", network: "MAINNET", subgraphId: "6PaB6tKFqrL6YoAELEhFGU6Gc39cEynLbo6ETZMF3sCy", schemaVersion: "2.0.1" },
    { slug: "dforce-arbitrum", network: "ARBITRUM_ONE", subgraphId: "Dpk4Gen22wxQ3Laojf7DR2me8wGzjaHwjsKAsLf2rCFV", schemaVersion: "2.0.1" },
    { slug: "dforce-bsc", network: "BSC", subgraphId: "DKu1HqTTi26uLZKAmvDbqyAvcnFAjXEuRJmF35RLpyFg", schemaVersion: "2.0.1" },
    { slug: "dforce-optimism", network: "OPTIMISM", subgraphId: "6AmkakXwadWiZ2jN7oJcFreWmKG1nZrT5P8om52upYPd", schemaVersion: "2.0.1" },
    { slug: "dforce-polygon", network: "MATIC", subgraphId: "9CFGPWpntYisBp7NpHMrgYzFrBmtVxSw58haGyZ3ewoZ", schemaVersion: "2.0.1" },
  ],
  "euler-finance": [
    { slug: "euler-finance-ethereum", network: "MAINNET", subgraphId: "95nyAWFFaiz6gykko3HtBCyhRuP5vZzuKYsZiLxHxLhr", schemaVersion: "1.3.0" },
  ],
  "geist-finance": [
    { slug: "geist-finance-fantom", network: "FANTOM", subgraphId: "45LX32kZPBRNiXaBKDrzbCnidoKv3cMEc8cXt3kvPifz", schemaVersion: "3.1.0" },
  ],
  "goldfinch": [
    { slug: "goldfinch-ethereum", network: "MAINNET", subgraphId: "GRwpFCPYyQPdz84sCnKemzrNvgFPuKkFLcRLR6jsRxHr", schemaVersion: "2.0.1" },
  ],
  "inverse-finance": [
    { slug: "inverse-finance-ethereum", network: "MAINNET", subgraphId: "EXuutY6qkZbXjYeJZdiDBf2imJswTNdfm8YZCqhAthfW", schemaVersion: "1.3.0" },
  ],
  "iron-bank": [
    { slug: "iron-bank-ethereum", network: "MAINNET", subgraphId: "5YoxED3bbWV9byvn3x3S3ebZ3idrQmQmsJhL5LMyY26v", schemaVersion: "2.0.1" },
    { slug: "iron-bank-fantom", network: "FANTOM", subgraphId: "4dWx6UZNcLEzgtipy45VkgtptYRqoHdZeCGNKxHAxKWo", schemaVersion: "2.0.1" },
    { slug: "iron-bank-avalanche", network: "AVALANCHE", subgraphId: "9YiJM9oHy25estSJjB1Z71Hdz5C814R3vDoS2ezpN27C", schemaVersion: "2.0.1" },
    { slug: "iron-bank-optimism", network: "OPTIMISM", subgraphId: "4WKePP5QfwrW6Hfd8YKWHuivivmdxPubuP45BryeGo4g", schemaVersion: "2.0.1" },
  ],
  // kinza-finance omitted: no allocations on The Graph network
  "liquity": [
    { slug: "liquity-ethereum", network: "MAINNET", subgraphId: "2D2dFCLjUt3MfFgTKW8cBxiRQ3Adss7KUtYh2rTcFVY", schemaVersion: "2.0.1" },
  ],
  "makerdao": [
    { slug: "makerdao-ethereum", network: "MAINNET", subgraphId: "8sE6rTNkPhzZXZC6c8UQy2ghFTu5PPdGauwUBm4t7HZ1", schemaVersion: "2.0.1" },
  ],
  "maple-finance-v1": [
    { slug: "maple-finance-v1-ethereum", network: "MAINNET", subgraphId: "J9dtvE11PWNZH74frWyx9QZonyC1Db2UWDMUegmT3zkG", schemaVersion: "1.3.0" },
  ],
  "maple-finance-v2": [
    { slug: "maple-finance-v2-ethereum", network: "MAINNET", subgraphId: "94swSaaFChsQoZzb9Vc7Lo6FWFV6YZUMNSdFVTMAeRgj", schemaVersion: "3.0.1" },
  ],
  "moonwell": [
    { slug: "moonwell-moonbeam", network: "MOONBEAM", subgraphId: "DQhrdUHwspQf3hSjDtyfS6uqq9YiKoLF3Ut3U9os2HK", schemaVersion: "2.0.1" },
    { slug: "moonwell-moonriver", network: "MOONRIVER", subgraphId: "8ayELti1UNCNCWuvwSwapjh4mvvCejeXsk4PmsWBmQ82", schemaVersion: "2.0.1" },
    { slug: "moonwell-base", network: "BASE", subgraphId: "33ex1ExmYQtwGVwri1AP3oMFPGSce6YbocBP7fWbsBrg", schemaVersion: "2.0.1" },
  ],
  "morpho-aave-v2": [
    { slug: "morpho-aave-v2-ethereum", network: "MAINNET", subgraphId: "DsznTYxGdsqxWB6a474rSksvB7qWSth5Ff1PcxW28vZy", schemaVersion: "3.0.1" },
  ],
  "morpho-aave-v3": [
    { slug: "morpho-aave-v3-ethereum", network: "MAINNET", subgraphId: "FKe6ANnWmGPE6hajGLoTgPrVF2jYPHiRu2Jwcg9ZmG9A", schemaVersion: "3.0.1" },
  ],
  "morpho-compound": [
    { slug: "morpho-compound-ethereum", network: "MAINNET", subgraphId: "9dTy23tkahyiap1THgwnJuMwxNHVnQM57jFQQiUzjcY6", schemaVersion: "3.0.1" },
  ],
  "notional-finance": [
    { slug: "notional-finance-ethereum", network: "MAINNET", subgraphId: "2t4T7bts8ZQCpGcVq9VSzDyPVCQc5Y7TFwZKfmXKeSVx", schemaVersion: "2.0.1" },
  ],
  "pac-finance": [
    { slug: "pac-finance-blast", network: "BLAST", subgraphId: "ERsfyKMQTpTEN6LtyWvFwhDENLf6aAAggbtrNEnFKLpx", schemaVersion: "3.1.0" },
  ],
  "qidao": [
    { slug: "qidao-polygon", network: "MATIC", subgraphId: "5UxEcMvYW4vVYP81tkPQMAvJv1e4m1xU8BJkDXBnpc6x", schemaVersion: "1.3.0" },
    { slug: "qidao-arbitrum", network: "ARBITRUM_ONE", subgraphId: "Duw2tSACo9uRGFctAGsCc9pF7ZGMyqpjkAHPwm49dZe6", schemaVersion: "1.3.0" },
    { slug: "qidao-avalanche", network: "AVALANCHE", subgraphId: "98GG74FxxsG25Ltd8qvJ9BRfFmQWyN1AkS92MZBG1BsR", schemaVersion: "1.3.0" },
    { slug: "qidao-base", network: "BASE", subgraphId: "9NHJ9k31qaGCYXppm9isJTiEoiB6v3tJDnR6SrQrxcjw", schemaVersion: "1.3.0" },
    { slug: "qidao-bsc", network: "BSC", subgraphId: "4DcztqYL7UG5bjdisWWvnj3m4NtK5J3bs89scihAkicr", schemaVersion: "1.3.0" },
    { slug: "qidao-ethereum", network: "MAINNET", subgraphId: "BmQSQaXsivq866kUobQSbyxycjk3D7CiaczKgu3P9ifB", schemaVersion: "1.3.0" },
    { slug: "qidao-fantom", network: "FANTOM", subgraphId: "hf51jYbZ9uESiuBabfxf6fRdc22xtmNWX9c3SRrct2q", schemaVersion: "1.3.0" },
    { slug: "qidao-moonriver", network: "MOONRIVER", subgraphId: "HzDP5zXKyjnEJP9TnFirk3qA24SUp4AfzKUBSRcBekgz", schemaVersion: "1.3.0" },
    { slug: "qidao-optimism", network: "OPTIMISM", subgraphId: "4JbWxzxBNCpAaVz72Gt2UthgiwcWZQLKDBhmSE7wKY2K", schemaVersion: "1.3.0" },
    { slug: "qidao-gnosis", network: "GNOSIS", subgraphId: "7vJEsy8pJmRQZQh5kTXNz68SRHXBS859hMq3o5uWF1Ac", schemaVersion: "1.3.1" },
    { slug: "qidao-harmony", network: "HARMONY", subgraphId: "DCEQvXCiqtpMybQLL4YAgdCzqHzRH6wFFnCDnnLBBuvf", schemaVersion: "1.3.0" },
  ],
  "radiant": [
    { slug: "radiant-capital-arbitrum", network: "ARBITRUM_ONE", subgraphId: "5HTkKJNSm72tUGakwj8yroDGHxc6fBhmLaA5oJepZGL3", schemaVersion: "3.1.0" },
  ],
  "rari-fuse": [
    { slug: "rari-fuse-ethereum", network: "MAINNET", subgraphId: "kecp6SPMvbB4GTqg9r5PXvztYriexj5F3ZCaATpjmb2", schemaVersion: "2.0.1" },
    { slug: "rari-fuse-arbitrum", network: "ARBITRUM_ONE", subgraphId: "HnV3fhwsWfmQGdD2AeGzqvRVTDBqnMH74jCsDVq1DXYP", schemaVersion: "2.0.1" },
  ],
  "scream": [
    { slug: "scream-fantom", network: "FANTOM", subgraphId: "Cj3pDoqHgLBntkaXAKMxtJTZr3StxYvVEedTXyJGJoK4", schemaVersion: "2.0.1" },
  ],
  "seamless-protocol": [
    { slug: "seamless-protocol-base", network: "BASE", subgraphId: "2u4mWUV4xS19ef1MbnxZHWLLMwdPxtVifH46JbonXwXP", schemaVersion: "3.1.0" },
  ],
  "seismic": [
    { slug: "seismic-blast", network: "BLAST", subgraphId: "d7gMk1zkEyCQuNVeirBYA6keCZv8hTLheCZ4DBCjRfz", schemaVersion: "3.1.0" },
  ],
  "sonne-finance": [
    { slug: "sonne-finance-optimism", network: "OPTIMISM", subgraphId: "DQqb7FiQ1joLhESkAwvAYiuXhwfz4zf6qHmbt7stnec8", schemaVersion: "2.0.1" },
  ],
  "spark-lend": [
    { slug: "spark-lend-ethereum", network: "MAINNET", subgraphId: "GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si", schemaVersion: "3.1.0" },
    { slug: "spark-lend-gnosis", network: "GNOSIS", subgraphId: "Bw4RH37UbbGEhHo4FaWwT1dn9QJzm1XSZCyK1cbr6ZKM", schemaVersion: "3.1.0" },
  ],
  // superlend omitted: not a Messari lending schema (no lendingProtocols entity)
  "truefi": [
    { slug: "truefi-ethereum", network: "MAINNET", subgraphId: "39F8fYCvLYmutjqpzEwx3dcEJTtFFVupvBzJqkEzftA7", schemaVersion: "2.0.1" },
  ],
  "uwu-lend": [
    { slug: "uwu-lend-ethereum", network: "MAINNET", subgraphId: "CZBD7e8VGvNa6WkBHZAaC688bsZ35UvAM1AuDdVng2aE", schemaVersion: "3.1.0" },
  ],
  "venus": [
    { slug: "venus-protocol-bsc", network: "BSC", subgraphId: "CwswJ7sfENafqgAYU1upn3hQgoEV2CXXRZRJ7XtgJrKG", schemaVersion: "2.0.1" },
  ],
  "vesta-finance": [
    { slug: "vesta-finance-arbitrum", network: "ARBITRUM_ONE", subgraphId: "zGuPrsVqtY5ehJDCmweb9ZnBrae3tSQWRux8Mz1M4Gn", schemaVersion: "2.0.1" },
  ],
  "zerolend": [
    { slug: "zerolend-ethereum", network: "MAINNET", subgraphId: "4Zf4doH54RDit9KVsfCp3MkjrP3szhJZwvw2z5PHczx9", schemaVersion: "3.1.0" },
    { slug: "zerolend-blast", network: "BLAST", subgraphId: "6JP9542ArawumBSYczerbWGu6k7uu3hqk6qJnSkrgTM5", schemaVersion: "3.1.0" },
    { slug: "zerolend-zksync-era", network: "ZKSYNC_ERA", subgraphId: "3CHaJvCkTMqXa4PRKNshVecE9JqgNFCdsXNyGLZXFeM2", schemaVersion: "3.1.0" },
    { slug: "zerolend-linea", network: "LINEA", subgraphId: "DLzwo1WFaKy7R7MgQWrnBXr19EbGwPRubu9YmsSmRMfC", schemaVersion: "3.1.0" },
    // zerolend-xlayer omitted: no allocations on The Graph network
  ],
};

export function lookup(protocol: string, network?: string): SubgraphEntry[] {
  const entries = REGISTRY[protocol];
  if (!entries) throw new Error(`Unknown protocol: ${protocol}. Available: ${Object.keys(REGISTRY).join(", ")}`);
  if (network) {
    const normalized = network.toUpperCase().replace(/-/g, "_");
    const filtered = entries.filter(e => e.network === normalized);
    if (filtered.length === 0) {
      throw new Error(`No deployment for ${protocol} on ${network}. Available: ${entries.map(e => e.network).join(", ")}`);
    }
    return filtered;
  }
  return entries;
}

export function allProtocols(): string[] {
  return Object.keys(REGISTRY);
}

export function allEntries(): { protocol: string; entry: SubgraphEntry }[] {
  return Object.entries(REGISTRY).flatMap(([protocol, entries]) =>
    entries.map(entry => ({ protocol, entry }))
  );
}

/** Check if schema version is >= a minimum (e.g. "3.0.0") */
export function schemaAtLeast(entry: SubgraphEntry, minVersion: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const cur = parse(entry.schemaVersion);
  const min = parse(minVersion);
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return true;
    if ((cur[i] ?? 0) < (min[i] ?? 0)) return false;
  }
  return true;
}

// --- Float provenance note (added 2026-09-13) ---
// Source: PaulieB14/graph-lending-mcp src/registry.ts (auto-generated from
// messari/subgraphs deployment.json, lending schema only). 92 entries.
// These are SUBGRAPH IDs for the gateway route /subgraphs/id/{id}.
// Float's provenance rule: at startup, resolve each subgraph ID to its CURRENT
// deployment ID (Qm...), pin it in deployments.lock.json, and stamp every tool
// response with the deployment ID it was served from. Re-pin is an explicit,
// logged operation, never automatic.
