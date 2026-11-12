import QRCode from "qrcode";
import { NETWORKS } from "./config.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// A receipt is written by the shop, so anything in it is untrusted: force every field to the type
// the pages expect before it is shown. Text is still escaped wherever it goes into HTML.
export function clean(r) {
  if (!r || typeof r !== "object") return null;
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const str = (v, max) => String(v ?? "").slice(0, max);
  return {
    shop: str(r.shop, 60),
    account: str(r.account, 64),
    currency: "NGN",
    rate: num(r.rate),
    total: num(r.total),
    issued: str(r.issued, 40),
    items: (Array.isArray(r.items) ? r.items : []).slice(0, 50).map(i => ({ name: str(i?.name, 60), qty: Math.floor(num(i?.qty)), price: num(i?.price) })),
  };
}

export const naira = n => "₦" + Math.round(Number(n)).toLocaleString("en-NG");
export const usdc = units => (Number(units) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
export const short = (s, a = 6, b = 4) => (s && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s ?? "");

export function when(ms) {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function mark(size = 32) {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#3A34A8"/><g fill="#fff"><rect x="14" y="17" width="36" height="6" rx="3"/><rect x="14" y="29" width="26" height="6" rx="3"/><rect x="14" y="41" width="16" height="6" rx="3"/></g><path d="M36 44 L42 50 L53 36" fill="none" stroke="#FFD166" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function header(active, netId) {
  const n = NETWORKS[netId];
  const testBadge = n && !n.intents ? `<span class="badge test">Test network</span>` : "";
  return `<header class="top"><div class="wrap row">
    <a class="brand" href="/">${mark(30)}<span>RAJISTA <b>PAY</b></span></a>${testBadge}
    <nav>${[["/", "How it works", "home"], ["/shop", "Shop till", "shop"]].map(([h, t, k]) => `<a href="${h}${k === "shop" && netId ? `?net=${netId}` : ""}" class="${k === active ? "on" : ""}">${t}</a>`).join("")}</nav>
  </div></header>`;
}

export async function qr(text, size = 260) {
  return QRCode.toString(text, { type: "svg", margin: 1, width: size, errorCorrectionLevel: "M", color: { dark: "#14123A", light: "#FFFFFF" } });
}

export function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.classList.add("out"), 3800);
  setTimeout(() => el.remove(), 4400);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Copy failed: select and copy it by hand", "bad");
  }
}

export function pill(inv) {
  if (!inv) return `<span class="pill">…</span>`;
  const expired = inv.status === "Open" && Number(inv.due_ms) && Date.now() > Number(inv.due_ms);
  if (inv.status === "Paid") return `<span class="pill paid">Paid${inv.late ? " late" : ""}</span>`;
  if (inv.status === "Void") return `<span class="pill void">Cancelled</span>`;
  if (expired) return `<span class="pill void">Expired</span>`;
  return `<span class="pill open">Waiting</span>`;
}

export function txLink(n, hash, label) {
  return `<a href="${n.explorer}/txns/${esc(hash)}" target="_blank" rel="noopener">${esc(label ?? short(hash))}</a>`;
}

export function accountLink(n, id) {
  return `<a href="${n.explorer}/address/${esc(id)}" target="_blank" rel="noopener">${esc(id)}</a>`;
}

export async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status, data });
  return data;
}
