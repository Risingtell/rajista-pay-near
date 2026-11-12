#!/usr/bin/env node
// Re-checks every mainnet claim in the README straight from a public NEAR RPC, with no explorer
// and no key. Exit code 0 only if every check passes.
//   npm run verify
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const RPC = "https://rpc.mainnet.fastnear.com";
const CONTRACT = "rajistapay.near";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SHOP = "risingtell.near";
const INVOICE = "RISINGTE-MWDBSJXB3U2";
const DELIVERY_TX = "Afo9C89HutErBxJgqU4N9NrhMqEAV5BZLnxNSFddqzWE"; // signed by intents.near
const WITHDRAW_TX = "5YcSu3tjYWPHKmKuPuBcE6p7p1GtU9EmBW3Pp3XmDT9b"; // signed by the shop

let failed = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then(r => r.json());
  if (r.error) throw new Error(JSON.stringify(r.error).slice(0, 200));
  return r.result;
}
const view = async (account_id, method_name, args = {}) => {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
};
const tx = (hash, sender) => rpc("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
const calls = t => t.receipts.flatMap(rc => (rc.receipt.Action?.actions ?? []).filter(a => a.FunctionCall).map(a => ({
  from: rc.predecessor_id, to: rc.receiver_id, method: a.FunctionCall.method_name,
  args: JSON.parse(Buffer.from(a.FunctionCall.args, "base64").toString() || "{}"),
})));
const events = t => t.receipts_outcome.flatMap(o => o.outcome.logs).filter(l => l.startsWith("EVENT_JSON:")).map(l => JSON.parse(l.slice(11)));
const b58 = buf => {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let x = BigInt("0x" + buf.toString("hex")), s = "";
  while (x > 0n) { s = A[Number(x % 58n)] + s; x /= 58n; }
  return s;
};

// 1. The contract: this repo's code, locked, configured for real USDC and NEAR Intents.
const acct = await rpc("query", { request_type: "view_account", finality: "final", account_id: CONTRACT });
const local = b58(createHash("sha256").update(readFileSync(new URL("../res/rajista_pay.wasm", import.meta.url))).digest());
check(acct.code_hash === local, "code on rajistapay.near is res/rajista_pay.wasm from this repo", acct.code_hash);
const keys = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: CONTRACT });
check(keys.keys.length === 0, "the contract account has no access keys, so its code can never change");
const cfg = await view(CONTRACT, "get_config");
check(cfg.usdc === USDC && cfg.router === "intents.near" && cfg.owner === SHOP, "configured for native USDC and intents.near", `owner ${cfg.owner}`);

// 2. The sale: an invoice paid through NEAR Intents.
const inv = await view(CONTRACT, "get_invoice", { id: INVOICE });
check(inv?.status === "Paid" && inv.payer === "intents.near" && inv.amount === "850000" && inv.shop === SHOP && !inv.late && inv.extra === "0", "invoice paid in full through NEAR Intents, not late, nothing held", `${INVOICE}: ${inv?.status}, 0.85 USDC`);
const delivery = await tx(DELIVERY_TX, "intents.near");
const onTransfer = calls(delivery).find(c => c.method === "ft_on_transfer" && c.to === CONTRACT);
check(onTransfer?.from === USDC && onTransfer?.args.sender_id === "intents.near" && onTransfer?.args.msg === INVOICE && onTransfer?.args.amount === "850000", "USDC arrived from intents.near carrying the invoice id", DELIVERY_TX);
check(events(delivery).some(e => e.standard === "rajista_pay" && e.event === "invoice_paid" && e.data[0].id === INVOICE), "the contract emitted invoice_paid");

// 3. The shop withdrew.
const wd = await tx(WITHDRAW_TX, SHOP);
const out = calls(wd).find(c => c.method === "ft_transfer" && c.to === USDC);
check(out?.from === CONTRACT && out?.args.receiver_id === SHOP && out?.args.amount === "850000", "0.85 USDC sent from the contract to the shop", WITHDRAW_TX);
check(events(wd).some(e => e.event === "withdrawn"), "the contract emitted withdrawn");
check((await view(CONTRACT, "get_balance", { shop: SHOP })) === "0", "nothing left owed to the shop in the contract");

// 4. The live app reads the same invoice.
const receipt = await fetch(`https://rajista-pay.rajista.workers.dev/api/receipts?net=mainnet&ids=${INVOICE}`).then(r => r.json());
const items = receipt[INVOICE];
check(Boolean(items) && Buffer.from(createHash("sha256").update(items).digest()).toString("base64") === inv.items_hash, "the item list served by the app hashes to the invoice's items_hash", "1 x Kuli Kuli, N1,140");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
