// FusionChef server: serves ./public and proxies Gemma calls so the API key stays server-side.
// No dependencies; needs Node 18+.
const http = require("http");
const fs = require("fs");
const path = require("path");

// Minimal .env loader
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PORT = process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY;
// Vertex AI (uses Google Cloud credits). Set VERTEX_PROJECT and sign in with
// `gcloud auth application-default login`. No API key needed. Two flavours:
//  - VERTEX_ENDPOINT_ID set: your own Model Garden deployment of Gemma (e.g. gemma-4-e4b-it), OpenAI-style chat API.
//  - otherwise: Google-hosted publisher models via generateContent (VERTEX_MODEL, e.g. gemini-2.5-flash or the
//    serverless gemma-4-26b-a4b-it-maas).
const env = process.env;
let VERTEX = env.VERTEX_PROJECT
  ? { project: env.VERTEX_PROJECT, location: env.VERTEX_LOCATION || "us-central1",
      model: env.VERTEX_MODEL || "gemini-2.5-flash", audioModel: env.VERTEX_AUDIO_MODEL || env.VERTEX_MODEL || "gemini-2.5-flash" }
  : null;
// OpenRouter (takes priority when OPENROUTER_API_KEY is set). Same request shape as Cookbook-Maker-v2:
// POST https://openrouter.ai/api/v1/chat/completions with a Bearer key. Models are OpenRouter ids.
//  - OPENROUTER_MODEL: text model (default: first of a built-in pool of fast free models)
//  - OPENROUTER_FALLBACK_MODELS: comma-separated ids tried in order if the main one fails (e.g. free models get rate-limited)
//  - OPENROUTER_AUDIO_MODEL: optional audio-capable model (e.g. google/gemini-2.5-flash). Unset = mic uses browser speech recognition.
// Free text models, roughly fastest-first (small active-parameter MoE models before big reasoning ones). Order is a guess:
// the server then reorders by the latency it actually measures and sidelines models that time out or error for a few minutes.
const OR_POOL = ["google/gemma-4-26b-a4b-it:free", "xingchen-agi/xing4.0-29b-a4b:free", "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free", "recursive/flint-v1.0:free", "poolside/laguna-xs-2.1:free"];
const OR = env.OPENROUTER_API_KEY
  ? { key: env.OPENROUTER_API_KEY, base: (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      model: env.OPENROUTER_MODEL || OR_POOL[0],
      fallbacks: env.OPENROUTER_FALLBACK_MODELS ? env.OPENROUTER_FALLBACK_MODELS.split(",").map((x) => x.trim()).filter(Boolean) : OR_POOL.slice(1),
      timeoutMs: Number(env.OPENROUTER_TIMEOUT_MS) || 45e3, // per model attempt
      deadlineMs: Number(env.OPENROUTER_DEADLINE_MS) || 90e3, // whole request, then give up with a clear error
      hedgeMs: Number(env.OPENROUTER_HEDGE_MS) || 15e3, // if the first model is still silent after this, start the next one in parallel
      parallel: Number(env.OPENROUTER_PARALLEL) || 2, coolMs: Number(env.OPENROUTER_COOLDOWN_MS) || 3 * 60e3,
      audioModel: env.OPENROUTER_AUDIO_MODEL || null, maxTokens: Number(env.OPENROUTER_MAX_TOKENS) || null,
      reasoning: env.OPENROUTER_REASONING || null, structured: env.OPENROUTER_STRUCTURED === "1" }
  : null;
const ENDPOINT = !OR && VERTEX && env.VERTEX_ENDPOINT_ID
  ? { id: env.VERTEX_ENDPOINT_ID, dns: env.VERTEX_ENDPOINT_DNS || null,
      api: (env.VERTEX_ENDPOINT_API || "chat").toLowerCase(), // "chat" (.../chat/completions) or "rawpredict" (:rawPredict)
      model: env.VERTEX_ENDPOINT_MODEL || "", audio: env.VERTEX_ENDPOINT_AUDIO !== "0", maxTokens: Number(env.VERTEX_MAX_TOKENS) || 4096 }
  : null;
if (env.VERTEX_ENDPOINT_ID && !VERTEX) console.warn("VERTEX_ENDPOINT_ID is set but VERTEX_PROJECT is not; ignoring it.");
if (OR) VERTEX = null;
if (ENDPOINT) VERTEX.model = VERTEX.audioModel = ENDPOINT.model || "gemma-4-e4b-it";
let textModel = process.env.GEMMA_MODEL || null;
// Audio model: from .env, else auto-detected from the models this key can call (see /api/models).
let audioModel = process.env.GEMMA_AUDIO_MODEL || null;
let modelList = null;
async function listModels() {
  if (OR) return [OR.model, ...OR.fallbacks];
  if (VERTEX) return [VERTEX.model];
  if (modelList) return modelList;
  if (!KEY) throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": KEY } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "Could not list models");
  return (modelList = j.models.filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace("models/", "")));
}
// Prefer the largest Gemma 4 the key offers, else any newer Gemma.
async function findTextModel() {
  if (OR) return OR.model;
  if (VERTEX) return VERTEX.model;
  if (textModel) return textModel;
  const names = await listModels();
  const gemmas = names.filter((n) => /^gemma/.test(n) && !/tts|embed/.test(n));
  const pick = gemmas.find((n) => /gemma-4.*31b/.test(n)) || gemmas.find((n) => /gemma-4/.test(n)) || gemmas[0];
  if (!pick) throw new Error("No Gemma model is available on this API key. Set GEMMA_MODEL in .env.");
  return (textModel = pick);
}
// Text models to try in order (the picked one first, then other Gemmas) in case one is overloaded.
async function textModels() {
  if (OR) return [OR.model, ...OR.fallbacks.filter((m) => m !== OR.model)];
  if (VERTEX) return [VERTEX.model];
  const first = await findTextModel();
  const others = (await listModels().catch(() => [])).filter((n) => /^gemma/.test(n) && !/tts|embed/.test(n) && n !== first);
  return [first, ...others];
}
async function findAudioModel() {
  if (OR) return OR.audioModel;
  if (ENDPOINT) return ENDPOINT.audio ? VERTEX.audioModel : null;
  if (VERTEX) return VERTEX.audioModel;
  if (audioModel) return audioModel;
  return (audioModel = (await listModels()).find((n) => /^gemma-(3n|4)-e\d/.test(n)) || null);
}
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

