# FusionChef: developer handoff

Read this first when picking up the project. User-facing docs are in `README.md`.

## What it is
A small web app: kitchen expiry tracker with voice/typed input, recipe generation across cuisines, nutrition page, recipe tab. Plain Node (18+) server with no npm dependencies, plain HTML/CSS/JS front end with no build step. AI is OpenRouter (free models by default). All user data lives in the browser's `localStorage`; the server is stateless.

## Layout
```
server.js                 HTTP server, static files, /api/* handlers, AI calls
public/index.html         Kitchen page (cards, input bar, edit dialog, dev-mode footer)
public/nutrition.html     Calorie ring, macros, manual log, saved recipes
public/recipe.html        Single recipe view (?id=)
public/js/common.js       window.FC: storage, dates (with dev day offset), food matching, defaults, api(), nav, toast
public/js/main.js         Kitchen page logic
public/js/nutrition.js    Nutrition page logic
public/js/recipe.js       Recipe page logic
public/css/style.css      All styling (CSS variables, light/dark)
public/data/foods.json    kcal database: [{name, kcal_per_100g, unit_g}] (starter list)
public/data/defaults.json Default pack sizes / shelf lives for common foods
test/fake-endpoint.test.js  Integration tests against fake model servers
.env.example              Config template (copy to .env; .env is gitignored)
```

## Server (`server.js`)
- Loads `.env` with a tiny parser. Backend is OpenRouter when `OPENROUTER_API_KEY` is set (config object `OR`).
- Legacy Vertex / AI Studio code paths still exist (`VERTEX`, `ENDPOINT`, `KEY`) but are undocumented and unused by the owner. Candidates for deletion; the OpenRouter path does not depend on them except shared helpers (`post`, `toJsonSchema`, `toChatContent`, `askJSON`).
- Endpoints: `GET /api/capabilities`, `POST /api/parse` ({text} or {audio, mime}), `POST /api/recipes` ({ingredients, cuisines?}).
- Flow: `askJSON(models, parts, schema, validate)` loops over models (main + `OPENROUTER_FALLBACK_MODELS`), tries structured output (`response_format` json_schema) then plain text, extracts JSON leniently (`extractJSON`), then runs the validator. Failures are logged as `[ai] failed: <model>: <reason>`, success as `[ai] ok: <model>`.
- `post()` retries 429/502/503/504 and network errors with backoff.
- Validators: `validItems` (parse) and `validRecipes(have)` with `sane()` (recipes: >=3 steps, >=2 ingredients, kcal 50-1800 and consistent with macros, plausible servings/times, ingredients mostly from user list or pantry; needs >=2 passing).
- Schemas are written in Gemini-style OpenAPI (upper-case types) and converted by `toJsonSchema`.
- `npm run check` (`node server.js --check`) makes one real parse call and prints key tier info.

## Front end conventions
- Vanilla JS in IIFEs, shared helpers on `window.FC`. No frameworks, no bundler, no TypeScript.
- Always use `FC.today()` / `FC.now()` instead of `new Date()` so developer-mode day offset works everywhere.
- Persist only through `FC.load/save` with keys in `KEYS` (`fc.items`, `fc.recipes`, `fc.log`, `fc.goal`, `fc.dayoffset`). `fc.dev` is set directly in `main.js`.
- Item shape: `{id, name, count, weight_g, pack, food, added, expires, guessed}`. `pack` is a display label (e.g. "carton of 6") that replaces the quantity text until the amount is edited.
- Defaults: `FC.applyDefaults(parsedItem)` fills missing amounts and shelf life from `defaults.json`; user-stated values always win.
- Escape any model or user text with `FC.esc` before putting it in `innerHTML`.
- Voice = browser SpeechRecognition (`browserListen` in `main.js`); transcript goes through the normal text parse path. Audio upload only if `OPENROUTER_AUDIO_MODEL` is set.

## Code style
- 2-space indent, double quotes, semicolons, `const` by default, short arrow functions, small comments explaining why not what.
- Keep zero npm dependencies unless there is a strong reason.
- Keep the README user-facing and this file developer-facing; update both when behaviour changes.

## Testing
- `npm test` spawns the server against fake servers (OpenRouter request shape, schema and model fallback, nonsense recipes rejected, legacy Vertex path). No real model, no browser, no microphone.
- UI changes were checked ad hoc with headless Chromium (Playwright) and the `/api/parse` response mocked; there is no committed UI test yet.
- Never verified against a real OpenRouter key from the build environment. Real-model quirks (empty replies from reasoning models, rate limits, `:free` models being retired) are the most likely source of bugs; use the `[ai]` log lines to diagnose.

## Git / workflow
- Default branch `main`; work on a branch and open a PR. Do not commit `.env`.
- Attribution lines and PR conventions come from the project settings, not this file.

## Known gaps / ideas
- Delete the legacy Vertex/AI Studio code and env vars.
- `foods.json` is a small starter list; many foods have no kcal estimate.
- Data is browser-only: no sync or backup (could add a JSON file or small DB on the server).
- Macro targets on the nutrition page are a fixed 25/50/25 split.
- No committed UI tests.
