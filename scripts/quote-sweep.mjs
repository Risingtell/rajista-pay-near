// Dry-quotes every pay option against the live contract with the server's own placeholder refund
// addresses, so a route that NEAR Intents rejects shows up here and not in front of a customer.
//   node scripts/quote-sweep.mjs [usdc]
import { NETWORKS, PAY_OPTIONS } from "../app/src/config.js";
import { refundPlaceholder } from "../worker/placeholder.js";
const n = NETWORKS.mainnet;
const amount = String(Math.round(Number(process.argv[2] ?? "1") * 1e6));
for (const o of PAY_OPTIONS) {
  const body = {
    dry: true, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: o.asset, depositType: "ORIGIN_CHAIN",
    destinationAsset: n.usdcAsset, amount, refundTo: refundPlaceholder(o.chain), refundType: "ORIGIN_CHAIN",
    recipient: n.contract, recipientType: "DESTINATION_CHAIN", customRecipientMsg: "SWEEP-1",
    deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
  };
  const r = await fetch("https://1click.chaindefuser.com/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  console.log(`${(o.symbol + " " + o.name).padEnd(16)} ${j.quote ? `OK  send ${j.quote.amountInFormatted}` : `NO  ${j.message}`}`);
}
