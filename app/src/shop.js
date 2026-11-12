import { NETWORKS, toUnits } from "./config.js";
import { view, viewFresh, getInvoice, sha256b64 } from "./chain.js";
import { connect, currentAccount, disconnect, send, sendMany, fnCall, assertOk, onChange } from "./wallet.js";
import { newTillKey, saveTillKey, forgetTillKey, tillStatus, tillCall } from "./till.js";
import { $, esc, naira, usdc, when, header, qr, toast, copy, pill, api, accountLink, short } from "./ui.js";

const params = new URLSearchParams(location.search);
const n = NETWORKS[params.get("net")] ?? NETWORKS.mainnet;
const other = n.id === "mainnet" ? NETWORKS.testnet : NETWORKS.mainnet;
const YOCTO = 10n ** 24n;
const CREDIT_TOPUP = 5n * 10n ** 22n; // 0.05 NEAR, about 15 invoices of storage
const CREDIT_LOW = 10n ** 22n;
const TILL_ALLOWANCE = 25n * 10n ** 22n; // 0.25 NEAR of gas for the till key
const local = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

let shop = null;
let current = null; // { id, link, timer }

$("#header").innerHTML = header("shop", n.id);
$("#netline").innerHTML = `${n.intents ? "Live network: real USDC." : "Test network: test USDC, free to try."} <a href="/shop?net=${other.id}">Switch to ${other.label.toLowerCase()}</a>`;

const nearFmt = y => (Number((BigInt(y) * 1000n) / YOCTO) / 1000).toFixed(3);

async function contractReady() {
  try {
    await view(n, n.contract, "get_config");
    return true;
  } catch {
    return false;
  }
}

async function start() {
  if (!(await contractReady())) {
    $("#notice").innerHTML = `<div class="note">The ${n.label.toLowerCase()} contract <b>${esc(n.contract)}</b> is not deployed yet. <a href="/shop?net=${other.id}">Use the ${other.label.toLowerCase()}</a>.</div>`;
    return;
  }
  shop = await currentAccount(n);
  render();
}

onChange(n, acc => { shop = acc; render(); });

function whoBar() {
  $("#who").innerHTML = shop
    ? `<span class="small">${accountLink(n, shop)}</span><button class="quiet small" id="btn-out">Disconnect</button>`
    : "";
  $("#btn-out")?.addEventListener("click", async () => { await disconnect(n); shop = null; render(); });
}

async function render() {
  whoBar();
  for (const id of ["#connect", "#setup", "#work", "#money", "#history"]) $(id).classList.add("hide");
  if (!shop) {
    $("#connect").classList.remove("hide");
    return;
  }
  const s = await setupState();
  if (!s.done) {
    showSetup(s);
    return;
  }
  $("#shopname-show").textContent = shopName();
  for (const id of ["#work", "#money", "#history"]) $(id).classList.remove("hide");
  if (!$("#items tbody").children.length) addItem();
  loadRate();
  refreshMoney();
  refreshList();
}

$("#btn-connect").addEventListener("click", async () => {
  try {
    shop = await connect(n);
    render();
  } catch (e) {
    toast(e.message ?? "Wallet did not connect", "bad");
  }
});

// -- setup ---------------------------------------------------------------------------------

const shopName = () => local.get(`rajista-pay:shopname:${n.id}:${shop}`) ?? "";

async function setupState() {
  const [reg, bounds, credit, till] = await Promise.all([
    view(n, n.usdc, "storage_balance_of", { account_id: shop }),
    view(n, n.usdc, "storage_balance_bounds"),
    view(n, n.contract, "get_storage_credit", { shop }),
    tillStatus(n, shop),
  ]);
  const s = {
    usdc: reg !== null,
    usdcCost: BigInt(bounds.min),
    credit: BigInt(credit),
    creditOk: BigInt(credit) >= CREDIT_LOW,
    till,
    name: shopName().length > 1,
  };
  s.done = s.usdc && s.creditOk && s.till.ready && s.name;
  return s;
}

function showSetup(s) {
  $("#setup").classList.remove("hide");
  const tillText = {
    none: "Add a till key for this device",
    removed: "This device's till key was removed from the wallet; add a new one",
    wrong: "Replace this device's till key",
    allowance: "This device's till key has used its gas allowance; add a new one",
  }[s.till.reason] ?? "Till key ready on this device";
  const rows = [
    [s.usdc, "Shop can receive USDC", "registers the shop with the USDC token"],
    [s.creditOk, "Invoice storage prepaid", `${nearFmt(s.credit)} NEAR left; each invoice uses about 0.004`],
    [s.till.ready, s.till.ready ? "Till key ready on this device" : tillText, "can only create and cancel invoices, never move money"],
  ];
  $("#checks").innerHTML = rows.map(([ok, t, d]) => `<div class="check ${ok ? "done" : ""}"><span class="dot">${ok ? "✓" : ""}</span><div><b>${esc(t)}</b><div class="small muted">${esc(d)}</div></div></div>`).join("");
  $("#shopname").value = shopName();
  const cost = (s.usdc ? 0n : s.usdcCost) + (s.creditOk ? 0n : CREDIT_TOPUP);
  $("#setup-cost").textContent = cost > 0n
    ? `Costs ${nearFmt(cost)} NEAR from the shop's wallet, plus network fees. Unused storage can be withdrawn later.`
    : "No NEAR needed for this step.";
  $("#btn-setup").onclick = () => runSetup(s);
}

