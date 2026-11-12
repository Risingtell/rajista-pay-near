// One place for everything that differs between the live network and the free test network.
// The worker imports this file too, so the browser and the server always agree.

export const NETWORKS = {
  mainnet: {
    id: "mainnet",
    label: "Live",
    contract: "pay.risingtell.near",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    usdcAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    router: "intents.near",
    rpc: "https://rpc.mainnet.fastnear.com",
    explorer: "https://nearblocks.io",
    intents: true,
    payPath: "/p/",
  },
  testnet: {
    id: "testnet",
    label: "Test network",
    contract: "pay.rajistapay-demo.testnet",
    usdc: "usdc.rajistapay-demo.testnet",
    usdcAsset: null,
    router: "router.rajistapay-demo.testnet",
    rpc: "https://test.rpc.fastnear.com",
    explorer: "https://testnet.nearblocks.io",
    intents: false,
    payPath: "/t/",
  },
};

export const USDC_DECIMALS = 6;

// Stablecoins a customer can pay with through NEAR Intents 1Click. Chain names as people say them.
export const PAY_OPTIONS = [
  { chain: "sol", name: "Solana", symbol: "USDC", asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" },
  { chain: "sol", name: "Solana", symbol: "USDT", asset: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near" },
  { chain: "base", name: "Base", symbol: "USDC", asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" },
  { chain: "arb", name: "Arbitrum", symbol: "USDC", asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near" },
  { chain: "eth", name: "Ethereum", symbol: "USDC", asset: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near" },
  { chain: "eth", name: "Ethereum", symbol: "USDT", asset: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near" },
  { chain: "tron", name: "Tron", symbol: "USDT", asset: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near" },
  { chain: "bsc", name: "BNB Chain", symbol: "USDT", asset: "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g" },
  { chain: "pol", name: "Polygon", symbol: "USDC", asset: "nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L" },
  { chain: "op", name: "Optimism", symbol: "USDC", asset: "nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ" },
  { chain: "avax", name: "Avalanche", symbol: "USDC", asset: "nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o" },
  { chain: "near", name: "NEAR", symbol: "USDT", asset: "nep141:usdt.tether-token.near" },
];

// Rough address shapes, to catch a pasted wrong-chain address before a quote is made.
export const ADDRESS_PATTERNS = {
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  base: /^0x[0-9a-fA-F]{40}$/,
  arb: /^0x[0-9a-fA-F]{40}$/,
  eth: /^0x[0-9a-fA-F]{40}$/,
  bsc: /^0x[0-9a-fA-F]{40}$/,
  pol: /^0x[0-9a-fA-F]{40}$/,
  op: /^0x[0-9a-fA-F]{40}$/,
  avax: /^0x[0-9a-fA-F]{40}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  near: /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$|^[0-9a-f]{64}$/,
};

export const INVOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function net(id) {
  const n = NETWORKS[id];
  if (!n) throw new Error("unknown network");
  return n;
}

export function toUnits(usd) {
  return String(Math.round(Number(usd) * 10 ** USDC_DECIMALS));
}

export function fromUnits(units) {
  return Number(units) / 10 ** USDC_DECIMALS;
}