let tokenCache = { value: null, at: 0 };
// Node started from a Dock/Finder-launched terminal on macOS often lacks Homebrew and the Google SDK installer's dirs on PATH.
const gcloudEnv = () => {
  const home = require("os").homedir();
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", `${home}/google-cloud-sdk/bin`, "/opt/homebrew/share/google-cloud-sdk/bin", "/usr/local/share/google-cloud-sdk/bin", "/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin"];
  return { ...process.env, PATH: [process.env.PATH, ...extra].filter(Boolean).join(path.delimiter) };
};
function gcloud(args) {
  return new Promise((resolve, reject) =>
    require("child_process").execFile(env.GCLOUD_PATH || "gcloud", args, { shell: process.platform === "win32", env: gcloudEnv(), timeout: 30e3 }, (err, out, errout) =>
      err ? reject(new Error((errout || err.message).trim().slice(0, 300))) : resolve(out.trim())));
}
async function vertexToken(force) {
  if (env.VERTEX_ACCESS_TOKEN) return env.VERTEX_ACCESS_TOKEN; // e.g. `gcloud auth print-access-token`, or a test token
  if (!force && tokenCache.value && Date.now() - tokenCache.at < 45 * 60e3) return tokenCache.value;
  let value;
  try { value = await gcloud(["auth", "application-default", "print-access-token"]); }
  catch (e1) {
    // ADC not set up: fall back to the plain gcloud login so a quick start still works.
    try { value = await gcloud(["auth", "print-access-token"]); }
    catch { throw new Error(`Could not get a Google Cloud token. Install the gcloud CLI (or set GCLOUD_PATH to its full path) and run "gcloud auth application-default login". (${e1.message})`); }
  }
  tokenCache = { value, at: Date.now() };
  return value;
}
const vertexHost = (location) => (location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`);
async function endpoint(model) {
  if (OR) return { url: `${OR.base}/chat/completions`, headers: { authorization: `Bearer ${OR.key}`, "x-title": "FusionChef" } };
  if (!VERTEX) {
    if (!KEY) throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
    return { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, headers: { "x-goog-api-key": KEY } };
  }
  const { project, location } = VERTEX;
  const headers = { authorization: `Bearer ${await vertexToken()}`, "x-goog-user-project": project };
  if (ENDPOINT) {
    // Dedicated public endpoints answer on their own DNS name (shown in the endpoint's details); the shared regional host also works for many setups.
    const host = ENDPOINT.dns || vertexHost(location);
    const base = `${/^https?:/.test(host) ? host : "https://" + host}/v1beta1/projects/${project}/locations/${location}/endpoints/${ENDPOINT.id}`;
    return { url: ENDPOINT.api === "rawpredict" ? `${base}:rawPredict` : `${base}/chat/completions`, headers };
  }
  return { url: `https://${vertexHost(location)}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`, headers };
}