async function runSetup(s) {
  const name = $("#shopname").value.trim();
  if (name.length < 2) return toast("Enter the shop name for receipts", "bad");
  local.set(`rajista-pay:shopname:${n.id}:${shop}`, name);
  const txs = [];
  if (!s.usdc) txs.push({ receiverId: n.usdc, actions: [fnCall("storage_deposit", { account_id: shop, registration_only: true }, s.usdcCost, 30)] });
  if (!s.creditOk) txs.push({ receiverId: n.contract, actions: [fnCall("storage_deposit", {}, CREDIT_TOPUP, 30)] });
  let kp = null;
  if (!s.till.ready) {
    kp = newTillKey();
    txs.push({
      receiverId: shop,
      actions: [{ type: "AddKey", params: { publicKey: kp.getPublicKey().toString(), accessKey: { permission: { receiverId: n.contract, allowance: String(TILL_ALLOWANCE), methodNames: ["create_invoice", "void_invoice"] } } } }],
    });
  }
  if (!txs.length) return render();
  const btn = $("#btn-setup");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Approve in your wallet`;
  try {
    if (kp) saveTillKey(n, shop, kp); // saved first, so an approved key is never lost on this device
    const outs = await sendMany(n, txs);
    (outs ?? []).forEach(assertOk);
    toast("Till is ready");
  } catch (e) {
    if (kp) forgetTillKey(n, shop);
    toast(e.message ?? "Setup was not completed", "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = "Set up this till";
    render();
  }
}

// -- new sale ------------------------------------------------------------------------------

function addItem(name = "", qty = 1, price = "") {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><input class="i-name" maxlength="60" placeholder="Item" value="${esc(name)}"></td>
    <td><input class="i-qty" type="number" inputmode="numeric" min="1" step="1" value="${qty}" style="text-align:right"></td>
    <td><input class="i-price" type="number" inputmode="decimal" min="0" step="1" value="${price}" style="text-align:right" placeholder="0"></td>
    <td><button class="quiet small" title="Remove" aria-label="Remove item">✕</button></td>`;
  tr.querySelector("button").onclick = () => { tr.remove(); if (!$("#items tbody").children.length) addItem(); totals(); };
  tr.querySelectorAll("input").forEach(i => i.addEventListener("input", totals));
  $("#items tbody").append(tr);
  totals();
}
$("#add-item").addEventListener("click", () => { addItem(); $("#items tbody tr:last-child .i-name").focus(); });

function readItems() {
  return [...$("#items tbody").children].map(tr => ({
    name: tr.querySelector(".i-name").value.trim(),
    qty: Math.max(0, Math.floor(Number(tr.querySelector(".i-qty").value) || 0)),
    price: Math.max(0, Number(tr.querySelector(".i-price").value) || 0),
  })).filter(i => i.name && i.qty > 0 && i.price > 0);
}

function totals() {
  const items = readItems();
  const ngn = items.reduce((a, i) => a + i.qty * i.price, 0);
  const rate = Number($("#rate").value);
  const usd = rate > 0 ? Math.ceil((ngn / rate) * 100) / 100 : 0;
  $("#total-ngn").textContent = naira(ngn);
  $("#total-usdc").textContent = `${usd.toFixed(2)} USDC`;
  return { items, ngn, rate, usd };
}
$("#rate").addEventListener("input", () => { local.set("rajista-pay:rate", $("#rate").value); totals(); });

async function loadRate() {
  const saved = local.get("rajista-pay:rate");
  if (saved && !$("#rate").value) $("#rate").value = saved;
  try {
    const r = await api("/api/rate");
    if (r.ngnPerUsd) {
      $("#rate-src").innerHTML = `Market: ₦${r.ngnPerUsd.toFixed(2)} <a href="#" id="use-rate">use it</a>`;
      $("#use-rate").onclick = e => { e.preventDefault(); $("#rate").value = r.ngnPerUsd.toFixed(2); local.set("rajista-pay:rate", $("#rate").value); totals(); };
      if (!$("#rate").value) $("#rate").value = r.ngnPerUsd.toFixed(2);
    }
  } catch { /* the shop types its own rate */ }
  totals();
}

