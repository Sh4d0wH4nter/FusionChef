(() => {
  const { load, save, today, uid, esc, toast } = FC;
  const app = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("id");
  const r = load("recipes", []).find((x) => x.id === id);
  if (!r) { app.innerHTML = '<div class="empty">Recipe not found. It may have been deleted. <a href="/nutrition.html">Back to Nutrition</a></div>'; return; }
  document.title = `${r.title} · FusionChef`;
  const n = r.nutrition || {};
  const total = (r.prep_mins || 0) + (r.cook_mins || 0);

  app.innerHTML = `
    <header><div><h1>${esc(r.title)}</h1><div class="sub"><span class="tag">${esc(r.cuisine)}</span>${esc(r.summary)}</div></div>${FC.nav("")}</header>
    <div class="split">
      <article class="panel scroll">
        <h2>Ingredients</h2><ul>${(r.ingredients || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        <h2>Method</h2><ol>${(r.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      </article>
      <aside class="side">
        <div class="panel">
          <b>Nutrition per serving</b>
          <div class="nut4">
            <div style="--c:var(--accent)"><b>${n.calories ?? "?"}</b><small>kcal</small></div>
            <div style="--c:var(--ok)"><b>${n.protein_g ?? "?"}g</b><small>protein</small></div>
            <div style="--c:var(--soon)"><b>${n.carbs_g ?? "?"}g</b><small>carbs</small></div>
            <div style="--c:var(--accent2)"><b>${n.fat_g ?? "?"}g</b><small>fat</small></div>
          </div>
        </div>
        <div class="panel facts">
          <div><small>Servings</small><b>${r.servings ?? "?"}</b></div>
          <div><small>Total time</small><b>${total} min</b></div>
          <div><small>Prep</small><b>${r.prep_mins ?? "?"} min</b></div>
          <div><small>Cook</small><b>${r.cook_mins ?? "?"} min</b></div>
          <div><small>Difficulty</small><b style="text-transform:capitalize">${esc(r.difficulty || "n/a")}</b></div>
        </div>
        <div class="panel">
          <b>Done cooking?</b>
          <p class="sub" style="margin:4px 0 10px">Log what you ate to today's calories.</p>
          <label class="sub">Servings eaten <input id="eaten" type="number" min="0.5" step="0.5" value="1" style="width:80px"></label>
          <button class="btn" id="logit" style="width:100%;margin-top:10px">Add to today's calories</button>
        </div>
      </aside>
    </div>`;

  document.getElementById("logit").onclick = () => {
    const s = +document.getElementById("eaten").value || 1;
    const log = load("log", []);
    log.push({ id: uid(), date: today(), name: r.title, kcal: Math.round((n.calories || 0) * s), p: Math.round((n.protein_g || 0) * s), c: Math.round((n.carbs_g || 0) * s), f: Math.round((n.fat_g || 0) * s) });
    save("log", log);
    toast(`Logged ${Math.round((n.calories || 0) * s)} kcal. <a href="/nutrition.html">View today →</a>`);
  };
})();
