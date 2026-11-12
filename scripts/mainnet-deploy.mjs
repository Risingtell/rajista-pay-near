// Mainnet deployment of the invoice contract to rajistapay.near. The owner's wallet never adds a
// key or deploys code (Meteor rightly blocks both for websites); instead:
//   node scripts/mainnet-deploy.mjs key      make the deploy key (in .keys/, gitignored) and print
//                                            the local setup page link. There the wallet creates
//                                            rajistapay.near through near.create_account.
//   node scripts/mainnet-deploy.mjs deploy   put res/rajista_pay.wasm on it with the deploy key and
//                                            register it with USDC. Then the wallet calls `new` on
//                                            the setup page, which makes the wallet the owner.
//   node scripts/mainnet-deploy.mjs finish   check config and code hash, then delete the deploy key
//                                            so nobody can ever change the contract.
import { Account, JsonRpcProvider, KeyPair, teraToGas } from "near-api-js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NETWORKS } from "../app/src/config.js";

const n = NETWORKS.mainnet;
const WALLET = "risingtell.near";
const FROM = "5cad315374d1dcc49a5d0764e84a1eff4a83288b245c99a937ac5187ff991d10";
const file = `.keys/${n.contract}.json`;
const provider = new JsonRpcProvider({ url: n.rpc });
const rpc = (method, params) => provider.sendJsonRpc(method, params);
const step = process.argv[2];
const b58 = buf => {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let x = BigInt("0x" + buf.toString("hex")), s = "";
  while (x > 0n) { s = A[Number(x % 58n)] + s; x /= 58n; }
  return s;
};
const wasm = readFileSync("res/rajista_pay.wasm");
const localHash = b58(createHash("sha256").update(wasm).digest());
const state = () => rpc("query", { request_type: "view_account", finality: "final", account_id: n.contract });
const near = y => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);

if (step === "key") {
  if (!existsSync(file)) {
    const kp = KeyPair.fromRandom("ed25519");
    mkdirSync(".keys", { recursive: true });
    writeFileSync(file, JSON.stringify({ account_id: n.contract, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }, null, 2));
  }
  const { public_key } = JSON.parse(readFileSync(file, "utf8"));
  console.log(`deploy key: ${public_key}`);
  console.log(`open: http://127.0.0.1:8794/admin?from=${FROM}&pk=${encodeURIComponent(public_key)}&near=0.98`);
} else if (step === "deploy") {
  const { private_key } = JSON.parse(readFileSync(file, "utf8"));
  const acct = new Account(n.contract, provider, private_key);
  const s = await state();
  console.log(`${n.contract}: ${near(s.amount)} NEAR, code ${s.code_hash}`);
  if (s.code_hash !== localHash) {
    const d = await acct.deployContract(wasm);
    console.log(`deployed ${n.explorer}/txns/${d.transaction.hash}`);
  }
  const s2 = await state();
  console.log(`code on chain ${s2.code_hash} ${s2.code_hash === localHash ? "= local build" : "!= local build"}`);
  const reg = await provider.callFunction({ contractId: n.usdc, method: "storage_balance_of", args: { account_id: n.contract } });
  if (!reg) {
    const r = await acct.callFunctionRaw({ contractId: n.usdc, methodName: "storage_deposit", args: { account_id: n.contract, registration_only: true }, deposit: 125n * 10n ** 19n, gas: teraToGas(10) });
    console.log(`registered with USDC ${n.explorer}/txns/${r.transaction.hash}`);
  } else {
    console.log("already registered with USDC");
  }
} else if (step === "finish") {
  const { private_key, public_key } = JSON.parse(readFileSync(file, "utf8"));
  const s = await state();
  const config = await provider.callFunction({ contractId: n.contract, method: "get_config", args: {} });
  const reg = await provider.callFunction({ contractId: n.usdc, method: "storage_balance_of", args: { account_id: n.contract } });
  const checks = [
    ["code is the local build", s.code_hash === localHash],
    [`owner is ${WALLET}`, config.owner === WALLET],
    ["USDC is the real one", config.usdc === n.usdc],
    ["router is intents.near", config.router === n.router],
    ["registered with USDC", Boolean(reg)],
  ];
  checks.forEach(([c, ok]) => console.log(ok ? "PASS" : "FAIL", c));
  if (checks.some(c => !c[1])) process.exit(1);
  const keys = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: n.contract });
  if (keys.keys.some(k => k.public_key === public_key)) {
    const r = await new Account(n.contract, provider, private_key).deleteKey(public_key);
    console.log(`deleted the deploy key ${n.explorer}/txns/${r.transaction.hash}`);
  }
  // The "final" view trails a block or two behind the deletion.
  let after;
  for (let i = 0; i < 15; i++) {
    after = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: n.contract });
    if (after.keys.length === 0) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`keys on ${n.contract}: ${after.keys.length} (locked: ${after.keys.length === 0})`);
  const fin = await state();
  console.log(`balance ${near(fin.amount)} NEAR, storage ${fin.storage_usage} bytes`);
} else {
  console.log("usage: node scripts/mainnet-deploy.mjs key|deploy|finish");
}
