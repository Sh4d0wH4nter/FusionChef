// Shared helpers: storage, dates, food-database matching, toast, nav.
window.FC = (() => {
  const KEYS = { items: "fc.items", recipes: "fc.recipes", log: "fc.log", goal: "fc.goal", dayoffset: "fc.dayoffset" };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(KEYS[k])) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(KEYS[k], JSON.stringify(v)); } catch {} };

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Developer mode can shift "today" forward by whole days so the expiry cards can be demoed without waiting.
const getOffset = () => Number(load("dayoffset", 0)) || 0;
const setOffset = (n) => save("dayoffset", n);
const now = () => { const d = new Date(); d.setDate(d.getDate() + getOffset()); return d; };
const today = () => iso(now());
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const daysUntil = (s) => Math.round((parse(s) - parse(today())) / 864e5);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---- food database matching (public/data/foods.json: [{name, kcal_per_100g, unit_g?}]) ----
  let foods = [];
  const foodsReady = fetch("/data/foods.json").then((r) => r.json()).then((f) => (foods = f)).catch(() => {});
  const tokens = (s) => s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean).map((t) => t.replace(/(es|s)$/, ""));
  function matchFood(name) {
    const t = new Set(tokens(name));
    let best = null, bestScore = 0;
    for (const f of foods) {
      const ft = tokens(f.name);
      const hit = ft.filter((x) => t.has(x)).length;
      if (!hit) continue;
      const score = hit / ft.length + hit / Math.max(t.size, 1) / 2;
      if (score > bestScore) { best = f; bestScore = score; }
    }
    return best;
  }
  // Estimated kcal for a stored item ({count, weight_g}); null if no match or no usable amount.
  function itemKcal(it) {
    const f = it.food ? foods.find((x) => x.name === it.food) : matchFood(it.name);
    if (!f) return null;
    const g = it.weight_g ?? (it.count && f.unit_g ? it.count * f.unit_g : null);
    return g ? Math.round((g / 100) * f.kcal_per_100g) : null;
  }
  // ---- sensible defaults for common foods (public/data/defaults.json) ----
  let defaults = [];
  const defaultsReady = fetch("/data/defaults.json").then((r) => r.json()).then((d) => (defaults = d)).catch(() => {});
  const norm = (s) => tokens(s).join(" ");
  const findDefault = (name) => {
    const n = ` ${norm(name)} `;
    return defaults.find((d) => d.names.some((a) => n.includes(` ${norm(a)} `))) || null;
  };
  // Fill in what the user did not say: a pack size if no amount, grams from a count, a shelf life if no expiry.
  // Whatever the user did say is kept as-is.
  function applyDefaults(p) {
    const out = { name: p.name, count: p.count ?? null, weight_g: p.weight_g ?? null, expiry: p.expiry || null, pack: null, guessedQty: false };
    const d = findDefault(p.name);
    if (!d) return out;
    if (out.count == null && out.weight_g == null) {
      out.guessedQty = true; out.pack = d.label || null;
      if (d.count) out.count = d.count;
      if (d.total_g) out.weight_g = d.total_g;
      else if (d.weigh && d.count && d.unit_g) out.weight_g = d.count * d.unit_g;
    } else if (out.weight_g == null && out.count != null && d.weigh && d.unit_g) out.weight_g = out.count * d.unit_g;
    out.shelf_days = d.shelf_days;
    return out;
  }
  const qtyLabel = (it) => it.pack ? it.pack : [it.count && `${it.count}×`, it.weight_g && (it.weight_g >= 1000 ? `${+(it.weight_g / 1000).toFixed(2)} kg` : `${it.weight_g} g`)].filter(Boolean).join(" ");

  let tt;
  function toast(html) {
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.innerHTML = html; el.classList.add("show");
    clearTimeout(tt); tt = setTimeout(() => el.classList.remove("show"), 6000);
  }

  function nav(current) {
    const links = [["/", "Kitchen", "main"], ["/nutrition.html", "Nutrition", "nutrition"]];
    return `<nav>${links.map(([h, l, k]) => `<a href="${h}" ${k === current ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>`;
  }
  // POST JSON with a client-side timeout (a bit longer than the server's own deadline) and optional cancel via opts.signal.
  async function api(path, body, opts = {}) {
    const ctl = new AbortController();
    let why = null;
    const timer = setTimeout(() => { why = "timeout"; ctl.abort(); }, opts.timeoutMs || 105e3);
    const onAbort = () => { why = "cancel"; ctl.abort(); };
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Request failed");
      return j;
    } catch (e) {
      if (why === "timeout") throw new Error("This is taking too long, so I stopped waiting. The free AI models can be busy. Try again in a moment.");
      if (why === "cancel") throw Object.assign(new Error("Cancelled."), { cancelled: true });
      throw e;
    } finally { clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); }
  }
  const ring = (frac, r, c) => `stroke-dasharray="${2 * Math.PI * r}" stroke-dashoffset="${2 * Math.PI * r * (1 - Math.max(0, Math.min(1, frac)))}"`;

  return { defaultsReady, applyDefaults, getOffset, setOffset, now, load, save, today, parse, daysUntil, uid, esc, foodsReady, matchFood, itemKcal, qtyLabel, toast, nav, api, ring };
})();
