// Deploys mock USDC + Rajista Pay to NEAR testnet and runs the full invoice flow,
// including every rejection path. Writes a public proof (no keys) to docs/testnet-run.md.
//   node scripts/testnet-e2e.mjs
import { Account, JsonRpcProvider, nearToYocto, teraToGas } from "near-api-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const ROOT = "rajistapay-demo.testnet";
const RPC = "https://rpc.testnet.near.org";
const EXPLORER = "https://testnet.nearblocks.io/txns/";
const key = JSON.parse(readFileSync(`.keys/${ROOT}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: RPC });
const acct = id => new Account(id, provider, key.private_key);

const USDC = `usdc.${ROOT}`, PAY = `pay.${ROOT}`, SHOP = `shop.${ROOT}`, CUSTOMER = `customer.${ROOT}`;
const usd = n => String(Math.round(n * 1e6)); // 6 decimals
const fmt = s => (Number(s) / 1e6).toFixed(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];

async function exists(id) {
  try { await provider.viewAccount({ accountId: id }); return true; } catch { return false; }
}
function events(res) {
  return res.receipts_outcome.flatMap(r => r.outcome.logs)
    .filter(l => l.startsWith("EVENT_JSON:"))
    .map(l => JSON.parse(l.slice(11)))
    .filter(e => e.standard === "rajista_pay")
    .map(e => `${e.event} ${JSON.stringify(e.data[0] ?? e.data)}`);
}
async function call(signer, contractId, methodName, args, { deposit = "0", gas = teraToGas(100), label } = {}) {
  const res = await acct(signer).callFunctionRaw({ contractId, methodName, args, deposit, gas });
  const hash = res.transaction.hash ?? res.transaction_outcome.id;
  const ev = events(res);
  steps.push({ label: label ?? `${signer.split(".")[0]} → ${methodName}`, hash, ev });
  console.log(`✓ ${label ?? methodName}  ${EXPLORER}${hash}`);
  ev.forEach(e => console.log("    ", e));
  return res;
}
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const bal = id => view(USDC, "ft_balance_of", { account_id: id });

// 1. Accounts and contracts (idempotent).
const root = acct(ROOT);
for (const [id, near] of [[USDC, "2.2"], [PAY, "2.8"], [SHOP, "0.6"], [CUSTOMER, "0.6"]]) {
  if (await exists(id)) { console.log("exists", id); continue; }
  await root.createSubAccount({ accountOrPrefix: id, publicKey: key.public_key, nearToTransfer: nearToYocto(near) });
  console.log("created", id);
}
if (!(await view(USDC, "ft_total_supply").catch(() => null))) {
  await acct(USDC).deployContract(readFileSync("res/mock_usdc.wasm"));
  await call(USDC, USDC, "new", {}, { label: "deploy + init test USDC" });
}
if (!(await view(PAY, "get_usdc").catch(() => null))) {
  await acct(PAY).deployContract(readFileSync("res/rajista_pay.wasm"));
  await call(PAY, PAY, "new", { usdc: USDC }, { label: "deploy + init Rajista Pay" });
}
for (const id of [PAY, SHOP]) {
  if (!(await view(USDC, "storage_balance_of", { account_id: id }))) {
    await call(SHOP, USDC, "storage_deposit", { account_id: id, registration_only: true },
      { deposit: nearToYocto("0.01"), label: `register ${id.split(".")[0]} on test USDC` });
  }
}
await call(CUSTOMER, USDC, "mint", { amount: usd(60) }, { label: "customer mints 60 test USDC" });

// 2. The shop issues an invoice for N20,000 of goods = 12.50 USDC.
const run = Date.now().toString(36);
const items = [{ name: "Wireless mouse", qty: 1, naira: 8000 }, { name: "USB-C cable 1m", qty: 2, naira: 6000 }];
const itemsHash = createHash("sha256").update(JSON.stringify(items)).digest("base64");
const INV = `KANO-${run}-1`;
await call(SHOP, PAY, "create_invoice",
  { id: INV, amount: usd(12.5), due_ms: String(Date.now() + 3600_000), items_hash: itemsHash, note: "N20,000 at N1,600/USDC" },
  { deposit: nearToYocto("0.01"), label: `shop issues ${INV} for 12.50 USDC` });

const ftPay = (id, amount, label) => call(CUSTOMER, USDC, "ft_transfer_call",
  { receiver_id: PAY, amount: usd(amount), msg: id }, { deposit: "1", gas: teraToGas(150), label });

const c0 = await bal(CUSTOMER);
await ftPay(INV, 10, "customer underpays 10.00 → refunded");
const c1 = await bal(CUSTOMER);
await ftPay(INV, 13, "customer pays 13.00 → invoice paid, 0.50 change returned");
const c2 = await bal(CUSTOMER);
await ftPay(INV, 12.5, "customer pays the same invoice again → refunded");
await ftPay(`KANO-${run}-nope`, 5, "payment to an unknown invoice → refunded");

const VOID = `KANO-${run}-2`;
await call(SHOP, PAY, "create_invoice", { id: VOID, amount: usd(3), due_ms: "0", items_hash: itemsHash, note: "" },
  { deposit: nearToYocto("0.01"), label: `shop issues ${VOID}` });
await call(SHOP, PAY, "void_invoice", { id: VOID }, { label: `shop voids ${VOID}` });
await ftPay(VOID, 3, "payment to a voided invoice → refunded");

const EXP = `KANO-${run}-3`;
await call(SHOP, PAY, "create_invoice", { id: EXP, amount: usd(2), due_ms: String(Date.now() + 15_000), items_hash: itemsHash, note: "" },
  { deposit: nearToYocto("0.01"), label: `shop issues ${EXP}, due in 15 s` });
await sleep(20_000);
await ftPay(EXP, 2, "payment after the due time → refunded");
const c3 = await bal(CUSTOMER);

const shopBefore = await bal(SHOP);
const credited = await view(PAY, "get_balance", { shop: SHOP });
await call(SHOP, PAY, "withdraw", { amount: null }, { deposit: "1", gas: teraToGas(60), label: "shop withdraws its USDC" });
const shopAfter = await bal(SHOP);
const inv = await view(PAY, "get_invoice", { id: INV });

// 3. Assertions: the only money that moved is exactly one 12.50 payment.
const checks = [
  ["underpayment fully refunded", c1 === c0],
  ["paid exactly 12.50 (13.00 sent, 0.50 returned)", BigInt(c1) - BigInt(c2) === BigInt(usd(12.5))],
  ["all rejected payments refunded", c3 === c2],
  ["invoice is Paid by the customer", inv.status === "Paid" && inv.payer === CUSTOMER],
  ["shop was credited 12.50 in the contract", BigInt(credited) >= BigInt(usd(12.5))],
  ["shop received the USDC on withdraw", BigInt(shopAfter) - BigInt(shopBefore) === BigInt(credited)],
  ["contract shop balance is zero after withdraw", (await view(PAY, "get_balance", { shop: SHOP })) === "0"],
];
checks.forEach(([n, ok]) => console.log(ok ? "PASS" : "FAIL", n));
const failed = checks.filter(c => !c[1]).length;

mkdirSync("docs", { recursive: true });
const md = [
  "# Testnet run", "",
  `Run on ${new Date().toISOString()} by \`scripts/testnet-e2e.mjs\`. Every line links to the transaction on NearBlocks.`, "",
  `- Rajista Pay contract: \`${PAY}\``, `- Test USDC (6 decimals): \`${USDC}\``, `- Shop: \`${SHOP}\`, customer: \`${CUSTOMER}\``, "",
  "| Step | Transaction | Events |", "|---|---|---|",
  ...steps.map(s => `| ${s.label} | [${s.hash.slice(0, 8)}…](${EXPLORER}${s.hash}) | ${s.ev.map(e => "`" + e.replace(/\|/g, "\\|") + "`").join("<br>")} |`),
  "", "## Checks", "",
  ...checks.map(([n, ok]) => `- ${ok ? "PASS" : "FAIL"}: ${n}`), "",
  `Customer balance: ${fmt(c0)} before, ${fmt(c3)} after (one 12.50 payment). Shop received ${fmt(credited)} USDC.`, "",
];
writeFileSync("docs/testnet-run.md", md.join("\n"));
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed", "→ docs/testnet-run.md");
process.exit(failed ? 1 : 0);
