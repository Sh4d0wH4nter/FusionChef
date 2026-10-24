(() => {
  const { load, save, today, parse, daysUntil, uid, esc, itemKcal, qtyLabel, toast, api, ring } = FC;
  const $ = (id) => document.getElementById(id);
  let items = load("items", []);
  const selected = new Set();
  let generated = []; // recipes in the open dialog
  const picked = new Set();

  $("nav").innerHTML = FC.nav("main");
  const stage = (d) => (d <= 2 ? "now" : d <= 7 ? "soon" : "ok");

  function ringHTML(it, d) {
    const total = Math.max(1, Math.round((parse(it.expires) - parse(it.added)) / 864e5));
    const u = Math.abs(d);
    const label = d < 0 ? `<span>${u}</span><small>DAYS OVER</small>` : d === 0 ? `<span>0</span><small>TODAY</small>` : `<span>${u}</span><small>${u === 1 ? "DAY" : "DAYS"}</small>`;
    return `<div class="ring"><svg viewBox="0 0 54 54"><circle class="bg" cx="27" cy="27" r="22"/><circle class="fg" cx="27" cy="27" r="22" ${ring(d / total, 22)}/></svg><b>${label}</b></div>`;
  }

  function render() {
    $("date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    const rows = items.map((it) => ({ it, d: daysUntil(it.expires) })).sort((a, b) => a.d - b.d);
    const lanes = [["now", "Eat now", "Past date or within 2 days"], ["soon", "Use soon", "3 to 7 days left"], ["ok", "Plenty of time", "More than a week"]];
    $("chips").innerHTML = lanes.map(([k, l]) => `<div class="chip" style="--c:var(--${k})"><i></i><b>${rows.filter((x) => stage(x.d) === k).length}</b>${l}</div>`).join("");
    $("board").innerHTML = "";
    for (const [k, title, hint] of lanes) {
      const list = rows.filter((x) => stage(x.d) === k);
      const lane = document.createElement("section");
      lane.className = "lane"; lane.style.setProperty("--c", `var(--${k})`);
      lane.innerHTML = `<h2><i></i>${title}<em>${list.length}</em></h2>`;
      if (!list.length) lane.insertAdjacentHTML("beforeend", `<div class="empty">${hint}: nothing here</div>`);
      for (const { it, d } of list) {
        const kcal = itemKcal(it);
        const el = document.createElement("article");
        el.className = `item panel ${k} ${selected.has(it.id) ? "sel" : ""}`;
        el.innerHTML = `${ringHTML(it, d)}
          <div class="name">${esc(it.name)} <span class="qty">${esc(qtyLabel(it))}</span></div>
          <div class="check">${selected.has(it.id) ? "✓" : ""}</div>
          <div class="meta">${kcal ? `≈ ${kcal} kcal · ` : ""}use by ${parse(it.expires).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>`;
        const rm = document.createElement("button");
        rm.className = "x"; rm.textContent = "remove";
        rm.onclick = (e) => { e.stopPropagation(); selected.delete(it.id); items = items.filter((x) => x.id !== it.id); save("items", items); render(); };
        el.querySelector(".meta").after(rm);
        el.onclick = () => { selected.has(it.id) ? selected.delete(it.id) : selected.add(it.id); render(); };
        lane.appendChild(el);
      }
      $("board").appendChild(lane);
    }
    $("bar").classList.toggle("show", selected.size > 0);
    $("count").textContent = `${selected.size} selected`;
  }

  // ---- adding parsed items ----
  function addParsed(list) {
    const t = today();
    for (const p of list) {
      const name = String(p.name).trim().toLowerCase();
      const food = FC.matchFood(name);
      items.push({
        id: uid(), name, count: p.count ?? null, weight_g: p.weight_g ?? null, food: food?.name ?? null,
        added: t, expires: /^\d{4}-\d{2}-\d{2}$/.test(p.expiry || "") ? p.expiry : addDays(t, 7), guessed: !p.expiry,
      });
    }
    save("items", items); render();
  }
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  const status = (msg, bad) => { $("status").innerHTML = bad ? `<span class="err">${esc(msg)}</span>` : msg; };
  async function submit(body) {
    status('<span class="spin"></span>Understanding that…');
    try {
      const { items: parsed } = await api("/api/parse", body);
      if (!parsed.length) return status("I couldn't find any food items in that. Try again?", true);
      addParsed(parsed);
      const guessed = parsed.filter((p) => !p.expiry).map((p) => p.name);
      status(`Added ${parsed.map((p) => esc(p.name)).join(", ")}.${guessed.length ? ` No expiry heard for ${esc(guessed.join(", "))}, so I set 7 days.` : ""}`);
    } catch (e) { status(e.message, true); }
  }

  $("f").onsubmit = (e) => { e.preventDefault(); const v = $("txt").value.trim(); if (v) { $("txt").value = ""; submit({ text: v }); } };

  // ---- voice: record with MediaRecorder, send audio to Gemma ----
  // If no Gemma model on the key can take audio, fall back to the browser's speech recognition
  // for the transcript (Gemma still parses it into items).
  let audioOK = true;
  fetch("/api/capabilities").then((r) => r.json()).then((c) => { audioOK = c.audio; if (!c.audio) status("Voice upload isn't configured, so the mic uses your browser's speech recognition instead."); }).catch(() => {});
  function browserListen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return status("No audio model is set and this browser has no speech recognition. Type your items instead.", true);
    const sr = new SR(); sr.lang = navigator.language || "en-GB";
    sr.onresult = (e) => submit({ text: e.results[0][0].transcript });
    sr.onerror = (e) => { $("mic").classList.remove("rec"); status(`Speech recognition failed (${e.error}).`, true); };
    sr.onend = () => $("mic").classList.remove("rec");
    sr.start(); $("mic").classList.add("rec"); status("Listening…");
  }
  let rec, chunks = [];
  $("mic").onclick = async () => {
    if (!audioOK) return browserListen();
    if (rec && rec.state === "recording") return rec.stop();
    if (!navigator.mediaDevices?.getUserMedia) return status("This browser can't record audio (try Chrome, on localhost or https).", true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream); chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        $("mic").classList.remove("rec");
        const blob = new Blob(chunks, { type: rec.mimeType });
        const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
        submit({ audio: b64, mime: blob.type.split(";")[0] });
      };
      rec.start(); $("mic").classList.add("rec"); status("Listening… tap the mic again when you're done.");
    } catch { status("Microphone access was blocked.", true); }
  };

  // ---- recipe generation ----
  $("clear").onclick = () => { selected.clear(); render(); };
  $("dclose").onclick = () => $("dlg").close();
  $("gen").onclick = async () => {
    const chosen = items.filter((i) => selected.has(i.id));
    generated = []; picked.clear();
    $("dbody").innerHTML = `<p class="sub"><span class="spin"></span>Asking Gemma for ideas using ${chosen.map((c) => esc(c.name)).join(", ")}…</p>`;
    $("dlg").showModal();
    try {
      const { recipes } = await api("/api/recipes", { ingredients: chosen.map((c) => ({ name: c.name, qty: qtyLabel(c) })) });
      generated = recipes.map((r) => ({ ...r, id: uid() }));
      drawRecipes();
    } catch (e) { $("dbody").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  function drawRecipes() {
    $("dbody").innerHTML = `<div class="sub">Pick the ones you want to save to your Nutrition page.</div>
      <div class="rcards">${generated.map((r) => {
        const n = r.nutrition || {};
        return `<div class="rcard ${picked.has(r.id) ? "sel" : ""}" data-id="${r.id}">
          <div class="check">${picked.has(r.id) ? "✓" : ""}</div>
          <div><b>${esc(r.title)}</b> <span class="tag">${esc(r.cuisine)}</span></div>
          <p>${esc(r.summary)}</p>
          <div class="macros"><span>${n.calories ?? "?"} kcal</span><span>${(r.prep_mins || 0) + (r.cook_mins || 0)} min</span><span>serves ${r.servings ?? "?"}</span></div>
        </div>`;
      }).join("")}</div>
      <button class="btn" id="saveSel" ${picked.size ? "" : "disabled"}>Save ${picked.size || ""} to Nutrition</button>
      <button class="ghost" id="regen" type="button" style="margin-left:8px">Generate more</button>`;
    $("dbody").querySelectorAll(".rcard").forEach((el) => (el.onclick = () => { const id = el.dataset.id; picked.has(id) ? picked.delete(id) : picked.add(id); drawRecipes(); }));
    $("regen").onclick = () => $("gen").click();
    $("saveSel").onclick = () => {
      const saved = load("recipes", []);
      for (const r of generated.filter((g) => picked.has(g.id))) saved.push({ ...r, savedOn: today() });
      save("recipes", saved);
      const n = picked.size;
      $("dlg").close(); selected.clear(); render();
      toast(`Saved ${n} recipe${n > 1 ? "s" : ""}. <a href="/nutrition.html">Open Nutrition →</a>`);
    };
  }

  render();
  FC.foodsReady.then(render);
})();
