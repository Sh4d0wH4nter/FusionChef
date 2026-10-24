(() => {
  const { load, save, today, parse, daysUntil, uid, esc, itemKcal, qtyLabel, toast, api, ring } = FC;
  const $ = (id) => document.getElementById(id);
  let items = load("items", []);
  const selected = new Set();
  let generated = []; // recipes in the open dialog
  const picked = new Set();

  $("nav").innerHTML = FC.nav("main");
  const stage = (d) => (d <= 2 ? "now" : d <= 7 ? "soon" : "ok");
  const CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-4.9"/></svg>';

  function ringHTML(it, d) {
    const total = Math.max(1, Math.round((parse(it.expires) - parse(it.added)) / 864e5));
    const u = Math.abs(d);
    const label = d < 0 ? `<span>${u}</span><small>over</small>` : d === 0 ? `<span>0</span><small>today</small>` : `<span>${u}</span><small>${u === 1 ? "day" : "days"}</small>`;
    return `<div class="ring" title="${d < 0 ? `${u} ${u === 1 ? "day" : "days"} past use-by` : d === 0 ? "Use by today" : `${u} ${u === 1 ? "day" : "days"} left`}"><svg viewBox="0 0 54 54"><circle class="bg" cx="27" cy="27" r="22"/><circle class="fg" cx="27" cy="27" r="22" ${ring(d / total, 22)}/></svg><b class="${u >= 100 ? "long" : ""}">${label}</b></div>`;
  }

  function render() {
    $("date").textContent = FC.now().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    renderDev();
    const rows = items.map((it) => ({ it, d: daysUntil(it.expires) })).sort((a, b) => a.d - b.d);
    const lanes = [["now", "Eat now", "Past date or within 2 days"], ["soon", "Use soon", "3 to 7 days left"], ["ok", "Plenty of time", "More than a week"]];
    $("chips").innerHTML = rows.length ? lanes.map(([k, l]) => `<div class="chip" style="--c:var(--${k}-ring)"><i></i><b>${rows.filter((x) => stage(x.d) === k).length}</b>${l}</div>`).join("") : "";
    $("board").innerHTML = rows.length ? "" : `<div class="panel empty-hero" style="grid-column:1/-1">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="none" stroke="var(--line-2)" stroke-width="4"/><circle cx="20" cy="20" r="16" fill="none" stroke="var(--ok-ring)" stroke-width="4" stroke-linecap="round" stroke-dasharray="70 101" transform="rotate(-90 20 20)"/></svg>
      <h2>Nothing tracked yet</h2>
      <p>Add what you bought with the bar above. Each item gets a countdown to its use-by date and moves into "Eat now" when it needs using.</p></div>`;
    for (const [k, title, hint] of rows.length ? lanes : []) {
      const list = rows.filter((x) => stage(x.d) === k);
      const lane = document.createElement("section");
      lane.className = "lane"; lane.style.setProperty("--c", `var(--${k}-ring)`);
      lane.innerHTML = `<div class="lane-head"><h2><i></i>${title} <em>${list.length}</em></h2><small>${hint}</small></div>`;
      if (!list.length) lane.insertAdjacentHTML("beforeend", `<div class="empty">Nothing here</div>`);
      for (const { it, d } of list) {
        const kcal = itemKcal(it), on = selected.has(it.id);
        const el = document.createElement("article");
        el.className = `item panel ${k} ${d < 0 ? "over" : ""} ${on ? "sel" : ""}`;
        el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-pressed", on);
        el.innerHTML = `${ringHTML(it, d)}
          <div class="item-body">
            <div class="name">${esc(it.name)} <span class="qty">${esc(qtyLabel(it))}</span></div>
            <div class="meta">${kcal ? `≈ ${kcal} kcal · ` : ""}Use by ${parse(it.expires).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>
            <div class="actions"></div>
          </div>
          <div class="check">${on ? CHECK : ""}</div>`;
        const ed = document.createElement("button");
        ed.type = "button"; ed.className = "x"; ed.textContent = "Edit";
        ed.onclick = (e) => { e.stopPropagation(); openEdit(it); };
        const rm = document.createElement("button");
        rm.type = "button"; rm.className = "x danger"; rm.textContent = "Remove";
        rm.onclick = (e) => { e.stopPropagation(); selected.delete(it.id); items = items.filter((x) => x.id !== it.id); save("items", items); render(); };
        el.querySelector(".actions").append(ed, rm);
        el.onclick = () => { selected.has(it.id) ? selected.delete(it.id) : selected.add(it.id); render(); };
        // The card is the selection toggle, so it has to work from the keyboard too.
        el.onkeydown = (e) => {
          if (e.target !== el || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault(); el.click();
          requestAnimationFrame(() => document.querySelector(`[data-item="${it.id}"]`)?.focus());
        };
        el.dataset.item = it.id;
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
      const q = FC.applyDefaults({ ...p, name });
      const said = /^\d{4}-\d{2}-\d{2}$/.test(q.expiry || "");
      items.push({
        id: uid(), name, count: q.count, weight_g: q.weight_g, pack: q.pack, food: food?.name ?? null,
        added: t, expires: said ? q.expiry : addDays(t, q.shelf_days || 7), guessed: !said,
      });
    }
    save("items", items); render();
  }
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  const status = (msg, bad) => { $("status").innerHTML = bad ? `<span class="err">${esc(msg)}</span>` : msg; };
  async function submit(body) {
    const ctl = new AbortController();
    status('<span class="spin"></span>Understanding that… <button class="x" id="pcancel" type="button">cancel</button>');
    $("pcancel").onclick = () => ctl.abort();
    try {
      const { items: parsed } = await api("/api/parse", body, { signal: ctl.signal });
      if (!parsed.length) return status("I couldn't find any food items in that. Try again?", true);
      addParsed(parsed);
      const guessed = parsed.filter((p) => !p.expiry).map((p) => p.name);
      status(`Added ${parsed.map((p) => esc(p.name)).join(", ")}.${guessed.length ? ` No expiry heard for ${esc(guessed.join(", "))}, so I guessed a typical shelf life (change it with edit).` : ""}`);
    } catch (e) { e.cancelled ? status("Cancelled.") : status(e.message, true); }
  }

  $("f").onsubmit = (e) => { e.preventDefault(); const v = $("txt").value.trim(); if (v) { $("txt").value = ""; submit({ text: v }); } };

  // ---- voice: record with MediaRecorder, send audio to the model ----
  // If no Gemma model on the key can take audio, fall back to the browser's speech recognition
  // for the transcript (Gemma still parses it into items).
  let audioOK = true;
  fetch("/api/capabilities").then((r) => r.json()).then((c) => { audioOK = c.audio; if (!c.audio) status("Voice upload isn't configured, so the mic uses your browser's speech recognition instead."); }).catch(() => {});
  function browserListen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return status("No audio model is set and this browser has no speech recognition. Type your items instead.", true);
    const sr = new SR(); sr.lang = navigator.language || "en-GB";
    sr.onresult = (e) => submit({ text: e.results[0][0].transcript });
    sr.onerror = (e) => { $("mic").classList.remove("rec"); status(e.error === "service-not-allowed" || e.error === "not-allowed"
      ? "Speech recognition is blocked. Use Google Chrome (Brave/Arc/Edge lack the speech service), allow the microphone for localhost, and on Safari turn on Dictation in System Settings > Keyboard. You can also just type your items."
      : `Speech recognition failed (${e.error}).`, true); };
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

  // ---- edit an item ----
  let editing = null;
  function openEdit(it) {
    editing = it;
    $("e-name").value = it.name; $("e-count").value = it.count ?? ""; $("e-weight").value = it.weight_g ?? ""; $("e-exp").value = it.expires;
    $("edlg").showModal();
  }
  $("e-cancel").onclick = () => $("edlg").close();
  $("eform").onsubmit = (e) => {
    e.preventDefault();
    const name = $("e-name").value.trim().toLowerCase(); if (!name || !editing) return;
    const count = $("e-count").value === "" ? null : +$("e-count").value, weight_g = $("e-weight").value === "" ? null : +$("e-weight").value;
    if (count !== editing.count || weight_g !== editing.weight_g) editing.pack = null; // a typed amount replaces the pack label
    Object.assign(editing, { name, count, weight_g, expires: $("e-exp").value || editing.expires, food: FC.matchFood(name)?.name ?? null, guessed: false });
    save("items", items); $("edlg").close(); render();
  };

  // ---- developer mode: step "today" forward to demo expiring cards ----
  const devOn = () => { try { return localStorage.getItem("fc.dev") === "1"; } catch { return false; } };
  function renderDev() {
    const off = FC.getOffset();
    $("devbox").hidden = !devOn();
    $("devtoggle").checked = devOn();
    $("devinfo").textContent = off ? `Demo date: ${FC.now().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} (+${off} day${off > 1 ? "s" : ""})` : "Demo date: real today";
  }
  $("devtoggle").onchange = (e) => { try { localStorage.setItem("fc.dev", e.target.checked ? "1" : "0"); } catch {} if (!e.target.checked) FC.setOffset(0); render(); };
  $("nextday").onclick = () => { FC.setOffset(FC.getOffset() + 1); render(); };
  $("resetday").onclick = () => { FC.setOffset(0); render(); };

  // ---- recipe generation ----
  $("clear").onclick = () => { selected.clear(); render(); };
  $("dclose").onclick = () => $("dlg").close();
  $("gen").onclick = async () => {
    const chosen = items.filter((i) => selected.has(i.id));
    generated = []; picked.clear();
    $("dbody").innerHTML = `<p class="loading-line"><span class="spin"></span>Asking the AI for ideas using ${chosen.map((c) => esc(c.name)).join(", ")}… this can take up to a minute and a half.</p>
      <div class="rcards" aria-hidden="true">${'<div class="skel"></div>'.repeat(3)}</div>
      <button class="ghost" id="rcancel" type="button">Cancel</button><div style="height:24px"></div>`;
    const ctl = new AbortController();
    $("rcancel").onclick = () => ctl.abort();
    if (!$("dlg").open) $("dlg").showModal();
    try {
      const { recipes } = await api("/api/recipes", { ingredients: chosen.map((c) => ({ name: c.name, qty: qtyLabel(c) })) }, { signal: ctl.signal });
      generated = recipes.map((r) => ({ ...r, id: uid() }));
      drawRecipes();
    } catch (e) {
      $("dbody").innerHTML = `<div class="errbox" role="alert"><b>${e.cancelled ? "Cancelled" : "Couldn't get recipe ideas"}</b><p>${e.cancelled ? "No recipes were generated." : esc(e.message)}</p><button class="ghost" id="retry" type="button">Try again</button></div>`;
      $("retry").onclick = () => $("gen").click();
    }
  };
  function drawRecipes() {
    $("dbody").innerHTML = `<div class="rcards">${generated.map((r) => {
        const n = r.nutrition || {}, on = picked.has(r.id);
        return `<div class="rcard ${on ? "sel" : ""}" data-id="${r.id}" tabindex="0" role="checkbox" aria-checked="${on}">
          <div class="check">${on ? CHECK : ""}</div>
          <div class="rcard-title"><b>${esc(r.title)}</b> <span class="tag">${esc(r.cuisine)}</span></div>
          <p>${esc(r.summary)}</p>
          <div class="facts-line"><span>${n.calories ?? "?"} kcal</span><span>${(r.prep_mins || 0) + (r.cook_mins || 0)} min</span><span>Serves ${r.servings ?? "?"}</span></div>
        </div>`;
      }).join("")}</div>
      <div class="dfoot"><span class="hint">${picked.size ? `${picked.size} selected` : "Select the ones to keep"}</span>
        <button class="ghost" id="regen" type="button" style="height:40px">Generate more</button>
        <button class="btn" id="saveSel" ${picked.size ? "" : "disabled"}>Save ${picked.size || ""} to Nutrition</button></div>`;
    $("dbody").querySelectorAll(".rcard").forEach((el) => {
      el.onclick = () => { const id = el.dataset.id; picked.has(id) ? picked.delete(id) : picked.add(id); drawRecipes(); $("dbody").querySelector(`[data-id="${id}"]`)?.focus(); };
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } };
    });
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
  FC.defaultsReady.then(render);
})();
