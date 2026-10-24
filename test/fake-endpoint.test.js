// Spins up a fake Vertex chat endpoint and runs the real server against it. Checks request shapes and the
// fallbacks (503 retry, schema rejection, audio_url -> input_audio). Does NOT prove real Gemma/Vertex behaviour.
const http = require("http");
const { spawn } = require("child_process");
const assert = require("assert");

const seen = [];
let n503 = 1;
const fake = http.createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const body = JSON.parse(raw); seen.push({ url: req.url, auth: req.headers.authorization, body });
  const send = (code, o) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(o));
  if (n503-- > 0) return send(503, { error: { message: "overloaded" } });
  const content = body.messages[0].content;
  const audio = Array.isArray(content) && content.find((p) => p.type === "audio_url");
  if (audio) return send(400, { error: { message: "unsupported content part audio_url" } });
  if (body.response_format) return send(400, { error: { message: "response_format json_schema not supported" } });
  const prompt = Array.isArray(content) ? content.map((p) => p.text || "").join("") : content;
  const reply = /recipes/.test(prompt)
    ? [{ title: "T", cuisine: "C", summary: "s", servings: 2, nutrition: { calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }, ingredients: ["a"], steps: ["b"] }]
    : [{ name: "egg", count: 2, weight_g: null, expiry: null }];
  send(200, { choices: [{ message: { content: "Sure!\n```json\n" + JSON.stringify(reply) + "\n```" }, finish_reason: "stop" }] });
});

const call = (port, path, body) => fetch(`http://localhost:${port}${path}`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
fake.listen(0, async () => {
  const env = { ...process.env, PORT: "3917", VERTEX_PROJECT: "p", VERTEX_LOCATION: "us-central1", VERTEX_ENDPOINT_ID: "123",
    VERTEX_ENDPOINT_DNS: `http://localhost:${fake.address().port}`, VERTEX_ACCESS_TOKEN: "tok" };
  const srv = spawn("node", ["server.js"], { env, stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    const t = await call(3917, "/api/parse", { text: "2 eggs" });
    assert.deepStrictEqual(t.items[0].name, "egg");
    assert.ok(seen.every((s) => s.url === "/v1beta1/projects/p/locations/us-central1/endpoints/123/chat/completions" && s.auth === "Bearer tok"));
    assert.ok(seen.some((s) => s.body.response_format?.json_schema.schema.type === "array"), "schema attempt made");
    assert.ok(seen.at(-1).body.response_format === undefined, "fell back to prompt-only");
    const a = await call(3917, "/api/parse", { audio: "AAAA", mime: "audio/webm" });
    assert.ok(a.items, "audio succeeds via input_audio fallback: " + JSON.stringify(a));
    assert.ok(seen.some((s) => JSON.stringify(s.body).includes("input_audio")), "tried input_audio variant");
    const r = await call(3917, "/api/recipes", { ingredients: [{ name: "egg" }] });
    assert.strictEqual(r.recipes[0].title, "T");
    console.log("PASS");
  } catch (e) { console.error("FAIL", e); process.exitCode = 1; }
  srv.kill(); fake.close();
});

// OpenRouter backend against a fake server: bearer auth, model id in body, schema -> plain fallback, fallback model on failure.
const seenOR = [];
const orFake = http.createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const body = JSON.parse(raw); seenOR.push({ url: req.url, auth: req.headers.authorization, body });
  const send = (code, o) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(o));
  if (body.model === "bad/model") return send(200, { error: { message: "provider failed" } });
  if (body.response_format) return send(400, { error: { message: "response_format not supported" } });
  const prompt = String(body.messages[0].content);
  const reply = /recipes/.test(prompt)
    ? [{ title: "T", cuisine: "C", summary: "s", servings: 2, nutrition: { calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }, ingredients: ["a"], steps: ["b"] }]
    : [{ name: "egg", count: 2, weight_g: null, expiry: null }];
  send(200, { choices: [{ message: { content: "```json\n" + JSON.stringify(reply) + "\n```" }, finish_reason: "stop" }] });
});
orFake.listen(0, async () => {
  const env = { ...process.env, PORT: "3918", OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "bad/model", OPENROUTER_FALLBACK_MODELS: "good/model",
    OPENROUTER_BASE_URL: `http://localhost:${orFake.address().port}` };
  delete env.VERTEX_PROJECT;
  const srv = spawn("node", ["server.js"], { env, stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    const t = await call(3918, "/api/parse", { text: "2 eggs" });
    assert.strictEqual(t.items[0].name, "egg");
    assert.ok(seenOR.every((s) => s.url === "/chat/completions" && s.auth === "Bearer k"));
    assert.ok(seenOR.some((s) => s.body.model === "good/model"), "fell back to second model");
    const r = await call(3918, "/api/recipes", { ingredients: [{ name: "egg" }] });
    assert.strictEqual(r.recipes[0].title, "T");
    const a = await call(3918, "/api/parse", { audio: "AAAA", mime: "audio/webm" });
    assert.ok(a.error && /audio model/.test(a.error), "no audio model configured -> clear error");
    console.log("PASS (openrouter)");
  } catch (e) { console.error("FAIL (openrouter)", e); process.exitCode = 1; }
  srv.kill(); orFake.close();
});
