// Reads from NEAR over JSON-RPC with plain fetch, so the worker and the browser share it.

async function rpc(n, method, params) {
  const res = await fetch(n.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "rajista", method, params }),
  });
  if (!res.ok) throw new Error(`NEAR RPC ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.data ?? body.error.message ?? "NEAR RPC error");
  return body.result;
}

function b64(s) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export async function view(n, contract, method, args = {}) {
  const r = await rpc(n, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: b64(JSON.stringify(args)),
  });
  if (r.error) throw new Error(r.error);
  const text = new TextDecoder().decode(new Uint8Array(r.result));
  return text ? JSON.parse(text) : null;
}

// "optimistic" so a till sees a payment the moment it lands.
export async function viewFresh(n, contract, method, args = {}) {
  const r = await rpc(n, "query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: b64(JSON.stringify(args)),
  });
  if (r.error) throw new Error(r.error);
  const text = new TextDecoder().decode(new Uint8Array(r.result));
  return text ? JSON.parse(text) : null;
}

export const getInvoice = (n, id, fresh = false) => (fresh ? viewFresh : view)(n, n.contract, "get_invoice", { id });

export async function accountExists(n, accountId) {
  try {
    await rpc(n, "query", { request_type: "view_account", finality: "final", account_id: accountId });
    return true;
  } catch {
    return false;
  }
}

export async function accessKey(n, accountId, publicKey) {
  try {
    return await rpc(n, "query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey });
  } catch {
    return null;
  }
}

export async function nearBalance(n, accountId) {
  const r = await rpc(n, "query", { request_type: "view_account", finality: "optimistic", account_id: accountId });
  return BigInt(r.amount);
}

export async function sha256b64(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(d)));
}
