// Test-network-only signer for automated browser tests on a developer machine. It exists only in a
// build made with VITE_DEV_SIGNER=1 (npm run build:test); the normal build removes this code.
// It signs with a testnet key placed in sessionStorage (one per tab) by the test script, standing in for a wallet.
import { Account, JsonRpcProvider, actions, PublicKey } from "near-api-js";

const SLOT = "rajista-pay:dev-signer";

export function devSigner(n) {
  if (n.id !== "testnet") return null;
  let raw;
  try { raw = sessionStorage.getItem(SLOT); } catch { return null; }
  if (!raw) return null;
  const { accountId, key } = JSON.parse(raw);
  const account = new Account(accountId, new JsonRpcProvider({ url: n.rpc }), key);
  const convert = a => {
    const p = a.params;
    if (a.type === "FunctionCall") return actions.functionCall(p.methodName, p.args, BigInt(p.gas), BigInt(p.deposit));
    if (a.type === "AddKey") {
      const perm = p.accessKey.permission;
      return actions.addFunctionCallAccessKey(PublicKey.fromString(p.publicKey), perm.receiverId, perm.methodNames ?? [], perm.allowance ? BigInt(perm.allowance) : undefined);
    }
    throw new Error(`dev signer does not support ${a.type}`);
  };
  const sendOne = (receiverId, acts) => account.signAndSendTransaction({ receiverId, actions: acts.map(convert), throwOnFailure: false });
  return {
    accountId,
    send: sendOne,
    sendMany: async txs => {
      const outs = [];
      for (const t of txs) outs.push(await sendOne(t.receiverId, t.actions));
      return outs;
    },
    signOut: () => { try { sessionStorage.removeItem(SLOT); } catch { /* ignore */ } },
  };
}
