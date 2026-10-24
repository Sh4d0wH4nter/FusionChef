(() => {
  const { load, save, today, uid, esc, toast } = FC;
  const app = document.getElementById("app");
  document.getElementById("nav").innerHTML = FC.nav("");
  const id = new URLSearchParams(location.search).get("id");
  const r = load("recipes", []).find((x) => x.id === id);
  if (!r) { app.innerHTML = '<div class="panel empty-hero"><h2>Recipe not found</h2><p>It may have been deleted from your saved recipes.</p><a class="btn" href="/nutrition.html" style="text-decoration:none;margin-top:8px">Back to Nutrition</a></div>'; return; }
  document.title = `${r.title} · FusionChef`;
  const n = r.nutrition || {};
  const total = (r.prep_mins || 0) + (r.cook_mins || 0);

  app.innerHTML = `
    <a class="crumb" href="/nutrition.html"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Saved recipes</a>
    <header class="rhead"><div><span class="tag">${esc(r.cuisine)}</span></div><h1>${esc(r.title)}</h1><p>${esc(r.summary)}</p></header>
    <div class="split">
      <article class="panel scroll">
        <h2>Ingredients</h2><ul>${(r.ingredients || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        <h2>Method</h2><ol>${(r.steps || []).map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol>
      </article>
      <aside class="side">
        <div class="panel">
          <b>Nutrition per serving</b>
          <div class="nut4">
            <div class="kcal"><b>${n.calories ?? "?"}</b><small>kcal</small></div>
            <div style="--c:var(--protein)"><b>${n.protein_g ?? "?"}g</b><small>Protein</small></div>
            <div style="--c:var(--carbs)"><b>${n.carbs_g ?? "?"}g</b><small>Carbs</small></div>
            <div style="--c:var(--fat)"><b>${n.fat_g ?? "?"}g</b><small>Fat</small></div>
          </div>
        </div>
        <div class="panel facts">
          <div><small>Serves</small><b>${r.servings ?? "?"}</b></div>
          <div><small>Total time</small><b>${total} min</b></div>
          <div><small>Prep</small><b>${r.prep_mins ?? "?"} min</b></div>
          <div><small>Cook</small><b>${r.cook_mins ?? "?"} min</b></div>
          <div><small>Difficulty</small><b style="text-transform:capitalize">${esc(r.difficulty || "n/a")}</b></div>
        </div>
        <div class="panel">
          <b>Done cooking?</b>
          <p class="sub" style="margin-top:6px;font-size:13px">Log what you ate to today's calories.</p>
          <div class="logrow">
            <label class="field">Servings <input id="eaten" type="number" min="0.5" step="0.5" value="1" inputmode="decimal"></label>
            <button class="btn" id="logit">Add to today</button>
          </div>
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
