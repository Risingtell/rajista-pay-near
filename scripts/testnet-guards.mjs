// Checks the entry-point guards on testnet: each call below must be refused by the contract.
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import { readFileSync } from "node:fs";
const ROOT = "rajistapay-demo.testnet", PAY = `pay.${ROOT}`, SHOP = `shop.${ROOT}`;
const key = JSON.parse(readFileSync(`.keys/${ROOT}.json`, "utf8")).private_key;
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const as = id => new Account(id, provider, key);
const cases = [
  ["deposit on a non-payable method", SHOP, "void_invoice", { id: "x" }, 1n, "does not accept a deposit"],
  ["outsider calls the private callback", SHOP, "after_withdraw", { shop: SHOP, amount: "1000000" }, 0n, "this method is private"],
  ["second init", PAY, "new", { usdc: SHOP, router: null }, 0n, "already initialized"],
  ["malformed JSON", SHOP, "void_invoice", "{\"id\":", 0n, "invalid JSON arguments"],
  ["missing argument", SHOP, "create_invoice", { id: "G-1" }, 10n ** 22n, "missing or invalid argument: amount"],
  ["bad base64 hash", SHOP, "create_invoice", { id: "G-2", amount: "1", due_in_ms: "0", items_hash: "@@@@", note: "" }, 10n ** 22n, "invalid base64"],
  ["withdraw without 1 yocto", SHOP, "withdraw", { amount: null }, 0n, "exactly 1 yoctoNEAR"],
];
let failed = 0;
for (const [name, signer, methodName, args, deposit, expect] of cases) {
  const raw = typeof args === "string" ? new TextEncoder().encode(args) : args;
  let msg = "";
  try {
    const r = await as(signer).callFunctionRaw({ contractId: PAY, methodName, args: raw, deposit, gas: teraToGas(30) });
    msg = JSON.stringify(r.status);
  } catch (e) {
    msg = String(e.message ?? e);
  }
  const ok = msg.includes(expect);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : `→ ${msg.slice(0, 200)}`);
}
const views = await Promise.all([
  provider.callFunction({ contractId: PAY, method: "get_config", args: {} }),
  provider.callFunction({ contractId: PAY, method: "get_shop_invoices", args: { shop: SHOP, from_index: 0, limit: 1 } }),
  provider.callFunction({ contractId: PAY, method: "get_shop_invoice_count", args: { shop: SHOP } }),
]);
console.log("get_config:", JSON.stringify(views[0]));
console.log("first invoice:", JSON.stringify(views[1][0]));
console.log("count:", views[2]);
process.exit(failed ? 1 : 0);
