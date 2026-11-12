// Mainnet deployment of the invoice contract, in two steps.
//   node scripts/mainnet-deploy.mjs key      makes the deploy key (kept in .keys/, gitignored) and
//                                            prints the local page where the owner's wallet creates
//                                            pay.risingtell.near with that key
//   node scripts/mainnet-deploy.mjs deploy   deploys res/rajista_pay.wasm, initialises it with
//                                            router intents.near, registers it with USDC
import { Account, JsonRpcProvider, KeyPair, teraToGas } from "near-api-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NETWORKS } from "../app/src/config.js";

const n = NETWORKS.mainnet;
const file = `.keys/${n.contract}.json`;
const provider = new JsonRpcProvider({ url: n.rpc });
const step = process.argv[2];

if (step === "key") {
  if (!existsSync(file)) {
    const kp = KeyPair.fromRandom("ed25519");
    mkdirSync(".keys", { recursive: true });
    writeFileSync(file, JSON.stringify({ account_id: n.contract, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }, null, 2));
  }
  const { public_key } = JSON.parse(readFileSync(file, "utf8"));
  console.log(`deploy key: ${public_key}`);
  console.log(`open: http://127.0.0.1:8791/admin?pk=${encodeURIComponent(public_key)}&near=0.97`);
} else if (step === "deploy") {
  const { private_key } = JSON.parse(readFileSync(file, "utf8"));
  const acct = new Account(n.contract, provider, private_key);
  const state = await provider.viewAccount({ accountId: n.contract });
  console.log(`${n.contract} balance ${(Number(BigInt(state.amount) / 10n ** 21n) / 1000).toFixed(3)} NEAR`);
  const config = await provider.callFunction({ contractId: n.contract, method: "get_config", args: {} }).catch(() => null);
  if (config) {
    console.log("already deployed:", JSON.stringify(config));
  } else {
    const d = await acct.deployContract(readFileSync("res/rajista_pay.wasm"));
    console.log(`deployed ${n.explorer}/txns/${d.transaction.hash}`);
    const i = await acct.callFunctionRaw({ contractId: n.contract, methodName: "new", args: { usdc: n.usdc, router: n.router }, gas: teraToGas(30) });
    console.log(`initialised ${n.explorer}/txns/${i.transaction.hash}`);
  }
  const reg = await provider.callFunction({ contractId: n.usdc, method: "storage_balance_of", args: { account_id: n.contract } });
  if (!reg) {
    const bounds = await provider.callFunction({ contractId: n.usdc, method: "storage_balance_bounds", args: {} });
    const r = await acct.callFunctionRaw({ contractId: n.usdc, methodName: "storage_deposit", args: { account_id: n.contract, registration_only: true }, deposit: BigInt(bounds.min), gas: teraToGas(30) });
    console.log(`registered with USDC ${n.explorer}/txns/${r.transaction.hash}`);
  }
  console.log("config:", JSON.stringify(await provider.callFunction({ contractId: n.contract, method: "get_config", args: {} })));
} else {
  console.log("usage: node scripts/mainnet-deploy.mjs key|deploy");
}
