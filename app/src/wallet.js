// Wallet connection through NEAR Connect (Meteor, HOT, Intear, MyNearWallet and more).
import { NearConnector } from "@hot-labs/near-connect";

const connectors = {};
// Test builds only (VITE_DEV_SIGNER=1): a testnet key signer for automated browser tests.
const dev = import.meta.env.VITE_DEV_SIGNER === "1" ? await import("./devsigner.js") : null;
const devFor = n => dev?.devSigner(n) ?? null;

function connector(n) {
  if (!connectors[n.id]) {
    connectors[n.id] = new NearConnector({ network: n.id, providers: { [n.id]: [n.rpc] }, footerBranding: null });
  }
  return connectors[n.id];
}

export async function currentAccount(n) {
  const d = devFor(n);
  if (d) return d.accountId;
  try {
    const { accounts } = await connector(n).getConnectedWallet();
    return accounts[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

export async function connect(n) {
  const d = devFor(n);
  if (d) return d.accountId;
  const wallet = await connector(n).connect();
  const accounts = await wallet.getAccounts({ network: n.id });
  return accounts[0]?.accountId ?? null;
}

export async function disconnect(n) {
  const d = devFor(n);
  if (d) return d.signOut();
  await connector(n).disconnect().catch(() => {});
}

export function onChange(n, cb) {
  if (devFor(n)) return;
  connector(n).on("wallet:signIn", e => cb(e.accounts?.[0]?.accountId ?? null));
  connector(n).on("wallet:signOut", () => cb(null));
}

export const fnCall = (methodName, args, deposit = "0", tgas = 100) => ({
  type: "FunctionCall",
  params: { methodName, args, gas: String(BigInt(tgas) * 10n ** 12n), deposit: String(deposit) },
});

export async function send(n, receiverId, actions) {
  const d = devFor(n);
  if (d) return d.send(receiverId, actions);
  const wallet = await connector(n).wallet();
  return wallet.signAndSendTransaction({ network: n.id, receiverId, actions });
}

export async function sendMany(n, transactions) {
  const d = devFor(n);
  if (d) return d.sendMany(transactions);
  const wallet = await connector(n).wallet();
  return wallet.signAndSendTransactions({ network: n.id, transactions });
}

// Throws if the transaction (or any receipt) failed, with the contract's own message.
export function assertOk(outcome) {
  const all = [outcome?.transaction_outcome, ...(outcome?.receipts_outcome ?? [])].filter(Boolean);
  for (const o of all) {
    const f = o.outcome?.status?.Failure;
    if (f) throw new Error(failureText(f));
  }
  if (outcome?.status?.Failure) throw new Error(failureText(outcome.status.Failure));
  return outcome;
}

export function failureText(f) {
  const s = JSON.stringify(f);
  const m = /Smart contract panicked: ([^"\\]+)/.exec(s);
  return m ? m[1] : s.slice(0, 200);
}
