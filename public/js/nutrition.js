(() => {
  const { load, save, today, uid, esc, ring } = FC;
  const $ = (id) => document.getElementById(id);
  $("nav").innerHTML = FC.nav("nutrition");
  $("date").textContent = FC.now().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  let log = load("log", []);
  let goal = load("goal", 2000);
  // Rough default split for the macro bars; the goals are easy to make editable later.
  const MACROS = [["Protein", "p", 0.25 / 4, "var(--ok)"], ["Carbs", "c", 0.5 / 4, "var(--soon)"], ["Fat", "f", 0.25 / 9, "var(--accent2)"]];

  function render() {
    const todays = log.filter((l) => l.date === today());
    const sum = (k) => todays.reduce((n, l) => n + (+l[k] || 0), 0);
    const kcal = sum("kcal"), over = kcal > goal;
    $("bigring").className = `bigring ${over ? "over" : ""}`;
    $("bigring").innerHTML = `<svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="42"/><circle class="fg" cx="50" cy="50" r="42" ${ring(kcal / goal, 42)}/></svg>
      <div><b>${kcal}</b><small>${over ? `${kcal - goal} over` : `${goal - kcal} left`} of ${goal} kcal</small></div>`;
    $("bars").innerHTML = MACROS.map(([l, k, perKcal, c]) => {
      const g = Math.round(sum(k)), target = Math.round(goal * perKcal);
      return `<div class="bar" style="--c:${c}"><span>${l}</span><div><i style="--w:${Math.min(100, (g / target) * 100)}%"></i></div><span>${g}/${target} g</span></div>`;
    }).join("");
    $("goal").value = goal;
    $("loglist").innerHTML = todays.length
      ? todays.map((l) => `<div><span>${esc(l.name)}</span><span>${l.kcal} kcal <button class="x" data-id="${l.id}">remove</button></span></div>`).join("")
      : '<div class="sub">Nothing logged today.</div>';

    const recipes = load("recipes", []);
    $("recipes").innerHTML = recipes.length ? "" : '<div class="empty" style="grid-column:1/-1">No saved recipes yet. Generate some on the Kitchen page.</div>';
    for (const r of recipes) {
      const n = r.nutrition || {};
      const a = document.createElement("a");
      a.className = "panel rtile"; a.href = `/recipe.html?id=${encodeURIComponent(r.id)}`; a.target = "_blank";
      a.innerHTML = `<div class="row"><span class="tag">${esc(r.cuisine)}</span><button class="x" data-del="${r.id}">delete</button></div>
        <h3>${esc(r.title)}</h3>
        <div class="macros"><span style="--c:var(--accent)">${n.calories ?? "?"} kcal</span><span style="--c:var(--ok)">P ${n.protein_g ?? "?"}g</span><span style="--c:var(--soon)">C ${n.carbs_g ?? "?"}g</span><span style="--c:var(--accent2)">F ${n.fat_g ?? "?"}g</span></div>
        <div class="sub" style="font-size:12px">per serving · ${(r.prep_mins || 0) + (r.cook_mins || 0)} min</div>`;
      $("recipes").appendChild(a);
    }
  }

  $("recipes").onclick = (e) => {
    const id = e.target.dataset.del; if (!id) return;
    e.preventDefault();
    save("recipes", load("recipes", []).filter((r) => r.id !== id)); render();
  };
  $("loglist").onclick = (e) => { const id = e.target.dataset.id; if (id) { log = log.filter((l) => l.id !== id); save("log", log); render(); } };
  $("goal").onchange = (e) => { goal = Math.max(500, +e.target.value || 2000); save("goal", goal); render(); };
  $("lf").onsubmit = (e) => {
    e.preventDefault();
    log.push({ id: uid(), date: today(), name: $("ln").value.trim(), kcal: +$("lk").value, p: +$("lp").value || 0, c: +$("lc").value || 0, f: +$("lfat").value || 0 });
    save("log", log); e.target.reset(); render();
  };
  // Refresh if a recipe tab logs a cooked meal.
  addEventListener("storage", () => { log = load("log", []); render(); });
  render();
})();