// The schemas below use Gemini's OpenAPI dialect (upper-case types, nullable). Convert for OpenAI-style servers.
function toJsonSchema(s) {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== "object") return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) if (k !== "nullable") o[k] = k === "type" ? String(v).toLowerCase() : toJsonSchema(v);
  if (s.nullable && o.type) o.type = [o.type, "null"];
  return o;
}
// Gemini-style parts -> OpenAI chat content. Audio goes as a data URI (vLLM's `audio_url`); `audioStyle` "input_audio" is the OpenAI-native variant.
function toChatContent(parts, audioStyle) {
  return parts.map((p) => {
    if (p.text !== undefined) return { type: "text", text: p.text };
    const mime = p.inline_data.mime_type, data = p.inline_data.data;
    if (audioStyle === "input_audio") return { type: "input_audio", input_audio: { data, format: mime.split("/")[1].replace(/^x-/, "").replace("mpeg", "mp3") } };
    return { type: "audio_url", audio_url: { url: `data:${mime};base64,${data}` } };
  });
}
// Vertex can answer a failed container call with HTTP 200 and an error object inside `predictions`.
const unwrapPredict = (j) => {
  const p = Array.isArray(j.predictions) ? j.predictions[0] : j.predictions;
  const inner = p && typeof p === "object" ? p : j;
  if (inner.object === "error" || (inner.error && !inner.choices)) throw Object.assign(new Error(inner.message || inner.error?.message || JSON.stringify(inner).slice(0, 300)), { status: inner.code || 400 });
  return inner;
};

async function post(model, makeBody) {
  // Retry overloaded (503) / rate-limited (429) / gateway errors and network blips with backoff; refresh an expired token once.
  let r, j, refreshed = false, lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ep = await endpoint(model);
    try {
      r = await fetch(ep.url, { method: "POST", headers: { "content-type": "application/json", ...ep.headers }, body: JSON.stringify(makeBody()), signal: AbortSignal.timeout(180e3) });
      const raw = await r.text();
      try { j = JSON.parse(raw); } catch { j = { error: { message: raw.slice(0, 300) } }; }
    } catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt)); continue; }
    if (r.status === 401 && !refreshed) { refreshed = true; tokenCache = { value: null, at: 0 }; continue; }
    if (![429, 502, 503, 504].includes(r.status)) break;
    const wait = Number(r.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt;
    await new Promise((res) => setTimeout(res, Math.min(wait, 20e3)));
  }
  if (!r) throw new Error(`Could not reach the model: ${lastErr?.message}`);
  if (!r.ok) throw new Error(j.error?.message || j[0]?.error?.message || `Model request failed (${r.status})`);
  return j;
}

