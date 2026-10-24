// Shared helpers: storage, dates, food-database matching, toast, nav.
window.FC = (() => {
  const KEYS = { items: "fc.items", recipes: "fc.recipes", log: "fc.log", goal: "fc.goal" };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(KEYS[k])) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(KEYS[k], JSON.stringify(v)); } catch {} };

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
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
  const qtyLabel = (it) => [it.count && `${it.count}×`, it.weight_g && (it.weight_g >= 1000 ? `${+(it.weight_g / 1000).toFixed(2)} kg` : `${it.weight_g} g`)].filter(Boolean).join(" ");

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
  async function api(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Request failed");
    return j;
  }
  const ring = (frac, r, c) => `stroke-dasharray="${2 * Math.PI * r}" stroke-dashoffset="${2 * Math.PI * r * (1 - Math.max(0, Math.min(1, frac)))}"`;

  return { load, save, today, parse, daysUntil, uid, esc, foodsReady, matchFood, itemKcal, qtyLabel, toast, nav, api, ring };
})();
