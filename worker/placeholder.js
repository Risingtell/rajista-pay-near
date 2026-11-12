// Dry quotes need a refund address that NEAR Intents accepts; nothing is ever sent to it.
// Burn-style addresses such as 0x...dEaD are rejected, so these are neutral, valid-looking ones.
// scripts/quote-sweep.mjs checks every pay option with them.
export function refundPlaceholder(chain) {
  return {
    sol: "So11111111111111111111111111111111111111112",
    tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    near: "intents.near",
  }[chain] ?? "0x1111111111111111111111111111111111111111";
}