// Self-deployed Gemma on a Vertex endpoint (OpenAI-style chat). Tries the JSON schema first, then plain.
async function gemmaEndpoint(model, parts, schema) {
  const hasAudio = parts.some((p) => p.inline_data);
  const build = (audioStyle) => () => {
    const body = { messages: [{ role: "user", content: hasAudio ? toChatContent(parts, audioStyle) : parts.map((p) => p.text).join("\n\n") }], temperature: 0.4, max_tokens: ENDPOINT.maxTokens };
    if (ENDPOINT.model) body.model = ENDPOINT.model;
    if (schema) body.response_format = { type: "json_schema", json_schema: { name: "result", schema: toJsonSchema(schema) } };
    return body;
  };
  let j;
  try { j = await post(model, build("audio_url")); }
  catch (e) {
    // Some vLLM builds only take OpenAI's `input_audio` shape; try it once before giving up on audio.
    if (!hasAudio || !/audio|content|multimodal/i.test(e.message)) throw e;
    j = await post(model, build("input_audio"));
  }
  const c = unwrapPredict(j).choices?.[0];
  return { text: String(c?.message?.content ?? ""), finish: c?.finish_reason || "unknown", nparts: c ? 1 : 0 };
}

// OpenRouter chat completions. Structured output via response_format json_schema (not every model supports it;
// askJSON then retries without). Audio goes as OpenAI-style input_audio parts.
// OpenRouter wraps upstream failures as "Provider returned error"; the useful detail is in error.metadata (raw text, provider name).
const orDetail = (e) => {
  const m = e?.metadata || {};
  let raw = m.raw; if (raw && typeof raw === "object") raw = raw.error?.message || raw.message || JSON.stringify(raw);
  return [e?.message || "error", m.provider_name && `via ${m.provider_name}`, raw && String(raw).slice(0, 200), e?.code && `code ${e.code}`].filter(Boolean).join(" · ");
};
const orKind = (code) => (Number(code) === 429 ? "rate" : Number(code) >= 500 ? "server" : "bad");
class AIError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } } // kind: timeout | rate | server | aborted | bad
// One OpenRouter call with its own timeout; `signal` lets the orchestrator cancel it once another model has won.
async function orPost(body, signal) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal.addEventListener("abort", onAbort);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, OR.timeoutMs);
  try {
    const r = await fetch(`${OR.base}/chat/completions`, { method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${OR.key}`, "x-title": "FusionChef" }, body: JSON.stringify(body) });
    const raw = await r.text();
    let j; try { j = JSON.parse(raw); } catch { j = { error: { message: raw.slice(0, 300) } }; }
    if (!r.ok) throw new AIError(j.error ? orDetail(j.error) : `HTTP ${r.status}`, r.status === 429 ? "rate" : r.status >= 500 ? "server" : "bad");
    return j;
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (timedOut) throw new AIError(`no answer within ${OR.timeoutMs / 1000}s`, "timeout");
    if (signal.aborted) throw new AIError("cancelled", "aborted");
    throw new AIError(`network error: ${e.message}`, "server");
  } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
}
async function gemmaOpenRouter(model, parts, schema, signal) {
  const hasAudio = parts.some((p) => p.inline_data);
  // Keep the request as plain as Cookbook-Maker-v2's working one: model, temperature, messages. Extras (reasoning, response_format,
  // max_tokens) are opt-in because several free providers reject or stall on them.
  const body = { model, temperature: 0.3,
    messages: [{ role: "user", content: hasAudio ? toChatContent(parts, "input_audio") : parts.map((p) => p.text).join("\n\n") }] };
  if (OR.maxTokens) body.max_tokens = OR.maxTokens;
  if (OR.reasoning) body.reasoning = { effort: OR.reasoning };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "result", strict: false, schema: toJsonSchema(schema) } };
  const j = await orPost(body, signal);
  // OpenRouter can answer HTTP 200 with an error object (e.g. upstream provider failure).
  if (j.error && !j.choices) throw new AIError(orDetail(j.error), orKind(j.error.code));
  const c = j.choices?.[0];
  if (c?.error) throw new AIError(orDetail(c.error), orKind(c.error.code));
  return { text: String(c?.message?.content ?? ""), finish: c?.finish_reason || "unknown", nparts: c ? 1 : 0 };
}

async function gemma(model, parts, schema) {
  if (OR) return gemmaOpenRouter(model, parts, schema);
  if (ENDPOINT) return gemmaEndpoint(model, parts, schema);
  const generationConfig = { temperature: 0.4 };
  if (schema) Object.assign(generationConfig, { responseMimeType: "application/json", responseSchema: schema });
  const j = await post(model, () => ({ contents: [{ role: "user", parts }], generationConfig }));
  const ps = j.candidates?.[0]?.content?.parts || [];
  // Prefer answer parts; fall back to thought parts only if that is all the model sent.
  const answer = ps.filter((p) => !p.thought).map((p) => p.text || "").join("");
  return { text: answer.trim() ? answer : ps.map((p) => p.text || "").join(""), finish: j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || "unknown", nparts: ps.length };
}

// Pull the JSON value out of a reply that may include prose or code fences. Try every
// bracket start and keep the longest value that parses, so stray "[1]" in a preamble
// or a nested object can't win over the real answer.
function extractJSON(text) {
  const t = text.replace(/```(?:json)?/g, "");
  let best = null, bestLen = 0;
  for (const m of t.matchAll(/[\[{]/g)) {
    const close = m[0] === "[" ? "]" : "}";
    for (let e = t.lastIndexOf(close); e > m.index; e = t.lastIndexOf(close, e - 1)) {
      if (e - m.index + 1 <= bestLen) break;
      try { best = JSON.parse(t.slice(m.index, e + 1)); bestLen = e - m.index + 1; break; } catch {}
    }
  }
  if (best === null) throw new Error(`Model did not return JSON. It said: "${text.trim().slice(0, 200)}"`);
  return best;
}

// Ask for JSON and make sure we get usable JSON back. Attempt 1 uses the API's structured
// output (schema enforced by the server); if the model rejects it, returns nothing, or the
// result fails validation, attempt 2 relies on the prompt's template alone.
const noSchema = new Set(); // models that rejected JSON mode; skip straight to the prompt template
// OpenRouter flow: models are tried in order of measured speed; a slow one is raced by the next after hedgeMs, a failing one is
// replaced at once, the first valid answer wins and cancels the rest, and the whole thing gives up after deadlineMs.
const orStats = new Map(); // model -> { avgMs, until }
const orOrder = (models) => {
  const now = Date.now(), st = (m) => orStats.get(m) || {};
  const live = models.filter((m) => !(st(m).until > now)), cooling = models.filter((m) => st(m).until > now);
  return [...live.sort((a, b) => (st(a).avgMs ?? 12e3) - (st(b).avgMs ?? 12e3)), ...cooling];
};
const orNote = (model, ok, ms, kind) => {
  const s = orStats.get(model) || {};
  if (ok) orStats.set(model, { avgMs: s.avgMs ? (s.avgMs + ms) / 2 : ms, until: 0 });
  else if (kind !== "aborted") orStats.set(model, { ...s, until: Date.now() + (kind === "bad" ? 60e3 : OR.coolMs) });
};
async function orTry(model, parts, schema, validate, signal) {
  let last;
  for (const sch of noSchema.has(model) || !OR.structured ? [null] : [schema, null]) {
    const tag = `${model}${sch ? " (schema)" : ""}`, t0 = Date.now();
    try {
      const { text, finish } = await gemmaOpenRouter(model, parts, sch, signal);
      if (!text.trim()) throw new AIError(`empty reply (finish=${finish})`, "bad");
      let out; try { out = validate(extractJSON(text)); } catch (e) { throw new AIError(e.message, "bad"); }
      orNote(model, true, Date.now() - t0);
      console.log(`[ai] ok: ${tag} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return out;
    } catch (e) {
      last = e;
      if (e.kind !== "aborted") console.warn(`[ai] failed: ${tag} after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e.message.slice(0, 200)}${e.kind === "timeout" || e.kind === "rate" || e.kind === "server" ? " (skipping this model for a few minutes)" : ""}`);
      if (sch && /json mode|response_?mime|response_format|json_schema|guided|schema/i.test(e.message)) noSchema.add(model);
      if (["timeout", "rate", "server", "aborted"].includes(e.kind)) break; // no point retrying the same slow or limited model
    }
  }
  orNote(model, false, 0, last.kind);
  throw last;
}
function askJSONOR(models, parts, schema, validate) {
  const order = orOrder([].concat(models));
  return new Promise((resolve, reject) => {
    const ctl = new AbortController(), timers = [], errs = [];
    let next = 0, running = 0, done = false;
    const end = (fn, v) => { if (done) return; done = true; ctl.abort(); timers.forEach(clearTimeout); fn(v); };
    const launch = () => {
      if (done || next >= order.length) return false;
      const model = order[next++]; running++;
      timers.push(setTimeout(() => { if (!done && running < OR.parallel) launch(); }, OR.hedgeMs));
      orTry(model, parts, schema, validate, ctl.signal).then((out) => end(resolve, out), (e) => {
        running--; errs.push(`${model}: ${e.message.slice(0, 220)}`);
        if (!done && !launch() && running === 0) end(reject, new Error(`No model could answer right now. ${errs.join(" | ")}`));
      });
      return true;
    };
    timers.push(setTimeout(() => end(reject, new Error(`The AI took too long (over ${OR.deadlineMs / 1000}s) and was stopped. Try again in a moment. ${errs.join(" | ")}`)), OR.deadlineMs));
    if (!launch()) end(reject, new Error("No models configured"));
  });
}
async function askJSON(models, parts, schema, validate) {
  if (OR) return askJSONOR(models, parts, schema, validate);
  const problems = [];
  for (const model of [].concat(models)) {
    for (const sch of noSchema.has(model) ? [null] : [schema, null]) {
      const tag = `${model}${sch ? " (schema)" : ""}`;
      try {
        const { text, finish, nparts } = await gemma(model, parts, sch);
        if (!text.trim()) { problems.push(`${tag}: empty reply (finish=${finish}, parts=${nparts})`); console.warn(`[ai] failed: ${tag}: empty reply (finish=${finish})`); continue; }
        const out = validate(extractJSON(text));
        console.log(`[ai] ok: ${tag}`);
        return out;
      } catch (e) {
        problems.push(`${tag}: ${e.message}`);
        console.warn(`[ai] failed: ${tag}: ${e.message.slice(0, 200)}`);
        if (sch && /json mode|response_?mime|response_format|json_schema|guided|schema/i.test(e.message)) noSchema.add(model);
      }
    }
  }
  throw new Error(`The model did not return usable JSON. ${problems.join(" | ")}`);
}
const S = (type, extra) => ({ type, ...extra });
const ITEM_SCHEMA = S("ARRAY", { items: S("OBJECT", {
  properties: { name: S("STRING"), count: S("NUMBER", { nullable: true }), weight_g: S("NUMBER", { nullable: true }), expiry: S("STRING", { nullable: true }) },
  required: ["name"] }) });
const RECIPE_SCHEMA = S("ARRAY", { items: S("OBJECT", {
  properties: {
    title: S("STRING"), cuisine: S("STRING"), summary: S("STRING"), servings: S("NUMBER"), prep_mins: S("NUMBER"), cook_mins: S("NUMBER"), difficulty: S("STRING"),
    nutrition: S("OBJECT", { properties: { calories: S("NUMBER"), protein_g: S("NUMBER"), carbs_g: S("NUMBER"), fat_g: S("NUMBER") }, required: ["calories", "protein_g", "carbs_g", "fat_g"] }),
    ingredients: S("ARRAY", { items: S("STRING") }), steps: S("ARRAY", { items: S("STRING") }) },
  required: ["title", "cuisine", "summary", "servings", "nutrition", "ingredients", "steps"] }) });
const asArray = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x).find(Array.isArray) || [x] : []);
const validItems = (x) => { const a = asArray(x).filter((i) => i && typeof i.name === "string" && i.name.trim()); if (!a.length) throw new Error("no items in reply"); return a; };
// Sanity checks so nonsense recipes are dropped (and the model is asked again) instead of shown.
const PANTRY = /\b(oil|salt|pepper|spice|herb|water|butter|sugar|flour|vinegar|stock|broth|soy|sauce|garlic|onion|paste|cumin|paprika|oregano|basil|thyme|chilli|chili|turmeric|coriander|ginger|lemon|lime|mustard|honey|rice|pasta|bread|milk|cream|cheese|egg|tomato|seasoning|curry|powder)\b/i;
const sane = (have) => (r) => {
  const n = r.nutrition || {}, num = (v) => Number.isFinite(Number(v));
  if (!r.title || !Array.isArray(r.steps) || r.steps.length < 3 || !Array.isArray(r.ingredients) || r.ingredients.length < 2) return false;
  if (![n.calories, n.protein_g, n.carbs_g, n.fat_g].every(num) || n.calories < 50 || n.calories > 1800) return false;
  const macro = 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g; // macros should roughly add up to the calories
  if (macro < n.calories * 0.5 || macro > n.calories * 1.6) return false;
  if (r.servings < 1 || r.servings > 12 || r.prep_mins > 240 || r.cook_mins > 480) return false;
  // At least half the ingredient lines must use something the user has or a basic pantry item.
  const used = r.ingredients.filter((i) => PANTRY.test(i) || have.some((h) => new RegExp(h.replace(/[^a-z ]/g, "").split(" ").pop().replace(/s$/, ""), "i").test(i))).length;
  return used >= r.ingredients.length * 0.5;
};
const validRecipes = (have) => (x) => {
  const a = asArray(x).filter((r) => r && sane(have)(r));
  if (a.length < 2) throw new Error(`only ${a.length} sensible recipes in reply`);
  return a;
};

const isoToday = () => new Date().toISOString().slice(0, 10);

const PARSE_PROMPT = () => `Today is ${isoToday()} (${new Date().toLocaleDateString("en-GB", { weekday: "long" })}).
Extract the grocery/food items from the user's input. Reply with ONLY a JSON array, no other text. Each element:
{"name": string (singular, lowercase, e.g. "egg", "chicken breast"), "count": number|null (number of items, e.g. 2 for "2 eggs"), "weight_g": number|null (convert kg/oz/lb to grams), "expiry": "YYYY-MM-DD"|null}
Resolve relative expiry dates ("Friday", "in 3 days", "next week") against today's date. Use null when something was not said; never invent a quantity or expiry. Units: 1 litre of liquid = 1000 g, a dozen = 12, "half a dozen" = 6. If the user says "a carton of milk" or similar with no size, leave weight_g null. Fix obvious speech-recognition slips (e.g. "eggs" not "X").`;

const handlers = {
  async "/api/capabilities"() {
    let models = [], listError = null;
    if (ENDPOINT) models = [`endpoint ${ENDPOINT.id}`];
    else if (VERTEX) {
      // Best-effort list of Gemini models this project can see, to help pick VERTEX_MODEL.
      try {
        const { location } = VERTEX;
        const r = await fetch(`https://${vertexHost(location)}/v1beta1/publishers/google/models?pageSize=200`, { headers: { authorization: `Bearer ${await vertexToken()}`, "x-goog-user-project": VERTEX.project } });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error?.message || r.status);
        models = (j.publisherModels || []).map((m) => m.name.split("/").pop()).filter((n) => /^(gemini|gemma)/.test(n));
      } catch (e) { listError = String(e.message).slice(0, 300); }
    } else try { models = await listModels(); } catch {}
    return { backend: OR ? `openrouter (${OR.model})` : ENDPOINT ? `vertex endpoint ${ENDPOINT.id} (${VERTEX.project}, ${VERTEX.location}, ${ENDPOINT.api})` : VERTEX ? `vertex (${VERTEX.project}, ${VERTEX.location})` : "ai-studio", audio: !!(await findAudioModel().catch(() => null)), textModel: await findTextModel().catch(() => null), audioModel, models, listError };
  },

  async "/api/parse"(body) {
    // body: {text} or {audio: base64, mime}
    const parts = [{ text: PARSE_PROMPT() }];
    let model = await findTextModel();
    if (body.audio) {
      parts.push({ inline_data: { mime_type: body.mime || "audio/webm", data: body.audio } });
      model = await findAudioModel();
      if (!model) throw new Error("No audio model is configured (set OPENROUTER_AUDIO_MODEL, or use the browser speech option). Use the typed box, or the browser speech option, until one is available.");
    } else parts.push({ text: `User input: ${body.text}` });
    return { items: await askJSON(body.audio ? model : await textModels(), parts, ITEM_SCHEMA, validItems) };
  },

  async "/api/recipes"(body) {
    const list = (body.ingredients || []).map((i) => `- ${i.name}${i.qty ? " (" + i.qty + ")" : ""}`).join("\n");
    const cuisines = body.cuisines?.length ? body.cuisines.join(", ") : "a varied mix, e.g. Italian, Indian, Mexican, Japanese, Thai, Mediterranean";
    const have = (body.ingredients || []).map((i) => String(i.name).toLowerCase());
    const prompt = `You are an experienced home cook. Suggest 4 different recipes, each from a different cuisine (${cuisines}), that make good use of these ingredients (assume basic pantry staples like oil, salt, pepper, common spices, flour, sugar, stock):
${list}

Rules:
- Only real, well-known dishes or sensible variations that a cook would actually make. No odd food combinations (no fruit in savoury dishes unless it is traditional, no dessert ingredients in mains, nothing raw that must be cooked).
- Use the listed ingredients as the main components, but you do not have to use all of them. Prefer 3 or more of them per recipe. Do not require other main ingredients the user does not have, beyond pantry staples.
- Proper cooking methods, temperatures and times for the ingredient (e.g. chicken fully cooked). Steps must be in a logical order and complete (at least 4 steps).
- Realistic quantities for 2 to 4 servings. Nutrition per serving must be realistic and macros must roughly add up (4 kcal/g protein and carbs, 9 kcal/g fat).

Reply with ONLY a JSON array, no other text. Each element:
{"title": string, "cuisine": string, "summary": string (one sentence),
"servings": number, "prep_mins": number, "cook_mins": number, "difficulty": "easy"|"medium"|"hard",
"nutrition": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number} (per serving),
"ingredients": [string] (with quantities),
"steps": [string]}`;
    return { recipes: await askJSON(await textModels(), [{ text: prompt }], RECIPE_SCHEMA, validRecipes(have)) };
  },
};

const BANNER = OR ? `OpenRouter, ${OR.model}${OR.audioModel ? ", audio " + OR.audioModel : ", browser speech for voice"}` : ENDPOINT ? `Vertex endpoint ${ENDPOINT.id}, project ${VERTEX.project}, ${VERTEX.location}` : VERTEX ? `Vertex AI, project ${VERTEX.project}, ${VERTEX.location}, ${VERTEX.model}` : "Google AI Studio key";

// `npm run check`: one text call and one recipe-schema call against the configured backend, then exit.
if (process.argv.includes("--check")) {
  (async () => {
    console.log(`Backend: ${BANNER}`);
    if (OR) await fetch(`${OR.base}/key`, { headers: { authorization: `Bearer ${OR.key}` } }).then((r) => r.json()).then((j) => {
      const d = j.data || {};
      console.log(`Key: free tier=${d.is_free_tier}, credits used=${d.usage}, limit=${d.limit ?? "none"}. (Free models: 20 requests/min; 50/day, or 1000/day once you have bought 10+ credits.)`);
    }).catch(() => {});
    try {
      console.log("Text -> JSON:", JSON.stringify((await handlers["/api/parse"]({ text: "two eggs and 500g chicken breast, expires Friday" })).items));
      console.log("OK. (Voice/audio is not exercised by this check; try the mic in the app.)");
    } catch (e) { console.error("FAILED:", e.message); process.exitCode = 1; }
  })();
} else
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if ((req.method === "POST" || url.pathname === "/api/capabilities") && handlers[url.pathname]) {
      let raw = "";
      for await (const c of req) raw += c;
      try {
        const out = await handlers[url.pathname](JSON.parse(raw || "{}"));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    let file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`FusionChef running at http://localhost:${PORT} (${BANNER})`));