function newId() {
  const tag = shop.split(".")[0].replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "SHOP";
  const rand = crypto.getRandomValues(new Uint8Array(2)).reduce((s, b) => s + b.toString(36).padStart(2, "0"), "").slice(0, 3).toUpperCase();
  return `${tag}-${Date.now().toString(36).toUpperCase()}${rand}`;
}

$("#btn-issue").addEventListener("click", async () => {
  const { items, ngn, rate, usd } = totals();
  if (!items.length) return toast("Add at least one item with a price", "bad");
  if (!(rate > 0)) return toast("Enter the rate", "bad");
  if (usd < 0.01) return toast("Total is too small", "bad");
  const id = newId();
  const dueIn = Number($("#due").value);
  const receipt = JSON.stringify({
    v: 1, shop: shopName(), account: shop, currency: "NGN", rate, total: ngn,
    items: items.map(i => ({ name: i.name, qty: i.qty, price: i.price })), issued: new Date().toISOString(),
  });
  const btn = $("#btn-issue");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Creating`;
  try {
    const res = await tillCall(n, shop, "create_invoice", {
      id, amount: toUnits(usd), due_ms: String(dueIn ? Date.now() + dueIn : 0),
      items_hash: await sha256b64(receipt), note: `${naira(ngn)} at ₦${rate}/USDC`.slice(0, 200),
    });
    assertOk(res);
    await api("/api/receipt", { net: n.id, id, receipt });
    showCurrent(id, ngn, usd);
    $("#items tbody").innerHTML = "";
    addItem();
    refreshList();
  } catch (e) {
    toast(e.message ?? "Could not create the invoice", "bad");
    render();
  } finally {
    btn.disabled = false;
    btn.textContent = "Create invoice";
  }
});

async function showCurrent(id, ngn, usd) {
  if (current?.timer) clearInterval(current.timer);
  const link = `${location.origin}${n.payPath}${id}`;
  current = { id, link };
  $("#current-body").innerHTML = `
    <div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div class="qr" style="width:240px">${await qr(link, 240)}</div>
      <div class="grow stack" style="min-width:200px">
        <div><div class="label-up">Invoice</div><div class="mono">${esc(id)}</div></div>
        <div><div class="label-up">Amount</div><div style="font-size:28px;font-weight:800">${usd.toFixed(2)} USDC</div><div class="muted">${naira(ngn)}</div></div>
        <div id="cur-status">${pill({ status: "Open", due_ms: 0 })} <span class="small muted">Customer scans to pay from any chain</span></div>
      </div>
    </div>
    <div class="row" style="flex-wrap:wrap">
      <button class="quiet small" id="cur-copy">Copy pay link</button>
      <a class="btn ghost small" href="${link}" target="_blank" rel="noopener">Open pay page</a>
      <button class="danger small" id="cur-void">Cancel invoice</button>
    </div>`;
  $("#cur-copy").onclick = () => copy(link);
  $("#cur-void").onclick = () => voidInvoice(id);
  current.timer = setInterval(() => watchCurrent(id), 3000);
}

async function watchCurrent(id) {
  if (current?.id !== id) return;
  const inv = await getInvoice(n, id, true).catch(() => null);
  if (!inv) return;
  if (inv.status === "Open") return;
  clearInterval(current.timer);
  if (inv.status === "Paid") {
    $("#cur-status").innerHTML = `<div class="note good"><b style="font-size:20px">✓ Paid ${usdc(inv.amount)} USDC</b><div class="small">${when(inv.paid_ms)} · ${inv.payer === n.router ? "through NEAR Intents" : `from ${esc(inv.payer)}`}</div></div>`;
    $("#cur-void")?.remove();
    toast("Payment received");
  } else {
    $("#cur-status").innerHTML = pill(inv);
  }
  refreshMoney();
  refreshList();
}

async function voidInvoice(id) {
  try {
    assertOk(await tillCall(n, shop, "void_invoice", { id }));
    toast("Invoice cancelled");
    if (current?.id === id) {
      clearInterval(current.timer);
      $("#current-body").innerHTML = `<p class="muted">Invoice ${esc(id)} cancelled. A payment that still arrives is refunded (wallet) or held for you to refund (other chains).</p>`;
    }
    refreshList();
  } catch (e) {
    toast(e.message ?? "Could not cancel", "bad");
  }
}

// -- money ---------------------------------------------------------------------------------

async function refreshMoney() {
  const [bal, credit] = await Promise.all([
    viewFresh(n, n.contract, "get_balance", { shop }),
    viewFresh(n, n.contract, "get_storage_credit", { shop }),
  ]);
  $("#balance").textContent = `${usdc(bal)} USDC`;
  $("#btn-withdraw").disabled = BigInt(bal) === 0n;
  $("#credit-line").innerHTML = `Invoice storage left: ${nearFmt(credit)} NEAR (about ${Math.floor(Number(BigInt(credit) / (4n * 10n ** 21n)))} invoices). <a href="#" id="topup">Add 0.05 NEAR</a>`;
  $("#topup").onclick = async e => {
    e.preventDefault();
    try {
      assertOk(await send(n, n.contract, [fnCall("storage_deposit", {}, CREDIT_TOPUP, 30)]));
      refreshMoney();
    } catch (err) {
      toast(err.message ?? "Top-up failed", "bad");
    }
  };
}

$("#btn-withdraw").addEventListener("click", async () => {
  try {
    assertOk(await send(n, n.contract, [fnCall("withdraw", { amount: null }, 1n, 60)]));
    toast("USDC sent to your wallet");
  } catch (e) {
    toast(e.message ?? "Withdraw failed", "bad");
  }
  refreshMoney();
});

// -- history and CSV -----------------------------------------------------------------------

async function invoicesPage(from, limit) {
  return viewFresh(n, n.contract, "get_shop_invoices", { shop, from_index: from, limit });
}

async function receipts(ids) {
  if (!ids.length) return {};
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    Object.assign(out, await api(`/api/receipts?net=${n.id}&ids=${ids.slice(i, i + 100).join(",")}`).catch(() => ({})));
  }
  return out;
}

const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const through = inv => inv.status !== "Paid" ? "" : inv.payer === n.router ? "NEAR Intents" : inv.payer;

async function refreshList() {
  const count = await viewFresh(n, n.contract, "get_shop_invoice_count", { shop });
  const from = Math.max(0, count - 50);
  const list = (await invoicesPage(from, 50)).reverse();
  const rec = await receipts(list.map(i => i.id));
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const today = list.filter(i => i.status === "Paid" && Number(i.paid_ms) >= startOfDay);
  $("#today").textContent = `Today: ${today.length} paid, ${usdc(today.reduce((a, i) => a + BigInt(i.amount), 0n))} USDC`;
  $("#list tbody").innerHTML = list.length ? list.map(inv => {
    const r = parse(rec[inv.id]);
    const items = r ? r.items.map(i => `${i.qty} × ${i.name}`).join(", ") : "";
    const extra = BigInt(inv.extra) > 0n ? `<div class="small" style="color:var(--red)">Refund owed: ${usdc(inv.extra)} USDC</div>` : "";
    return `<tr>
      <td class="small">${when(inv.created_ms)}</td>
      <td><a class="mono small" href="${n.payPath}${esc(inv.id)}" target="_blank" rel="noopener">${esc(inv.id)}</a></td>
      <td class="small">${esc(items)}</td>
      <td class="num">${r ? naira(r.total) : ""}</td>
      <td class="num">${usdc(inv.amount)}</td>
      <td>${pill(inv)}${extra}</td>
      <td class="small">${esc(short(through(inv), 14, 6))}</td></tr>`;
  }).join("") : `<tr><td colspan="7" class="muted">No invoices yet.</td></tr>`;
}
$("#btn-refresh").addEventListener("click", () => { refreshList(); refreshMoney(); });

$("#btn-csv").addEventListener("click", async () => {
  const count = await viewFresh(n, n.contract, "get_shop_invoice_count", { shop });
  const all = [];
  for (let from = 0; from < count; from += 100) all.push(...(await invoicesPage(from, 100)));
  const rec = await receipts(all.map(i => i.id));
  // Nigerian time for the shop's books, e.g. "2026-11-10 10:59:20".
  const iso = ms => (Number(ms) ? new Date(Number(ms)).toLocaleString("sv-SE", { timeZone: "Africa/Lagos" }) : "");
  const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows = [["invoice_id", "created_wat", "status", "paid_wat", "paid_through", "usdc", "refund_owed_usdc", "late", "naira_total", "rate_ngn_per_usdc", "items", "pay_link"]];
  for (const inv of all) {
    const r = parse(rec[inv.id]);
    const expired = inv.status === "Open" && Number(inv.due_ms) && Date.now() > Number(inv.due_ms);
    rows.push([inv.id, iso(inv.created_ms), expired ? "Expired" : inv.status, iso(inv.paid_ms), through(inv), usdc(inv.amount), usdc(inv.extra), inv.late ? "yes" : "",
      r?.total ?? "", r?.rate ?? "", r ? r.items.map(i => `${i.qty} x ${i.name} @ ${i.price}`).join("; ") : "", `${location.origin}${n.payPath}${inv.id}`]);
  }
  const blob = new Blob([rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `rajista-pay-${shop}-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
});

start();
