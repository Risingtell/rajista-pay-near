// Deploys test USDC + Rajista Pay to NEAR testnet and runs every money path: direct wallet
// payments (refunded when wrong), router payments the way NEAR Intents delivers them (never sent
// back, held for the shop instead), a till key issuing invoices with no wallet prompt, and withdraw.
// Writes a public proof (no keys) to docs/testnet-run.md.
//   node scripts/testnet-e2e.mjs [--fresh]     --fresh redeploys the invoice contract from res/
import { Account, JsonRpcProvider, KeyPair, nearToYocto, teraToGas } from "near-api-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const ROOT = "rajistapay-demo.testnet";
const EXPLORER = "https://testnet.nearblocks.io/txns/";
const key = JSON.parse(readFileSync(`.keys/${ROOT}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const acct = (id, k = key.private_key) => new Account(id, provider, k);

const USDC = `usdc.${ROOT}`, PAY = `pay.${ROOT}`, SHOP = `shop.${ROOT}`, CUSTOMER = `customer.${ROOT}`;
// Stands in for intents.near: on mainnet the Intents contract is the sender of the USDC transfer.
const ROUTER = `router.${ROOT}`;
const usd = n => String(Math.round(n * 1e6));
const fmt = s => (Number(s) / 1e6).toFixed(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = [];

const exists = id => provider.viewAccount({ accountId: id }).then(() => true, () => false);
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const bal = id => view(USDC, "ft_balance_of", { account_id: id });

function events(res) {
  return res.receipts_outcome.flatMap(r => r.outcome.logs)
    .filter(l => l.startsWith("EVENT_JSON:")).map(l => JSON.parse(l.slice(11)))
    .filter(e => e.standard === "rajista_pay").map(e => `${e.event} ${JSON.stringify(e.data[0])}`);
}
function record(label, res) {
  const hash = res.transaction.hash;
  const ev = events(res);
  steps.push({ label, hash, ev });
  console.log(`✓ ${label}  ${EXPLORER}${hash}`);
  ev.forEach(e => console.log("    ", e));
  return res;
}
async function call(signer, contractId, methodName, args, { deposit = "0", gas = teraToGas(100), label, as } = {}) {
  const res = await (as ?? acct(signer)).callFunctionRaw({ contractId, methodName, args, deposit, gas });
  return record(label ?? `${signer.split(".")[0]} → ${methodName}`, res);
}

// 1. Accounts and contracts.
const root = acct(ROOT);
const fresh = process.argv.includes("--fresh");
if (fresh && (await exists(PAY))) {
  await acct(PAY).deleteAccount(ROOT); // returns its NEAR to the root account
  console.log("deleted old", PAY);
}
for (const [id, near] of [[USDC, "2.2"], [PAY, "2.6"], [SHOP, "0.6"], [CUSTOMER, "0.3"], [ROUTER, "0.3"]]) {
  if (await exists(id)) continue;
  await root.createSubAccount({ accountOrPrefix: id, publicKey: key.public_key, nearToTransfer: nearToYocto(near) });
  console.log("created", id);
}
if (!(await view(USDC, "ft_total_supply").catch(() => null))) {
  await acct(USDC).deployContract(readFileSync("res/mock_usdc.wasm"));
  await call(USDC, USDC, "new", {}, { label: "deploy + init test USDC" });
}
if (!(await view(PAY, "get_config").catch(() => null))) {
  record("deploy Rajista Pay", await acct(PAY).deployContract(readFileSync("res/rajista_pay.wasm")));
  await call(PAY, PAY, "new", { usdc: USDC, router: ROUTER }, { label: "init Rajista Pay (router = stand-in for intents.near)" });
}
for (const id of [PAY, SHOP]) {
  if (!(await view(USDC, "storage_balance_of", { account_id: id }))) {
    await call(SHOP, USDC, "storage_deposit", { account_id: id, registration_only: true },
      { deposit: nearToYocto("0.01"), label: `register ${id.split(".")[0]} on test USDC` });
  }
}
await call(CUSTOMER, USDC, "mint", { amount: usd(40) }, { label: "customer mints 40 test USDC" });
await call(ROUTER, USDC, "mint", { amount: usd(40) }, { label: "router mints 40 test USDC" });

// 2. Till key: the shop's wallet signs once, then the till issues invoices without prompts.
await call(SHOP, PAY, "storage_deposit", {}, { deposit: nearToYocto("0.05"), label: "shop prepays 0.05 NEAR of invoice storage" });
const till = KeyPair.fromRandom("ed25519");
record("shop adds a till key (create/void invoices only)", await acct(SHOP).addFunctionCallAccessKey({
  publicKey: till.getPublicKey().toString(), contractId: PAY, methodNames: ["create_invoice", "void_invoice"], allowance: nearToYocto("0.25"),
}));
const tillAcct = acct(SHOP, till.toString());

const run = Date.now().toString(36);
const items = [{ name: "Wireless mouse", qty: 1, naira: 8000 }, { name: "USB-C cable 1m", qty: 2, naira: 6000 }];
const itemsHash = createHash("sha256").update(JSON.stringify(items)).digest("base64");
const issue = (id, amount, dueMs, label) => call(SHOP, PAY, "create_invoice",
  { id, amount: usd(amount), due_ms: String(dueMs), items_hash: itemsHash, note: "N20,000 at N1,600/USDC" },
  { as: tillAcct, label });

// 3. Direct payments from a NEAR wallet: wrong payments are refunded.
const ftPay = (from, id, amount, label) => call(from, USDC, "ft_transfer_call",
  { receiver_id: PAY, amount: usd(amount), msg: id }, { deposit: "1", gas: teraToGas(150), label });

const A = `KANO-${run}-A`;
await issue(A, 12.5, Date.now() + 3600_000, `till issues ${A}: 12.50 USDC, no wallet prompt`);
const c0 = await bal(CUSTOMER);
await ftPay(CUSTOMER, A, 10, "wallet pays 10.00 (short) → refunded");
const c1 = await bal(CUSTOMER);
await ftPay(CUSTOMER, A, 13, "wallet pays 13.00 → paid, 0.50 change returned");
const c2 = await bal(CUSTOMER);
await ftPay(CUSTOMER, A, 12.5, "wallet pays the same invoice again → refunded");
await ftPay(CUSTOMER, `KANO-${run}-nope`, 5, "wallet pays an unknown invoice → refunded");
const V = `KANO-${run}-V`;
await issue(V, 3, 0, `till issues ${V}`);
await call(SHOP, PAY, "void_invoice", { id: V }, { as: tillAcct, label: `till voids ${V}` });
await ftPay(CUSTOMER, V, 3, "wallet pays the voided invoice → refunded");
const E = `KANO-${run}-E`;
await issue(E, 2, Date.now() + 15_000, `till issues ${E}, due in 15 s`);
await sleep(20_000);
await ftPay(CUSTOMER, E, 2, "wallet pays after the due time → refunded");
const c3 = await bal(CUSTOMER);

// 4. Router payments (how NEAR Intents 1Click delivers with customRecipientMsg): never sent back.
const B = `KANO-${run}-B`;
await issue(B, 7.25, Date.now() + 3600_000, `till issues ${B}: 7.25 USDC`);
const r0 = await bal(ROUTER);
await ftPay(ROUTER, B, 7.25, "router delivers 7.25 → paid");
await ftPay(ROUTER, B, 7.25, "router delivers 7.25 again → held for the shop as extra");
const L = `KANO-${run}-L`;
await issue(L, 1, Date.now() + 15_000, `till issues ${L}, due in 15 s`);
await sleep(20_000);
await ftPay(ROUTER, L, 1, "router delivers after the due time → paid, marked late");
await ftPay(ROUTER, `KANO-${run}-ghost`, 0.5, "router delivers to an id that never existed → unclaimed");
const r1 = await bal(ROUTER);
await call(PAY, PAY, "return_unclaimed", { receiver_id: ROUTER, amount: usd(0.5), reason: "demo: payer proved origin tx" },
  { deposit: "1", gas: teraToGas(60), label: "owner returns the unclaimed 0.50" });
const r2 = await bal(ROUTER);

// 5. Shop withdraws everything.
const credited = await view(PAY, "get_balance", { shop: SHOP });
const shopBefore = await bal(SHOP);
await call(SHOP, PAY, "withdraw", { amount: null }, { deposit: "1", gas: teraToGas(60), label: "shop withdraws its USDC" });
const shopAfter = await bal(SHOP);

const inv = id => view(PAY, "get_invoice", { id });
const [a, b, l, v] = await Promise.all([inv(A), inv(B), inv(L), inv(V)]);
const cfg = await view(PAY, "get_config");
const checks = [
  ["till key issued invoices with no NEAR attached", a.status === "Paid"],
  ["wallet: short payment refunded in full", c1 === c0],
  ["wallet: paid exactly 12.50 (13.00 sent, 0.50 returned)", BigInt(c1) - BigInt(c2) === BigInt(usd(12.5))],
  ["wallet: double, unknown, voided and late payments all refunded", c3 === c2],
  ["voided invoice stays void", v.status === "Void"],
  ["router: first payment settled the invoice", b.status === "Paid" && b.payer === ROUTER],
  ["router: second payment held as extra 7.25, not sent back", b.extra === usd(7.25)],
  ["router: late payment settled and marked late", l.status === "Paid" && l.late === true],
  ["router: nothing was ever returned to the router", BigInt(r0) - BigInt(r1) === BigInt(usd(7.25 + 7.25 + 1 + 0.5))],
  ["owner returned exactly the unclaimed 0.50", BigInt(r2) - BigInt(r1) === BigInt(usd(0.5)) && cfg.unclaimed === "0"],
  ["shop credited 12.50 + 7.25 + 7.25 + 1.00 = 28.00", credited === usd(28)],
  ["shop received all of it on withdraw", BigInt(shopAfter) - BigInt(shopBefore) === BigInt(credited)],
];
checks.forEach(([n, ok]) => console.log(ok ? "PASS" : "FAIL", n));
const failed = checks.filter(c => !c[1]).length;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/testnet-run.md", [
  "# Testnet run", "",
  `Run on ${new Date().toISOString()} by \`node scripts/testnet-e2e.mjs\`. Every step links to its transaction on NearBlocks.`, "",
  `- Rajista Pay contract: [\`${PAY}\`](https://testnet.nearblocks.io/address/${PAY})`,
  `- Test USDC (6 decimals): \`${USDC}\``,
  `- Shop \`${SHOP}\`, customer \`${CUSTOMER}\``,
  `- Router \`${ROUTER}\`: plays the part of \`intents.near\`, which is the sender when NEAR Intents 1Click delivers USDC with \`customRecipientMsg\`. NEAR Intents has no testnet, so the real cross-chain payment is on mainnet (see the README).`, "",
  "| Step | Transaction | Contract events |", "|---|---|---|",
  ...steps.map(s => `| ${s.label} | [${s.hash.slice(0, 8)}](${EXPLORER}${s.hash}) | ${s.ev.map(e => "`" + e.replace(/\|/g, "\\|") + "`").join("<br>")} |`),
  "", "## Checks", "",
  ...checks.map(([n, ok]) => `- ${ok ? "PASS" : "FAIL"}: ${n}`), "",
].join("\n"));
console.log(failed ? `${failed} check(s) FAILED` : "all checks passed", "→ docs/testnet-run.md");
process.exit(failed ? 1 : 0);
